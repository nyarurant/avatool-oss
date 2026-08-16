const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, handler) {
  if (typeof handler !== 'function') return () => {};
  const wrapped = (_e, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

let lastFatalSignature = '';
let lastFatalAt = 0;

function serializeErrorDetails(value, depth = 0) {
  if (depth > 2) return '[depth-limited]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) return value.slice(0, 10).map((entry) => serializeErrorDetails(entry, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value).slice(0, 12)) {
      out[key] = serializeErrorDetails(entry, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  return String(value);
}

function reportRendererFatal(kind, payload = {}) {
  const now = Date.now();
  const body = {
    kind: String(kind || 'unknown'),
    href: (() => {
      try { return String(window.location?.href || ''); } catch { return ''; }
    })(),
    title: (() => {
      try { return String(document?.title || ''); } catch { return ''; }
    })(),
    timestamp: new Date(now).toISOString(),
    ...payload,
  };
  const signature = JSON.stringify([
    body.kind,
    body.message || '',
    body.filename || '',
    body.lineno || 0,
    body.colno || 0,
  ]);
  if (signature === lastFatalSignature && (now - lastFatalAt) < 1500) return;
  lastFatalSignature = signature;
  lastFatalAt = now;
  ipcRenderer.send('renderer-fatal-error', body);
}

window.addEventListener('error', (event) => {
  const source = String(event?.filename || '');
  if (!event?.error && source && !source.startsWith('file:')) return;
  // Skip resource load errors (img/video/audio/link elements)
  if (!event?.error && !event?.message) return;
  reportRendererFatal('error', {
    message: String(event?.message || event?.error?.message || 'Unknown renderer error'),
    filename: source,
    lineno: Number(event?.lineno || 0),
    colno: Number(event?.colno || 0),
    stack: String(event?.error?.stack || ''),
  });
}, true);

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  reportRendererFatal('unhandledrejection', {
    message: String(reason?.message || reason || 'Unhandled promise rejection'),
    reason: serializeErrorDetails(reason),
    stack: String(reason?.stack || ''),
  });
});

contextBridge.exposeInMainWorld('boothAPI', {
  loadAssets: () => ipcRenderer.invoke('load-assets'),
  loadAvatarAliases: () => ipcRenderer.invoke('load-avatar-aliases'),
  getStorageUsage: () => ipcRenderer.invoke('get-storage-usage'),
  prepareClient: () => ipcRenderer.invoke('prepare-client'),
  openItemFolder: (itemId, title) => ipcRenderer.invoke('open-item-folder', itemId, title),
  listItemFiles: (itemId, title) => ipcRenderer.invoke('list-item-files', itemId, title),
  openExtractedEntry: (itemId, title, relPath) => ipcRenderer.invoke('open-extracted-entry', itemId, title, relPath),
  prepareModelPreview: (itemId, title, relPath) => ipcRenderer.invoke('prepare-model-preview', itemId, title, relPath),
  bakeUnityAnimationPreview: (payload) => ipcRenderer.invoke('bake-unity-animation-preview', payload),
  readModelPreviewFile: (itemId, title, root, relPath) => ipcRenderer.invoke('read-model-preview-file', itemId, title, root, relPath),
  readModelPreviewVrcData: (itemId, title, root, prefabRelPath) => ipcRenderer.invoke(
    'read-model-preview-vrc-data', itemId, title, root, prefabRelPath
  ),
  startUnityPhysBonePreview: (payload) => ipcRenderer.invoke('start-unity-physbone-preview', payload),
  stopUnityPhysBonePreview: (sessionId = '') => ipcRenderer.invoke('stop-unity-physbone-preview', sessionId),
  onUnityPhysBoneFrame: (handler) => subscribe('unity-physbone-frame', handler),
  onUnityPhysBoneState: (handler) => subscribe('unity-physbone-state', handler),
  syncLibrary: (options) => ipcRenderer.invoke('sync-library', options),
  analyzeAvatarCompatibility: (options) => ipcRenderer.invoke('analyze-avatar-compatibility', options),
  confirmAvatarCompatibility: (itemId, avatarName, options = {}) => ipcRenderer.invoke('confirm-avatar-compatibility', {
    itemId,
    avatarName,
    reset: Boolean(options?.reset),
  }),
  enqueueDownloads: (assets) => ipcRenderer.invoke('enqueue-downloads', assets),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  checkAppUpdate: (manual = true) => ipcRenderer.invoke('check-app-update', { manual }),
  startAppUpdateDownload: () => ipcRenderer.invoke('start-app-update-download'),
  installAppUpdateNow: () => ipcRenderer.invoke('install-app-update-now'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppEdition: () => ipcRenderer.invoke('get-app-edition'),
  demoSimulateDownload: (payload) => ipcRenderer.invoke('demo-simulate-download', payload),
  demoSimulateUnityImport: () => ipcRenderer.invoke('demo-simulate-unity-import'),
  getOwnerVaultStatus: (remote = false) => ipcRenderer.invoke('owner-vault-status', { remote }),
  getOwnerStandardDataStatus: () => ipcRenderer.invoke('owner-standard-data-status'),
  importOwnerStandardData: () => ipcRenderer.invoke('owner-import-standard-data'),
  setupOwnerVault: (payload) => ipcRenderer.invoke('owner-vault-setup', payload),
  connectOwnerVault: (payload) => ipcRenderer.invoke('owner-vault-connect', payload),
  backupOwnerVault: (payload = {}) => ipcRenderer.invoke('owner-vault-backup', payload),
  restoreOwnerVault: (payload = {}) => ipcRenderer.invoke('owner-vault-restore', payload),
  onOwnerVaultProgress: (handler) => subscribe('owner-vault-progress', handler),
  notifyRendererReady: () => ipcRenderer.send('renderer-ready'),
  reportRendererFatalError: (kind, payload) => reportRendererFatal(kind, payload),
  getRendererRecoveryState: () => ipcRenderer.invoke('get-renderer-recovery-state'),
  reopenMainWindow: () => ipcRenderer.invoke('reopen-main-window'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  openRuntimeLogWindow: () => ipcRenderer.invoke('open-runtime-log-window'),
  markUpdateSeen: (itemId, files, expectedStableHash) => ipcRenderer.invoke('mark-update-seen', itemId, files, expectedStableHash),
  previewManualFreeAsset: (itemIdOrUrl) => ipcRenderer.invoke('preview-manual-free-asset', { itemIdOrUrl }),
  addManualFreeAsset: (itemIdOrUrl) => ipcRenderer.invoke('add-manual-free-asset', { itemIdOrUrl }),
  previewWishlistItem: (itemIdOrUrl) => ipcRenderer.invoke('preview-wishlist-item', { itemIdOrUrl }),
  toggleWishlist: (itemId, itemIdOrUrl) => ipcRenderer.invoke('toggle-wishlist', { itemId, itemIdOrUrl }),
  addWishlistItemToCart: (itemIdOrUrl, variationName) => ipcRenderer.invoke('add-wishlist-item-to-cart', { itemIdOrUrl, variationName }),
  fetchBoothCart: (shopSubdomain) => ipcRenderer.invoke('get-booth-cart', { shopSubdomain }),
  importBoothWishlist: () => ipcRenderer.invoke('import-booth-wishlist'),
  searchBooth: (query, opts = {}) => ipcRenderer.invoke('search-booth', { query, ...opts }),
  fetchBoothItemDetail: (itemId) => ipcRenderer.invoke('fetch-booth-item-detail', { itemId }),
  fetchBoothHome: (opts = {}) => ipcRenderer.invoke('fetch-booth-home', opts),
  fetchBoothRelatedItems: (itemId, opts = {}) => ipcRenderer.invoke('fetch-booth-related-items', { itemId, ...opts }),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  updateUserMeta: (itemId, patch) => ipcRenderer.invoke('update-user-meta', { itemId, patch }),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  getAgentIntegrationStatus: () => ipcRenderer.invoke('get-agent-integration-status'),
  setupAgentIntegration: () => ipcRenderer.invoke('setup-agent-integration'),
  runHealthCheck: (trigger = 'manual') => ipcRenderer.invoke('run-health-check', trigger),
  getOperationLogs: () => ipcRenderer.invoke('get-operation-logs'),
  clearOperationLogs: () => ipcRenderer.invoke('clear-operation-logs'),
  getRuntimeLogs: () => ipcRenderer.invoke('get-runtime-logs'),
  listSettingsProfiles: () => ipcRenderer.invoke('list-settings-profiles'),
  saveSettingsProfile: (profileName, profilePayload) => ipcRenderer.invoke('save-settings-profile', profileName, profilePayload),
  applySettingsProfile: (profileName) => ipcRenderer.invoke('apply-settings-profile', profileName),
  exportAppBundle: (exportPath, notifications = []) => ipcRenderer.invoke('export-app-bundle', { exportPath, notifications }),
  importAppBundle: (importPath) => ipcRenderer.invoke('import-app-bundle', { importPath }),
  listAutoBootstrapVariants: () => ipcRenderer.invoke('list-auto-bootstrap-variants'),
  listAutoBootstrapRuleChoices: () => ipcRenderer.invoke('list-auto-bootstrap-rule-choices'),
  loadCookieFile: (filePath) => ipcRenderer.invoke('load-cookie-file', filePath),
  openLoginWindow: () => ipcRenderer.invoke('open-login-window'),
  logoutSession: () => ipcRenderer.invoke('logout-session'),
  loadVCCProjects: () => ipcRenderer.invoke('load-vcc-projects'),
  importToUnity: (projectPath, packagePath, importMode = 'normal', packageMeta = null) => ipcRenderer.invoke('unity-import-package', {
    projectPath,
    packagePath,
    importMode,
    packageMeta: packageMeta && typeof packageMeta === 'object' ? packageMeta : null,
  }),
  prepareUnityProject: (projectPath) => ipcRenderer.invoke('prepare-unity-project', projectPath),
  importMultipleToUnity: (projectPath, packagePaths, importMode = 'normal') => ipcRenderer.invoke('unity-import-multiple', { projectPath, packagePaths, importMode }),
  importMultipleToUnityWithMeta: (projectPath, packages, importMode = 'normal') => ipcRenderer.invoke('unity-import-multiple-with-meta', { projectPath, packages, importMode }),
  openPackagesWithAssociation: (packagePaths, packages = null) => ipcRenderer.invoke('open-packages-with-association', {
    packagePaths,
    packages: Array.isArray(packages) ? packages : null,
  }),
  getRunningUnityProjects: () => ipcRenderer.invoke('get-running-unity-projects'),
  scanUnityPackage: (pkgPath, candidateTokens) => ipcRenderer.invoke('scan-unity-package', { pkgPath, candidateTokens }),
  analyzeImportToolDeps: (projectPath, packages) => ipcRenderer.invoke('analyze-import-tool-deps', { projectPath, packages }),
  importDryRun: (projectPath, packages = null, packagePaths = null) => ipcRenderer.invoke('unity-import-dry-run', {
    projectPath,
    packages: Array.isArray(packages) ? packages : null,
    packagePaths: Array.isArray(packagePaths) ? packagePaths : null,
  }),
  installImportToolDeps: (projectPath, tools) => ipcRenderer.invoke('install-import-tool-deps', { projectPath, tools }),
  getImportHistory: (itemId) => ipcRenderer.invoke('get-import-history', itemId),
  getProjectItems: (projectPath) => ipcRenderer.invoke('get-project-items', projectPath),
  reconcileImports: (projectPath, packages, persistMatched, threshold) => ipcRenderer.invoke('reconcile-imports', { projectPath, packages, persistMatched, threshold }),
  stopQueue: () => ipcRenderer.invoke('stop-queue'),
  resumeQueue: () => ipcRenderer.invoke('resume-queue'),
  retryFailed: () => ipcRenderer.invoke('retry-failed'),
  extractItem: (itemId, title, force) => ipcRenderer.invoke('extract-item', itemId, title, force),

  onMetaProgress: (handler) => {
    return subscribe('meta-progress', handler);
  },

  onDownloadProgress: (handler) => {
    return subscribe('download-progress', handler);
  },
  onUnityImportProgress: (handler) => {
    return subscribe('unity-import-progress', handler);
  },
  onQueueStatus: (handler) => {
    return subscribe('download-queue', handler);
  },
  onUpdateNotification: (handler) => {
    return subscribe('update-notification', handler);
  },
  onAppUpdateStatus: (handler) => {
    return subscribe('app-update-status', handler);
  },
  onVccProjectsUpdated: (handler) => {
    return subscribe('vcc-projects-updated', handler);
  },
  onAssetsRefreshed: (handler) => {
    return subscribe('assets-refreshed', handler);
  },
  onWishlistImportProgress: (handler) => {
    return subscribe('wishlist-import-progress', handler);
  },
  onAutoBootstrapStatus: (handler) => {
    return subscribe('auto-bootstrap-status', handler);
  },
  onOperationLog: (handler) => {
    return subscribe('operation-log', handler);
  },
  onHealthCheckReport: (handler) => {
    return subscribe('health-check-report', handler);
  },
  onZipOversizeConfirmRequest: (handler) => {
    return subscribe('zip-oversize-confirm-request', handler);
  },
  respondZipOversizeConfirm: (requestId, allow) => ipcRenderer.invoke('respond-zip-oversize-confirm', {
    requestId,
    allow: Boolean(allow),
  }),
  onArchivePasswordRequired: (handler) => {
    return subscribe('archive-password-required', handler);
  },
  respondArchivePassword: (requestId, password, cancelled = false) => ipcRenderer.invoke('respond-archive-password', {
    requestId,
    password: password || '',
    cancelled: Boolean(cancelled),
  }),

  downloadItem: (asset) => ipcRenderer.invoke('download-item', asset),
  collectUnitypackages: (assets) => ipcRenderer.invoke('collect-unitypackages', assets),
});

contextBridge.exposeInMainWorld('logger', {
  log: (msg, data) => ipcRenderer.send('renderer-log', { level: 'log', msg, data }),
  warn: (msg, data) => ipcRenderer.send('renderer-log', { level: 'warn', msg, data }),
  error: (msg, data) => ipcRenderer.send('renderer-log', { level: 'error', msg, data }),
});
