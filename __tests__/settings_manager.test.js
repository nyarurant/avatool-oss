'use strict';

const { createSettingsManager } = require('../lib/settings_manager');
const path = require('path');

// ─── テスト用 DEFAULT_SETTINGS / deps ────────────────────────────────────────

const DEFAULT_KEYBOARD_SHORTCUTS = Object.freeze({
  focusSearch: '/',
  focusSearchAlt: 'Ctrl+F',
  viewGrid: 'g',
  viewList: 'l',
  syncLibrary: 'r',
  downloadAll: 'd',
  queueToggle: 'q',
});

const DEFAULT_SETTINGS = {
  downloadPath: 'C:/test/downloads',
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
  cookieFile: 'C:/test/booth.pm.json',
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
};

const ALLOWED_SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const IMPORT_ALLOWED_SETTINGS_KEYS = new Set([...ALLOWED_SETTINGS_KEYS].filter((k) => k !== 'cookieFile'));

function makeDeps(overrides = {}) {
  return {
    fs: {
      existsSync: jest.fn(() => false),
      readFileSync: jest.fn(() => JSON.stringify(DEFAULT_SETTINGS)),
      writeFileSync: jest.fn(),
      mkdirSync: jest.fn(),
      renameSync: jest.fn(),
    },
    path,
    app: { getPath: jest.fn(() => 'C:/test') },
    SETTINGS_PATH: 'C:/test/settings.json',
    SETTINGS_PROFILES_PATH: 'C:/test/settings-profiles.json',
    DEFAULT_SETTINGS,
    ALLOWED_SETTINGS_KEYS,
    IMPORT_ALLOWED_SETTINGS_KEYS,
    LEGACY_APP_ROOT: 'C:/legacy',
    ensureAppDataRootExists: jest.fn(),
    onAfterSave: jest.fn(),
    ...overrides,
  };
}

// ─── normalizeConcurrency ──────────────────────────────────────────────────────

describe('normalizeConcurrency', () => {
  let sm;
  beforeEach(() => { sm = createSettingsManager(makeDeps()); });

  test('1〜4 の整数はそのまま返す', () => {
    expect(sm.normalizeConcurrency(1)).toBe(1);
    expect(sm.normalizeConcurrency(2)).toBe(2);
    expect(sm.normalizeConcurrency(4)).toBe(4);
  });

  test('0 は 1 にクランプする', () => {
    expect(sm.normalizeConcurrency(0)).toBe(1);
    expect(sm.normalizeConcurrency(-1)).toBe(1);
  });

  test('5 以上は 4 にクランプする', () => {
    expect(sm.normalizeConcurrency(5)).toBe(4);
    expect(sm.normalizeConcurrency(100)).toBe(4);
  });

  test('小数は切り捨てる', () => {
    expect(sm.normalizeConcurrency(3.9)).toBe(3);
  });

  test('非数値は DEFAULT_SETTINGS.concurrency を返す', () => {
    expect(sm.normalizeConcurrency('abc')).toBe(DEFAULT_SETTINGS.concurrency);
  });
});

// ─── normalizeAutoBootstrapVariantMode ────────────────────────────────────────

describe('normalizeAutoBootstrapVariantMode', () => {
  let sm;
  beforeEach(() => { sm = createSettingsManager(makeDeps()); });

  test("'first'/'select'/'all' を受け入れる", () => {
    expect(sm.normalizeAutoBootstrapVariantMode('first')).toBe('first');
    expect(sm.normalizeAutoBootstrapVariantMode('select')).toBe('select');
    expect(sm.normalizeAutoBootstrapVariantMode('all')).toBe('all');
  });

  test('大文字入力も正規化する', () => {
    expect(sm.normalizeAutoBootstrapVariantMode('FIRST')).toBe('first');
    expect(sm.normalizeAutoBootstrapVariantMode('SELECT')).toBe('select');
  });

  test('不正値はデフォルト（select）を返す', () => {
    expect(sm.normalizeAutoBootstrapVariantMode('invalid')).toBe(DEFAULT_SETTINGS.autoBootstrapVariantMode);
    expect(sm.normalizeAutoBootstrapVariantMode('')).toBe(DEFAULT_SETTINGS.autoBootstrapVariantMode);
    expect(sm.normalizeAutoBootstrapVariantMode(null)).toBe(DEFAULT_SETTINGS.autoBootstrapVariantMode);
  });
});

// ─── normalizeAutoBootstrapVariantSelections ──────────────────────────────────

