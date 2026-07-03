/**
 * Booth Asset Manager - Optimized Renderer
 * Main renderer entry for UI composition, IPC wiring, and asset interactions.
 */

// ========== Constants & Configuration ==========

const ICONS = {
  folder: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
    <path d="M2 10h20"/>
  </svg>`,
  file: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
    <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
  </svg>`,
  image: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
    <circle cx="9" cy="9" r="2"/>
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
  </svg>`,
  model: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
    <path d="m3.3 7 8.7 5 8.7-5"/>
    <path d="M12 22V12"/>
  </svg>`,
  audio: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <circle cx="8" cy="18" r="4"/>
    <path d="M12 18V2l7 4"/>
  </svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <rect width="20" height="5" x="2" y="3" rx="1"/>
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>
    <path d="M10 12h4"/>
  </svg>`,
  text: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
    <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
    <path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>
  </svg>`,
  unity: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>`,
  blender: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3c-4.97 0-9 4.03-9 9s4 9 9 9 9-4.03 9-9c0-1.66-1.34-3-3-3s-3 1.34-3 3c0 .55.45 1 1 1s1-.45 1-1c0-.55-.45-1-1-1s-1 .45-1 1c0 1.66 1.34 3 3 3s3-1.34 3-3c0-3.31-2.69-6-6-6s-6 2.69-6 6 2.69 6 6 6c.55 0 1-.45 1-1s-.45-1-1-1"/>
  </svg>`,
};

const META_PHASE_WEIGHTS = {
  orders: 0.2,
  library: 0.2,
  thumbnails: 0.15,
  authorIcons: 0.05,
  bytes: 0.4,
};

