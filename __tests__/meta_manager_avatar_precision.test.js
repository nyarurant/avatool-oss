'use strict';

const iconvLite = require('iconv-lite');
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
    iconvLite,
    pathToFileURL,
    META_PATH: '/test/librarymeta.json',
    AVATARS_PATH: '/test/avatars.json',
    CACHE_DIR: '/test/cache',
    AUTHOR_ICON_DIR: '/test/author_icons',
    APP_DATA_ROOT: '/test',
    LEGACY_APP_ROOT: '/legacy',
    AUTO_BOOTSTRAP_FIXED_ITEMS: [],
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

describe('avatar precision signals', () => {
  test('README detects explicit avatar support', async () => {
    const avatarRows = JSON.stringify([
      { name: 'Rurune' },
    ]);
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn((targetPath) => (
          targetPath === '/test/avatars.json'
          || targetPath.replace(/\\/g, '/') === '/test/downloads/300_Mystery Outfit/__extracted'
        )),
        readFileSync: jest.fn((targetPath) => {
          if (targetPath === '/test/avatars.json') return avatarRows;
          if (targetPath.replace(/\\/g, '/') === '/test/downloads/300_Mystery Outfit/__extracted/README.txt') return 'Supported avatar: Rurune';
          return '[]';
        }),
        writeFileSync: jest.fn(),
        renameSync: jest.fn(),
        readdirSync: jest.fn((targetPath) => {
          if (targetPath.replace(/\\/g, '/') === '/test/downloads/300_Mystery Outfit/__extracted') {
            return [{
              name: 'README.txt',
              isDirectory: () => false,
              isFile: () => true,
            }];
          }
          return [];
        }),
        statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
        mkdirSync: jest.fn(),
      },
    });
    const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);
    const items = [
      makeItem('300', ['mystery_outfit.zip'], {
        itemName: 'Mystery Outfit',
        tagNames: ['dress'],
        supportedAvatars: [],
        supportedAvatarsInferred: [],
      }),
    ];

    const res = await enrichMetaSupportedAvatarsFromFolders(items, { persist: false });
    const target = res.items.find((row) => row.itemId === '300');

    expect(target.supportedAvatarsInferred).toEqual(['Rurune']);
    expect(target.supportedAvatarAnalysis.primaryAvatar).toBe('Rurune');
    expect(target.supportedAvatarAnalysis.status).toBe('confirmed');
    expect(target.supportedAvatarAnalysis.candidates[0].reasons).toContain('同梱README一致');
  });

  test('debug verbose logs avatar score breakdown', async () => {
    const prevDebug = process.env.AVATOOL_DEBUG_VERBOSE;
    process.env.AVATOOL_DEBUG_VERBOSE = '1';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const avatarRows = JSON.stringify([
        { name: 'Rurune' },
      ]);
      const deps = makeDeps({
        fs: {
          existsSync: jest.fn((targetPath) => (
            targetPath === '/test/avatars.json'
            || targetPath.replace(/\\/g, '/') === '/test/downloads/301_Mystery Outfit/__extracted'
          )),
          readFileSync: jest.fn((targetPath) => {
            if (targetPath === '/test/avatars.json') return avatarRows;
            if (targetPath.replace(/\\/g, '/') === '/test/downloads/301_Mystery Outfit/__extracted/README.txt') return 'Supported avatar: Rurune';
            return '[]';
          }),
          writeFileSync: jest.fn(),
          renameSync: jest.fn(),
          readdirSync: jest.fn((targetPath) => {
            if (targetPath.replace(/\\/g, '/') === '/test/downloads/301_Mystery Outfit/__extracted') {
              return [{
                name: 'README.txt',
                isDirectory: () => false,
                isFile: () => true,
              }];
            }
            return [];
          }),
          statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
          mkdirSync: jest.fn(),
        },
      });
      const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);

      await enrichMetaSupportedAvatarsFromFolders([
        makeItem('301', ['mystery_outfit.zip'], {
          itemName: 'Mystery Outfit',
          supportedAvatars: [],
          supportedAvatarsInferred: [],
        }),
      ], { persist: false });

      const breakdownCall = consoleSpy.mock.calls.find((call) => (
        call[0] === '[AVATAR-DEBUG]' && call[1] === 'avatar-score-breakdown'
      ));
      expect(breakdownCall).toBeTruthy();
      expect(breakdownCall[2]).toMatchObject({
        item: {
          itemId: '301',
          hasExtracted: true,
          readmeCount: 1,
        },
        threshold: 6,
        sourceCounts: {
          readme: 1,
        },
        candidates: [{
          name: 'Rurune',
          score: 7,
          acceptedBySignals: true,
          breakdown: [{ reason: '同梱README一致', weight: 7 }],
        }],
      });
    } finally {
      consoleSpy.mockRestore();
      if (prevDebug === undefined) delete process.env.AVATOOL_DEBUG_VERBOSE;
      else process.env.AVATOOL_DEBUG_VERBOSE = prevDebug;
    }
  });

  test('debugLogEnabled setting logs avatar score breakdown without env flag', async () => {
    const prevDebug = process.env.AVATOOL_DEBUG_VERBOSE;
    delete process.env.AVATOOL_DEBUG_VERBOSE;
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const avatarRows = JSON.stringify([
        { name: 'Rurune' },
      ]);
      const deps = makeDeps({
        getSettings: jest.fn().mockReturnValue({ downloadPath: '/test/downloads', debugLogEnabled: true }),
        fs: {
          existsSync: jest.fn((targetPath) => (
            targetPath === '/test/avatars.json'
            || targetPath.replace(/\\/g, '/') === '/test/downloads/302_Mystery Outfit/__extracted'
          )),
          readFileSync: jest.fn((targetPath) => {
            if (targetPath === '/test/avatars.json') return avatarRows;
            if (targetPath.replace(/\\/g, '/') === '/test/downloads/302_Mystery Outfit/__extracted/README.txt') return 'Supported avatar: Rurune';
            return '[]';
          }),
          writeFileSync: jest.fn(),
          renameSync: jest.fn(),
          readdirSync: jest.fn((targetPath) => {
            if (targetPath.replace(/\\/g, '/') === '/test/downloads/302_Mystery Outfit/__extracted') {
              return [{
                name: 'README.txt',
                isDirectory: () => false,
                isFile: () => true,
              }];
            }
            return [];
          }),
          statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
          mkdirSync: jest.fn(),
        },
      });
      const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);

      await enrichMetaSupportedAvatarsFromFolders([
        makeItem('302', ['mystery_outfit.zip'], {
          itemName: 'Mystery Outfit',
          supportedAvatars: [],
          supportedAvatarsInferred: [],
        }),
      ], { persist: false });

      expect(consoleSpy.mock.calls.some((call) => (
        call[0] === '[AVATAR-DEBUG]' && call[1] === 'avatar-score-breakdown'
      ))).toBe(true);
    } finally {
      consoleSpy.mockRestore();
      if (prevDebug === undefined) delete process.env.AVATOOL_DEBUG_VERBOSE;
      else process.env.AVATOOL_DEBUG_VERBOSE = prevDebug;
    }
  });

  test('debugLogEnabled setting logs no-candidate reason', async () => {
    const prevDebug = process.env.AVATOOL_DEBUG_VERBOSE;
    delete process.env.AVATOOL_DEBUG_VERBOSE;
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const avatarRows = JSON.stringify([
        { name: 'Rurune' },
      ]);
      const deps = makeDeps({
        getSettings: jest.fn().mockReturnValue({ downloadPath: '/test/downloads', debugLogEnabled: true }),
        fs: {
          existsSync: jest.fn((targetPath) => targetPath === '/test/avatars.json'),
          readFileSync: jest.fn((targetPath) => {
            if (targetPath === '/test/avatars.json') return avatarRows;
            return '[]';
          }),
          writeFileSync: jest.fn(),
          renameSync: jest.fn(),
          readdirSync: jest.fn().mockReturnValue([]),
          statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
          mkdirSync: jest.fn(),
        },
      });
      const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);

      await enrichMetaSupportedAvatarsFromFolders([
        makeItem('303', ['mystery_outfit.zip'], {
          itemName: 'Mystery Outfit',
          supportedAvatars: [],
          supportedAvatarsInferred: [],
        }),
      ], { persist: false });

      const noCandidateCall = consoleSpy.mock.calls.find((call) => (
        call[0] === '[AVATAR-DEBUG]' && call[1] === 'avatar-analysis-no-candidates'
      ));
      expect(noCandidateCall).toBeTruthy();
      expect(noCandidateCall[2]).toMatchObject({
        reason: 'no_signal_or_meta_match',
        item: {
          itemId: '303',
          hasExtracted: false,
          readmeCount: 0,
        },
        skippedSources: {
          titleDescriptionTags: 'non_texture_category',
          readme: 'extracted_folder_missing',
        },
      });
    } finally {
      consoleSpy.mockRestore();
      if (prevDebug === undefined) delete process.env.AVATOOL_DEBUG_VERBOSE;
      else process.env.AVATOOL_DEBUG_VERBOSE = prevDebug;
    }
  });

  test('title-only match no longer infers avatar (file analysis only)', async () => {
    const avatarRows = JSON.stringify([
      { name: 'Rurune' },
      { name: 'Manuka', alphabet: 'manuka' },
    ]);
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn((targetPath) => targetPath === '/test/avatars.json'),
        readFileSync: jest.fn((targetPath) => {
          if (targetPath === '/test/avatars.json') return avatarRows;
          return '[]';
        }),
        writeFileSync: jest.fn(),
        renameSync: jest.fn(),
        readdirSync: jest.fn().mockReturnValue([]),
        statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
        mkdirSync: jest.fn(),
      },
    });
    const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);
    const items = [
      makeItem('400', ['dress_bundle.zip'], {
        itemName: 'Silky Nightwear for Rurune',
        tagNames: ['VRChat', 'dress'],
        supportedAvatars: [],
        supportedAvatarsInferred: [],
      }),
    ];

    const res = await enrichMetaSupportedAvatarsFromFolders(items, { persist: false });
    const target = res.items.find((row) => row.itemId === '400');

    // タイトルだけではアバター推論しない（ファイル解析のみ）
    expect(target.supportedAvatarsInferred).toEqual([]);
    expect(target.supportedAvatarAnalysis).toBeFalsy();
  });

  test('download link file name alone no longer infers avatar without local file evidence', async () => {
    const avatarRows = JSON.stringify([
      { name: 'Rurune' },
    ]);
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn((targetPath) => targetPath === '/test/avatars.json'),
        readFileSync: jest.fn((targetPath) => {
          if (targetPath === '/test/avatars.json') return avatarRows;
          return '[]';
        }),
        writeFileSync: jest.fn(),
        renameSync: jest.fn(),
        readdirSync: jest.fn().mockReturnValue([]),
        statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
        mkdirSync: jest.fn(),
      },
    });
    const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);
    const items = [
      makeItem('401', ['Rurune_outfit.zip'], {
        itemName: 'Outfit',
        tagNames: [],
        supportedAvatars: [],
        supportedAvatarsInferred: [],
      }),
    ];

    const res = await enrichMetaSupportedAvatarsFromFolders(items, { persist: false });
    const target = res.items.find((row) => row.itemId === '401');

    expect(target.supportedAvatars).toEqual([]);
    expect(target.supportedAvatarsInferred).toEqual([]);
    expect(target.supportedAvatarAnalysis).toBeFalsy();
  });

  test('description-only match no longer infers avatar (file analysis only)', async () => {
    const avatarRows = JSON.stringify([
      { name: 'Rurune' },
      { name: 'Manuka', alphabet: 'manuka' },
    ]);
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn((targetPath) => targetPath === '/test/avatars.json'),
        readFileSync: jest.fn((targetPath) => {
          if (targetPath === '/test/avatars.json') return avatarRows;
          return '[]';
        }),
        writeFileSync: jest.fn(),
        renameSync: jest.fn(),
        readdirSync: jest.fn().mockReturnValue([]),
        statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
        mkdirSync: jest.fn(),
      },
    });
    const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);
    const items = [
      makeItem('500', ['nightwear_bundle.zip'], {
        itemName: 'Silky Nightwear',
        boothDescription: 'This costume is made for Rurune avatar.',
        tagNames: ['VRChat', 'dress'],
        supportedAvatars: [],
        supportedAvatarsInferred: [],
      }),
    ];

    const res = await enrichMetaSupportedAvatarsFromFolders(items, { persist: false });
    const target = res.items.find((row) => row.itemId === '500');

    // 説明文だけではアバター推論しない（ファイル解析のみ）
    expect(target.supportedAvatarsInferred).toEqual([]);
    expect(target.supportedAvatarAnalysis).toBeFalsy();
  });

  test('multi-avatar title and tags do not infer without local evidence', async () => {
    const avatarRows = JSON.stringify([
      { name: 'Rurune' },
      { name: 'Manuka', alphabet: 'manuka' },
    ]);
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn((targetPath) => targetPath === '/test/avatars.json'),
        readFileSync: jest.fn((targetPath) => {
          if (targetPath === '/test/avatars.json') return avatarRows;
          return '[]';
        }),
        writeFileSync: jest.fn(),
        renameSync: jest.fn(),
        readdirSync: jest.fn().mockReturnValue([]),
        statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
        mkdirSync: jest.fn(),
      },
    });
    const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);
    const items = [
      makeItem('505', ['texture_bundle.zip'], {
        itemName: 'Rurune Manuka Multi Avatar Set',
        boothDescription: 'Rurune and Manuka supported.',
        tagNames: ['Rurune', 'Manuka'],
        primaryCategory: { text: 'テクスチャ' },
        supportedAvatars: [],
        supportedAvatarsInferred: [],
      }),
    ];

    const res = await enrichMetaSupportedAvatarsFromFolders(items, { persist: false });
    const target = res.items.find((row) => row.itemId === '505');

    expect(target.supportedAvatarsInferred).toEqual([]);
    expect(target.supportedAvatarAnalysis).toBeFalsy();
  });

  test('weak sources can supplement but not replace local evidence', async () => {
    const avatarRows = JSON.stringify([
      { name: 'Rurune' },
      { name: 'Manuka', alphabet: 'manuka' },
    ]);
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn((targetPath) => (
          targetPath === '/test/avatars.json'
          || targetPath.replace(/\\/g, '/') === '/test/downloads/506_Rurune Manuka Multi Avatar Set/__extracted'
        )),
        readFileSync: jest.fn((targetPath) => {
          if (targetPath === '/test/avatars.json') return avatarRows;
          if (targetPath.replace(/\\/g, '/') === '/test/downloads/506_Rurune Manuka Multi Avatar Set/__extracted/README.txt') return 'Supported avatar: Rurune';
          return '[]';
        }),
        writeFileSync: jest.fn(),
        renameSync: jest.fn(),
        readdirSync: jest.fn((targetPath) => {
          if (targetPath.replace(/\\/g, '/') === '/test/downloads/506_Rurune Manuka Multi Avatar Set/__extracted') {
            return [{
              name: 'README.txt',
              isDirectory: () => false,
              isFile: () => true,
            }];
          }
          return [];
        }),
        statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
        mkdirSync: jest.fn(),
      },
    });
    const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);
    const items = [
      makeItem('506', ['texture_bundle.zip'], {
        itemName: 'Rurune Manuka Multi Avatar Set',
        boothDescription: 'Rurune and Manuka supported.',
        tagNames: ['Rurune', 'Manuka'],
        primaryCategory: { text: 'テクスチャ' },
        supportedAvatars: [],
        supportedAvatarsInferred: [],
      }),
    ];

    const res = await enrichMetaSupportedAvatarsFromFolders(items, { persist: false });
    const target = res.items.find((row) => row.itemId === '506');

    expect(target.supportedAvatarsInferred).toEqual(['Rurune']);
    expect(target.supportedAvatarAnalysis.primaryAvatar).toBe('Rurune');
    expect(target.supportedAvatarAnalysis.candidates.map((row) => row.name)).toEqual(['Rurune']);
  });

  test('stale automatic supported avatars are cleared when local-first analysis finds no evidence', async () => {
    const avatarRows = JSON.stringify([
      { name: 'Rurune' },
      { name: 'Manuka', alphabet: 'manuka' },
    ]);
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn((targetPath) => targetPath === '/test/avatars.json'),
        readFileSync: jest.fn((targetPath) => {
          if (targetPath === '/test/avatars.json') return avatarRows;
          return '[]';
        }),
        writeFileSync: jest.fn(),
        renameSync: jest.fn(),
        readdirSync: jest.fn().mockReturnValue([]),
        statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
        mkdirSync: jest.fn(),
      },
    });
    const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);
    const items = [
      makeItem('507', ['multi_avatar_bundle.zip'], {
        itemName: 'Multi Avatar Outfit',
        tagNames: ['Rurune', 'Manuka'],
        primaryCategory: { text: '3D衣装' },
        supportedAvatars: ['Rurune', 'Manuka'],
        supportedAvatarsInferred: ['Rurune', 'Manuka'],
        supportedAvatarAnalysis: {
          primaryAvatar: 'Rurune',
          status: 'confirmed',
          candidates: [
            { name: 'Rurune', reasons: ['タグ一致'], score: 3 },
            { name: 'Manuka', reasons: ['タグ一致'], score: 3 },
          ],
        },
      }),
    ];

    const res = await enrichMetaSupportedAvatarsFromFolders(items, { persist: false });
    const target = res.items.find((row) => row.itemId === '507');

    expect(target.supportedAvatars).toEqual([]);
    expect(target.supportedAvatarsInferred).toEqual([]);
    expect(target.supportedAvatarAnalysis).toBeFalsy();
  });

  test('manual confirmed supported avatars are preserved even when local analysis finds no evidence', async () => {
    const avatarRows = JSON.stringify([
      { name: 'Rurune' },
    ]);
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn((targetPath) => targetPath === '/test/avatars.json'),
        readFileSync: jest.fn((targetPath) => {
          if (targetPath === '/test/avatars.json') return avatarRows;
          return '[]';
        }),
        writeFileSync: jest.fn(),
        renameSync: jest.fn(),
        readdirSync: jest.fn().mockReturnValue([]),
        statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
        mkdirSync: jest.fn(),
      },
    });
    const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);
    const items = [
      makeItem('508', ['manual_bundle.zip'], {
        itemName: 'Manual Outfit',
        tagNames: [],
        primaryCategory: { text: '3D衣装' },
        supportedAvatars: ['Rurune'],
        supportedAvatarsInferred: [],
        supportedAvatarAnalysis: {
          primaryAvatar: 'Rurune',
          status: 'confirmed',
          manualConfirmed: true,
          candidates: [{ name: 'Rurune', reasons: ['手動確定'], score: 999 }],
        },
      }),
    ];

    const res = await enrichMetaSupportedAvatarsFromFolders(items, { persist: false });
    const target = res.items.find((row) => row.itemId === '508');

    expect(target.supportedAvatars).toEqual(['Rurune']);
    expect(target.supportedAvatarAnalysis.manualConfirmed).toBe(true);
  });

  test('cp932 README is decoded and used as an analysis signal', async () => {
    const avatarRows = JSON.stringify([
      { name: 'Rurune' },
    ]);
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn((targetPath) => (
          targetPath === '/test/avatars.json'
          || targetPath.replace(/\\/g, '/') === '/test/downloads/600_ShiftJis Outfit/__extracted'
        )),
        readFileSync: jest.fn((targetPath) => {
          if (targetPath === '/test/avatars.json') return avatarRows;
          if (targetPath.replace(/\\/g, '/') === '/test/downloads/600_ShiftJis Outfit/__extracted/README.txt') {
            return iconvLite.encode('対応アバター: Rurune', 'cp932');
          }
          return '[]';
        }),
        writeFileSync: jest.fn(),
        renameSync: jest.fn(),
        readdirSync: jest.fn((targetPath) => {
          if (targetPath.replace(/\\/g, '/') === '/test/downloads/600_ShiftJis Outfit/__extracted') {
            return [{
              name: 'README.txt',
              isDirectory: () => false,
              isFile: () => true,
            }];
          }
          return [];
        }),
        statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
        mkdirSync: jest.fn(),
      },
    });
    const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);
    const items = [
      makeItem('600', ['shiftjis_outfit.zip'], {
        itemName: 'ShiftJis Outfit',
        tagNames: ['dress'],
        supportedAvatars: [],
        supportedAvatarsInferred: [],
      }),
    ];

    const res = await enrichMetaSupportedAvatarsFromFolders(items, { persist: false });
    const target = res.items.find((row) => row.itemId === '600');

    expect(target.supportedAvatarsInferred[0]).toBe('Rurune');
    expect(target.supportedAvatarAnalysis.primaryAvatar).toBe('Rurune');
    expect(target.supportedAvatarAnalysis.candidates[0].reasons).toContain('同梱README一致');
  });

  test('pdf text is extracted and used as an analysis signal', async () => {
    const avatarRows = JSON.stringify([
      { name: 'Rurune' },
    ]);
    const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 40 >>\nstream\nBT\n(Fits Rurune avatar) Tj\nET\nendstream\nendobj\n%%EOF', 'latin1');
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn((targetPath) => (
          targetPath === '/test/avatars.json'
          || targetPath.replace(/\\/g, '/') === '/test/downloads/700_Pdf Outfit/__extracted'
        )),
        readFileSync: jest.fn((targetPath) => {
          if (targetPath === '/test/avatars.json') return avatarRows;
          if (targetPath.replace(/\\/g, '/') === '/test/downloads/700_Pdf Outfit/__extracted/readme.pdf') {
            return pdfBuffer;
          }
          return '[]';
        }),
        writeFileSync: jest.fn(),
        renameSync: jest.fn(),
        readdirSync: jest.fn((targetPath) => {
          if (targetPath.replace(/\\/g, '/') === '/test/downloads/700_Pdf Outfit/__extracted') {
            return [{
              name: 'readme.pdf',
              isDirectory: () => false,
              isFile: () => true,
            }];
          }
          return [];
        }),
        statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
        mkdirSync: jest.fn(),
      },
    });
    const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);
    const items = [
      makeItem('700', ['pdf_outfit.zip'], {
        itemName: 'Pdf Outfit',
        tagNames: ['dress'],
        supportedAvatars: [],
        supportedAvatarsInferred: [],
      }),
    ];

    const res = await enrichMetaSupportedAvatarsFromFolders(items, { persist: false });
    const target = res.items.find((row) => row.itemId === '700');

    expect(target.supportedAvatarsInferred[0]).toBe('Rurune');
    expect(target.supportedAvatarAnalysis.primaryAvatar).toBe('Rurune');
    expect(target.supportedAvatarAnalysis.candidates[0].reasons).toContain('同梱README一致');
  });

  test('multi-avatar title-only no longer infers avatars (file analysis only)', async () => {
    const avatarRows = JSON.stringify([
      { name: 'Rurune' },
      { name: 'Manuka', alphabet: 'manuka' },
    ]);
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn((targetPath) => targetPath === '/test/avatars.json'),
        readFileSync: jest.fn((targetPath) => {
          if (targetPath === '/test/avatars.json') return avatarRows;
          return '[]';
        }),
        writeFileSync: jest.fn(),
        renameSync: jest.fn(),
        readdirSync: jest.fn().mockReturnValue([]),
        statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
        mkdirSync: jest.fn(),
      },
    });
    const { enrichMetaSupportedAvatarsFromFolders } = createMetaManager(deps);
    const items = [
      makeItem('800', ['dual_outfit.zip'], {
        itemName: 'Dual Outfit (Rurune & Manuka)',
        tagNames: ['VRChat', 'dress'],
        supportedAvatars: [],
        supportedAvatarsInferred: [],
      }),
    ];

    const res = await enrichMetaSupportedAvatarsFromFolders(items, { persist: false });
    const target = res.items.find((row) => row.itemId === '800');

    // タイトルだけではアバター推論しない（ファイル解析のみ）
    expect(target.supportedAvatarsInferred).toEqual([]);
    expect(target.supportedAvatarAnalysis).toBeFalsy();
  });
});


