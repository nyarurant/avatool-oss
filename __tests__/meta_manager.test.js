'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { createMetaManager } = require('../lib/meta_manager');
const {
  applyVersionTracking,
  generateFilesHash,
  generateFilesStableHash,
  dedupeMetaItemsByItemId,
} = require('../lib/booth_meta_fetcher');
const { dedupeDownloadLinks } = require('../lib/utils');

// ---------------------------------------------------------------------------
// テスト用 deps ファクトリ
// ---------------------------------------------------------------------------

function makeDeps(overrides = {}) {
  const fsMock = {
    existsSync: jest.fn().mockReturnValue(false),
    readFileSync: jest.fn().mockReturnValue('[]'),
    writeFileSync: jest.fn(),
    renameSync: jest.fn(),
    readdirSync: jest.fn().mockReturnValue([]),
    statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
    mkdirSync: jest.fn(),
  };

  return {
    fs: fsMock,
    path,
    zlib: require('zlib'),
    pathToFileURL,
    META_PATH: '/test/librarymeta.json',
    AVATARS_PATH: '/test/avatars.json',
    CACHE_DIR: '/test/cache',
    AUTHOR_ICON_DIR: '/test/author_icons',
    APP_DATA_ROOT: '/test',
    LEGACY_APP_ROOT: '/legacy',
    AUTO_BOOTSTRAP_FIXED_ITEMS: [
      { itemId: '3087170', title: 'liltoon' },
      { itemId: '4915091', title: 'FaceEmo' },
    ],
    getSettings: jest.fn().mockReturnValue({ downloadPath: '/test/downloads' }),
    getMainWindow: jest.fn().mockReturnValue(null),
    getQueueSender: jest.fn().mockReturnValue(null),
    backupCorruptedJson: jest.fn(),
    generateLibraryMeta: jest.fn(),
    checkLibraryHasNewItems: jest.fn(),
    applyVersionTracking,
    generateFilesHash,
    generateFilesStableHash,
    dedupeMetaItemsByItemId,
    listUnityPackagesInDir: jest.fn().mockReturnValue([]),
    buildItemDir: jest.fn((itemId, name) => `/test/downloads/${itemId}_${name}`),
    runWithBoothCookieLoginFallback: jest.fn(),
    dbgUpdate: jest.fn(),
    dedupeDownloadLinks,
    ...overrides,
  };
}

function makeItem(itemId, fileNames, extra = {}) {
  return {
    itemId,
    itemName: `Item ${itemId}`,
    downloadLinks: fileNames.map((f, i) => ({ downloadableId: String(i + 1), fileName: f })),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// buildVersionDiffForItem
// ---------------------------------------------------------------------------

describe('buildVersionDiffForItem', () => {
  const { buildVersionDiffForItem } = createMetaManager(makeDeps());

  test('versionHistory が空なら空の diff を返す', () => {
    const result = buildVersionDiffForItem({ versionHistory: [] });
    expect(result).toEqual({ addedFiles: [], removedFiles: [] });
  });

  test('versionHistory が 1 件のみなら全ファイルが added', () => {
    const item = {
      versionHistory: [{
        downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }],
      }],
    };
    const result = buildVersionDiffForItem(item);
    expect(result.addedFiles).toContain('a.zip');
    expect(result.removedFiles).toHaveLength(0);
  });

  test('ファイルが追加された場合: addedFiles に含まれる', () => {
    const item = {
      versionHistory: [
        // history[0] が最新
        { downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }, { downloadableId: '2', fileName: 'b.zip' }] },
        { downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }] },
      ],
    };
    const result = buildVersionDiffForItem(item);
    expect(result.addedFiles).toContain('b.zip');
    expect(result.removedFiles).toHaveLength(0);
  });

  test('ファイルが削除された場合: removedFiles に含まれる', () => {
    const item = {
      versionHistory: [
        { downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }] },
        { downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }, { downloadableId: '2', fileName: 'old.zip' }] },
      ],
    };
    const result = buildVersionDiffForItem(item);
    expect(result.removedFiles).toContain('old.zip');
    expect(result.addedFiles).toHaveLength(0);
  });

  test('ファイルが入れ替わった場合: 両方に記録される', () => {
    const item = {
      versionHistory: [
        { downloadLinks: [{ downloadableId: '2', fileName: 'b.zip' }] },
        { downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }] },
      ],
    };
    const result = buildVersionDiffForItem(item);
    expect(result.addedFiles).toContain('b.zip');
    expect(result.removedFiles).toContain('a.zip');
  });

  test('null / versionHistory なしでも空を返す', () => {
    expect(buildVersionDiffForItem(null)).toEqual({ addedFiles: [], removedFiles: [] });
    expect(buildVersionDiffForItem({})).toEqual({ addedFiles: [], removedFiles: [] });
  });
});