const DEFAULT_SHORTCUTS = Object.freeze({
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
const RESERVED_SHORTCUTS = Object.freeze([
  { spec: 'Escape', reason: 'キャンセル/閉じる操作に固定です' },
  { spec: 'F5', reason: 'リロード誤爆を防ぐため予約です' },
  { spec: 'Ctrl+R', reason: 'リロード誤爆を防ぐため予約です' },
]);
const SHORTCUTS_TUTORIAL_SEEN_KEY = 'shortcutsTutorialSeenV1';
const APP_UPDATE_REMIND_KEY = 'appUpdateRemindV1';
const GIFT_CATEGORY_KEY = '__GIFT__';
const GIFT_CATEGORY_LABEL = 'Gift';
const FREE_DOWNLOAD_CATEGORY_KEY = '__FREE_DOWNLOAD__';
const FREE_DOWNLOAD_CATEGORY_LABEL = 'Free';

const SHORTCUT_FIELD_DEFS = Object.freeze([
  { key: 'focusSearch', label: '検索にフォーカス', hint: '通常' },
  { key: 'focusSearchAlt', label: '検索にフォーカス', hint: '代替' },
  { key: 'viewGrid', label: 'グリッド表示', hint: '' },
  { key: 'viewList', label: 'リスト表示', hint: '' },
  { key: 'syncLibrary', label: 'ライブラリ同期', hint: '' },
  { key: 'checkUpdates', label: '更新チェック', hint: '' },
  { key: 'downloadAll', label: '全DL', hint: '' },
  { key: 'downloadUndownloaded', label: '未DLのみ', hint: '' },
  { key: 'queueToggle', label: 'キュー停止/再開', hint: '' },
  { key: 'retryFailed', label: '失敗再試行', hint: '' },
  { key: 'toggleSelectionMode', label: '一括選択モード', hint: '' },
  { key: 'clearSelectionMode', label: '選択解除', hint: '' },
  { key: 'batchImport', label: '一括インポート', hint: '' },
  { key: 'manualAdd', label: '手動追加モーダル', hint: '' },
  { key: 'notifications', label: '通知センター', hint: '' },
  { key: 'autoBootstrap', label: '自動インポート設定', hint: '' },
  { key: 'projectItems', label: 'プロジェクト内検索', hint: '' },
  { key: 'openSettings', label: '設定を開く', hint: '通常' },
  { key: 'openSettingsAlt', label: '設定を開く', hint: '代替' },
  { key: 'modalConfirm', label: 'モーダル実行', hint: '通常' },
  { key: 'modalPrimary', label: 'モーダル実行', hint: '強制' },
  { key: 'previewOpenFolder', label: 'プレビュー: フォルダ', hint: '' },
  { key: 'previewOpenEntry', label: 'プレビュー: 選択を開く', hint: '' },
  { key: 'previewBack', label: 'プレビュー: 戻る', hint: '' },
]);

const shortcutUtils = window.AvatoolRenderShortcuts;
if (!shortcutUtils) {
  throw new Error('AvatoolRenderShortcuts is not loaded.');
}
const {
  sanitizeShortcutSpec,
  isModifierOnlyKey,
  formatShortcutFromEvent,
  parseShortcutSpec,
  getEventKeyNormalized,
  eventMatchesShortcut,
  canonicalizeShortcutSpec,
  formatShortcutDisplay,
  validateShortcutMap: validateShortcutMapWithDefs,
} = shortcutUtils;

const avatarFilterUtils = window.AvatoolRenderAvatarFilter;
if (!avatarFilterUtils) {
  throw new Error('AvatoolRenderAvatarFilter is not loaded.');
}
const {
  normalizeAvatarFilterValue,
  normalizeAvatarMatchKey,
  kanaToHiragana,
  kanaToKatakana,
  avatarComparableKeys,
  isCompatFilterNoise,
  getAssetAvatarPool,
  matchesAvatarFilter,
  buildAvatarImageMap,
  buildAvatarLabelMap,
} = avatarFilterUtils;

function requireRendererFactory(globalName, createName) {
  const mod = window[globalName];
  const factory = mod?.[createName];
  if (typeof factory !== 'function') {
    throw new Error(`${globalName}.${createName} is not loaded.`);
  }
  return factory;
}

const createRenderOverlays = requireRendererFactory('AvatoolRenderOverlays', 'createRenderOverlays');
const createRenderAuxUi = requireRendererFactory('AvatoolRenderAuxUi', 'createRenderAuxUi');
const createRenderAppState = requireRendererFactory('AvatoolRenderAppState', 'createRenderAppState');
const createRenderProjectItems = requireRendererFactory('AvatoolRenderProjectItems', 'createRenderProjectItems');
const createRenderSettingsTools = requireRendererFactory('AvatoolRenderSettingsTools', 'createRenderSettingsTools');
const createRenderAutoBootstrap = requireRendererFactory('AvatoolRenderAutoBootstrap', 'createRenderAutoBootstrap');
const createRenderImportModal = requireRendererFactory('AvatoolRenderImportModal', 'createRenderImportModal');
const createRenderPreviewModal = requireRendererFactory('AvatoolRenderPreviewModal', 'createRenderPreviewModal');
const createRenderLibraryActions = requireRendererFactory('AvatoolRenderLibraryActions', 'createRenderLibraryActions');
const createRenderAssetList = requireRendererFactory('AvatoolRenderAssetList', 'createRenderAssetList');
const createRenderQueueUI = requireRendererFactory('AvatoolRenderQueueUI', 'createRenderQueueUI');
const createBoothSearchView = (() => {
  const m = window.AvatoolBoothSearch;
  return typeof m?.createBoothSearchView === 'function' ? m.createBoothSearchView : null;
})();
const createBoothClientView = (() => {
  const m = window.AvatoolBoothClient;
  return typeof m?.createBoothClientView === 'function' ? m.createBoothClientView : null;
})();
const rendererModules = {};
const rendererModuleFailures = [];
const rendererModuleFailureKeys = new Set();

function callRendererModule(moduleKey, methodName, args) {
  const api = rendererModules[moduleKey];
  const method = api?.[methodName];
  if (typeof method !== 'function') {
    recordRendererModuleFailure(moduleKey, methodName, new Error(`Renderer module not ready: ${moduleKey}.${methodName}`));
    return undefined;
  }
  try {
    return method(...args);
  } catch (error) {
    recordRendererModuleFailure(moduleKey, methodName, error);
    return undefined;
  }
}

function getRendererModuleErrorMessage(error) {
  const message = String(error?.message || error || 'unknown renderer module error').trim();
  return message || 'unknown renderer module error';
}

function recordRendererModuleFailure(moduleKey, stage, error) {
  const message = getRendererModuleErrorMessage(error);
  const key = `${moduleKey}:${stage}:${message}`;
  if (rendererModuleFailureKeys.has(key)) return;
  rendererModuleFailureKeys.add(key);
  rendererModuleFailures.push({
    moduleKey: String(moduleKey || 'unknown'),
    stage: String(stage || 'unknown'),
    message,
    stack: String(error?.stack || ''),
    timestamp: new Date().toISOString(),
  });
  console.error(`[renderer-module:${moduleKey}] ${stage} failed`, error);
}

function safeCreateRendererModule(moduleKey, factory) {
  try {
    const api = factory();
    rendererModules[moduleKey] = api || null;
    return api || null;
  } catch (error) {
    rendererModules[moduleKey] = null;
    recordRendererModuleFailure(moduleKey, 'create', error);
    return null;
  }
}

function safeBindRendererModule(moduleKey, methodName) {
  const api = rendererModules[moduleKey];
  const method = api?.[methodName];
  if (typeof method !== 'function') return false;
  try {
    method.call(api);
    return true;
  } catch (error) {
    recordRendererModuleFailure(moduleKey, methodName, error);
    return false;
  }
}

function renderRendererDegradedBanner() {
  if (!rendererModuleFailures.length || !document?.body) return;
  let banner = document.getElementById('renderer-degraded-banner');
  const failureCount = rendererModuleFailures.length;
  const moduleNames = Array.from(new Set(rendererModuleFailures.map((entry) => entry.moduleKey))).slice(0, 4).join(', ');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'renderer-degraded-banner';
    banner.className = 'fixed top-3 left-1/2 -translate-x-1/2 z-[140] max-w-[92vw] rounded-lg border border-amber-400/40 bg-amber-950/90 px-4 py-2 text-[11px] text-amber-100 shadow-xl backdrop-blur';
    banner.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="min-w-0">
          <div class="font-semibold">一部機能を無効化して起動しました</div>
          <div id="renderer-degraded-banner-text" class="text-amber-200/90"></div>
        </div>
        <button id="renderer-degraded-banner-log" class="btn-action whitespace-nowrap">ログを開く</button>
      </div>
    `;
    document.body.appendChild(banner);
    banner.querySelector('#renderer-degraded-banner-log')?.addEventListener('click', () => {
      window.boothAPI?.openRuntimeLogWindow?.().catch?.(() => {});
    });
  }
  const text = banner.querySelector('#renderer-degraded-banner-text');
  if (text) {
    text.textContent = `${failureCount} 件の初期化失敗を検出しました。影響モジュール: ${moduleNames || 'unknown'}`;
  }
}

async function safeRunRendererStartupStep(stepName, run) {
  try {
    return await run();
  } catch (error) {
    recordRendererModuleFailure('startup', stepName, error);
    return undefined;
  }
}

// ========== DOM References ==========

const domRefs = {
  grid: document.getElementById('asset-grid'),
  filterBtns: document.querySelectorAll('.filter-btn'),
  categoryFilterSelect: document.getElementById('category-filter-select'),
  categoryFilter: document.getElementById('category-filter'),
  categoryList: document.getElementById('category-list'),
  
  // Meta progress (legacy UI)
  progressWrapper: document.getElementById('meta-progress-wrapper'),
  progressLabel: document.getElementById('meta-progress-label'),
  progressPercent: document.getElementById('meta-progress-percent'),
  progressBarTop: document.getElementById('meta-progress-bar-top'),
  progressBarBottom: document.getElementById('meta-progress-bar-bottom'),
  progressCountLabel: document.getElementById('meta-progress-count-label'),
  
  // Meta progress (new UI)
  metaProgressWrapper: document.getElementById('meta-progress-wrapper'),
  metaProgressBar: document.getElementById('meta-progress-bar-top'),
  metaProgressText: document.getElementById('meta-progress-label'),
  refreshButton: document.getElementById('refresh-meta'),
  lastUpdatedSpan: document.getElementById('meta-last-updated'),
  syncLibraryBtn: document.getElementById('sync-library-btn'),
  analyzeAvatarCompatBtn: document.getElementById('analyze-avatar-compat-btn'),
  manualAddBtn: document.getElementById('manual-add-btn'),
  downloadAllBtn: document.getElementById('download-all-btn'),
  checkUpdatesBtn: document.getElementById('check-updates-btn'),
  autoUpdateNotifyBtn: document.getElementById('auto-update-notify-btn'),
  autoUpdateNotifyCount: document.getElementById('auto-update-notify-count'),
  shortcutsGuideBtn: document.getElementById('shortcuts-guide-btn'),
  sortSelect: document.getElementById('sort-select'),
  viewGridBtn: document.getElementById('view-grid-btn'),
  viewListBtn: document.getElementById('view-list-btn'),
  searchInput: document.getElementById('search-input'),
  updateBadge: document.getElementById('update-badge'),
  avatarFilterSelect: document.getElementById('avatar-filter-select'),
  projectItemsBtn: document.getElementById('project-items-btn'),
  projectItemsModal: document.getElementById('project-items-modal'),
  projectItemsClose: document.getElementById('project-items-close'),
  settingsBtn: document.getElementById('settings-btn'),
  autoBootstrapBtn: document.getElementById('auto-bootstrap-btn'),
  settingsModal: document.getElementById('settings-modal'),
  settingsClose: document.getElementById('settings-close'),
  settingsSave: document.getElementById('settings-save'),
  autoBootstrapModal: document.getElementById('auto-bootstrap-modal'),
  autoBootstrapClose: document.getElementById('auto-bootstrap-close'),
  autoBootstrapSave: document.getElementById('auto-bootstrap-save'),
  settingDownloadPath: document.getElementById('setting-download-path'),
  settingConcurrency: document.getElementById('setting-concurrency'),
  settingAutoExtract: document.getElementById('setting-auto-extract'),
  settingAutoCheckInterval: document.getElementById('setting-auto-check-interval'),
  settingMinFreeSpaceGb: document.getElementById('setting-min-free-space-gb'),
  settingCookieFile: document.getElementById('setting-cookie-file'),
  autoBootstrapEnabled: document.getElementById('auto-bootstrap-enabled'),
  autoBootstrapIncludeMA: document.getElementById('auto-bootstrap-include-ma'),
  autoBootstrapIncludeLiltoon: document.getElementById('auto-bootstrap-include-liltoon'),
  autoBootstrapIncludeFaceEmo: document.getElementById('auto-bootstrap-include-faceemo'),
  autoBootstrapIncludeAvatoolScripts: document.getElementById('auto-bootstrap-include-avatool-scripts'),
  autoBootstrapIncludeSimpleFolderIcon: document.getElementById('auto-bootstrap-include-simple-folder-icon'),
  autoBootstrapProjectRulesList: document.getElementById('auto-bootstrap-project-rules-list'),
  autoBootstrapProjectRulesAdd: document.getElementById('auto-bootstrap-project-rules-add'),
  settingUnityPath: document.getElementById('setting-unity-path'),
  settingUnityProjects: document.getElementById('setting-unity-projects'),
  settingSafeMode: document.getElementById('setting-safe-mode'),
  settingHealthCheckOnStartup: document.getElementById('setting-health-check-on-startup'),
  settingDebugLogEnabled: document.getElementById('setting-debug-log-enabled'),
  settingAppVersion: document.getElementById('setting-app-version'),
  settingAppUpdateCheck: document.getElementById('setting-app-update-check'),
  settingAppUpdateStatus: document.getElementById('setting-app-update-status'),
  settingAppUpdateProgressWrap: document.getElementById('setting-app-update-progress-wrap'),
  settingAppUpdateProgressBar: document.getElementById('setting-app-update-progress-bar'),
  settingAppUpdateProgressText: document.getElementById('setting-app-update-progress-text'),
  appUpdateProgressFloat: document.getElementById('app-update-progress-float'),
  appUpdateProgressFloatBar: document.getElementById('app-update-progress-float-bar'),
  appUpdateProgressFloatText: document.getElementById('app-update-progress-float-text'),
  settingKeyboardShortcutsEnabled: document.getElementById('setting-keyboard-shortcuts-enabled'),
  settingShortcutsEditor: document.getElementById('setting-shortcuts-editor'),
  settingShortcutsWarning: document.getElementById('setting-shortcuts-warning'),
  settingShortcutsReset: document.getElementById('setting-shortcuts-reset'),
  settingSchedulerEnabled: document.getElementById('setting-scheduler-enabled'),
  settingSchedulerProfile: document.getElementById('setting-scheduler-profile'),
  settingRenderMode: document.getElementById('setting-render-mode'),
  settingSchedulerStartHour: document.getElementById('setting-scheduler-start-hour'),
  settingSchedulerEndHour: document.getElementById('setting-scheduler-end-hour'),
  settingRetryMaxAttempts: document.getElementById('setting-retry-max-attempts'),
  settingRetryBaseDelayMs: document.getElementById('setting-retry-base-delay-ms'),
  settingsProfileName: document.getElementById('settings-profile-name'),
  settingsSaveProfile: document.getElementById('settings-save-profile'),
  settingsProfileSelect: document.getElementById('settings-profile-select'),
  settingsApplyProfile: document.getElementById('settings-apply-profile'),
  settingsExportPath: document.getElementById('settings-export-path'),
  settingsExportBtn: document.getElementById('settings-export-btn'),
  settingsImportPath: document.getElementById('settings-import-path'),
  settingsImportBtn: document.getElementById('settings-import-btn'),
  settingsRunHealthCheck: document.getElementById('settings-run-health-check'),
  operationLogList: document.getElementById('operation-log-list'),
  operationLogPanel: document.getElementById('operation-log-panel'),
  operationLogClearBtn: document.getElementById('operation-log-clear-btn'),
  projectItemsSelect: document.getElementById('project-items-select'),
  projectItemsList: document.getElementById('project-items-list'),
  projectItemsStatus: document.getElementById('project-items-status'),
  projectItemsReconcile: document.getElementById('project-items-reconcile'),
  projectItemsProgressWrap: document.getElementById('project-items-progress-wrap'),
  projectItemsProgressBar: document.getElementById('project-items-progress-bar'),
  loadVccBtn: document.getElementById('load-vcc-btn'),
  cookieLoadBtn: document.getElementById('cookie-load-btn'),
  cookieLoginBtn: document.getElementById('cookie-login-btn'),
  cookieLogoutBtn: document.getElementById('cookie-logout-btn'),
  cookieStatus: document.getElementById('cookie-status'),
  autoSyncToggle: document.getElementById('auto-sync-toggle'),
  downloadUndownloadedBtn: document.getElementById('download-undownloaded-btn'),
  retryFailedBtn: document.getElementById('retry-failed-btn'),
  btnToggleSelect: document.getElementById('btn-toggle-select'),
  importModeIndicator: document.getElementById('import-mode-indicator'),
  batchControls: document.getElementById('batch-controls'),
  selectionBar: document.getElementById('selection-bar'),
  btnCancelSelect: document.getElementById('btn-cancel-select'),
  selectedCount: document.getElementById('selected-count'),
  btnBatchImport: document.getElementById('btn-batch-import'),
  queueToggleBtn: document.getElementById('queue-toggle-btn'),
  extractRepairBtn: document.getElementById('extract-repair-btn'),
  queueStatusText: document.getElementById('queue-status-text'),
  queueState: document.getElementById('queue-state'),
  queueQueued: document.getElementById('queue-queued'),
  queueRunning: document.getElementById('queue-running'),
  queueDone: document.getElementById('queue-done'),
  queueFailed: document.getElementById('queue-failed'),
  queueFailedList: document.getElementById('queue-failed-list'),
  queueFailedDetails: document.getElementById('queue-failed-details'),
  storageUsageText: document.getElementById('storage-usage-text'),
  storageOtherBar: document.getElementById('storage-other-bar'),
  storageAppBar: document.getElementById('storage-app-bar'),
  storageBreakdown: document.getElementById('storage-breakdown'),
  
  // Modal refs
  previewOverlay: document.getElementById('preview-overlay'),
  modalTitle: document.getElementById('modal-title'),
  modalPath: document.getElementById('modal-path'),
  modalCloseBtn: document.getElementById('modal-close'),
  modalOpenFolderBtn: document.getElementById('modal-open-folder'),
  modalTree: document.getElementById('modal-tree'),
  modalFileGrid: document.getElementById('modal-file-grid'),
  modalBackBtn: document.getElementById('modal-back'),
  modalReviewControls: document.getElementById('modal-review-controls'),
  modalReviewLabel: document.getElementById('modal-review-label'),
  modalReviewPrevBtn: document.getElementById('modal-review-prev'),
  modalReviewNextBtn: document.getElementById('modal-review-next'),
  currentFolderLabel: document.getElementById('current-folder-label'),
  modalPreviewBox: document.getElementById('modal-preview-box'),
  modalPreviewFilename: document.getElementById('modal-preview-filename'),
  modalPreviewInfo: document.getElementById('modal-preview-info'),
  assetAvatarAnalysis: document.getElementById('asset-avatar-analysis'),
  assetImportHistory: document.getElementById('asset-import-history'),
  assetUserMeta: document.getElementById('asset-user-meta'),
  modalAssetTitleText: document.getElementById('modal-asset-title-text'),
  modalAssetAuthorText: document.getElementById('modal-asset-author-text'),
  modalCopyTitle: document.getElementById('modal-copy-title'),
  modalCopyAuthor: document.getElementById('modal-copy-author'),
  modalUserTagsList: document.getElementById('modal-user-tags-list'),
  modalUserTagInput: document.getElementById('modal-user-tag-input'),
  modalUserTagAdd: document.getElementById('modal-user-tag-add'),
  modalUserNote: document.getElementById('modal-user-note'),
  modalUserNoteStatus: document.getElementById('modal-user-note-status'),
  modalWishlistCartWrap: document.getElementById('modal-wishlist-cart-wrap'),
  modalWishlistCartBtn: document.getElementById('modal-wishlist-cart-btn'),
  modalWishlistBuyBtn: document.getElementById('modal-wishlist-buy-btn'),
  modalWishlistRemoveBtn: document.getElementById('modal-wishlist-remove-btn'),
  modalOpenEntryBtn: document.getElementById('modal-open-entry'),
  modalTreePanel: document.getElementById('modal-tree-panel'),
  modalFilePanel: document.getElementById('modal-file-panel'),
  modalInspectorPanel: document.getElementById('modal-inspector-panel'),
  modalOpenEntryBtn: document.getElementById('modal-open-entry'),
  importModal: document.getElementById('import-modal'),
  importProjectList: document.getElementById('import-project-list'),
  importPackagePath: document.getElementById('import-package-path'),
  importStatusBox: document.getElementById('import-status-box'),
  importProgressWrap: document.getElementById('import-progress-wrap'),
  importProgressBar: document.getElementById('import-progress-bar'),
  importProgressText: document.getElementById('import-progress-text'),
  importExecuteBtn: document.getElementById('import-execute'),
  importDryRunBtn: document.getElementById('import-dry-run'),
  importCloseBtn: document.getElementById('import-close'),
  importBusyIndicator: document.getElementById('import-busy-indicator'),
  importPhaseIndicator: document.getElementById('import-phase-indicator'),
  importPhaseDot: document.getElementById('import-phase-dot'),
  importPhaseText: document.getElementById('import-phase-text'),
  importPresetPanel: document.getElementById('import-preset-panel'),
  importPresetAutoDryRun: document.getElementById('import-preset-auto-dry-run'),
  importPresetAutoInstallDeps: document.getElementById('import-preset-auto-install-deps'),
  pkgSelectModal: document.getElementById('pkg-select-modal'),
  pkgSelectList: document.getElementById('pkg-select-list'),
  pkgSelectModeNormal: document.getElementById('pkg-select-mode-normal'),
  pkgSelectModeBackground: document.getElementById('pkg-select-mode-background'),
  pkgSelectConfirm: document.getElementById('pkg-select-confirm'),
  pkgSelectCancel: document.getElementById('pkg-select-cancel'),
  pkgModeNormalBtn: document.getElementById('pkg-mode-normal-btn'),
  pkgModeBgBtn: document.getElementById('pkg-mode-bg-btn'),
  manualAddModal: document.getElementById('manual-add-modal'),
  manualAddInput: document.getElementById('manual-add-input'),
  manualAddStatus: document.getElementById('manual-add-status'),
  manualAddPreview: document.getElementById('manual-add-preview'),
  manualAddPreviewBox: document.getElementById('manual-add-preview-box'),
  manualAddPreviewImage: document.getElementById('manual-add-preview-image'),
  manualAddPreviewId: document.getElementById('manual-add-preview-id'),
  manualAddPreviewTitle: document.getElementById('manual-add-preview-title'),
  manualAddPreviewAuthor: document.getElementById('manual-add-preview-author'),
  manualAddPreviewFiles: document.getElementById('manual-add-preview-files'),
  manualAddSubmit: document.getElementById('manual-add-submit'),
  manualAddCancel: document.getElementById('manual-add-cancel'),
  manualAddClose: document.getElementById('manual-add-close'),
  wishlistAddBtn: document.getElementById('wishlist-add-btn'),
  wishlistAddModal: document.getElementById('wishlist-add-modal'),
  wishlistAddInput: document.getElementById('wishlist-add-input'),
  wishlistAddStatus: document.getElementById('wishlist-add-status'),
  wishlistAddPreview: document.getElementById('wishlist-add-preview'),
  wishlistAddPreviewBox: document.getElementById('wishlist-add-preview-box'),
  wishlistAddPreviewImage: document.getElementById('wishlist-add-preview-image'),
  wishlistAddPreviewId: document.getElementById('wishlist-add-preview-id'),
  wishlistAddPreviewTitle: document.getElementById('wishlist-add-preview-title'),
  wishlistAddPreviewAuthor: document.getElementById('wishlist-add-preview-author'),
  wishlistAddSubmit: document.getElementById('wishlist-add-submit'),
  wishlistAddCancel: document.getElementById('wishlist-add-cancel'),
  wishlistAddClose: document.getElementById('wishlist-add-close'),
  wishlistImportBoothBtn: document.getElementById('wishlist-import-booth-btn'),
  wishlistImportProgress: document.getElementById('wishlist-import-progress'),
};

// ========== Application State ==========

const state = {
  allAssets: [],
  assetByItemId: new Map(),
  downloadedAssets: [],
  updateAssetCount: 0,
  libraryEmptyReason: '',
  boothLoggedIn: null,
  filteredAssets: [],
  currentCategory: '__ALL__',
  viewFilter: 'all',
  sortMode: loadSortModePreference(),
  viewMode: 'grid',
  searchQuery: '',
  avatarFilter: '',
  avatarFilters: [],
  avatarImageMap: new Map(),
  avatarLabelMap: new Map(),
  avatarFilterAllLabel: 'アバター絞り込み',
  avatarFilterPanelOpen: false,
  loginInProgress: false,
  lastUndownloadedSelectWarnAt: 0,
  settings: null,
  selectionMode: false,
  selectedItems: new Set(),
  importModal: {
    packagePath: '',
    selectedProject: null,
    isBatch: false,
    batchTargets: [],
    batchPaths: [],
    batchPackages: [],
    singlePackage: null,
    runningProjectPaths: [],
    inProgress: false,
  },
  packageSelectionMap: new Map(),
  tileMap: new Map(),
  modal: {
    selectedAsset: null,
    treeRoot: null,
    currentPath: '',
    selectedEntry: null,
    history: [],
  },
  queue: {
    status: 'idle',
    queued: 0,
    running: [],
    done: 0,
    failed: [],
    paused: false,
  },
  expectedUpdateHashByItemId: new Map(),
  pendingAutoUpdates: [],
  notifications: [],
  operationLogs: [],
  settingsProfiles: [],
  manualAddDraft: null,
  manualAddPreviewTimer: null,
  wishlistDraft: null,
  wishlistPreviewTimer: null,
  updateCheckRunning: false,
  metaProgress: {
    globalMax: 0,
    lastRenderAt: 0,
    lastLabel: '',
    lastCountText: '',
    lastLocalPercent: 0,
    activeScope: '',
  },
  transientMessage: {
    el: null,
    timerId: null,
  },
  appUpdateDownloadUi: {
    startedAt: 0,
    sawProgress: false,
    lastPercent: 0,
  },
  appUpdateReleaseNotes: '',
  keyboardShortcutsBound: false,
  shortcutCaptureKey: '',
  shortcutCaptureButton: null,
  shortcutValidation: { duplicates: [], reservedHits: [] },
  renderJobToken: 0,
};

const RENDER_PROGRESSIVE_CHUNK_SIZE = 15;

const DOWNLOAD_PROGRESS_FLUSH_MS = 66; // ~15fps
const QUEUE_STATUS_FLUSH_MS = 180;
let getLastQueueSettledAt = () => 0;

let avatarDebugLastSignature = '';
let avatarDebugEnabledCache = null;
let avatarFilterGlobalDismissBound = false;

function isAvatarDebugEnabled() {
  if (state.settings && Object.prototype.hasOwnProperty.call(state.settings, 'debugLogEnabled')) {
    return Boolean(state.settings.debugLogEnabled);
  }
  if (avatarDebugEnabledCache !== null) return avatarDebugEnabledCache;
  try {
    const raw = String(localStorage.getItem('AVATOOL_DEBUG_VERBOSE') || '').trim().toLowerCase();
    avatarDebugEnabledCache = raw === '1' || raw === 'true' || raw === 'on';
    return avatarDebugEnabledCache;
  } catch {
    avatarDebugEnabledCache = false;
    return false;
  }
}

function logAvatarDebug(message, payload = null) {
  if (!isAvatarDebugEnabled()) return;
  try {
    if (payload && typeof payload === 'object') {
      console.log(`[AVATAR-DEBUG] ${message}`, payload);
    } else {
      console.log(`[AVATAR-DEBUG] ${message}`);
    }
  } catch {
    // ignore logging failures
  }
}

// ========== Utility Functions ==========

function loadViewModePreference() {
  try {
    const raw = localStorage.getItem('assetViewMode');
    if (raw === 'list' || raw === 'grid') return raw;
  } catch {
    // ignore
  }
  return 'grid';
}

function loadSortModePreference() {
  const valid = ['date_desc', 'date_asc', 'name_asc', 'size_desc'];
  try {
    const raw = localStorage.getItem('assetSortMode');
    if (valid.includes(raw)) return raw;
  } catch {
    // ignore
  }
  return 'date_desc';
}

function persistSortModePreference(mode) {
  try {
    localStorage.setItem('assetSortMode', mode);
  } catch {
    // ignore
  }
}

function persistViewModePreference(mode) {
  try {
    localStorage.setItem('assetViewMode', mode === 'list' ? 'list' : 'grid');
  } catch {
    // ignore
  }
}

function getRenderModeSetting() {
  const fromSettings = String(state.settings?.renderMode || '').trim().toLowerCase();
  if (fromSettings === 'instant' || fromSettings === 'progressive') return fromSettings;
  try {
    const fromStorage = String(localStorage.getItem('assetRenderMode') || '').trim().toLowerCase();
    if (fromStorage === 'instant' || fromStorage === 'progressive') return fromStorage;
  } catch {
    // ignore
  }
  return 'progressive';
}

function parseSortableDateMs(raw) {
  if (raw == null) return null;
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  const text = String(raw || '').trim();
  if (!text || text === 'Unknown') return null;

  const match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
    const ms = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ).getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  const ms = new Date(text).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function compareAssetsByAddedDateDesc(a, b) {
  const da = parseSortableDateMs(a?.orderDate);
  const db = parseSortableDateMs(b?.orderDate);
  if (da !== null && db !== null) return db - da;
  if (da !== null) return -1;
  if (db !== null) return 1;
  return 0;
}

function persistRenderModeSetting(mode) {
  const next = String(mode || '').trim().toLowerCase() === 'instant' ? 'instant' : 'progressive';
  try {
    localStorage.setItem('assetRenderMode', next);
  } catch {
    // ignore
  }
}

/**
 * Format a date/time value for UI display.
 */
function formatDate(raw) {
  if (!raw || raw === 'Unknown') return '不明';
  const ms = parseSortableDateMs(raw);
  if (ms === null) return raw;
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${day} ${hh}:${mm}`;
}

function formatWishlistCardPrice(asset) {
  const min = Number(asset?.priceMin ?? asset?.price);
  const max = Number(asset?.priceMax ?? asset?.price);
  if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > min) {
    return `¥${Math.round(min).toLocaleString('ja-JP')}〜`;
  }
  const price = Number(asset?.price);
  return Number.isFinite(price) && price > 0
    ? `¥${Math.round(price).toLocaleString('ja-JP')}`
    : '';
}

function createWishlistPriceChip(asset, compact = false) {
  const text = formatWishlistCardPrice(asset);
  if (!text) return null;
  const chip = document.createElement('span');
  chip.className = compact
    ? 'text-[9px] px-1.5 py-0.5 rounded border border-pink-400/20 bg-pink-400/10 text-pink-200 font-mono-custom whitespace-nowrap'
    : 'text-[10px] px-2 py-1 rounded-md border border-pink-400/20 bg-pink-400/10 text-pink-100 font-mono-custom self-start';
  chip.textContent = text;
  chip.title = `価格: ${text}`;
  return chip;
}

function esc(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setImportProgress(percent, text = '') {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  if (domRefs.importProgressWrap) domRefs.importProgressWrap.classList.remove('hidden');
  if (domRefs.importProgressBar) domRefs.importProgressBar.style.width = `${p}%`;
  if (domRefs.importProgressText) domRefs.importProgressText.textContent = text || `${Math.round(p)}%`;
}

function resetImportProgress() {
  if (domRefs.importProgressBar) domRefs.importProgressBar.style.width = '0%';
  if (domRefs.importProgressText) domRefs.importProgressText.textContent = '0%';
  if (domRefs.importProgressWrap) domRefs.importProgressWrap.classList.add('hidden');
  setImportPhase(null);
}

function setImportAcknowledgeMode(enabled) {
  const on = Boolean(enabled);
  if (domRefs.importCloseBtn) {
    domRefs.importCloseBtn.textContent = on ? 'OK' : '閉じる';
    domRefs.importCloseBtn.classList.toggle('btn-primary', on);
  }
  if (on && domRefs.importBusyIndicator) {
    domRefs.importBusyIndicator.classList.add('hidden');
  }
  if (domRefs.importExecuteBtn) {
    domRefs.importExecuteBtn.disabled = on || !state.importModal.selectedProject;
  }
  if (domRefs.importDryRunBtn) {
    domRefs.importDryRunBtn.disabled = on || !state.importModal.selectedProject;
  }
}

function setImportActionButtonsBusy(busy) {
  const on = Boolean(busy);
  if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.classList.toggle('hidden', on);
  if (domRefs.importDryRunBtn) domRefs.importDryRunBtn.classList.toggle('hidden', on);
  if (domRefs.importBusyIndicator) domRefs.importBusyIndicator.classList.toggle('hidden', !on);
}

function setImportCloseDisabled(disabled) {
  if (domRefs.importCloseBtn) {
    const on = Boolean(disabled);
    domRefs.importCloseBtn.disabled = on;
    domRefs.importCloseBtn.style.opacity = on ? '0.4' : '';
  }
}

function setImportPhase(phase, text) {
  const indicator = domRefs.importPhaseIndicator;
  if (!indicator) return;
  if (!phase) {
    indicator.classList.add('hidden');
    return;
  }
  indicator.classList.remove('hidden');
  if (domRefs.importPhaseText) domRefs.importPhaseText.textContent = text || '';
  const isDone = phase === 'done';
  const isError = phase === 'error';
  if (domRefs.importPhaseDot) {
    domRefs.importPhaseDot.style.background = isDone ? '#10b981' : isError ? '#ef4444' : '#3b82f6';
    domRefs.importPhaseDot.style.animationPlayState = (isDone || isError) ? 'paused' : 'running';
  }
  if (domRefs.importPhaseText) {
    domRefs.importPhaseText.style.color = isDone ? '#34d399' : isError ? '#f87171' : '';
  }
  indicator.style.borderColor = isDone
    ? 'rgba(16,185,129,0.2)'
    : isError
      ? 'rgba(239,68,68,0.2)'
      : 'rgba(59,130,246,0.15)';
  indicator.style.background = isDone
    ? 'rgba(16,185,129,0.05)'
    : isError
      ? 'rgba(239,68,68,0.05)'
      : 'rgba(59,130,246,0.05)';
}

function isKeyboardActivationEvent(e) {
  return e.key === 'Enter' || e.key === ' ';
}

function enableKeyboardActivation(el, onActivate) {
  if (!el || typeof onActivate !== 'function') return;
  el.addEventListener('keydown', (e) => {
    if (!isKeyboardActivationEvent(e)) return;
    e.preventDefault();
    onActivate(e);
  });
}

function isElementShown(el) {
  if (!el || !el.isConnected) return false;
  if (el.classList?.contains('hidden')) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function isTypingTarget(target) {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  if (el.closest('input, textarea, select, [contenteditable="true"]')) return true;
  const active = document.activeElement;
  if (!(active instanceof Element)) return false;
  return Boolean(active.closest('input, textarea, select, [contenteditable="true"]'));
}

function getShortcutMap() {
  const out = { ...DEFAULT_SHORTCUTS };
  const incoming = state.settings?.keyboardShortcuts;
  if (incoming && typeof incoming === 'object') {
    for (const key of Object.keys(DEFAULT_SHORTCUTS)) {
      if (Object.prototype.hasOwnProperty.call(incoming, key)) {
        out[key] = sanitizeShortcutSpec(incoming[key], DEFAULT_SHORTCUTS[key]);
      }
    }
  }
  return out;
}

function renderShortcutEditor(shortcuts) {
  if (!domRefs.settingShortcutsEditor) return;
  const values = shortcuts || getShortcutMap();
  domRefs.settingShortcutsEditor.innerHTML = '';
  state.shortcutCaptureKey = '';
  state.shortcutCaptureButton = null;
  SHORTCUT_FIELD_DEFS.forEach((def) => {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    const label = document.createElement('div');
    label.className = 'text-[10px] text-zinc-300';
    label.textContent = def.hint ? `${def.label} (${def.hint})` : def.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'panel-input font-mono-custom text-[11px]';
    input.placeholder = DEFAULT_SHORTCUTS[def.key] || '';
    input.value = sanitizeShortcutSpec(values[def.key], DEFAULT_SHORTCUTS[def.key]);
    input.dataset.shortcutKey = def.key;
    input.readOnly = true;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-action !px-3';
    btn.textContent = 'Change';
    btn.dataset.shortcutAssignKey = def.key;
    btn.addEventListener('click', () => {
      beginShortcutCapture(def.key, btn);
    });
    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(btn);
    domRefs.settingShortcutsEditor.appendChild(row);
  });
  refreshShortcutValidationUi();
}

function readShortcutEditorValue() {
  const out = {};
  for (const key of Object.keys(DEFAULT_SHORTCUTS)) {
    out[key] = DEFAULT_SHORTCUTS[key];
  }
  const container = domRefs.settingShortcutsEditor;
  if (!container) return out;
  container.querySelectorAll('input[data-shortcut-key]').forEach((el) => {
    const key = String(el.dataset.shortcutKey || '');
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SHORTCUTS, key)) return;
    out[key] = sanitizeShortcutSpec(el.value, DEFAULT_SHORTCUTS[key]);
  });
  return out;
}

function stopShortcutCapture() {
  const btn = state.shortcutCaptureButton;
  if (btn && btn.isConnected) {
    btn.textContent = 'Change';
    btn.classList.remove('bg-amber-600', 'hover:bg-amber-500', 'text-white');
  }
  state.shortcutCaptureKey = '';
  state.shortcutCaptureButton = null;
}

function beginShortcutCapture(shortcutKey, buttonEl) {
  stopShortcutCapture();
  state.shortcutCaptureKey = String(shortcutKey || '');
  state.shortcutCaptureButton = buttonEl || null;
  if (buttonEl) {
    buttonEl.textContent = 'キー待機中...';
    buttonEl.classList.add('bg-amber-600', 'hover:bg-amber-500', 'text-white');
  }
}
function validateShortcutMap(shortcuts) {
  return validateShortcutMapWithDefs(shortcuts, SHORTCUT_FIELD_DEFS, RESERVED_SHORTCUTS);
}

function applyShortcutValidationUi(result) {
  state.shortcutValidation = result || { duplicates: [], reservedHits: [] };
  const container = domRefs.settingShortcutsEditor;
  if (container) {
    container.querySelectorAll('.shortcut-row').forEach((row) => {
      row.classList.remove('border', 'border-red-500/60', 'rounded-lg', 'bg-red-900/10');
    });
    const markKey = (k) => {
      const row = container.querySelector(`input[data-shortcut-key="${k}"]`)?.closest('.shortcut-row');
      if (!row) return;
      row.classList.add('border', 'border-red-500/60', 'rounded-lg', 'bg-red-900/10');
    };
    (result?.duplicates || []).forEach((group) => group.forEach((k) => markKey(k)));
    (result?.reservedHits || []).forEach((r) => markKey(r.key));
  }
  if (!domRefs.settingShortcutsWarning) return;
  const msgs = [];
  if (result?.duplicates?.length) {
    msgs.push(`重複: ${result.duplicates.length} 件`);
  }
  if (result?.reservedHits?.length) {
    msgs.push(`予約キー: ${result.reservedHits.length} 件`);
  }
  if (!msgs.length) {
    domRefs.settingShortcutsWarning.textContent = '重複・予約キーの問題はありません。';
    domRefs.settingShortcutsWarning.className = 'text-[10px] text-emerald-300 min-h-[16px]';
    return;
  }
  domRefs.settingShortcutsWarning.textContent = msgs.join(' / ');
  domRefs.settingShortcutsWarning.className = 'text-[10px] text-amber-300 min-h-[16px]';
}

function refreshShortcutValidationUi() {
  applyShortcutValidationUi(validateShortcutMap(readShortcutEditorValue()));
}

function showShortcutsTutorialOverlay(...args) {
  return callRendererModule('auxUi', 'showShortcutsTutorialOverlay', args);
}

function maybeShowShortcutsTutorialOnStartup(...args) {
  return callRendererModule('appState', 'maybeShowShortcutsTutorialOnStartup', args);
}

function buildCandidateTokens(...args) {
  return callRendererModule('appState', 'buildCandidateTokens', args);
}

function renderImportHistoryInModal(history) {
  if (!domRefs.assetImportHistory) return;
  domRefs.assetImportHistory.innerHTML = '';
  const rows = Array.isArray(history) ? history : [];
  if (!rows.length) {
    domRefs.assetImportHistory.textContent = 'Unityインポート履歴はありません。';
    return;
  }

  const sorted = [...rows].sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime());
  sorted.slice(0, 20).forEach((h) => {
    const top = Array.isArray(h?.topFolders) && h.topFolders.length ? h.topFolders[0].name : 'Assets';
    const tokenText = Array.isArray(h?.tokens) && h.tokens.length ? ` (${h.tokens.join(', ')})` : '';
    const line = document.createElement('div');
    line.className = 'flex justify-between gap-2';
    line.innerHTML = `
      <span class="truncate">[${esc(`${top}${tokenText}`)}] ${esc(h?.projectName || pathBasename(h?.projectPath || ''))}</span>
      <span class="text-[9px] text-gray-500 flex-shrink-0">${esc(formatDate(h?.importedAt))}</span>
    `;
    domRefs.assetImportHistory.appendChild(line);
  });
}

/**
 * Pick an icon that matches the file extension.
 */
function getIconForFile(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['unitypackage', 'unity', 'prefab', 'mat'].includes(ext)) return ICONS.unity;
  if (['blend', 'blend1'].includes(ext)) return ICONS.blender;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'tga', 'psd', 'bmp'].includes(ext)) return ICONS.image;
  if (['fbx', 'vrm', 'obj', 'glb', 'gltf'].includes(ext)) return ICONS.model;
  if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return ICONS.audio;
  if (['zip', 'rar', '7z', 'tar'].includes(ext)) return ICONS.archive;
  if (['txt', 'md', 'json', 'html', 'css', 'js', 'pdf'].includes(ext)) return ICONS.text;
  return ICONS.file;
}

/**
 * Return true when the file should be treated as an image.
 */
