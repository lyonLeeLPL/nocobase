import {
  FormProvider,
  ISchema,
  observer,
  RecursionField,
  Schema,
  useField,
  useForm,
} from '@formily/react';
import { Pagination, Popover, Table as AntdTable } from 'antd';
import { findIndex, forIn, range, set } from 'lodash';
import React, { Fragment, useEffect, useState } from 'react';
import { useContext } from 'react';
import { createContext } from 'react';
import { useDesignable, updateSchema, removeSchema, createSchema } from '..';
import { uid } from '@formily/shared';
import useRequest from '@ahooksjs/use-request';
import { BaseResult } from '@ahooksjs/use-request/lib/types';
import cls from 'classnames';
import { MenuOutlined, DragOutlined } from '@ant-design/icons';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Select, Dropdown, Menu, Switch, Button, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import './style.less';
import {
  findPropertyByPath,
  getSchemaPath,
  SchemaField,
  SchemaRenderer,
} from '../../components/schema-renderer';
import { interfaces, options } from '../database-field/interfaces';
import { DraggableBlockContext } from '../../components/drag-and-drop';
import AddNew from '../add-new';
import { isGridRowOrCol } from '../grid';
import { Resource } from '../../resource';
import {
  CollectionProvider,
  DisplayedMapProvider,
  useCollectionContext,
  useDisplayedMapContext,
} from '../../constate';
import { useResource as useGeneralResource } from '../../hooks/useResource';
import SwitchMenuItem from '../../components/SwitchMenuItem';
import { useMemo } from 'react';
import { createForm } from '@formily/core';
import {
  ColDraggableContext,
  SortableBodyCell,
  SortableBodyRow,
  SortableColumn,
  SortableHeaderCell,
  SortableHeaderRow,
  SortableRowHandle,
} from './Sortable';
import { DragHandle, Droppable, SortableItem } from '../../components/Sortable';
import { VisibleContext } from '../../context';

export interface ITableContext {
  props: any;
  field: Formily.Core.Models.ArrayField;
  schema: Schema;
  service: BaseResult<any, any>;
  selectedRowKeys?: any;
  setSelectedRowKeys?: any;
  pagination?: any;
  setPagination?: any;
  refresh?: any;
  resource?: Resource;
}

export interface ITableRowContext {
  index: number;
  record: any;
}

const TableConetxt = createContext<ITableContext>(null);
const TableRowContext = createContext<ITableRowContext>(null);
const CollectionFieldContext = createContext(null);

const useTable = () => {
  return useContext(TableConetxt);
};

const useTableRow = () => {
  return useContext(TableRowContext);
};

function useTableFilterAction() {
  const {
    field,
    service,
    refresh,
    props: { refreshRequestOnChange },
  } = useTable();
  return {
    async run() {
      if (refreshRequestOnChange) {
        return service.refresh();
      }
    },
  };
}

function useTableCreateAction() {
  const {
    field,
    service,
    resource,
    refresh,
    props: { refreshRequestOnChange },
  } = useTable();
  const form = useForm();
  return {
    async run() {
      if (refreshRequestOnChange) {
        await resource.create(form.values);
        await form.reset();
        return service.refresh();
      }
      field.unshift(form.values);
    },
  };
}

const useTableUpdateAction = () => {
  const {
    resource,
    field,
    service,
    refresh,
    props: { refreshRequestOnChange, rowKey },
  } = useTable();
  const ctx = useContext(TableRowContext);
  const form = useForm();

  return {
    async run() {
      if (refreshRequestOnChange) {
        await resource.save(form.values, {
          resourceKey: ctx.record[rowKey],
        });
        return service.refresh();
      }
      field.value[ctx.index] = form.values;
      // refresh();
    },
  };
};

const useTableDestroyAction = () => {
  const {
    resource,
    field,
    service,
    selectedRowKeys,
    setSelectedRowKeys,
    refresh,
    props: { refreshRequestOnChange, rowKey },
  } = useTable();
  const ctx = useContext(TableRowContext);
  return {
    async run() {
      if (refreshRequestOnChange) {
        const rowKeys = selectedRowKeys || [];
        if (ctx) {
          rowKeys.push(ctx.record[rowKey]);
        }
        await resource.destroy({
          [`${rowKey}.in`]: rowKeys,
        });
        setSelectedRowKeys([]);
        return service.refresh();
      }
      if (ctx) {
        console.log('ctx.index', ctx.index);
        field.remove(ctx.index);
        refresh();
      }
      const rowKeys = [...selectedRowKeys];
      while (rowKeys.length) {
        const key = rowKeys.shift();
        const index = findIndex(field.value, (item) => item[rowKey] === key);
        field.remove(index);
      }
      setSelectedRowKeys([]);
      refresh();
      return;
    },
  };
};

const useTableRowRecord = () => {
  const ctx = useContext(TableRowContext);
  return ctx.record;
};