// ---------------------------------------------------------------------------
// enrichUpdatesWithVersionDiff
// ---------------------------------------------------------------------------

describe('enrichUpdatesWithVersionDiff', () => {
  const { enrichUpdatesWithVersionDiff } = createMetaManager(makeDeps());

  test('各 update に addedFiles / removedFiles が付与される', () => {
    const items = [{
      itemId: '100',
      versionHistory: [
        { downloadLinks: [{ downloadableId: '2', fileName: 'b.zip' }] },
        { downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }] },
      ],
    }];
    const updates = [{ itemId: '100', itemName: 'Item 100' }];
    const result = enrichUpdatesWithVersionDiff(items, updates);
    expect(result[0].addedFiles).toContain('b.zip');
    expect(result[0].removedFiles).toContain('a.zip');
    expect(result[0].addedCount).toBe(1);
    expect(result[0].removedCount).toBe(1);
  });

  test('対応するアイテムがなければ diff は空', () => {
    const result = enrichUpdatesWithVersionDiff([], [{ itemId: '999', itemName: 'X' }]);
    expect(result[0].addedFiles).toEqual([]);
    expect(result[0].removedFiles).toEqual([]);
  });

  test('updates が空なら空配列を返す', () => {
    expect(enrichUpdatesWithVersionDiff([], [])).toEqual([]);
  });

  test('元の update フィールドは保持される', () => {
    const items = [{ itemId: '1', versionHistory: [] }];
    const updates = [{ itemId: '1', itemName: 'A', detectedAt: '2026-01-01' }];
    const result = enrichUpdatesWithVersionDiff(items, updates);
    expect(result[0].detectedAt).toBe('2026-01-01');
    expect(result[0].itemName).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// metaNeedsVersionBackfill
// ---------------------------------------------------------------------------

describe('metaNeedsVersionBackfill', () => {
  const { metaNeedsVersionBackfill } = createMetaManager(makeDeps());

  test('versionHistory・latestVersion・lastChecked が揃っていれば false', () => {
    const items = [{
      versionHistory: [{ detectedAt: '2026-01-01' }],
      latestVersion: { filesHash: 'abc' },
      lastChecked: '2026-01-01',
    }];
    expect(metaNeedsVersionBackfill(items)).toBe(false);
  });

  test('versionHistory がなければ true', () => {
    expect(metaNeedsVersionBackfill([{ latestVersion: { filesHash: 'abc' }, lastChecked: '2026-01-01' }])).toBe(true);
  });

  test('latestVersion.filesHash がなければ true', () => {
    expect(metaNeedsVersionBackfill([{
      versionHistory: [{}],
      latestVersion: {},
      lastChecked: '2026-01-01',
    }])).toBe(true);
  });

  test('lastChecked がなければ true', () => {
    expect(metaNeedsVersionBackfill([{
      versionHistory: [{}],
      latestVersion: { filesHash: 'abc' },
    }])).toBe(true);
  });

  test('空配列は false', () => {
    expect(metaNeedsVersionBackfill([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pickBootstrapAssets
// ---------------------------------------------------------------------------

describe('pickBootstrapAssets', () => {
  const { pickBootstrapAssets } = createMetaManager(makeDeps());

  test('AUTO_BOOTSTRAP_FIXED_ITEMS に対応するアセットを返す', () => {
    const assetMap = {
      '3087170': { itemId: '3087170', title: 'liltoon', downloaded: true, files: [] },
    };
    const result = pickBootstrapAssets(assetMap);
    expect(result.some((r) => r.itemId === '3087170')).toBe(true);
    expect(result.some((r) => r.itemId === '4915091')).toBe(true);
  });

  test('購入していない固定アイテムはプレースホルダーとして含まれる', () => {
    const result = pickBootstrapAssets({});
    expect(result).toHaveLength(2); // AUTO_BOOTSTRAP_FIXED_ITEMS の件数
    expect(result.every((r) => r.itemId)).toBe(true);
    expect(result.find((r) => r.itemId === '3087170')?.downloaded).toBe(false);
  });

  test('null / 空オブジェクトでも固定アイテム分だけ返る', () => {
    expect(pickBootstrapAssets(null)).toHaveLength(2);
    expect(pickBootstrapAssets({})).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// pickPurchasedBootstrapAssets
// ---------------------------------------------------------------------------

describe('pickPurchasedBootstrapAssets', () => {
  const { pickPurchasedBootstrapAssets } = createMetaManager(makeDeps());

  const assetMap = {
    '100': { itemId: '100', downloaded: true },
    '200': { itemId: '200', downloaded: false },
    '300': { itemId: '300', downloaded: true },
  };

  test('downloaded=true のアイテムのみ返す', () => {
    const result = pickPurchasedBootstrapAssets(assetMap);
    expect(result.map((r) => r.itemId)).toEqual(expect.arrayContaining(['100', '300']));
    expect(result.find((r) => r.itemId === '200')).toBeUndefined();
  });

  test('excludeIds に含まれるものはスキップ', () => {
    const result = pickPurchasedBootstrapAssets(assetMap, new Set(['100']));
    expect(result.find((r) => r.itemId === '100')).toBeUndefined();
    expect(result.find((r) => r.itemId === '300')).toBeDefined();
  });

  test('空 assetMap は空配列', () => {
    expect(pickPurchasedBootstrapAssets({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyVersionTrackingKeepingManual
// ---------------------------------------------------------------------------

describe('applyVersionTrackingKeepingManual', () => {
  const { applyVersionTrackingKeepingManual } = createMetaManager(makeDeps());
  const AT = '2026-01-01T00:00:00.000Z';

  test('通常アイテムのバージョン追跡が動作する', () => {
    const existing = [];
    const latest = [makeItem('100', ['a.zip'])];
    const { items } = applyVersionTrackingKeepingManual(existing, latest, AT);
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe('100');
    expect(items[0].hasUpdate).toBe(false);
  });

  test('manualAdded=true のアイテムは latestMeta になくても保持される', () => {
    const manualItem = { ...makeItem('999', ['manual.zip']), manualAdded: true };
    const existing = [manualItem];
    const latest = [makeItem('100', ['a.zip'])]; // manualItem は含まれない
    const { items } = applyVersionTrackingKeepingManual(existing, latest, AT);
    expect(items.find((i) => i.itemId === '999')).toBeDefined();
    expect(items.find((i) => i.itemId === '100')).toBeDefined();
  });

  test('manualAdded でないアイテムが latestMeta から消えた場合は削除される', () => {
    const AT2 = '2026-02-01T00:00:00.000Z';
    // 初回: アイテム 100 を登録
    const v1 = applyVersionTrackingKeepingManual([], [makeItem('100', ['a.zip'])], AT).items;
    // 2回目: アイテム 100 が latestMeta から消えた
    const { items } = applyVersionTrackingKeepingManual(v1, [], AT2);
    expect(items.find((i) => i.itemId === '100')).toBeUndefined();
  });

  test('既存 manualItem が latestMeta にも存在する場合は latestMeta 側が優先', () => {
    const manualItem = { ...makeItem('100', ['old.zip']), manualAdded: true };
    const existing = [manualItem];
    const latest = [makeItem('100', ['new.zip'])];
    const { items } = applyVersionTrackingKeepingManual(existing, latest, AT);
    // latestMeta に存在するので重複追加はされない
    expect(items.filter((i) => i.itemId === '100')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// createManualFreeMetaItem
// ---------------------------------------------------------------------------

describe('createManualFreeMetaItem', () => {
  const { createManualFreeMetaItem } = createMetaManager(makeDeps());

  const links = [{ downloadableId: '1', fileName: 'free.zip' }];

  test('正常なアイテムを生成する', () => {
    const result = createManualFreeMetaItem('12345', { name: 'Test Item' }, links);
    expect(result.itemId).toBe('12345');
    expect(result.itemName).toBe('Test Item');
    expect(result.manualAdded).toBe(true);
    expect(result.hasUpdate).toBe(false);
    expect(result.downloadLinks).toHaveLength(1);
  });

  test('versionHistory が1件生成される', () => {
    const result = createManualFreeMetaItem('12345', { name: 'X' }, links);
    expect(result.versionHistory).toHaveLength(1);
    expect(result.versionHistory[0].filesHash).toBeTruthy();
    expect(result.versionHistory[0].filesHashStable).toBeTruthy();
  });

  test('latestVersion が設定される', () => {
    const result = createManualFreeMetaItem('12345', { name: 'X' }, links);
    expect(result.latestVersion?.filesHash).toBeTruthy();
    expect(result.latestVersion?.filesHashStable).toBeTruthy();
  });

  test('shop 情報が取得される', () => {
    const itemJson = {
      name: 'Item',
      shop: { name: 'AuthorShop', url: 'https://booth.pm/author', thumbnail_url: 'https://example.com/icon.png' },
    };
    const result = createManualFreeMetaItem('1', itemJson, links);
    expect(result.authorName).toBe('AuthorShop');
    expect(result.authorShopUrl).toBe('https://booth.pm/author');
  });

  test('category 情報が取得される', () => {
    const itemJson = {
      name: 'Item',
      category: {
        name: '3Dキャラクター',
        url: 'https://booth.pm/ja/browse/3D%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC',
        parent: { name: '3Dモデル', url: 'https://booth.pm/ja/browse/3D%E3%83%A2%E3%83%87%E3%83%AB' },
      },
    };
    const result = createManualFreeMetaItem('1', itemJson, links);
    expect(result.categories).toHaveLength(2);
    expect(result.primaryCategory?.text).toBe('3Dキャラクター');
  });

  test('itemJson が null でもデフォルト値で生成される', () => {
    const result = createManualFreeMetaItem('99999', null, links);
    expect(result.itemId).toBe('99999');
    expect(result.itemName).toContain('99999');
    expect(result.authorName).toBe('Unknown');
  });

  test('downloadLinks が空でも生成される', () => {
    const result = createManualFreeMetaItem('1', { name: 'X' }, []);
    expect(result.downloadLinks).toEqual([]);
    expect(result.versionHistory[0].filesHash).toBeTruthy(); // 空ハッシュ
  });
});

// ---------------------------------------------------------------------------
// toAssetMap
// ---------------------------------------------------------------------------

describe('toAssetMap', () => {
  test('meta アイテムが assetMap に変換される', () => {
    const deps = makeDeps();
    const { toAssetMap } = createMetaManager(deps);

    const data = [{
      itemId: '100',
      itemName: 'Test Item',
      authorName: 'Author',
      downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }],
      supportedAvatarAnalysis: {
        primaryAvatar: 'Sio',
        status: 'confirmed',
        candidates: [{ name: 'Sio', score: 6, reasons: ['pkg-file-match'] }],
      },
      avatarAnalysisCheckedAt: '2026-06-06T00:00:00.000Z',
      supportedAvatars: ['ここな'],
      isGift: false,
    }];

    const map = toAssetMap(data);
    expect(map['100']).toBeDefined();
    expect(map['100'].title).toBe('Test Item');
    expect(map['100'].author).toBe('Author');
    expect(map['100'].files).toHaveLength(1);
    expect(map['100'].supportedAvatarAnalysis.status).toBe('confirmed');
    expect(map['100'].supportedAvatarAnalysis.primaryAvatar).toBe('Sio');
    expect(map['100'].avatarAnalysisCheckedAt).toBe('2026-06-06T00:00:00.000Z');
    expect(map['100'].supportedAvatars).toContain('ここな');
  });

  test('downloaded が false のアイテムは downloaded=false', () => {
    const deps = makeDeps();
    deps.fs.existsSync.mockReturnValue(false);
    const { toAssetMap } = createMetaManager(deps);

    const map = toAssetMap([{ itemId: '1', itemName: 'X', downloadLinks: [] }]);
    expect(map['1'].downloaded).toBe(false);
  });

  test('extracted flag がある場合は downloaded=true', () => {
    const deps = makeDeps();
    deps.fs.existsSync.mockImplementation((p) => String(p || '').includes('__extracted.flag'));
    const { toAssetMap } = createMetaManager(deps);

    const map = toAssetMap([{ itemId: '1', itemName: 'X', downloadLinks: [] }]);
    expect(map['1'].downloaded).toBe(true);
  });

  test('http(s):// で始まる authorIcon はそのまま使われる', () => {
    const deps = makeDeps();
    const { toAssetMap } = createMetaManager(deps);

    const map = toAssetMap([{
      itemId: '1',
      itemName: 'X',
      downloadLinks: [],
      authorIconUrl: 'https://example.com/icon.png',
    }]);
    expect(map['1'].authorIcon).toBe('https://example.com/icon.png');
  });

  test('空配列は空オブジェクトを返す', () => {
    const { toAssetMap } = createMetaManager(makeDeps());
    expect(toAssetMap([])).toEqual({});
  });

  test('hasUpdate / isGift / isAvatarItem がマッピングされる', () => {
    const { toAssetMap } = createMetaManager(makeDeps());
    const map = toAssetMap([{
      itemId: '1',
      itemName: 'X',
      downloadLinks: [],
      hasUpdate: true,
      isGift: true,
      isAvatarItem: true,
    }]);
    expect(map['1'].hasUpdate).toBe(true);
    expect(map['1'].isGift).toBe(true);
    expect(map['1'].isAvatarItem).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeAndPersistMeta
// ---------------------------------------------------------------------------

describe('normalizeAndPersistMeta', () => {
  test('重複 itemId は dedupe される', () => {
    const deps = makeDeps();
    const { normalizeAndPersistMeta } = createMetaManager(deps);

    const items = [
      { itemId: '100', itemName: 'A', downloadLinks: [] },
      { itemId: '100', itemName: 'A dup', downloadLinks: [] },
      { itemId: '200', itemName: 'B', downloadLinks: [] },
    ];
    const result = normalizeAndPersistMeta(items);
    expect(result).toHaveLength(2);
  });

  test('dedupe 発生時は writeMetaFile が呼ばれる', () => {
    const deps = makeDeps();
    const { normalizeAndPersistMeta } = createMetaManager(deps);

    normalizeAndPersistMeta([
      { itemId: '1', itemName: 'A', downloadLinks: [] },
      { itemId: '1', itemName: 'A dup', downloadLinks: [] },
    ]);
    expect(deps.fs.writeFileSync).toHaveBeenCalled();
  });

  test('dedupe 不要なら writeMetaFile は呼ばれない', () => {
    const deps = makeDeps();
    const { normalizeAndPersistMeta } = createMetaManager(deps);

    normalizeAndPersistMeta([
      { itemId: '1', itemName: 'A', downloadLinks: [] },
      { itemId: '2', itemName: 'B', downloadLinks: [] },
    ]);
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('空配列は空配列を返す', () => {
    const { normalizeAndPersistMeta } = createMetaManager(makeDeps());
    expect(normalizeAndPersistMeta([])).toEqual([]);
  });
});