function isImageFile(name) {
  const lower = (name || '').toLowerCase();
  return lower.match(/\.(png|jpg|jpeg|gif|webp|tga|bmp)$/);
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, idx);
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[idx]}`;
}

let storageRefreshTimer = null;
let storageRefreshInFlight = false;

async function refreshStorageUsageUI() {
  if (!window.boothAPI?.getStorageUsage) return;
  if (storageRefreshInFlight) return;
  storageRefreshInFlight = true;
  try {
    const res = await window.boothAPI.getStorageUsage();
    if (!res || res.error) return;
    const appBytes = Number(res.appBytes || res.totalBytes || 0);
    const driveTotal = Number(res.drive?.totalBytes || 0);
    const driveUsed = Number(res.drive?.usedBytes || 0);
    const otherUsed = Math.max(0, driveUsed - appBytes);
    if (domRefs.storageUsageText) {
      if (driveTotal > 0) {
        domRefs.storageUsageText.textContent = `${formatBytes(appBytes)} / ${formatBytes(driveTotal)}`;
        domRefs.storageUsageText.title = `アプリ ${appBytes.toLocaleString()} バイト / ドライブ ${driveTotal.toLocaleString()} バイト`;
      } else {
        domRefs.storageUsageText.textContent = formatBytes(appBytes);
        domRefs.storageUsageText.title = `${appBytes.toLocaleString()} バイト`;
      }
    }
    if (driveTotal > 0) {
      const appPct = Math.max(0, Math.min(100, (appBytes / driveTotal) * 100));
      const otherPct = Math.max(0, Math.min(100, (otherUsed / driveTotal) * 100));
      if (domRefs.storageOtherBar) {
        domRefs.storageOtherBar.style.width = `${otherPct}%`;
        domRefs.storageOtherBar.title = `その他使用量: ${formatBytes(otherUsed)} (${otherPct.toFixed(2)}%)`;
      }
      if (domRefs.storageAppBar) {
        domRefs.storageAppBar.style.left = `${otherPct}%`;
        domRefs.storageAppBar.style.width = `${appPct}%`;
        domRefs.storageAppBar.title = `アプリ使用量: ${formatBytes(appBytes)} (${appPct.toFixed(2)}%)`;
      }
      if (domRefs.storageBreakdown) {
        domRefs.storageBreakdown.textContent = `アプリ ${appPct.toFixed(2)}% / その他 ${otherPct.toFixed(2)}%`;
      }
    } else {
      if (domRefs.storageOtherBar) domRefs.storageOtherBar.style.width = '0%';
      if (domRefs.storageAppBar) {
        domRefs.storageAppBar.style.left = '0%';
        domRefs.storageAppBar.style.width = '0%';
      }
      if (domRefs.storageBreakdown) {
        domRefs.storageBreakdown.textContent = `アプリ ${formatBytes(appBytes)}`;
      }
    }
  } catch (e) {
    console.warn('storage usage refresh failed', e);
  } finally {
    storageRefreshInFlight = false;
  }
}

function scheduleStorageUsageRefresh(delay = 800) {
  if (storageRefreshTimer) clearTimeout(storageRefreshTimer);
  storageRefreshTimer = setTimeout(() => {
    storageRefreshTimer = null;
    refreshStorageUsageUI().catch(() => {});
  }, delay);
}

/**
 * Read scoped meta progress from the renderer app-state module.
 */
function getPhaseLocalProgress(...args) {
  return callRendererModule('appState', 'getPhaseLocalProgress', args);
}

/**
 * Read or reset global meta progress state.
 */
function getGlobalMetaProgress(...args) { return callRendererModule('appState', 'getGlobalMetaProgress', args); }
function resetMetaProgressState(...args) { return callRendererModule('appState', 'resetMetaProgressState', args); }
function beginMetaProgressScope(...args) { return callRendererModule('appState', 'beginMetaProgressScope', args); }
function endMetaProgressScope(...args) { return callRendererModule('appState', 'endMetaProgressScope', args); }
function setUpdateCheckUi(...args) { return callRendererModule('appState', 'setUpdateCheckUi', args); }
function setUpdateActionUi(...args) { return callRendererModule('appState', 'setUpdateActionUi', args); }
function setAutoUpdateNotifyButton(...args) { return callRendererModule('appState', 'setAutoUpdateNotifyButton', args); }
function upsertPendingAutoUpdates(...args) { return callRendererModule('appState', 'upsertPendingAutoUpdates', args); }

function isSuppressedNotificationType(type) {
  const t = String(type || '').trim().toLowerCase();
  return t === 'app-update' || t === 'library-updates';
}

function isSuppressedNotificationMessage(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  return /起動時の自動ダウンロード[:：]/i.test(text)
    || /起動時の自動ダウンロードを開始しました/i.test(text)
    || /起動時の自動ダウンロードを実行中/i.test(text)
    || /起動時の自動ダウンロードが完了しました/i.test(text)
    || /^ヘルスチェック:\s*error\s*\d+\s*\/\s*warn\s*\d+/i.test(text)
    || /アップデート開始を要求しました。進捗を確認してください。/i.test(text)
    || /更新のダウンロードが完了しました。再起動で適用されます。/i.test(text)
    || /アプリ更新/i.test(text);
}

function isImportantTransientNotification(message, tone = 'info') {
  const level = String(tone || '').trim().toLowerCase();
  if (level === 'error' || level === 'warn') return true;
  const text = String(message || '').trim();
  if (!text) return false;
  return /失敗|エラー|警告|できません|見つかりません|error|failed?|warn(ing)?/i.test(text);
}

function isImportantNotificationItem(item) {
  if (!item || typeof item !== 'object') return false;
  const type = String(item.type || '').trim().toLowerCase();
  if (type !== 'transient') return true;
  const tone = String(item?.payload?.tone || 'info');
  return isImportantTransientNotification(item.message, tone);
}

function sanitizeNotificationCenterState(...args) {
  return callRendererModule('appState', 'sanitizeNotificationCenterState', args);
}

function upsertNotificationItem(...args) {
  return callRendererModule('appState', 'upsertNotificationItem', args);
}

function markNotificationAsRead(...args) { return callRendererModule('appState', 'markNotificationAsRead', args); }

function removeNotificationItem(...args) { return callRendererModule('appState', 'removeNotificationItem', args); }

function clearAllNotifications(...args) { return callRendererModule('appState', 'clearAllNotifications', args); }

function showNotificationCenter(...args) { return callRendererModule('auxUi', 'showNotificationCenter', args); }

function matchesSearch(asset, query) {
  const raw = String(query || '').trim();
  if (!raw) return true;

  const avatarOnly = raw.match(/^(?:avatar|av|ava):\s*(.*)$/i);
  if (avatarOnly) {
    const aq = String(avatarOnly[1] || '').trim().toLowerCase();
    if (!aq) return true;
    const avatarPool = [
      ...(Array.isArray(asset.supportedAvatars) ? asset.supportedAvatars : []),
      ...(Array.isArray(asset.supportedAvatarsInferred) ? asset.supportedAvatarsInferred : []),
    ];
    return avatarPool.some((n) => String(n || '').toLowerCase().includes(aq));
  }

  const q = raw.toLowerCase();
  if ((asset.title || '').toLowerCase().includes(q)) return true;
  if ((asset.nameAliases || []).some((n) => String(n || '').toLowerCase().includes(q))) return true;
  if ((asset.supportedAvatars || []).some((n) => String(n || '').toLowerCase().includes(q))) return true;
  if ((asset.supportedAvatarsInferred || []).some((n) => String(n || '').toLowerCase().includes(q))) return true;
  if ((asset.author || '').toLowerCase().includes(q)) return true;
  if (getCategoryDisplayText(asset.primaryCategory, '').toLowerCase().includes(q)) return true;
  if ((asset.files || []).some((f) => (f.fileName || '').toLowerCase().includes(q))) return true;
  if ((asset.categories || []).some((c) => getCategoryDisplayText(c, '').toLowerCase().includes(q))) return true;
  if ((asset.userTags || []).some((t) => String(t || '').toLowerCase().includes(q))) return true;
  if ((asset.userNote || '').toLowerCase().includes(q)) return true;
  return false;
}

function decodeCategorySlugLabel(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const noPrefix = value.replace(/^https?:\/\/booth\.pm\/[a-z]{2}\/browse\//i, '');
  try {
    return decodeURIComponent(noPrefix).trim();
  } catch {
    return noPrefix.trim();
  }
}

function getCategoryDisplayText(category, fallback = 'その他') {
  if (!category || typeof category !== 'object') return fallback;
  const text = String(category.text || '').trim();
  if (text) return text;
  const slugText = decodeCategorySlugLabel(category.slug);
  if (slugText) return slugText;
  const hrefText = decodeCategorySlugLabel(category.href);
  if (hrefText) return hrefText;
  return fallback;
}

// ========== UI Components ==========

/**
 * Create a grid-style asset tile. Kept for the legacy inline renderer path.
 */
function createAssetTile(asset) {
  const tile = document.createElement('div');
  tile.className = 'asset-tile p-3 group cursor-pointer bg-[#181b20] hover:bg-[#23272f] border border-gray-800 hover:border-blue-500/50 rounded-lg transition-all flex flex-col gap-2 shadow-sm hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70';
  tile.dataset.itemId = asset.itemId;
  tile.tabIndex = 0;
  tile.setAttribute('role', 'button');
  tile.setAttribute('aria-label', `${asset.title || '無題'} を開く`);

  const previewSrc = asset.preview?.[0] || '';
  const orderText = formatDate(asset.orderDate);
  const authorIcon = asset.authorIcon || '';
  const author = asset.author || '不明';
  const categoryText = getCategoryDisplayText(asset.primaryCategory, 'その他');

  // Thumbnail area
  const thumbWrapper = document.createElement('div');
  thumbWrapper.className = 'relative w-full pb-[100%] bg-[#111] overflow-hidden rounded-md mb-1';
  if (previewSrc) {
    const img = document.createElement('img');
    img.src = previewSrc;
    img.className = 'absolute inset-0 booth-image-contain transition-transform group-hover:scale-105';
    img.loading = 'lazy';
    thumbWrapper.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'absolute inset-0 flex items-center justify-center text-gray-700 text-[10px]';
    placeholder.textContent = '[画像なし]';
    thumbWrapper.appendChild(placeholder);
  }
  if (asset.hasUpdate) {
    const updateBadge = document.createElement('div');
    updateBadge.className = 'absolute top-2 right-2 px-2 py-0.5 bg-amber-400 text-black text-[8px] font-bold rounded-sm shadow z-10';
    updateBadge.textContent = '更新あり';
    thumbWrapper.appendChild(updateBadge);
  }

  const checkbox = document.createElement('div');
  checkbox.className = `absolute top-2 left-2 z-20 w-4 h-4 rounded border border-gray-500 bg-black/50 cursor-pointer selection-checkbox ${state.selectionMode ? '' : 'hidden'}`;
  checkbox.tabIndex = 0;
  checkbox.setAttribute('role', 'checkbox');
  checkbox.setAttribute('aria-label', `${asset.title || '無題'} を選択`);
  if (!asset.downloaded) {
    checkbox.classList.add('opacity-40', 'cursor-not-allowed');
    checkbox.setAttribute('aria-disabled', 'true');
  } else {
    checkbox.setAttribute('aria-disabled', 'false');
  }
  checkbox.innerHTML = '<div class="w-2.5 h-2.5 bg-blue-500 rounded-sm hidden m-[3px] pointer-events-none check-mark"></div>';
  if (state.selectedItems.has(String(asset.itemId))) {
    checkbox.querySelector('.check-mark')?.classList.remove('hidden');
    checkbox.classList.add('border-blue-500', 'bg-blue-900/30');
  }
  checkbox.setAttribute('aria-checked', state.selectedItems.has(String(asset.itemId)) ? 'true' : 'false');
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    const changed = toggleSelection(String(asset.itemId), checkbox);
    if (changed) checkbox.setAttribute('aria-checked', state.selectedItems.has(String(asset.itemId)) ? 'true' : 'false');
  });
  enableKeyboardActivation(checkbox, (e) => {
    e.stopPropagation();
    const changed = toggleSelection(String(asset.itemId), checkbox);
    if (changed) checkbox.setAttribute('aria-checked', state.selectedItems.has(String(asset.itemId)) ? 'true' : 'false');
  });
  thumbWrapper.appendChild(checkbox);

  // Info container
  const infoContainer = document.createElement('div');
  infoContainer.className = 'flex flex-col gap-1.5 flex-1';

  // 1. Category badge
  if (asset.isRemoved) {
    const removedBadge = document.createElement('span');
    removedBadge.className = 'text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 self-start truncate max-w-full';
    removedBadge.textContent = '削除済み';
    infoContainer.appendChild(removedBadge);
  } else if (asset.isWishlisted && !asset.downloaded) {
    const wishBadge = document.createElement('span');
    wishBadge.className = 'text-[9px] px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-300 border border-pink-500/20 self-start truncate max-w-full';
    wishBadge.textContent = 'ほしい';
    infoContainer.appendChild(wishBadge);
  } else if (categoryText && categoryText !== 'その他') {
    const catBadge = document.createElement('span');
    catBadge.className = 'text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 self-start truncate max-w-full';
    catBadge.textContent = categoryText;
    infoContainer.appendChild(catBadge);
  }

  // 2. Title
  const title = document.createElement('h3');
  title.className = 'text-[13px] font-bold text-gray-100 leading-snug line-clamp-2 group-hover:text-blue-400 h-[2.6em] transition-colors';
  title.textContent = asset.title || '無題';
  title.title = asset.title || '無題';
  infoContainer.appendChild(title);

  const isWishlistOnly = Boolean(asset.isWishlisted) && !asset.downloaded && !(asset.files && asset.files.length);
  if (isWishlistOnly) {
    const priceChip = createWishlistPriceChip(asset);
    if (priceChip) infoContainer.appendChild(priceChip);
  }

  const supportedAvatars = Array.isArray(asset.supportedAvatars) ? asset.supportedAvatars.filter(Boolean) : [];
  if (supportedAvatars.length) {
    const badgeRow = document.createElement('div');
    badgeRow.className = 'flex flex-wrap gap-1 mt-1';
    for (const name of supportedAvatars.slice(0, 5)) {
      const imgUrl = state.avatarImageMap?.get(name) || '';
      const displayName = state.avatarLabelMap?.get(name) || name;
      const badge = document.createElement('span');
      badge.dataset.avatarName = name;
      badge.title = displayName;
      badge.setAttribute('aria-label', `対応アバター: ${displayName}`);
      if (imgUrl) {
        badge.className = 'inline-block w-4 h-4 rounded-full overflow-hidden border border-white/15 flex-shrink-0';
        const imgEl = document.createElement('img');
        imgEl.src = imgUrl;
        imgEl.className = 'booth-image-contain';
        imgEl.alt = name;
        badge.appendChild(imgEl);
      } else {
        badge.className = 'inline-flex items-center max-w-full rounded border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 text-[8px] font-bold leading-none text-cyan-200 truncate';
        badge.textContent = displayName;
      }
      badgeRow.appendChild(badge);
    }
    if (badgeRow.childNodes.length) infoContainer.appendChild(badgeRow);
  }

  // 3. Author and order date footer
  const footerRow = document.createElement('div');
  footerRow.className = 'flex items-center justify-between mt-auto pt-1 border-t border-gray-800/50';

  const authorBox = document.createElement('div');
  authorBox.className = 'flex items-center gap-1.5 min-w-0';
  if (authorIcon) {
    const iconImg = document.createElement('img');
    iconImg.src = authorIcon;
    iconImg.className = 'w-4 h-4 rounded-full object-cover flex-shrink-0';
    authorBox.appendChild(iconImg);
  }
  const authorName = document.createElement('span');
  authorName.className = 'text-[10px] text-gray-400 truncate';
  authorName.textContent = author;
  authorBox.appendChild(authorName);

  const dateText = document.createElement('span');
  dateText.className = 'text-[9px] text-gray-600 font-mono flex-shrink-0';
  // Render compact yyyy.mm.dd text to reduce visual noise.
  const d = new Date(asset.orderDate);
  if (!isNaN(d.getTime())) {
    dateText.textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }

  footerRow.appendChild(authorBox);
  footerRow.appendChild(dateText);
  infoContainer.appendChild(footerRow);

  // Download controls
  const downloadContainer = document.createElement('div');
  downloadContainer.className = 'download-container mt-auto pt-2 border-t border-gray-800/50';

  const buttonRow = document.createElement('div');
  buttonRow.className = 'flex items-center justify-between gap-2';

  const openBtn = document.createElement('button');
  openBtn.className = 'open-btn text-[9px] px-2 py-1 text-gray-500 hover:text-white transition';
  openBtn.textContent = 'フォルダ';

  let dlBtn = null;
  if (!isWishlistOnly) {
    dlBtn = document.createElement('button');
    dlBtn.className = `dl-btn text-[9px] px-2 py-1 border transition ${asset.downloaded
      ? 'border-blue-600 text-blue-300 hover:bg-blue-600/20'
      : 'border-gray-700 hover:bg-white hover:text-black'}`;
    dlBtn.textContent = asset.downloaded ? 'インポート' : 'ダウンロード';
    buttonRow.appendChild(dlBtn);
  }

  if (isWishlistOnly) {
    const priceChip = createWishlistPriceChip(asset, true);
    if (priceChip) buttonRow.appendChild(priceChip);
  } else {
    buttonRow.appendChild(openBtn);
  }

  const progressWrapper = document.createElement('div');
  progressWrapper.className = 'progress-wrapper mt-2 opacity-0 transition-opacity duration-150';
  progressWrapper.style.minHeight = '4px';
  const progressBarContainer = document.createElement('div');
  progressBarContainer.className = 'h-1 w-full bg-black rounded-full overflow-hidden';
  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar h-full bg-blue-500 transition-all duration-300';
  progressBar.style.width = '0%';
  progressBarContainer.appendChild(progressBar);
  progressWrapper.appendChild(progressBarContainer);

  downloadContainer.appendChild(buttonRow);
  downloadContainer.appendChild(progressWrapper);

  // Event listeners
  tile.addEventListener('click', (e) => {
    if (state.selectionMode) {
      toggleSelection(String(asset.itemId), checkbox);
      checkbox.setAttribute('aria-checked', state.selectedItems.has(String(asset.itemId)) ? 'true' : 'false');
      return;
    }
    openPreviewModal(asset);
  });
  enableKeyboardActivation(tile, () => {
    if (state.selectionMode) {
      const changed = toggleSelection(String(asset.itemId), checkbox);
      if (changed) checkbox.setAttribute('aria-checked', state.selectedItems.has(String(asset.itemId)) ? 'true' : 'false');
      return;
    }
    openPreviewModal(asset);
  });

  dlBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const latestAsset = getAssetByItemId(asset.itemId) || asset;
    const uiShowsImport = String(e.currentTarget?.textContent || '').trim().includes('インポート');
    if (uiShowsImport || shouldTreatAsDownloaded(asset.itemId, latestAsset)) {
      await openImportForAsset({ ...latestAsset, downloaded: true });
    } else {
      await handleDownload(latestAsset, tile);
    }
  });

  openBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.boothAPI.openItemFolder(asset.itemId, asset.title);
  });

  // DOM讒狗ｯ・
  tile.appendChild(thumbWrapper);
  tile.appendChild(infoContainer);
  tile.appendChild(downloadContainer);

  // Store references used by progress/status updates.
  state.tileMap.set(toItemIdKey(asset.itemId), {
    tile,
    progressBar,
    progressWrapper,
    progWrapper: progressWrapper,
    dlBtn,
    statusEl: null, // Legacy inline tile path does not render a status label.
    bytesBar: progressBar,
    filesBar: null,
    filesLabel: null,
    downloadBtn: dlBtn,
  });

  return tile;
}

function createAssetListHeaderRow() {
  const row = document.createElement('div');
  row.className = 'bg-[#0f1013] border border-gray-800 rounded px-3 py-2 text-[10px] text-gray-400 font-mono-custom';
  row.style.display = 'grid';
  row.style.gridTemplateColumns = getListGridTemplateColumns();
  row.style.alignItems = 'center';
  row.style.gap = '10px';

  const cols = state.selectionMode
    ? ['', '', '名前', 'カテゴリ', '作者', '追加日時', 'ファイル', '操作']
    : ['', '名前', 'カテゴリ', '作者', '追加日時', 'ファイル', '操作'];

  cols.forEach((text) => {
    const c = document.createElement('div');
    c.textContent = text;
    row.appendChild(c);
  });
  return row;
}

function createAssetListRow(asset) {
  const row = document.createElement('div');
  row.className = 'border border-gray-800 rounded px-3 py-2 bg-[#121419] hover:bg-[#1a1f28] hover:border-blue-500/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70';
  row.dataset.itemId = asset.itemId;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', `${asset.title || '無題'} を開く`);
  row.style.display = 'grid';
  row.style.gridTemplateColumns = getListGridTemplateColumns();
  row.style.alignItems = 'center';
  row.style.gap = '10px';

  let checkbox = null;
  if (state.selectionMode) {
    checkbox = document.createElement('div');
    checkbox.className = 'w-4 h-4 rounded border border-gray-500 bg-black/50 cursor-pointer selection-checkbox';
    checkbox.tabIndex = 0;
    checkbox.setAttribute('role', 'checkbox');
    checkbox.setAttribute('aria-label', `${asset.title || '無題'} を選択`);
    if (!asset.downloaded) {
      checkbox.classList.add('opacity-40', 'cursor-not-allowed');
      checkbox.setAttribute('aria-disabled', 'true');
    } else {
      checkbox.setAttribute('aria-disabled', 'false');
    }
    checkbox.innerHTML = '<div class="w-2.5 h-2.5 bg-blue-500 rounded-sm hidden m-[3px] pointer-events-none check-mark"></div>';
    if (state.selectedItems.has(String(asset.itemId))) {
      checkbox.querySelector('.check-mark')?.classList.remove('hidden');
      checkbox.classList.add('border-blue-500', 'bg-blue-900/30');
    }
    checkbox.setAttribute('aria-checked', state.selectedItems.has(String(asset.itemId)) ? 'true' : 'false');
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      const changed = toggleSelection(String(asset.itemId), checkbox);
      if (changed) checkbox.setAttribute('aria-checked', state.selectedItems.has(String(asset.itemId)) ? 'true' : 'false');
    });
    enableKeyboardActivation(checkbox, (e) => {
      e.stopPropagation();
      const changed = toggleSelection(String(asset.itemId), checkbox);
      if (changed) checkbox.setAttribute('aria-checked', state.selectedItems.has(String(asset.itemId)) ? 'true' : 'false');
    });
    row.appendChild(checkbox);
  }

  const thumbCell = document.createElement('div');
  thumbCell.className = 'w-10 h-10 rounded bg-[#0b0d12] border border-gray-800 overflow-hidden';
  if (asset.preview?.[0]) {
    const img = document.createElement('img');
    img.src = asset.preview[0];
    img.className = 'booth-image-contain';
    img.loading = 'lazy';
    thumbCell.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'w-full h-full flex items-center justify-center text-[8px] text-gray-600';
    ph.textContent = 'NO IMG';
    thumbCell.appendChild(ph);
  }
  row.appendChild(thumbCell);

  const nameCell = document.createElement('div');
  nameCell.className = 'min-w-0';
  nameCell.innerHTML = `
    <div class="text-[11px] text-gray-100 truncate">${esc(asset.title || '無題')}</div>
    <div class="text-[9px] text-gray-500 font-mono-custom truncate">#${esc(String(asset.itemId || ''))}</div>
  `;
  row.appendChild(nameCell);

  const catCell = document.createElement('div');
  catCell.className = 'text-[10px] text-blue-300 truncate';
  catCell.textContent = getCategoryDisplayText(asset.primaryCategory, 'その他');
  row.appendChild(catCell);

  const authorCell = document.createElement('div');
  authorCell.className = 'text-[10px] text-gray-300 truncate';
  authorCell.textContent = asset.author || '不明';
  row.appendChild(authorCell);

  const dateCell = document.createElement('div');
  dateCell.className = 'text-[10px] text-gray-400 font-mono-custom';
  dateCell.textContent = formatDate(asset.orderDate);
  row.appendChild(dateCell);

  const filesCell = document.createElement('div');
  filesCell.className = 'text-[10px] text-gray-400 font-mono-custom';
  filesCell.textContent = String((asset.files || []).length);
  row.appendChild(filesCell);

  const actionsCell = document.createElement('div');
  actionsCell.className = 'flex flex-col gap-1';

  const actionTop = document.createElement('div');
  actionTop.className = 'flex items-center gap-1';

  const isWishlistOnlyRow = Boolean(asset.isWishlisted) && !asset.downloaded && !(asset.files && asset.files.length);

  let dlBtn = null;
  if (!isWishlistOnlyRow) {
    dlBtn = document.createElement('button');
    dlBtn.className = `dl-btn text-[9px] px-2 py-1 border transition rounded ${asset.downloaded
      ? 'border-blue-600 text-blue-300 hover:bg-blue-600/20'
      : 'border-gray-700 hover:bg-white hover:text-black'}`;
    dlBtn.textContent = asset.downloaded ? 'インポート' : 'ダウンロード';
    actionTop.appendChild(dlBtn);
  }

  const openBtn = document.createElement('button');
  openBtn.className = 'open-btn text-[9px] px-2 py-1 text-gray-400 hover:text-white border border-gray-800 rounded';
  openBtn.textContent = 'Folder';

  const statusEl = document.createElement('span');
  statusEl.className = `text-[9px] ml-1 ${asset.hasUpdate ? 'text-amber-300' : (asset.downloaded ? 'text-emerald-300' : 'text-gray-500')}`;
  statusEl.textContent = asset.hasUpdate ? '更新あり' : (asset.downloaded ? 'DL済み' : '未DL');

  if (isWishlistOnlyRow) {
    const priceChip = createWishlistPriceChip(asset, true);
    if (priceChip) actionTop.appendChild(priceChip);
  } else {
    actionTop.appendChild(openBtn);
    actionTop.appendChild(statusEl);
  }

  const progressWrapper = document.createElement('div');
  progressWrapper.className = 'progress-wrapper opacity-0 transition-opacity duration-150';
  progressWrapper.style.minHeight = '4px';
  const progressBarContainer = document.createElement('div');
  progressBarContainer.className = 'h-1 w-full bg-black rounded-full overflow-hidden';
  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar h-full bg-blue-500 transition-all duration-300';
  progressBar.style.width = '0%';
  progressBarContainer.appendChild(progressBar);
  progressWrapper.appendChild(progressBarContainer);

  actionsCell.appendChild(actionTop);
  actionsCell.appendChild(progressWrapper);
  row.appendChild(actionsCell);

  row.addEventListener('click', () => {
    if (state.selectionMode && checkbox) {
      toggleSelection(String(asset.itemId), checkbox);
      checkbox.setAttribute('aria-checked', state.selectedItems.has(String(asset.itemId)) ? 'true' : 'false');
      return;
    }
    openPreviewModal(asset);
  });
  enableKeyboardActivation(row, () => {
    if (state.selectionMode && checkbox) {
      const changed = toggleSelection(String(asset.itemId), checkbox);
      if (changed) checkbox.setAttribute('aria-checked', state.selectedItems.has(String(asset.itemId)) ? 'true' : 'false');
      return;
    }
    openPreviewModal(asset);
  });
  dlBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const latestAsset = getAssetByItemId(asset.itemId) || asset;
    const uiShowsImport = String(e.currentTarget?.textContent || '').trim().includes('インポート');
    if (uiShowsImport || shouldTreatAsDownloaded(asset.itemId, latestAsset)) {
      await openImportForAsset({ ...latestAsset, downloaded: true });
    } else {
      await handleDownload(latestAsset, row);
    }
  });
  openBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.boothAPI.openItemFolder(asset.itemId, asset.title || '');
  });

  state.tileMap.set(toItemIdKey(asset.itemId), {
    tile: row,
    progressBar,
    progressWrapper,
    progWrapper: progressWrapper,
    dlBtn,
    statusEl,
    bytesBar: progressBar,
    filesBar: null,
    filesLabel: null,
    downloadBtn: dlBtn,
  });
  return row;
}

function getListGridTemplateColumns() {
  return state.selectionMode
    ? '28px 44px minmax(200px,2fr) minmax(120px,1fr) minmax(100px,1fr) 110px 70px 160px'
    : '44px minmax(200px,2fr) minmax(120px,1fr) minmax(100px,1fr) 110px 70px 160px';
}

// ========== Core Logic ==========

function normalizeAssetsFromMap(data) {
  return Object.values(data || {}).sort(compareAssetsByAddedDateDesc);
}

function toItemIdKey(itemId) {
  return String(itemId || '');
}

function getAssetByItemId(itemId) {
  return state.assetByItemId.get(toItemIdKey(itemId)) || null;
}

function getTileEntryByItemId(itemId) {
  return state.tileMap.get(toItemIdKey(itemId)) || null;
}

function shouldTreatAsDownloaded(itemId, fallbackAsset) {
  const latestAsset = getAssetByItemId(itemId) || fallbackAsset || null;
  if (latestAsset?.downloaded) return true;
  const entry = getTileEntryByItemId(itemId);
  const btnText = String(entry?.downloadBtn?.textContent || '').trim();
  const statusText = String(entry?.statusEl?.textContent || '').trim();
  if (btnText.includes('インポート')) return true;
  if (statusText.includes('DL済み') || statusText.includes('完了')) return true;
  return false;
}

function countUnanalyzedDownloaded() {
  const rows = Array.isArray(state.allAssets) ? state.allAssets : [];
  return rows.filter((a) => a.downloaded && !String(a?.avatarAnalysisCheckedAt || '').trim()).length;
}

function updateAnalyzeAvatarCompatBtn() {
  const count = countUnanalyzedDownloaded();
  const badge = document.getElementById('analyze-avatar-compat-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    const downloadedCount = (Array.isArray(state.allAssets) ? state.allAssets : [])
      .filter((a) => a.downloaded).length;
    if (downloadedCount > 0) {
      badge.textContent = '再';
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

function setAssetsFromMap(data, options = {}) {
  const preserveRuntimeDownloaded = Boolean(options?.preserveRuntimeDownloaded);
  const previousByItemId = preserveRuntimeDownloaded
    ? new Map((state.allAssets || []).map((asset) => [toItemIdKey(asset?.itemId), asset]))
    : null;
  const nextAssets = normalizeAssetsFromMap(data);
  if (preserveRuntimeDownloaded && previousByItemId) {
    for (const asset of nextAssets) {
      const key = toItemIdKey(asset?.itemId);
      const previous = previousByItemId.get(key);
      const entry = state.tileMap instanceof Map ? state.tileMap.get(key) : null;
      const buttonText = String(entry?.downloadBtn?.textContent || '');
      const uiShowsImport = /Import|インポート|繧､繝ｳ繝昴・繝・/i.test(buttonText);
      if (!asset.downloaded && (previous?.downloaded || uiShowsImport)) {
        asset.downloaded = true;
      }
    }
  }
  state.allAssets = nextAssets;
  state.assetsRevision = Number(state.assetsRevision || 0) + 1;
  state.assetByItemId = new Map(state.allAssets.map((asset) => [toItemIdKey(asset?.itemId), asset]));
  if (Array.isArray(state.filteredAssets) && state.filteredAssets.length) {
    state.filteredAssets = state.filteredAssets.map((asset) => {
      const latest = state.assetByItemId.get(toItemIdKey(asset?.itemId));
      return latest || asset;
    });
  }
  state.downloadedAssets = state.allAssets.filter((a) => Boolean(a?.downloaded));
  state.updateAssetCount = state.allAssets.reduce((acc, a) => acc + (a?.hasUpdate ? 1 : 0), 0);
  if (state.allAssets.length > 0) {
    state.libraryEmptyReason = '';
  }
  const total = Array.isArray(state.allAssets) ? state.allAssets.length : 0;
  const withAvatar = (state.allAssets || []).filter((a) => getAssetAvatarPool(a).length > 0).length;
  logAvatarDebug('setAssetsFromMap', { totalAssets: total, assetsWithAvatar: withAvatar });
  state.avatarLabelMap = buildAvatarLabelMap(state.allAssets || [], []);
  refreshAvatarFilterOptions(state.allAssets);
  refreshAvatarAliasLabels({ rerender: true }).catch((e) => {
    console.warn('[renderer] refreshAvatarAliasLabels failed:', e);
  });
  buildCategoryOptions(state.allAssets.filter((a) => {
    if (a.isRemoved) return false;
    const hasRealContent = Boolean(a.downloaded) || Boolean(a.files && a.files.length);
    return hasRealContent || (!a.isWishlisted && !a.wishlistAddedAt);
  }));
  updateAnalyzeAvatarCompatBtn();
  if (state.boothClient?.onAssetsLoaded) {
    try { state.boothClient.onAssetsLoaded(state.allAssets); } catch {}
  }
}

async function refreshAvatarAliasLabels(options = {}) {
  const rerender = Boolean(options?.rerender);
  let avatarRows = [];
  try {
    if (window.boothAPI?.loadAvatarAliases) {
      const res = await window.boothAPI.loadAvatarAliases();
      if (Array.isArray(res?.avatars)) avatarRows = res.avatars;
    }
  } catch {
    avatarRows = [];
  }
  state.avatarLabelMap = buildAvatarLabelMap(state.allAssets || [], avatarRows);
  if (rerender) {
    refreshAvatarFilterOptions(state.allAssets || []);
    renderGrid();
  }
}

async function reloadAssetsMap(options = {}) {
  if (!window.boothAPI?.loadAssets) return;
  const preserveScroll = Boolean(options?.preserveScroll);
  const scroller = document.scrollingElement || document.documentElement;
  const prevScrollTop = preserveScroll ? Number(scroller?.scrollTop || 0) : 0;
  const assetsMap = await window.boothAPI.loadAssets();
  if (!assetsMap || assetsMap.error) return;
  setAssetsFromMap(assetsMap);
  applyCategoryFilter(state.currentCategory || 'all');
  if (preserveScroll && scroller) {
    requestAnimationFrame(() => {
      scroller.scrollTop = prevScrollTop;
    });
  }
  scheduleStorageUsageRefresh(120);
}

async function syncDownloadStateFromLatestMapNoRerender() {
  if (!window.boothAPI?.loadAssets) return false;
  const assetsMap = await window.boothAPI.loadAssets();
  if (!assetsMap || assetsMap.error) return false;
  let changed = false;
  for (const asset of (state.allAssets || [])) {
    const key = toItemIdKey(asset?.itemId);
    const latest = assetsMap?.[key];
    if (!latest) continue;
    const nextDownloaded = Boolean(latest?.downloaded);
    const nextHasUpdate = Boolean(latest?.hasUpdate);
    if (Boolean(asset.downloaded) !== nextDownloaded) {
      asset.downloaded = nextDownloaded;
      changed = true;
    }
    if (Boolean(asset.hasUpdate) !== nextHasUpdate) {
      asset.hasUpdate = nextHasUpdate;
      changed = true;
    }
  }
  if (changed) {
    state.assetsRevision = Number(state.assetsRevision || 0) + 1;
    state.assetByItemId = new Map(state.allAssets.map((asset) => [toItemIdKey(asset?.itemId), asset]));
    state.downloadedAssets = state.allAssets.filter((a) => Boolean(a?.downloaded));
    state.updateAssetCount = state.allAssets.reduce((acc, a) => acc + (a?.hasUpdate ? 1 : 0), 0);
  }
  return changed;
}

function getUndownloadedAssets() {
  return (state.allAssets || []).filter(a => !a.downloaded && (a.files || []).length > 0);
}

async function openImportForAsset(asset) {
  if (!asset || !asset.downloaded) {
    showTransientMessage('未ダウンロードのためインポートできません。', 'error');
    return;
  }
  if (!window.boothAPI?.listItemFiles) {
    showTransientMessage('listItemFiles API が利用できません。', 'error');
    return;
  }
  const res = await window.boothAPI.listItemFiles(asset.itemId, asset.title || '');
  if (res?.error || !Array.isArray(res?.files)) {
    showTransientMessage(`パッケージ一覧の取得に失敗: ${res?.error || 'unknown'}`, 'error');
    return;
  }
  const pkgs = res.files
    .filter((f) => f.kind === 'file' && String(f.name || '').toLowerCase().endsWith('.unitypackage'))
    .map((f) => ({ ...f, mtimeDate: new Date(f.mtime || 0) }))
    .sort((a, b) => Number(b.mtime || 0) - Number(a.mtime || 0));
  if (!pkgs.length) {
    showTransientMessage('このアイテムにUnityパッケージが見つかりません。', 'error');
    return;
  }
  openPackageSelectionModal([{ asset, packages: pkgs }]);
}

function getDownloadableAssets() {
  return (state.allAssets || []).filter((a) => Array.isArray(a.files) && a.files.length > 0);
}

function formatEnqueueError(res) {
  if (!res?.error) return '';
  if (res.error === 'insufficient_disk_space') {
    const free = formatBytes(res.freeBytes || 0);
    const need = formatBytes(res.minFreeBytes || 0);
    return `空き容量不足: 現在 ${free} / 必要最小 ${need}`;
  }
  return String(res.error || 'enqueue_failed');
}

async function enqueueAssets(assets, options = {}) {
  if (!assets || !assets.length) return { ok: true, skipped: true };
  const forceRedownload = Boolean(options?.forceRedownload);
  const payload = assets.map((a) => {
    const itemId = String(a.itemId || '');
    const shouldAnalyzeAfterDownload = !forceRedownload && !Boolean(a?.downloaded);
    return {
      itemId: a.itemId,
      title: a.title || '',
      files: a.files || [],
      forceRedownload,
      analyzeAfterDownload: shouldAnalyzeAfterDownload,
      expectedStableHash: state.expectedUpdateHashByItemId.get(itemId) || null,
    };
  });
  const res = await window.boothAPI.enqueueDownloads(payload);
  if (res?.queue) renderQueueStatus(res.queue);
  if (res?.error) showTransientMessage(formatEnqueueError(res), 'error');
  if (res?.capped) showTransientMessage(`一括ダウンロードは ${res.batchLimit} 件までです。残り ${res.skippedCount} 件はこのバッチ完了後に再実行してください。`, 'warning');
  return res;
}

async function runLibrarySync(autoDownloadUndownloaded = false) {
  const syncRes = await window.boothAPI.syncLibrary({
    refreshMetaIfNew: true,
    autoDownloadUndownloaded,
  });
  if (syncRes?.error) throw new Error(syncRes.error);

  const map = await window.boothAPI.loadAssets();
  if (map?.error) throw new Error(map.error);
  setAssetsFromMap(map);
  applyCategoryFilter(state.currentCategory || 'all');

  if (autoDownloadUndownloaded) {
    const undownloaded = getUndownloadedAssets();
    await enqueueAssets(undownloaded);
  }
  return syncRes;
}

async function runAvatarCompatibilityAnalysis(options = {}) {
  if (!window.boothAPI?.analyzeAvatarCompatibility) {
    throw new Error('analyze_avatar_compatibility_unavailable');
  }
  const res = await window.boothAPI.analyzeAvatarCompatibility({ scope: 'avatar-analysis', ...options });
  if (res?.error) throw new Error(res.error);
  const next = res?.assets && typeof res.assets === 'object'
    ? res.assets
    : await window.boothAPI.loadAssets();
  if (next?.error) throw new Error(next.error);
  setAssetsFromMap(next, { preserveRuntimeDownloaded: true });
  applyCategoryFilter(state.currentCategory || 'all');
}

/**
 * Initial app bootstrap and first asset load.
 */
async function initializeApp() {
  if (!domRefs.grid) return;

  state.metaProgress.activeScope = '';
  if (domRefs.metaProgressWrapper) domRefs.metaProgressWrapper.classList.add('hidden');
  autoLoadVccProjectsIfNeeded().catch((e) => {
    console.warn('[renderer] autoLoadVccProjectsIfNeeded failed:', e);
  });
  domRefs.grid.innerHTML = `
    <div class="col-span-full text-center text-gray-500 py-10">
      <div id="asset-loading-text">Loading assets...</div>
      <div class="mt-2 text-[10px] text-zinc-600">ライブラリ情報を取得中です</div>
    </div>
  `;

  try {
    const data = await window.boothAPI.loadAssets();
    if (data.error) throw new Error(data.error);
    setAssetsFromMap(data);
    applyCategoryFilter(state.currentCategory || 'all');
    scheduleStorageUsageRefresh(100);
  } catch (err) {
    if (domRefs.grid) {
      domRefs.grid.innerHTML = `<div class="col-span-full text-red-500">エラー: ${esc(err?.message || String(err))}</div>`;
    }
  }
}

/**
 * Render the asset grid/list. Uses DocumentFragment to reduce reflow.
 */
function renderGrid() {
  if (!domRefs.grid) return;
  state.tileMap.clear();
  domRefs.grid.className = state.viewMode === 'list'
    ? 'space-y-1'
    : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-5';

  let filtered = state.currentCategory === 'all' || state.currentCategory === '__ALL__'
    ? [...state.allAssets]
    : state.allAssets.filter(a => {
        if (state.currentCategory === GIFT_CATEGORY_KEY) {
          return Boolean(a?.isGift);
        }
        if (state.currentCategory === FREE_DOWNLOAD_CATEGORY_KEY) {
          return Boolean(a?.isFreeDownload);
        }
        if (a.primaryCategory) {
          const c = a.primaryCategory;
          if (c.slug === state.currentCategory || c.text === state.currentCategory) return true;
        }
        const cats = a.categories || [];
        return cats.some(c => (c.slug === state.currentCategory) || (c.text === state.currentCategory));
      });

  if (state.viewFilter === 'updated') {
    filtered = filtered.filter((a) => Boolean(a.hasUpdate));
  }

  // Update sidebar badge for "Updated" items
  const updateCount = Number(state.updateAssetCount || 0);
  if (domRefs.updateBadge) {
    domRefs.updateBadge.textContent = updateCount;
    domRefs.updateBadge.classList.toggle('hidden', updateCount <= 0);
  }

  const activeAvatarFilters = state.avatarFilters?.length ? state.avatarFilters : (state.avatarFilter ? [state.avatarFilter] : []);
  if (activeAvatarFilters.length) {
    filtered = filtered.filter((a) => matchesAvatarFilter(a, activeAvatarFilters));
  }
  if (state.searchQuery) {
    filtered = filtered.filter((a) => matchesSearch(a, state.searchQuery));
  }

  // Sort order: date/name/size (size uses metadata sizeBytes if present, else file count fallback).
  if (state.sortMode === 'name_asc') {
    filtered.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ja'));
  } else if (state.sortMode === 'size_desc') {
    filtered.sort((a, b) => {
      const sizeA = Number(a?.sizeBytes || 0) || Number(Array.isArray(a?.files) ? a.files.length : 0);
      const sizeB = Number(b?.sizeBytes || 0) || Number(Array.isArray(b?.files) ? b.files.length : 0);
      return sizeB - sizeA;
    });
  } else {
    filtered.sort(compareAssetsByAddedDateDesc);
  }

  state.filteredAssets = filtered;

  const renderMode = getRenderModeSetting();
  const renderToken = ++state.renderJobToken;
  domRefs.grid.innerHTML = '';
  if (state.viewMode === 'list') {
    domRefs.grid.appendChild(createAssetListHeaderRow());
  }
  const appendAppendTile = () => {
    if (state.viewMode === 'list') return;
    const appendTile = document.createElement('div');
    appendTile.className = 'asset-tile p-4 border-dashed border-gray-800 bg-transparent flex items-center justify-center cursor-pointer hover:border-gray-600 transition-colors group';
    appendTile.dataset.appendTile = '1';
    appendTile.innerHTML = `
      <div class="text-center">
        <div class="text-xl font-light text-gray-800 group-hover:text-gray-500">+</div>
        <div class="text-[9px] font-bold text-gray-800 group-hover:text-gray-500 mt-2">
          無料アセット追加
        </div>
      </div>
    `;
    domRefs.grid.appendChild(appendTile);
  };
  const appendRange = (start, end) => {
    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i += 1) {
      const asset = filtered[i];
      if (!asset) continue;
      if (state.viewMode === 'list') fragment.appendChild(createAssetListRow(asset));
      else fragment.appendChild(createAssetTile(asset));
    }
    domRefs.grid.appendChild(fragment);
  };
  if (renderMode === 'instant') {
    appendRange(0, filtered.length);
    appendAppendTile();
  } else {
    let cursor = 0;
    const drawNextChunk = () => {
      if (renderToken !== state.renderJobToken) return;
      const next = Math.min(cursor + RENDER_PROGRESSIVE_CHUNK_SIZE, filtered.length);
      appendRange(cursor, next);
      cursor = next;
      if (cursor < filtered.length) {
        setTimeout(drawNextChunk, 0);
      } else {
        appendAppendTile();
      }
    };
    drawNextChunk();
  }
  if (domRefs.viewGridBtn && domRefs.viewListBtn) {
    if (state.viewMode === 'list') {
      domRefs.viewListBtn.classList.remove('text-zinc-600');
      domRefs.viewListBtn.classList.add('text-blue-500');
      domRefs.viewGridBtn.classList.remove('text-blue-500');
      domRefs.viewGridBtn.classList.add('text-zinc-600');
    } else {
      domRefs.viewGridBtn.classList.remove('text-zinc-600');
      domRefs.viewGridBtn.classList.add('text-blue-500');
      domRefs.viewListBtn.classList.remove('text-blue-500');
      domRefs.viewListBtn.classList.add('text-zinc-600');
    }
  }
}

/**
 * Start downloading an asset.
 */
async function handleDownload(asset, tileEl) {
  const ui = state.tileMap.get(asset.itemId);
  if (!ui) return;

  ui.dlBtn.disabled = true;
  ui.dlBtn.classList.add('opacity-60');
  ui.progressWrapper.classList.remove('opacity-0');
  ui.progressWrapper.classList.add('opacity-100');
  ui.progressBar.style.width = '0%';

  try {
    const res = await enqueueAssets([asset]);
    if (res.error) throw new Error(formatEnqueueError(res));
    // Progress and completion UI are updated by the download progress IPC listener.
  } catch (err) {
    console.error(err);
    if (ui.statusEl) {
      ui.statusEl.textContent = 'error';
      ui.statusEl.title = String(err);
      ui.statusEl.classList.add('text-red-400');
    }
    ui.dlBtn.disabled = false;
    ui.dlBtn.classList.remove('opacity-60');
    ui.progressWrapper.classList.remove('opacity-100');
    ui.progressWrapper.classList.add('opacity-0');
  }
}

// Force-redownloads the new version for an item flagged hasUpdate. Unlike
// handleDownload(), this must set forceRedownload so the queue actually fetches
// the updated files instead of treating the item as already-downloaded and
// silently no-op'ing (see DevNote-2026-07-03-update-notification-resurface-fix).
async function handleUpdateDownload(asset, tileEl) {
  const ui = state.tileMap.get(asset.itemId);
  if (!ui) return;

  if (ui.updateBtn) {
    ui.updateBtn.disabled = true;
    ui.updateBtn.classList.add('opacity-60');
  }
  ui.progressWrapper.classList.remove('opacity-0');
  ui.progressWrapper.classList.add('opacity-100');
  ui.progressBar.style.width = '0%';

  try {
    const res = await enqueueAssets([asset], { forceRedownload: true });
    if (res.error) throw new Error(formatEnqueueError(res));
    // Progress and completion UI are updated by the download progress IPC listener.
  } catch (err) {
    console.error(err);
    if (ui.statusEl) {
      ui.statusEl.textContent = 'error';
      ui.statusEl.title = String(err);
      ui.statusEl.classList.add('text-red-400');
    }
    if (ui.updateBtn) {
      ui.updateBtn.disabled = false;
      ui.updateBtn.classList.remove('opacity-60');
    }
    ui.progressWrapper.classList.remove('opacity-100');
    ui.progressWrapper.classList.add('opacity-0');
  }
}

/**
 * Build category filter options from the current asset list.
 */
function buildCategoryOptions(assets) {
  const select = domRefs.categoryFilterSelect || domRefs.categoryFilter;
  const list = domRefs.categoryList;
  if (!select && !list) return;

  const allCats = new Map();
  const ensureCategory = (c) => {
    if (!c) return null;
    const key = c.slug || c.text || c.href;
    if (!key) return null;
    if (!allCats.has(key)) {
      allCats.set(key, {
        slug: c.slug || key,
        text: getCategoryDisplayText(c, decodeCategorySlugLabel(c.slug || key) || key),
        count: 0,
      });
    }
    return key;
  };
  assets.forEach(a => {
    // Count each asset at most once per category (avoid primary/categories double count).
    const seenKeys = new Set();
    const primaryKey = ensureCategory(a.primaryCategory);
    if (primaryKey) seenKeys.add(primaryKey);
    (a.categories || []).forEach((c) => {
      const key = ensureCategory(c);
      if (key) seenKeys.add(key);
    });
    seenKeys.forEach((k) => {
      const row = allCats.get(k);
      if (row) row.count += 1;
    });
  });
  const giftCount = assets.filter((a) => Boolean(a?.isGift)).length;
  const freeDownloadCount = assets.filter((a) => Boolean(a?.isFreeDownload)).length;

  if (select) select.innerHTML = '';
  
  // "All" option
  if (select) {
    const optAll = document.createElement('option');
    optAll.value = domRefs.categoryFilterSelect ? '__ALL__' : 'all';
    optAll.textContent = domRefs.categoryFilterSelect ? '全カテゴリ' : `すべて (${assets.length})`;
    select.appendChild(optAll);
  }

  // Category options
  const isGeneric3DModelCategory = (c) => {
    const t = String(c?.text || '').trim().toLowerCase();
    const s = String(c?.slug || '').trim().toLowerCase();
    return (
      t === '3dモデル' ||
      t === '3d model' ||
      s === '3d-model' ||
      s === '3dmodel' ||
      s === '3d_models' ||
      s === '3d-models'
    );
  };

  const sortedCats = Array.from(allCats.values())
    .filter((c) => !isGeneric3DModelCategory(c))
    .sort((a, b) => (a.text || '').localeCompare(b.text || '', 'ja'))
  sortedCats.forEach(c => {
      if (select) {
      const opt = document.createElement('option');
      opt.value = c.slug || c.text;
      opt.textContent = domRefs.categoryFilterSelect 
        ? (c.text || c.slug)
        : `${c.text || c.slug} (${c.count})`;
      select.appendChild(opt);
      }
    });

  if (list) {
    list.innerHTML = '';
    const mkBtn = (value, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-item w-full text-left';
      btn.dataset.cat = value;
      btn.textContent = label;
      btn.addEventListener('click', () => applyCategoryFilter(value));
      return btn;
    };
    list.appendChild(mkBtn('__ALL__', `すべてのアイテム (${assets.length})`));
    sortedCats.forEach((c) => {
      const value = c.slug || c.text;
      const label = `${c.text || c.slug} (${c.count})`;
      list.appendChild(mkBtn(value, label));
    });
    if (giftCount > 0) {
      list.appendChild(mkBtn(GIFT_CATEGORY_KEY, `${GIFT_CATEGORY_LABEL} (${giftCount})`));
    }
    if (freeDownloadCount > 0) {
      list.appendChild(mkBtn(FREE_DOWNLOAD_CATEGORY_KEY, `${FREE_DOWNLOAD_CATEGORY_LABEL} (${freeDownloadCount})`));
    }
  }

  if (giftCount > 0 && select) {
    const optGift = document.createElement('option');
    optGift.value = GIFT_CATEGORY_KEY;
    optGift.textContent = domRefs.categoryFilterSelect
      ? GIFT_CATEGORY_LABEL
      : `${GIFT_CATEGORY_LABEL} (${giftCount})`;
    select.appendChild(optGift);
  }
  if (freeDownloadCount > 0 && select) {
    const optFree = document.createElement('option');
    optFree.value = FREE_DOWNLOAD_CATEGORY_KEY;
    optFree.textContent = domRefs.categoryFilterSelect
      ? FREE_DOWNLOAD_CATEGORY_LABEL
      : `${FREE_DOWNLOAD_CATEGORY_LABEL} (${freeDownloadCount})`;
    select.appendChild(optFree);
  }

}

/**
 * Apply the selected category filter and rerender.
 */
function applyCategoryFilter(slug) {
  state.currentCategory = slug || 'all';
  if (domRefs.categoryFilterSelect) {
    domRefs.categoryFilterSelect.value = state.currentCategory;
  }
  if (domRefs.categoryList) {
    domRefs.categoryList.querySelectorAll('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.cat === state.currentCategory);
    });
  }
  renderGrid();
}

function applyViewFilter(view) {
  state.viewFilter = view || 'all';
  renderGrid();
}

function updateBatchUI() {
  if (domRefs.selectedCount) domRefs.selectedCount.textContent = `${state.selectedItems.size}`;
  if (domRefs.btnBatchImport) domRefs.btnBatchImport.disabled = state.selectedItems.size === 0;
  syncImportModeUI();
}

function syncImportModeUI() {
  const active = Boolean(state.selectionMode);
  if (domRefs.btnToggleSelect) {
    domRefs.btnToggleSelect.classList.add('whitespace-nowrap', 'shrink-0');
    domRefs.btnToggleSelect.textContent = active ? '一括インポート終了' : '一括インポート';
    domRefs.btnToggleSelect.classList.remove('btn-primary');
    if (active) {
      domRefs.btnToggleSelect.classList.add('bg-amber-600', 'hover:bg-amber-500', 'text-white');
    } else {
      domRefs.btnToggleSelect.classList.remove('bg-amber-600', 'hover:bg-amber-500', 'text-white');
      domRefs.btnToggleSelect.classList.add('btn-primary');
    }
  }
  if (domRefs.importModeIndicator) {
    const text = active
      ? `インポートモード: ${state.selectedItems.size}件選択中`
      : '通常モード';
    const dotClass = active ? 'bg-amber-400' : 'bg-zinc-500';
    const textClass = active ? 'text-amber-300' : 'text-zinc-400';
    domRefs.importModeIndicator.className = 'text-[10px] font-mono-custom inline-flex items-center gap-1.5 select-none pointer-events-none whitespace-nowrap shrink-0';
    domRefs.importModeIndicator.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${dotClass}"></span><span class="${textClass}">${esc(text)}</span>`;
  }
}

