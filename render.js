/**
 * Booth Asset Manager - Optimized Renderer
 * Main renderer entry for UI composition, IPC wiring, and asset interactions.
 */

// preload.js registers the same listeners in its own isolated JS world, but Electron's
// contextIsolation means uncaught errors thrown in this page's world never reach them.
// These must stay the first statements in this file to catch failures as early as possible.
window.addEventListener('error', (event) => {
  try {
    const source = String(event?.filename || '');
    if (!event?.error && source && !source.startsWith('file:')) return;
    // Skip resource load errors (img/video/audio/link elements): these fire 'error'
    // during the capture phase with no Error object and no message.
    if (!event?.error && !event?.message) return;
    window.boothAPI?.reportRendererFatalError?.('error', {
      message: String(event?.message || event?.error?.message || 'Unknown renderer error'),
      filename: source,
      lineno: Number(event?.lineno || 0),
      colno: Number(event?.colno || 0),
      stack: String(event?.error?.stack || ''),
    });
  } catch { /* reporting must never throw */ }
}, true);

window.addEventListener('unhandledrejection', (event) => {
  try {
    const reason = event?.reason;
    window.boothAPI?.reportRendererFatalError?.('unhandledrejection', {
      message: String(reason?.message || reason || 'Unhandled promise rejection'),
      stack: String(reason?.stack || ''),
    });
  } catch { /* reporting must never throw */ }
});

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

const moduleRegistry = window.AvatoolRenderModuleRegistry.createRenderModuleRegistry();
const {
  requireRendererFactory,
  callRendererModule,
  getRendererModuleErrorMessage,
  recordRendererModuleFailure,
  safeCreateRendererModule,
  safeBindRendererModule,
  renderRendererDegradedBanner,
  safeRunRendererStartupStep,
  getRendererModule,
} = moduleRegistry;

const createRenderOverlays = requireRendererFactory('AvatoolRenderOverlays', 'createRenderOverlays');
const createRenderAuxUi = requireRendererFactory('AvatoolRenderAuxUi', 'createRenderAuxUi');
const createRenderAppState = requireRendererFactory('AvatoolRenderAppState', 'createRenderAppState');
const createRenderProjectItems = requireRendererFactory('AvatoolRenderProjectItems', 'createRenderProjectItems');
const createRenderSettingsTools = requireRendererFactory('AvatoolRenderSettingsTools', 'createRenderSettingsTools');
const createRenderAutoBootstrap = requireRendererFactory('AvatoolRenderAutoBootstrap', 'createRenderAutoBootstrap');
const createRenderImportModal = requireRendererFactory('AvatoolRenderImportModal', 'createRenderImportModal');
const createRenderPreviewModal = requireRendererFactory('AvatoolRenderPreviewModal', 'createRenderPreviewModal');
const createRenderModelPreview = requireRendererFactory('AvatoolRenderModelPreview', 'createRenderModelPreview');
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
  settingExperimentalModelPreview: document.getElementById('setting-experimental-model-preview'),
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

const prefsFormatUtils = window.AvatoolRenderPrefsFormatUtils.createRenderPrefsFormatUtils({
  getState: () => state,
  icons: ICONS,
  parseSortableDateMs: (...args) => parseSortableDateMs(...args),
});
const {
  isAvatarDebugEnabled,
  logAvatarDebug,
  logShortcutDebug,
  loadViewModePreference,
  loadSortModePreference,
  persistSortModePreference,
  persistViewModePreference,
  getRenderModeSetting,
  persistRenderModeSetting,
  formatDate,
  esc,
  getIconForFile,
  isImageFile,
  pathBasename,
} = prefsFormatUtils;

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

// ========== Utility Functions ==========

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

const importProgressUi = window.AvatoolRenderImportProgressUi.createRenderImportProgressUi({
  domRefs,
  state,
});
const {
  setImportProgress,
  resetImportProgress,
  setImportAcknowledgeMode,
  setImportActionButtonsBusy,
  setImportCloseDisabled,
  setImportPhase,
} = importProgressUi;

const shortcutEditorUi = window.AvatoolRenderShortcutEditorUi.createRenderShortcutEditorUi({
  state,
  domRefs,
  sanitizeShortcutSpec,
  defaultShortcuts: DEFAULT_SHORTCUTS,
  shortcutFieldDefs: SHORTCUT_FIELD_DEFS,
  reservedShortcuts: RESERVED_SHORTCUTS,
  validateShortcutMapWithDefs,
});
const {
  isKeyboardActivationEvent,
  enableKeyboardActivation,
  isElementShown,
  isTypingTarget,
  getShortcutMap,
  renderShortcutEditor,
  readShortcutEditorValue,
  stopShortcutCapture,
  beginShortcutCapture,
  validateShortcutMap,
  applyShortcutValidationUi,
  refreshShortcutValidationUi,
} = shortcutEditorUi;

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

