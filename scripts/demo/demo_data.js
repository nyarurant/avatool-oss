'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// unitypackage files are gzip-compressed tar archives. An all-zero
// placeholder tar (no entries) is enough for demos that only need a
// downloaded-looking file on disk, but unity_reconcile_worker.js's
// extractPathnamesNative() reads real tar headers looking for entries named
// "<guid>/pathname" whose content is the asset's "Assets/..." path (the
// actual unitypackage-internal layout Unity itself produces) — an all-zero
// placeholder has none of these, so reconcile can never find a match
// against it. Fine for demos that don't run reconcile, but meaningless for
// the one that does (a "0/1 matched" result demonstrates nothing). This
// builds a minimal-but-real tar containing just the "pathname" entries (no
// actual asset/meta payload — reconcile never reads those) so a real
// project directory containing files at the same paths produces a genuine,
// positive match.
function buildTarHeader(entryName, size) {
  const header = Buffer.alloc(512, 0);
  header.write(entryName, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii'); // checksum field, spaces during computation
  header[156] = 0x30; // typeflag '0' = regular file
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += header[i];
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

function buildFakeUnityPackageWithPaths(assetPathnames) {
  const blocks = [];
  assetPathnames.forEach((pathname, index) => {
    const guid = `demofakeguid${String(index).padStart(19, '0')}`.slice(0, 32);
    const content = Buffer.from(pathname, 'utf8');
    blocks.push(buildTarHeader(`${guid}/pathname`, content.length), content);
    const pad = (512 - (content.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad, 0));
  });
  blocks.push(Buffer.alloc(1024, 0)); // two zero blocks = tar end-of-archive marker
  return zlib.gzipSync(Buffer.concat(blocks));
}

// The two asset paths the "Nix" package (see hasRealDownloadedFiles below)
// claims to contain. scripts/demo/demo_project_items.js writes real files at
// these exact same relative paths into the fake Unity project directory so
// the reconcile demo shows a genuine, positive match instead of "0/1".
const HERO_PACKAGE_ASSET_PATHS = ['Assets/Nix/Nix.prefab', 'Assets/Nix/Textures/Nix_albedo.png'];

// The library grid uses real items the user actually owns on BOOTH (real
// names/authors/categories/thumbnails), picked and approved by the user —
// see DevNote-2026-08-16-real-data-demo.md for why and how these were
// chosen (only clearly-SFW items; nothing NSFW/R-18-adjacent, even though
// the real library contains plenty of that). No purchased *content* is ever
// used — only the public product listing metadata and promotional
// thumbnail image, both of which are already what a real Avatool user sees
// browsing their own library. Downloaded files are still synthetic
// placeholders (see FAKE_UNITYPACKAGE_BYTES above), never the real paid
// unitypackage contents.
//
// "Nix" (6481122) doubles as the one already-downloaded item (real files on
// disk under __extracted/) used by the project-items/reconcile and
// library-sync/update demos. The other 5 base items stay not-downloaded.
// Item 4087393 is not part of the static base library — it's the item
// lib/demo_recording_service.js#simulateLibrarySync() "discovers" when the
// sync demo runs, so its thumbnail is pre-copied here too even though its
// librarymeta.json entry doesn't exist until that demo adds it.
const REAL_DEMO_ITEMS = [
  {
    itemId: '6481122',
    itemName: '『ニクス -Nix-』オリジナル3Dモデル',
    authorName: '寺井カントリー|Terai Country',
    primaryCategory: { href: 'https://booth.pm/ja/browse/3D%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC', text: '3Dキャラクター', slug: '3D%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC' },
    categoryText: '3Dキャラクター',
    downloadFileName: 'Nix_1.01.zip',
    isAvatarItem: true,
    // The real app auto-backfills supportedAvatars for avatar items from
    // their own title (fixAvatarItemFields, called during meta
    // normalization) — it derives the katakana segment ("ニクス") from
    // "『ニクス -Nix-』...", overwriting whatever is set here. The hair
    // items below are tagged supportedAvatarsInferred: ['ニクス'] (not
    // 'Nix') to match that real, script-sensitive matching behavior —
    // matchesAvatarFilter() does not fold Latin/katakana as equivalent.
    supportedAvatars: ['ニクス'],
    cacheFile: '6481122.jpg',
    hasRealDownloadedFiles: true,
  },
  {
    itemId: '6405390',
    itemName: 'ショコラ -Chocolat- / オリジナル3Dモデル',
    authorName: 'あまとうさぎ',
    primaryCategory: { href: 'https://booth.pm/ja/browse/3D%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC', text: '3Dキャラクター', slug: '3D%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC' },
    categoryText: '3Dキャラクター',
    downloadFileName: 'Chocolat_v1.02.zip',
    isAvatarItem: true,
    cacheFile: '6405390.jpg',
  },
  {
    itemId: '6618782',
    itemName: '【18アバター対応】くろねこロングヘア【VRChat】 (くろねこロングヘア)',
    authorName: 'Pirouette',
    primaryCategory: { href: 'https://booth.pm/ja/browse/3D%E9%AB%AA%E5%9E%8B', text: '3D髪型', slug: '3D%E9%AB%AA%E5%9E%8B' },
    categoryText: '3D髪型',
    downloadFileName: 'kuroneko_TEX.zip',
    supportedAvatarsInferred: ['ニクス'],
    cacheFile: '6618782.jpg',
  },
  {
    itemId: '4358263',
    itemName: '[VRC Hair]オオカミ少女！ (オオカミ少女！)',
    authorName: 'ANKA',
    primaryCategory: { href: 'https://booth.pm/ja/browse/3D%E8%A1%A3%E8%A3%85', text: '3D衣装', slug: '3D%E8%A1%A3%E8%A3%85' },
    categoryText: '3D衣装',
    downloadFileName: 'ANKA_オオカミ少女_.zip',
    supportedAvatarsInferred: ['ニクス'],
    cacheFile: '4358263.jpg',
  },
  {
    itemId: '7420841',
    itemName: '握手ギミック',
    authorName: 'さいころワークス',
    primaryCategory: { href: 'https://booth.pm/ja/browse/3D%E3%83%84%E3%83%BC%E3%83%AB%E3%83%BB%E3%82%B7%E3%82%B9%E3%83%86%E3%83%A0', text: '3Dツール・システム', slug: '3D%E3%83%84%E3%83%BC%E3%83%AB%E3%83%BB%E3%82%B7%E3%82%B9%E3%83%86%E3%83%A0' },
    categoryText: '3Dツール・システム',
    downloadFileName: '握手ギミック_1.1.0.zip',
    cacheFile: '7420841.jpg',
  },
  {
    itemId: '3854070',
    itemName: '近付くと色が変わる！Reactive Pair Ring (近付くと色が変わる！Reactive Pair Ring)',
    authorName: 'Konoe Studio',
    primaryCategory: { href: 'https://booth.pm/ja/browse/3D%E8%A1%A3%E8%A3%85', text: '3D衣装', slug: '3D%E8%A1%A3%E8%A3%85' },
    categoryText: '3D衣装',
    downloadFileName: 'Reactive-Pair-Ring_v1.1.zip',
    cacheFile: '3854070.jpg',
  },
];

// Not part of the initial static grid — added at runtime by
// lib/demo_recording_service.js#simulateLibrarySync(). Its thumbnail is
// still pre-copied by createDemoData() below so it's ready the moment that
// demo writes the librarymeta.json entry.
const SYNC_NEW_ITEM = {
  itemId: '4087393',
  itemName: '【全アバター対応ギミック】フェイドアウトシステム Ver.2.0 FadeOut System for LilToon（Modular Avatar対応） (【Plus版】FadeOut System Ver.2.0+)',
  authorName: '光学仙草工房',
  primaryCategory: { href: 'https://booth.pm/ja/browse/3D%E3%83%84%E3%83%BC%E3%83%AB%E3%83%BB%E3%82%B7%E3%82%B9%E3%83%86%E3%83%A0', text: '3Dツール・システム', slug: '3D%E3%83%84%E3%83%BC%E3%83%AB%E3%83%BB%E3%82%B7%E3%82%B9%E3%83%86%E3%83%A0' },
  categoryText: '3Dツール・システム',
  downloadFileName: 'FadeOut_System_Ver2.0+.zip',
  cacheFile: '4087393.jpg',
};

const REAL_CACHE_SOURCE_DIR = path.join(process.env.APPDATA || '', 'avatool', 'data', 'cache');

function buildDemoLibrary(now) {
  return REAL_DEMO_ITEMS.map((item, index) => ({
    itemId: item.itemId,
    itemName: item.itemName,
    authorName: item.authorName,
    orderDateTime: new Date(Date.parse(now) - index * 3600000).toISOString(),
    imageUrl: '',
    localImagePath: item.cacheFile ? `./cache/${item.cacheFile}` : '',
    categories: [{ href: '', text: '3Dモデル', slug: '' }, item.primaryCategory],
    primaryCategory: item.primaryCategory,
    tagNames: ['demo'],
    downloadLinks: [{ downloadableId: `9${item.itemId}`, fileName: item.downloadFileName }],
    versionHistory: [],
    latestVersion: { detectedAt: now, filesHash: `demo-hash-${item.itemId}`, filesHashStable: `demo-stable-${item.itemId}` },
    hasUpdate: false,
    lastChecked: now,
    isAvatarItem: Boolean(item.isAvatarItem),
    supportedAvatars: item.supportedAvatars || [],
    supportedAvatarsInferred: item.supportedAvatarsInferred || [],
    supportedAvatarAnalysis: (item.supportedAvatars || item.supportedAvatarsInferred)
      ? { status: 'confirmed', primaryAvatar: 'ニクス', candidates: [{ name: 'ニクス', score: 95, reasons: ['demo'] }] }
      : null,
    avatarAnalysisCheckedAt: (item.supportedAvatars || item.supportedAvatarsInferred) ? now : '',
  }));
}

function makeItemDir(downloadRoot, itemId, title) {
  const safeName = String(title || '').replace(/[\\/:*?"<>|]/g, '_');
  const dir = path.join(downloadRoot, `${itemId}_${safeName}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function copyRealThumbnails(cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const allItems = [...REAL_DEMO_ITEMS, SYNC_NEW_ITEM];
  for (const item of allItems) {
    if (!item.cacheFile) continue;
    try {
      fs.copyFileSync(path.join(REAL_CACHE_SOURCE_DIR, item.cacheFile), path.join(cacheDir, item.cacheFile));
    } catch {
      // Source machine may not have this thumbnail cached (e.g. a fresh
      // checkout, or run on a different machine) — fall back to no image,
      // same as any other item without a thumbnail.
    }
  }
}

function createDemoData(dataDir) {
  const downloadRoot = path.join(dataDir, 'downloads');
  fs.mkdirSync(downloadRoot, { recursive: true });
  copyRealThumbnails(path.join(dataDir, 'cache'));
  const now = new Date().toISOString();
  const items = buildDemoLibrary(now);

  // The "Nix" avatar (6481122) ships with real (placeholder-content) files
  // on disk so its preview modal shows a populated file tree and the
  // project-items/reconcile and library-sync/update demos have something to
  // find/update.
  const heroItem = REAL_DEMO_ITEMS.find((it) => it.hasRealDownloadedFiles);
  const safeName = String(heroItem.itemName).replace(/[\\/:*?"<>|]/g, '_');
  const downloadedDir = makeItemDir(downloadRoot, heroItem.itemId, heroItem.itemName);
  fs.writeFileSync(path.join(downloadedDir, heroItem.downloadFileName), 'demo placeholder\n', 'utf8');
  const extractedRoot = path.join(downloadedDir, '__extracted');
  fs.mkdirSync(path.join(extractedRoot, safeName, 'Textures'), { recursive: true });
  fs.mkdirSync(path.join(extractedRoot, safeName, 'Prefabs'), { recursive: true });
  fs.writeFileSync(path.join(extractedRoot, safeName, 'Readme.txt'), 'demo readme\n', 'utf8');
  fs.writeFileSync(path.join(extractedRoot, safeName, 'Prefabs', 'Avatar.prefab'), 'demo prefab placeholder\n', 'utf8');
  fs.writeFileSync(path.join(extractedRoot, safeName, 'Textures', 'body_albedo.png'), 'demo texture placeholder\n', 'utf8');
  // collect-unitypackages (used by the project-items reconcile demo) only
  // scans inside __extracted/, matching how real BOOTH archives unpack. This
  // package has real (if minimal) tar entries — see
  // buildFakeUnityPackageWithPaths() above — so the reconcile demo can find
  // a genuine match against a project containing the same asset paths.
  fs.writeFileSync(
    path.join(extractedRoot, safeName, `${safeName}.unitypackage`),
    buildFakeUnityPackageWithPaths(HERO_PACKAGE_ASSET_PATHS),
  );
  fs.writeFileSync(path.join(extractedRoot, '__extracted.flag'), 'ok', 'utf8');

  fs.writeFileSync(path.join(dataDir, 'librarymeta.json'), JSON.stringify(items, null, 2), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'avatars.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'operation_logs.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
    downloadPath: downloadRoot,
    concurrency: 2,
    autoExtract: true,
    extractZipOnly: false,
    autoCheckInterval: 0,
    minFreeSpaceGb: 0,
    autoBootstrapEnabled: false,
    autoBootstrapIncludeMA: false,
    autoBootstrapIncludeLiltoon: false,
    autoBootstrapIncludeFaceEmo: false,
    autoBootstrapIncludeAvatoolScripts: false,
    autoBootstrapIncludeFolderIconBootstrap: false,
    autoBootstrapIncludeSimpleFolderIcon: false,
    autoBootstrapProjectImportRules: [],
    autoBootstrapVariantMode: 'select',
    autoBootstrapVariantSelections: [],
    projectImportPresets: {},
    cookieFile: path.join(dataDir, 'booth.pm.json'),
    unityEditorPath: '',
    // Populated at startup from the fake VCC registry demo_readme.js sets up
    // via a redirected LOCALAPPDATA — see lib/vcc_sync_service.js.
    unityProjects: [],
    safeMode: true,
    healthCheckOnStartup: false,
    downloadSchedulerEnabled: false,
    downloadSchedulerStartHour: 1,
    downloadSchedulerEndHour: 6,
    downloadSchedulerProfile: 'balanced',
    downloadRetryMaxAttempts: 2,
    downloadRetryBaseDelayMs: 200,
    operationLogEnabled: true,
    zipMaxEntryBytes: 512 * 1024 * 1024,
    keyboardShortcutsEnabled: false,
    renderMode: 'instant',
    keyboardShortcuts: {},
  }, null, 2), 'utf8');
  return { items };
}

module.exports = {
  createDemoData, buildDemoLibrary, REAL_DEMO_ITEMS, SYNC_NEW_ITEM, HERO_PACKAGE_ASSET_PATHS,
};