const useTableIndex = () => {
  const { pagination, props } = useTable();
  const ctx = useContext(TableRowContext);
  if (pagination && !props.clientSidePagination) {
    const { pageSize, page } = pagination;
    return ctx.index + (page - 1) * pageSize;
  }
  return ctx.index;
};

const useTableActionBars = () => {
  const {
    field,
    schema,
    props: { rowKey },
  } = useTable();

  const bars = schema.reduceProperties((bars, current) => {
    if (current['x-component'] === 'Table.ActionBar') {
      return [...bars, current];
    }
    return [...bars];
  }, []);

  return bars;
};

export function isOperationColumn(schema: Schema) {
  return ['Table.Operation'].includes(schema['x-component']);
}

export function isColumn(schema: Schema) {
  return ['Table.Column'].includes(schema['x-component']);
}

export function isColumnComponent(component: string) {
  return ['Table.Operation', 'Table.Column'].includes(component);
}

const useTableOperation = () => {
  const {
    field,
    schema,
    props: { rowKey },
  } = useTable();
  const findActionDropdown = (schema: Schema) => {
    return schema.reduceProperties((s, current) => {
      if (current['x-component'] === 'Action.Dropdown') {
        return current;
      }
      const action = findActionDropdown(current);
      if (action) {
        return action;
      }
      return s;
    }, new Schema({}));
  };
  const operationSchema = schema.reduceProperties((s, current) => {
    if (isOperationColumn(current)) {
      return current;
    }
    return s;
  }, new Schema({}));
  const dropdownSchema = findActionDropdown(operationSchema);
  const columnProps = operationSchema?.['x-component-props'] || {};
  return {
    title: <Table.Operation path={getSchemaPath(dropdownSchema)} />,
    dataIndex: 'operation',
    ...columnProps,
    render: (_: any, record: any) => {
      const index = findIndex(
        field.value,
        (item) => item[rowKey] === record[rowKey],
      );
      return (
        <div className={'nb-table-column'}>
          <TableRowContext.Provider value={{ index, record }}>
            <RecursionField
              schema={operationSchema}
              name={index}
              onlyRenderProperties
            />
          </TableRowContext.Provider>
        </div>
      );
    },
  };
};

const useTableColumns = () => {
  const {
    field,
    schema,
    props: { rowKey },
  } = useTable();
  const { designable } = useDesignable();

  const { getField } = useCollectionContext();

  const operation = useTableOperation();

  const columnSchemas = schema.reduceProperties((columns, current) => {
    if (isColumn(current)) {
      return [...columns, current];
    }
    return [...columns];
  }, []);

  const columns: any[] = [operation].concat(
    columnSchemas.map((column: Schema) => {
      const columnProps = column['x-component-props'] || {};
      const collectionField = getField(columnProps.fieldName);
      return {
        title: (
          <CollectionFieldContext.Provider value={collectionField}>
            <RecursionField name={column.name} schema={column} onlyRenderSelf />
          </CollectionFieldContext.Provider>
        ),
        dataIndex: column.name,
        ...columnProps,
        render: (_: any, record: any) => {
          const index = findIndex(
            field.value,
            (item) => item[rowKey] === record[rowKey],
          );
          return (
            <CollectionFieldContext.Provider value={collectionField}>
              <TableRowContext.Provider value={{ index, record }}>
                <Table.Cell schema={column} />
              </TableRowContext.Provider>
            </CollectionFieldContext.Provider>
          );
        },
      };
    }),
  );

  if (designable) {
    columns.push({
      title: <AddColumn />,
      dataIndex: 'addnew',
    });
  }
  return columns;
};

function AddColumn() {
  const [visible, setVisible] = useState(false);
  const { appendChild, remove } = useDesignable();
  const { fields } = useCollectionContext();
  const displayed = useDisplayedMapContext();

  return (
    <Dropdown
      trigger={['click']}
      visible={visible}
      onVisibleChange={setVisible}
      overlay={
        <Menu>
          <Menu.ItemGroup className={'display-fields'} title={'字段展示'}>
            {fields.map((field) => (
              <SwitchMenuItem
                title={field?.uiSchema?.title}
                checked={displayed.has(field.name)}
                onChange={async (checked) => {
                  if (checked) {
                    const data = appendChild({
                      type: 'void',
                      'x-component': 'Table.Column',
                      'x-component-props': {
                        fieldName: field.name,
                      },
                      'x-designable-bar': 'Table.Column.DesignableBar',
                    });
                    await createSchema(data);
                  } else {
                    const s: any = displayed.get(field.name);
                    const p = getSchemaPath(s);
                    const removed = remove(p);
                    await removeSchema(removed);
                    displayed.remove(field.name);
                  }
                }}
              />
            ))}
          </Menu.ItemGroup>
          <Menu.Divider />
          <Menu.SubMenu
            popupClassName={'add-new-fields-popup'}
            title={'新增字段'}
          >
            {options.map((option) => (
              <Menu.ItemGroup title={option.label}>
                {option.children.map((item) => (
                  <Menu.Item
                    style={{ minWidth: 150 }}
                    key={item.name}
                    onClick={async () => {}}
                  >
                    {item.title}
                  </Menu.Item>
                ))}
              </Menu.ItemGroup>
            ))}
          </Menu.SubMenu>
        </Menu>
      }
    >
      <Button type={'dashed'} icon={<PlusOutlined />}>
        配置字段
      </Button>
    </Dropdown>
  );
}

