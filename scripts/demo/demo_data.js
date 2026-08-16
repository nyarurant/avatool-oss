'use strict';

const fs = require('fs');
const path = require('path');

// Small fictional library for the README demo recording. No real BOOTH
// shops/creators are referenced; names are made up for the screenshot.
function buildDemoLibrary(now) {
  const items = [
    { itemId: '80001', itemName: 'Moonlight Kimono', authorName: 'Nocturne Atelier', category: '衣装' },
    { itemId: '80002', itemName: 'Cinder Wolf Hair', authorName: 'Ember Works', category: '髪型' },
    { itemId: '80003', itemName: 'Glass Prism Eyes', authorName: 'Lumen Craft', category: 'テクスチャ' },
    { itemId: '80004', itemName: 'Starlit Original Avatar', authorName: 'Nova Studio', category: 'アバター' },
    { itemId: '80005', itemName: 'Velvet Rose Dress', authorName: 'Nocturne Atelier', category: '衣装' },
    { itemId: '80006', itemName: 'Frostbyte Accessory Set', authorName: 'Ember Works', category: '小物' },
  ];
  return items.map((item, index) => ({
    itemId: item.itemId,
    itemName: item.itemName,
    authorName: item.authorName,
    orderDateTime: new Date(Date.parse(now) - index * 3600000).toISOString(),
    imageUrl: '',
    localImagePath: '',
    categories: [{ name: item.category, slug: item.category }],
    primaryCategory: { name: item.category, slug: item.category },
    tagNames: ['demo'],
    downloadLinks: [{ downloadableId: `9${item.itemId}`, fileName: `${item.itemName.replace(/\s+/g, '_')}.zip` }],
    versionHistory: [],
    latestVersion: { detectedAt: now, filesHash: `demo-hash-${item.itemId}`, filesHashStable: `demo-stable-${item.itemId}` },
    hasUpdate: false,
    lastChecked: now,
  }));
}

function makeItemDir(downloadRoot, itemId, title) {
  const safeName = String(title || '').replace(/[\\/:*?"<>|]/g, '_');
  const dir = path.join(downloadRoot, `${itemId}_${safeName}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createDemoData(dataDir) {
  const downloadRoot = path.join(dataDir, 'downloads');
  fs.mkdirSync(downloadRoot, { recursive: true });
  const now = new Date().toISOString();
  const items = buildDemoLibrary(now);

  // Item 80004 ships with real (placeholder) files on disk so its preview
  // modal shows a populated file tree instead of an empty/error state.
  const downloadedDir = makeItemDir(downloadRoot, '80004', 'Starlit Original Avatar');
  fs.writeFileSync(path.join(downloadedDir, 'Starlit_Original_Avatar.unitypackage'), 'demo unitypackage placeholder\n', 'utf8');
  const extractedRoot = path.join(downloadedDir, '__extracted');
  fs.mkdirSync(path.join(extractedRoot, 'StarlitAvatar', 'Textures'), { recursive: true });
  fs.mkdirSync(path.join(extractedRoot, 'StarlitAvatar', 'Prefabs'), { recursive: true });
  fs.writeFileSync(path.join(extractedRoot, 'StarlitAvatar', 'Readme.txt'), 'demo readme\n', 'utf8');
  fs.writeFileSync(path.join(extractedRoot, 'StarlitAvatar', 'Prefabs', 'Avatar.prefab'), 'demo prefab placeholder\n', 'utf8');
  fs.writeFileSync(path.join(extractedRoot, 'StarlitAvatar', 'Textures', 'body_albedo.png'), 'demo texture placeholder\n', 'utf8');
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

module.exports = { createDemoData, buildDemoLibrary };
