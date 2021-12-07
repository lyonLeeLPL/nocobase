import { mockServer, MockServer } from '@nocobase/test';
import { registerActions } from '..';

describe('remove', () => {
  let api: MockServer;

  beforeEach(async () => {
    api = mockServer({
      dataWrapping: false,
    });
    registerActions(api);
  });

  afterEach(async () => {
    return api.destroy();
  });

  it('remove', async () => {
    
  });
});