function clearSelectionMode() {
  state.selectionMode = false;
  state.selectedItems.clear();
  if (domRefs.batchControls) domRefs.batchControls.classList.add('hidden');
  if (domRefs.selectionBar) {
    domRefs.selectionBar.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
  }
  updateBatchUI();
}

function toggleSelection(itemId, checkboxEl) {
  const id = String(itemId);
  const asset = getAssetByItemId(id);
  if (!asset?.downloaded) {
    const now = Date.now();
    if ((now - Number(state.lastUndownloadedSelectWarnAt || 0)) > 1200) {
      state.lastUndownloadedSelectWarnAt = now;
      showTransientMessage('この項目は未ダウンロードです。先にダウンロードしてから選択してください。', 'error');
    }
    return false;
  }
  const mark = checkboxEl?.querySelector('.check-mark');
  if (state.selectedItems.has(id)) {
    state.selectedItems.delete(id);
    mark?.classList.add('hidden');
    checkboxEl?.classList.remove('border-blue-500', 'bg-blue-900/30');
  } else {
    state.selectedItems.add(id);
    mark?.classList.remove('hidden');
    checkboxEl?.classList.add('border-blue-500', 'bg-blue-900/30');
  }
  updateBatchUI();
  return true;
}

// ========== Preview Modal Logic ==========

