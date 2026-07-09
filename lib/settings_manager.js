'use strict';

const { toFiniteNumber, normalizeHour, normalizeRetryAttempts, normalizeRetryBaseDelayMs, normalizeZipMaxEntryBytes } = require('./utils');

function createSettingsManager(deps) {
  const {
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
    onAfterSave,
  } = deps;

  let settings = { ...DEFAULT_SETTINGS };
  let settingsProfiles = {};

  // ---- path normalization (exported for use by other managers) ----

  function normalizeProjectPath(projectPath) {
    const raw = String(projectPath || '').trim();
    if (!raw) return '';
    let resolved = path.resolve(raw);
    resolved = resolved.replace(/[\\/]+$/, '');
    if (process.platform === 'win32') {
      return resolved.toLowerCase();
    }
    return resolved;
  }

  // ---- auto-bootstrap normalize helpers ----

  function normalizeAutoBootstrapVariantMode(mode) {
    const v = String(mode || '').trim().toLowerCase();
    return ['first', 'select', 'all'].includes(v) ? v : DEFAULT_SETTINGS.autoBootstrapVariantMode;
  }

  function normalizeAutoBootstrapVariantSelections(input) {
    return Array.from(new Set(
      (Array.isArray(input) ? input : [])
        .map((s) => String(s || '').trim())
        .filter(Boolean)
    ));
  }

  function normalizeAutoBootstrapProjectImportRules(input) {
    if (!Array.isArray(input)) return [];
    return input
      .map((r) => {
        const projectPattern = String(r?.projectPattern || '').trim();
        const choiceKey = String(
          r?.choiceKey
          || (Array.isArray(r?.choiceKeys) ? (r.choiceKeys[0] || '') : '')
          || ''
        ).trim();
        if (!projectPattern || !choiceKey) return null;
        return { projectPattern, choiceKey };
      })
      .filter(Boolean);
  }

  // ---- normalize helpers ----

  function normalizeConcurrency(value) {
    const n = Math.trunc(toFiniteNumber(value, DEFAULT_SETTINGS.concurrency));
    return Math.max(1, Math.min(4, n));
  }

  function normalizeNonNegativeNumber(value, fallback) {
    const n = toFiniteNumber(value, fallback);
    return Math.max(0, n);
  }

  function normalizeSchedulerProfile(value) {
    const s = String(value || '').trim().toLowerCase();
    if (s === 'light' || s === 'fast' || s === 'balanced') return s;
    return 'balanced';
  }

  function normalizeKeyboardShortcuts(input) {
    const DEFAULT_KEYBOARD_SHORTCUTS = DEFAULT_SETTINGS.keyboardShortcuts;
    const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const out = { ...DEFAULT_KEYBOARD_SHORTCUTS };
    for (const key of Object.keys(DEFAULT_KEYBOARD_SHORTCUTS)) {
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
      const raw = String(src[key] || '').trim();
      out[key] = raw ? raw.slice(0, 40) : DEFAULT_KEYBOARD_SHORTCUTS[key];
    }
    return out;
  }

  function normalizeProjectImportPresets(input) {
    const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const out = {};
    for (const rawKey of Object.keys(src)) {
      const projectPath = normalizeProjectPath(rawKey);
      if (!projectPath) continue;
      const row = src[rawKey];
      out[projectPath] = {
        autoDryRun: row?.autoDryRun !== false,
        autoInstallDeps: Boolean(row?.autoInstallDeps),
      };
    }
    return out;
  }

  function normalizeUnityProjects(input) {
    if (!Array.isArray(input)) return [];
    return input
      .map((p) => ({
        name: String(p?.name || '').trim(),
        path: String(p?.path || '').trim(),
      }))
      .filter((p) => p.path.length > 0);
  }

  function dedupeProjects(projects) {
    const seen = new Set();
    const out = [];
    for (const p of (projects || [])) {
      const key = String(p?.path || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: String(p?.name || path.basename(p.path || 'Project')).trim(),
        path: String(p?.path || '').trim(),
      });
    }
    return out;
  }

  function normalizeSettingsInPlace(target) {
    const t = target || {};
    const rawDownloadPath = String(t.downloadPath || DEFAULT_SETTINGS.downloadPath).trim();
    t.downloadPath = (rawDownloadPath && path.isAbsolute(rawDownloadPath))
      ? rawDownloadPath
      : DEFAULT_SETTINGS.downloadPath;
    // Cookie storage is centralized under APP_DATA_ROOT.
    t.cookieFile = DEFAULT_SETTINGS.cookieFile;
    t.unityEditorPath = String(t.unityEditorPath || '').trim();
    t.unityProjects = normalizeUnityProjects(t.unityProjects);
    t.concurrency = normalizeConcurrency(t.concurrency);
    t.autoCheckInterval = normalizeNonNegativeNumber(t.autoCheckInterval, DEFAULT_SETTINGS.autoCheckInterval);
    t.minFreeSpaceGb = normalizeNonNegativeNumber(t.minFreeSpaceGb, DEFAULT_SETTINGS.minFreeSpaceGb);
    t.autoBootstrapEnabled = t.autoBootstrapEnabled !== false;
    t.autoBootstrapIncludeMA = t.autoBootstrapIncludeMA !== false;
    t.autoBootstrapIncludeLiltoon = t.autoBootstrapIncludeLiltoon !== false;
    t.autoBootstrapIncludeFaceEmo = t.autoBootstrapIncludeFaceEmo !== false;
    t.autoBootstrapIncludeAvatoolScripts = t.autoBootstrapIncludeAvatoolScripts !== false;
    t.autoBootstrapIncludeFolderIconBootstrap = t.autoBootstrapIncludeFolderIconBootstrap !== false;
    t.autoBootstrapIncludeSimpleFolderIcon = t.autoBootstrapIncludeAvatoolScripts !== false
      && t.autoBootstrapIncludeSimpleFolderIcon !== false;
    t.autoBootstrapProjectImportRules = normalizeAutoBootstrapProjectImportRules(t.autoBootstrapProjectImportRules);
    t.autoBootstrapVariantMode = normalizeAutoBootstrapVariantMode(t.autoBootstrapVariantMode);
    const legacySelection = String(t.autoBootstrapVariantSelection || t.autoBootstrapVariantKeyword || '').trim();
    const mergedSelections = [
      ...normalizeAutoBootstrapVariantSelections(t.autoBootstrapVariantSelections),
      ...(legacySelection ? [legacySelection] : []),
    ];
    t.autoBootstrapVariantSelections = normalizeAutoBootstrapVariantSelections(mergedSelections);
    t.safeMode = Boolean(t.safeMode);
    t.healthCheckOnStartup = t.healthCheckOnStartup !== false;
    t.debugLogEnabled = Boolean(t.debugLogEnabled);
    t.downloadSchedulerEnabled = Boolean(t.downloadSchedulerEnabled);
    t.downloadSchedulerStartHour = normalizeHour(t.downloadSchedulerStartHour, DEFAULT_SETTINGS.downloadSchedulerStartHour);
    t.downloadSchedulerEndHour = normalizeHour(t.downloadSchedulerEndHour, DEFAULT_SETTINGS.downloadSchedulerEndHour);
    t.downloadSchedulerProfile = normalizeSchedulerProfile(t.downloadSchedulerProfile);
    t.downloadRetryMaxAttempts = normalizeRetryAttempts(t.downloadRetryMaxAttempts, DEFAULT_SETTINGS.downloadRetryMaxAttempts);
    t.downloadRetryBaseDelayMs = normalizeRetryBaseDelayMs(t.downloadRetryBaseDelayMs, DEFAULT_SETTINGS.downloadRetryBaseDelayMs);
    t.operationLogEnabled = t.operationLogEnabled !== false;
    t.zipMaxEntryBytes = normalizeZipMaxEntryBytes(t.zipMaxEntryBytes, DEFAULT_SETTINGS.zipMaxEntryBytes);
    t.keyboardShortcutsEnabled = t.keyboardShortcutsEnabled !== false;
    t.renderMode = String(t.renderMode || '').trim().toLowerCase() === 'instant' ? 'instant' : 'progressive';
    t.keyboardShortcuts = normalizeKeyboardShortcuts(t.keyboardShortcuts);
    t.projectImportPresets = normalizeProjectImportPresets(t.projectImportPresets);
    t.experimentalModelPreview = Boolean(t.experimentalModelPreview);
    return t;
  }

  // ---- JSON helpers ----

  function readJsonFileSafe(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      return data ?? fallback;
    } catch {
      return fallback;
    }
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

  // ---- allowed settings filters ----

  function pickAllowedSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const out = {};
    for (const key of ALLOWED_SETTINGS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
    }
    return out;
  }

  function pickAllowedImportSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const out = {};
    for (const key of IMPORT_ALLOWED_SETTINGS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
    }
    return out;
  }

  // ---- settings I/O ----

  function saveSettings(nextSettings) {
    try {
      const next = (nextSettings && typeof nextSettings === 'object' && !Array.isArray(nextSettings))
        ? { ...settings, ...pickAllowedSettings(nextSettings) }
        : { ...settings };
      normalizeSettingsInPlace(next);
      ensureAppDataRootExists();
      const tmpPath = SETTINGS_PATH + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf8');
      fs.renameSync(tmpPath, SETTINGS_PATH);
      settings = next;
      if (typeof onAfterSave === 'function') onAfterSave(settings);
      return { ok: true, settings };
    } catch (e) {
      console.error('Settings save failed:', e?.message || e);
      throw e;
    }
  }

  function loadSettings() {
    try {
      ensureAppDataRootExists();
      if (fs.existsSync(SETTINGS_PATH)) {
        const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
        let data = null;
        try {
          data = JSON.parse(raw);
        } catch (e) {
          const backupPath = backupCorruptedJson(SETTINGS_PATH, raw);
          console.warn('Settings parse failed. Reset to defaults.', e?.message || e, backupPath ? `(backup: ${backupPath})` : '');
          settings = { ...DEFAULT_SETTINGS };
          saveSettings();
          return;
        }
        settings = { ...DEFAULT_SETTINGS, ...pickAllowedSettings(data || {}) };
        const legacyDownloadPath = path.join(LEGACY_APP_ROOT, 'downloads');
        const configuredDownloadPath = String(settings.downloadPath || '').trim();
        const countDirs = (targetPath) => {
          try {
            if (!targetPath || !fs.existsSync(targetPath)) return 0;
            return fs.readdirSync(targetPath, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
          } catch {
            return 0;
          }
        };
        // Name migration safety:
        // if configured path is empty/new but legacy app-root downloads has data, keep using legacy path.
        if (
          configuredDownloadPath
          && !app.isPackaged
          && path.resolve(configuredDownloadPath) !== path.resolve(legacyDownloadPath)
        ) {
          const configuredCount = countDirs(configuredDownloadPath);
          const legacyCount = countDirs(legacyDownloadPath);
          if (configuredCount === 0 && legacyCount > 0) {
            settings.downloadPath = legacyDownloadPath;
            console.log('[settings] downloadPath migrated to legacy path:', legacyDownloadPath);
          }
        }

        const legacyCookiePath = path.join(LEGACY_APP_ROOT, 'booth.pm.json');
        const configuredCookiePath = String(settings.cookieFile || '').trim();
        if (
          configuredCookiePath
          && !app.isPackaged
          && path.resolve(configuredCookiePath) !== path.resolve(legacyCookiePath)
          && !fs.existsSync(configuredCookiePath)
          && fs.existsSync(legacyCookiePath)
        ) {
          settings.cookieFile = legacyCookiePath;
          console.log('[settings] cookieFile migrated to legacy path:', legacyCookiePath);
        }

        normalizeSettingsInPlace(settings);
        saveSettings();
      }
    } catch (e) {
      console.warn('Settings load failed:', e?.message || e);
    }
  }

  // ---- settings profiles ----

  function saveSettingsProfiles() {
    try {
      ensureAppDataRootExists();
      fs.writeFileSync(SETTINGS_PROFILES_PATH, JSON.stringify(settingsProfiles || {}, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }

  function loadSettingsProfiles() {
    const obj = readJsonFileSafe(SETTINGS_PROFILES_PATH, {});
    settingsProfiles = (obj && typeof obj === 'object') ? obj : {};
  }

  function getSettingsProfiles() {
    return settingsProfiles;
  }

  function setSettingsProfiles(nextProfiles) {
    settingsProfiles = (nextProfiles && typeof nextProfiles === 'object' && !Array.isArray(nextProfiles))
      ? nextProfiles
      : {};
  }

  // ---- state accessors ----

  function getSettings() {
    return settings;
  }

  function setSettings(newSettings) {
    settings = newSettings;
  }

  return {
    // state accessors
    getSettings,
    setSettings,
    getSettingsProfiles,
    setSettingsProfiles,
    // load/save
    loadSettings,
    saveSettings,
    loadSettingsProfiles,
    saveSettingsProfiles,
    // normalize helpers
    normalizeSettingsInPlace,
    normalizeUnityProjects,
    dedupeProjects,
    normalizeConcurrency,
    normalizeZipMaxEntryBytes,
    pickAllowedSettings,
    pickAllowedImportSettings,
    normalizeAutoBootstrapVariantMode,
    normalizeAutoBootstrapVariantSelections,
    normalizeAutoBootstrapProjectImportRules,
    normalizeSchedulerProfile,
    normalizeKeyboardShortcuts,
    parseAutoBootstrapChoiceKey: undefined, // defined in main or meta_manager
    // path helper (shared)
    normalizeProjectPath,
    // json helpers (shared with other managers)
    readJsonFileSafe,
    backupCorruptedJson,
  };
}

module.exports = { createSettingsManager };
