const { app, BrowserWindow, ipcMain, shell, session, Notification, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
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
const { toFiniteNumber, normalizeHour, normalizeRetryAttempts, normalizeRetryBaseDelayMs, normalizeZipMaxEntryBytes, sanitizePathSegment, safeResolveUnder, dedupeDownloadLinks: dedupeDownloadLinksUtil, isWithinHourWindow } = require('./lib/utils');
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
  _test: {
    enrichItemAvatarMetadata,
  },
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
let postLoginRefreshPromise = null;
let rendererBootSessionId = 0;
let rendererReady = false;
let rendererFatalState = null;
const LEGACY_APP_ROOT = __dirname;
function resolveAppDataRoot() {
  const fromEnv = String(process.env.AVATOOL_DATA_DIR || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  try {
    const userData = app.getPath('userData');
    if (userData) return path.join(userData, 'data');
  } catch {
    // ignore
  }
  return path.join(LEGACY_APP_ROOT, '.data');
}
const APP_DATA_ROOT = resolveAppDataRoot();
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
  appUpdater.setupAppUpdater();
}

async function checkForAppUpdate(manual = false) {
  return await appUpdater.checkForAppUpdate(manual);
}

async function startAppUpdateDownload() {
  return await appUpdater.startAppUpdateDownload();
}

async function installAppUpdateNow() {
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
  const win = getMainWindow();
  const sender = win?.webContents;
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
  } catch {}
  sendDesktopNotificationForAutoBootstrap(payload);
  const sender = mainWindow?.webContents;
  if (!sender || sender.isDestroyed?.()) return;
  sender.send('auto-bootstrap-status', payload);
}

function showDesktopNotification(title, body, imageUrl) {
  try {
    const supported = Boolean(Notification && Notification.isSupported?.());
    console.log('[NOTIFY][main]', `supported=${supported}`, String(title || ''), String(body || ''));
    if (!supported) return false;
    const opts = {
      title: String(title || 'Avatool'),
      body: String(body || ''),
      silent: false,
    };
    let imgSrc = null;
    if (typeof imageUrl === 'string' && imageUrl) {
      if (imageUrl.startsWith('https://')) {
        imgSrc = imageUrl;
      } else if (imageUrl.startsWith('file:///')) {
        imgSrc = imageUrl;
      } else if (imageUrl.length > 0) {
        // ローカルファイルパスを file:// URI に変換
        imgSrc = 'file:///' + imageUrl.replace(/\\/g, '/');
      }
    }
    if (imgSrc && process.platform === 'win32') {
      const esc = (s) => String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      opts.toastXml = [
        '<toast duration="long">',
        '<visual><binding template="ToastGeneric">',
        `<text>${esc(opts.title)}</text>`,
        `<text>${esc(opts.body)}</text>`,
        `<image src="${esc(imgSrc)}"/>`,
        '</binding></visual>',
        '</toast>',
      ].join('');
    }
    const n = new Notification(opts);
    n.show();
    return true;
  } catch (e) {
    console.warn('[notify] failed:', e?.message || e);
    return false;
  }
}

