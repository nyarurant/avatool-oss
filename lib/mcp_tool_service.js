'use strict';

// Application-facing MCP tool dispatcher.  The transport is deliberately kept
// elsewhere so this module can be exercised without Electron.

const TOOL_NAMES = Object.freeze([
  'avatool_status',
  'list_assets',
  'get_asset',
  'search_assets',
  'list_unity_projects',
  'sync_library',
  'download_item',
  'import_asset_to_unity',
  'get_download_queue',
  'get_settings',
  'get_operation_logs',
  'run_health_check',
  'get_storage_usage',
  'list_item_files',
  'list_unitypackages',
  'get_project_items',
  'search_booth',
  'get_booth_item',
  'list_bootstrap_choices',
  'control_download_queue',
  'extract_item',
  'install_vpm_dependencies',
  'run_auto_bootstrap',
  'get_booth_cart',
  'list_settings_profiles',
  'get_import_history',
  'scan_unitypackage',
  'analyze_vpm_dependencies',
  'get_runtime_logs',
  'check_app_update',
  'set_wishlist',
  'import_booth_wishlist',
  'add_to_booth_cart',
  'update_settings',
  'apply_settings_profile',
  'save_settings_profile',
  'clear_operation_logs',
]);

const SECRET_KEY = /(?:cookie|token|secret|password|passwd|authorization|csrf|credential|session)/i;

function invalid(message) {
  const error = new Error(message);
  error.code = 'invalid_arguments';
  throw error;
}

function objectArgs(args) {
  if (args === undefined) return {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) invalid('arguments must be an object');
  return args;
}

function itemId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.trim())) {
    invalid('itemId must contain only letters, numbers, underscore, or hyphen');
  }
  return value.trim();
}

function query(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) invalid('query must be a safe string of at most 200 characters');
  return value.trim();
}

function limit(value, fallback = 50) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) invalid('limit must be an integer between 1 and 1000');
  return value;
}

function page(value, fallback = 1) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) invalid('page must be an integer between 1 and 100');
  return value;
}

function sort(value, fallback = 'new_arrivals') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[a-z_]{1,32}$/.test(value)) invalid('sort must contain only lowercase letters and underscores');
  return value;
}

function projectPath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) invalid('projectPath must be a safe path');
  const p = value.trim();
  if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(p)) invalid('projectPath must be absolute');
  return p;
}

function shopSubdomain(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') invalid('shopSubdomain must be a safe shop subdomain');
  const subdomain = value.trim();
  if (subdomain.length > 253 || !/^(?:[a-z0-9.-]+)?$/.test(subdomain)) invalid('shopSubdomain must contain only lowercase letters, numbers, hyphen, or dot');
  return subdomain;
}

function optionalSafeString(value, name, maxLength) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) invalid(`${name} must be a safe string of at most ${maxLength} characters`);
  return value.trim();
}

function profileName(value) {
  const name = optionalSafeString(value, 'profileName', 80);
  if (!name) invalid('profileName must be a non-empty safe string');
  return name;
}

function optionalRelativePath(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) invalid('packagePath must be a safe relative path');
  const packagePath = value.trim();
  if (!packagePath) return '';
  if (/^(?:[A-Za-z]:|[\\/])/.test(packagePath) || packagePath.split(/[\\/]+/).includes('..')) invalid('packagePath must be relative and must not traverse parent directories');
  return packagePath;
}

const MAX_PATCH_DEPTH = 6;
const MAX_PATCH_KEYS = 100;
const MAX_PATCH_ARRAY_ITEMS = 200;
const MAX_PATCH_STRING_CHARS = 20_000;

function settingsPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    invalid('patch must be a plain object');
  }
  let keyCount = 0;
  let stringChars = 0;
  const walk = (node, depth) => {
    if (depth > MAX_PATCH_DEPTH) invalid(`patch must not exceed ${MAX_PATCH_DEPTH} nested levels`);
    if (node === null || typeof node === 'boolean') return;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) invalid('patch must contain JSON-compatible values');
      return;
    }
    if (typeof node === 'string') {
      stringChars += node.length;
      if (stringChars > MAX_PATCH_STRING_CHARS) invalid(`patch strings must not exceed ${MAX_PATCH_STRING_CHARS} characters total`);
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > MAX_PATCH_ARRAY_ITEMS) invalid(`patch arrays must contain at most ${MAX_PATCH_ARRAY_ITEMS} items`);
      node.forEach((child) => walk(child, depth + 1));
      return;
    }
    if (!node || typeof node !== 'object' || (Object.getPrototypeOf(node) !== Object.prototype && Object.getPrototypeOf(node) !== null)) invalid('patch must contain JSON-compatible values');
    for (const [key, child] of Object.entries(node)) {
      keyCount += 1;
      stringChars += key.length;
      if (key.length > 128 || /[\u0000-\u001f\u007f]/.test(key)) invalid('patch keys must be safe strings of at most 128 characters');
      if (keyCount > MAX_PATCH_KEYS) invalid(`patch must contain at most ${MAX_PATCH_KEYS} keys`);
      if (stringChars > MAX_PATCH_STRING_CHARS) invalid(`patch strings must not exceed ${MAX_PATCH_STRING_CHARS} characters total`);
      walk(child, depth + 1);
    }
  };
  walk(value, 0);
  return value;
}

function enumValue(value, values, name) {
  if (!values.includes(value)) invalid(`${name} must be one of: ${values.join(', ')}`);
  return value;
}

function optionalBoolean(value, name, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') invalid(`${name} must be a boolean`);
  return value;
}

function requiredBoolean(value, name) {
  if (typeof value !== 'boolean') invalid(`${name} must be a boolean`);
  return value;
}

function invoke(deps, name, ...args) {
  if (typeof deps[name] !== 'function') throw new Error(`${name} is unavailable`);
  return deps[name](...args);
}

function serializable(value, depth = 0, seen = new WeakSet()) {
  if (depth > 8) return '[truncated]';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 1000).map((v) => serializable(v, depth + 1, seen)).filter((v) => v !== undefined);
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    const clean = serializable(child, depth + 1, seen);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

function assetsFrom(metaMgr) {
  const cache = typeof metaMgr?.getMetaCache === 'function' ? metaMgr.getMetaCache() : [];
  if (Array.isArray(cache)) return cache;
  if (cache && typeof cache === 'object') return Object.values(cache);
  return [];
}

