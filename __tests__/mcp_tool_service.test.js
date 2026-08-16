'use strict';

const { createMcpToolService } = require('../lib/mcp_tool_service');

function service(overrides = {}) {
  const deps = {
    appVersion: 'test',
    metaMgr: { getMetaCache: () => [
      { itemId: '123', itemName: 'Blue Hair', token: 'should-not-leak' },
      { itemId: 'abc-2', itemName: 'Red Dress', authorName: 'Shop' },
    ] },
    settingsMgr: { getSettings: () => ({ unityProjects: [{ name: 'Main', path: 'C:\\Unity\\Main' }], cookie: 'secret' }) },
    unityMgr: { listRunningUnityProjectPaths: async () => ['C:\\Unity\\Main'] },
    queueMgr: { getQueueStatus: () => ({ queued: 1 }) },
    ...overrides,
  };
  return createMcpToolService(deps);
}

test('read tools return data and remove secret fields', async () => {
  const s = service();
  expect((await s.callTool('get_asset', { itemId: '123' })).item.token).toBeUndefined();
  expect((await s.callTool('search_assets', { query: 'dress' })).items).toHaveLength(1);
  expect((await s.callTool('list_assets', { query: 'blue' })).returned).toBe(1);
  expect((await s.callTool('avatool_status')).settings.cookie).toBeUndefined();
  expect((await s.callTool('list_unity_projects')).projects[0].running).toBe(true);
});