/**
 * Open the preview modal via the renderer module.
 */
async function openPreviewModal(...args) { return callRendererModule('previewModal', 'openPreviewModal', args); }

function closePreviewModal(...args) { return callRendererModule('previewModal', 'closePreviewModal', args); }

function goPreviewBack(...args) { return callRendererModule('previewModal', 'goBack', args); }

/**
 * Reset preview inspector content to its empty state.
 */
function resetPreviewInspector() {
  if (domRefs.modalPreviewBox) {
    domRefs.modalPreviewBox.innerHTML = `
      <div class="text-gray-700">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"
             viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
          <path d="M4.268 21a2 2 0 0 0 1.727 1H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3"/>
          <circle cx="5" cy="14" r="3"/>
          <path d="m9 18-1.5-1.5"/>
        </svg>
      </div>
    `;
  }
  if (domRefs.modalPreviewFilename) domRefs.modalPreviewFilename.textContent = 'ファイルを選択';
  if (domRefs.modalPreviewInfo) domRefs.modalPreviewInfo.textContent = '---';
  if (domRefs.modalOpenEntryBtn) {
    domRefs.modalOpenEntryBtn.disabled = true;
    domRefs.modalOpenEntryBtn.onclick = null;
  }
  if (domRefs.importStatusBox) {
    domRefs.importStatusBox.classList.add('hidden');
    domRefs.importStatusBox.textContent = '';
  }
  setImportAcknowledgeMode(false);
  setImportActionButtonsBusy(false);
  setImportCloseDisabled(false);
  resetImportProgress();
  if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.disabled = true;
  if (domRefs.assetImportHistory) {
    domRefs.assetImportHistory.textContent = 'Unityインポート履歴はありません。';
  }
}

const IMAGE_FILE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.heic', '.heif', '.ico',
]);

function getFileExt(fileName) {
  const n = String(fileName || '').trim().toLowerCase();
  const idx = n.lastIndexOf('.');
  if (idx < 0) return '';
  return n.slice(idx);
}

function isImageFileName(fileName) {
  return IMAGE_FILE_EXTS.has(getFileExt(fileName));
}

function shouldAutoOpenFolderForImageOnly(files) {
  const rows = (files || []).filter((f) => f && f.kind === 'file' && getFileExt(f.name) !== '.zip');
  if (!rows.length) return false;
  return rows.every((f) => isImageFileName(f.name));
}

function showTransientMessage(message, tone = 'info', durationMs = 4500) {
  const text = String(message || '').trim();
  if (!text) return;
  let el = state.transientMessage.el;
  if (!el || !el.isConnected) {
    el = document.createElement('div');
    state.transientMessage.el = el;
    document.body.appendChild(el);
  }
  const toneClass = tone === 'error' ? 'border-red-500/60 text-red-200' : 'border-emerald-500/60 text-emerald-200';
  el.className = `fixed bottom-5 right-5 z-[100] border bg-black/90 px-3 py-2 text-[10px] font-mono-custom rounded ${toneClass}`;
  el.textContent = text;
  const now = Date.now();
  const suppressToCenter = isSuppressedNotificationMessage(text);
  const recentSame = (state.notifications || []).find((n) => (
    n?.type === 'transient'
    && String(n?.message || '') === text
    && (now - new Date(String(n?.createdAt || 0)).getTime()) <= 5000
  ));
  const importantForCenter = isImportantTransientNotification(text, tone);
  if (!suppressToCenter && importantForCenter && !recentSame) {
    upsertNotificationItem({
      id: `transient-${now}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'transient',
      title: tone === 'error' ? 'エラー' : (tone === 'warn' ? '警告' : '通知'),
      message: text,
      payload: { tone: String(tone || 'info') },
      unread: true,
    });
  }
  if (state.transientMessage.timerId) {
    clearTimeout(state.transientMessage.timerId);
    state.transientMessage.timerId = null;
  }
  const wait = Number.isFinite(Number(durationMs)) ? Math.max(1200, Number(durationMs)) : 4500;
  state.transientMessage.timerId = setTimeout(() => {
    if (state.transientMessage.el?.isConnected) state.transientMessage.el.remove();
    state.transientMessage.el = null;
    state.transientMessage.timerId = null;
  }, wait);
}

function setAppUpdateStatusUI(message, tone = 'info') {
  if (!domRefs.settingAppUpdateStatus) return;
  domRefs.settingAppUpdateStatus.textContent = String(message || '');
  if (tone === 'error') {
    domRefs.settingAppUpdateStatus.className = 'text-[10px] text-red-400 min-h-[18px]';
  } else if (tone === 'warn') {
    domRefs.settingAppUpdateStatus.className = 'text-[10px] text-amber-300 min-h-[18px]';
  } else if (tone === 'success') {
    domRefs.settingAppUpdateStatus.className = 'text-[10px] text-emerald-400 min-h-[18px]';
  } else {
    domRefs.settingAppUpdateStatus.className = 'text-[10px] text-zinc-500 min-h-[18px]';
  }
}

function setAppUpdateProgressUI(percent, visible = true, textOverride = '') {
  const wrap = domRefs.settingAppUpdateProgressWrap;
  const bar = domRefs.settingAppUpdateProgressBar;
  const text = domRefs.settingAppUpdateProgressText;
  const fWrap = domRefs.appUpdateProgressFloat;
  const fBar = domRefs.appUpdateProgressFloatBar;
  const fText = domRefs.appUpdateProgressFloatText;
  const p = Math.max(0, Math.min(100, Number(percent || 0)));
  const label = String(textOverride || '').trim() || `${Math.round(p)}%`;
  if (wrap && bar && text) {
    wrap.classList.toggle('hidden', !visible);
    bar.style.width = `${p}%`;
    text.textContent = label;
  }
  if (fWrap && fBar && fText) {
    fWrap.classList.toggle('hidden', !visible);
    fBar.style.width = `${p}%`;
    fText.textContent = label;
  }
}

function readAppUpdateRemindState() {
  try {
    const raw = localStorage.getItem(APP_UPDATE_REMIND_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      version: String(parsed.version || ''),
      remindAt: Number(parsed.remindAt || 0),
    };
  } catch {
    return null;
  }
}

function writeAppUpdateRemindState(version, remindAt) {
  try {
    localStorage.setItem(APP_UPDATE_REMIND_KEY, JSON.stringify({
      version: String(version || ''),
      remindAt: Number(remindAt || 0),
    }));
  } catch {
    // ignore
  }
}

function isAppUpdateReminderActive(version) {
  const state = readAppUpdateRemindState();
  if (!state) return false;
  if (String(state.version || '') !== String(version || '')) return false;
  return Number(state.remindAt || 0) > Date.now();
}

function normalizeAppUpdateNoteLines(releaseNotes) {
  const raw = String(releaseNotes || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .trim();
  if (!raw) return [];
  const lines = raw.split('\n').map((v) => String(v || '').trim()).filter(Boolean);
  const chunks = lines.flatMap((line) => line.split('。').map((v, i, arr) => {
    const t = String(v || '').trim();
    if (!t) return '';
    return i < arr.length - 1 ? `${t}。` : t;
  }));
  return chunks
    .map((v) => String(v || '').trim())
    .map((v) => v.replace(/^[-*•・●◦]+\s*/, ''))
    .map((v) => v.replace(/^\d+[.)]\s*/, ''))
    .map((v) => v.trim())
    .filter(Boolean);
}

function showAppUpdateDownloadedModal(message, version = '', releaseNotes = '') {
  const existing = document.getElementById('app-update-done-overlay');
  if (existing) existing.remove();
  const noteLines = normalizeAppUpdateNoteLines(releaseNotes);
  const normalizedVersion = String(version || '').trim();
  const primaryMessage = String(message || '').trim() || '更新のダウンロードが完了しました。再起動で適用されます。';
  const notesHtml = noteLines.length
    ? `<div class="mb-4">
      <div class="text-[11px] text-zinc-400 mb-1">更新内容</div>
      <div class="max-h-44 overflow-auto rounded border border-white/10 bg-black/30 px-2 py-2">
        <ul class="space-y-1 text-[11px] text-zinc-200 break-words">
          ${noteLines.map((line) => `<li>${esc(line)}</li>`).join('')}
        </ul>
      </div>
    </div>`
    : `<div class="mb-4">
      <div class="text-[11px] text-zinc-400 mb-1">更新内容</div>
      <div class="rounded border border-white/10 bg-black/30 px-2 py-2 text-[11px] text-zinc-500">-</div>
    </div>`;
  const overlay = document.createElement('div');
  overlay.id = 'app-update-done-overlay';
  overlay.className = 'fixed inset-0 z-[115] bg-black/80 flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="w-full max-w-md bg-[#0a0a0a] border border-[#222] rounded p-5">
      <h2 class="text-sm font-bold text-emerald-300 mb-2">アップデート準備完了</h2>
      <div class="mb-4 space-y-3">
        <div>
          <div class="text-[11px] text-zinc-400 mb-1">完了メッセージ</div>
          <div class="rounded border border-white/10 bg-black/30 px-2 py-2 text-[11px] text-zinc-200">${esc(primaryMessage)}</div>
        </div>
        <div>
          <div class="text-[11px] text-zinc-400 mb-1">version</div>
          <div class="rounded border border-white/10 bg-black/30 px-2 py-2 text-[11px] text-zinc-200 font-mono-custom">${esc(normalizedVersion || '-')}</div>
        </div>
      </div>
      ${notesHtml}
      <div class="flex justify-end gap-2">
        <button id="app-update-remind-later" class="btn-action whitespace-nowrap">12時間後に通知</button>
        <button id="app-update-install-now" class="btn-action btn-primary whitespace-nowrap">更新する</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#app-update-remind-later')?.addEventListener('click', () => {
    const remindAt = Date.now() + (12 * 60 * 60 * 1000);
    writeAppUpdateRemindState(version, remindAt);
    setAppUpdateStatusUI('更新通知を12時間後に延期しました。', 'info');
    close();
  });
  overlay.querySelector('#app-update-install-now')?.addEventListener('click', async () => {
    if (!window.boothAPI?.installAppUpdateNow) {
      setAppUpdateStatusUI('更新適用APIが利用できません。', 'error');
      return;
    }
    setAppUpdateStatusUI('更新を適用しています。アプリを再起動します...', 'info');
    try {
      await window.boothAPI.installAppUpdateNow();
    } catch (e) {
      setAppUpdateStatusUI(`更新適用に失敗: ${e?.message || e}`, 'error');
    }
    close();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

function renderOperationLogs(...args) { return callRendererModule('settingsTools', 'renderOperationLogs', args); }

function pushOperationLog(entry) {
  if (!entry || typeof entry !== 'object') return;
  state.operationLogs.push(entry);
  if (state.operationLogs.length > 400) state.operationLogs = state.operationLogs.slice(-400);
  renderOperationLogs();
}

async function refreshOperationLogsFromMain(...args) { return callRendererModule('settingsTools', 'refreshOperationLogsFromMain', args); }

async function refreshSettingsProfilesList(...args) { return callRendererModule('settingsTools', 'refreshSettingsProfilesList', args); }

function showConfirmModal(...args) { return callRendererModule('overlays', 'showConfirmModal', args); }

function showDownloadScopeModal(...args) { return callRendererModule('overlays', 'showDownloadScopeModal', args); }

function showUpdateActionModal(...args) { return callRendererModule('overlays', 'showUpdateActionModal', args); }

function showAvatarFilterAnalysisPromptModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[123] bg-black/70 flex items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="w-full max-w-md bg-[#0b0c10] border border-white/10 rounded-xl p-4 shadow-2xl">
        <div class="text-sm font-bold text-zinc-100 mb-2">対応衣装の詳細解析が必要です</div>
        <div class="text-[11px] text-zinc-300 leading-relaxed">
          この機能を使う場合、すべてのアイテムを解析してください。
        </div>
        <div data-role="progress-wrap" class="hidden mt-3">
          <div class="h-1.5 w-full bg-black rounded-full overflow-hidden border border-white/10">
            <div data-role="progress-bar" class="h-full bg-cyan-400 transition-all duration-300" style="width:0%"></div>
          </div>
          <div data-role="progress-text" class="text-[10px] text-cyan-300 mt-1">解析を準備中...</div>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button data-role="cancel" class="btn-action whitespace-nowrap">キャンセル</button>
          <button data-role="analyze" class="btn-action btn-primary whitespace-nowrap">解析を実行</button>
          <button data-role="ok" class="btn-action btn-primary whitespace-nowrap hidden">OK</button>
        </div>
      </div>
    `;

    let running = false;
    let completed = false;
    let fakeTimer = null;
    const cancelBtn = overlay.querySelector('[data-role="cancel"]');
    const analyzeBtn = overlay.querySelector('[data-role="analyze"]');
    const okBtn = overlay.querySelector('[data-role="ok"]');
    const progressWrap = overlay.querySelector('[data-role="progress-wrap"]');
    const progressBar = overlay.querySelector('[data-role="progress-bar"]');
    const progressText = overlay.querySelector('[data-role="progress-text"]');

    const close = (goAnalyze) => {
      if (running) return;
      if (fakeTimer) {
        clearInterval(fakeTimer);
        fakeTimer = null;
      }
      overlay.remove();
      document.removeEventListener('keydown', onKeyDown);
      resolve(Boolean(goAnalyze));
    };

    const onKeyDown = (e) => {
      if (running) return;
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') {
        e.preventDefault();
        if (completed) {
          okBtn?.click();
          return;
        }
        analyzeBtn?.click();
      }
    };

    overlay.addEventListener('click', (e) => {
      if (running) return;
      if (e.target === overlay) close(false);
    });
    cancelBtn?.addEventListener('click', () => close(false));
    okBtn?.addEventListener('click', () => close(true));
    analyzeBtn?.addEventListener('click', async () => {
      if (running) return;
      running = true;
      if (cancelBtn) cancelBtn.disabled = true;
      if (analyzeBtn) analyzeBtn.disabled = true;
      if (progressWrap) progressWrap.classList.remove('hidden');
      if (progressText) progressText.textContent = '解析を実行中...';
      let p = 5;
      if (progressBar) progressBar.style.width = `${p}%`;
      fakeTimer = setInterval(() => {
        p = Math.min(92, p + (p < 40 ? 8 : (p < 70 ? 4 : 2)));
        if (progressBar) progressBar.style.width = `${p}%`;
      }, 220);

      try {
        const analyzed = await refreshAvatarAnalysisUI();
        if (fakeTimer) {
          clearInterval(fakeTimer);
          fakeTimer = null;
        }
        if (progressBar) progressBar.style.width = analyzed ? '100%' : `${Math.max(8, p)}%`;
        if (progressText) progressText.textContent = analyzed ? '解析が完了しました。' : '解析に失敗しました。';
        running = false;
        if (analyzed) {
          completed = true;
          if (analyzeBtn) analyzeBtn.classList.add('hidden');
          if (cancelBtn) cancelBtn.classList.add('hidden');
          if (okBtn) okBtn.classList.remove('hidden');
          return;
        }
        close(false);
      } catch {
        if (fakeTimer) {
          clearInterval(fakeTimer);
          fakeTimer = null;
        }
        if (progressText) progressText.textContent = '解析に失敗しました。';
        running = false;
        close(false);
      }
    });
    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(overlay);
  });
}

