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

describe('getKnownPurchasedItemIds', () => {
  test('ほしいリスト専用アイテムは購入済み既知IDから除外する', () => {
    const { getKnownPurchasedItemIds, isWishlistOnlyMetaItem } = createMetaManager(makeDeps());
    const rows = [
      { itemId: '100', downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }] },
      { itemId: '200', isWishlisted: true, downloadLinks: [] },
      { itemId: '300', isWishlisted: true, downloadLinks: [{ downloadableId: '2', fileName: 'b.zip' }] },
    ];
    expect(isWishlistOnlyMetaItem(rows[1])).toBe(true);
    expect(getKnownPurchasedItemIds(rows)).toEqual(['100', '300']);
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

  test('manualAdded でないアイテムが latestMeta から消えても通常アイテムとして保持される', () => {
    const AT2 = '2026-02-01T00:00:00.000Z';
    // 初回: アイテム 100 を登録
    const v1 = applyVersionTrackingKeepingManual([], [makeItem('100', ['a.zip'])], AT).items;
    // 2回目: アイテム 100 が latestMeta から消えた
    const { items } = applyVersionTrackingKeepingManual(v1, [], AT2);
    const kept = items.find((i) => i.itemId === '100');
    expect(kept).toBeDefined();
    expect(kept.isRemoved).toBeFalsy();
    expect(kept.removedAt).toBeUndefined();
  });

  test('isRemoved アイテムが latestMeta に再登場した場合は isRemoved フラグが解除される', () => {
    const AT3 = '2026-03-01T00:00:00.000Z';
    const existing = [{ ...makeItem('100', ['a.zip']), isRemoved: true, removedAt: '2026-02-01T00:00:00.000Z' }];
    // 再登場
    const { items } = applyVersionTrackingKeepingManual(existing, [makeItem('100', ['a.zip'])], AT3);
    const reappeared = items.find((i) => i.itemId === '100');
    expect(reappeared).toBeDefined();
    expect(reappeared.isRemoved).toBeFalsy();
  });

  test('既存 manualItem が latestMeta にも存在する場合は latestMeta 側が優先', () => {
    const manualItem = { ...makeItem('100', ['old.zip']), manualAdded: true };
    const existing = [manualItem];
    const latest = [makeItem('100', ['new.zip'])];
    const { items } = applyVersionTrackingKeepingManual(existing, latest, AT);
    // latestMeta に存在するので重複追加はされない
    expect(items.filter((i) => i.itemId === '100')).toHaveLength(1);
  });

  test('isWishlisted=true のアイテムは latestMeta から消えても保持される', () => {
    const wishlistItem = {
      ...makeItem('999', []),
      isWishlisted: true,
      wishlistAddedAt: AT,
    };
    const existing = [wishlistItem];
    const latest = [makeItem('100', ['a.zip'])]; // wishlistItem は含まれない
    const { items } = applyVersionTrackingKeepingManual(existing, latest, AT);
    const kept = items.find((i) => i.itemId === '999');
    expect(kept).toBeDefined();
    expect(kept.isWishlisted).toBe(true);
    expect(kept.isRemoved).toBeFalsy();
  });

  test('isWishlisted アイテムを同じ meta で補完しても wishlist 状態は維持される', () => {
    const wishlistItem = {
      ...makeItem('999', []),
      isWishlisted: true,
      wishlistAddedAt: AT,
    };
    const { items } = applyVersionTrackingKeepingManual([wishlistItem], [wishlistItem], AT);
    const kept = items.find((i) => i.itemId === '999');
    expect(kept).toBeDefined();
    expect(kept.isWishlisted).toBe(true);
    expect(kept.wishlistAddedAt).toBe(AT);
  });

  test('isWishlisted アイテムが latestMeta に登場した場合は通常アイテムに昇格する', () => {
    const wishlistItem = {
      ...makeItem('999', []),
      isWishlisted: true,
      wishlistAddedAt: AT,
    };
    const existing = [wishlistItem];
    const latest = [makeItem('999', ['purchased.zip'])];
    const { items } = applyVersionTrackingKeepingManual(existing, latest, AT);
    const upgraded = items.find((i) => i.itemId === '999');
    expect(upgraded).toBeDefined();
    expect(upgraded.downloadLinks).toHaveLength(1);
    expect(upgraded.isWishlisted).toBe(false);
    expect(upgraded.wishlistAddedAt).toBeUndefined();
    expect(upgraded.isRemoved).toBeFalsy();
  });

  test('isWishlisted アイテムが購入済みで再登場した場合は削除済み扱いにもならない', () => {
    const wishlistItem = {
      ...makeItem('999', []),
      isWishlisted: true,
      wishlistAddedAt: AT,
      isRemoved: true,
      removedAt: AT,
    };
    const existing = [wishlistItem];
    const latest = [makeItem('999', ['purchased.zip'])];
    const { items } = applyVersionTrackingKeepingManual(existing, latest, AT);
    const upgraded = items.find((i) => i.itemId === '999');
    expect(upgraded).toBeDefined();
    expect(upgraded.downloadLinks).toHaveLength(1);
    expect(upgraded.isWishlisted).toBe(false);
    expect(upgraded.wishlistAddedAt).toBeUndefined();
    expect(upgraded.isRemoved).toBe(false);
    expect(upgraded.removedAt).toBeUndefined();
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
// createWishlistMetaItem
// ---------------------------------------------------------------------------

describe('createWishlistMetaItem', () => {
  const { createWishlistMetaItem } = createMetaManager(makeDeps());

  test('基本フィールドが正しく設定される', () => {
    const result = createWishlistMetaItem('9999', { name: 'My Outfit' });
    expect(result.itemId).toBe('9999');
    expect(result.itemName).toBe('My Outfit');
    expect(result.isWishlisted).toBe(true);
    expect(result.wishlistAddedAt).toBeTruthy();
    expect(result.downloadLinks).toEqual([]);
  });

  test('itemJson が null でもクラッシュしない', () => {
    const result = createWishlistMetaItem('1', null);
    expect(result.itemId).toBe('1');
    expect(result.itemName).toMatch(/Wishlist Item/);
    expect(result.isWishlisted).toBe(true);
  });

  test('shop 情報が authorName にマッピングされる', () => {
    const result = createWishlistMetaItem('1', {
      name: 'Hat',
      shop: { name: 'ShopA', url: 'https://booth.pm/ja/shop/shopA', thumbnail_url: '' },
    });
    expect(result.authorName).toBe('ShopA');
    expect(result.authorShopUrl).toBe('https://booth.pm/ja/shop/shopA');
  });

  test('category 情報が categories にマッピングされる', () => {
    const result = createWishlistMetaItem('1', {
      name: 'X',
      category: {
        url: 'https://booth.pm/ja/browse/Tops',
        name: 'トップス',
        parent: { url: 'https://booth.pm/ja/browse/Clothes', name: '衣装' },
      },
    });
    expect(result.categories).toHaveLength(2);
    expect(result.categories[0].text).toBe('衣装');
    expect(result.categories[1].text).toBe('トップス');
    expect(result.primaryCategory?.text).toBe('トップス');
  });

  test('manualAdded は設定されない', () => {
    const result = createWishlistMetaItem('1', {});
    expect(result.manualAdded).toBeUndefined();
  });

  test('複数バリエーションの価格レンジを保持する', () => {
    const result = createWishlistMetaItem('1', {
      name: 'X',
      variations: [
        { name: 'Avatar A', price: 1200 },
        { name: 'Avatar B', price: 1800 },
        { name: 'Avatar C', price: 2400 },
      ],
    });
    expect(result.price).toBe(1200);
    expect(result.priceMin).toBe(1200);
    expect(result.priceMax).toBe(2400);
    expect(result.priceVariationCount).toBe(3);
    expect(result.priceVariations).toEqual([
      { name: 'Avatar A', price: 1200 },
      { name: 'Avatar B', price: 1800 },
      { name: 'Avatar C', price: 2400 },
    ]);
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
      authorId: 'author-1',
      authorShopUrl: 'https://author.booth.pm/',
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
    expect(map['100'].authorId).toBe('author-1');
    expect(map['100'].authorShopUrl).toBe('https://author.booth.pm/');
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

  test('userTags / userNote がマッピングされる', () => {
    const { toAssetMap } = createMetaManager(makeDeps());
    const map = toAssetMap([{
      itemId: '1',
      itemName: 'X',
      downloadLinks: [],
      userTags: ['しなの', '衣装'],
      userNote: 'メモです',
    }]);
    expect(map['1'].userTags).toEqual(['しなの', '衣装']);
    expect(map['1'].userNote).toBe('メモです');
  });

  test('userTags / userNote が未設定の場合はデフォルト値になる', () => {
    const { toAssetMap } = createMetaManager(makeDeps());
    const map = toAssetMap([{ itemId: '1', itemName: 'X', downloadLinks: [] }]);
    expect(map['1'].userTags).toEqual([]);
    expect(map['1'].userNote).toBe('');
  });

  test('isWishlisted / isRemoved がマッピングされる', () => {
    const { toAssetMap } = createMetaManager(makeDeps());
    const map = toAssetMap([
      { itemId: '1', itemName: 'W', downloadLinks: [], isWishlisted: true, wishlistAddedAt: '2026-01-01T00:00:00.000Z', price: 1200, priceMin: 1200, priceMax: 2400, priceVariationCount: 3, priceVariations: [{ name: 'Avatar A', price: 1200 }, { name: 'おやつ代', price: 2400 }], lastPriceCheckedAt: 1700000000000 },
      { itemId: '2', itemName: 'R', downloadLinks: [], isRemoved: true, removedAt: '2026-02-01T00:00:00.000Z' },
    ]);
    expect(map['1'].isWishlisted).toBe(true);
    expect(map['1'].wishlistAddedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(map['1'].price).toBe(1200);
    expect(map['1'].priceMin).toBe(1200);
    expect(map['1'].priceMax).toBe(2400);
    expect(map['1'].priceVariationCount).toBe(3);
    expect(map['1'].priceVariations).toEqual([{ name: 'Avatar A', price: 1200 }, { name: 'おやつ代', price: 2400 }]);
    expect(map['1'].lastPriceCheckedAt).toBe(1700000000000);
    expect(map['2'].isRemoved).toBe(true);
    expect(map['2'].removedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  test('isWishlisted / isRemoved が未設定の場合は false / null になる', () => {
    const { toAssetMap } = createMetaManager(makeDeps());
    const map = toAssetMap([{ itemId: '1', itemName: 'X', downloadLinks: [] }]);
    expect(map['1'].isWishlisted).toBe(false);
    expect(map['1'].wishlistAddedAt).toBeNull();
    expect(map['1'].isRemoved).toBe(false);
    expect(map['1'].removedAt).toBeNull();
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

  test('半数以上が isRemoved の場合は取得事故として通常状態に戻す', () => {
    const deps = makeDeps();
    const { normalizeAndPersistMeta } = createMetaManager(deps);
    const rows = Array.from({ length: 10 }, (_, index) => ({
      itemId: String(index + 1),
      itemName: `Item ${index + 1}`,
      downloadLinks: [],
      isRemoved: index < 7,
      removedAt: '2026-01-01T00:00:00.000Z',
    }));
    const result = normalizeAndPersistMeta(rows);
    expect(result.filter((item) => item.isRemoved)).toHaveLength(0);
    expect(deps.fs.writeFileSync).toHaveBeenCalled();
  });

  test('少数の isRemoved は通常の削除済みとして維持する', () => {
    const deps = makeDeps();
    const { normalizeAndPersistMeta } = createMetaManager(deps);
    const rows = Array.from({ length: 10 }, (_, index) => ({
      itemId: String(index + 1),
      itemName: `Item ${index + 1}`,
      downloadLinks: [],
      isRemoved: index < 2,
      removedAt: '2026-01-01T00:00:00.000Z',
    }));
    const result = normalizeAndPersistMeta(rows);
    expect(result.filter((item) => item.isRemoved)).toHaveLength(2);
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled();
  });
});