const storageUsageUi = window.AvatoolRenderStorageUsageUi.createRenderStorageUsageUi({
  domRefs,
  boothAPI: window.boothAPI,
});
const { formatBytes, refreshStorageUsageUI, scheduleStorageUsageRefresh } = storageUsageUi;

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

function isSuppressedNotificationMessage(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  return /起動時の自動ダウンロード[:：]/i.test(text)
    || /起動時の自動ダウンロードを開始しました/i.test(text)
    || /起動時の自動ダウンロードを実行中/i.test(text)
    || /起動時の自動ダウンロードが完了しました/i.test(text)
    || /^ヘルスチェック[：:]/i.test(text)
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

const categoryFilterUi = window.AvatoolRenderCategoryFilterUi.createRenderCategoryFilterUi({
  state,
  domRefs,
  esc,
  getAssetByItemId: (...args) => getAssetByItemId(...args),
  showTransientMessage: (...args) => showTransientMessage(...args),
  renderGrid: (...args) => renderGrid(...args),
  giftCategoryKey: GIFT_CATEGORY_KEY,
  giftCategoryLabel: GIFT_CATEGORY_LABEL,
  freeDownloadCategoryKey: FREE_DOWNLOAD_CATEGORY_KEY,
  freeDownloadCategoryLabel: FREE_DOWNLOAD_CATEGORY_LABEL,
});
const {
  matchesSearch,
  decodeCategorySlugLabel,
  getCategoryDisplayText,
  buildCategoryOptions,
  applyCategoryFilter,
  applyViewFilter,
  updateBatchUI,
  syncImportModeUI,
  clearSelectionMode,
  toggleSelection,
} = categoryFilterUi;

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

function getTileEntryByItemId(itemId) {
  return state.tileMap.get(toItemIdKey(itemId)) || null;
}

const assetStateUi = window.AvatoolRenderAssetState.createRenderAssetState({
  state,
  boothAPI: window.boothAPI,
  compareAssetsByAddedDateDesc,
  getTileEntryByItemId: (...args) => getTileEntryByItemId(...args),
  getAssetAvatarPool,
  logAvatarDebug,
  buildAvatarLabelMap,
  refreshAvatarFilterOptions: (...args) => refreshAvatarFilterOptions(...args),
  buildCategoryOptions,
  applyCategoryFilter,
  renderGrid: (...args) => renderGrid(...args),
  scheduleStorageUsageRefresh,
});
const {
  normalizeAssetsFromMap,
  toItemIdKey,
  getAssetByItemId,
  shouldTreatAsDownloaded,
  countUnanalyzedDownloaded,
  updateAnalyzeAvatarCompatBtn,
  setAssetsFromMap,
  refreshAvatarAliasLabels,
  reloadAssetsMap,
  syncDownloadStateFromLatestMapNoRerender,
  getUndownloadedAssets,
  getDownloadableAssets,
  getAssetAvatarAnalysisSummary,
  hasAvatarDetailedAnalysisResult,
} = assetStateUi;

const downloadActionsUi = window.AvatoolRenderDownloadActions.createRenderDownloadActions({
  state,
  boothAPI: window.boothAPI,
  showTransientMessage: (...args) => showTransientMessage(...args),
  openPackageSelectionModal: (...args) => openPackageSelectionModal(...args),
  formatBytes,
  renderQueueStatus: (...args) => renderQueueStatus(...args),
  setAssetsFromMap,
  applyCategoryFilter,
  getUndownloadedAssets,
});
const {
  openImportForAsset,
  formatEnqueueError,
  enqueueAssets,
  runLibrarySync,
  runAvatarCompatibilityAnalysis,
  handleDownload,
  handleUpdateDownload,
} = downloadActionsUi;

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

// ========== Preview Modal Logic ==========

/**
 * Open the preview modal via the renderer module.
 */
async function openPreviewModal(...args) { return callRendererModule('previewModal', 'openPreviewModal', args); }

function closePreviewModal(...args) { return callRendererModule('previewModal', 'closePreviewModal', args); }

function goPreviewBack(...args) { return callRendererModule('previewModal', 'goBack', args); }

const appUpdateUi = window.AvatoolRenderAppUpdateUi.createRenderAppUpdateUi({
  state,
  domRefs,
  esc,
  isSuppressedNotificationMessage,
  isImportantTransientNotification,
  upsertNotificationItem: (...args) => upsertNotificationItem(...args),
  appUpdateRemindKey: APP_UPDATE_REMIND_KEY,
});
const {
  showTransientMessage,
  setAppUpdateStatusUI,
  setAppUpdateProgressUI,
  readAppUpdateRemindState,
  writeAppUpdateRemindState,
  isAppUpdateReminderActive,
  normalizeAppUpdateNoteLines,
  showAppUpdateDownloadedModal,
} = appUpdateUi;
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

const debugConsoleBridge = window.AvatoolRenderDebugConsoleBridge.createRenderDebugConsoleBridge({
  state,
  getAssetByItemId,
  openPreviewModal: (...args) => openPreviewModal(...args),
  getCategoryDisplayText,
});
const { setupDebugConsoleBridge } = debugConsoleBridge;

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

async function runProjectItemsReconcile(...args) { return callRendererModule('projectItems', 'runProjectItemsReconcile', args); }

async function openProjectItemsModal(...args) { return callRendererModule('projectItems', 'openProjectItemsModal', args); }

function closeProjectItemsModal(...args) { return callRendererModule('projectItems', 'closeProjectItemsModal', args); }

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

const metaAvatarSyncUi = window.AvatoolRenderMetaAvatarSyncUi.createRenderMetaAvatarSyncUi({
  state,
  domRefs,
  esc,
  boothAPI: window.boothAPI,
  runLibrarySync,
  runAvatarCompatibilityAnalysis,
  updateAnalyzeAvatarCompatBtn,
  scheduleStorageUsageRefresh,
  showTransientMessage: (...args) => showTransientMessage(...args),
  beginMetaProgressScope: (...args) => beginMetaProgressScope(...args),
  endMetaProgressScope: (...args) => endMetaProgressScope(...args),
});
const {
  markAssetUpdateSeen,
  autoLoadVccProjectsIfNeeded,
  refreshMetaNewUI,
  refreshAvatarAnalysisUI,
} = metaAvatarSyncUi;
// ========== Download Progress Handler ==========

function renderQueueStatus(...args) { return callRendererModule('queueUi', 'renderQueueStatus', args); }

function isQueueLikelyActiveNow(...args) { return callRendererModule('queueUi', 'isQueueLikelyActiveNow', args); }

function refreshVisibleTileActionStates(...args) { return callRendererModule('assetList', 'refreshVisibleTileActionStates', args); }


// Queue progress/status event binding is delegated to renderer/render_queue_ui.js.


// ========== Event Listeners Setup ==========

const globalUiHelpers = window.AvatoolRenderGlobalUiHelpers.createRenderGlobalUiHelpers({
  state,
  domRefs,
  isElementShown,
  stopShortcutCapture,
  clearSelectionMode,
  closeManualAddModal,
  closeWishlistAddModal,
  closePackageSelectionModal,
  closeImportModal,
  closePreviewModal,
  closeProjectItemsModal,
  closeAutoBootstrapModal,
  setAvatarFilterPanelOpen: (...args) => setAvatarFilterPanelOpen(...args),
  renderGrid: (...args) => renderGrid(...args),
});
const {
  clickIfEnabled,
  focusSearchInput,
  isConfirmModalOpen,
  closeTopOverlayOrMode,
} = globalUiHelpers;

const avatarFilterUi = window.AvatoolRenderAvatarFilterUi.createRenderAvatarFilterUi({
  state,
  domRefs,
  esc,
  logAvatarDebug,
  getAssetAvatarPool,
  avatarComparableKeys,
  normalizeAvatarFilterValue,
  buildAvatarImageMap,
  hasAvatarDetailedAnalysisResult,
  refreshAvatarAnalysisUI,
  showTransientMessage: (...args) => showTransientMessage(...args),
  showAvatarFilterAnalysisPromptModal: (...args) => showAvatarFilterAnalysisPromptModal(...args),
  renderGrid: (...args) => renderGrid(...args),
});
const {
  setAvatarFilterPanelOpen,
  getAvatarDisplayName,
  syncAvatarFilterUI,
  ensureAvatarFilterSelect,
  refreshAvatarFilterOptions,
  handleAnalyzeAvatarCompatButtonClick,
  handleAvatarFilterSelectionChange,
  bindAnalyzeAvatarCompatButtonFallback,
  bindAvatarFilterFallbackEvents,
} = avatarFilterUi;

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

    await getRendererModule('auxUi')?.handleGlobalShortcutEvent?.(e);
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
    renderGrid: (...args) => renderGrid(...args),
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
    renderGrid: (...args) => renderGrid(...args),
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
    renderGrid: (...args) => renderGrid(...args),
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

  const modelPreviewUi = safeCreateRendererModule('modelPreview', () => createRenderModelPreview({
    boothAPI: window.boothAPI,
    esc,
    showTransientMessage,
    logger: window.logger,
  }));
  let openModelPreview = null;
  let closeModelPreview = null;
  if (modelPreviewUi) {
    openModelPreview = modelPreviewUi.openModelPreview;
    closeModelPreview = modelPreviewUi.closeModelPreview;
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
    renderGrid: (...args) => renderGrid(...args),
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
    openModelPreview,
    closeModelPreview,
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
    showAvatarFilterAnalysisPromptModal: (...args) => showAvatarFilterAnalysisPromptModal(...args),
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
    getTileEntryByItemId: (...args) => getTileEntryByItemId(...args),
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