function createMcpToolService(deps = {}) {
  const { metaMgr, settingsMgr, unityMgr, queueMgr } = deps;
  const getAssets = () => assetsFrom(metaMgr);
  const findAsset = (id) => getAssets().find((asset) => String(asset?.itemId || '') === id);

  async function callTool(name, rawArgs) {
    if (!TOOL_NAMES.includes(name)) {
      const error = new Error(`unknown MCP tool: ${String(name)}`);
      error.code = 'unknown_tool';
      throw error;
    }
    const args = objectArgs(rawArgs);
    let result;
    switch (name) {
      case 'avatool_status': {
        const settings = typeof settingsMgr?.getSettings === 'function' ? settingsMgr.getSettings() : {};
        const queue = typeof queueMgr?.getQueueStatus === 'function' ? queueMgr.getQueueStatus() : queueMgr?.getQueueState?.();
        result = { ok: true, version: deps.appVersion || deps.version || null, assetCount: getAssets().length, queue, settings: {
          unityProjects: Array.isArray(settings?.unityProjects) ? settings.unityProjects.map((p) => ({ name: p?.name, path: p?.path })) : [],
          autoDownload: settings?.autoDownload,
        } };
        break;
      }
      case 'list_assets': {
        const max = limit(args.limit);
        const q = query(args.query).toLocaleLowerCase();
        const filtered = getAssets().filter((asset) => !q || [asset?.itemId, asset?.name, asset?.itemName, asset?.shopName, asset?.authorName, asset?.authorShopUrl, asset?.imageUrl, asset?.url].some((v) => String(v || '').toLocaleLowerCase().includes(q)));
        result = { total: filtered.length, returned: Math.min(filtered.length, max), items: filtered.slice(0, max) };
        break;
      }
      case 'get_asset': {
        const asset = findAsset(itemId(args.itemId));
        result = asset ? { found: true, item: asset } : { found: false, item: null };
        break;
      }
      case 'search_assets': {
        const q = query(args.query).toLocaleLowerCase();
        const max = limit(args.limit);
        const filtered = getAssets().filter((asset) => !q || [asset?.itemId, asset?.name, asset?.itemName, asset?.shopName, asset?.creatorName, asset?.authorName, asset?.authorShopUrl, asset?.imageUrl, asset?.url].some((v) => String(v || '').toLocaleLowerCase().includes(q)));
        result = { query: q, total: filtered.length, returned: Math.min(filtered.length, max), items: filtered.slice(0, max) };
        break;
      }
      case 'list_unity_projects': {
        const settings = typeof settingsMgr?.getSettings === 'function' ? settingsMgr.getSettings() : {};
        const registered = Array.isArray(settings?.unityProjects) ? settings.unityProjects.map((p) => typeof p === 'string' ? { name: '', path: p } : p).filter((p) => p && typeof p.path === 'string') : [];
        const running = typeof unityMgr?.listRunningUnityProjectPaths === 'function' ? await unityMgr.listRunningUnityProjectPaths() : [];
        const runningSet = new Set((Array.isArray(running) ? running : []).map((p) => String(p).toLowerCase()));
        result = { projects: registered.map((p) => ({ name: p?.name, path: p?.path, running: runningSet.has(String(p.path).toLowerCase()) })) };
        break;
      }
      case 'sync_library':
        if (typeof deps.syncLibrary !== 'function') throw new Error('sync_library is unavailable');
        result = await deps.syncLibrary({ fullRescan: args.fullRescan === true });
        break;
      case 'download_item': {
        const asset = findAsset(itemId(args.itemId));
        if (!asset) { result = { ok: false, error: 'item_not_found' }; break; }
        if (typeof deps.enqueueDownload !== 'function') throw new Error('download_item is unavailable');
        result = await deps.enqueueDownload(asset);
        break;
      }
      case 'import_asset_to_unity': {
        const id = itemId(args.itemId);
        const target = projectPath(args.projectPath);
        if (args.importMode !== undefined && args.importMode !== 'background' && args.importMode !== 'live') invalid('importMode must be background or live');
        if (typeof deps.importAssetToUnity !== 'function') throw new Error('import_asset_to_unity is unavailable');
        result = await deps.importAssetToUnity({ itemId: id, projectPath: target, importMode: args.importMode });
        break;
      }
      case 'get_download_queue':
        result = typeof queueMgr?.getQueueStatus === 'function' ? queueMgr.getQueueStatus() : queueMgr?.getQueueState?.();
        break;
      case 'get_settings':
        result = typeof settingsMgr?.getSettings === 'function' ? settingsMgr.getSettings() : {};
        break;
      case 'get_operation_logs': {
        const max = limit(args.limit);
        const rows = await invoke(deps, 'getOperationLogs', max);
        const logs = Array.isArray(rows) ? rows : (rows && Array.isArray(rows.logs) ? rows.logs : []);
        result = { logs, returned: logs.length };
        break;
      }
      case 'run_health_check':
        result = await invoke(deps, 'runHealthCheck');
        break;
      case 'get_storage_usage':
        result = await invoke(deps, 'getStorageUsage');
        break;
      case 'list_item_files':
        result = await invoke(deps, 'listItemFiles', { itemId: itemId(args.itemId), limit: limit(args.limit) });
        break;
      case 'list_unitypackages':
        result = await invoke(deps, 'listUnityPackages', { itemId: itemId(args.itemId) });
        break;
      case 'get_project_items':
        result = await invoke(deps, 'getProjectItems', { projectPath: projectPath(args.projectPath) });
        break;
      case 'search_booth': {
        const boothArgs = {
          query: query(args.query),
          page: page(args.page),
          sort: sort(args.sort),
        };
        result = await invoke(deps, 'searchBooth', boothArgs);
        break;
      }
      case 'get_booth_item':
        result = await invoke(deps, 'getBoothItem', { itemId: itemId(args.itemId) });
        break;
      case 'list_bootstrap_choices':
        result = await invoke(deps, 'listBootstrapChoices');
        break;
      case 'control_download_queue':
        result = await invoke(deps, 'controlDownloadQueue', { action: enumValue(args.action, ['stop', 'resume', 'retry_failed'], 'action') });
        break;
      case 'extract_item':
        result = await invoke(deps, 'extractItem', { itemId: itemId(args.itemId), force: optionalBoolean(args.force, 'force') });
        break;
      case 'install_vpm_dependencies':
        {
          const modularAvatar = optionalBoolean(args.modularAvatar, 'modularAvatar');
          const liltoon = optionalBoolean(args.liltoon, 'liltoon');
          if (!modularAvatar && !liltoon) invalid('select at least one dependency');
          result = await invoke(deps, 'installVpmDependencies', {
          projectPath: projectPath(args.projectPath),
            modularAvatar,
            liltoon,
          });
        }
        break;
      case 'run_auto_bootstrap':
        result = await invoke(deps, 'runAutoBootstrap', { projectPath: projectPath(args.projectPath) });
        break;
      case 'get_booth_cart':
        result = await invoke(deps, 'getBoothCart', { shopSubdomain: shopSubdomain(args.shopSubdomain) });
        break;
      case 'list_settings_profiles':
        result = await invoke(deps, 'listSettingsProfiles');
        break;
      case 'get_import_history':
        result = await invoke(deps, 'getImportHistory', {
          itemId: args.itemId === undefined ? undefined : itemId(args.itemId),
          limit: limit(args.limit),
        });
        break;
      case 'scan_unitypackage':
        result = await invoke(deps, 'scanUnitypackage', {
          itemId: itemId(args.itemId),
          packagePath: optionalRelativePath(args.packagePath),
        });
        break;
      case 'analyze_vpm_dependencies':
        result = await invoke(deps, 'analyzeVpmDependencies', {
          projectPath: projectPath(args.projectPath),
          itemId: args.itemId === undefined ? undefined : itemId(args.itemId),
        });
        break;
      case 'get_runtime_logs':
        result = await invoke(deps, 'getRuntimeLogs', { limit: limit(args.limit) });
        break;
      case 'check_app_update':
        result = await invoke(deps, 'checkAppUpdate');
        break;
      case 'set_wishlist':
        result = await invoke(deps, 'setWishlist', { itemId: itemId(args.itemId), wishlisted: requiredBoolean(args.wishlisted, 'wishlisted') });
        break;
      case 'import_booth_wishlist':
        result = await invoke(deps, 'importBoothWishlist');
        break;
      case 'add_to_booth_cart':
        result = await invoke(deps, 'addToBoothCart', {
          itemId: itemId(args.itemId),
          variationName: optionalSafeString(args.variationName, 'variationName', 200),
        });
        break;
      case 'update_settings':
        result = await invoke(deps, 'updateSettings', { patch: settingsPatch(args.patch) });
        break;
      case 'apply_settings_profile':
        result = await invoke(deps, 'applySettingsProfile', { profileName: profileName(args.profileName) });
        break;
      case 'save_settings_profile':
        result = await invoke(deps, 'saveSettingsProfile', { profileName: profileName(args.profileName) });
        break;
      case 'clear_operation_logs':
        result = await invoke(deps, 'clearOperationLogs');
        break;
    }
    return serializable(result);
  }

  return { allowedTools: TOOL_NAMES, callTool };
}

module.exports = { createMcpToolService, TOOL_NAMES, serializable };
