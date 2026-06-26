'use strict';

const { createHealthCheckService } = require('../lib/health_check_service');

// ---------------------------------------------------------------------------
// テスト用 deps ファクトリ
// ---------------------------------------------------------------------------

function makeDeps(overrides = {}) {
  return {
    fs: {
      existsSync: jest.fn().mockReturnValue(false),
      readFileSync: jest.fn().mockReturnValue('[]'),
    },
    DEFAULT_SETTINGS: { cookieFile: '/data/booth.pm.json' },
    readBoothCookiesFromFile: jest.fn().mockReturnValue([]),
    validateBoothLogin: jest.fn().mockResolvedValue({ ok: true }),
    getStorageUsageSnapshot: jest.fn().mockReturnValue({ drive: null }),
    META_PATH: '/data/meta.json',
    VCC_SETTINGS_PATH: '/vcc/settings.json',
    getSettings: jest.fn().mockReturnValue({ minFreeSpaceGb: 0, unityEditorPath: '' }),
    appendOperationLog: jest.fn(),
    getMainWindow: jest.fn().mockReturnValue(null),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// runHealthCheck — Cookie チェック
// ---------------------------------------------------------------------------

describe('runHealthCheck — Cookie チェック', () => {
  test('Cookie ファイルが存在しなければ cookie_missing warn', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(false), readFileSync: jest.fn().mockReturnValue('[]') },
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    const issue = report.issues.find((i) => i.code === 'cookie_missing');
    expect(issue).toBeDefined();
    expect(issue.level).toBe('warn');
  });

  test('Cookie が空配列なら cookie_empty warn', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(true), readFileSync: jest.fn().mockReturnValue('[]') },
      readBoothCookiesFromFile: jest.fn().mockReturnValue([]),
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    const issue = report.issues.find((i) => i.code === 'cookie_empty');
    expect(issue).toBeDefined();
  });

  test('validateBoothLogin が ok=false なら cookie_login_invalid warn', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(true), readFileSync: jest.fn().mockReturnValue('[]') },
      readBoothCookiesFromFile: jest.fn().mockReturnValue([{ name: 'x', value: 'y' }]),
      validateBoothLogin: jest.fn().mockResolvedValue({ ok: false, reason: 'redirect_to_login' }),
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    const issue = report.issues.find((i) => i.code === 'cookie_login_invalid');
    expect(issue).toBeDefined();
    expect(issue.level).toBe('warn');
  });

  test('Cookie 正常・ログイン成功なら Cookie 関連 issue なし', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(true), readFileSync: jest.fn().mockReturnValue('[]') },
      readBoothCookiesFromFile: jest.fn().mockReturnValue([{ name: 'x', value: 'y' }]),
      validateBoothLogin: jest.fn().mockResolvedValue({ ok: true }),
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(report.issues.filter((i) => i.code.startsWith('cookie'))).toHaveLength(0);
  });

  test('readBoothCookiesFromFile が例外を投げると cookie_check_failed warn', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(true), readFileSync: jest.fn().mockReturnValue('[]') },
      readBoothCookiesFromFile: jest.fn().mockImplementation(() => { throw new Error('decrypt fail'); }),
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    const issue = report.issues.find((i) => i.code === 'cookie_check_failed');
    expect(issue).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// runHealthCheck — ディスク容量チェック
// ---------------------------------------------------------------------------