function getAssetAvatarAnalysisSummary(asset) {
  const analysis = asset?.supportedAvatarAnalysis && typeof asset.supportedAvatarAnalysis === 'object'
    ? asset.supportedAvatarAnalysis
    : null;
  if (!analysis) return null;
  const status = String(analysis.status || '').trim().toLowerCase();
  const primary = String(analysis.primaryAvatar || '').trim();
  const candidates = Array.isArray(analysis.candidates)
    ? analysis.candidates.filter((row) => String(row?.name || '').trim())
    : [];
  if (status === 'confirmed' && primary) {
    return {
      status,
      label: primary,
      tone: 'emerald',
      title: `対応アバター: ${primary}`,
    };
  }
  if (status === 'review' && candidates.length) {
    const label = candidates.length === 1
      ? String(candidates[0]?.name || '').trim()
      : `候補 ${candidates.length}`;
    return {
      status,
      label,
      tone: 'amber',
      title: candidates.map((row) => String(row?.name || '').trim()).filter(Boolean).join(', '),
    };
  }
  if (status === 'unclassified') {
    return {
      status,
      label: '未判定',
      tone: 'zinc',
      title: '対応アバターを特定できませんでした',
    };
  }
  return null;
}

function hasAvatarDetailedAnalysisResult() {
  const rows = Array.isArray(state.allAssets) ? state.allAssets : [];
  return rows.some((a) => Array.isArray(a?.supportedAvatarsInferred) && a.supportedAvatarsInferred.length > 0);
}

async function requireSafeModeConfirm(message) {
  if (!state.settings?.safeMode) return true;
  return await showConfirmModal({
    title: 'Safe Mode 確認',
    message: String(message || 'この操作を実行しますか？'),
    confirmText: '実行する',
    cancelText: 'キャンセル',
    danger: true,
  });
}

function setupDebugConsoleBridge() {
  let allowDebug = Boolean(state.settings?.debugLogEnabled);
  try {
    const q = new URLSearchParams(window.location.search || '');
    allowDebug = allowDebug || q.get('debug') === '1' || localStorage.getItem('avatool_debug_console') === '1';
  } catch {
    allowDebug = Boolean(state.settings?.debugLogEnabled);
  }
  if (!allowDebug) {
    try {
      if (window.__boothDebug) {
        delete window.__boothDebug;
        delete window.__boothDebugVersion;
      }
    } catch {
      // ignore cleanup failures
    }
    return;
  }

  const sanitizeAvatarAnalysisAsset = (asset) => {
    const analysis = asset?.supportedAvatarAnalysis && typeof asset.supportedAvatarAnalysis === 'object'
      ? asset.supportedAvatarAnalysis
      : null;
    const candidates = Array.isArray(analysis?.candidates)
      ? analysis.candidates.map((row) => ({
        name: String(row?.name || ''),
        score: Number(row?.score || 0),
        reasons: Array.isArray(row?.reasons) ? row.reasons.map((r) => String(r || '')).filter(Boolean) : [],
      }))
      : [];
    return {
      itemId: String(asset?.itemId || ''),
      title: String(asset?.title || ''),
      isAvatarItem: Boolean(asset?.isAvatarItem),
      downloaded: Boolean(asset?.downloaded),
      primaryCategory: getCategoryDisplayText(asset?.primaryCategory, ''),
      supportedAvatars: Array.isArray(asset?.supportedAvatars) ? asset.supportedAvatars.filter(Boolean) : [],
      supportedAvatarsInferred: Array.isArray(asset?.supportedAvatarsInferred) ? asset.supportedAvatarsInferred.filter(Boolean) : [],
      avatarAnalysisCheckedAt: asset?.avatarAnalysisCheckedAt || null,
      analysis: analysis ? {
        status: String(analysis.status || ''),
        primaryAvatar: String(analysis.primaryAvatar || ''),
        candidateCount: candidates.length,
        candidates,
      } : null,
    };
  };

  const api = window.boothAPI || {};
  const debugApi = {
    help() {
      return [
        '__boothDebug.help()',
        '__boothDebug.state()',
        '__boothDebug.avatarAnalysis(itemId?)',
        '__boothDebug.avatarLogs(limit?)',
        '__boothDebug.scanPackage(pkgPath, candidateTokens?)',
        '__boothDebug.getImportHistory(itemId)',
        '__boothDebug.getProjectItems(projectPath)',
        '__boothDebug.importWithMeta(projectPath, packages)',
        '__boothDebug.importPaths(projectPath, packagePaths)',
        '__boothDebug.openAsset(itemId)',
      ];
    },
    state() {
      return {
        assets: state.allAssets.length,
        selectedItems: Array.from(state.selectedItems),
        currentCategory: state.currentCategory,
        viewFilter: state.viewFilter,
        queue: state.queue,
        modal: {
          selectedAssetId: state.modal?.selectedAsset?.itemId || null,
          currentPath: state.modal?.currentPath || '',
        },
      };
    },
    avatarAnalysis(itemId = '') {
      const key = String(itemId || '').trim();
      if (key) {
        const asset = getAssetByItemId(key);
        if (!asset) throw new Error('asset_not_found');
        return sanitizeAvatarAnalysisAsset(asset);
      }
      return (Array.isArray(state.allAssets) ? state.allAssets : [])
        .filter((asset) => (
          asset?.supportedAvatarAnalysis
          || (Array.isArray(asset?.supportedAvatarsInferred) && asset.supportedAvatarsInferred.length)
          || String(asset?.avatarAnalysisCheckedAt || '').trim()
        ))
        .map(sanitizeAvatarAnalysisAsset);
    },
    async avatarLogs(limit = 80) {
      if (!api.getRuntimeLogs) throw new Error('getRuntimeLogs API unavailable');
      const res = await api.getRuntimeLogs();
      if (!res?.ok) throw new Error(res?.error || 'get_runtime_logs_failed');
      const rows = Array.isArray(res.logs) ? res.logs : [];
      const filtered = rows.filter((row) => {
        const msg = String(row?.message || '');
        return msg.includes('[AVATAR-DEBUG]') || msg.includes('avatar-analysis') || msg.includes('avatar-score-breakdown');
      });
      return filtered.slice(-Math.max(1, Math.min(500, Number(limit) || 80)));
    },
    async scanPackage(pkgPath, candidateTokens = []) {
      if (!api.scanUnityPackage) throw new Error('scanUnityPackage API unavailable');
      return await api.scanUnityPackage(pkgPath, candidateTokens);
    },
    async getImportHistory(itemId) {
      if (!api.getImportHistory) throw new Error('getImportHistory API unavailable');
      return await api.getImportHistory(itemId);
    },
    async getProjectItems(projectPath) {
      if (!api.getProjectItems) throw new Error('getProjectItems API unavailable');
      return await api.getProjectItems(projectPath);
    },
    async reconcileImports(projectPath, packages, persistMatched = true, threshold = 0.6) {
      if (!api.reconcileImports) throw new Error('reconcileImports API unavailable');
      return await api.reconcileImports(projectPath, packages, persistMatched, threshold);
    },
    async importWithMeta(projectPath, packages) {
      if (!api.importMultipleToUnityWithMeta) throw new Error('importMultipleToUnityWithMeta API unavailable');
      return await api.importMultipleToUnityWithMeta(projectPath, packages);
    },
    async importPaths(projectPath, packagePaths) {
      if (!api.importMultipleToUnity) throw new Error('importMultipleToUnity API unavailable');
      return await api.importMultipleToUnity(projectPath, packagePaths);
    },
    async openAsset(itemId) {
      const found = getAssetByItemId(itemId);
      if (!found) throw new Error('asset_not_found');
      await openPreviewModal(found);
      return { ok: true, itemId: found.itemId, title: found.title };
    },
  };

  window.__boothDebug = debugApi;
  window.__boothDebugVersion = '1.1.0';
  console.info('[booth-debug] ready:', debugApi.help());
}

window.setupDebugConsoleBridge = setupDebugConsoleBridge;

async function markAssetUpdateSeen(asset) {
  if (!asset?.hasUpdate || !window.boothAPI?.markUpdateSeen) return;
  const key = String(asset.itemId || '');
  const expectedStableHash = state.expectedUpdateHashByItemId.get(key) || null;
  const res = await window.boothAPI.markUpdateSeen(asset.itemId, asset.files || [], expectedStableHash);
  if (!res?.error) {
    asset.hasUpdate = false;
    state.assetsRevision = Number(state.assetsRevision || 0) + 1;
    state.expectedUpdateHashByItemId.delete(key);
  } else {
    console.warn('markUpdateSeen failed:', res.error);
  }
}

async function autoLoadVccProjectsIfNeeded() {
  try {
    if (!window.boothAPI?.getSettings || !window.boothAPI?.loadVCCProjects || !window.boothAPI?.updateSettings) {
      return;
    }

    const current = await window.boothAPI.getSettings();
    state.settings = current || {};

    const hasProjects = Array.isArray(current?.unityProjects) && current.unityProjects.length > 0;
    const hasUnityPath = typeof current?.unityEditorPath === 'string' && current.unityEditorPath.trim().length > 0;
    if (hasProjects && hasUnityPath) return;

    const vcc = await window.boothAPI.loadVCCProjects();
    if (!vcc || vcc.error || !Array.isArray(vcc.projects) || vcc.projects.length === 0) {
      console.warn('[renderer] auto VCC load skipped:', vcc?.error || 'no projects');
      return;
    }

    const next = {
      ...current,
      unityProjects: vcc.projects,
      unityEditorPath: vcc.editorPath || current?.unityEditorPath || '',
    };
    const res = await window.boothAPI.updateSettings(next);
    if (res && !res.error) {
      state.settings = res.settings || next;
      console.log('[renderer] Unity projects auto-loaded from VCC');
    } else {
      console.warn('[renderer] failed to save auto-loaded VCC projects:', res?.error);
    }
  } catch (e) {
    console.warn('[renderer] autoLoadVccProjectsIfNeeded failed:', e);
  }
}

async function checkForUpdates(...args) { return callRendererModule('appState', 'checkForUpdates', args); }

function showUpdateNotification(...args) { return callRendererModule('overlays', 'showUpdateNotification', args); }

function showVersionHistory(...args) { return callRendererModule('overlays', 'showVersionHistory', args); }

async function openSettingsModal(...args) { return callRendererModule('settingsTools', 'openSettingsModal', args); }

async function openAutoBootstrapModal(...args) { return callRendererModule('autoBootstrap', 'openAutoBootstrapModal', args); }

function syncAutoBootstrapScriptDependencyUi(...args) { return callRendererModule('autoBootstrap', 'syncAutoBootstrapScriptDependencyUi', args); }

function createProjectImportRuleRow(...args) { return callRendererModule('autoBootstrap', 'createProjectImportRuleRow', args); }

function renderProjectImportRulesEditor(...args) { return callRendererModule('autoBootstrap', 'renderProjectImportRulesEditor', args); }

function collectProjectImportRulesFromEditor(...args) { return callRendererModule('autoBootstrap', 'collectProjectImportRulesFromEditor', args); }

function closeAutoBootstrapModal(...args) { return callRendererModule('autoBootstrap', 'closeAutoBootstrapModal', args); }

function renderUnityProjectsList(...args) { return callRendererModule('settingsTools', 'renderUnityProjectsList', args); }

function renderProjectItemsProjectSelect(...args) { return callRendererModule('projectItems', 'renderProjectItemsProjectSelect', args); }

async function loadProjectItemsPanel(...args) { return callRendererModule('projectItems', 'loadProjectItemsPanel', args); }

function setProjectItemsProgress(...args) { return callRendererModule('projectItems', 'setProjectItemsProgress', args); }

async function collectReconcilePackagesFromAssets(onProgress) {
  const targets = (state.allAssets || []).filter((a) => a.downloaded);
  const rows = [];
  for (let i = 0; i < targets.length; i++) {
    const asset = targets[i];
    const res = await window.boothAPI.listItemFiles(asset.itemId, asset.title || '');
    if (!res?.error && Array.isArray(res?.files)) {
      const tokens = buildCandidateTokens(asset);
      const found = res.files
        .filter((f) => f.kind === 'file' && String(f.name || '').toLowerCase().endsWith('.unitypackage'))
        .map((f) => ({
          itemId: String(asset.itemId || ''),
          title: String(asset.title || ''),
          packagePath: String(f.fullPath || ''),
          candidateTokens: tokens,
        }));
      rows.push(...found);
    }
    if (typeof onProgress === 'function') {
      onProgress(i + 1, targets.length);
    }
  }
  return rows.filter((r) => r.itemId && r.packagePath);
}

async function runProjectItemsReconcile(...args) { return callRendererModule('projectItems', 'runProjectItemsReconcile', args); }

async function openProjectItemsModal(...args) { return callRendererModule('projectItems', 'openProjectItemsModal', args); }

function closeProjectItemsModal(...args) { return callRendererModule('projectItems', 'closeProjectItemsModal', args); }

function pathBasename(p) {
  const norm = String(p || '').replace(/\\/g, '/');
  if (!norm) return '';
  const parts = norm.split('/');
  return parts[parts.length - 1] || '';
}

async function loadVCCProjectsIntoSettings(...args) { return callRendererModule('settingsTools', 'loadVCCProjectsIntoSettings', args); }

async function saveSettingsFromModal(...args) { return callRendererModule('settingsTools', 'saveSettingsFromModal', args); }

async function loadCookieFileFromModal(...args) { return callRendererModule('settingsTools', 'loadCookieFileFromModal', args); }

async function saveAutoBootstrapFromModal(...args) { return callRendererModule('autoBootstrap', 'saveAutoBootstrapFromModal', args); }

async function openLoginWindowFromModal(...args) { return callRendererModule('settingsTools', 'openLoginWindowFromModal', args); }

async function logoutSessionFromModal(...args) { return callRendererModule('settingsTools', 'logoutSessionFromModal', args); }

async function openImportModal(...args) { return callRendererModule('importModal', 'openImportModal', args); }

function closeImportModal(...args) { return callRendererModule('importModal', 'closeImportModal', args); }

async function openPackageSelectionModal(...args) { return callRendererModule('importModal', 'openPackageSelectionModal', args); }

function closePackageSelectionModal(...args) { return callRendererModule('importModal', 'closePackageSelectionModal', args); }

function getPackageSelectImportMode(...args) { return callRendererModule('importModal', 'getPackageSelectImportMode', args); }

function updatePkgSelectConfirmLabel(...args) { return callRendererModule('importModal', 'updatePkgSelectConfirmLabel', args); }

function openManualAddModal(...args) { return callRendererModule('libraryActions', 'openManualAddModal', args); }

function closeManualAddModal(...args) { return callRendererModule('libraryActions', 'closeManualAddModal', args); }

function resetManualAddPreview(...args) { return callRendererModule('libraryActions', 'resetManualAddPreview', args); }

async function previewManualAdd(...args) { return callRendererModule('libraryActions', 'previewManualAdd', args); }

function scheduleManualAddPreview(...args) { return callRendererModule('libraryActions', 'scheduleManualAddPreview', args); }

async function submitManualAdd(...args) { return callRendererModule('libraryActions', 'submitManualAdd', args); }

function openWishlistAddModal(...args) { return callRendererModule('libraryActions', 'openWishlistAddModal', args); }

function closeWishlistAddModal(...args) { return callRendererModule('libraryActions', 'closeWishlistAddModal', args); }

function resetWishlistPreview(...args) { return callRendererModule('libraryActions', 'resetWishlistPreview', args); }

function renderImportProjectList(...args) { return callRendererModule('importModal', 'renderImportProjectList', args); }

async function updateProjectImportPreset(...args) { return callRendererModule('importModal', 'updateProjectImportPreset', args); }

function renderProjectImportPresetEditor(...args) { return callRendererModule('importModal', 'renderProjectImportPresetEditor', args); }

async function executeImportDryRun(...args) { return callRendererModule('importModal', 'executeImportDryRun', args); }

function getUnityImportErrorMessage(...args) { return callRendererModule('importModal', 'getUnityImportErrorMessage', args); }

async function executeBackgroundImport(...args) { return callRendererModule('importModal', 'executeBackgroundImport', args); }

// ========== Meta Progress Handlers ==========

/**
 * Meta progress handlers for the current renderer UI.
 */

/**
 * Refresh the newer meta progress UI.
 */
