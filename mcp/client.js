'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BRIDGE_TIMEOUT_MS = 120_000;
const LONG_RUNNING_BRIDGE_TIMEOUT_MS = 10 * 60 * 1_000;
const UNITY_IMPORT_BRIDGE_TIMEOUT_MS = 35 * 60 * 1_000;
const MIN_BRIDGE_TIMEOUT_MS = 1_000;
const MAX_BRIDGE_TIMEOUT_MS = UNITY_IMPORT_BRIDGE_TIMEOUT_MS;
const LONG_RUNNING_TOOLS = new Set([
  'sync_library', 'download_item', 'extract_item', 'install_vpm_dependencies',
  'run_auto_bootstrap', 'scan_unitypackage', 'analyze_vpm_dependencies',
]);

function defaultEndpointPath(env = process.env) {
  const appData = env.APPDATA || path.join(env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(appData, 'avatool', 'data', 'mcp-endpoint.json');
}

function readEndpointConfig(filePath = defaultEndpointPath(), readFile = fs.readFileSync) {
  let raw;
  try {
    raw = readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('Avatool is not running; start Avatool and retry', { cause: error });
    }
    throw error;
  }
  const config = JSON.parse(raw);
  const endpoint = config && typeof config === 'object' ? (config.endpoint || config.url) : null;
  if (!config || typeof config !== 'object' || typeof endpoint !== 'string' || !endpoint) {
    throw new Error('Invalid Avatool MCP endpoint configuration: endpoint is required');
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Invalid Avatool MCP endpoint configuration: endpoint must be absolute');
  }
  if (
    url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
    !/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65_535 ||
    url.pathname !== '/call' || url.username || url.password || url.search || url.hash || /[?#]/.test(endpoint) ||
    endpoint !== url.toString()
  ) {
    throw new Error('Invalid Avatool MCP endpoint configuration: endpoint must be http://127.0.0.1:<port>/call');
  }
  if (typeof config.token !== 'string' || !config.token.trim()) {
    throw new Error('Invalid Avatool MCP endpoint configuration: token is required');
  }
  return { ...config, url: url.toString() };
}

function assertConfirmation(toolName, args = {}) {
  const mutating = new Set([
    'sync_library', 'download_item', 'import_asset_to_unity',
    'control_download_queue', 'extract_item', 'install_vpm_dependencies', 'run_auto_bootstrap',
    'set_wishlist', 'import_booth_wishlist', 'add_to_booth_cart',
    'update_settings', 'apply_settings_profile', 'save_settings_profile', 'clear_operation_logs',
  ]);
  if (mutating.has(toolName) && args.confirm !== true) {
    throw new Error(`${toolName} requires confirm:true`);
  }
}

function createBridgeRequest(config, method, params = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  return {
    url: config.url,
    options: {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool: method, args: params }),
    },
  };
}

function defaultBridgeTimeoutMs(method) {
  if (method === 'import_asset_to_unity') return UNITY_IMPORT_BRIDGE_TIMEOUT_MS;
  if (LONG_RUNNING_TOOLS.has(method)) return LONG_RUNNING_BRIDGE_TIMEOUT_MS;
  return DEFAULT_BRIDGE_TIMEOUT_MS;
}

function bridgeTimeoutMs(config, method) {
  const configured = Number(config && config.timeoutMs);
  if (Number.isFinite(configured) && configured >= MIN_BRIDGE_TIMEOUT_MS && configured <= MAX_BRIDGE_TIMEOUT_MS) {
    return Math.floor(configured);
  }
  return defaultBridgeTimeoutMs(method);
}

async function callBridge(config, method, params = {}, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable; Node 18+ is required');
  const AbortControllerImpl = globalThis.AbortController;
  if (typeof AbortControllerImpl !== 'function') throw new Error('AbortController is unavailable; Node 18+ is required');
  const request = createBridgeRequest(config, method, params);
  const timeoutMs = bridgeTimeoutMs(config, method);
  const controller = new AbortControllerImpl();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (timeout && typeof timeout.unref === 'function') timeout.unref();
  try {
    const response = await fetchImpl(request.url, { ...request.options, signal: controller.signal });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      const detail = body && typeof body === 'object' && body.error ? body.error : response.statusText;
      throw new Error(`Avatool bridge returned HTTP ${response.status}: ${detail || 'request failed'}`);
    }
    if (body && body.error) throw new Error(String(body.error));
    return body && Object.prototype.hasOwnProperty.call(body, 'result') ? body.result : body;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Avatool bridge request for ${method} timed out after ${timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { defaultEndpointPath, readEndpointConfig, assertConfirmation, createBridgeRequest, callBridge, defaultBridgeTimeoutMs, bridgeTimeoutMs };
