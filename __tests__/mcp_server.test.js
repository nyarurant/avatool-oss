'use strict';

const { assertConfirmation, callBridge, createBridgeRequest, defaultEndpointPath, readEndpointConfig } = require('../mcp/client');
const { TOOL_SPECS, TOOL_ANNOTATIONS, jsonSchema, zodRawShape, toolResult, registerTools, createServer } = require('../mcp/server');

describe('Avatool MCP bridge', () => {
  test('uses the Windows AppData endpoint path', () => {
    expect(defaultEndpointPath({ APPDATA: 'C:\\Users\\test\\AppData\\Roaming' })).toBe('C:\\Users\\test\\AppData\\Roaming\\avatool\\data\\mcp-endpoint.json');
  });

  test('validates and normalizes the endpoint configuration', () => {
    const config = readEndpointConfig('ignored', () => JSON.stringify({ endpoint: 'http://127.0.0.1:4567/call', token: 'secret' }));
    expect(config.url).toBe('http://127.0.0.1:4567/call');
    expect(config.token).toBe('secret');
  });

  test('gives a clear error when Avatool is not running', () => {
    expect(() => readEndpointConfig('missing', () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    })).toThrow('Avatool is not running; start Avatool and retry');
  });

  test('accepts the legacy url configuration key', () => {
    expect(readEndpointConfig('ignored', () => JSON.stringify({ url: 'http://127.0.0.1:4567/call', token: 'legacy-token' })).url)
      .toBe('http://127.0.0.1:4567/call');
  });

  test.each([
    'https://127.0.0.1:4567/call',
    'http://localhost:4567/call',
    'http://192.168.1.10:4567/call',
    'http://127.0.0.1/call',
    'http://127.0.0.1:0/call',
    'http://127.0.0.1:4567/other',
    'http://user:pass@127.0.0.1:4567/call',
    'http://127.0.0.1:4567/call?redirect=https://example.test',
    'http://127.0.0.1:4567/call?',
    'http://127.0.0.1:4567/call#fragment',
    'http://127.0.0.1:4567/call#',
  ])('rejects unsafe endpoint configuration: %s', (endpoint) => {
    expect(() => readEndpointConfig('ignored', () => JSON.stringify({ endpoint, token: 'secret' })))
      .toThrow('endpoint must be http://127.0.0.1:<port>/call');
  });

  test('rejects endpoint configurations without an authentication token', () => {
    expect(() => readEndpointConfig('ignored', () => JSON.stringify({ endpoint: 'http://127.0.0.1:4567/call' })))
      .toThrow('token is required');
    expect(() => readEndpointConfig('ignored', () => JSON.stringify({ endpoint: 'http://127.0.0.1:4567/call', token: '   ' })))
      .toThrow('token is required');
  });

  test('creates token-bearing JSON bridge request', () => {
    const request = createBridgeRequest({ url: 'http://localhost:1', token: 'abc' }, 'get_asset', { itemId: '42' });
    expect(request.options.headers.authorization).toBe('Bearer abc');
    expect(JSON.parse(request.options.body)).toEqual({ tool: 'get_asset', args: { itemId: '42' } });
  });

  test('aborts an overdue bridge request and clears its timeout', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    try {
      const pending = callBridge(
        { url: 'http://127.0.0.1:4567/call', token: 'secret', timeoutMs: 1_000 },
        'get_asset',
        {},
        (_url, options) => new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
      );
      const rejected = expect(pending).rejects.toThrow('get_asset timed out after 1000ms');
      await jest.advanceTimersByTimeAsync(1_000);
      await rejected;
      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  test('requires confirmation for mutating tools', () => {
    expect(() => assertConfirmation('download_item', {})).toThrow('confirm:true');
    expect(() => assertConfirmation('download_item', { confirm: true })).not.toThrow();
    expect(() => assertConfirmation('get_asset', {})).not.toThrow();
    for (const name of ['control_download_queue', 'extract_item', 'install_vpm_dependencies', 'run_auto_bootstrap']) {
      expect(() => assertConfirmation(name, {})).toThrow('confirm:true');
      expect(() => assertConfirmation(name, { confirm: true })).not.toThrow();
    }
    for (const name of ['set_wishlist', 'import_booth_wishlist', 'add_to_booth_cart', 'update_settings', 'apply_settings_profile', 'save_settings_profile', 'clear_operation_logs']) {
      expect(() => assertConfirmation(name, {})).toThrow('confirm:true');
      expect(() => assertConfirmation(name, { confirm: true })).not.toThrow();
    }
  });

  test('declares required fields for tool inputs', () => {
    const fields = Object.fromEntries(TOOL_SPECS.map(([name, , properties]) => [name, Object.keys(properties).filter((key) => !properties[key].optional)]));
    expect(fields.get_asset).toEqual(['itemId']);
    expect(fields.search_assets).toEqual(['query']);
    expect(fields.sync_library).toEqual(['confirm']);
    expect(fields.download_item).toEqual(['itemId', 'confirm']);
    expect(fields.import_asset_to_unity).toEqual(['itemId', 'projectPath', 'confirm']);
    expect(fields.get_download_queue).toEqual([]);
    expect(fields.list_item_files).toEqual(['itemId']);
    expect(fields.list_unitypackages).toEqual(['itemId']);
    expect(fields.get_project_items).toEqual(['projectPath']);
    expect(fields.search_booth).toEqual(['query']);
    expect(fields.control_download_queue).toEqual(['action', 'confirm']);
    expect(fields.extract_item).toEqual(['itemId', 'confirm']);
    expect(fields.install_vpm_dependencies).toEqual(['projectPath', 'confirm']);
    expect(fields.run_auto_bootstrap).toEqual(['projectPath', 'confirm']);
    expect(fields.get_booth_cart).toEqual([]);
    expect(fields.get_import_history).toEqual([]);
    expect(fields.scan_unitypackage).toEqual(['itemId']);
    expect(fields.analyze_vpm_dependencies).toEqual(['projectPath']);
    expect(fields.set_wishlist).toEqual(['itemId', 'wishlisted', 'confirm']);
    expect(fields.import_booth_wishlist).toEqual(['confirm']);
    expect(fields.add_to_booth_cart).toEqual(['itemId', 'confirm']);
    expect(fields.update_settings).toEqual(['patch', 'confirm']);
    expect(fields.apply_settings_profile).toEqual(['profileName', 'confirm']);
    expect(fields.save_settings_profile).toEqual(['profileName', 'confirm']);
    expect(fields.clear_operation_logs).toEqual(['confirm']);
  });

  test('registers all public tools and strips confirm from bridge params', async () => {
    const registered = new Map();
    const fakeServer = { tool(name, description, schema, handler) { registered.set(name, { description, schema, handler }); } };
    const calls = [];
    registerTools(fakeServer, { url: 'http://localhost:1' }, async (...args) => { calls.push(args); return { ok: true }; });
    expect([...registered.keys()]).toEqual(TOOL_SPECS.map(([name]) => name));
    await registered.get('download_item').handler({ itemId: '42', confirm: true });
    expect(calls[0][2]).toEqual({ itemId: '42' });
    expect(jsonSchema({}).additionalProperties).toBe(false);
    expect(registered.get('import_asset_to_unity').schema.properties.importMode).toEqual({ type: 'string' });
    expect(registered.get('sync_library').schema.properties.fullRescan).toEqual({ type: 'boolean' });
    expect(registered.get('update_settings').schema.properties.patch).toEqual({ type: 'object' });
    expect(registered.has('run_auto_bootstrap')).toBe(true);
    expect(registered.has('clear_operation_logs')).toBe(true);
  });

  test('loads endpoint configuration only when a tool is called', async () => {
    const registered = new Map();
    const fakeServer = { tool(name, description, schema, handler) { registered.set(name, handler); } };
    let loads = 0;
    const calls = [];
    registerTools(fakeServer, undefined, async (...args) => { calls.push(args); return { ok: true }; }, () => {
      loads += 1;
      return { url: 'http://localhost:1', token: 'lazy' };
    });
    expect(loads).toBe(0);
    await registered.get('avatool_status')({});
    expect(loads).toBe(1);
    expect(calls[0][0]).toEqual({ url: 'http://localhost:1', token: 'lazy' });
  });

  test('creates a real SDK server when the SDK is installed', async () => {
    let sdk;
    try {
      sdk = await import('@modelcontextprotocol/sdk/server/mcp.js');
      require('zod');
    } catch {
      return;
    }
    const server = await createServer({ config: { url: 'http://localhost:1' }, bridge: async () => ({ ok: true }) });
    expect(server).toBeInstanceOf(sdk.McpServer);
    const registeredNames = Object.keys(server._registeredTools || {});
    if (registeredNames.length) expect(registeredNames).toEqual(TOOL_SPECS.map(([name]) => name));
  });

  test('marks read-only and destructive operations for MCP clients', () => {
    expect(TOOL_ANNOTATIONS.get_settings.readOnlyHint).toBe(true);
    expect(TOOL_ANNOTATIONS.list_unitypackages.readOnlyHint).toBe(true);
    expect(TOOL_ANNOTATIONS.extract_item.destructiveHint).toBe(true);
    expect(TOOL_ANNOTATIONS.install_vpm_dependencies.destructiveHint).toBe(true);
    for (const name of ['get_booth_cart', 'list_settings_profiles', 'get_import_history', 'scan_unitypackage', 'analyze_vpm_dependencies', 'get_runtime_logs']) {
      expect(TOOL_ANNOTATIONS[name].readOnlyHint).toBe(true);
    }
    expect(TOOL_ANNOTATIONS.check_app_update.destructiveHint).toBe(false);
    for (const name of ['set_wishlist', 'import_booth_wishlist', 'add_to_booth_cart', 'update_settings', 'apply_settings_profile', 'save_settings_profile']) {
      expect(TOOL_ANNOTATIONS[name].destructiveHint).toBe(false);
    }
    expect(TOOL_ANNOTATIONS.clear_operation_logs.destructiveHint).toBe(true);
  });

  test('accepts object-shaped settings patches in the real SDK schema', () => {
    let z;
    try { ({ z } = require('zod')); } catch { return; }
    const shape = zodRawShape({ patch: { type: 'object' } });
    expect(z.object(shape).parse({ patch: { theme: 'dark', nested: { enabled: true } } })).toEqual({ patch: { theme: 'dark', nested: { enabled: true } } });
    expect(() => z.object(shape).parse({ patch: ['not-an-object'] })).toThrow();
  });

  test('normalizes structuredContent to an object without changing content text', () => {
    expect(toolResult({ ok: true }).structuredContent).toEqual({ ok: true });
    expect(toolResult([1, 2]).structuredContent).toEqual({ value: [1, 2] });
    expect(toolResult('ready').structuredContent).toEqual({ value: 'ready' });
    expect(toolResult(null).structuredContent).toEqual({ value: null });
    expect(JSON.parse(toolResult([1, 2]).content[0].text)).toEqual([1, 2]);
  });

  test('real SDK registered call accepts an array bridge result', async () => {
    let sdk;
    try { sdk = await import('@modelcontextprotocol/sdk/server/mcp.js'); require('zod'); } catch { return; }
    const server = await createServer({ config: { url: 'http://localhost:1' }, bridge: async () => ['item-1', 'item-2'] });
    expect(server).toBeInstanceOf(sdk.McpServer);
    const response = await server._registeredTools.avatool_status.handler({});
    expect(response.structuredContent).toEqual({ value: ['item-1', 'item-2'] });
    expect(JSON.parse(response.content[0].text)).toEqual(['item-1', 'item-2']);
  });

  test('real SDK mutating handlers reject confirm:false before calling the bridge', async () => {
    let sdk;
    try { sdk = await import('@modelcontextprotocol/sdk/server/mcp.js'); require('zod'); } catch { return; }
    const bridge = jest.fn(async () => ({ ok: true }));
    const server = await createServer({ config: { url: 'http://localhost:1' }, bridge });
    expect(server).toBeInstanceOf(sdk.McpServer);

    await expect(server._registeredTools.set_wishlist.handler({ itemId: '42', wishlisted: true, confirm: false }))
      .rejects.toThrow('set_wishlist requires confirm:true');
    await expect(server._registeredTools.update_settings.handler({ patch: { libraryPath: 'C:\\safe' }, confirm: false }))
      .rejects.toThrow('update_settings requires confirm:true');
    await expect(server._registeredTools.clear_operation_logs.handler({ confirm: false }))
      .rejects.toThrow('clear_operation_logs requires confirm:true');
    expect(bridge).not.toHaveBeenCalled();
  });
});