async function refreshMetaNewUI() {
  const btn = domRefs.syncLibraryBtn;
  const svg = btn?.querySelector('svg');
  let ok = false;
  if (btn) {
    btn.disabled = true;
    if (svg) svg.classList.add('animate-spin', 'text-blue-400');
  }

  try {
    beginMetaProgressScope('sync-library', 'メタデータ同期を開始中...');
    if (domRefs.grid) {
      domRefs.grid.innerHTML = `
        <div class="col-span-full text-[10px] text-gray-500 font-mono-custom">
          Updating meta...
        </div>
      `;
    }
    const syncRes = await runLibrarySync(false);
    scheduleStorageUsageRefresh(300);
    if (domRefs.grid) domRefs.grid.innerHTML = '';
    if (domRefs.lastUpdatedSpan) {
      const now = new Date();
      domRefs.lastUpdatedSpan.textContent = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    const ms = Number(syncRes?.summary?.elapsedMs || 0);
    const sec = ms > 0 ? (ms / 1000).toFixed(1) : '0.0';
    const newItems = Number(syncRes?.summary?.newItemCount || 0);
    const totalItems = Number(syncRes?.summary?.totalItemCount ?? state.allAssets?.length ?? 0);
    state.libraryEmptyReason = String(syncRes?.summary?.emptyReason || '');
    state.boothLoggedIn = syncRes?.summary?.boothLoggedIn ?? null;
    const catBackfilled = Number(syncRes?.summary?.categoryBackfillCount || 0);
    const fallbackThumb = Number(syncRes?.summary?.fallbackPreviewCount || 0);
    const fallbackIcon = Number(syncRes?.summary?.fallbackAuthorIconCount || 0);
    if (totalItems <= 0) {
      const emptyMessage = state.libraryEmptyReason === 'not_logged_in'
        ? 'BOOTHにログインしていません'
        : state.libraryEmptyReason === 'no_purchases'
          ? '購入アイテムはありません'
          : '購入アイテムを確認できません';
      showTransientMessage(
        `同期完了 ${sec}s / ${emptyMessage}`,
        'info',
        6500,
      );
    } else {
      showTransientMessage(
        `同期完了 ${sec}s / 合計 ${totalItems} 件 / 新規 ${newItems} 件 / カテゴリ補完 ${catBackfilled} 件 / 画像フォールバック ${fallbackThumb} 件 / アイコンフォールバック ${fallbackIcon} 件`,
        'info',
        6500,
      );
    }
    ok = true;
  } catch (e) {
    console.error(e);
    if (domRefs.grid) {
      domRefs.grid.innerHTML = `
        <div class="col-span-full text-[10px] text-red-500 font-mono-custom">
          ${esc(e?.message || String(e))}
        </div>
      `;
    }
    showTransientMessage(`同期に失敗しました: ${e?.message || e}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      if (svg) svg.classList.remove('animate-spin', 'text-blue-400');
    }
    endMetaProgressScope('sync-library');
  }
  return ok;
}

async function refreshAvatarAnalysisUI(options = {}) {
  const btn = domRefs.analyzeAvatarCompatBtn;
  const svg = btn?.querySelector('svg');
  let ok = false;
  if (btn) {
    btn.disabled = true;
    if (svg) svg.classList.add('animate-spin', 'text-cyan-300');
  }

  try {
    beginMetaProgressScope('avatar-analysis', '対応衣装の詳細解析を開始中...');
    await runAvatarCompatibilityAnalysis(options);
    scheduleStorageUsageRefresh(300);
    showTransientMessage('対応衣装の詳細解析が完了しました。', 'info');
    ok = true;
  } catch (e) {
    console.error(e);
    showTransientMessage(`詳細解析に失敗しました: ${e?.message || e}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      if (svg) svg.classList.remove('animate-spin', 'text-cyan-300');
    }
    endMetaProgressScope('avatar-analysis');
  }
  updateAnalyzeAvatarCompatBtn();
  return ok;
}

// ========== Download Progress Handler ==========

function renderQueueStatus(...args) { return callRendererModule('queueUi', 'renderQueueStatus', args); }

function isQueueLikelyActiveNow(...args) { return callRendererModule('queueUi', 'isQueueLikelyActiveNow', args); }

function refreshVisibleTileActionStates(...args) { return callRendererModule('assetList', 'refreshVisibleTileActionStates', args); }


// Queue progress/status event binding is delegated to renderer/render_queue_ui.js.


// ========== Event Listeners Setup ==========

function clickIfEnabled(el) {
  if (!el || el.disabled) return false;
  el.click();
  return true;
}

function focusSearchInput(selectAll = true) {
  if (!domRefs.searchInput) return false;
  domRefs.searchInput.focus();
  if (selectAll && typeof domRefs.searchInput.select === 'function') {
    domRefs.searchInput.select();
  }
  return true;
}

function isConfirmModalOpen() {
  const btn = document.querySelector('[data-role="confirm"]');
  return Boolean(btn && btn.closest('.fixed'));
}

function closeTopOverlayOrMode() {
  const shortcutsGuideClose = document.querySelector('#shortcuts-guide-close');
  if (shortcutsGuideClose) {
    shortcutsGuideClose.click();
    return true;
  }
  const confirmCancel = document.querySelector('[data-role="cancel"]');
  if (confirmCancel && confirmCancel.closest('.fixed')) {
    confirmCancel.click();
    return true;
  }
  const notifyClose = document.querySelector('#notify-center-close');
  if (notifyClose) {
    notifyClose.click();
    return true;
  }
  const updatesClose = document.querySelector('#updates-close');
  if (updatesClose) {
    updatesClose.click();
    return true;
  }
  const historyClose = document.querySelector('#history-close');
  if (historyClose) {
    historyClose.click();
    return true;
  }
  if (isElementShown(domRefs.manualAddModal)) {
    closeManualAddModal();
    return true;
  }
  if (isElementShown(domRefs.wishlistAddModal)) {
    closeWishlistAddModal();
    return true;
  }
  if (isElementShown(domRefs.pkgSelectModal)) {
    closePackageSelectionModal();
    return true;
  }
  if (isElementShown(domRefs.importModal)) {
    return closeImportModal();
  }
  if (isElementShown(domRefs.previewOverlay)) {
    closePreviewModal();
    return true;
  }
  if (isElementShown(domRefs.projectItemsModal)) {
    closeProjectItemsModal();
    return true;
  }
  if (isElementShown(domRefs.autoBootstrapModal)) {
    closeAutoBootstrapModal();
    return true;
  }
  if (isElementShown(domRefs.settingsModal)) {
    stopShortcutCapture();
    domRefs.settingsModal.classList.add('hidden');
    domRefs.settingsModal.classList.remove('flex');
    return true;
  }
  if (state.avatarFilterPanelOpen) {
    setAvatarFilterPanelOpen(false);
    return true;
  }
  if (state.selectionMode) {
    clearSelectionMode();
    renderGrid();
    return true;
  }
  return false;
}

function setAvatarFilterPanelOpen(open) {
  const panel = document.getElementById('avatar-filter-panel');
  const button = document.getElementById('avatar-filter-button');
  const chevron = document.getElementById('avatar-filter-chevron');
  const next = Boolean(open);
  state.avatarFilterPanelOpen = next;
  if (panel) panel.classList.toggle('hidden', !next);
  if (button) button.setAttribute('aria-expanded', next ? 'true' : 'false');
  if (chevron) chevron.classList.toggle('rotate-180', next);
}

function getAvatarDisplayName(name) {
  const raw = String(name || '').trim();
  return String(state.avatarLabelMap?.get(raw) || raw).trim() || raw;
}

function syncAvatarFilterUI() {
  const label = document.getElementById('avatar-filter-label');
  const img = document.getElementById('avatar-filter-img');
  const panel = document.getElementById('avatar-filter-panel');
  const button = document.getElementById('avatar-filter-button');
  const filters = Array.isArray(state.avatarFilters) && state.avatarFilters.length ? state.avatarFilters : (state.avatarFilter ? [state.avatarFilter] : []);
  const val = state.avatarFilter || '';
  const filterLabel = filters.length > 1
    ? filters.map((name) => getAvatarDisplayName(name)).join('・')
    : (filters[0] ? getAvatarDisplayName(filters[0]) : 'アバターで絞り込み');
  if (label) label.textContent = filterLabel;
  if (img) {
    const imgSrc = filters.length ? (state.avatarImageMap?.get(filters[0]) || '') : '';
    if (imgSrc) {
      img.onerror = () => { img.classList.add('hidden'); };
      img.src = imgSrc;
      img.classList.remove('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
    }
  }
  if (panel) {
    panel.querySelectorAll('[data-value]').forEach((opt) => {
      const isSelected = opt.dataset.value === '' ? !filters.length : filters.includes(opt.dataset.value);
      if (opt.classList.contains('avatar-grid-item')) {
        opt.classList.toggle('bg-white/8', isSelected);
        const thumb = opt.querySelector('.avatar-grid-thumb');
        if (thumb) thumb.classList.toggle('ring-2', isSelected);
        if (thumb) thumb.classList.toggle('ring-blue-500', isSelected);
        if (thumb) thumb.classList.toggle('border-blue-500/50', isSelected);
        const check = opt.querySelector('.avatar-grid-check');
        if (check) check.classList.toggle('opacity-0', !isSelected);
        if (check) check.classList.toggle('opacity-100', isSelected);
        const itemLabel = opt.querySelector('.avatar-grid-label');
        if (itemLabel) itemLabel.classList.toggle('text-zinc-200', isSelected);
        if (itemLabel) itemLabel.classList.toggle('text-zinc-400', !isSelected);
      } else {
        opt.classList.toggle('bg-white/10', isSelected);
        opt.classList.toggle('text-zinc-200', isSelected);
      }
    });
  }
  if (button) {
    button.classList.toggle('border-blue-500/50', Boolean(filters.length));
  }
}

function logShortcutDebug(message, payload = null) {
  if (!isAvatarDebugEnabled()) return;
  if (window.logger?.log) window.logger.log(message, payload);
  else console.log(message, payload);
}

function ensureAvatarFilterSelect() {
  if (domRefs.avatarFilterSelect && document.body.contains(domRefs.avatarFilterSelect)) {
    return domRefs.avatarFilterSelect;
  }
  if (!domRefs.searchInput) return null;

  const searchWrap = domRefs.searchInput.parentElement;
  if (searchWrap) {
    searchWrap.classList.add('flex', 'items-center', 'gap-2', 'w-full', 'max-w-[860px]');
    if (searchWrap.classList.contains('max-w-md')) searchWrap.classList.remove('max-w-md');
    domRefs.searchInput.classList.remove('w-full');
    domRefs.searchInput.classList.add('min-w-0', 'flex-1');
  }

  const wrap = document.createElement('div');
  wrap.id = 'avatar-filter-wrap';
  wrap.className = 'relative min-w-[190px] max-w-[320px] shrink-0';

  const select = document.createElement('select');
  select.id = 'avatar-filter-select';
  select.className = 'hidden';
  select.setAttribute('aria-hidden', 'true');
  select.setAttribute('tabindex', '-1');
  select.innerHTML = '<option value="">アバター絞り込み</option>';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'avatar-filter-button';
  button.className = 'h-10 w-full bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-[12px] text-zinc-200 outline-none transition-all flex items-center gap-2';
  button.setAttribute('title', '対応アバターで絞り込み');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `
    <img id="avatar-filter-img" class="hidden w-6 h-6 rounded-md object-cover shrink-0 border border-white/10" alt="">
    <span id="avatar-filter-label" class="flex-1 min-w-0 text-left truncate">アバター絞り込み</span>
    <svg id="avatar-filter-chevron" class="w-4 h-4 text-zinc-400 transition-transform" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M5 7.5L10 12.5L15 7.5" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;

  const panel = document.createElement('div');
  panel.id = 'avatar-filter-panel';
  panel.className = 'hidden absolute right-0 top-[calc(100%+8px)] z-[120] overflow-auto rounded-xl border border-white/10 bg-[#0b0c10] p-1.5 shadow-2xl';
  panel.style.cssText = 'width:400px;max-height:480px;';

  const anchor = domRefs.searchInput;
  const parent = anchor.parentElement;
  if (parent && parent.appendChild) {
    wrap.appendChild(select);
    wrap.appendChild(button);
    wrap.appendChild(panel);
    parent.appendChild(wrap);
  } else {
    wrap.appendChild(select);
    wrap.appendChild(button);
    wrap.appendChild(panel);
    anchor.insertAdjacentElement('afterend', wrap);
  }

  if (!avatarFilterGlobalDismissBound) {
    document.addEventListener('click', (e) => {
      const currentWrap = document.getElementById('avatar-filter-wrap');
      if (!currentWrap) return;
      const target = e.target;
      const inside = target instanceof Node && currentWrap.contains(target);
      if (!inside) setAvatarFilterPanelOpen(false);
    });
    avatarFilterGlobalDismissBound = true;
  }

  domRefs.avatarFilterSelect = select;
  domRefs.avatarFilterToggle = button;
  domRefs.avatarFilterPanel = panel;
  bindAvatarFilterFallbackEvents();
  syncAvatarFilterUI();
  return select;
}

function refreshAvatarFilterOptions(assets = []) {
  const select = ensureAvatarFilterSelect();
  if (!select) return;

  // Build a normalization map: for avatar items whose pool is Latin-only, map the
  // Latin name → Japanese nameVariant so both sides collapse to one filter entry.
  const avatarLatinToJaMap = new Map();
  for (const asset of (Array.isArray(assets) ? assets : [])) {
    if (!asset?.isAvatarItem) continue;
    const nv = asset.nameVariants || {};
    const jaName = String(
      (Array.isArray(nv.katakana) && nv.katakana[0]) ||
      (Array.isArray(nv.hiragana) && nv.hiragana[0]) || ''
    ).trim();
    if (!jaName) continue;
    for (const poolName of getAssetAvatarPool(asset)) {
      if (/^[a-z0-9\-\s_.,'!?/]+$/i.test(poolName) && poolName !== jaName) {
        avatarLatinToJaMap.set(poolName, jaName);
      }
    }
  }

  const allNames = [];
  for (const asset of (Array.isArray(assets) ? assets : [])) {
    for (const n of getAssetAvatarPool(asset)) {
      allNames.push(avatarLatinToJaMap.get(n) || n);
    }
  }
  const normalizedNames = Array.from(new Set(
    allNames.map((n) => String(n || '').trim()).filter(Boolean)
  ));
  const groupedNames = [];
  const keyToGroupIndex = new Map();
  for (const name of normalizedNames) {
    const keys = avatarComparableKeys(name);
    if (!keys.length) {
      groupedNames.push({ names: [name], keys: new Set() });
      continue;
    }
    const groupIndexes = Array.from(new Set(
      keys.map((key) => keyToGroupIndex.get(key)).filter((index) => Number.isInteger(index))
    ));
    if (!groupIndexes.length) {
      const nextIndex = groupedNames.length;
      groupedNames.push({ names: [name], keys: new Set(keys) });
      keys.forEach((key) => keyToGroupIndex.set(key, nextIndex));
      continue;
    }
    const targetIndex = groupIndexes[0];
    const target = groupedNames[targetIndex];
    if (!target.names.includes(name)) target.names.push(name);
    keys.forEach((key) => target.keys.add(key));
    for (let i = groupIndexes.length - 1; i >= 1; i -= 1) {
      const sourceIndex = groupIndexes[i];
      const source = groupedNames[sourceIndex];
      if (!source) continue;
      for (const sourceName of source.names) {
        if (!target.names.includes(sourceName)) target.names.push(sourceName);
      }
      for (const sourceKey of source.keys) target.keys.add(sourceKey);
      groupedNames.splice(sourceIndex, 1);
      for (const [key, index] of keyToGroupIndex.entries()) {
        if (index === sourceIndex) keyToGroupIndex.set(key, targetIndex);
        else if (index > sourceIndex) keyToGroupIndex.set(key, index - 1);
      }
    }
    target.keys.forEach((key) => keyToGroupIndex.set(key, targetIndex));
  }
  const rankAvatarFilterName = (name) => {
    const hasJapanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(name);
    const hasLatin = /[A-Za-z]/.test(name);
    if (hasJapanese && !hasLatin) return 0;
    if (hasJapanese) return 1;
    return 2;
  };
  const unique = groupedNames
    .map((group) => group.names.slice().sort((a, b) => {
      const rankDiff = rankAvatarFilterName(a) - rankAvatarFilterName(b);
      if (rankDiff !== 0) return rankDiff;
      const lengthDiff = a.length - b.length;
      if (lengthDiff !== 0) return lengthDiff;
      return a.localeCompare(b, 'ja');
    })[0])
    .sort((a, b) => a.localeCompare(b, 'ja'));
  const assetsCount = Array.isArray(assets) ? assets.length : 0;
  const withAvatar = (Array.isArray(assets) ? assets : []).filter((a) => getAssetAvatarPool(a).length > 0).length;
  const sig = `${assetsCount}:${withAvatar}:${unique.length}`;
  if (sig !== avatarDebugLastSignature) {
    avatarDebugLastSignature = sig;
    logAvatarDebug('refreshAvatarFilterOptions', {
      assetsCount,
      assetsWithAvatar: withAvatar,
      uniqueAvatarCount: unique.length,
      sample: unique.slice(0, 10),
    });
  }

  const prev = normalizeAvatarFilterValue(state.avatarFilter);
  const analyzed = hasAvatarDetailedAnalysisResult();
  state.avatarImageMap = buildAvatarImageMap(assets);
  const frag = document.createDocumentFragment();
  const optAll = document.createElement('option');
  optAll.value = '';
  state.avatarFilterAllLabel = unique.length > 0
    ? '絞り込みを解除'
    : (analyzed ? 'アバター未検出' : 'アバター絞り込み（要解析）');
  optAll.textContent = state.avatarFilterAllLabel;
  frag.appendChild(optAll);
  if (!unique.length && !analyzed) {
    const optAnalyze = document.createElement('option');
    optAnalyze.value = '__ANALYZE_REQUIRED__';
    optAnalyze.textContent = '解析を実行...';
    frag.appendChild(optAnalyze);
  }
  for (const name of unique) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = getAvatarDisplayName(name);
    frag.appendChild(opt);
  }
  select.innerHTML = '';
  select.appendChild(frag);
  select.disabled = false;

  const panel = document.getElementById('avatar-filter-panel');
  if (panel) {
    const header = [];
    header.push(`
      <button type="button" data-value="" class="w-full px-3 py-2 rounded-lg text-left text-[12px] text-zinc-400 hover:bg-white/15 hover:text-zinc-200 transition-colors flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        <span>${esc(state.avatarFilterAllLabel)}</span>
      </button>
    `);
    if (!unique.length && !analyzed) {
      header.push(`
      <button type="button" data-value="__ANALYZE_REQUIRED__" class="w-full px-3 py-2 rounded-lg text-left text-[12px] text-amber-300 hover:bg-amber-500/10 transition-colors flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>解析を実行...</span>
      </button>
    `);
    }
    const gridItems = unique.map((name) => {
      const image = state.avatarImageMap?.get(name) || '';
      const displayName = getAvatarDisplayName(name);
      return `
        <button type="button" data-value="${esc(name)}" class="avatar-grid-item flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-white/15 transition-colors text-center group">
          <div class="avatar-grid-thumb relative w-full aspect-square rounded-xl overflow-hidden border border-white/10 bg-white/5 shrink-0 transition-all group-hover:border-white/30 group-hover:scale-[1.04]">
            ${image
              ? `<img src="${esc(image)}" class="w-full h-full object-cover" alt="">`
              : `<div class="w-full h-full flex items-center justify-center text-zinc-600"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>`}
            <div class="avatar-grid-check absolute inset-0 bg-blue-500/30 flex items-center justify-center opacity-0 transition-opacity">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          </div>
          <span class="avatar-grid-label text-[11px] text-zinc-400 group-hover:text-zinc-200 truncate w-full leading-tight transition-colors" title="${esc(displayName)}">${esc(displayName)}</span>
        </button>
      `;
    });
    panel.innerHTML = `
      <div class="mb-1">${header.join('')}</div>
      ${unique.length ? `<div class="h-px bg-white/5 mx-1 mb-2"></div><div class="grid grid-cols-3 gap-1">${gridItems.join('')}</div>` : ''}
    `;
    panel.querySelectorAll('[data-value=""], [data-value="__ANALYZE_REQUIRED__"]').forEach((btn) => {
      btn.addEventListener('mouseenter', () => { btn.style.backgroundColor = 'rgba(255,255,255,0.1)'; btn.style.color = '#e4e4e7'; });
      btn.addEventListener('mouseleave', () => { btn.style.backgroundColor = ''; btn.style.color = ''; });
    });
    panel.querySelectorAll('.avatar-grid-item').forEach((btn) => {
      btn.querySelectorAll('img').forEach((img) => {
        img.addEventListener('error', () => { img.style.display = 'none'; });
      });
      const thumb = btn.querySelector('.avatar-grid-thumb');
      const label = btn.querySelector('.avatar-grid-label');
      btn.addEventListener('mouseenter', () => {
        btn.style.backgroundColor = 'rgba(255,255,255,0.12)';
        if (thumb) thumb.style.transform = 'scale(1.05)';
        if (thumb) thumb.style.borderColor = 'rgba(255,255,255,0.3)';
        if (label) label.style.color = '#e4e4e7';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.backgroundColor = '';
        if (thumb) thumb.style.transform = '';
        if (thumb) thumb.style.borderColor = '';
        if (label) label.style.color = '';
      });
    });
  }

  const prevKeys = new Set(avatarComparableKeys(prev));
  const matchedPrev = prev && unique.length > 0
    ? unique.find((name) => avatarComparableKeys(name).some((key) => prevKeys.has(key)))
    : '';
  if (matchedPrev) {
    select.value = matchedPrev;
    state.avatarFilter = matchedPrev;
  } else {
    select.value = '';
    state.avatarFilter = '';
    state.avatarFilters = [];
  }
  syncAvatarFilterUI();
}

function setupKeyboardShortcuts() {
  if (state.keyboardShortcutsBound) return;
  state.keyboardShortcutsBound = true;

  document.addEventListener('keydown', async (e) => {
    if (e.defaultPrevented) return;
    const key = String(e.key || '');

    if (state.shortcutCaptureKey) {
      e.preventDefault();
      e.stopPropagation();
      if (key === 'Escape') {
        stopShortcutCapture();
        showTransientMessage('キー割当をキャンセルしました。', 'info', 1800);
        return;
      }
      const assigned = formatShortcutFromEvent(e);
      if (!assigned) return;
      const reserved = RESERVED_SHORTCUTS.find((r) => canonicalizeShortcutSpec(r.spec) === canonicalizeShortcutSpec(assigned));
      if (reserved) {
        stopShortcutCapture();
        showTransientMessage(`予約キーのため設定できません: ${assigned}`, 'error', 2200);
        refreshShortcutValidationUi();
        return;
      }
      const input = domRefs.settingShortcutsEditor?.querySelector(`input[data-shortcut-key="${state.shortcutCaptureKey}"]`);
      if (input) input.value = assigned;
      stopShortcutCapture();
      refreshShortcutValidationUi();
      showTransientMessage(`ショートカットを設定: ${assigned}`, 'info', 1800);
      return;
    }

    await rendererModules.auxUi?.handleGlobalShortcutEvent?.(e);
  });
}

/**
 * Bind renderer UI and IPC event listeners.
 */
function setupEventListeners() {
  setupKeyboardShortcuts();
  safeBindRendererModule('libraryActions', 'bindUiEvents');
  safeBindRendererModule('previewModal', 'bindUiEvents');
  safeBindRendererModule('auxUi', 'bindUiEvents');
  safeBindRendererModule('auxUi', 'bindIpcEvents');
  safeBindRendererModule('appState', 'bindIpcEvents');
  safeBindRendererModule('settingsTools', 'bindUiEvents');
  safeBindRendererModule('settingsTools', 'bindIpcEvents');
  safeBindRendererModule('autoBootstrap', 'bindUiEvents');
  safeBindRendererModule('autoBootstrap', 'bindIpcEvents');
  safeBindRendererModule('projectItems', 'bindUiEvents');
  safeBindRendererModule('importModal', 'bindUiEvents');
  safeBindRendererModule('importModal', 'bindIpcEvents');
  safeBindRendererModule('assetList', 'bindUiEvents');
  safeBindRendererModule('queueUi', 'bindUiEvents');

}

function wireRendererModules() {
  const overlays = safeCreateRendererModule('overlays', () => createRenderOverlays({
    state,
    esc,
    toItemIdKey,
    getAssetByItemId,
    enqueueAssets,
  }));
  if (overlays) {
    showConfirmModal = overlays.showConfirmModal;
    showDownloadScopeModal = overlays.showDownloadScopeModal;
    showUpdateActionModal = overlays.showUpdateActionModal;
    showUpdateNotification = overlays.showUpdateNotification;
    showVersionHistory = overlays.showVersionHistory;
  }

  const auxUi = safeCreateRendererModule('auxUi', () => createRenderAuxUi({
    state,
    domRefs,
    boothAPI: window.boothAPI,
    esc,
    shortcutFieldDefs: SHORTCUT_FIELD_DEFS,
    defaultShortcuts: DEFAULT_SHORTCUTS,
    reservedShortcuts: RESERVED_SHORTCUTS,
    shortcutsTutorialSeenKey: SHORTCUTS_TUTORIAL_SEEN_KEY,
    getShortcutMap,
    formatShortcutDisplay,
    removeNotificationItem,
    markNotificationAsRead,
    clearAllNotifications,
    sanitizeNotificationCenterState,
    showUpdateNotification,
    setAppUpdateStatusUI,
    setAppUpdateProgressUI,
    showTransientMessage,
    refreshAvatarAnalysisUI,
    refreshMetaNewUI,
    showUpdateActionModal,
    checkForUpdates,
    setUpdateActionUi,
    isElementShown,
    isConfirmModalOpen,
    clickIfEnabled,
    focusSearchInput,
    closeTopOverlayOrMode,
    isTypingTarget,
    eventMatchesShortcut,
    clearSelectionMode,
    renderGrid,
    logShortcutDebug,
    upsertNotificationItem,
    showConfirmModal,
    requireSafeModeConfirm,
    initializeApp,
  }));
  if (auxUi) {
    showShortcutsTutorialOverlay = auxUi.showShortcutsTutorialOverlay;
    showNotificationCenter = auxUi.showNotificationCenter;
    showAvatarFilterAnalysisPromptModal = auxUi.showAvatarFilterAnalysisPromptModal;
  }

  const appStateUi = safeCreateRendererModule('appState', () => createRenderAppState({
    state,
    domRefs,
    boothAPI: window.boothAPI,
    isElementShown,
    showShortcutsTutorialOverlay,
    shortcutsTutorialSeenKey: SHORTCUTS_TUTORIAL_SEEN_KEY,
    showTransientMessage,
    showUpdateNotification,
    setAssetsFromMap,
    applyCategoryFilter,
    setAppUpdateStatusUI,
    setAppUpdateProgressUI,
    isQueueLikelyActiveNow,
    getLastQueueSettledAt,
    refreshVisibleTileActionStates,
    scheduleStorageUsageRefresh,
    showAppUpdateDownloadedModal,
    isAppUpdateReminderActive,
  }));
  if (appStateUi) {
    maybeShowShortcutsTutorialOnStartup = appStateUi.maybeShowShortcutsTutorialOnStartup;
    buildCandidateTokens = appStateUi.buildCandidateTokens;
    getPhaseLocalProgress = appStateUi.getPhaseLocalProgress;
    getGlobalMetaProgress = appStateUi.getGlobalMetaProgress;
    resetMetaProgressState = appStateUi.resetMetaProgressState;
    beginMetaProgressScope = appStateUi.beginMetaProgressScope;
    endMetaProgressScope = appStateUi.endMetaProgressScope;
    setUpdateCheckUi = appStateUi.setUpdateCheckUi;
    setUpdateActionUi = appStateUi.setUpdateActionUi;
    setAutoUpdateNotifyButton = appStateUi.setAutoUpdateNotifyButton;
    upsertPendingAutoUpdates = appStateUi.upsertPendingAutoUpdates;
    sanitizeNotificationCenterState = appStateUi.sanitizeNotificationCenterState;
    upsertNotificationItem = appStateUi.upsertNotificationItem;
    markNotificationAsRead = appStateUi.markNotificationAsRead;
    removeNotificationItem = appStateUi.removeNotificationItem;
    clearAllNotifications = appStateUi.clearAllNotifications;
    checkForUpdates = appStateUi.checkForUpdates;
  }

  const projectItemsUi = safeCreateRendererModule('projectItems', () => createRenderProjectItems({
    state,
    domRefs,
    boothAPI: window.boothAPI,
    esc,
    formatDate,
    pathBasename,
    buildCandidateTokens,
    showTransientMessage,
  }));
  if (projectItemsUi) {
    renderProjectItemsProjectSelect = projectItemsUi.renderProjectItemsProjectSelect;
    loadProjectItemsPanel = projectItemsUi.loadProjectItemsPanel;
    setProjectItemsProgress = projectItemsUi.setProjectItemsProgress;
    runProjectItemsReconcile = projectItemsUi.runProjectItemsReconcile;
    openProjectItemsModal = projectItemsUi.openProjectItemsModal;
    closeProjectItemsModal = projectItemsUi.closeProjectItemsModal;
  }

  const settingsUi = safeCreateRendererModule('settingsTools', () => createRenderSettingsTools({
    state,
    domRefs,
    boothAPI: window.boothAPI,
    esc,
    pathBasename,
    defaultShortcuts: DEFAULT_SHORTCUTS,
    getRenderModeSetting,
    setAppUpdateStatusUI,
    setAppUpdateProgressUI,
    setAutoUpdateNotifyButton,
    renderShortcutEditor,
    getShortcutMap,
    renderProjectItemsProjectSelect,
    loadProjectItemsPanel,
    readShortcutEditorValue,
    validateShortcutMap,
    applyShortcutValidationUi,
    persistRenderModeSetting,
    renderGrid,
    showTransientMessage,
    resetMetaProgressState,
    initializeApp,
    renderImportProjectList,
    pushOperationLog,
    stopShortcutCapture,
    closeTopOverlayOrMode,
  }));
  if (settingsUi) {
    renderOperationLogs = settingsUi.renderOperationLogs;
    refreshOperationLogsFromMain = settingsUi.refreshOperationLogsFromMain;
    refreshSettingsProfilesList = settingsUi.refreshSettingsProfilesList;
    renderUnityProjectsList = settingsUi.renderUnityProjectsList;
    openSettingsModal = settingsUi.openSettingsModal;
    loadVCCProjectsIntoSettings = settingsUi.loadVCCProjectsIntoSettings;
    saveSettingsFromModal = settingsUi.saveSettingsFromModal;
    loadCookieFileFromModal = settingsUi.loadCookieFileFromModal;
    openLoginWindowFromModal = settingsUi.openLoginWindowFromModal;
    logoutSessionFromModal = settingsUi.logoutSessionFromModal;
  }

  const autoBootstrapUi = safeCreateRendererModule('autoBootstrap', () => createRenderAutoBootstrap({
    state,
    domRefs,
    boothAPI: window.boothAPI,
    esc,
    showTransientMessage,
    pathBasename,
    syncDownloadStateFromLatestMapNoRerender,
  }));
  if (autoBootstrapUi) {
    openAutoBootstrapModal = autoBootstrapUi.openAutoBootstrapModal;
    closeAutoBootstrapModal = autoBootstrapUi.closeAutoBootstrapModal;
    syncAutoBootstrapScriptDependencyUi = autoBootstrapUi.syncAutoBootstrapScriptDependencyUi;
    createProjectImportRuleRow = autoBootstrapUi.createProjectImportRuleRow;
    renderProjectImportRulesEditor = autoBootstrapUi.renderProjectImportRulesEditor;
    collectProjectImportRulesFromEditor = autoBootstrapUi.collectProjectImportRulesFromEditor;
    saveAutoBootstrapFromModal = autoBootstrapUi.saveAutoBootstrapFromModal;
  }

  const importModalUi = safeCreateRendererModule('importModal', () => createRenderImportModal({
    state,
    domRefs,
    boothAPI: window.boothAPI,
    esc,
    formatDate,
    pathBasename,
    enableKeyboardActivation,
    showTransientMessage,
    clearSelectionMode,
    renderGrid,
    setImportProgress,
    resetImportProgress,
    setImportPhase,
    setImportAcknowledgeMode,
    setImportActionButtonsBusy,
    setImportCloseDisabled,
  }));
  if (importModalUi) {
    openImportModal = importModalUi.openImportModal;
    closeImportModal = importModalUi.closeImportModal;
    openPackageSelectionModal = importModalUi.openPackageSelectionModal;
    closePackageSelectionModal = importModalUi.closePackageSelectionModal;
    getPackageSelectImportMode = importModalUi.getPackageSelectImportMode;
    updatePkgSelectConfirmLabel = importModalUi.updatePkgSelectConfirmLabel;
    updateProjectImportPreset = importModalUi.updateProjectImportPreset;
    renderProjectImportPresetEditor = importModalUi.renderProjectImportPresetEditor;
    executeImportDryRun = importModalUi.executeImportDryRun;
    executeBackgroundImport = importModalUi.executeBackgroundImport;
    getUnityImportErrorMessage = importModalUi.getUnityImportErrorMessage;
  }

  const previewModalUi = safeCreateRendererModule('previewModal', () => createRenderPreviewModal({
    state,
    domRefs,
    boothAPI: window.boothAPI,
    esc,
    enableKeyboardActivation,
    renderImportHistoryInModal,
    getIconForFile,
    isImageFile,
    openImportModal,
    closeImportModal,
    closePackageSelectionModal,
    markAssetUpdateSeen,
    setAssetsFromMap,
    renderGrid,
    showTransientMessage,
    setImportAcknowledgeMode,
    setImportActionButtonsBusy,
    setImportCloseDisabled,
    resetImportProgress,
    setAvatarFilterPanelOpen,
    reloadAssetsMap,
    updateUserMeta: window.boothAPI?.updateUserMeta
      ? (itemId, patch) => window.boothAPI.updateUserMeta(itemId, patch)
      : null,
    icons: ICONS,
    logger: window.logger,
  }));
  if (previewModalUi) {
    openPreviewModal = previewModalUi.openPreviewModal;
    closePreviewModal = previewModalUi.closePreviewModal;
  }

  const libraryActionsUi = safeCreateRendererModule('libraryActions', () => createRenderLibraryActions({
    state,
    domRefs,
    boothAPI: window.boothAPI,
    showTransientMessage,
    setAssetsFromMap,
    applyCategoryFilter,
    getAssetByItemId,
    reloadAssetsMap,
    enqueueAssets,
    openPackageSelectionModal,
  }));
  if (libraryActionsUi) {
    openManualAddModal = libraryActionsUi.openManualAddModal;
    closeManualAddModal = libraryActionsUi.closeManualAddModal;
    resetManualAddPreview = libraryActionsUi.resetManualAddPreview;
    previewManualAdd = libraryActionsUi.previewManualAdd;
    scheduleManualAddPreview = libraryActionsUi.scheduleManualAddPreview;
    submitManualAdd = libraryActionsUi.submitManualAdd;
    openWishlistAddModal = libraryActionsUi.openWishlistAddModal;
    closeWishlistAddModal = libraryActionsUi.closeWishlistAddModal;
    resetWishlistPreview = libraryActionsUi.resetWishlistPreview;
  }

  const assetListUi = safeCreateRendererModule('assetList', () => createRenderAssetList({
    state,
    domRefs,
    esc,
    formatDate,
    matchesSearch,
    matchesAvatarFilter,
    getRenderModeSetting,
    giftCategoryKey: GIFT_CATEGORY_KEY,
    freeDownloadCategoryKey: FREE_DOWNLOAD_CATEGORY_KEY,
    renderProgressiveChunkSize: RENDER_PROGRESSIVE_CHUNK_SIZE,
    enableKeyboardActivation,
    toggleSelection,
    openPreviewModalAction: openPreviewModal,
    getAssetByItemId,
    shouldTreatAsDownloaded,
    getAssetAvatarAnalysisSummary,
    persistViewModePreference,
    clearSelectionMode,
    updateBatchUI,
    applyCategoryFilter,
    setAvatarFilterPanelOpen,
    syncAvatarFilterUI,
    normalizeAvatarFilterValue,
    hasAvatarDetailedAnalysisResult,
    showAvatarFilterAnalysisPromptModal,
    applyViewFilter,
    openImportForAssetAction: openImportForAsset,
    handleDownloadAction: handleDownload,
    handleUpdateAction: handleUpdateDownload,
    openItemFolderAction: async (itemId, title) => {
      await window.boothAPI.openItemFolder(itemId, title || '');
    },
    openManualAddModalAction: () => { openManualAddModal(); resetManualAddPreview(); },
    syncLibraryAction: () => refreshMetaNewUI(),
    openBoothLoginAction: async () => {
      try {
        const res = await window.boothAPI?.openLoginWindow?.();
        if (res?.error) showTransientMessage(`Login failed: ${res.error}`, 'error');
      } catch (error) {
        showTransientMessage(`Login failed: ${error?.message || error}`, 'error');
      }
    },
  }));
  if (assetListUi) {
    renderGrid = assetListUi.renderGrid;
    getTileEntryByItemId = assetListUi.getTileEntryByItemId;
    refreshVisibleTileActionStates = assetListUi.refreshVisibleTileActionStates;
  }

  const queueUi = safeCreateRendererModule('queueUi', () => createRenderQueueUI({
    state,
    domRefs,
    boothAPI: window.boothAPI,
    getAssetByItemId,
    getTileEntryByItemId,
    refreshVisibleTileActionStates,
    syncDownloadStateFromLatestMapNoRerender,
    markAssetUpdateSeen,
    scheduleStorageUsageRefresh,
    getUndownloadedAssets,
    getDownloadableAssets,
    enqueueAssets,
    showTransientMessage,
    showDownloadScopeModal,
    showConfirmModal,
    downloadProgressFlushMs: DOWNLOAD_PROGRESS_FLUSH_MS,
    queueStatusFlushMs: QUEUE_STATUS_FLUSH_MS,
    logger: window.logger,
  }));
  if (queueUi) {
    renderQueueStatus = queueUi.renderQueueStatus;
    isQueueLikelyActiveNow = queueUi.isQueueLikelyActiveNow;
    getLastQueueSettledAt = queueUi.getLastQueueSettledAt;
    safeBindRendererModule('queueUi', 'bindBoothApiEvents');
  }

  if (createBoothSearchView) {
    try {
      createBoothSearchView({
        boothAPI: window.boothAPI,
        toggleWishlist: async (itemId, itemIdOrUrl) => {
          const res = await window.boothAPI.toggleWishlist(itemId, itemIdOrUrl || `https://booth.pm/ja/items/${itemId}`);
          if (res?.ok) await reloadAssetsMap();
          return res;
        },
        getAssetMap: () => state.assetByItemId || new Map(),
      });
    } catch (e) {
      window.logger?.warn?.('[boothSearch] init failed', e?.message);
    }
  }

  if (createBoothClientView) {
    try {
      const boothClient = createBoothClientView({
        boothAPI: window.boothAPI,
        getAssets: () => Array.isArray(state.allAssets) ? state.allAssets : [],
      });
      state.boothClient = boothClient;
    } catch (e) {
      window.logger?.warn?.('[boothClient] init failed', e?.message);
    }
  }
}

