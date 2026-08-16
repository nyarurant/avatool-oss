const { app, BrowserWindow, ipcMain, shell, session, Notification, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { safeStorage } = require('electron');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const axios = require('axios');
const cheerio = require('cheerio');
const { pathToFileURL, fileURLToPath } = require('url');
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const { Worker } = require('worker_threads');
const { createUnityEditorSupport } = require('./lib/unity_editor_support');
const { createAutoBootstrapService } = require('./lib/autobootstrap_service');
const { createVccSyncService } = require('./lib/vcc_sync_service');
const { registerIpcHandlers } = require('./lib/ipc_handlers');
const { createLogManager } = require('./lib/log_manager');
const { createSettingsManager } = require('./lib/settings_manager');
const { createAppUpdater } = require('./lib/app_updater');
const { createUnityManager } = require('./lib/unity_manager');
const { createVpmManager } = require('./lib/vpm_manager');
const { createMetaManager } = require('./lib/meta_manager');
const { createWishlistService } = require('./lib/wishlist_service');
const { createDesktopNotifications } = require('./lib/desktop_notifications');
const { createBoothCartService } = require('./lib/booth_cart_service');
const { createBoothItemEnrichment } = require('./lib/booth_item_enrichment');
const { createUiProbeService } = require('./lib/ui_probe_service');
const { createDownloadQueue } = require('./lib/download_queue');
const { ensureWindowsStartupRegistration, setupSingleInstanceLock, runBoothSmokeTest } = require('./lib/app_bootstrap');
const { resolveExportBundlePath: resolveExportBundlePathImpl } = require('./lib/export_bundle');
const { createBoothSessionManager } = require('./lib/booth_session_manager');
const { createLoginWindow } = require('./lib/login_window');
const { createStorageManager } = require('./lib/storage_manager');
const { createHealthCheckService } = require('./lib/health_check_service');
const { createWindowManager } = require('./lib/window_manager');
const { createSchedulerService } = require('./lib/scheduler_service');
const { createMcpControlServer } = require('./lib/mcp_control_server');
const { createMcpToolService } = require('./lib/mcp_tool_service');
const { createAgentIntegrationService } = require('./lib/agent_integration_service');
const { detectAppEdition, OWNER_EDITION } = require('./lib/app_edition');
const { toFiniteNumber, normalizeHour, normalizeRetryAttempts, normalizeRetryBaseDelayMs, normalizeZipMaxEntryBytes, sanitizePathSegment, safeResolveUnder, dedupeDownloadLinks: dedupeDownloadLinksUtil, isWithinHourWindow, getCpuCount, resolveAppDataRoot: utilsResolveAppDataRoot } = require('./lib/utils');
const {
  createClientAndCookies,
  downloadItemFiles,
  extractArchivesInItemDir,
  extractZipWithEncoding,
  setZipSafetyConfig,
  setZipSafetyHooks,
  setDataRoot: setDownloaderDataRoot,
} = require('./lib/booth_downloader');
const { readBoothCookiesFromFile, writeBoothCookiesToFile } = require('./lib/booth_cookie_store');
const {
  generateLibraryMeta,
  checkLibraryHasNewItems,
  applyVersionTracking,
  generateFilesHash,
  generateFilesStableHash,
  dedupeMetaItemsByItemId,
  setDataRoot: setMetaFetcherDataRoot,
  isFreePriceText,
  extractDownloadableIdFromHref,
  extractBoothItemId,
  extractFreeDownloadLinksFromItemJson,
  learnAvatarsToFile,
  syncAvatarItemsToFile,
  fixAvatarItemFields,
  fetchItemPricePublic,
  enrichItemAvatarMetadata,
} = require('./lib/booth_meta_fetcher');
const { runWishlistPriceCheck } = require('./lib/wishlist_price_checker');
const { searchBoothItems, fetchBoothItemDetail, fetchBoothHomeSections, fetchBoothRelatedItems } = require('./lib/booth_search');
let electronAutoUpdater = null;
try {
  ({ autoUpdater: electronAutoUpdater } = require('electron-updater'));
} catch {
  electronAutoUpdater = null;
}

let mainWindow = null;
let logWindow = null;
let recoveryWindow = null;
let boothClient = null;
let boothCookies = null;
let didStartupNewItemCheck = false;
let startupMetaRefreshPromise = null;
let rendererBootSessionId = 0;
let rendererReady = false;
let rendererFatalState = null;
const LEGACY_APP_ROOT = __dirname;
const APP_EDITION = detectAppEdition({ fs, path, env: process.env, resourcesPath: process.resourcesPath || LEGACY_APP_ROOT });
const IS_OWNER_EDITION = APP_EDITION === OWNER_EDITION;
const STANDARD_AVATOOL_DATA_ROOT = path.join(app.getPath('appData'), 'avatool', 'data');
if (IS_OWNER_EDITION && !String(process.env.AVATOOL_DATA_DIR || '').trim()) {
  const ownerUserData = String(process.env.AVATOOL_OWNER_USER_DATA || '').trim()
    || path.join(app.getPath('appData'), 'avatool-owner');
  app.setPath('userData', path.resolve(ownerUserData));
}
const APP_DATA_ROOT = utilsResolveAppDataRoot({ app, legacyAppRoot: LEGACY_APP_ROOT });
const agentIntegrationService = createAgentIntegrationService({
  fs,
  path,
  processObj: process,
  env: process.env,
  appRoot: LEGACY_APP_ROOT,
  executablePath: process.execPath,
});
process.env.AVATOOL_DATA_DIR = APP_DATA_ROOT;
setDownloaderDataRoot(APP_DATA_ROOT);
setMetaFetcherDataRoot(APP_DATA_ROOT);
const CHROMIUM_SESSION_DIR = path.join(APP_DATA_ROOT, 'session');
const CHROMIUM_HTTP_CACHE_DIR = path.join(CHROMIUM_SESSION_DIR, 'Cache');
try {
  if (!fs.existsSync(CHROMIUM_SESSION_DIR)) fs.mkdirSync(CHROMIUM_SESSION_DIR, { recursive: true });
  if (!fs.existsSync(CHROMIUM_HTTP_CACHE_DIR)) fs.mkdirSync(CHROMIUM_HTTP_CACHE_DIR, { recursive: true });
  app.setPath('sessionData', CHROMIUM_SESSION_DIR);
  app.commandLine.appendSwitch('disk-cache-dir', CHROMIUM_HTTP_CACHE_DIR);
} catch (e) {
  console.warn('Failed to configure Chromium cache path:', e?.message || e);
}
const META_PATH = path.join(APP_DATA_ROOT, 'librarymeta.json');
const SETTINGS_PATH = path.join(APP_DATA_ROOT, 'settings.json');
const IMPORT_LOG_PATH = path.join(APP_DATA_ROOT, 'unity_import_history.json');
const RECONCILE_LOG_PATH = path.join(APP_DATA_ROOT, 'reconcile_log.jsonl');
const TEMP_COOKIE_PATH = path.join(APP_DATA_ROOT, 'tempcookie.json');
const AVATARS_PATH = path.join(APP_DATA_ROOT, 'avatars.json');
const CACHE_DIR = path.join(APP_DATA_ROOT, 'cache');
const AUTHOR_ICON_DIR = path.join(APP_DATA_ROOT, 'author_icons');
const UNITY_LOG_DIR = path.join(APP_DATA_ROOT, 'unity_logs');
const BOOTH_LOGIN_PARTITION = 'persist:booth-login';
const AUTO_BOOTSTRAP_HISTORY_PATH = path.join(APP_DATA_ROOT, 'auto_bootstrap_history.json');
const OP_LOG_PATH = path.join(APP_DATA_ROOT, 'operation_logs.json');
const UNITY_IMPORT_LOG_PATH = path.join(APP_DATA_ROOT, 'unity_import.log');
const AVATAR_DEBUG_LOG_PATH = path.join(APP_DATA_ROOT, 'debug', 'avatar_analysis_debug.txt');
const SETTINGS_PROFILES_PATH = path.join(APP_DATA_ROOT, 'settings_profiles.json');
const AUTO_BOOTSTRAP_FIXED_ITEMS = [
  { itemId: '3087170', title: 'liltoon' },
  { itemId: '4915091', title: 'FaceEmo' },
];
const NADENA_VPM_REPO_URL = 'https://vpm.nadena.dev/vpm.json';
const LILTOON_VPM_REPO_URL = 'https://lilxyzw.github.io/vpm-repos/vpm.json';
const MODULAR_AVATAR_PACKAGE_NAME = 'nadena.dev.modular-avatar';
const NDMF_PACKAGE_NAME = 'nadena.dev.ndmf';
const LILTOON_PACKAGE_NAME = 'jp.lilxyzw.liltoon';
const DESKTOP_NOTIFY_APP_ID = 'Avatool.App';
const SIMPLE_FOLDER_ICON_PACKAGE_NAME = 'SimpleFolderIcon-1.2.4.unitypackage';
const SIMPLE_FOLDER_ICON_PACKAGE_ID = 'com.seaeees.simple-folder-icon';
const unityEditorSupport = createUnityEditorSupport({
  fs,
  path,
  appRoot: LEGACY_APP_ROOT,
  resourcesPath: process.resourcesPath,
});
const LOGIN_ALLOWED_HOST_SUFFIXES = [
  'booth.pm',
  'pixiv.net',
];
const LOGIN_ALLOWED_PROTOCOLS = new Set(['https:']);
const APP_ICON_CANDIDATE_PATHS = [
  path.join(LEGACY_APP_ROOT, 'assets', 'icons', 'icons', 'icon.ico'),
  path.join(LEGACY_APP_ROOT, 'assets', 'icons', 'icons', 'icon.png'),
  path.join(LEGACY_APP_ROOT, 'assets', 'icons', 'icon.ico'),
  path.join(LEGACY_APP_ROOT, 'assets', 'icons', 'icon.png'),
  path.join(LEGACY_APP_ROOT, 'icon.ico'),
  path.join(LEGACY_APP_ROOT, 'icon.png'),
  path.join(LEGACY_APP_ROOT, 'assets', 'icon.ico'),
  path.join(LEGACY_APP_ROOT, 'assets', 'icon.png'),
];
const DEFAULT_KEYBOARD_SHORTCUTS = Object.freeze({
  focusSearch: '/',
  focusSearchAlt: 'Ctrl+F',
  viewGrid: 'g',
  viewList: 'l',
  syncLibrary: 'r',
  checkUpdates: 'u',
  downloadAll: 'd',
  downloadUndownloaded: 'Shift+D',
  queueToggle: 'q',
  retryFailed: 't',
  toggleSelectionMode: 's',
  clearSelectionMode: 'x',
  batchImport: 'i',
  manualAdd: 'm',
  notifications: 'n',
  autoBootstrap: 'b',
  projectItems: 'p',
  openSettings: ',',
  openSettingsAlt: 'Ctrl+,',
  modalConfirm: 'Enter',
  modalPrimary: 'Ctrl+Enter',
  previewOpenFolder: 'o',
  previewOpenEntry: 'e',
  previewBack: 'Backspace',
});
const DEFAULT_SETTINGS = {
  downloadPath: path.join(APP_DATA_ROOT, 'downloads'),
  concurrency: 2,
  autoExtract: true,
  extractZipOnly: false,
  autoCheckInterval: 0,
  minFreeSpaceGb: 2,
  autoBootstrapEnabled: true,
  autoBootstrapIncludeMA: true,
  autoBootstrapIncludeLiltoon: true,
  autoBootstrapIncludeFaceEmo: true,
  autoBootstrapIncludeAvatoolScripts: true,
  autoBootstrapIncludeFolderIconBootstrap: true,
  autoBootstrapIncludeSimpleFolderIcon: true,
  autoBootstrapProjectImportRules: [],
  autoBootstrapVariantMode: 'select',
  autoBootstrapVariantSelections: [],
  projectImportPresets: {},
  cookieFile: path.join(APP_DATA_ROOT, 'booth.pm.json'),
  unityEditorPath: '',
  unityProjects: [],
  safeMode: false,
  healthCheckOnStartup: true,
  launchAtLogin: false,
  appUpdateAutoCheckEnabled: true,
  debugLogEnabled: false,
  downloadSchedulerEnabled: false,
  downloadSchedulerStartHour: 1,
  downloadSchedulerEndHour: 6,
  downloadSchedulerProfile: 'balanced',
  downloadRetryMaxAttempts: 4,
  downloadRetryBaseDelayMs: 1200,
  operationLogEnabled: true,
  zipMaxEntryBytes: 512 * 1024 * 1024,
  keyboardShortcutsEnabled: true,
  renderMode: 'progressive',
  keyboardShortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS },
  experimentalModelPreview: false,
};
const APP_UPDATE_AUTO_CHECK_INTERVAL_MIN = 30;
const ALLOWED_SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const IMPORT_ALLOWED_SETTINGS_KEYS = new Set([...ALLOWED_SETTINGS_KEYS].filter((k) => k !== 'cookieFile'));
const MAX_LIST_ITEM_FILES = 5000;
const MAX_LIST_ITEM_DEPTH = 24;
const ITEM_ID_INPUT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ITEM_TITLE_INPUT = 180;
const RENDERER_LOG_MAX_CHARS = 3000;
const RENDERER_LOG_MAX_EVENTS_PER_SEC = 120;
const INSTALL_ROOT_DIR = path.dirname(String(process.execPath || LEGACY_APP_ROOT));
const INSTALL_SCRIPTS_DIR = path.join(INSTALL_ROOT_DIR, 'scripts');
const VCC_SETTINGS_PATH = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'VRChatCreatorCompanion', 'settings.json')
  : '';