const useDataSource = () => {
  const {
    pagination,
    field,
    props: { clientSidePagination, dataRequest },
  } = useTable();
  let dataSource = field.value;
  if (pagination && (clientSidePagination || !dataRequest)) {
    const { page = 1, pageSize } = pagination;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize - 1;
    dataSource = field.value?.slice(startIndex, endIndex + 1);
  }
  return dataSource;
};

const TableMain = () => {
  const {
    selectedRowKeys,
    setSelectedRowKeys,
    service,
    field,
    props: { rowKey, dragSort, showIndex },
  } = useTable();
  const columns = useTableColumns();
  const dataSource = useDataSource();
  const actionBars = useTableActionBars();
  const [html, setHtml] = useState('');
  return (
    <div className={'nb-table'}>
      <DndContext
        onDragEnd={(event) => {
          console.log({ event });
        }}
      >
        {actionBars.map((actionBar) => (
          <RecursionField
            schema={
              new Schema({
                type: 'void',
                properties: {
                  [actionBar.name]: actionBar,
                },
              })
            }
          />
        ))}
        <SortableContext
          items={dataSource}
          strategy={verticalListSortingStrategy}
        >
          <AntdTable
            pagination={false}
            onChange={(pagination) => {}}
            loading={service?.loading}
            rowKey={rowKey}
            dataSource={dataSource}
            columns={columns}
            // components={{
            //   body: {
            //     row: DragableBodyRow,
            //   },
            // }}
            components={{
              header: {
                row: SortableHeaderRow,
                cell: SortableHeaderCell,
              },
              body: {
                // wrapper: (props) => {
                //   return (
                //     <tbody {...props}>
                //       <DragOverlay
                //         className={'ant-table-row'}
                //         wrapperElement={'tr'}
                //       >
                //         <div />
                //       </DragOverlay>
                //       {props.children}
                //     </tbody>
                //   );
                // },
                row: SortableBodyRow,
                // cell: SortableBodyCell,
              },
            }}
            rowSelection={{
              type: 'checkbox',
              selectedRowKeys,
              onChange: (rowKeys) => {
                setSelectedRowKeys(rowKeys);
              },
              renderCell: (checked, record, _, originNode) => {
                const index = findIndex(
                  field.value,
                  (item) => item[rowKey] === record[rowKey],
                );
                return (
                  <TableRowContext.Provider
                    value={{
                      index,
                      record,
                    }}
                  >
                    <div
                      className={cls('nb-table-selection', {
                        dragSort,
                        showIndex,
                      })}
                    >
                      {dragSort && <Table.SortHandle />}
                      {showIndex && <Table.Index />}
                      {originNode}
                    </div>
                  </TableRowContext.Provider>
                );
              },
            }}
          />
        </SortableContext>
      </DndContext>
      <Table.Pagination />
    </div>
  );
};

const usePagination = (paginationProps?: any) => {
  return useState(() => {
    if (!paginationProps) {
      return false;
    }
    return { page: 1, pageSize: 10, ...paginationProps };
  });
};

const TableProvider = (props: any) => {
  const {
    rowKey = 'id',
    dataRequest,
    useResource = useGeneralResource,
    ...others
  } = props;
  const { schema } = useDesignable();
  const field = useField<Formily.Core.Models.ArrayField>();
  const [pagination, setPagination] = usePagination(props.pagination);
  const [selectedRowKeys, setSelectedRowKeys] = useState<any>([]);
  const [, refresh] = useState(uid());
  const { resource } = useResource();
  const service = useRequest(
    (params?: any) => {
      if (!resource) {
        return Promise.resolve({
          list: field.value,
          total: field?.value?.length,
        });
      }
      return resource.list(params).then((res) => {
        return {
          list: res?.data || [],
          total: res?.meta?.count || res?.data?.length,
        };
      });
    },
    {
      onSuccess(data: any) {
        field.setValue(data?.list || []);
      },
      defaultParams: [{ ...pagination }],
    },
  );
  console.log('refresh', { pagination });
  return (
    <TableConetxt.Provider
      value={{
        resource,
        refresh: () => {
          const { page = 1, pageSize } = pagination;
          const total = props.clientSidePagination
            ? field?.value?.length
            : service?.data?.total;
          const maxPage = Math.ceil(total / pageSize);
          if (page > maxPage) {
            setPagination((prev) => ({ ...prev, page: maxPage }));
          } else {
            refresh(uid());
          }
        },
        selectedRowKeys,
        setSelectedRowKeys,
        pagination,
        setPagination,
        service,
        field,
        schema,
        props: { ...others, rowKey, dataRequest },
      }}
    >
      <TableMain />
    </TableConetxt.Provider>
  );
};