async function handleAnalyzeAvatarCompatButtonClick() {
  const downloadedAssets = (Array.isArray(state.allAssets) ? state.allAssets : [])
    .filter((asset) => asset.downloaded);
  if (downloadedAssets.length === 0) {
    showTransientMessage('ダウンロード済みのアイテムがありません。', 'info');
    return;
  }
  const unanalyzedIds = downloadedAssets
    .filter((asset) => !String(asset?.avatarAnalysisCheckedAt || '').trim())
    .map((asset) => asset.itemId);
  if (unanalyzedIds.length > 0) {
    await refreshAvatarAnalysisUI({ onlyItemIds: unanalyzedIds });
  } else {
    // All items already analyzed — re-analyze everything.
    const allIds = downloadedAssets.map((asset) => asset.itemId);
    await refreshAvatarAnalysisUI({ onlyItemIds: allIds });
  }
}

async function handleAvatarFilterSelectionChange(selectValue, { closePanelOnComplete = true } = {}) {
  const select = domRefs.avatarFilterSelect || document.getElementById('avatar-filter-select');
  if (!select) return;
  const next = normalizeAvatarFilterValue(selectValue || '');
  const prev = normalizeAvatarFilterValue(state.avatarFilter || '');
  const needsAnalyze = next === '__ANALYZE_REQUIRED__' || (next && !hasAvatarDetailedAnalysisResult());
  if (needsAnalyze) {
    if (state.avatarFilterPromptBusy) return;
    state.avatarFilterPromptBusy = true;
    try {
      const analyzed = await showAvatarFilterAnalysisPromptModal();
      if (!analyzed) {
        if (select.value !== prev) select.value = prev;
        syncAvatarFilterUI();
        return;
      }
      select.value = '';
      state.avatarFilter = '';
      state.avatarFilters = [];
      setAvatarFilterPanelOpen(false);
      syncAvatarFilterUI();
      renderGrid();
      return;
    } finally {
      state.avatarFilterPromptBusy = false;
    }
  }
  if (select.value !== next) select.value = next;
  if (prev !== next) {
    state.avatarFilter = next;
    syncAvatarFilterUI();
    renderGrid();
  } else {
    syncAvatarFilterUI();
  }
  if (closePanelOnComplete) setAvatarFilterPanelOpen(false);
}

function bindAnalyzeAvatarCompatButtonFallback() {
  const button = domRefs.analyzeAvatarCompatBtn;
  if (!button || button.dataset.avatoolAnalyzeBound === '1') return;
  button.dataset.avatoolAnalyzeBound = '1';
  button.addEventListener('click', async () => {
    await handleAnalyzeAvatarCompatButtonClick();
  });
}

function bindAvatarFilterFallbackEvents() {
  const avatarSelect = domRefs.avatarFilterSelect || document.getElementById('avatar-filter-select');
  const avatarPanel = domRefs.avatarFilterPanel || document.getElementById('avatar-filter-panel');
  const avatarToggle = domRefs.avatarFilterToggle || document.getElementById('avatar-filter-button');
  if (!avatarSelect || !avatarPanel || !avatarToggle) return;
  if (avatarToggle.dataset.avatoolAvatarFilterBound === '1') return;
  avatarToggle.dataset.avatoolAvatarFilterBound = '1';
  avatarPanel.dataset.avatoolAvatarFilterBound = '1';
  avatarSelect.dataset.avatoolAvatarFilterBound = '1';

  avatarToggle.addEventListener('click', async () => {
    const next = normalizeAvatarFilterValue(avatarSelect.value || '');
    if (next === '__ANALYZE_REQUIRED__' || (next && !hasAvatarDetailedAnalysisResult())) {
      await handleAvatarFilterSelectionChange(next, { closePanelOnComplete: true });
      return;
    }
    setAvatarFilterPanelOpen(!state.avatarFilterPanelOpen);
  });

  avatarPanel.addEventListener('click', async (event) => {
    const button = event.target?.closest?.('[data-value]');
    if (!button) return;
    const next = normalizeAvatarFilterValue(button.dataset.value || '');
    const needsAnalyze = next === '__ANALYZE_REQUIRED__' || (next && !hasAvatarDetailedAnalysisResult());
    if (needsAnalyze) {
      await handleAvatarFilterSelectionChange(next, { closePanelOnComplete: true });
      return;
    }
    if (next === '') {
      state.avatarFilters = [];
      state.avatarFilter = '';
      if (avatarSelect) avatarSelect.value = '';
      setAvatarFilterPanelOpen(false);
    } else {
      const cur = Array.isArray(state.avatarFilters) ? state.avatarFilters : [];
      const idx = cur.indexOf(next);
      state.avatarFilters = idx >= 0 ? cur.filter((f) => f !== next) : [...cur, next];
      state.avatarFilter = state.avatarFilters[0] || '';
      if (avatarSelect) avatarSelect.value = state.avatarFilter;
    }
    syncAvatarFilterUI();
    renderGrid();
  });

  avatarSelect.addEventListener('change', async (event) => {
    await handleAvatarFilterSelectionChange(event?.target?.value || '', { closePanelOnComplete: true });
  });
}

// ========== Initialization ==========

window.addEventListener('DOMContentLoaded', async () => {
  await safeRunRendererStartupStep('wireRendererModules', async () => {
    wireRendererModules();
  });
  state.viewMode = loadViewModePreference();
  await safeRunRendererStartupStep('setupDebugConsoleBridge', async () => {
    setupDebugConsoleBridge();
  });
  if (domRefs.autoSyncToggle) {
    domRefs.autoSyncToggle.checked = localStorage.getItem('autoSyncOnStartup') === '1';
  }
  await safeRunRendererStartupStep('setAutoUpdateNotifyButton', async () => {
    setAutoUpdateNotifyButton();
  });
  await safeRunRendererStartupStep('renderQueueStatus', async () => {
    renderQueueStatus(state.queue);
  });
  await safeRunRendererStartupStep('updateBatchUI', async () => {
    updateBatchUI();
  });
  await safeRunRendererStartupStep('setupEventListeners', async () => {
    setupEventListeners();
  });
  await safeRunRendererStartupStep('bindAnalyzeAvatarCompatButtonFallback', async () => {
    bindAnalyzeAvatarCompatButtonFallback();
  });
  await safeRunRendererStartupStep('bindAvatarFilterFallbackEvents', async () => {
    bindAvatarFilterFallbackEvents();
  });
  if (window.boothAPI?.getSettings) {
    await safeRunRendererStartupStep('getSettings', async () => {
      state.settings = await window.boothAPI.getSettings();
      setupDebugConsoleBridge();
    });
  }
  await safeRunRendererStartupStep('persistRenderModeSetting', async () => {
    persistRenderModeSetting(getRenderModeSetting());
  });
  safeRunRendererStartupStep('refreshOperationLogsFromMain', async () => {
    await refreshOperationLogsFromMain();
  });
  await safeRunRendererStartupStep('initializeApp', async () => {
    await initializeApp();
  });
  if (domRefs.autoSyncToggle?.checked) {
    await safeRunRendererStartupStep('runLibrarySyncOnStartup', async () => {
      await runLibrarySync(true);
    });
  }
  if (localStorage.getItem('autoCheckUpdates') === '1') {
    setTimeout(() => {
      Promise.resolve(checkForUpdates({ manual: false })).catch((error) => {
        recordRendererModuleFailure('startup', 'autoCheckUpdates', error);
      });
    }, 3000);
  }
  renderRendererDegradedBanner();
  window.boothAPI?.notifyRendererReady?.();
});