test('strict argument validation and allowlist', async () => {
  const s = service();
  await expect(s.callTool('get_asset', { itemId: '../bad' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('list_assets', { limit: 0 })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('import_asset_to_unity', { itemId: '123', projectPath: 'relative' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('import_asset_to_unity', { itemId: '123', projectPath: 'C:\\Unity\\Main', importMode: 'other' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('nope', {})).rejects.toMatchObject({ code: 'unknown_tool' });
});

test('mutating tools delegate only after resolving/validating inputs', async () => {
  const syncLibrary = jest.fn().mockResolvedValue({ ok: true });
  const enqueueDownload = jest.fn().mockResolvedValue({ queued: true });
  const importAssetToUnity = jest.fn().mockResolvedValue({ ok: true });
  const s = service({ syncLibrary, enqueueDownload, importAssetToUnity });
  await expect(s.callTool('sync_library', { fullRescan: true })).resolves.toEqual({ ok: true });
  await expect(s.callTool('download_item', { itemId: 'abc-2' })).resolves.toEqual({ queued: true });
  await expect(s.callTool('download_item', { itemId: 'missing' })).resolves.toEqual({ ok: false, error: 'item_not_found' });
  await s.callTool('import_asset_to_unity', { itemId: '123', projectPath: 'C:\\Unity\\Main' });
  expect(syncLibrary).toHaveBeenCalledWith({ fullRescan: true });
  expect(enqueueDownload).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'abc-2' }));
  expect(importAssetToUnity).toHaveBeenCalledWith({ itemId: '123', projectPath: 'C:\\Unity\\Main', importMode: undefined });
});

test('normalizes string unity projects and compares running paths case-insensitively', async () => {
  const s = service({
    settingsMgr: { getSettings: () => ({ unityProjects: ['C:\\Unity\\Main'] }) },
    unityMgr: { listRunningUnityProjectPaths: async () => ['c:\\unity\\main'] },
  });
  await expect(s.callTool('list_unity_projects')).resolves.toEqual({
    projects: [{ name: '', path: 'C:\\Unity\\Main', running: true }],
  });
});

test('exposes the second wave tools and delegates validated arguments', async () => {
  const calls = {};
  const fn = (name, value) => jest.fn((...args) => { calls[name] = args; return value; });
  const s = service({
    getOperationLogs: fn('logs', [{ message: 'ok' }]),
    runHealthCheck: fn('health', { ok: true }),
    getStorageUsage: fn('storage', { bytes: 1 }),
    listItemFiles: fn('files', []),
    listUnityPackages: fn('packages', []),
    getProjectItems: fn('projectItems', []),
    searchBooth: fn('search', []),
    getBoothItem: fn('boothItem', {}),
    listBootstrapChoices: fn('choices', []),
    controlDownloadQueue: fn('control', { ok: true }),
    extractItem: fn('extract', { ok: true }),
    installVpmDependencies: fn('vpm', { ok: true }),
    runAutoBootstrap: fn('bootstrap', { ok: true }),
  });
  await s.callTool('get_operation_logs', { limit: 3 });
  await s.callTool('run_health_check');
  await s.callTool('get_storage_usage');
  await s.callTool('list_item_files', { itemId: 'abc-2', limit: 4 });
  await s.callTool('list_unitypackages', { itemId: 'abc-2' });
  await s.callTool('get_project_items', { projectPath: 'C:\\Unity\\Main' });
  await s.callTool('search_booth', { query: 'hair', page: 2, sort: 'popular_items', ignored: 'drop-me' });
  await s.callTool('get_booth_item', { itemId: 'abc-2' });
  await s.callTool('list_bootstrap_choices');
  await s.callTool('control_download_queue', { action: 'retry_failed' });
  await s.callTool('extract_item', { itemId: 'abc-2', force: true });
  await s.callTool('install_vpm_dependencies', { projectPath: 'C:\\Unity\\Main', modularAvatar: true, liltoon: false });
  await s.callTool('run_auto_bootstrap', { projectPath: 'C:\\Unity\\Main' });
  expect(calls.logs).toEqual([3]);
  expect(calls.health).toEqual([]);
  expect(calls.files).toEqual([{ itemId: 'abc-2', limit: 4 }]);
  expect(calls.search).toEqual([{ query: 'hair', page: 2, sort: 'popular_items' }]);
  expect(calls.control).toEqual([{ action: 'retry_failed' }]);
  expect(calls.extract).toEqual([{ itemId: 'abc-2', force: true }]);
  expect(calls.vpm).toEqual([{ projectPath: 'C:\\Unity\\Main', modularAvatar: true, liltoon: false }]);
});

test('second wave rejects malformed identifiers, paths, limits, and actions', async () => {
  const s = service({ controlDownloadQueue: jest.fn(), listItemFiles: jest.fn(), getProjectItems: jest.fn(), searchBooth: jest.fn() });
  await expect(s.callTool('list_item_files', { itemId: '../bad' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('get_project_items', { projectPath: 'relative' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('search_booth', { query: '\u0000' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('search_booth', { page: 0 })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('search_booth', { sort: 'Popular-Items' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('list_item_files', { itemId: 'abc-2', limit: 0 })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('control_download_queue', { action: 'pause' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('install_vpm_dependencies', { projectPath: 'C:\\Unity\\Main' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('install_vpm_dependencies', { projectPath: 'C:\\Unity\\Main', modularAvatar: false, liltoon: false })).rejects.toMatchObject({ code: 'invalid_arguments' });
});

test('normalizes operation logs to structuredContent-safe object', async () => {
  const row = { message: 'ok' };
  await expect(service({ getOperationLogs: jest.fn().mockResolvedValue([row]) }).callTool('get_operation_logs', { limit: 5 }))
    .resolves.toEqual({ logs: [row], returned: 1 });
  await expect(service({ getOperationLogs: jest.fn().mockResolvedValue({ logs: [row], returned: 99 }) }).callTool('get_operation_logs'))
    .resolves.toEqual({ logs: [row], returned: 1 });
  await expect(service({ getOperationLogs: jest.fn().mockResolvedValue({ error: 'bad' }) }).callTool('get_operation_logs'))
    .resolves.toEqual({ logs: [], returned: 0 });
});

test('exposes Wave 3 tools and delegates only validated arguments', async () => {
  const calls = {};
  const fn = (name, value) => jest.fn((...args) => { calls[name] = args; return value; });
  const s = service({
    getBoothCart: fn('cart', { items: [] }),
    listSettingsProfiles: fn('profiles', ['desktop']),
    getImportHistory: fn('history', []),
    scanUnitypackage: fn('scan', { packages: [] }),
    analyzeVpmDependencies: fn('analyze', { dependencies: [] }),
    getRuntimeLogs: fn('runtimeLogs', []),
    checkAppUpdate: fn('update', { available: false }),
    setWishlist: fn('wishlist', { ok: true }),
    importBoothWishlist: fn('importWishlist', { ok: true }),
    addToBoothCart: fn('cartAdd', { ok: true }),
    updateSettings: fn('settings', { cookie: 'must-not-leak', enabled: true }),
    applySettingsProfile: fn('applyProfile', { ok: true }),
    saveSettingsProfile: fn('saveProfile', { ok: true }),
    clearOperationLogs: fn('clearLogs', { ok: true }),
  });
  await s.callTool('get_booth_cart', { shopSubdomain: 'booth.pm' });
  await s.callTool('list_settings_profiles');
  await s.callTool('get_import_history', { itemId: 'abc-2', limit: 3 });
  await s.callTool('scan_unitypackage', { itemId: 'abc-2', packagePath: 'Assets/package.unitypackage' });
  await s.callTool('analyze_vpm_dependencies', { projectPath: 'C:\\Unity\\Main', itemId: 'abc-2' });
  await s.callTool('get_runtime_logs', { limit: 4 });
  await s.callTool('check_app_update');
  await s.callTool('set_wishlist', { itemId: 'abc-2', wishlisted: true });
  await s.callTool('import_booth_wishlist');
  await s.callTool('add_to_booth_cart', { itemId: 'abc-2', variationName: 'Blue' });
  await expect(s.callTool('update_settings', { patch: { enabled: true } })).resolves.toEqual({ enabled: true });
  await s.callTool('apply_settings_profile', { profileName: 'desktop' });
  await s.callTool('save_settings_profile', { profileName: 'desktop' });
  await s.callTool('clear_operation_logs');
  expect(calls.cart).toEqual([{ shopSubdomain: 'booth.pm' }]);
  expect(calls.history).toEqual([{ itemId: 'abc-2', limit: 3 }]);
  expect(calls.scan).toEqual([{ itemId: 'abc-2', packagePath: 'Assets/package.unitypackage' }]);
  expect(calls.analyze).toEqual([{ projectPath: 'C:\\Unity\\Main', itemId: 'abc-2' }]);
  expect(calls.runtimeLogs).toEqual([{ limit: 4 }]);
  expect(calls.wishlist).toEqual([{ itemId: 'abc-2', wishlisted: true }]);
  expect(calls.cartAdd).toEqual([{ itemId: 'abc-2', variationName: 'Blue' }]);
  expect(calls.applyProfile).toEqual([{ profileName: 'desktop' }]);
  expect(calls.saveProfile).toEqual([{ profileName: 'desktop' }]);
  expect(calls.clearLogs).toEqual([]);
});

test('Wave 3 rejects unsafe paths, strings, profiles, and settings patches', async () => {
  const s = service({
    getBoothCart: jest.fn(), getImportHistory: jest.fn(), scanUnitypackage: jest.fn(),
    analyzeVpmDependencies: jest.fn(), addToBoothCart: jest.fn(), updateSettings: jest.fn(),
    applySettingsProfile: jest.fn(), saveSettingsProfile: jest.fn(),
  });
  await expect(s.callTool('get_booth_cart', { shopSubdomain: 'Upper' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('get_booth_cart', { shopSubdomain: 'a'.repeat(254) })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('get_import_history', { itemId: '../bad' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('scan_unitypackage', { itemId: '123', packagePath: 'C:\\bad.unitypackage' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('scan_unitypackage', { itemId: '123', packagePath: '../bad.unitypackage' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('analyze_vpm_dependencies', { projectPath: 'relative' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('set_wishlist', { itemId: '123' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('add_to_booth_cart', { itemId: '123', variationName: '\u0000' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('apply_settings_profile', { profileName: '   ' })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('save_settings_profile', { profileName: 'a'.repeat(81) })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('update_settings', { patch: [] })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('update_settings', { patch: { nested: { a: { b: { c: { d: { e: { f: true } } } } } } } })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('update_settings', { patch: Object.create({ inherited: true }) })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(s.callTool('update_settings', { patch: { many: Array.from({ length: 201 }, () => 1) } })).rejects.toMatchObject({ code: 'invalid_arguments' });
});