export const Table: any = observer((props: any) => {
  const [visible, setVisible] = useState(false);
  return (
    <CollectionProvider collectionName={props.collectionName}>
      <DisplayedMapProvider>
        <TableProvider {...props} />
      </DisplayedMapProvider>
    </CollectionProvider>
  );
});

const useTotal = () => {
  const {
    field,
    service,
    props: { clientSidePagination },
  } = useTable();
  return clientSidePagination ? field?.value?.length : service?.data?.total;
};

Table.Pagination = observer(() => {
  const { service, pagination, setPagination, props } = useTable();
  if (!pagination || Object.keys(pagination).length === 0) {
    return null;
  }
  const { clientSidePagination } = props;
  const total = useTotal();
  const { page = 1 } = pagination;
  return (
    <div style={{ marginTop: 16 }}>
      <Pagination
        {...pagination}
        showSizeChanger
        current={page}
        total={total}
        onChange={(current, pageSize) => {
          const page = pagination.pageSize !== pageSize ? 1 : current;
          setPagination((prev) => ({
            ...prev,
            page,
            pageSize,
          }));
          if (clientSidePagination) {
            return;
          }
          service.run({
            ...service.params,
            page,
            pageSize,
          });
        }}
      />
    </div>
  );
});

function generateActionSchema(type) {
  const actions: { [key: string]: ISchema } = {
    filter: {
      key: uid(),
      name: uid(),
      type: 'void',
      title: '筛选',
      'x-align': 'left',
      'x-decorator': 'AddNew.Displayed',
      'x-decorator-props': {
        displayName: 'filter',
      },
      'x-component': 'Table.Filter',
      'x-designable-bar': 'Table.Filter.DesignableBar',
      'x-component-props': {
        fieldNames: [],
      },
    },
    export: {},
    create: {
      key: uid(),
      type: 'void',
      name: uid(),
      title: '新增',
      'x-align': 'right',
      'x-decorator': 'AddNew.Displayed',
      'x-decorator-props': {
        displayName: 'create',
      },
      'x-component': 'Action',
      'x-component-props': {
        type: 'primary',
      },
      'x-designable-bar': 'Table.Action.DesignableBar',
      properties: {
        modal: {
          type: 'void',
          title: '新增数据',
          'x-decorator': 'Form',
          'x-component': 'Action.Modal',
          'x-component-props': {
            useOkAction: '{{ Table.useTableCreateAction }}',
          },
          properties: {
            [uid()]: {
              type: 'void',
              'x-component': 'Grid',
              'x-component-props': {
                addNewComponent: 'AddNew.FormItem',
              },
            },
          },
        },
      },
    },
    destroy: {
      key: uid(),
      type: 'void',
      name: uid(),
      title: '删除',
      'x-align': 'right',
      'x-decorator': 'AddNew.Displayed',
      'x-decorator-props': {
        displayName: 'destroy',
      },
      'x-action-type': 'destroy',
      'x-component': 'Action',
      'x-designable-bar': 'Table.Action.DesignableBar',
      'x-component-props': {
        useAction: '{{ Table.useTableDestroyAction }}',
      },
    },
    view: {},
    update: {},
  };
  return actions[type];
}