describe('normalizeAutoBootstrapVariantSelections', () => {
  let sm;
  beforeEach(() => { sm = createSettingsManager(makeDeps()); });

  test('配列の重複を除去する', () => {
    const result = sm.normalizeAutoBootstrapVariantSelections(['a', 'b', 'a']);
    expect(result).toEqual(['a', 'b']);
  });

  test('空文字列を除外する', () => {
    const result = sm.normalizeAutoBootstrapVariantSelections(['a', '', '  ', 'b']);
    expect(result).toEqual(['a', 'b']);
  });

  test('各要素をトリムする', () => {
    const result = sm.normalizeAutoBootstrapVariantSelections(['  hello  ', 'world ']);
    expect(result).toEqual(['hello', 'world']);
  });

  test('非配列入力は空配列を返す', () => {
    expect(sm.normalizeAutoBootstrapVariantSelections(null)).toEqual([]);
    expect(sm.normalizeAutoBootstrapVariantSelections('string')).toEqual([]);
    expect(sm.normalizeAutoBootstrapVariantSelections({})).toEqual([]);
  });

  test('空配列は空配列を返す', () => {
    expect(sm.normalizeAutoBootstrapVariantSelections([])).toEqual([]);
  });
});

// ─── normalizeAutoBootstrapProjectImportRules ─────────────────────────────────

describe('normalizeAutoBootstrapProjectImportRules', () => {
  let sm;
  beforeEach(() => { sm = createSettingsManager(makeDeps()); });

  test('有効なルールをそのまま返す', () => {
    const rules = [
      { projectPattern: 'MyProject', choiceKey: 'default' },
    ];
    const result = sm.normalizeAutoBootstrapProjectImportRules(rules);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ projectPattern: 'MyProject', choiceKey: 'default' });
  });

  test('projectPattern が空のルールを除外する', () => {
    const rules = [
      { projectPattern: '', choiceKey: 'key' },
      { projectPattern: 'valid', choiceKey: 'key' },
    ];
    const result = sm.normalizeAutoBootstrapProjectImportRules(rules);
    expect(result).toHaveLength(1);
  });

  test('choiceKey が空のルールを除外する', () => {
    const rules = [
      { projectPattern: 'valid', choiceKey: '' },
    ];
    const result = sm.normalizeAutoBootstrapProjectImportRules(rules);
    expect(result).toHaveLength(0);
  });

  test('非配列入力は空配列を返す', () => {
    expect(sm.normalizeAutoBootstrapProjectImportRules(null)).toEqual([]);
    expect(sm.normalizeAutoBootstrapProjectImportRules({})).toEqual([]);
  });

  test('choiceKeys 配列の最初の要素を choiceKey として使う', () => {
    const rules = [
      { projectPattern: 'valid', choiceKeys: ['first', 'second'] },
    ];
    const result = sm.normalizeAutoBootstrapProjectImportRules(rules);
    expect(result[0].choiceKey).toBe('first');
  });
});

// ─── normalizeProjectPath ─────────────────────────────────────────────────────

describe('normalizeProjectPath', () => {
  let sm;
  beforeEach(() => { sm = createSettingsManager(makeDeps()); });

  test('空文字列は空文字列を返す', () => {
    expect(sm.normalizeProjectPath('')).toBe('');
    expect(sm.normalizeProjectPath(null)).toBe('');
    expect(sm.normalizeProjectPath(undefined)).toBe('');
  });

  test('末尾のスラッシュを除去する', () => {
    const raw = 'C:/my/project/';
    const result = sm.normalizeProjectPath(raw);
    expect(result.endsWith('/') || result.endsWith('\\')).toBe(false);
  });

  test('Win32 では小文字に変換する', () => {
    if (process.platform !== 'win32') return;
    const result = sm.normalizeProjectPath('C:/My/Project');
    expect(result).toBe(result.toLowerCase());
  });
});

// ─── pickAllowedSettings ──────────────────────────────────────────────────────

describe('pickAllowedSettings', () => {
  let sm;
  beforeEach(() => { sm = createSettingsManager(makeDeps()); });

  test('許可キーのみ返す', () => {
    const input = {
      downloadPath: 'C:/test',
      unknownKey: 'should_be_removed',
      concurrency: 3,
    };
    const result = sm.pickAllowedSettings(input);
    expect(result).toHaveProperty('downloadPath');
    expect(result).toHaveProperty('concurrency');
    expect(result).not.toHaveProperty('unknownKey');
  });

  test('非オブジェクト入力は空オブジェクトを返す', () => {
    expect(sm.pickAllowedSettings(null)).toEqual({});
    expect(sm.pickAllowedSettings('string')).toEqual({});
    expect(sm.pickAllowedSettings([])).toEqual({});
  });
});

// ─── normalizeSettingsInPlace ─────────────────────────────────────────────────

