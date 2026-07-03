'use strict';

const path = require('path');
const { createAutoBootstrapService } = require('../lib/autobootstrap_service');

function makeDeps(overrides = {}) {
  return {
    path,
    fs: { existsSync: jest.fn().mockReturnValue(false), statSync: jest.fn() },
    getSettings: jest.fn().mockReturnValue({ autoBootstrapEnabled: false }),
    normalizeProjectPath: jest.fn().mockImplementation((p) => p?.toLowerCase() || ''),
    dbgUpdate: jest.fn(),
    emitAutoBootstrapStatus: jest.fn(),
    runWithBoothCookieLoginFallback: null,
    installSimpleFolderIconAsPackage: jest.fn().mockReturnValue({ ok: true }),
    writeSimpleFolderIcons: jest.fn().mockResolvedValue({}),
    fillPackageMetaByScan: jest.fn().mockImplementation(async (rows) => rows),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseVersionPartsFromName (_test)
// ---------------------------------------------------------------------------

describe('parseVersionPartsFromName', () => {
  const { _test: { parseVersionPartsFromName } } = createAutoBootstrapService(makeDeps());

  test('x.y.z 形式を配列に変換する', () => {
    expect(parseVersionPartsFromName('avatar_v1.2.3.unitypackage')).toEqual([1, 2, 3]);
  });

  test('v プレフィックスを無視する', () => {
    expect(parseVersionPartsFromName('avatar_v2.0.1.unitypackage')).toEqual([2, 0, 1]);
  });

  test('バージョンがなければ空配列', () => {
    expect(parseVersionPartsFromName('avatar_costume.unitypackage')).toEqual([]);
    expect(parseVersionPartsFromName('')).toEqual([]);
    expect(parseVersionPartsFromName(null)).toEqual([]);
  });

  test('x.y 形式 (2パート) も抽出する', () => {
    expect(parseVersionPartsFromName('pack_2.0_update.unitypackage')).toEqual([2, 0]);
  });
});

// ---------------------------------------------------------------------------
// compareVersionParts (_test)
// ---------------------------------------------------------------------------

describe('compareVersionParts', () => {
  const { _test: { compareVersionParts } } = createAutoBootstrapService(makeDeps());

  test('同一バージョンは 0', () => {
    expect(compareVersionParts([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  test('左が大きければ正数', () => {
    expect(compareVersionParts([2, 0, 0], [1, 9, 9])).toBeGreaterThan(0);
    expect(compareVersionParts([1, 2, 4], [1, 2, 3])).toBeGreaterThan(0);
  });

  test('左が小さければ負数', () => {
    expect(compareVersionParts([1, 0, 0], [1, 0, 1])).toBeLessThan(0);
  });

  test('長さが異なる場合は不足を 0 として比較', () => {
    expect(compareVersionParts([1, 0], [1, 0, 0])).toBe(0);
    expect(compareVersionParts([1, 1], [1, 0, 9])).toBeGreaterThan(0);
  });

  test('空配列同士は 0', () => {
    expect(compareVersionParts([], [])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// normalizePackageIdentityFromName (_test)
// ---------------------------------------------------------------------------

describe('normalizePackageIdentityFromName', () => {
  const { _test: { normalizePackageIdentityFromName } } = createAutoBootstrapService(makeDeps());

  test('バージョン部分を除去した identity を返す', () => {
    const a = normalizePackageIdentityFromName('avatar_v1.2.3.unitypackage');
    const b = normalizePackageIdentityFromName('avatar_v2.0.0.unitypackage');
    expect(a).toBe(b);
  });

  test('null / 空文字は空文字を返す', () => {
    expect(normalizePackageIdentityFromName('')).toBe('');
    expect(normalizePackageIdentityFromName(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// dedupePackageRowsPreferNewest (_test)
// ---------------------------------------------------------------------------

describe('dedupePackageRowsPreferNewest', () => {
  const { _test: { dedupePackageRowsPreferNewest } } = createAutoBootstrapService(makeDeps());

  function makeRow(itemId, pkgName, mtimeMs = 0) {
    return {
      itemId,
      packagePath: path.join('/downloads', itemId, pkgName),
      mtimeMs,
    };
  }

  test('同一アイテム・同一 identity は 1 件に絞られる', () => {
    const rows = [
      makeRow('1', 'avatar_v1.0.0.unitypackage'),
      makeRow('1', 'avatar_v1.0.0.unitypackage'),
    ];
    expect(dedupePackageRowsPreferNewest(rows)).toHaveLength(1);
  });

  test('バージョンが高い方が優先される', () => {
    const rows = [
      makeRow('1', 'avatar_v1.0.0.unitypackage'),
      makeRow('1', 'avatar_v2.0.0.unitypackage'),
    ];
    const result = dedupePackageRowsPreferNewest(rows);
    expect(result).toHaveLength(1);
    expect(result[0].packagePath).toContain('v2.0.0');
  });

  test('バージョン同一ならタイムスタンプが新しい方が優先', () => {
    const rows = [
      makeRow('1', 'avatar_v1.0.0.unitypackage', 100),
      makeRow('1', 'avatar_v1.0.0.unitypackage', 200),
    ];
    const result = dedupePackageRowsPreferNewest(rows);
    expect(result).toHaveLength(1);
    expect(result[0].mtimeMs).toBe(200);
  });

  test('異なるアイテムは別件として残る', () => {
    const rows = [
      makeRow('1', 'avatar.unitypackage'),
      makeRow('2', 'avatar.unitypackage'),
    ];
    expect(dedupePackageRowsPreferNewest(rows)).toHaveLength(2);
  });

  test('空配列は空配列を返す', () => {
    expect(dedupePackageRowsPreferNewest([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectAutoBootstrapPackageRows (_test)
// ---------------------------------------------------------------------------

describe('selectAutoBootstrapPackageRows', () => {
  const { _test: { selectAutoBootstrapPackageRows } } = createAutoBootstrapService(makeDeps());

  test('配列をそのまま返す（現在フィルタなし）', () => {
    const rows = [{ itemId: '1' }, { itemId: '2' }];
    expect(selectAutoBootstrapPackageRows(rows)).toEqual(rows);
  });

  test('空配列は空配列を返す', () => {
    expect(selectAutoBootstrapPackageRows([])).toEqual([]);
  });

  test('null / 非配列は空配列を返す', () => {
    expect(selectAutoBootstrapPackageRows(null)).toEqual([]);
    expect(selectAutoBootstrapPackageRows('bad')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseAutoBootstrapChoiceKey (public)
// ---------------------------------------------------------------------------

describe('parseAutoBootstrapChoiceKey', () => {
  const { parseAutoBootstrapChoiceKey } = createAutoBootstrapService(makeDeps());

  test('空文字は空オブジェクトを返す', () => {
    expect(parseAutoBootstrapChoiceKey('')).toEqual({ type: '', itemId: '', relPath: '' });
    expect(parseAutoBootstrapChoiceKey(null)).toEqual({ type: '', itemId: '', relPath: '' });
  });

  test('item: プレフィックスで type=item', () => {
    const result = parseAutoBootstrapChoiceKey('item:12345');
    expect(result.type).toBe('item');
    expect(result.itemId).toBe('12345');
    expect(result.relPath).toBe('');
  });

  test('file: プレフィックスで type=file / itemId / relPath を分解', () => {
    const relPath = 'sub/avatar.unitypackage';
    const key = `file:99999:${encodeURIComponent(relPath)}`;
    const result = parseAutoBootstrapChoiceKey(key);
    expect(result.type).toBe('file');
    expect(result.itemId).toBe('99999');
    expect(result.relPath).toBe(relPath);
  });

  test('file: でセパレータなしは空を返す', () => {
    const result = parseAutoBootstrapChoiceKey('file:badformat');
    expect(result.type).toBe('');
  });

  test('不明なプレフィックスは空を返す', () => {
    expect(parseAutoBootstrapChoiceKey('unknown:value')).toEqual({ type: '', itemId: '', relPath: '' });
  });
});

// ---------------------------------------------------------------------------
// runAutoBootstrapForProject — early exit paths
// ---------------------------------------------------------------------------

describe('runAutoBootstrapForProject — early exit', () => {
  test('空プロジェクトパスは project_not_found を返す', async () => {
    const svc = createAutoBootstrapService(makeDeps());
    const result = await svc.runAutoBootstrapForProject('');
    expect(result.error).toBe('project_not_found');
  });

  test('autoBootstrapEnabled=false は skipped を返す', async () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ autoBootstrapEnabled: false }),
      fs: { existsSync: jest.fn().mockReturnValue(true) },
      validateUnityEditorPathSetting: jest.fn().mockReturnValue({ ok: true }),
      isUnityProjectLocked: jest.fn().mockReturnValue(false),
      loadAutoBootstrapHistory: jest.fn().mockReturnValue({}),
    });
    const svc = createAutoBootstrapService(deps);
    const result = await svc.runAutoBootstrapForProject('/project/myproj');
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('disabled');
  });

  test('同一プロジェクトが実行中なら already_running を返す', async () => {
    // ensureClientReady を制御可能な Promise で止め、first が await 中に second を実行させる
    let releaseFirst;
    const holdPromise = new Promise((resolve) => { releaseFirst = resolve; });

    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({
        autoBootstrapEnabled: true,
        autoBootstrapIncludeMA: false, // ensureModularAvatarDependency をスキップ
      }),
      fs: { existsSync: jest.fn().mockReturnValue(true), statSync: jest.fn().mockReturnValue({ mtimeMs: 0 }) },
      validateUnityEditorPathSetting: jest.fn().mockReturnValue({ ok: true }),
      isUnityProjectLocked: jest.fn().mockReturnValue(false),
      loadAutoBootstrapHistory: jest.fn().mockReturnValue({}),
      getMetaAssetMapFast: jest.fn().mockReturnValue({}),
      pickBootstrapAssets: jest.fn().mockReturnValue([{ itemId: '1', title: 'Test', downloaded: true }]),
      pickPurchasedBootstrapAssets: jest.fn().mockReturnValue([]),
      normalizeAutoBootstrapProjectImportRules: jest.fn().mockReturnValue([]),
      isFolderIconBootstrapEnabled: jest.fn().mockReturnValue(false),
      formatElapsedMs: jest.fn().mockReturnValue('0ms'),
      saveAutoBootstrapHistory: jest.fn(),
      emitAutoBootstrapStatus: jest.fn(),
      dbgUpdate: jest.fn(),
      // targets があると ensureClientReady が await される → ここで first を止める
      ensureClientReady: jest.fn().mockReturnValue(holdPromise),
      fetchFreeDownloadLinksForItem: jest.fn().mockResolvedValue([]),
      dedupeDownloadLinks: jest.fn().mockReturnValue([]),
      buildItemDir: jest.fn().mockReturnValue('/downloads/1_Test'),
      listUnityPackagesInDir: jest.fn().mockReturnValue([]),
      listSourceImportRootsInDir: jest.fn().mockReturnValue([]),
      listVpmPackageRootsInDir: jest.fn().mockReturnValue([]),
    });
    const svc = createAutoBootstrapService(deps);
    // 1回目: ensureClientReady で await 中になる
    const first = svc.runAutoBootstrapForProject('/project/myproj');
    // 2回目: running set に登録済みなので already_running を即返す
    const second = await svc.runAutoBootstrapForProject('/project/myproj');
    expect(second.error).toBe('already_running');
    // cleanup: first を終わらせる
    releaseFirst();
    await first.catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// runStartupBootstrapDownloads — queue race guard
// ---------------------------------------------------------------------------
// Regression: startup/project auto-bootstrap calls downloadItemFiles() directly,
// bypassing the download queue's enqueue-downloads dedup check entirely. A
// manual "download this item" click for the same itemId while auto-bootstrap
// is mid-download raced unsynchronized writes to the same item directory.
describe('runStartupBootstrapDownloads — queue race guard', () => {
  function makeStartupDeps(overrides = {}) {
    return makeDeps({
      getSettings: jest.fn().mockReturnValue({ autoBootstrapEnabled: true, autoExtract: false }),
      getMetaAssetMapFast: jest.fn().mockReturnValue({}),
      pickBootstrapAssets: jest.fn().mockReturnValue([{ itemId: '3087170', title: 'liltoon', downloaded: false, files: [] }]),
      ensureClientReady: jest.fn().mockResolvedValue(undefined),
      fetchFreeDownloadLinksForItem: jest.fn().mockResolvedValue([{ downloadableId: '1', fileName: 'a.zip' }]),
      dedupeDownloadLinks: jest.fn((x) => x),
      downloadItemFiles: jest.fn().mockResolvedValue(undefined),
      getBoothClient: jest.fn(),
      getBoothCookies: jest.fn(),
      buildItemDir: jest.fn().mockReturnValue('/downloads/3087170_liltoon'),
      extractArchivesInItemDir: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    });
  }

  test('キューで既に running 中の itemId はダウンロードをスキップする', async () => {
    const queueState = { running: new Map([['3087170', { itemId: '3087170', title: 'liltoon' }]]), queued: [] };
    const deps = makeStartupDeps({ getQueueState: () => queueState });
    const svc = createAutoBootstrapService(deps);
    const result = await svc.runStartupBootstrapDownloads();
    expect(deps.downloadItemFiles).not.toHaveBeenCalled();
    expect(result.downloaded).toBe(0);
  });

  test('キューで既に queued 中の itemId もダウンロードをスキップする', async () => {
    const queueState = { running: new Map(), queued: [{ itemId: '3087170' }] };
    const deps = makeStartupDeps({ getQueueState: () => queueState });
    const svc = createAutoBootstrapService(deps);
    await svc.runStartupBootstrapDownloads();
    expect(deps.downloadItemFiles).not.toHaveBeenCalled();
  });

  test('ダウンロード完了後は running スロットを解放する', async () => {
    const queueState = { running: new Map(), queued: [] };
    const deps = makeStartupDeps({ getQueueState: () => queueState });
    const svc = createAutoBootstrapService(deps);
    const result = await svc.runStartupBootstrapDownloads();
    expect(deps.downloadItemFiles).toHaveBeenCalledTimes(1);
    expect(result.downloaded).toBe(1);
    expect(queueState.running.has('3087170')).toBe(false);
  });

  test('ダウンロード失敗時も running スロットを解放する', async () => {
    const queueState = { running: new Map(), queued: [] };
    const deps = makeStartupDeps({
      getQueueState: () => queueState,
      downloadItemFiles: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const svc = createAutoBootstrapService(deps);
    const result = await svc.runStartupBootstrapDownloads();
    expect(result.error).toBe('boom');
    expect(queueState.running.has('3087170')).toBe(false);
  });

  test('getQueueState が未提供でも従来通り動作する', async () => {
    const deps = makeStartupDeps();
    const svc = createAutoBootstrapService(deps);
    const result = await svc.runStartupBootstrapDownloads();
    expect(deps.downloadItemFiles).toHaveBeenCalledTimes(1);
    expect(result.downloaded).toBe(1);
  });
});

describe('runAutoBootstrapForProject — project import rules', () => {
  test('同じ projectPattern に一致する複数 choiceKey をすべて対象にする', async () => {
    const buildItemDir = jest.fn((itemId) => `/downloads/${itemId}`);
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({
        autoBootstrapEnabled: true,
        autoBootstrapIncludeMA: false,
        autoBootstrapIncludeLiltoon: false,
        autoBootstrapIncludeFaceEmo: false,
        autoBootstrapIncludeAvatoolScripts: false,
        autoBootstrapProjectImportRules: [
          { projectPattern: 'rurune', choiceKey: 'item:10' },
          { projectPattern: 'rurune', choiceKey: 'item:20' },
        ],
      }),
      fs: { existsSync: jest.fn().mockReturnValue(true), statSync: jest.fn().mockReturnValue({ mtimeMs: 0 }) },
      validateUnityEditorPathSetting: jest.fn().mockReturnValue({ ok: true }),
      isUnityProjectLocked: jest.fn().mockReturnValue(false),
      loadAutoBootstrapHistory: jest.fn().mockReturnValue({}),
      saveAutoBootstrapHistory: jest.fn(),
      normalizeAutoBootstrapProjectImportRules: jest.fn((rules) => rules),
      parseAutoBootstrapChoiceKey: jest.fn((key) => {
        const itemId = String(key || '').replace(/^item:/, '');
        return { type: 'item', itemId, relPath: '' };
      }),
      isFolderIconBootstrapEnabled: jest.fn().mockReturnValue(false),
      getMetaAssetMapFast: jest.fn().mockReturnValue({
        10: { itemId: '10', title: 'A', downloaded: true },
        20: { itemId: '20', title: 'B', downloaded: true },
      }),
      pickBootstrapAssets: jest.fn().mockReturnValue([]),
      pickPurchasedBootstrapAssets: jest.fn().mockReturnValue([
        { itemId: '10', title: 'A', downloaded: true },
        { itemId: '20', title: 'B', downloaded: true },
      ]),
      ensureClientReady: jest.fn().mockResolvedValue(undefined),
      buildItemDir,
      listUnityPackagesInDir: jest.fn().mockReturnValue([]),
      listSourceImportRootsInDir: jest.fn().mockReturnValue([]),
      listVpmPackageRootsInDir: jest.fn().mockReturnValue([]),
      formatElapsedMs: jest.fn().mockReturnValue('0ms'),
    });
    const svc = createAutoBootstrapService(deps);
    const result = await svc.runAutoBootstrapForProject('/projects/rurune-avatar');
    expect(result.error).toBe('no_importable_found');
    expect(buildItemDir).toHaveBeenCalledWith('10', 'A');
    expect(buildItemDir).toHaveBeenCalledWith('20', 'B');
  });
});