function generateMenuActionSchema(type) {
  const actions: { [key: string]: ISchema } = {
    view: {
      key: uid(),
      name: uid(),
      type: 'void',
      title: '查看',
      'x-component': 'Menu.Action',
      'x-designable-bar': 'Table.Action.DesignableBar',
      'x-action-type': 'view',
      properties: {
        [uid()]: {
          type: 'void',
          title: '查看',
          'x-component': 'Action.Modal',
          'x-component-props': {
            bodyStyle: {
              background: '#f0f2f5',
              // paddingTop: 0,
            },
          },
          properties: {
            [uid()]: {
              type: 'void',
              'x-component': 'Tabs',
              'x-designable-bar': 'Tabs.DesignableBar',
              properties: {
                [uid()]: {
                  type: 'void',
                  title: '详情',
                  'x-designable-bar': 'Tabs.TabPane.DesignableBar',
                  'x-component': 'Tabs.TabPane',
                  'x-component-props': {},
                  properties: {
                    [uid()]: {
                      type: 'void',
                      'x-component': 'Grid',
                      'x-component-props': {
                        addNewComponent: 'AddNew.PaneItem',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    update: {
      key: uid(),
      name: uid(),
      type: 'void',
      title: '编辑',
      'x-component': 'Menu.Action',
      'x-designable-bar': 'Table.Action.DesignableBar',
      'x-action-type': 'update',
      properties: {
        [uid()]: {
          type: 'void',
          title: '编辑数据',
          'x-decorator': 'Form',
          'x-decorator-props': {
            useResource: '{{ Table.useResource }}',
            useValues: '{{ Table.useTableRowRecord }}',
          },
          'x-component': 'Action.Modal',
          'x-component-props': {
            useOkAction: '{{ Table.useTableUpdateAction }}',
          },
          properties: {
            [uid()]: {
              type: 'void',
              'x-component': 'Grid',
              'x-component-props': {
                addNewComponent: 'AddNew.FormItem',
              },
            },
          },
        },
      },
    },
    destroy: {
      key: uid(),
      name: uid(),
      type: 'void',
      title: '删除',
      'x-component': 'Menu.Action',
      'x-designable-bar': 'Table.Action.DesignableBar',
      'x-action-type': 'destroy',
      'x-component-props': {
        useAction: '{{ Table.useTableDestroyAction }}',
      },
    },
  };
  return actions[type];
}

function AddActionButton() {
  const [visible, setVisible] = useState(false);
  const displayed = useDisplayedMapContext();
  const { appendChild, remove } = useDesignable();
  const { schema, designable } = useDesignable();
  if (!designable) {
    return null;
  }
  return (
    <Dropdown
      trigger={['click']}
      visible={visible}
      onVisibleChange={setVisible}
      overlay={
        <Menu>
          <Menu.ItemGroup title={'操作展示'}>
            {[
              { title: '筛选', name: 'filter' },
              // { title: '导出', name: 'export' },
              { title: '新增', name: 'create' },
              { title: '删除', name: 'destroy' },
            ].map((item) => (
              <SwitchMenuItem
                key={item.name}
                checked={displayed.has(item.name)}
                title={item.title}
                onChange={async (checked) => {
                  if (!checked) {
                    const s = displayed.get(item.name) as Schema;
                    const path = getSchemaPath(s);
                    displayed.remove(item.name);
                    const removed = remove(path);
                    await removeSchema(removed);
                  } else {
                    const s = generateActionSchema(item.name);
                    const data = appendChild(s);
                    await createSchema(data);
                  }
                }}
              />
            ))}
          </Menu.ItemGroup>
          <Menu.Divider />
          <Menu.SubMenu title={'自定义'}>
            <Menu.Item style={{ minWidth: 120 }}>函数操作</Menu.Item>
            <Menu.Item>弹窗表单</Menu.Item>
            <Menu.Item>复杂弹窗</Menu.Item>
          </Menu.SubMenu>
        </Menu>
      }
    >
      <Button style={{ marginLeft: 8 }} type={'dashed'} icon={<PlusOutlined />}>
        配置操作
      </Button>
    </Dropdown>
  );
}

function Actions(props: any) {
  const { align = 'left' } = props;
  const { schema, designable } = useDesignable();
  return (
    <Droppable
      id={`${schema.name}-${align}`}
      className={`action-bar-align-${align}`}
      data={{ align, path: getSchemaPath(schema) }}
    >
      <Space>
        {schema.mapProperties((s) => {
          const currentAlign = s['x-align'] || 'left';
          if (currentAlign !== align) {
            return null;
          }
          return (
            <SortableItem
              id={s.name}
              data={{
                align,
                draggable: true,
                title: s.title,
                path: getSchemaPath(s),
              }}
            >
              <RecursionField name={s.name} schema={s} />
            </SortableItem>
          );
        })}
      </Space>
    </Droppable>
  );
}

Table.ActionBar = observer((props: any) => {
  const { align = 'top' } = props;
  // const { schema, designable } = useDesignable();
  const { root, schema, insertAfter, remove, appendChild } = useDesignable();
  const moveToAfter = (path1, path2, extra = {}) => {
    if (!path1 || !path2) {
      return;
    }
    if (path1.join('.') === path2.join('.')) {
      return;
    }
    const data = findPropertyByPath(root, path1);
    if (!data) {
      return;
    }
    remove(path1);
    return insertAfter(
      {
        ...data.toJSON(),
        ...extra,
      },
      path2,
    );
  };

  const [dragOverlayContent, setDragOverlayContent] = useState('');
  return (
    <DndContext
      onDragStart={(event) => {
        setDragOverlayContent(event.active.data?.current?.title || '');
        // const previewRef = event.active.data?.current?.previewRef;
        // if (previewRef) {
        //   setDragOverlayContent(previewRef?.current?.innerHTML);
        // } else {
        //   setDragOverlayContent('');
        // }
      }}
      onDragEnd={async (event) => {
        const path1 = event.active?.data?.current?.path;
        const path2 = event.over?.data?.current?.path;
        const align = event.over?.data?.current?.align;
        const draggable = event.over?.data?.current?.draggable;
        if (!path1 || !path2) {
          return;
        }
        if (path1.join('.') === path2.join('.')) {
          return;
        }
        if (!draggable) {
          console.log('alignalignalignalign', align);
          const p = findPropertyByPath(root, path1);
          if (!p) {
            return;
          }
          remove(path1);
          const data = appendChild(
            {
              ...p.toJSON(),
              'x-align': align,
            },
            path2,
          );
          await updateSchema(data);
        } else {
          const data = moveToAfter(path1, path2, {
            'x-align': align,
          });
          await updateSchema(data);
        }
      }}
    >
      <DragOverlay style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
        {dragOverlayContent}
        {/* <div style={{ transform: 'translateX(-100%)' }} dangerouslySetInnerHTML={{__html: dragOverlayContent}}></div> */}
      </DragOverlay>
      <DisplayedMapProvider>
        <div className={cls('nb-action-bar', `align-${align}`)}>
          <div style={{ width: '50%' }}>
            <Actions align={'left'} />
          </div>
          <div style={{ marginLeft: 'auto', width: '50%', textAlign: 'right' }}>
            <Actions align={'right'} />
          </div>
          <AddActionButton />
        </div>
      </DisplayedMapProvider>
    </DndContext>
  );
});

Table.Filter = observer((props: any) => {
  const { fieldNames = [] } = props;
  const { schema, DesignableBar } = useDesignable();
  const form = useMemo(() => createForm(), []);
  const { fields = [] } = useCollectionContext();
  const fields2properties = (fields: any[]) => {
    const properties = {};
    fields.forEach((field, index) => {
      if (fieldNames?.length && !fieldNames.includes(field.name)) {
        return;
      }
      const fieldOption = interfaces.get(field.interface);
      if (!fieldOption.operations) {
        return;
      }
      properties[`column${index}`] = {
        type: 'void',
        title: field?.uiSchema?.title,
        'x-component': 'Filter.Column',
        'x-component-props': {
          operations: fieldOption.operations,
        },
        properties: {
          [field.name]: {
            ...field.uiSchema,
            title: null,
          },
        },
      };
    });
    return properties;
  };
  return (
    <Popover
      trigger={['click']}
      placement={'bottomLeft'}
      content={
        <div>
          <FormProvider form={form}>
            <SchemaField
              schema={{
                type: 'object',
                properties: {
                  filter: {
                    type: 'object',
                    'x-component': 'Filter',
                    properties: fields2properties(fields),
                  },
                },
              }}
            />
          </FormProvider>
        </div>
      }
    >
      <Button>
        {schema.title}
        <DesignableBar />
      </Button>
    </Popover>
  );
});

Table.Filter.DesignableBar = () => {
  const { schema, remove, refresh, insertAfter } = useDesignable();
  const [visible, setVisible] = useState(false);
  const displayed = useDisplayedMapContext();
  const { fields } = useCollectionContext();

  return (
    <div className={cls('designable-bar', { active: visible })}>
      <span
        onClick={(e) => {
          e.stopPropagation();
        }}
        className={cls('designable-bar-actions', { active: visible })}
      >
        <DragHandle />
        <Dropdown
          trigger={['click']}
          visible={visible}
          onVisibleChange={(visible) => {
            setVisible(visible);
          }}
          overlay={
            <Menu>
              <Menu.ItemGroup title={'筛选字段'}>
                {fields
                  .filter((field) => {
                    const option = interfaces.get(field.interface);
                    return option.operations?.length;
                  })
                  .map((field) => (
                    <SwitchMenuItem
                      title={field?.uiSchema?.title}
                      checked={true}
                      onChange={async (checked) => {}}
                    />
                  ))}
              </Menu.ItemGroup>
              <Menu.Divider />
              <Menu.Item
                onClick={(e) => {
                  schema.title = uid();
                  refresh();
                }}
              >
                修改名称和图标
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                onClick={async () => {
                  const displayName =
                    schema?.['x-decorator-props']?.['displayName'];
                  const data = remove();
                  await removeSchema(data);
                  if (displayName) {
                    displayed.remove(displayName);
                  }
                  setVisible(false);
                }}
              >
                删除
              </Menu.Item>
            </Menu>
          }
        >
          <MenuOutlined />
        </Dropdown>
      </span>
    </div>
  );
};

Table.Operation = observer((props: any) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className={'nb-table-column'}>
      操作
      <Table.Operation.DesignableBar path={props.path} />
    </div>
  );
});

Table.Operation.Cell = observer((props: any) => {
  const ctx = useContext(TableRowContext);
  const schema = props.schema;
  return (
    <div className={'nb-table-column'}>
      <RecursionField schema={schema} name={ctx.index} onlyRenderProperties />
    </div>
  );
});

Table.Operation.DesignableBar = (props) => {
  const { schema, remove, refresh, appendChild } = useDesignable(props.path);
  const [visible, setVisible] = useState(false);
  const map = new Map();
  schema.mapProperties((s) => {
    if (!s['x-action-type']) {
      return;
    }
    map.set(s['x-action-type'], s.name);
  });
  return (
    <div className={cls('designable-bar', { active: visible })}>
      <span
        onClick={(e) => {
          e.stopPropagation();
        }}
        className={cls('designable-bar-actions', { active: visible })}
      >
        <DragHandle />
        <Dropdown
          trigger={['click']}
          visible={visible}
          onVisibleChange={(visible) => {
            setVisible(visible);
          }}
          overlay={
            <Menu>
              <Menu.ItemGroup title={'操作展示'}>
                {[
                  { title: '查看', name: 'view' },
                  { title: '编辑', name: 'update' },
                  { title: '删除', name: 'destroy' },
                ].map((item) => (
                  <SwitchMenuItem
                    key={item.name}
                    title={item.title}
                    checked={map.has(item.name)}
                    onChange={async (checked) => {
                      if (checked) {
                        const s = generateMenuActionSchema(item.name);
                        const data = appendChild(s);
                        await createSchema(data);
                      } else if (map.get(item.name)) {
                        const removed = remove([
                          ...props.path,
                          map.get(item.name),
                        ]);
                        await removeSchema(removed);
                      }
                    }}
                  />
                ))}
              </Menu.ItemGroup>
              <Menu.Divider />
              <Menu.SubMenu title={'自定义'}>
                <Menu.Item style={{ minWidth: 120 }}>函数操作</Menu.Item>
                <Menu.Item>弹窗表单</Menu.Item>
                <Menu.Item>复杂弹窗</Menu.Item>
              </Menu.SubMenu>
            </Menu>
          }
        >
          <MenuOutlined />
        </Dropdown>
      </span>
    </div>
  );
};

Table.Action = () => null;

Table.Action.DesignableBar = () => {
  const { schema, remove, refresh, insertAfter } = useDesignable();
  const [visible, setVisible] = useState(false);
  const isPopup = Object.keys(schema.properties || {}).length > 0;
  const inActionBar = schema.parent['x-component'] === 'Table.ActionBar';
  const displayed = useDisplayedMapContext();
  return (
    <div className={cls('designable-bar', { active: visible })}>
      <span
        onClick={(e) => {
          e.stopPropagation();
        }}
        className={cls('designable-bar-actions', { active: visible })}
      >
        <DragHandle />
        <Dropdown
          trigger={['click']}
          visible={visible}
          onVisibleChange={(visible) => {
            setVisible(visible);
          }}
          overlay={
            <Menu>
              <Menu.Item
                onClick={(e) => {
                  schema.title = uid();
                  refresh();
                }}
              >
                修改名称和图标
              </Menu.Item>
              {isPopup && (
                <Menu.Item>
                  在{' '}
                  <Select
                    bordered={false}
                    size={'small'}
                    defaultValue={'modal'}
                  >
                    <Select.Option value={'modal'}>对话框</Select.Option>
                    <Select.Option value={'drawer'}>抽屉</Select.Option>
                    <Select.Option value={'window'}>浏览器窗口</Select.Option>
                  </Select>{' '}
                  内打开
                </Menu.Item>
              )}
              {!inActionBar && (
                <Menu.Item>
                  点击表格行时触发 &nbsp;&nbsp;
                  <Switch size={'small'} defaultChecked />
                </Menu.Item>
              )}
              <Menu.Divider />
              <Menu.Item
                onClick={async () => {
                  const displayName =
                    schema?.['x-decorator-props']?.['displayName'];
                  const data = remove();
                  await removeSchema(data);
                  if (displayName) {
                    displayed.remove(displayName);
                  }
                  setVisible(false);
                }}
              >
                删除
              </Menu.Item>
            </Menu>
          }
        >
          <MenuOutlined />
        </Dropdown>
      </span>
    </div>
  );
};

Table.Cell = observer((props: any) => {
  const ctx = useContext(TableRowContext);
  const schema = props.schema;
  const collectionField = useContext(CollectionFieldContext);
  if (schema['x-component'] === 'Table.Operation') {
    return <Table.Operation.Cell {...props} />;
  }
  return (
    <RecursionField
      schema={
        !collectionField
          ? schema
          : new Schema({
              type: 'void',
              properties: {
                [collectionField.name]: {
                  ...collectionField.uiSchema,
                  title: undefined,
                  'x-read-pretty': true,
                  'x-decorator-props': {
                    feedbackLayout: 'popover',
                  },
                  'x-decorator': 'FormilyFormItem',
                },
              },
            })
      }
      name={ctx.index}
      onlyRenderProperties
    />
  );
});

Table.Column = observer((props: any) => {
  const collectionField = useContext(CollectionFieldContext);
  const { schema, DesignableBar } = useDesignable();
  const displayed = useDisplayedMapContext();
  useEffect(() => {
    if (collectionField?.name) {
      displayed.set(collectionField.name, schema);
    }
  }, [collectionField, schema]);
  return (
    <div className={'nb-table-column'}>
      {schema.title || collectionField?.uiSchema?.title}
      <DesignableBar />
    </div>
  );
});

Table.Column.DesignableBar = () => {
  const field = useField();
  // const fieldSchema = useFieldSchema();
  const { schema, remove, refresh, insertAfter } = useDesignable();
  const [visible, setVisible] = useState(false);
  const displayed = useDisplayedMapContext();
  const ctx = useContext(ColDraggableContext);
  return (
    <div className={cls('designable-bar', { active: visible })}>
      <span
        onClick={(e) => {
          e.stopPropagation();
        }}
        className={cls('designable-bar-actions', { active: visible })}
      >
        <DragHandle />
        <Dropdown
          trigger={['click']}
          visible={visible}
          onVisibleChange={(visible) => {
            setVisible(visible);
          }}
          overlay={
            <Menu>
              <Menu.Item
                onClick={async (e) => {
                  const title = uid();
                  field.title = title;
                  schema.title = title;
                  refresh();
                  await updateSchema({
                    key: schema['key'],
                    title: title,
                  });
                  setVisible(false);
                }}
              >
                编辑列
              </Menu.Item>
              <Menu.Item
                onClick={async () => {
                  const s = remove();
                  const fieldName = schema['x-component-props']?.['fieldName'];
                  displayed.remove(fieldName);
                  await removeSchema(s);
                }}
              >
                删除列
              </Menu.Item>
            </Menu>
          }
        >
          <MenuOutlined />
        </Dropdown>
      </span>
    </div>
  );
};

Table.Index = observer(() => {
  const index = useTableIndex();
  return <span className={'nb-table-index'}>{index + 1}</span>;
});

Table.SortHandle = observer((props: any) => {
  return <SortableRowHandle {...props} />;
});

Table.DesignableBar = observer((props) => {
  const field = useField();
  const { designable, schema, refresh, deepRemove } = useDesignable();
  const [visible, setVisible] = useState(false);
  const { dragRef } = useContext(DraggableBlockContext);
  if (!designable) {
    return null;
  }
  const defaultPageSize =
    schema['x-component-props']?.['pagination']?.['defaultPageSize'] || 20;
  return (
    <div className={cls('designable-bar', { active: visible })}>
      <span
        onClick={(e) => {
          e.stopPropagation();
        }}
        className={cls('designable-bar-actions', { active: visible })}
      >
        <Space size={'small'}>
          <AddNew.CardItem defaultAction={'insertAfter'} ghost />
          {dragRef && <DragOutlined ref={dragRef} />}
          <Dropdown
            trigger={['click']}
            visible={visible}
            onVisibleChange={(visible) => {
              setVisible(visible);
            }}
            overlay={
              <Menu>
                <Menu.Item
                  key={'showIndex'}
                  onClick={() => {
                    const bool = !field.componentProps.showIndex;
                    schema['x-component-props']['showIndex'] = bool;
                    field.componentProps.showIndex = bool;
                  }}
                >
                  {field.componentProps.showIndex ? '隐藏序号' : '显示序号'}
                </Menu.Item>
                <Menu.Item
                  key={'dragSort'}
                  onClick={() => {
                    const dragSort = field.componentProps.dragSort
                      ? false
                      : 'sort';
                    schema['x-component-props']['dragSort'] = dragSort;
                    field.componentProps.dragSort = dragSort;
                  }}
                >
                  {field.componentProps.dragSort
                    ? '禁用拖拽排序'
                    : '启用拖拽排序'}
                </Menu.Item>
                {!field.componentProps.dragSort && (
                  <Menu.Item key={'defaultSort'}>默认排序</Menu.Item>
                )}
                <Menu.Item key={'defaultFilter'}>筛选范围</Menu.Item>
                <Menu.Item key={'defaultPageSize'}>
                  每页默认显示{' '}
                  <Select
                    bordered={false}
                    size={'small'}
                    onChange={(value) => {
                      const componentProps = schema['x-component-props'] || {};
                      set(componentProps, 'pagination.defaultPageSize', value);
                      schema['x-component-props'] = componentProps;
                      refresh();
                    }}
                    defaultValue={defaultPageSize}
                  >
                    <Select.Option value={20}>20</Select.Option>
                    <Select.Option value={50}>50</Select.Option>
                    <Select.Option value={100}>100</Select.Option>
                  </Select>{' '}
                  条
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  key={'delete'}
                  onClick={async () => {
                    const removed = deepRemove();
                    // console.log({ removed })
                    const last = removed.pop();
                    if (isGridRowOrCol(last)) {
                      await removeSchema(last);
                    }
                  }}
                >
                  删除当前区块
                </Menu.Item>
              </Menu>
            }
          >
            <MenuOutlined />
          </Dropdown>
        </Space>
      </span>
    </div>
  );
});

Table.useResource = ({ onSuccess }) => {
  const { props } = useTable();
  const { collection } = useCollectionContext();
  const ctx = useContext(TableRowContext);
  const resource = Resource.make({
    resourceName: collection.name,
    resourceKey: ctx.record[props.rowKey],
  });
  const { data, loading, run } = useRequest(
    (params?: any) => {
      console.log('Table.useResource', params);
      return resource.get(params);
    },
    {
      formatResult: (result) => result?.data,
      onSuccess,
      manual: true,
    },
  );
  return { initialValues: data, loading, run, resource };
};

Table.useTableFilterAction = useTableFilterAction;
Table.useTableCreateAction = useTableCreateAction;
Table.useTableUpdateAction = useTableUpdateAction;
Table.useTableDestroyAction = useTableDestroyAction;
Table.useTableIndex = useTableIndex;
Table.useTableRowRecord = useTableRowRecord;