describe('runHealthCheck — ディスク容量チェック', () => {
  test('minFreeSpaceGb=0 なら disk_low は発生しない', async () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ minFreeSpaceGb: 0 }),
      getStorageUsageSnapshot: jest.fn().mockReturnValue({ drive: { freeBytes: 0 } }),
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(report.issues.find((i) => i.code === 'disk_low')).toBeUndefined();
  });

  test('空き容量が閾値未満なら disk_low error', async () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ minFreeSpaceGb: 10 }),
      getStorageUsageSnapshot: jest.fn().mockReturnValue({
        drive: { freeBytes: 1 * 1024 * 1024 * 1024 }, // 1 GiB < 10 GiB
      }),
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    const issue = report.issues.find((i) => i.code === 'disk_low');
    expect(issue).toBeDefined();
    expect(issue.level).toBe('error');
  });

  test('空き容量が閾値以上なら disk_low は発生しない', async () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ minFreeSpaceGb: 5 }),
      getStorageUsageSnapshot: jest.fn().mockReturnValue({
        drive: { freeBytes: 20 * 1024 * 1024 * 1024 }, // 20 GiB > 5 GiB
      }),
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(report.issues.find((i) => i.code === 'disk_low')).toBeUndefined();
  });

  test('getStorageUsageSnapshot が例外を投げると disk_check_failed warn', async () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ minFreeSpaceGb: 5 }),
      getStorageUsageSnapshot: jest.fn().mockImplementation(() => { throw new Error('io error'); }),
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(report.issues.find((i) => i.code === 'disk_check_failed')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// runHealthCheck — メタ JSON チェック
// ---------------------------------------------------------------------------

describe('runHealthCheck — メタ JSON チェック', () => {
  test('meta.json が存在しなければ issues なし（空配列扱い）', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(false), readFileSync: jest.fn() },
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(report.issues.find((i) => i.code === 'meta_not_array')).toBeUndefined();
    expect(report.issues.find((i) => i.code === 'meta_parse_failed')).toBeUndefined();
  });

  test('meta.json が配列でなければ meta_not_array error', async () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue('{"key":"value"}'),
      },
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    const issue = report.issues.find((i) => i.code === 'meta_not_array');
    expect(issue).toBeDefined();
    expect(issue.level).toBe('error');
  });

  test('重複 itemId があれば meta_duplicate_ids warn', async () => {
    const meta = [
      { itemId: '1' }, { itemId: '2' }, { itemId: '1' },
    ];
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(meta)),
      },
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    const issue = report.issues.find((i) => i.code === 'meta_duplicate_ids');
    expect(issue).toBeDefined();
    expect(issue.level).toBe('warn');
  });

  test('正常な meta.json なら meta 関連 issue なし', async () => {
    const meta = [{ itemId: '1' }, { itemId: '2' }];
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(meta)),
      },
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(report.issues.filter((i) => i.code.startsWith('meta'))).toHaveLength(0);
  });

  test('meta.json が壊れた JSON なら meta_parse_failed error', async () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue('not-json'),
      },
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(report.issues.find((i) => i.code === 'meta_parse_failed')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// runHealthCheck — Unity Editor チェック
// ---------------------------------------------------------------------------

describe('runHealthCheck — Unity Editor チェック', () => {
  test('unityEditorPath が空なら unity チェックをスキップ', async () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ minFreeSpaceGb: 0, unityEditorPath: '' }),
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(report.issues.find((i) => i.code === 'unity_editor_not_found')).toBeUndefined();
  });

  test('unityEditorPath が設定されていてファイルが存在しなければ unity_editor_not_found warn', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(false), readFileSync: jest.fn().mockReturnValue('[]') },
      getSettings: jest.fn().mockReturnValue({ minFreeSpaceGb: 0, unityEditorPath: '/Unity/Editor/Unity.exe' }),
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    const issue = report.issues.find((i) => i.code === 'unity_editor_not_found');
    expect(issue).toBeDefined();
    expect(issue.level).toBe('warn');
  });

  test('unityEditorPath が存在すれば unity_editor_not_found は発生しない', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(true), readFileSync: jest.fn().mockReturnValue('[]') },
      getSettings: jest.fn().mockReturnValue({ minFreeSpaceGb: 0, unityEditorPath: '/Unity/Editor/Unity.exe' }),
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(report.issues.find((i) => i.code === 'unity_editor_not_found')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runHealthCheck — VCC チェック
// ---------------------------------------------------------------------------

describe('runHealthCheck — VCC チェック', () => {
  test('VCC_SETTINGS_PATH が空なら vcc_not_found warn', async () => {
    const deps = makeDeps({ VCC_SETTINGS_PATH: '' });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    const issue = report.issues.find((i) => i.code === 'vcc_not_found');
    expect(issue).toBeDefined();
    expect(issue.level).toBe('warn');
  });

  test('VCC settings.json が存在しなければ vcc_not_found warn', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(false), readFileSync: jest.fn().mockReturnValue('[]') },
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    const issue = report.issues.find((i) => i.code === 'vcc_not_found');
    expect(issue).toBeDefined();
    expect(issue.level).toBe('warn');
  });

  test('VCC settings.json が存在すれば vcc_not_found は発生しない', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(true), readFileSync: jest.fn().mockReturnValue('[]') },
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(report.issues.find((i) => i.code === 'vcc_not_found')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runHealthCheck — レポート構造
// ---------------------------------------------------------------------------

describe('runHealthCheck — レポート構造', () => {
  test('issue がなければ ok=true', async () => {
    const meta = [{ itemId: '1' }];
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(meta)),
      },
      readBoothCookiesFromFile: jest.fn().mockReturnValue([{ name: 'x', value: 'y' }]),
      validateBoothLogin: jest.fn().mockResolvedValue({ ok: true }),
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(report.ok).toBe(true);
  });

  test('error レベルの issue があれば ok=false', async () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue('{"bad":"json"}'),
      },
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(report.ok).toBe(false);
  });

  test('trigger がレポートに反映される', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(false), readFileSync: jest.fn().mockReturnValue('[]') },
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck('startup');
    expect(report.trigger).toBe('startup');
  });

  test('appendOperationLog が呼ばれる', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(false), readFileSync: jest.fn().mockReturnValue('[]') },
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    await runHealthCheck();
    expect(deps.appendOperationLog).toHaveBeenCalledWith('health-check', expect.any(String), expect.any(Object));
  });

  test('at は ISO 8601 形式', async () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(false), readFileSync: jest.fn().mockReturnValue('[]') },
    });
    const { runHealthCheck } = createHealthCheckService(deps);
    const report = await runHealthCheck();
    expect(typeof report.at).toBe('string');
    expect(() => new Date(report.at)).not.toThrow();
  });
});