describe('normalizeSettingsInPlace', () => {
  let sm;
  beforeEach(() => { sm = createSettingsManager(makeDeps()); });

  test('有効な設定はそのまま維持する', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      concurrency: 3,
      downloadSchedulerProfile: 'fast',
      renderMode: 'instant',
    };
    const result = sm.normalizeSettingsInPlace(settings);
    expect(result.concurrency).toBe(3);
    expect(result.downloadSchedulerProfile).toBe('fast');
    expect(result.renderMode).toBe('instant');
  });

  test('不正な concurrency をクランプする', () => {
    const settings = { ...DEFAULT_SETTINGS, concurrency: 99 };
    const result = sm.normalizeSettingsInPlace(settings);
    expect(result.concurrency).toBe(4);
  });

  test('不正な schedulerProfile をデフォルトに戻す', () => {
    const settings = { ...DEFAULT_SETTINGS, downloadSchedulerProfile: 'turbo' };
    const result = sm.normalizeSettingsInPlace(settings);
    expect(result.downloadSchedulerProfile).toBe('balanced');
  });

  test('autoBootstrapEnabled はデフォルト true', () => {
    const settings = { ...DEFAULT_SETTINGS };
    delete settings.autoBootstrapEnabled;
    const result = sm.normalizeSettingsInPlace(settings);
    expect(result.autoBootstrapEnabled).toBe(true);
  });

  test('debugLogEnabled は boolean として正規化する', () => {
    const enabled = sm.normalizeSettingsInPlace({ ...DEFAULT_SETTINGS, debugLogEnabled: '1' });
    expect(enabled.debugLogEnabled).toBe(true);
    const disabled = sm.normalizeSettingsInPlace({ ...DEFAULT_SETTINGS, debugLogEnabled: '' });
    expect(disabled.debugLogEnabled).toBe(false);
  });

  test('自動起動と自動更新確認を boolean として正規化する', () => {
    const result = sm.normalizeSettingsInPlace({
      ...DEFAULT_SETTINGS,
      launchAtLogin: '1',
      appUpdateAutoCheckEnabled: false,
    });
    expect(result.launchAtLogin).toBe(true);
    expect(result.appUpdateAutoCheckEnabled).toBe(false);
  });

  test('renderMode は instant / progressive のみ受け入れる', () => {
    const s1 = sm.normalizeSettingsInPlace({ ...DEFAULT_SETTINGS, renderMode: 'instant' });
    expect(s1.renderMode).toBe('instant');
    const s2 = sm.normalizeSettingsInPlace({ ...DEFAULT_SETTINGS, renderMode: 'invalid' });
    expect(s2.renderMode).toBe('progressive');
  });

  test('downloadPath が相対パスの場合 DEFAULT_SETTINGS.downloadPath を使う', () => {
    const settings = { ...DEFAULT_SETTINGS, downloadPath: 'relative/path' };
    const result = sm.normalizeSettingsInPlace(settings);
    expect(result.downloadPath).toBe(DEFAULT_SETTINGS.downloadPath);
  });

  test('null 入力でもエラーを投げない', () => {
    expect(() => sm.normalizeSettingsInPlace(null)).not.toThrow();
  });
});

describe('saveSettings', () => {
  test('writes normalized settings and updates memory after disk write', () => {
    const deps = makeDeps();
    const sm = createSettingsManager(deps);
    const result = sm.saveSettings({ concurrency: 3 });
    expect(result.ok).toBe(true);
    expect(deps.fs.writeFileSync).toHaveBeenCalledWith(
      'C:/test/settings.json.tmp',
      expect.stringContaining('"concurrency": 3'),
      'utf8'
    );
    expect(deps.fs.renameSync).toHaveBeenCalledWith('C:/test/settings.json.tmp', 'C:/test/settings.json');
    expect(sm.getSettings().concurrency).toBe(3);
    expect(deps.onAfterSave).toHaveBeenCalledWith(sm.getSettings());
  });

  test('throws and keeps in-memory settings when disk write fails', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn(() => false),
        readFileSync: jest.fn(() => JSON.stringify(DEFAULT_SETTINGS)),
        writeFileSync: jest.fn(() => { throw new Error('disk full'); }),
        mkdirSync: jest.fn(),
        renameSync: jest.fn(),
      },
    });
    const sm = createSettingsManager(deps);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => sm.saveSettings({ concurrency: 4 })).toThrow('disk full');
    errorSpy.mockRestore();
    expect(sm.getSettings().concurrency).toBe(DEFAULT_SETTINGS.concurrency);
    expect(deps.onAfterSave).not.toHaveBeenCalled();
  });
});

describe('saveSettingsProfiles', () => {
  test('一時ファイルを書いてから置換する', () => {
    const deps = makeDeps();
    const sm = createSettingsManager(deps);
    sm.setSettingsProfiles({ default: { concurrency: 2 } });
    expect(sm.saveSettingsProfiles()).toEqual({ ok: true });
    expect(deps.fs.writeFileSync).toHaveBeenCalledWith(
      'C:/test/settings-profiles.json.tmp',
      expect.stringContaining('"default"'),
      'utf8'
    );
    expect(deps.fs.renameSync).toHaveBeenCalledWith(
      'C:/test/settings-profiles.json.tmp',
      'C:/test/settings-profiles.json'
    );
  });

  test('書き込み失敗を呼び出し側へ返す', () => {
    const deps = makeDeps();
    deps.fs.writeFileSync.mockImplementation(() => { throw new Error('disk full'); });
    const sm = createSettingsManager(deps);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => sm.saveSettingsProfiles()).toThrow('disk full');
    errorSpy.mockRestore();
    expect(deps.fs.renameSync).not.toHaveBeenCalled();
  });
});