const VCC_LOG_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'VRChatCreatorCompanion', 'Logs')
  : '';
let settings = { ...DEFAULT_SETTINGS };
let zipOversizeConfirmSeq = 0;
const pendingZipOversizeConfirms = new Map();
let archivePasswordSeq = 0;
const pendingArchivePasswords = new Map();
const backgroundImportRunningProjects = new Set();
let settingsProfiles = {};
const runtimeLogBuffer = [];
const MAX_RUNTIME_LOGS = 3000;
let rendererLogWindowStartedAt = 0;
let rendererLogWindowCount = 0;
const ORIG_CONSOLE = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function toRuntimeLogText(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message || String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendRuntimeLog(level, source, ...args) {
  const entry = {
    ts: new Date().toISOString(),
    level: String(level || 'log'),
    source: String(source || 'main'),
    message: args.map(toRuntimeLogText).join(' '),
  };
  runtimeLogBuffer.push(entry);
  if (runtimeLogBuffer.length > MAX_RUNTIME_LOGS) {
    runtimeLogBuffer.splice(0, runtimeLogBuffer.length - MAX_RUNTIME_LOGS);
  }
  try {
    if (logWindow && !logWindow.isDestroyed()) {
      logWindow.webContents.send('runtime-log', entry);
    }
  } catch {
    // ignore
  }
}

function mapWebConsoleLevel(level) {
  const n = Number(level || 0);
  if (n >= 3) return 'error';
  if (n === 2) return 'warn';
  return 'log';
}

function attachWebContentsRuntimeLogging(targetWindow, sourceLabel) {
  try {
    const wc = targetWindow?.webContents;
    if (!wc || wc.isDestroyed?.() || wc.__runtimeLogHooked) return;
    wc.__runtimeLogHooked = true;
    wc.on('console-message', (_event, level, message, line, sourceId) => {
      appendRuntimeLog(
        mapWebConsoleLevel(level),
        sourceLabel,
        `${String(sourceId || '')}:${Number(line || 0)}`,
        String(message || ''),
      );
    });
  } catch {
    // ignore
  }
}

console.log = (...args) => {
  ORIG_CONSOLE.log(...args);
  appendRuntimeLog('log', 'main', ...args);
};
console.warn = (...args) => {
  ORIG_CONSOLE.warn(...args);
  appendRuntimeLog('warn', 'main', ...args);
};
console.error = (...args) => {
  ORIG_CONSOLE.error(...args);
  appendRuntimeLog('error', 'main', ...args);
};

console.log('[BOOT-MARKER]', 'main.js', 'unity-import-ipc-v2');

const logMgr = createLogManager({
  fs,
  OP_LOG_PATH,
  UNITY_IMPORT_LOG_PATH,
  AVATAR_DEBUG_LOG_PATH,
  RENDERER_LOG_MAX_CHARS,
  DEBUG_VERBOSE: /^(1|true|on)$/i.test(String(process.env.AVATOOL_DEBUG_VERBOSE || '').trim()),
  appendRuntimeLog,
  getMainWindow: () => mainWindow,
  getSettings: () => settings,
  ensureAppDataRootExists,
});

const appUpdater = createAppUpdater({
  electronAutoUpdater,
  axios,
  fs,
  crypto,
  app,
  shell,
  getMainWindow: () => mainWindow,
});

function emitAppUpdateStatus(payload = {}) {
  appUpdater.emitAppUpdateStatus(payload);
}

function setupAppUpdater() {
  if (IS_OWNER_EDITION) return;
  appUpdater.setupAppUpdater();
}

async function checkForAppUpdate(manual = false) {
  if (IS_OWNER_EDITION) return { ok: false, disabled: true, error: 'owner_update_channel_not_configured' };
  return await appUpdater.checkForAppUpdate(manual);
}

async function startAppUpdateDownload() {
  if (IS_OWNER_EDITION) return { ok: false, disabled: true, error: 'owner_update_channel_not_configured' };
  return await appUpdater.startAppUpdateDownload();
}

async function installAppUpdateNow() {
  if (IS_OWNER_EDITION) return { ok: false, disabled: true, error: 'owner_update_channel_not_configured' };
  return await appUpdater.installAppUpdateNow();
}
function ensureAppDataRootExists() {
  try {
    if (!fs.existsSync(APP_DATA_ROOT)) fs.mkdirSync(APP_DATA_ROOT, { recursive: true });
  } catch (e) {
    console.warn('Failed to ensure app data root:', e?.message || e);
  }
}

function migrateLegacyDataIfNeeded() {
  try {
    const legacyRoot = path.resolve(LEGACY_APP_ROOT);
    const dataRoot = path.resolve(APP_DATA_ROOT);
    if (!legacyRoot || !dataRoot || legacyRoot === dataRoot) return;

    const pairs = [
      { src: path.join(legacyRoot, 'settings.json'), dst: SETTINGS_PATH, dir: false },
      { src: path.join(legacyRoot, 'librarymeta.json'), dst: META_PATH, dir: false },
      { src: path.join(legacyRoot, 'unity_import_history.json'), dst: IMPORT_LOG_PATH, dir: false },
      { src: path.join(legacyRoot, 'reconcile_log.jsonl'), dst: RECONCILE_LOG_PATH, dir: false },
      { src: path.join(legacyRoot, 'auto_bootstrap_history.json'), dst: AUTO_BOOTSTRAP_HISTORY_PATH, dir: false },
      { src: path.join(legacyRoot, 'booth.pm.json'), dst: DEFAULT_SETTINGS.cookieFile, dir: false },
      { src: path.join(legacyRoot, 'avatars.json'), dst: AVATARS_PATH, dir: false },
      { src: path.join(legacyRoot, 'downloads'), dst: DEFAULT_SETTINGS.downloadPath, dir: true },
      { src: path.join(legacyRoot, 'cache'), dst: CACHE_DIR, dir: true },
      { src: path.join(legacyRoot, 'author_icons'), dst: AUTHOR_ICON_DIR, dir: true },
      { src: path.join(legacyRoot, 'unity_logs'), dst: UNITY_LOG_DIR, dir: true },
    ];

    for (const p of pairs) {
      if (!fs.existsSync(p.src) || fs.existsSync(p.dst)) continue;
      try {
        if (p.dir) fs.cpSync(p.src, p.dst, { recursive: true });
        else fs.copyFileSync(p.src, p.dst);
      } catch {
        // ignore individual copy failures
      }
    }
  } catch (e) {
    console.warn('Legacy data migration failed:', e?.message || e);
  }
}

function getAppIconPath() {
  for (const p of APP_ICON_CANDIDATE_PATHS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return '';
}

const settingsMgr = createSettingsManager({
  fs,
  path,
  app,
  SETTINGS_PATH,
  SETTINGS_PROFILES_PATH,
  DEFAULT_SETTINGS,
  ALLOWED_SETTINGS_KEYS,
  IMPORT_ALLOWED_SETTINGS_KEYS,
  LEGACY_APP_ROOT,
  ensureAppDataRootExists,
  onAfterSave: () => {
    syncDownloaderRuntimeSettings();
  },
});

const vpmMgr = createVpmManager({
  fs,
  path,
  axios,
  getSettings: () => settings,
  dbgUpdate,
  NADENA_VPM_REPO_URL,
  LILTOON_VPM_REPO_URL,
  MODULAR_AVATAR_PACKAGE_NAME,
  NDMF_PACKAGE_NAME,
  LILTOON_PACKAGE_NAME,
  extractZipSimple,
});

function dbgUpdate(...args) {
  logMgr.dbgUpdate(...args);
}

function dbgAvatar(...args) {
  logMgr.dbgAvatar(...args);
}

function normalizeUnityProjects(input) {
  return settingsMgr.normalizeUnityProjects(input);
}

function dedupeProjects(projects) {
  return settingsMgr.dedupeProjects(projects);
}

function syncDownloaderRuntimeSettings() {
  try {
    setZipSafetyConfig({
      maxZipEntryBytes: normalizeZipMaxEntryBytes(settings?.zipMaxEntryBytes, DEFAULT_SETTINGS.zipMaxEntryBytes),
    });
  } catch {
    // ignore
  }
}

async function confirmOversizeZipEntryContinue(payload = {}) {
  return await queueMgr.confirmOversizeZipEntryContinue(payload);
}

async function requestArchivePasswordViaRenderer(archivePath) {
  const sender = mainWindow?.webContents;
  if (!sender || sender.isDestroyed?.()) return null;
  const requestId = `archive-pw-${Date.now()}-${++archivePasswordSeq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingArchivePasswords.delete(requestId);
      resolve(null);
    }, 120000);
    pendingArchivePasswords.set(requestId, {
      resolve: (password) => { clearTimeout(timer); resolve(password || null); },
    });
    sender.send('archive-password-required', { requestId, archivePath: path.basename(archivePath) });
  });
}

function pickAllowedSettings(input) {
  return settingsMgr.pickAllowedSettings(input);
}

function pickAllowedImportSettings(input) {
  return settingsMgr.pickAllowedImportSettings(input);
}

function readJsonFileSafe(filePath, fallback) {
  return settingsMgr.readJsonFileSafe(filePath, fallback);
}

function saveOperationLogs() {
  logMgr.saveOperationLogs();
}

function appendOperationLog(type, message, meta = null) {
  return logMgr.appendOperationLog(type, message, meta);
}

function loadOperationLogs() {
  logMgr.loadOperationLogs();
}

function saveSettingsProfiles() {
  settingsMgr.setSettingsProfiles(settingsProfiles);
  settingsMgr.saveSettingsProfiles();
  settingsProfiles = settingsMgr.getSettingsProfiles();
}

function loadSettingsProfiles() {
  settingsMgr.loadSettingsProfiles();
  settingsProfiles = settingsMgr.getSettingsProfiles();
}

function emitVccProjectsUpdated(payload) {
  const sender = mainWindow?.webContents;
  if (!sender || sender.isDestroyed?.()) return;
  sender.send('vcc-projects-updated', payload);
}

const vccSyncService = createVccSyncService({
  fs,
  path,
  VCC_SETTINGS_PATH,
  getSettings: () => settings,
  saveSettings,
  normalizeUnityProjects,
  dedupeProjects,
  normalizeProjectPath,
  ensureFolderIconBootstrapForProjects,
  emitVccProjectsUpdated,
  enqueueAutoBootstrap,
});

function readVccProjectsFile() {
  return vccSyncService.readVccProjectsFile();
}

function syncVccProjectsToSettings(source = 'watch') {
  return vccSyncService.syncToSettings(source);
}

function ensureFolderIconBootstrapForProjects(projectRows, trigger = 'manual') {
  if (!isFolderIconBootstrapEnabled()) return;
  const rows = Array.isArray(projectRows) ? projectRows : [];
  for (const row of rows) {
    const projectPath = normalizeProjectPath(row?.path || row);
    if (!projectPath || !fs.existsSync(projectPath)) continue;
    const res = ensureUnityFolderIconBootstrapReady(projectPath);
    if (!res?.ok) {
      appendOperationLog('folder-icon-bootstrap', `起動時フォルダアイコン再適用スクリプトの準備に失敗: ${String(res?.error || 'unknown')}`, {
        projectPath,
        trigger,
      });
      continue;
    }
    if (res.status && res.status !== 'unchanged') {
      appendOperationLog('folder-icon-bootstrap', `起動時フォルダアイコン再適用スクリプトを${res.status === 'created' ? '作成' : '更新'}しました`, {
        projectPath,
        scriptPath: String(res.scriptPath || ''),
        status: res.status,
        trigger,
      });
    }
  }
}

function isFolderIconBootstrapEnabled() {
  return settings.autoBootstrapIncludeAvatoolScripts !== false
    && settings.autoBootstrapIncludeFolderIconBootstrap !== false;
}

function canRunUnityImport() {
  return settings.autoBootstrapIncludeAvatoolScripts !== false;
}

function loadSettings() {
  settingsMgr.loadSettings();
  settings = settingsMgr.getSettings();
}

function saveSettings(nextSettings = null) {
  if (nextSettings && typeof nextSettings === 'object' && !Array.isArray(nextSettings)) {
    settingsMgr.saveSettings(nextSettings);
  } else {
    settingsMgr.setSettings(settings);
    settingsMgr.saveSettings();
  }
  settings = settingsMgr.getSettings();
}

function emitAutoBootstrapStatus(payload) {
  try {
    const phase = String(payload?.phase || '');
    const projectPath = String(payload?.projectPath || '');
    const message = String(payload?.message || '');
    console.log('[AUTO-BOOTSTRAP][main]', phase, projectPath, message);
    if (phase === 'error' && message) appendOperationLog('auto-download', message);
  } catch { /* ステータスログ記録の失敗は通知処理に影響しないため無視 */ }
  sendDesktopNotificationForAutoBootstrap(payload);
  const sender = mainWindow?.webContents;
  if (!sender || sender.isDestroyed?.()) return;
  sender.send('auto-bootstrap-status', payload);
}

const desktopNotifications = createDesktopNotifications({ Notification, path });
const {
  showDesktopNotification,
  formatElapsedMs,
  sendDesktopNotificationForAutoBootstrap,
} = desktopNotifications;

function loadAutoBootstrapHistory() {
  try {
    if (!fs.existsSync(AUTO_BOOTSTRAP_HISTORY_PATH)) return {};
    return JSON.parse(fs.readFileSync(AUTO_BOOTSTRAP_HISTORY_PATH, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveAutoBootstrapHistory(history) {
  try {
    fs.writeFileSync(AUTO_BOOTSTRAP_HISTORY_PATH, JSON.stringify(history || {}, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

function listUnityPackagesInDir(rootDir) {
  return unityMgr.listUnityPackagesInDir(rootDir);
}

function listSourceImportRootsInDir(itemDir) {
  return unityMgr.listSourceImportRootsInDir(itemDir);
}

function isVpmPackageDir(dirPath) {
  return vpmMgr.isVpmPackageDir(dirPath);
}

function listVpmPackageRootsInDir(itemDir) {
  return vpmMgr.listVpmPackageRootsInDir(itemDir);
}

function copyDirMerge(srcDir, dstDir) {
  return unityMgr.copyDirMerge(srcDir, dstDir);
}

function applySourceRootsToProject(projectPath, sourceRows) {
  return unityMgr.applySourceRootsToProject(projectPath, sourceRows);
}

async function fetchLatestVersionFromVpmRepo(repoUrl, packageName) {
  return await vpmMgr.fetchLatestVersionFromVpmRepo(repoUrl, packageName);
}

async function fetchLatestPackageMetaFromVpmRepo(repoUrl, packageName) {
  return await vpmMgr.fetchLatestPackageMetaFromVpmRepo(repoUrl, packageName);
}

function findPackageRootByName(rootDir, packageName) {
  return vpmMgr.findPackageRootByName(rootDir, packageName);
}

function extractZipSimple(zipPath, destDir) {
  return extractZipWithEncoding(zipPath, destDir);
}

async function installLocalVpmPackageFromRepo(projectPath, repoUrl, packageName) {
  return await vpmMgr.installLocalVpmPackageFromRepo(projectPath, repoUrl, packageName);
}

function ensureNadenaScopedRegistry(manifest) {
  return vpmMgr.ensureNadenaScopedRegistry(manifest);
}

function ensureLilxyzwScopedRegistry(manifest) {
  return vpmMgr.ensureLilxyzwScopedRegistry(manifest);
}

function cleanupLegacyVpmEntries(packagesDir) {
  return vpmMgr.cleanupLegacyVpmEntries(packagesDir);
}

async function ensureModularAvatarDependency(projectPath) {
  return await vpmMgr.ensureModularAvatarDependency(projectPath);
}

async function ensureLiltoonDependency(projectPath) {
  return await vpmMgr.ensureLiltoonDependency(projectPath);
}

async function installVpmPackageToProject(projectPath, vpmRoot) {
  return await vpmMgr.installVpmPackageToProject(projectPath, vpmRoot);
}

async function applyVpmPackagesToProject(projectPath, vpmRows) {
  return await vpmMgr.applyVpmPackagesToProject(projectPath, vpmRows);
}

function getMetaAssetMapFast() {
  return metaMgr.getMetaAssetMapFast();
}

function pickBootstrapAssets(assetMap) {
  return metaMgr.pickBootstrapAssets(assetMap);
}

function pickPurchasedBootstrapAssets(assetMap, excludeIds = new Set()) {
  return metaMgr.pickPurchasedBootstrapAssets(assetMap, excludeIds);
}

function parseAutoBootstrapChoiceKey(choiceKey) {
  return autoBootstrapService.parseAutoBootstrapChoiceKey(choiceKey);
}

async function listAutoBootstrapRuleChoices() {
  return autoBootstrapService.listAutoBootstrapRuleChoices();
}

function dedupeDownloadLinks(links = []) {
  return queueMgr.dedupeDownloadLinks(links);
}

async function fetchFreeDownloadLinksForItem(itemId) {
  return await queueMgr.fetchFreeDownloadLinksForItem(itemId);
}

async function listAutoBootstrapVariantOptions() {
  return autoBootstrapService.listAutoBootstrapVariantOptions();
}

const boothSessionMgr = createBoothSessionManager({
  axios,
  path,
  writeBoothCookiesToFile,
  defaultCookieFilePath: DEFAULT_SETTINGS.cookieFile,
  tempCookiePath: TEMP_COOKIE_PATH,
  getBoothClient: () => boothClient,
  setBoothClient: (v) => { boothClient = v; },
  getBoothCookies: () => boothCookies,
  setBoothCookies: (v) => { boothCookies = v; },
  getSettings: () => settings,
  getMainWindow: () => mainWindow,
  getLoginWindowMgr: () => loginWindowMgr,
  getRefreshMetaAfterLoginDedup: () => refreshMetaAfterLoginDedup,
});
const {
  isMissingBoothCookieFileError,
  isRecoverableBoothCookieError,
  runWithBoothCookieLoginFallback,
} = boothSessionMgr;

const storageMgr = createStorageManager({
  fs,
  path,
  getSettings: () => settings,
  CACHE_DIR,
  AUTHOR_ICON_DIR,
  UNITY_LOG_DIR,
  META_PATH,
  SETTINGS_PATH,
  IMPORT_LOG_PATH,
  RECONCILE_LOG_PATH,
  AVATARS_PATH,
  APP_DATA_ROOT,
  sanitizePathSegment,
});

const autoBootstrapService = createAutoBootstrapService({
  getSettings: () => settings,
  fs,
  path,
  dbgUpdate,
  formatElapsedMs,
  emitAutoBootstrapStatus,
  ensureClientReady,
  runWithBoothCookieLoginFallback,
  getMetaAssetMapFast,
  pickBootstrapAssets,
  pickPurchasedBootstrapAssets,
  fetchFreeDownloadLinksForItem,
  dedupeDownloadLinks,
  downloadItemFiles,
  getQueueState: () => queueMgr.getQueueState(),
  getBoothClient: () => boothClient,
  getBoothCookies: () => boothCookies,
  buildItemDir,
  extractArchivesInItemDir,
  normalizeProjectPath,
  validateUnityEditorPathSetting,
  isUnityProjectLocked,
  loadAutoBootstrapHistory,
  saveAutoBootstrapHistory,
  ensureModularAvatarDependency,
  normalizeAutoBootstrapProjectImportRules: settingsMgr.normalizeAutoBootstrapProjectImportRules,
  parseAutoBootstrapChoiceKey,
  isFolderIconBootstrapEnabled,
  ensureLiltoonDependency,
  listUnityPackagesInDir,
  listSourceImportRootsInDir,
  listVpmPackageRootsInDir,
  ensureUnityBatchImporterReady,
  ensureUnityLiveImporterReady,
  appendSimpleFolderIconToBatchPackages,
  installSimpleFolderIconAsPackage,
  SIMPLE_FOLDER_ICON_PACKAGE_NAME,
  applyVpmPackagesToProject,
  applySourceRootsToProject,
  acquireBackgroundImportProjectLock,
  runUnityBatchImport,
  runUnityBatchRefresh,
  releaseBackgroundImportProjectLock,
  cleanupAutoBootstrapSupportScripts,
  validateAutoBootstrapImportResult,
  appendImportHistory,
  writeSimpleFolderIcons,
  fillPackageMetaByScan,
});

async function runStartupBootstrapDownloads() {
  return autoBootstrapService.runStartupBootstrapDownloads();
}

async function runAutoBootstrapForProject(projectPath, source = 'watch') {
  return autoBootstrapService.runAutoBootstrapForProject(projectPath, source);
}

function enqueueAutoBootstrap(projectPath, source = 'watch') {
  autoBootstrapService.enqueueAutoBootstrap(projectPath, source);
}

function normalizeBoothCookies(cookies) {
  return boothSessionMgr.normalizeBoothCookies(cookies);
}

function persistBoothCookies(cookies) {
  return boothSessionMgr.persistBoothCookies(cookies);
}

function persistTempBoothCookies(cookies) {
  return boothSessionMgr.persistTempBoothCookies(cookies);
}

function cookieUrlFromRecord(cookie) {
  return boothSessionMgr.cookieUrlFromRecord(cookie);
}

function buildCookieHeader(cookies) {
  return boothSessionMgr.buildCookieHeader(cookies);
}

function isBoothDomain(domain) {
  return boothSessionMgr.isBoothDomain(domain);
}

async function validateBoothLogin(cookies) {
  return await boothSessionMgr.validateBoothLogin(cookies);
}

async function probeBoothLibrary(cookies) {
  return await boothSessionMgr.probeBoothLibrary(cookies);
}

function ensureRuntimeDirs() {
  return storageMgr.ensureRuntimeDirs();
}

ensureAppDataRootExists();
migrateLegacyDataIfNeeded();
loadSettings();
syncDownloaderRuntimeSettings();
setZipSafetyHooks({
  onOversizeEntry: confirmOversizeZipEntryContinue,
  onArchivePassword: requestArchivePasswordViaRenderer,
});
loadOperationLogs();
loadSettingsProfiles();
ensureRuntimeDirs();

let ownerVaultService = null;
let scheduleOwnerVaultBackup = () => {};
let getOwnerStandardDataStatus = () => ({ available: false, sourcePath: '' });
let importStandardDataToOwner = () => ({ ok: false, error: 'owner_edition_required' });
if (IS_OWNER_EDITION) {
  const ownerRuntime = require('./owner/main_extensions').createOwnerRuntime({
    fs,
    path,
    axios,
    safeStorage,
    appDataRoot: APP_DATA_ROOT,
    standardDataRoot: STANDARD_AVATOOL_DATA_ROOT,
    getSettings: () => settings,
    saveSettings: (nextSettings) => saveSettings(nextSettings),
    defaultSettings: DEFAULT_SETTINGS,
    getMainWindow: () => mainWindow,
    appendRuntimeLog: (...args) => appendRuntimeLog(...args),
    appendOperationLog: (...args) => appendOperationLog(...args),
  });
  ownerVaultService = ownerRuntime.ownerVaultService;
  scheduleOwnerVaultBackup = ownerRuntime.scheduleOwnerVaultBackup;
  getOwnerStandardDataStatus = ownerRuntime.getOwnerStandardDataStatus;
  importStandardDataToOwner = ownerRuntime.importStandardDataToOwner;
}

let queueSender = null;

function buildItemDir(itemId, title) {
  return storageMgr.buildItemDir(itemId, title);
}

async function runAvatarEnrichAfterDownload(itemIds, senderOverride) {
  return await metaMgr.runAvatarEnrichAfterDownload(itemIds, senderOverride);
}
function getPathSizeBytes(targetPath) {
  return storageMgr.getPathSizeBytes(targetPath);
}

function getStorageUsageSnapshot() {
  return storageMgr.getStorageUsageSnapshot();
}

function checkDiskSpaceGuard() {
  return queueMgr.checkDiskSpaceGuard();
}

function toAssetMap(data) {
  return metaMgr.toAssetMap(data);
}

function writeMetaFile(items) {
  return metaMgr.writeMetaFile(items);
}

function normalizeAndPersistMeta(items) {
  return metaMgr.normalizeAndPersistMeta(items);
}

function markItemUpdatedInMeta(itemId, files = [], expectedStableHash = null) {
  return metaMgr.markItemUpdatedInMeta(itemId, files, expectedStableHash);
}

function createManualFreeMetaItem(itemId, itemJson, downloadLinks) {
  return metaMgr.createManualFreeMetaItem(itemId, itemJson, downloadLinks);
}

const boothCartService = createBoothCartService({
  getBoothClient: () => boothClient,
  ensureClientReady,
  extractBoothItemId,
});
const {
  extractBoothCsrfFromHtml,
  addWishlistItemToBoothCart,
  fetchBoothCart,
} = boothCartService;

function applyVersionTrackingKeepingManual(existingMeta, latestMeta, detectedAt = new Date().toISOString()) {
  return metaMgr.applyVersionTrackingKeepingManual(existingMeta, latestMeta, detectedAt);
}

function buildVersionDiffForItem(item) {
  return metaMgr.buildVersionDiffForItem(item);
}

function enrichUpdatesWithVersionDiff(items, updates) {
  return metaMgr.enrichUpdatesWithVersionDiff(items, updates);
}

function ensureMetaWithVersionTracking(existingMeta, latestMeta) {
  return metaMgr.ensureMetaWithVersionTracking(existingMeta, latestMeta);
}

const boothItemEnrichment = createBoothItemEnrichment({
  getBoothClient: () => boothClient,
  ensureClientReady,
  extractBoothItemId,
  extractFreeDownloadLinksFromItemJson,
  fetchFreeDownloadLinksForItem,
  dedupeDownloadLinks,
  createManualFreeMetaItem,
  enrichItemAvatarMetadata,
  learnAvatarsToFile,
});
const {
  resolveManualFreeAssetCandidate,
  toBoothCategoryRowsFromItemJson,
  backfillCategoriesForItemIds,
} = boothItemEnrichment;

function metaNeedsVersionBackfill(items) {
  return metaMgr.metaNeedsVersionBackfill(items);
}

function getQueueStatus() {
  return queueMgr.getQueueStatus();
}

function emitQueueStatus(senderOverride) {
  queueMgr.emitQueueStatus(senderOverride);
}

function sendDownloadProgress(sender, payload) {
  queueMgr.sendDownloadProgress(sender, payload);
}

async function refreshMetaAfterLogin(sender) {
  return metaMgr.refreshMetaAfterLogin(sender);
}

async function refreshMetaAfterLoginDedup(sender) {
  return metaMgr.refreshMetaAfterLoginDedup(sender);
}

const metaMgr = createMetaManager({
  fs,
  path,
  zlib,
  pathToFileURL,
  META_PATH,
  AVATARS_PATH,
  CACHE_DIR,
  AUTHOR_ICON_DIR,
  APP_DATA_ROOT,
  LEGACY_APP_ROOT,
  AUTO_BOOTSTRAP_FIXED_ITEMS,
  getSettings: () => settings,
  getMainWindow: () => mainWindow,
  getQueueSender: () => queueSender,
  backupCorruptedJson: settingsMgr.backupCorruptedJson,
  generateLibraryMeta,
  checkLibraryHasNewItems,
  applyVersionTracking,
  generateFilesHash,
  generateFilesStableHash,
  dedupeMetaItemsByItemId,
  listUnityPackagesInDir,
  buildItemDir,
  runWithBoothCookieLoginFallback,
  dbgUpdate,
  appendAvatarDebugLog: (...args) => logMgr.appendAvatarDebugLog(...args),
  dedupeDownloadLinks: dedupeDownloadLinksUtil,
});

const queueMgr = createDownloadQueue({
  fs,
  path,
  os,
  axios,
  cheerio,
  getSettings: () => settings,
  getBoothClient: () => boothClient,
  setBoothClient: (v) => { boothClient = v; },
  getBoothCookies: () => boothCookies,
  setBoothCookies: (v) => { boothCookies = v; },
  getMainWindow: () => mainWindow,
  createClientAndCookies,
  downloadItemFiles,
  extractArchivesInItemDir,
  setZipSafetyConfig,
  setZipSafetyHooks,
  normalizeZipMaxEntryBytes,
  DEFAULT_SETTINGS,
  boothCookieStore: {
    readBoothCookiesFromFile,
    writeBoothCookiesToFile,
  },
  dbgUpdate,
  appendOperationLog,
  pendingZipOversizeConfirms,
  markItemUpdatedInMeta,
  runAvatarEnrichAfterDownload,
  onQueueSettled: scheduleOwnerVaultBackup,
  BOOTH_LOGIN_PARTITION,
  session,
  runWithBoothCookieLoginFallback,
  openLoginWindowFlow: (...args) => loginWindowMgr.openLoginWindowFlow(...args),
  getStorageUsageSnapshot: () => storageMgr.getStorageUsageSnapshot(),
});

const healthCheckSvc = createHealthCheckService({
  fs,
  DEFAULT_SETTINGS,
  readBoothCookiesFromFile,
  validateBoothLogin,
  getStorageUsageSnapshot: () => storageMgr.getStorageUsageSnapshot(),
  META_PATH,
  VCC_SETTINGS_PATH,
  getSettings: () => settings,
  appendOperationLog,
  getMainWindow: () => mainWindow,
});

const loginWindowMgr = createLoginWindow({
  BrowserWindow,
  shell,
  session,
  BOOTH_LOGIN_PARTITION,
  LOGIN_ALLOWED_HOST_SUFFIXES,
  LOGIN_ALLOWED_PROTOCOLS,
  getAppIconPath,
  setBoothClient: (v) => { boothClient = v; },
  setBoothCookies: (v) => { boothCookies = v; },
  normalizeBoothCookies,
  persistTempBoothCookies,
  persistBoothCookies,
  validateBoothLogin,
  refreshMetaAfterLoginDedup,
  getMainWindow: () => mainWindow,
  createClientAndCookies,
});

async function ensureClientReady() {
  return await queueMgr.ensureClientReady();
}

// fetchBoothItemDetail() only returns per-variation purchase status
// (alreadyBought) when the request carries the user's session cookie —
// otherwise BOOTH just returns the public "addable_to_cart" for everything.
async function fetchBoothItemDetailAuthenticated(itemId) {
  try {
    await ensureClientReady();
  } catch {
    // fall through unauthenticated; detail still loads, just without per-variation purchase status
  }
  return fetchBoothItemDetail(itemId, buildCookieHeader(boothCookies));
}

async function processQueue(senderOverride) {
  return await queueMgr.processQueue(senderOverride);
}

async function runHealthCheck(trigger = 'manual') {
  return healthCheckSvc.runHealthCheck(trigger);
}

function stopVccWatcher() {
  vccSyncService.stopWatcher();
}

function startVccWatcher() {
  vccSyncService.startWatcher();
}

function isUnityProjectLocked(projectPath) {
  return unityMgr.isUnityProjectLocked(projectPath);
}

function normalizeProjectPath(projectPath) {
  return settingsMgr.normalizeProjectPath(projectPath);
}

function isRegisteredUnityProject(projectPath) {
  return unityMgr.isRegisteredUnityProject(projectPath);
}

function normalizeItemRefInput(itemId, title) {
  const normalizedItemId = String(itemId || '').trim();
  const normalizedTitle = String(title || '').trim();
  if (!ITEM_ID_INPUT_RE.test(normalizedItemId)) return { error: 'invalid_item_id' };
  if (normalizedTitle.length > MAX_ITEM_TITLE_INPUT) return { error: 'invalid_title' };
  return { itemId: normalizedItemId, title: normalizedTitle };
}

function sanitizeRendererLogText(value, maxLen = RENDERER_LOG_MAX_CHARS) {
  return logMgr.sanitizeRendererLogText(value, maxLen);
}

function resolveExportBundlePath(inputPath) {
  return resolveExportBundlePathImpl({ inputPath, fs, path });
}

function validateUnityEditorPathSetting() {
  return unityMgr.validateUnityEditorPathSetting();
}

function acquireBackgroundImportProjectLock(projectPath) {
  return unityMgr.acquireBackgroundImportProjectLock(projectPath);
}

function releaseBackgroundImportProjectLock(lockKey) {
  unityMgr.releaseBackgroundImportProjectLock(lockKey);
}

function loadImportHistory() {
  return unityMgr.loadImportHistory();
}

function appendImportHistory(projectPath, packages) {
  return unityMgr.appendImportHistory(projectPath, packages);
}

function appendReconciledImportHistory(projectPath, packages) {
  return unityMgr.appendReconciledImportHistory(projectPath, packages);
}

function validateImportPackages(packages) {
  return unityMgr.validateImportPackages(packages);
}

function resolveSimpleFolderIconPackagePath() {
  return unityMgr.resolveSimpleFolderIconPackagePath();
}

function ensureInstallScriptsAssets() {
  return unityMgr.ensureInstallScriptsAssets();
}

function appendSimpleFolderIconToBatchPackages(packages) {
  return unityMgr.appendSimpleFolderIconToBatchPackages(packages);
}

function installSimpleFolderIconAsPackage(projectPath) {
  return unityMgr.installSimpleFolderIconAsPackage(projectPath);
}

function planTopFolderRenames(projectPath, importedPackages) {
  return unityMgr.planTopFolderRenames(projectPath, importedPackages);
}

const unityMgr = createUnityManager({
  fs,
  path,
  spawn,
  Worker,
  nativeImage,
  shell,
  getSettings: () => settings,
  saveSettings,
  normalizeProjectPath,
  normalizeUnityProjects,
  dedupeProjects,
  IMPORT_LOG_PATH,
  RECONCILE_LOG_PATH,
  UNITY_LOG_DIR,
  APP_DATA_ROOT,
  LEGACY_APP_ROOT,
  INSTALL_SCRIPTS_DIR,
  backgroundImportRunningProjects,
  unityEditorSupport,
  dbgUpdate,
  appendOperationLog,
  SIMPLE_FOLDER_ICON_PACKAGE_NAME,
  SIMPLE_FOLDER_ICON_PACKAGE_ID,
  buildItemDir,
  isVpmPackageDir,
  listVpmPackageRootsInDir,
  applyVpmPackagesToProject,
  ensureModularAvatarDependency,
  ensureLiltoonDependency,
  VCC_SETTINGS_PATH,
  enqueueAutoBootstrap,
  runWithBoothCookieLoginFallback,
  getBoothClient: () => boothClient,
  emitVccProjectsUpdated,
  vccSyncService,
  VCC_LOG_DIR,
  ORIG_CONSOLE,
  appendRuntimeLog,
});

async function fillPackageMetaByScan(packages) {
  return await unityMgr.fillPackageMetaByScan(packages);
}

async function writeSimpleFolderIcons(projectPath, payload = {}) {
  return await unityMgr.writeSimpleFolderIcons(projectPath, payload);
}

async function analyzeImportToolDependencies(projectPath, packages = []) {
  return await unityMgr.analyzeImportToolDependencies(projectPath, packages);
}

async function installImportToolDependencies(projectPath, report = {}) {
  return await unityMgr.installImportToolDependencies(projectPath, report);
}

function analyzeUnityImportLog(logPath) {
  return unityMgr.analyzeUnityImportLog(logPath);
}

function validateAutoBootstrapImportResult(projectPath, packageRows, logPath) {
  return unityMgr.validateAutoBootstrapImportResult(projectPath, packageRows, logPath);
}

function writeReconcileLog(entry) {
  return unityMgr.writeReconcileLog(entry);
}
function writeReconcileLogBatch(entries) {
  return unityMgr.writeReconcileLogBatch(entries);
}

function pruneUnityLogs(logDir, maxFiles = 200, maxAgeDays = 30) {
  return unityMgr.pruneUnityLogs(logDir, maxFiles, maxAgeDays);
}

function runReconcileWorker(mode, payload) {
  return unityMgr.runReconcileWorker(mode, payload);
}

function getProjectIndexCached(projectPath) {
  return unityMgr.getProjectIndexCached(projectPath);
}

function setProjectIndexCache(projectPath, index) {
  return unityMgr.setProjectIndexCache(projectPath, index);
}

function getRecommendedReconcileWorkerCount(totalPackages = 1) {
  return unityMgr.getRecommendedReconcileWorkerCount(totalPackages);
}

async function buildPackageMetasAdaptive(payload = {}) {
  return await unityMgr.buildPackageMetasAdaptive(payload);
}

async function runUnityBatchImport(projectPath, packages, options = {}) {
  return await unityMgr.runUnityBatchImport(projectPath, packages, options);
}

async function runUnityBatchRefresh(projectPath, options = {}) {
  return await unityMgr.runUnityBatchRefresh(projectPath, options);
}

function normalizeImportMode(mode) {
  return unityMgr.normalizeImportMode(mode);
}

function ensureUnityBatchImporterReady(projectPath) {
  return unityMgr.ensureUnityBatchImporterReady(projectPath);
}

function ensureUnityLiveImporterReady(projectPath) {
  return unityMgr.ensureUnityLiveImporterReady(projectPath);
}

function ensureUnityFolderIconBootstrapReady(projectPath) {
  return unityMgr.ensureUnityFolderIconBootstrapReady(projectPath);
}

function cleanupAutoBootstrapSupportScripts(projectPath) {
  return unityMgr.cleanupAutoBootstrapSupportScripts(projectPath);
}

function enqueueUnityLiveImport(projectPath, packagePaths, renameEntries = []) {
  return unityMgr.enqueueUnityLiveImport(projectPath, packagePaths, renameEntries);
}

async function openPackagesViaOsAssociation(payload = {}) {
  return await unityMgr.openPackagesViaOsAssociation(payload);
}

function listRunningUnityProjectPaths() {
  return unityMgr.listRunningUnityProjectPaths();
}

function findLatestOpenedProjectFromVccLogs() {
  return unityMgr.findLatestOpenedProjectFromVccLogs();
}

async function selectProjectPathForOsAssociation(payload = {}) {
  return await unityMgr.selectProjectPathForOsAssociation(payload);
}
const windowMgr = createWindowManager({
  BrowserWindow,
  path,
  app,
  appRoot: LEGACY_APP_ROOT,
  getAppIconPath,
  attachWebContentsRuntimeLogging,
  getMainWindow: () => mainWindow,
  setMainWindow: (w) => { mainWindow = w; },
  getLogWindow: () => logWindow,
  setLogWindow: (w) => { logWindow = w; },
  getRecoveryWindow: () => recoveryWindow,
  setRecoveryWindow: (w) => { recoveryWindow = w; },
  getRendererBootSessionId: () => rendererBootSessionId,
  incrementRendererBootSessionId: () => { rendererBootSessionId += 1; },
  setRendererReady: (v) => { rendererReady = v; },
  setRendererFatalState: (v) => { rendererFatalState = v; },
  getRendererFatalState: () => rendererFatalState,
  getRendererReady: () => rendererReady,
});

function createWindow() { windowMgr.createWindow(); }

function openLogWindow() { windowMgr.openLogWindow(); }
function showRendererRecovery(reason, payload) { windowMgr.showRendererRecovery(reason, payload); }
function getRendererRecoveryState() { return windowMgr.getRendererRecoveryState(); }
function closeRecoveryWindow() { windowMgr.closeRecoveryWindow(); }

const schedulerSvc = createSchedulerService({
  getSettings: () => settings,
  getMainWindow: () => mainWindow,
  normalizeConcurrency: settingsMgr.normalizeConcurrency,
  normalizeSchedulerProfile: settingsMgr.normalizeSchedulerProfile,
  loadOrGenerateMeta,
  generateLibraryMeta,
  applyVersionTrackingKeepingManual,
  writeMetaFile,
  setMetaCache: (items) => { metaMgr.setMetaCache(items); metaMgr.setMetaCacheAvatarEnriched(false); },
  showDesktopNotification,
  appendOperationLog,
  processQueue,
  dedupeMetaItemsByItemId,
  queueMgr,
  checkForAppUpdate,
  getElectronAutoUpdater: () => electronAutoUpdater,
  APP_UPDATE_AUTO_CHECK_INTERVAL_MIN,
});

function startAutoCheckTimer() { schedulerSvc.startAutoCheckTimer(); }
function startDownloadScheduler() { schedulerSvc.startDownloadScheduler(); }
function startAppUpdateAutoCheckTimer() { schedulerSvc.startAppUpdateAutoCheckTimer(); }
function maybeRunScheduledDownloads() { return schedulerSvc.maybeRunScheduledDownloads(); }

// MCP is intentionally a thin, local-only adapter over the same managers used by the UI.
// It never receives a renderer confirmation dialog; callers must explicitly choose the
// requested operation and import mode.
function mcpAssetRows() {
  const cache = typeof metaMgr.getMetaCache === 'function' ? metaMgr.getMetaCache() : [];
  if (Array.isArray(cache) && cache.length) return cache;
  const fast = typeof metaMgr.getMetaAssetMapFast === 'function' ? metaMgr.getMetaAssetMapFast() : {};
  return fast && typeof fast === 'object' ? Object.values(fast) : [];
}

async function mcpSyncLibrary() {
  return await runWithBoothCookieLoginFallback(async () => metaMgr.refreshMetaAfterLoginDedup(null));
}

function mcpNormalizeAsset(asset) {
  const itemId = String(asset?.itemId || '').trim();
  const title = String(asset?.title || asset?.itemName || asset?.name || '').trim();
  const links = Array.isArray(asset?.files) && asset.files.length ? asset.files : (Array.isArray(asset?.downloadLinks) ? asset.downloadLinks : []);
  return { ...asset, itemId, title, files: links };
}

async function mcpEnqueueDownload(asset) {
  const normalized = mcpNormalizeAsset(asset);
  if (!normalized.itemId) return { ok: false, error: 'invalid_item_id' };
  const diskGuard = queueMgr.checkDiskSpaceGuard();
  if (!diskGuard?.ok) return { ...diskGuard, queue: getQueueStatus() };
  const state = queueMgr.getQueueState();
  const id = String(normalized.itemId);
  if (state.queued.some((task) => String(task?.itemId) === id) || state.running.has(id)) {
    return { ok: true, duplicate: true, queue: getQueueStatus() };
  }
  state.queued.push({
    itemId: normalized.itemId,
    title: normalized.title,
    attempt: 0,
    nextRunAt: 0,
    forceRedownload: Boolean(normalized.forceRedownload),
    asset: {
      ...normalized,
      files: normalized.files,
      analyzeAfterDownload: normalized.analyzeAfterDownload !== false,
      forceRedownload: Boolean(normalized.forceRedownload),
    },
  });
  queueMgr.emitQueueStatus(mainWindow?.webContents);
  if (!state.paused) processQueue(mainWindow?.webContents).catch((error) => console.warn('MCP queue processing failed:', error?.message || error));
  return { ok: true, duplicate: false, queue: getQueueStatus() };
}

function mcpRegisteredProject(projectPath) {
  if (!isRegisteredUnityProject(projectPath)) return false;
  return true;
}

async function mcpImportAssetToUnity({ itemId, projectPath, importMode }) {
  if (!mcpRegisteredProject(projectPath)) return { ok: false, error: 'project_not_registered' };
  const asset = mcpAssetRows().find((row) => String(row?.itemId || '') === String(itemId));
  const title = String(asset?.title || asset?.itemName || asset?.name || itemId);
  const itemDir = buildItemDir(itemId, title);
  const extracted = path.join(itemDir, '__extracted');
  if (!fs.existsSync(extracted)) return { ok: false, error: 'extracted_dir_not_found' };
  let packageRows = listUnityPackagesInDir(extracted).map((packagePath) => ({
    packagePath,
    itemId: String(asset?.itemId || itemId),
    title,
    previewUrl: String(asset?.localImagePath || asset?.imageUrl || ''),
  }));
  if (!packageRows.length) return { ok: false, error: 'no_packages' };
  const iconInstall = installSimpleFolderIconAsPackage(projectPath);
  if (!iconInstall?.ok) console.warn('[SimpleFolderIcon] MCP install failed:', iconInstall?.error || iconInstall);
  packageRows = appendSimpleFolderIconToBatchPackages(packageRows);
  const validation = validateImportPackages(packageRows);
  const validRows = Array.isArray(validation) ? validation : (validation?.validPackages || []);
  if (!validRows.length) return { ok: false, error: 'no_valid_packages' };
  const importPackagesRaw = await fillPackageMetaByScan(validRows);
  const planned = planTopFolderRenames(projectPath, importPackagesRaw || validRows) || {};
  const importPackages = Array.isArray(planned.packages) ? planned.packages : (importPackagesRaw || validRows);
  const renameEntries = Array.isArray(planned.renameEntries) ? planned.renameEntries : [];
  const validPaths = importPackages.map((row) => String(row?.packagePath || '').trim()).filter(Boolean);
  if (!validPaths.length) return { ok: false, error: 'no_valid_packages' };

  const appendHistory = () => unityMgr.appendImportHistory(projectPath, importPackages);
  const writeIcons = () => writeSimpleFolderIcons(projectPath, importPackages);
  if (importMode === 'live') {
    if (!unityMgr.isUnityProjectLocked(projectPath)) return { ok: false, error: 'require_background_when_unity_closed' };
    const prep = ensureUnityLiveImporterReady(projectPath);
    if (!prep?.ok) return { ok: false, error: prep?.error || 'prepare_unity_project_failed' };
    const queued = enqueueUnityLiveImport(projectPath, validPaths, renameEntries);
    if (queued?.ok) {
      appendHistory();
      return { ...queued, mode: 'live_bridge', iconWrite: await writeIcons() };
    }
    return queued;
  }

  const editorCheck = unityMgr.validateUnityEditorPathSetting();
  if (!editorCheck?.ok) return { ok: false, error: editorCheck?.error || 'unity_editor_not_found' };
  if (unityMgr.isUnityProjectLocked(projectPath)) {
    const prep = ensureUnityLiveImporterReady(projectPath);
    if (!prep?.ok) return { ok: false, error: prep?.error || 'prepare_unity_project_failed' };
    const queued = enqueueUnityLiveImport(projectPath, validPaths, renameEntries);
    if (queued?.ok) {
      appendHistory();
      return { ...queued, mode: 'live_bridge', iconWrite: await writeIcons() };
    }
    return queued;
  }
  const batchPrep = ensureUnityBatchImporterReady(projectPath);
  if (!batchPrep?.ok) return { ok: false, error: batchPrep?.error || 'prepare_unity_project_failed' };
  const lock = unityMgr.acquireBackgroundImportProjectLock(projectPath);
  if (!lock?.ok) return { ok: false, error: lock?.error || 'background_import_already_running' };
  let result;
  try {
    result = await unityMgr.runUnityBatchImport(projectPath, validPaths, null, { renameEntries });
  } finally {
    unityMgr.releaseBackgroundImportProjectLock(lock.key);
  }
  if (result?.ok) {
    appendHistory();
    return { ...result, mode: 'background', iconWrite: await writeIcons() };
  }
  return result;
}

// MCP wave 2 adapters. Keep these at the application boundary so the tool
// dispatcher can remain Electron-free and the existing UI managers stay the
// single source of truth for state and side effects.
function mcpResolveAsset(itemId) {
  const id = String(itemId || '').trim();
  return mcpAssetRows().find((row) => String(row?.itemId || '').trim() === id) || null;
}

function mcpAssetTitle(asset, itemId) {
  return String(asset?.title || asset?.itemName || asset?.name || itemId || '').trim();
}

function mcpItemDirectory(itemId) {
  const asset = mcpResolveAsset(itemId);
  if (!asset) return { asset: null, title: '', itemDir: '' };
  const id = String(itemId || '').trim();
  const title = mcpAssetTitle(asset, id);
  return { asset, title, itemDir: buildItemDir(id, title) };
}

function mcpGetOperationLogs(max) {
  const rows = typeof logMgr.getOperationLogs === 'function' ? logMgr.getOperationLogs() : [];
  return (Array.isArray(rows) ? rows : []).slice(-Math.max(1, Math.min(1000, Number(max) || 50)));
}

function mcpListItemFiles({ itemId, limit: max = 50 } = {}) {
  const ref = mcpItemDirectory(itemId);
  if (!ref.asset) return { ok: false, error: 'item_not_found', files: [] };
  const extractedRoot = path.join(ref.itemDir, '__extracted');
  if (!fs.existsSync(extractedRoot)) return { ok: false, error: '__extracted_not_found', files: [] };

  const rowLimit = Math.max(1, Math.min(1000, Number(max) || 50));
  const files = [];
  const stack = [{ dir: extractedRoot, base: '', depth: 0 }];
  let truncated = false;
  while (stack.length && files.length < rowLimit) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files.length >= rowLimit) {
        truncated = true;
        break;
      }
      // Do not follow junctions or symbolic links. In particular, never call
      // statSync on a symlink because that would resolve it outside the item.
      if (entry.isSymbolicLink?.()) continue;
      const relPath = path.join(current.base, entry.name);
      const fullPath = path.join(current.dir, entry.name);
      let stat;
      try {
        stat = fs.lstatSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      const common = {
        name: entry.name,
        relPath: relPath.replace(/\\/g, '/'),
        fullPath,
        size: stat.isFile() ? stat.size : 0,
        mtime: stat.mtimeMs,
      };
      if (stat.isDirectory()) {
        files.push({ ...common, kind: 'dir' });
        if (current.depth < MAX_LIST_ITEM_DEPTH) {
          stack.push({ dir: fullPath, base: relPath, depth: current.depth + 1 });
        } else {
          truncated = true;
        }
      } else if (stat.isFile()) {
        files.push({ ...common, kind: 'file' });
      }
    }
  }
  if (files.length >= rowLimit && stack.length) truncated = true;
  return { files, truncated, limit: rowLimit };
}

function mcpListUnityPackages({ itemId } = {}) {
  const ref = mcpItemDirectory(itemId);
  if (!ref.asset) return { ok: false, error: 'item_not_found', packages: [] };
  const extractedRoot = path.join(ref.itemDir, '__extracted');
  if (!fs.existsSync(extractedRoot)) return { ok: false, error: '__extracted_not_found', packages: [] };
  return { itemId: String(itemId || '').trim(), title: ref.title, packages: listUnityPackagesInDir(extractedRoot) };
}

function mcpGetProjectItems({ projectPath } = {}) {
  const target = normalizeProjectPath(projectPath);
  if (!target) return { items: [] };
  const history = loadImportHistory();
  const items = [];
  for (const [itemId, rows] of Object.entries(history || {})) {
    const matched = (Array.isArray(rows) ? rows : [])
      .filter((row) => normalizeProjectPath(row?.projectPath || '') === target);
    if (!matched.length) continue;
    matched.sort((a, b) => new Date(b?.importedAt || 0).getTime() - new Date(a?.importedAt || 0).getTime());
    const latest = matched[0] || {};
    items.push({
      itemId: String(itemId),
      title: String(latest?.title || ''),
      count: matched.length,
      lastImportedAt: latest?.importedAt || '',
      topFolder: latest?.topFolders?.[0]?.name || '',
      tokens: Array.isArray(latest?.tokens) ? latest.tokens : [],
      reconciled: Boolean(latest?.reconciled),
    });
  }
  items.sort((a, b) => new Date(b.lastImportedAt || 0).getTime() - new Date(a.lastImportedAt || 0).getTime());
  return { projectPath: target, items };
}

async function mcpSearchBooth(args = {}) {
  return await searchBoothItems(args);
}

async function mcpGetBoothItem({ itemId } = {}) {
  return await fetchBoothItemDetailAuthenticated(itemId);
}

async function mcpListBootstrapChoices() {
  const [variants, rules] = await Promise.all([
    listAutoBootstrapVariantOptions(),
    listAutoBootstrapRuleChoices(),
  ]);
  return { variants, rules };
}

async function mcpControlDownloadQueue({ action } = {}) {
  const state = queueMgr.getQueueState();
  if (action === 'stop') {
    state.paused = true;
  } else if (action === 'resume') {
    state.paused = false;
  } else if (action === 'retry_failed') {
    const retryTargets = Array.isArray(state.failed) ? state.failed.splice(0, state.failed.length) : [];
    for (const failed of retryTargets) {
      state.queued.push({
        itemId: failed.itemId,
        title: failed.title || '',
        attempt: 0,
        nextRunAt: 0,
        asset: failed.asset,
        source: 'retry-failed',
      });
    }
    state.paused = false;
  }
  queueMgr.emitQueueStatus(mainWindow?.webContents);
  if ((action === 'resume' || action === 'retry_failed') && !state.paused) {
    processQueue(mainWindow?.webContents).catch((error) => console.warn('MCP queue processing failed:', error?.message || error));
  }
  return { ok: true, queue: getQueueStatus() };
}

async function mcpExtractItem({ itemId, force = false } = {}) {
  const ref = mcpItemDirectory(itemId);
  if (!ref.asset) return { ok: false, error: 'item_not_found' };
  if (!fs.existsSync(ref.itemDir)) return { ok: false, error: 'item_dir_not_found' };
  const extractedRoot = path.join(ref.itemDir, '__extracted');
  if (force && fs.existsSync(extractedRoot)) {
    fs.rmSync(extractedRoot, { recursive: true, force: true });
  }
  await extractArchivesInItemDir(ref.itemDir, { itemId: String(itemId || '').trim(), title: ref.title });
  return { ok: true, itemId: String(itemId || '').trim(), title: ref.title };
}

async function mcpInstallVpmDependencies({ projectPath, modularAvatar = false, liltoon = false } = {}) {
  const target = normalizeProjectPath(projectPath);
  if (!target || !fs.existsSync(target)) return { ok: false, error: 'project_not_found' };
  if (!isRegisteredUnityProject(target)) return { ok: false, error: 'project_not_registered' };
  if (!modularAvatar && !liltoon) return { ok: false, error: 'no_dependencies_selected' };
  const result = { ok: true, projectPath: target };
  if (modularAvatar) {
    result.modularAvatar = await ensureModularAvatarDependency(target);
    if (result.modularAvatar?.ok === false || result.modularAvatar?.error) return { ...result, ok: false, error: result.modularAvatar.error || 'modular_avatar_install_failed' };
  }
  if (liltoon) {
    result.liltoon = await ensureLiltoonDependency(target);
    if (result.liltoon?.ok === false || result.liltoon?.error) return { ...result, ok: false, error: result.liltoon.error || 'liltoon_install_failed' };
  }
  return result;
}

function mcpRunAutoBootstrap({ projectPath } = {}) {
  const target = normalizeProjectPath(projectPath);
  if (!target || !fs.existsSync(target)) return { ok: false, error: 'project_not_found' };
  if (!isRegisteredUnityProject(target)) return { ok: false, error: 'project_not_registered' };
  enqueueAutoBootstrap(target, 'mcp');
  return { ok: true, queued: true, projectPath: target };
}

// Wave 3 MCP adapters. Package paths are deliberately relative to the
// selected library item's __extracted directory. Never let an MCP caller turn
// the package scanner into an arbitrary local-file reader.
function mcpIsPathUnder(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  const rel = path.relative(base, target);
  return Boolean(rel) && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
}

function mcpPackageResultPath(extractedRoot, packagePath) {
  const rootStat = fs.lstatSync(extractedRoot);
  if (rootStat.isSymbolicLink()) throw new Error('extracted_root_symlink_not_allowed');
  const realRoot = fs.realpathSync(extractedRoot);
  const resolved = path.resolve(packagePath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('package_not_regular_file');
  const realPackage = fs.realpathSync(resolved);
  if (!mcpIsPathUnder(realRoot, realPackage)) throw new Error('package_outside_extracted_root');
  if (!String(realPackage).toLowerCase().endsWith('.unitypackage')) throw new Error('not_unitypackage');
  return realPackage;
}

function mcpExtractedUnityPackages({ itemId, packagePath } = {}) {
  const ref = mcpItemDirectory(itemId);
  if (!ref.asset) return { ok: false, error: 'item_not_found', packages: [] };
  const extractedRoot = path.join(ref.itemDir, '__extracted');
  if (!fs.existsSync(extractedRoot)) return { ok: false, error: '__extracted_not_found', packages: [] };

  try {
    let packages;
    if (packagePath !== undefined && packagePath !== null && String(packagePath).trim()) {
      const rawPath = String(packagePath).trim();
      const normalizedPath = rawPath.replace(/\\/g, '/');
      if (path.isAbsolute(rawPath) || /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(rawPath)) {
        return { ok: false, error: 'absolute_package_path_not_allowed', packages: [] };
      }
      if (normalizedPath.split('/').includes('..')) {
        return { ok: false, error: 'package_path_traversal_not_allowed', packages: [] };
      }
      const candidate = safeResolveUnder(extractedRoot, normalizedPath);
      packages = [mcpPackageResultPath(extractedRoot, candidate)];
    } else {
      packages = listUnityPackagesInDir(extractedRoot)
        .map((candidate) => {
          try { return mcpPackageResultPath(extractedRoot, candidate); } catch { return ''; }
        })
        .filter(Boolean);
    }
    return {
      ok: true,
      itemId: String(itemId || '').trim(),
      title: ref.title,
      extractedRoot: fs.realpathSync(extractedRoot),
      packages: Array.from(new Set(packages)),
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), packages: [] };
  }
}

function mcpRelativePackagePath(extractedRoot, packagePath) {
  return path.relative(extractedRoot, packagePath).replace(/\\/g, '/');
}

async function mcpGetBoothCart({ shopSubdomain = '' } = {}) {
  try {
    return await runWithBoothCookieLoginFallback(async () => {
      if (typeof fetchBoothCart !== 'function') return { error: 'unavailable' };
      return await fetchBoothCart(String(shopSubdomain || ''));
    });
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

function mcpListSettingsProfiles() {
  const profiles = settingsMgr.getSettingsProfiles();
  return { ok: true, names: Object.keys(profiles || {}).sort((a, b) => a.localeCompare(b, 'ja')) };
}

function mcpGetImportHistory({ itemId, limit: max = 100 } = {}) {
  const rowLimit = Math.max(1, Math.min(1000, Number(max) || 100));
  const history = loadImportHistory();
  const requestedItemId = String(itemId || '').trim();
  if (requestedItemId) {
    const rows = Array.isArray(history?.[requestedItemId]) ? history[requestedItemId] : [];
    const sorted = [...rows].sort((a, b) => new Date(b?.importedAt || 0).getTime() - new Date(a?.importedAt || 0).getTime());
    return { itemId: requestedItemId, history: sorted.slice(0, rowLimit), returned: Math.min(sorted.length, rowLimit), total: sorted.length };
  }
  const rows = [];
  for (const [id, entries] of Object.entries(history || {})) {
    for (const entry of (Array.isArray(entries) ? entries : [])) rows.push({ itemId: String(id), ...entry });
  }
  rows.sort((a, b) => new Date(b?.importedAt || 0).getTime() - new Date(a?.importedAt || 0).getTime());
  return { history: rows.slice(0, rowLimit), returned: Math.min(rows.length, rowLimit), total: rows.length };
}

async function mcpScanUnitypackage({ itemId, packagePath } = {}) {
  const resolved = mcpExtractedUnityPackages({ itemId, packagePath });
  if (!resolved.ok) return resolved;
  if (!resolved.packages.length) return { ...resolved, error: 'no_unitypackages' };
  const candidateTokens = ['modularavatar', 'ndmf', 'liltoon', 'vrcfury', 'avataroptimizer', 'avatar-optimizer', 'poiyomi'];
  const scan = await runReconcileWorker('scan_batch', {
    packages: resolved.packages.map((pkgPath) => ({ pkgPath, candidateTokens })),
  });
  const resultRows = Array.isArray(scan?.results) ? scan.results : [];
  const extractedRoot = resolved.extractedRoot;
  const packages = resolved.packages.map((pkgPath, index) => {
    const row = resultRows[index] || { ok: false, error: scan?.error || 'scan_failed' };
    return {
      packagePath: mcpRelativePackagePath(extractedRoot, pkgPath),
      ok: row.ok === true,
      error: row.ok === true ? undefined : (row.error || 'scan_failed'),
      topFolders: Array.isArray(row.topFolders) ? row.topFolders : [],
      tokens: Array.isArray(row.tokens) ? row.tokens : [],
      assetPathCount: Array.isArray(row.assetPaths) ? row.assetPaths.length : 0,
    };
  });
  return { ok: scan?.ok === true, itemId: resolved.itemId, title: resolved.title, packages };
}

async function mcpAnalyzeVpmDependencies({ projectPath, itemId } = {}) {
  const target = normalizeProjectPath(projectPath);
  if (!target || !fs.existsSync(target)) return { ok: false, error: 'project_not_found' };
  if (!isRegisteredUnityProject(target)) return { ok: false, error: 'project_not_registered' };

  let packageRows = [];
  let packageInfo = null;
  const id = String(itemId || '').trim();
  if (id) {
    packageInfo = mcpExtractedUnityPackages({ itemId: id });
    if (!packageInfo.ok) return packageInfo;
    packageRows = packageInfo.packages.map((packagePath) => ({ packagePath, meta: {} }));
  }
  const result = await analyzeImportToolDependencies(target, packageRows);
  return {
    ...result,
    projectPath: target,
    itemId: id || null,
    packageCount: packageRows.length,
  };
}

function mcpGetRuntimeLogs({ limit: max = 200 } = {}) {
  const rowLimit = Math.max(1, Math.min(2000, Number(max) || 200));
  const logs = runtimeLogBuffer.slice(-rowLimit);
  return { ok: true, logs, returned: logs.length };
}

async function mcpCheckAppUpdate() {
  // --mcp-only intentionally skips normal startup initialization. This setup
  // is idempotent and explicitly keeps auto-download disabled in app_updater.
  setupAppUpdater();
  return await checkForAppUpdate(false);
}

async function mcpSetWishlist({ itemId, wishlisted } = {}) {
  try {
    return await runWithBoothCookieLoginFallback(async () => {
      const id = String(itemId || '').trim();
      if (!id) return { error: 'itemId_required' };
      if (typeof wishlisted !== 'boolean') return { error: 'wishlisted_required' };
      let meta = [];
      if (fs.existsSync(META_PATH)) {
        try { meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch { meta = []; }
        if (!Array.isArray(meta)) meta = [];
      }
      const existing = meta.find((row) => String(row?.itemId || '') === id);
      if (existing) {
        const current = Boolean(existing.isWishlisted);
        if (current === wishlisted) {
          const boothResult = wishlisted
            ? await wishlistService.addItemToAvatoolWishListName(id)
            : await wishlistService.removeItemFromAvatoolWishListName(id);
          if (!boothResult?.ok) {
            return {
              ok: false,
              partial: true,
              localChanged: false,
              boothSynced: false,
              boothError: boothResult?.error || 'booth_wishlist_sync_failed',
              itemId: id,
              isWishlisted: wishlisted,
              changed: false,
            };
          }
          return { ok: true, itemId: id, isWishlisted: wishlisted, changed: false, localChanged: false, boothSynced: true };
        }
        writeMetaFile(meta.map((row) => String(row?.itemId || '') === id ? { ...row, isWishlisted: wishlisted } : row));
        const boothResult = wishlisted
          ? await wishlistService.addItemToAvatoolWishListName(id)
          : await wishlistService.removeItemFromAvatoolWishListName(id);
        if (!boothResult?.ok) {
          return {
            ok: false,
            partial: true,
            localChanged: true,
            boothSynced: false,
            boothError: boothResult?.error || 'booth_wishlist_sync_failed',
            itemId: id,
            isWishlisted: wishlisted,
            changed: true,
          };
        }
        return { ok: true, itemId: id, isWishlisted: wishlisted, changed: true, localChanged: true, boothSynced: true };
      }
      if (!wishlisted) return { ok: false, error: 'item_not_found' };
      const resolved = await wishlistService.resolveWishlistCandidate(id, { syncBooth: false });
      if (!resolved?.ok) return { error: resolved?.error || 'wishlist_candidate_resolution_failed' };
      writeMetaFile(dedupeMetaItemsByItemId([...meta, resolved.item]));
      const resolvedItemId = String(resolved.itemId || id);
      const boothResult = await wishlistService.addItemToAvatoolWishListName(resolvedItemId);
      if (!boothResult?.ok) {
        return {
          ok: false,
          partial: true,
          localChanged: true,
          boothSynced: false,
          boothError: boothResult?.error || 'booth_wishlist_sync_failed',
          itemId: resolvedItemId,
          isWishlisted: true,
          changed: true,
        };
      }
      return { ok: true, itemId: resolvedItemId, isWishlisted: true, changed: true, localChanged: true, boothSynced: true };
    });
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

async function mcpImportBoothWishlist() {
  try {
    return await runWithBoothCookieLoginFallback(async () => {
      const result = await wishlistService.importBoothWishlist();
      return result;
    });
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

async function mcpAddToBoothCart({ itemId, variationName } = {}) {
  try {
    return await runWithBoothCookieLoginFallback(async () => {
      if (typeof addWishlistItemToBoothCart !== 'function') return { error: 'cart_api_unavailable' };
      return await addWishlistItemToBoothCart(String(itemId || '').trim(), variationName ? String(variationName) : undefined);
    });
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

function mcpApplyRuntimeSettings(nextSettings, trigger) {
  const merged = { ...settingsMgr.getSettings(), ...settingsMgr.pickAllowedSettings(nextSettings || {}) };
  settingsMgr.normalizeSettingsInPlace(merged);
  saveSettings(merged);
  queueMgr.getQueueState().concurrency = merged.concurrency;
  ensureRuntimeDirs();
  ensureFolderIconBootstrapForProjects(merged.unityProjects, trigger);
  startAutoCheckTimer();
  startDownloadScheduler();
  startAppUpdateAutoCheckTimer();
  syncWindowsStartupRegistration();
  return settingsMgr.getSettings();
}

function mcpAssertNoSensitiveSettingsInput(patch) {
  for (const key of Object.keys(patch || {})) {
    if (/(?:cookie|token|secret|password|passwd|authorization|csrf|credential|session)/i.test(key)) {
      throw new Error('sensitive_setting_not_allowed');
    }
  }
}

function mcpUpdateSettings({ patch } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'settings_patch_required' };
  try {
    mcpAssertNoSensitiveSettingsInput(patch);
    return { ok: true, settings: mcpApplyRuntimeSettings(patch, 'mcp-update-settings') };
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

function mcpProfileName(value) {
  const name = String(value || '').trim();
  if (!name) return '';
  if (name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) return '';
  return name;
}

function mcpApplySettingsProfile({ profileName } = {}) {
  const name = mcpProfileName(profileName);
  if (!name) return { error: 'profile_name_required' };
  const profile = settingsMgr.getSettingsProfiles()?.[name];
  if (!profile || typeof profile !== 'object') return { error: 'profile_not_found' };
  try {
    const settingsResult = mcpApplyRuntimeSettings(profile, 'mcp-apply-settings-profile');
    appendOperationLog('settings-profile', `MCP applied settings profile: ${name}`);
    return { ok: true, name, settings: settingsResult };
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

function mcpSaveSettingsProfile({ profileName, patch } = {}) {
  const name = mcpProfileName(profileName);
  if (!name) return { error: 'profile_name_required' };
  if (patch !== undefined && (!patch || typeof patch !== 'object' || Array.isArray(patch))) return { error: 'settings_patch_invalid' };
  try {
    mcpAssertNoSensitiveSettingsInput(patch || {});
  } catch (error) {
    return { error: error?.message || String(error) };
  }
  const data = {
    ...settingsMgr.getSettings(),
    ...settingsMgr.pickAllowedSettings(patch || {}),
  };
  settingsMgr.normalizeSettingsInPlace(data);
  const profiles = settingsMgr.getSettingsProfiles();
  const hadPrevious = Object.prototype.hasOwnProperty.call(profiles, name);
  const previous = profiles[name];
  profiles[name] = data;
  try {
    settingsMgr.saveSettingsProfiles();
    appendOperationLog('settings-profile', `MCP saved settings profile: ${name}`);
    return { ok: true, name };
  } catch (error) {
    if (hadPrevious) profiles[name] = previous;
    else delete profiles[name];
    return { error: error?.message || String(error) };
  }
}

function mcpClearOperationLogs() {
  logMgr.clearOperationLogs();
  saveOperationLogs();
  appendOperationLog('operation-log', 'Operation logs cleared via MCP');
  return { ok: true, logs: [] };
}

const mcpTools = createMcpToolService({
  metaMgr: { getMetaCache: mcpAssetRows },
  settingsMgr: { getSettings: () => settings },
  unityMgr: { listRunningUnityProjectPaths },
  queueMgr,
  logMgr,
  appVersion: app.getVersion?.() || require('./package.json').version,
  syncLibrary: mcpSyncLibrary,
  enqueueDownload: mcpEnqueueDownload,
  importAssetToUnity: mcpImportAssetToUnity,
  getOperationLogs: mcpGetOperationLogs,
  runHealthCheck: () => runHealthCheck('mcp'),
  getStorageUsage: getStorageUsageSnapshot,
  listItemFiles: mcpListItemFiles,
  listUnityPackages: mcpListUnityPackages,
  getProjectItems: mcpGetProjectItems,
  searchBooth: mcpSearchBooth,
  getBoothItem: mcpGetBoothItem,
  listBootstrapChoices: mcpListBootstrapChoices,
  controlDownloadQueue: mcpControlDownloadQueue,
  extractItem: mcpExtractItem,
  installVpmDependencies: mcpInstallVpmDependencies,
  runAutoBootstrap: mcpRunAutoBootstrap,
  getBoothCart: mcpGetBoothCart,
  listSettingsProfiles: mcpListSettingsProfiles,
  getImportHistory: mcpGetImportHistory,
  scanUnitypackage: mcpScanUnitypackage,
  analyzeVpmDependencies: mcpAnalyzeVpmDependencies,
  getRuntimeLogs: mcpGetRuntimeLogs,
  checkAppUpdate: mcpCheckAppUpdate,
  setWishlist: mcpSetWishlist,
  importBoothWishlist: mcpImportBoothWishlist,
  addToBoothCart: mcpAddToBoothCart,
  updateSettings: mcpUpdateSettings,
  applySettingsProfile: mcpApplySettingsProfile,
  saveSettingsProfile: mcpSaveSettingsProfile,
  clearOperationLogs: mcpClearOperationLogs,
});
const mcpControl = createMcpControlServer({
  endpointPath: path.join(APP_DATA_ROOT, 'mcp-endpoint.json'),
  version: app.getVersion?.() || require('./package.json').version,
  allowedTools: mcpTools.allowedTools,
  callTool: mcpTools.callTool,
});
function startMcpControl() {
  mcpControl.start().catch((error) => console.warn('MCP control server failed to start:', error?.message || error));
}
function stopMcpControl() {
  mcpControl.stop().catch((error) => console.warn('MCP control server failed to stop:', error?.message || error));
}

function syncWindowsStartupRegistration() {
  ensureWindowsStartupRegistration({
    app,
    processObj: process,
    enabled: Boolean(settings.launchAtLogin),
  });
}

setupSingleInstanceLock({
  app,
  processObj: process,
  getMainWindow: () => mainWindow,
});

// --smoke-test モード: Cookie 復号・Booth API 疎通のみ確認して終了
if (process.argv.includes('--smoke-test')) {
  app.whenReady().then(async () => {
    await runBoothSmokeTest({
      app,
      appDataRoot: APP_DATA_ROOT,
      path,
      axios,
      readBoothCookiesFromFile,
    });
  });
} else if (process.argv.includes('--mcp-only')) {
  // Headless bridge mode: initialize the same managers, but do not start UI,
  // schedulers, VCC watchers, health checks, update checks, or bootstrap work.
  app.whenReady().then(() => {
    startMcpControl();
  });
} else {

app.whenReady().then(() => {
  startMcpControl();
  if (process.platform === 'win32') app.setAppUserModelId(DESKTOP_NOTIFY_APP_ID);
  syncWindowsStartupRegistration();
  const scriptSync = ensureInstallScriptsAssets();
  if (!scriptSync?.ok) {
    console.warn('Failed to prepare install scripts asset:', scriptSync?.error || 'unknown_error');
  }
  createWindow();
  setupAppUpdater();
  if (settings.appUpdateAutoCheckEnabled !== false) {
    setTimeout(() => {
      checkForAppUpdate(false).catch(() => {});
    }, 5000);
  }
  startAppUpdateAutoCheckTimer();
  startAutoCheckTimer();
  startDownloadScheduler();
  // Initial sync + live watch
  syncVccProjectsToSettings('startup');
  startVccWatcher();
  runStartupBootstrapDownloads().catch(() => {});
  if (settings.healthCheckOnStartup !== false) {
    setTimeout(() => {
      runHealthCheck('startup').catch(() => {});
    }, 1200);
  }
});

} // end of non-smoke-test block

app.on('window-all-closed', () => {
  stopMcpControl();
  stopVccWatcher();
  schedulerSvc.stopAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopMcpControl();
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  startVccWatcher();
});

const uiProbeService = createUiProbeService({
  getMainWindow: () => mainWindow,
  fs,
  path,
  app,
  appDataRoot: APP_DATA_ROOT,
});

ipcMain.on('renderer-ready', (event) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (event.sender !== mainWindow.webContents) return;
  rendererReady = true;
  rendererFatalState = null;
  if (recoveryWindow && !recoveryWindow.isDestroyed()) {
    closeRecoveryWindow();
  }
  try {
    mainWindow.show();
    mainWindow.focus();
  } catch { /* 表示/フォーカス失敗はウィンドウが既に表示済みの場合等に起こり得るため無視 */ }
  if (uiProbeService.isUiProbeEnabled()) {
    setTimeout(() => {
      uiProbeService.runUiProbe().catch((e) => {
        console.error('[ui-probe] failed:', e?.stack || e?.message || e);
        try { app.exit(1); } catch { /* デバッグ用終了処理の失敗は無視 */ }
      });
    }, 300);
  }
});

ipcMain.on('renderer-fatal-error', (event, payload = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (event.sender !== mainWindow.webContents) return;
  if (rendererReady) {
    const loc = [payload?.filename, payload?.lineno].filter(Boolean).join(':');
    const stackLine = String(payload?.stack || '').split('\n').find((l) => l.trim().startsWith('at')) || '';
    console.error('[main] renderer uncaught error after ready:', payload?.message || 'unknown',
      loc ? `@ ${loc}` : '', stackLine ? `| ${stackLine.trim()}` : '');
    return;
  }
  showRendererRecovery('renderer-fatal-error', payload || {});
});

ipcMain.handle('get-renderer-recovery-state', async () => {
  return getRendererRecoveryState();
});

ipcMain.handle('reopen-main-window', async () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
  } catch { /* 破棄失敗時も新規ウィンドウ作成を優先して続行 */ }
  createWindow();
  return { ok: true, sessionId: rendererBootSessionId };
});

ipcMain.handle('restart-app', async () => {
  setImmediate(() => {
    try {
      app.relaunch();
      app.exit(0);
    } catch { /* 再起動処理の失敗は無視(呼び出し元は既にok:trueを返却済み) */ }
  });
  return { ok: true };
});

ipcMain.handle('open-runtime-log-window', async () => {
  openLogWindow();
  return { ok: true };
});

// Load existing library meta or generate it when missing.
async function loadOrGenerateMeta(event, progressScope = 'load-assets') {
  return await metaMgr.loadOrGenerateMeta(event, progressScope);
}

const queueSenderRef = {};
Object.defineProperty(queueSenderRef, 'value', {
  get() { return queueSender; },
  set(v) { queueSender = v; },
});

const wishlistService = createWishlistService({
  getBoothClient: () => boothClient,
  ensureClientReady,
  extractBoothItemId,
  extractBoothCsrfFromHtml,
  metaMgr,
  fs,
  META_PATH,
  dedupeMetaItemsByItemId,
  writeMetaFile,
});

registerIpcHandlers({
  ipcMain,
  settingsMgr: {
    getSettings: () => settings,
    getSettingsProfiles: () => settingsProfiles,
    normalizeProjectPath,
    normalizeSettingsInPlace: settingsMgr.normalizeSettingsInPlace,
    pickAllowedImportSettings,
    pickAllowedSettings,
    saveSettings,
    saveSettingsProfiles,
  },
  logMgr: {
    appendOperationLog,
    appendUnityBatchLog: (...args) => logMgr.appendUnityBatchLog(...args),
    appendUnityImportLog: (...args) => logMgr.appendUnityImportLog(...args),
    clearOperationLogs: () => { logMgr.clearOperationLogs(); },
    getOperationLogs: () => logMgr.getOperationLogs(),
    sanitizeRendererLogText,
  },
  appUpdater,
  agentIntegrationService,
  appEdition: APP_EDITION,
  ownerVaultService,
  getOwnerStandardDataStatus,
  importStandardDataToOwner,
  metaMgr: {
    applyVersionTrackingKeepingManual,
    ensureMetaWithVersionTracking,
    getKnownPurchasedItemIds: metaMgr.getKnownPurchasedItemIds,
    getMetaCache: () => metaMgr.getMetaCache(),
    loadOrGenerateMeta,
    toAssetMap,
  },
  downloadQueue: {
    buildItemDir,
    checkDiskSpaceGuard,
    emitQueueStatus,
    ensureClientReady,
    getQueueState: () => queueMgr.getQueueState(),
    setQueueSender: (sender) => {
      queueSender = sender;
      if (typeof queueMgr.setQueueSender === 'function') {
        queueMgr.setQueueSender(sender);
      }
    },
    processQueue,
  },
  vpmMgr: {
    installLocalVpmPackageFromRepo,
  },
  unityMgr: {
    acquireBackgroundImportProjectLock,
    analyzeImportToolDependencies,
    appendImportHistory,
    appendSimpleFolderIconToBatchPackages,
    buildPackageMetasAdaptive,
    canRunUnityImport,
    extractVpmAutoInstallerConfig: (...args) => unityMgr.extractVpmAutoInstallerConfig(...args),
    fillPackageMetaByScan,
    installImportToolDependencies,
    isUnityProjectLocked,
    listRunningUnityProjectPaths,
    loadImportHistory,
    planTopFolderRenames,
    releaseBackgroundImportProjectLock,
    runUnityBatchImport,
    selectProjectPathForOsAssociation,
    validateImportPackages,
    validateUnityEditorPathSetting,
  },
  app,
  shell,
  dialog,
  BrowserWindow,
  session,
  getMainWindow: () => mainWindow,
  getLoginWindow: loginWindowMgr.getLoginWindow,
  setLoginWindow: loginWindowMgr.setLoginWindow,
  getLogWindow: () => logWindow,
  getBoothClient: () => boothClient,
  getBoothCookies: () => boothCookies,
  setBoothClient: (v) => { boothClient = v; },
  setBoothCookies: (v) => { boothCookies = v; },
  TEMP_COOKIE_PATH,
  BOOTH_LOGIN_PARTITION,
  LOGIN_ALLOWED_HOST_SUFFIXES,
  LOGIN_ALLOWED_PROTOCOLS,
  ITEM_ID_INPUT_RE,
  MAX_ITEM_TITLE_INPUT,
  RENDERER_LOG_MAX_EVENTS_PER_SEC,
  LEGACY_APP_ROOT,
  APP_DATA_ROOT,
  DEFAULT_SETTINGS,
  appendRuntimeLog,
  ORIG_CONSOLE,
  runtimeLogBuffer,
  readBoothCookiesFromFile,
  writeBoothCookiesToFile,
  validateBoothLogin,
  probeBoothLibrary,
  persistBoothCookies,
  runWithBoothCookieLoginFallback,
  refreshMetaAfterLoginDedup,
  getStorageUsageSnapshot,
  getQueueStatus,
  startAutoCheckTimer,
  maybeRunScheduledDownloads,
  startDownloadScheduler,
  startAppUpdateAutoCheckTimer,
  syncWindowsStartupRegistration,
  runHealthCheck,
  openLoginWindowFlow: loginWindowMgr.openLoginWindowFlow,
  enrichUpdatesWithVersionDiff,
  backfillCategoriesForItemIds,
  extractBoothItemId,
  createManualFreeMetaItem,
  resolveManualFreeAssetCandidate,
  resolveWishlistCandidate: wishlistService.resolveWishlistCandidate,
  addItemToAvatoolWishListName: wishlistService.addItemToAvatoolWishListName,
  removeItemFromAvatoolWishListName: wishlistService.removeItemFromAvatoolWishListName,
  importBoothWishlist: wishlistService.importBoothWishlist,
  addWishlistItemToBoothCart,
  fetchBoothCart,
  toBoothCategoryRowsFromItemJson,
  parseAutoBootstrapChoiceKey,
  listAutoBootstrapVariantOptions,
  listAutoBootstrapRuleChoices,
  enqueueAutoBootstrap,
  fs,
  path,
  pendingZipOversizeConfirms,
  pendingArchivePasswords,
  electronAutoUpdater,
  normalizeBoothCookies,
  isBoothDomain,
  cookieUrlFromRecord,
  persistTempBoothCookies,
  readVccProjectsFile,
  runReconcileWorker,
  isRegisteredUnityProject,
  normalizeItemRefInput,
  isFolderIconBootstrapEnabled,
  ensureUnityFolderIconBootstrapReady,
  ensureFolderIconBootstrapForProjects,
  appendReconciledImportHistory,
  writeReconcileLog,
  writeReconcileLogBatch,
  getRecommendedReconcileWorkerCount,
  getProjectIndexCached,
  setProjectIndexCache,
  getCpuCount,
  RECONCILE_LOG_PATH,
  MAX_LIST_ITEM_FILES,
  MAX_LIST_ITEM_DEPTH,
  safeResolveUnder,
  normalizeImportMode,
  META_PATH,
  VCC_SETTINGS_PATH,
  writeMetaFile,
  fetchItemPricePublic,
  searchBoothItems,
  fetchBoothItemDetail: fetchBoothItemDetailAuthenticated,
  fetchBoothHomeSections,
  fetchBoothRelatedItems,
  runWishlistPriceCheck,
  showDesktopNotification,
  Notification,
  normalizeAndPersistMeta,
  dedupeMetaItemsByItemId,
  generateFilesHash,
  generateFilesStableHash,
  dbgUpdate,
  sendDownloadProgress,
  downloadItemFiles,
  extractArchivesInItemDir,
  generateLibraryMeta,
  checkLibraryHasNewItems,
  enrichMetaSupportedAvatarsFromFolders: (...args) => metaMgr.enrichMetaSupportedAvatarsFromFolders(...args),
  syncAvatarItemsToFile,
  fixAvatarItemFields,
  ensureRuntimeDirs,
  resolveExportBundlePath,
  saveOperationLogs,
  readJsonFileSafe,
  queueSenderRef,
  ensureUnityBatchImporterReady,
  ensureUnityLiveImporterReady,
  enqueueUnityLiveImport,
  writeSimpleFolderIcons,
  installSimpleFolderIconAsPackage,
});
