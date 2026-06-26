'use strict';

const { createLoginWindow } = require('../lib/login_window');

function makeDeps(overrides = {}) {
  return {
    BrowserWindow: jest.fn(),
    shell: {},
    session: {},
    BOOTH_LOGIN_PARTITION: 'persist:booth-login',
    LOGIN_ALLOWED_HOST_SUFFIXES: ['booth.pm'],
    LOGIN_ALLOWED_PROTOCOLS: new Set(['https:']),
    getAppIconPath: jest.fn(),
    setBoothClient: jest.fn(),
    setBoothCookies: jest.fn(),
    normalizeBoothCookies: jest.fn((rows) => rows),
    persistTempBoothCookies: jest.fn(),
    persistBoothCookies: jest.fn(),
    validateBoothLogin: jest.fn(),
    refreshMetaAfterLoginDedup: jest.fn(),
    getMainWindow: jest.fn(),
    createClientAndCookies: jest.fn(),
    ...overrides,
  };
}

describe('createLoginWindow internals', () => {
  test('syncCookiesFromPartition stores the axios client, not the wrapper promise', async () => {
    const client = { get: jest.fn() };
    const cookies = [{ name: 'sid', value: 'abc', domain: '.booth.pm' }];
    const deps = makeDeps({
      createClientAndCookies: jest.fn().mockResolvedValue({ client, cookies }),
    });
    const login = createLoginWindow(deps);

    const synced = await login._test.syncCookiesFromRows(cookies);

    expect(synced).toEqual(cookies);
    expect(deps.createClientAndCookies).toHaveBeenCalledWith(cookies);
    expect(deps.setBoothClient).toHaveBeenCalledWith(client);
    expect(deps.setBoothCookies).toHaveBeenCalledWith(cookies);
  });
});