function formatElapsedMs(ms) {
  const n = Math.max(0, Number(ms || 0));
  const totalSec = Math.floor(n / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}秒`;
  return `${m}分${s}秒`;
}

function sendDesktopNotificationForAutoBootstrap(payload) {
  const phase = String(payload?.phase || '').trim();
  const source = String(payload?.source || '').trim();
  const projectName = path.basename(String(payload?.projectPath || '').trim()) || 'Project';
  const msg = String(payload?.message || '').trim();
  const elapsedMs = Number(payload?.elapsedMs || 0);
  const elapsedText = elapsedMs > 0 ? ` (所要時間: ${formatElapsedMs(elapsedMs)})` : '';
  const isStartup = source === 'startup';
  // Startup auto-download status is surfaced in-app via renderer messages only.
  if (isStartup) return;
  if (phase === 'started') {
    showDesktopNotification('自動インポート開始', `${projectName}: 自動インポートが作動中です。インポートと初期コンパイルを実行します。処理完了までこのプロジェクトを開かないでください。`);
    return;
  }
  if (phase === 'done') {
    showDesktopNotification('自動インポート完了', msg || `${projectName}: 自動インポートが完了しました。${elapsedText}`);
    return;
  }
  if (phase === 'skipped') {
    showDesktopNotification('自動インポートスキップ', msg || `${projectName}: 自動インポートはスキップされました。${elapsedText}`);
    return;
  }
  if (phase === 'error') {
    showDesktopNotification('自動インポート失敗', msg || `${projectName}: 自動インポートに失敗しました。${elapsedText}`);
  }
}

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

function backupCorruptedJson(filePath, rawText = '') {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dst = `${filePath}.corrupt.${stamp}.json`;
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, dst);
      return dst;
    }
    fs.writeFileSync(dst, String(rawText || ''), 'utf8');
    return dst;
  } catch {
    return '';
  }
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

const boothSessionMgr = createBoothSessionManager({
  axios,
  writeBoothCookiesToFile,
  defaultCookieFilePath: DEFAULT_SETTINGS.cookieFile,
  tempCookiePath: TEMP_COOKIE_PATH,
  getBoothClient: () => boothClient,
  setBoothClient: (v) => { boothClient = v; },
  getBoothCookies: () => boothCookies,
  setBoothCookies: (v) => { boothCookies = v; },
});

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
  try {
    if (!fs.existsSync(settings.downloadPath)) {
      fs.mkdirSync(settings.downloadPath, { recursive: true });
    }
  } catch (e) {
    console.warn('Failed to ensure runtime dirs:', e?.message || e);
  }
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

let queueSender = null;

function buildItemDir(itemId, title) {
  const safeItemId = sanitizePathSegment(itemId, 'NO_ID');
  const safeName = sanitizePathSegment(title, 'NO_NAME');
  const canonical = path.join(settings.downloadPath, `${safeItemId}_${safeName}`);
  try {
    if (!fs.existsSync(settings.downloadPath)) return canonical;
    const dirs = fs.readdirSync(settings.downloadPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && String(e.name || '').startsWith(`${safeItemId}_`));
    // A stale empty folder can exist under the exact current title (e.g. after an
    // itemName change) while the real downloaded content sits in a differently-named
    // sibling. Only short-circuit on the exact-title match when it's the sole folder
    // for this itemId — otherwise score all siblings so an empty canonical folder
    // never wins over one that actually has the downloaded content.
    if (!dirs.some((d) => path.join(settings.downloadPath, d.name) === canonical) && fs.existsSync(canonical)) {
      return canonical;
    }
    if (!dirs.length) return canonical;
    if (dirs.length === 1) return path.join(settings.downloadPath, dirs[0].name);

    // Prefer extracted-ready/non-empty directory when multiple folders with same itemId exist.
    const withScore = dirs.map((d) => {
      const full = path.join(settings.downloadPath, d.name);
      const flag = path.join(full, '__extracted', '__extracted.flag');
      let mtimeMs = 0;
      let childCount = 0;
      try { mtimeMs = fs.statSync(full).mtimeMs || 0; } catch {}
      try { childCount = fs.readdirSync(full).length || 0; } catch {}
      return { full, isCanonical: full === canonical, hasExtractedFlag: fs.existsSync(flag), childCount, mtimeMs };
    });
    withScore.sort((a, b) => {
      if (a.hasExtractedFlag !== b.hasExtractedFlag) return a.hasExtractedFlag ? -1 : 1;
      if (Boolean(a.childCount) !== Boolean(b.childCount)) return a.childCount ? -1 : 1;
      if (a.isCanonical !== b.isCanonical) return a.isCanonical ? -1 : 1;
      return Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0);
    });
    return withScore[0]?.full || canonical;
  } catch {
    return canonical;
  }
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

async function resolveManualFreeAssetCandidate(rawInput) {
  await ensureClientReady();
  const itemId = extractBoothItemId(rawInput);
  if (!itemId) return { error: 'invalid_item_id_or_url' };

  let itemJson = {};
  try {
    const jsonRes = await boothClient.get(`/ja/items/${itemId}.json`, { responseType: 'json' });
    itemJson = jsonRes?.data || {};
  } catch (e) {
    return { error: `item_json_fetch_failed: ${e?.message || String(e)}` };
  }

  let links = extractFreeDownloadLinksFromItemJson(itemJson);
  if (!links.length) {
    links = await fetchFreeDownloadLinksForItem(itemId);
  }
  links = dedupeDownloadLinks(links);
  if (!links.length) return { error: 'free_download_links_not_found' };

  const item = createManualFreeMetaItem(itemId, itemJson, links);
  return { ok: true, itemId, itemJson, links, item };
}

function extractBoothCsrfFromHtml(html) {
  const $ = cheerio.load(String(html || ''));
  return String(
    $('meta[name="csrf-token"]').attr('content') ||
    $('input[name="authenticity_token"]').first().attr('value') ||
    '',
  ).trim();
}

async function addWishlistItemToBoothCart(rawInput, variationName) {
  await ensureClientReady();
  const itemId = extractBoothItemId(rawInput);
  if (!itemId) return { error: 'invalid_item_id_or_url' };

  // Fetch JSON (variation IDs + shop subdomain) and HTML (CSRF token) in parallel
  let jsonData, csrfToken;
  try {
    const [jsonRes, htmlRes] = await Promise.all([
      boothClient.get(`/ja/items/${itemId}.json`, {
        baseURL: 'https://booth.pm',
        responseType: 'json',
        headers: { Accept: 'application/json' },
      }),
      boothClient.get(`/ja/items/${itemId}`, {
        baseURL: 'https://booth.pm',
        responseType: 'text',
        headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', Referer: 'https://booth.pm/' },
      }),
    ]);
    jsonData = jsonRes?.data;
    csrfToken = extractBoothCsrfFromHtml(String(htmlRes?.data || ''));
  } catch (e) {
    return { error: `item_fetch_failed: ${e?.message || String(e)}` };
  }

  if (!csrfToken) return { error: 'cart_authenticity_token_not_found' };

  const shopSubdomain = String(jsonData?.shop?.subdomain || '').trim();
  if (!shopSubdomain) return { error: 'cart_shop_not_found' };

  const variations = (Array.isArray(jsonData?.variations) ? jsonData.variations : [])
    .map((v) => ({ id: String(v?.id || ''), name: String(v?.name || '').trim() }))
    .filter((v) => v.id);

  let resolvedVariationId = variations.length === 1 ? variations[0].id : '';
  if (!resolvedVariationId && variationName && variations.length > 0) {
    const needle = String(variationName).trim().toLowerCase();
    const match = variations.find((v) => v.name.toLowerCase() === needle)
      || variations.find((v) => v.name.toLowerCase().includes(needle))
      || variations.find((v) => needle.includes(v.name.toLowerCase()));
    if (match) resolvedVariationId = match.id;
  }

  if (!resolvedVariationId) {
    return {
      error: variations.length > 1 ? 'cart_variation_ambiguous' : 'cart_variation_not_found',
      variationCount: variations.length,
      variations,
    };
  }

  const cartUrl = new URL(`https://${shopSubdomain}.booth.pm/cart`);
  cartUrl.searchParams.set('added_to_cart', 'true');
  cartUrl.searchParams.set('via', 'market');

  const body = new URLSearchParams();
  body.set('_method', 'patch');
  body.set('cart_item[variation_id]', resolvedVariationId);
  body.set('authenticity_token', csrfToken);

  let cartPageHtml = '';
  try {
    const postRes = await boothClient.post(cartUrl.toString(), body.toString(), {
      responseType: 'text',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://booth.pm',
        Referer: 'https://booth.pm/',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    cartPageHtml = String(postRes?.data || '');
  } catch (e) {
    const status = e?.response?.status || null;
    return { error: `cart_add_failed${status ? `:${status}` : ''}: ${e?.message || String(e)}` };
  }

  // Extract checkout URL from the cart page response
  // Pattern: href="https://checkout.booth.pm/checkout/step1?uuid=UUID"
  let checkoutUrl = null;
  const checkoutMatch = /https:\/\/checkout\.booth\.pm\/checkout\/step1\?uuid=[a-f0-9-]+[^"'\s]*/i.exec(cartPageHtml);
  if (checkoutMatch) {
    checkoutUrl = checkoutMatch[0];
  }

  // Fallback: fetch cart.json to get checkout URL
  if (!checkoutUrl) {
    try {
      const cartBase = new URL(cartUrl.toString());
      cartBase.pathname = '/cart.json';
      cartBase.search = '';
      const cartJson = await boothClient.get(cartBase.toString(), {
        responseType: 'json',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: cartUrl.toString() },
      });
      const cartData = cartJson?.data;
      const checkoutPath =
        cartData?.carts?.[0]?.shop?.checkout_url ||
        cartData?.carts?.[0]?.shop?.checkout_path ||
        cartData?.carts?.[0]?.checkout_url ||
        cartData?.carts?.[0]?.checkout_path ||
        cartData?.checkout_url ||
        cartData?.checkout_path ||
        '';
      if (checkoutPath) {
        checkoutUrl = checkoutPath.startsWith('http') ? checkoutPath : `https://checkout.booth.pm${checkoutPath}`;
      }
    } catch { /* ignore */ }
  }

  return {
    ok: true,
    itemId,
    variationId: resolvedVariationId,
    cartUrl: cartUrl.toString(),
    checkoutUrl,
  };
}

async function fetchBoothCart(shopSubdomain) {
  await ensureClientReady();
  const subdomain = String(shopSubdomain || '').trim();
  try {
    const url = subdomain
      ? `https://${subdomain}.booth.pm/cart.json`
      : 'https://booth.pm/carts.json';
    const res = await boothClient.get(url, {
      responseType: 'json',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: subdomain ? `https://${subdomain}.booth.pm/cart` : 'https://booth.pm/cart',
      },
    });
    return { ok: true, data: res?.data, global: !subdomain };
  } catch (e) {
    return { error: `cart_fetch_failed: ${e?.message || String(e)}` };
  }
}

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

function toBoothCategoryRowsFromItemJson(itemJson) {
  const cat = itemJson?.category;
  const rows = [];
  if (cat && cat.parent) {
    rows.push({
      href: cat.parent.url,
      text: cat.parent.name,
      slug: String(cat.parent.url || '').replace(/^https:\/\/booth\.pm\/ja\/browse\//, ''),
    });
  }
  if (cat) {
    rows.push({
      href: cat.url,
      text: cat.name,
      slug: String(cat.url || '').replace(/^https:\/\/booth\.pm\/ja\/browse\//, ''),
    });
  }
  return rows;
}

async function backfillCategoriesForItemIds(items, itemIds, onProgress = null) {
  const rows = Array.isArray(items) ? items : [];
  const targetSet = new Set(
    Array.from(itemIds || [])
      .map((v) => String(v || '').trim())
      .filter(Boolean),
  );
  if (!rows.length || !targetSet.size) return { changed: false, backfilled: 0, total: 0 };

  const targets = rows.filter((it) => targetSet.has(String(it?.itemId || '').trim()));
  if (!targets.length) return { changed: false, backfilled: 0, total: 0 };

  await ensureClientReady();
  let changed = false;
  let backfilled = 0;
  const learnedAvatars = [];
  for (let i = 0; i < targets.length; i += 1) {
    const item = targets[i];
    const itemId = String(item?.itemId || '').trim();
    if (!itemId) continue;
    if (onProgress) {
      try {
        onProgress({ phase: 'categories', index: i + 1, total: targets.length });
      } catch {
        // ignore progress callback errors
      }
    }
    try {
      const res = await boothClient.get(`/ja/items/${itemId}.json`, { baseURL: 'https://booth.pm' });
      const data = res?.data || {};
      const categories = toBoothCategoryRowsFromItemJson(data);
      if (Array.isArray(categories) && categories.length > 0) {
        item.categories = categories;
        item.primaryCategory = categories[categories.length - 1] || null;
        const { learned } = enrichItemAvatarMetadata(item, data, categories);
        if (learned) learnedAvatars.push(learned);
        changed = true;
        backfilled += 1;
      }
    } catch {
      // ignore per-item errors; lightweight sync should stay resilient
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  if (learnedAvatars.length) {
    try {
      learnAvatarsToFile(learnedAvatars);
    } catch {
      // non-critical; avatars.json update failure should not break sync
    }
  }

  return { changed, backfilled, total: targets.length };
}

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

function isMissingBoothCookieFileError(error) {
  if (!error || String(error.code || '') !== 'ENOENT') return false;
  const cookieTargets = Array.from(new Set([
    DEFAULT_SETTINGS.cookieFile,
    String(settings?.cookieFile || '').trim(),
    TEMP_COOKIE_PATH,
  ].filter(Boolean).map((p) => path.resolve(p))));
  const errPath = error.path ? path.resolve(String(error.path)) : '';
  if (errPath && cookieTargets.includes(errPath)) return true;
  const msg = String(error.message || '');
  return msg.includes('booth.pm.json') || msg.includes('tempcookie.json');
}

function isRecoverableBoothCookieError(error) {
  if (isMissingBoothCookieFileError(error)) return true;
  const code = String(error?.code || '').trim();
  if (
    code === 'cookie_decrypt_failed'
    || code === 'safe_storage_unavailable'
    || code === 'invalid_cookie_file'
    || code === 'invalid_cookie_payload'
    || code === 'unsupported_cookie_file_format'
  ) return true;
  if (code === 'redirect_to_login' || code === 'login_required') return true;
  const msg = String(error?.message || '').toLowerCase();
  if (msg.includes('download_not_file_response')) return true;
  if (msg.includes('redirect_to_login')) return true;
  if (msg.includes('sessions/new')) return true;
  return msg.includes('safeStorage.decryptString');
}

async function runWithBoothCookieLoginFallback(task) {
  try {
    return await task();
  } catch (e) {
    if (!isRecoverableBoothCookieError(e)) throw e;
    const loginRes = await loginWindowMgr.openLoginWindowFlow();
    if (!loginRes?.ok) {
      const code = String(loginRes?.error || 'login_required');
      const err = new Error(code);
      err.code = code;
      throw err;
    }
    await refreshMetaAfterLoginDedup(mainWindow?.webContents || null);
    return await task();
  }
}

async function refreshMetaAfterLogin(sender) {
  const sendLog = (msg) => {
    try {
      if (sender && !sender.isDestroyed?.()) sender.send('meta-log', msg);
    } catch {
      // ignore
    }
  };
  const sendProgress = (payload) => {
    try {
      if (sender && !sender.isDestroyed?.()) sender.send('meta-progress', { ...(payload || {}), scope: 'post-login-refresh' });
    } catch {
      // ignore
    }
  };

  let existing = [];
  if (fs.existsSync(META_PATH)) {
    try {
      existing = normalizeAndPersistMeta(JSON.parse(fs.readFileSync(META_PATH, 'utf8')));
    } catch {
      existing = [];
    }
  }
  const latest = await generateLibraryMeta(sendLog, sendProgress, { lightweight: false, persist: true });
  const merged = ensureMetaWithVersionTracking(existing, latest);
  try {
    if (sender && !sender.isDestroyed?.()) {
      sender.send('assets-refreshed', toAssetMap(merged));
    }
  } catch {
    // ignore
  }
  return { ok: true, itemCount: Array.isArray(merged) ? merged.length : 0 };
}

async function refreshMetaAfterLoginDedup(sender) {
  if (postLoginRefreshPromise) return await postLoginRefreshPromise;
  postLoginRefreshPromise = (async () => {
    try {
      return await refreshMetaAfterLogin(sender);
    } finally {
      postLoginRefreshPromise = null;
    }
  })();
  return await postLoginRefreshPromise;
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
  backupCorruptedJson,
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
  BOOTH_LOGIN_PARTITION,
  session,
  runWithBoothCookieLoginFallback,
  openLoginWindowFlow: (...args) => loginWindowMgr.openLoginWindowFlow(...args),
  getStorageUsageSnapshot: () => storageMgr.getStorageUsageSnapshot(),
});

const storageMgr = createStorageManager({
  fs,
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

async function analyzeImportToolDependencies(payload = {}) {
  return await unityMgr.analyzeImportToolDependencies(payload);
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

function getCpuCount() {
  try {
    const n = Number(os.cpus()?.length || 0);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
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
} else {

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId(DESKTOP_NOTIFY_APP_ID);
  ensureWindowsStartupRegistration({
    app,
    processObj: process,
  });
  const scriptSync = ensureInstallScriptsAssets();
  if (!scriptSync?.ok) {
    console.warn('Failed to prepare install scripts asset:', scriptSync?.error || 'unknown_error');
  }
  createWindow();
  setupAppUpdater();
  setTimeout(() => {
    checkForAppUpdate(false).catch(() => {});
  }, 5000);
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
  stopVccWatcher();
  schedulerSvc.stopAll();
  if (process.platform !== 'darwin') app.quit();
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
  } catch {}
  if (uiProbeService.isUiProbeEnabled()) {
    setTimeout(() => {
      uiProbeService.runUiProbe().catch((e) => {
        console.error('[ui-probe] failed:', e?.stack || e?.message || e);
        try { app.exit(1); } catch {}
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
  } catch {}
  createWindow();
  return { ok: true, sessionId: rendererBootSessionId };
});

ipcMain.handle('restart-app', async () => {
  setImmediate(() => {
    try {
      app.relaunch();
      app.exit(0);
    } catch {}
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
