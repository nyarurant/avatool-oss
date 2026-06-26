'use strict';

const { createStorageManager } = require('../lib/storage_manager');

// ---------------------------------------------------------------------------
// テスト用 deps ファクトリ
// ---------------------------------------------------------------------------

function makeDeps(overrides = {}) {
  return {
    fs: {
      existsSync: jest.fn().mockReturnValue(false),
      lstatSync: jest.fn().mockReturnValue({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => false, size: 0 }),
      readdirSync: jest.fn().mockReturnValue([]),
      statfsSync: undefined, // デフォルトは存在しない（ドライブ情報なし）
    },
    getSettings: jest.fn().mockReturnValue({ downloadPath: '/downloads' }),
    CACHE_DIR: '/cache',
    AUTHOR_ICON_DIR: '/icons',
    UNITY_LOG_DIR: '/logs',
    META_PATH: '/data/meta.json',
    SETTINGS_PATH: '/data/settings.json',
    IMPORT_LOG_PATH: '/data/import.log',
    RECONCILE_LOG_PATH: '/data/reconcile.log',
    AVATARS_PATH: '/data/avatars.json',
    APP_DATA_ROOT: '/appdata',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getPathSizeBytes
// ---------------------------------------------------------------------------

describe('getPathSizeBytes', () => {
  test('パスが存在しなければ 0 を返す', () => {
    const deps = makeDeps({ fs: { existsSync: jest.fn().mockReturnValue(false) } });
    const { getPathSizeBytes } = createStorageManager(deps);
    expect(getPathSizeBytes('/nonexistent')).toBe(0);
  });

  test('null/空文字は 0 を返す', () => {
    const deps = makeDeps();
    const { getPathSizeBytes } = createStorageManager(deps);
    expect(getPathSizeBytes(null)).toBe(0);
    expect(getPathSizeBytes('')).toBe(0);
  });

  test('ファイルはそのサイズを返す', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        lstatSync: jest.fn().mockReturnValue({
          isSymbolicLink: () => false,
          isFile: () => true,
          isDirectory: () => false,
          size: 12345,
        }),
      },
    });
    const { getPathSizeBytes } = createStorageManager(deps);
    expect(getPathSizeBytes('/some/file.txt')).toBe(12345);
  });

  test('シンボリックリンクは 0 を返す', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        lstatSync: jest.fn().mockReturnValue({
          isSymbolicLink: () => true,
          isFile: () => false,
          isDirectory: () => false,
          size: 0,
        }),
      },
    });
    const { getPathSizeBytes } = createStorageManager(deps);
    expect(getPathSizeBytes('/link')).toBe(0);
  });

  test('ディレクトリ内のファイルサイズを合計する', () => {
    // 実装内部で require('path').join を使うため OS のパス区切りに合わせる
    const p = require('path');
    const dirPath = p.join('C:', 'dir');
    const file1 = p.join(dirPath, 'file1.txt');
    const file2 = p.join(dirPath, 'file2.txt');

    const lstatResults = new Map([
      [dirPath, { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 }],
      [file1, { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 100 }],
      [file2, { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 200 }],
    ]);

    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        lstatSync: jest.fn().mockImplementation((p) => lstatResults.get(p) ?? { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => false, size: 0 }),
        readdirSync: jest.fn().mockImplementation((scanPath) => {
          if (scanPath === dirPath) return [{ name: 'file1.txt' }, { name: 'file2.txt' }];
          return [];
        }),
      },
    });
    const { getPathSizeBytes } = createStorageManager(deps);
    expect(getPathSizeBytes(dirPath)).toBe(300);
  });

  test('ディレクトリ内のシンボリックリンクはスキップされる', () => {
    const p = require('path');
    const dirPath = p.join('C:', 'dir');
    const linkPath = p.join(dirPath, 'link');
    const realPath = p.join(dirPath, 'real.txt');

    const lstatResults = new Map([
      [dirPath, { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 }],
      [linkPath, { isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false, size: 0 }],
      [realPath, { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 500 }],
    ]);
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        lstatSync: jest.fn().mockImplementation((p) => lstatResults.get(p) ?? { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => false, size: 0 }),
        readdirSync: jest.fn().mockImplementation((scanPath) => {
          if (scanPath === dirPath) return [{ name: 'link' }, { name: 'real.txt' }];
          return [];
        }),
      },
    });
    const { getPathSizeBytes } = createStorageManager(deps);
    expect(getPathSizeBytes(dirPath)).toBe(500);
  });

  test('readdirSync が例外を投げてもクラッシュしない', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        lstatSync: jest.fn().mockReturnValue({
          isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0,
        }),
        readdirSync: jest.fn().mockImplementation(() => { throw new Error('perm'); }),
      },
    });
    const { getPathSizeBytes } = createStorageManager(deps);
    expect(getPathSizeBytes('/dir')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getStorageUsageSnapshot
// ---------------------------------------------------------------------------

describe('getStorageUsageSnapshot', () => {
  test('全パスが存在しない場合は totalBytes=0、entries=[]', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(false),
        lstatSync: jest.fn(),
        readdirSync: jest.fn(),
      },
    });
    const { getStorageUsageSnapshot } = createStorageManager(deps);
    const result = getStorageUsageSnapshot();
    expect(result.ok).toBe(true);
    expect(result.totalBytes).toBe(0);
    expect(result.entries).toEqual([]);
    expect(result.drive).toBeNull();
  });

  test('ファイルがある場合 entries に含まれ totalBytes に加算される', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        lstatSync: jest.fn().mockReturnValue({
          isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 1024,
        }),
        readdirSync: jest.fn().mockReturnValue([]),
      },
    });
    const { getStorageUsageSnapshot } = createStorageManager(deps);
    const result = getStorageUsageSnapshot();
    expect(result.ok).toBe(true);
    expect(result.totalBytes).toBeGreaterThan(0);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0]).toHaveProperty('bytes');
    expect(result.entries[0]).toHaveProperty('key');
  });

  test('size=0 のエントリは entries に含まれない', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        lstatSync: jest.fn().mockReturnValue({
          isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 0,
        }),
        readdirSync: jest.fn().mockReturnValue([]),
      },
    });
    const { getStorageUsageSnapshot } = createStorageManager(deps);
    const result = getStorageUsageSnapshot();
    expect(result.totalBytes).toBe(0);
    expect(result.entries).toEqual([]);
  });

  test('statfsSync がある場合 drive 情報が付与される', () => {
    const bsize = 4096;
    const blocks = 1000;
    const bfree = 200;
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(false),
        lstatSync: jest.fn(),
        readdirSync: jest.fn(),
        statfsSync: jest.fn().mockReturnValue({ bsize, blocks, bfree }),
      },
    });
    const { getStorageUsageSnapshot } = createStorageManager(deps);
    const result = getStorageUsageSnapshot();
    expect(result.drive).not.toBeNull();
    expect(result.drive.totalBytes).toBe(bsize * blocks);
    expect(result.drive.freeBytes).toBe(bsize * bfree);
    expect(result.drive.usedBytes).toBe(bsize * (blocks - bfree));
    expect(result.drive.mountPath).toBe('/downloads');
  });

  test('statfsSync が例外を投げたら drive=null', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(false),
        lstatSync: jest.fn(),
        readdirSync: jest.fn(),
        statfsSync: jest.fn().mockImplementation(() => { throw new Error('unsupported'); }),
      },
    });
    const { getStorageUsageSnapshot } = createStorageManager(deps);
    const result = getStorageUsageSnapshot();
    expect(result.drive).toBeNull();
  });

  test('statfsSync の total=0 なら drive=null', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(false),
        lstatSync: jest.fn(),
        readdirSync: jest.fn(),
        statfsSync: jest.fn().mockReturnValue({ bsize: 0, blocks: 0, bfree: 0 }),
      },
    });
    const { getStorageUsageSnapshot } = createStorageManager(deps);
    const result = getStorageUsageSnapshot();
    expect(result.drive).toBeNull();
  });

  test('generatedAt は ISO 8601 形式の文字列', () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(false) },
    });
    const { getStorageUsageSnapshot } = createStorageManager(deps);
    const result = getStorageUsageSnapshot();
    expect(typeof result.generatedAt).toBe('string');
    expect(() => new Date(result.generatedAt)).not.toThrow();
  });

  test('appBytes は totalBytes と同じ値', () => {
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(false) },
    });
    const { getStorageUsageSnapshot } = createStorageManager(deps);
    const result = getStorageUsageSnapshot();
    expect(result.appBytes).toBe(result.totalBytes);
  });
});
