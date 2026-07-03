'use strict';

/**
 * smoke_test.js
 *
 * 包括的なスモークテスト。
 * 通常実行: node scripts/smoke_test.js
 * Unity実インポートあり: node scripts/smoke_test.js --full
 *
 * ダウンロード/Unity操作はすべて TEMP_DIR に保存し、本番データに影響しない。
 * 終了時に TEMP_DIR を自動削除する。
 *
 * Electron 依存テスト (Cookie 復号・Booth ダウンロード) は
 * Electron プロセス外では自動スキップ。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
const axios = require('axios');

const ROOT = path.join(__dirname, '..');
const PROD_DATA_DIR = path.join(process.env.APPDATA, 'avatool', 'data');
const TEMP_DIR = path.join(os.tmpdir(), `avatool_smoke_${Date.now()}`);
const FULL = process.argv.includes('--full');

// Electron 環境かどうか（safeStorage が使えるか）
function isElectronContext() {
  try {
    const electron = require('electron');
    return Boolean(electron?.safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}
const IN_ELECTRON = isElectronContext();

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

async function test(name, fn, { skip = false, skipReason = '' } = {}) {
  if (skip) {
    process.stdout.write(`  ${name} ... SKIP (${skipReason})\n`);
    skipped++;
    return;
  }
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    process.stdout.write('OK\n');
    passed++;
  } catch (e) {
    const msg = e?.message || String(e);
    process.stdout.write(`FAIL: ${msg}\n`);
    failures.push({ name, msg });
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeDirWithRetry(dirPath, attempts = 8, delayMs = 500) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      if (!fs.existsSync(dirPath)) return true;
    } catch (e) {
      lastError = e;
    }
    await sleep(delayMs);
  }
  if (lastError) throw lastError;
  return !fs.existsSync(dirPath);
}

function assertHasKeys(obj, keys) {
  for (const k of keys) {
    assert(k in obj, `missing key: ${k}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadSettings() {
  return readJsonFile(path.join(PROD_DATA_DIR, 'settings.json'));
}

function loadLibraryMeta() {
  const raw = readJsonFile(path.join(PROD_DATA_DIR, 'librarymeta.json'));
  return Array.isArray(raw) ? raw : (raw.items || Object.values(raw));
}

function normalizeProjectPathForSmoke(p) {
  return path.resolve(String(p || '')).replace(/[\\/]+$/, '');
}

function getProjectPathValue(row) {
  if (typeof row === 'string') return row;
  if (row && typeof row === 'object') return row.Path || row.path || row.projectPath || '';
  return '';
}

function findSmokeUnityProject() {
  const candidates = [];
  try {
    const vcc = readJsonFile(path.join(process.env.LOCALAPPDATA, 'VRChatCreatorCompanion', 'settings.json'));
    for (const row of (Array.isArray(vcc.userProjects) ? vcc.userProjects : [])) {
      const p = getProjectPathValue(row);
      if (p) candidates.push(p);
    }
  } catch {
    // fall back to Avatool settings below
  }

  try {
    const settings = loadSettings();
    for (const row of (Array.isArray(settings.unityProjects) ? settings.unityProjects : [])) {
      const p = getProjectPathValue(row);
      if (p) candidates.push(p);
    }
  } catch {
    // no settings fallback available
  }

  const seen = new Set();
  for (const raw of candidates) {
    let projectPath = '';
    try {
      projectPath = normalizeProjectPathForSmoke(raw);
    } catch {
      continue;
    }
    const key = projectPath.toLowerCase();
    if (!projectPath || seen.has(key)) continue;
    seen.add(key);
    const versionPath = path.join(projectPath, 'ProjectSettings', 'ProjectVersion.txt');
    if (fs.existsSync(versionPath)) return projectPath;
  }
  return '';
}

function tryLoadBoothCookies() {
  const { readBoothCookiesFromFile } = require(path.join(ROOT, 'lib/booth_cookie_store'));
  return readBoothCookiesFromFile(path.join(PROD_DATA_DIR, 'booth.pm.json'));
}

function createBoothClientFromCookies(cookies) {
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  return axios.create({
    baseURL: 'https://booth.pm',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://accounts.booth.pm/library',
      'Origin': 'https://booth.pm',
      'Cookie': cookieHeader,
    },
    timeout: 15000,
  });
}

// Unity manager を最小 deps でインスタンス化（Worker は本物を使う）
function createMinimalUnityManager() {
  const { createUnityManager } = require(path.join(ROOT, 'lib', 'unity_manager'));
  const settings = loadSettings();

  const deps = {
    fs,
    path,
    spawn,
    Worker, // worker_threads の本物
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    shell: { showItemInFolder: () => {} },
    getSettings: () => settings,
    saveSettings: () => {},
    normalizeProjectPath: p => path.resolve(String(p || '')).replace(/[\\/]+$/, '').toLowerCase(),
    normalizeUnityProjects: arr => arr,
    dedupeProjects: arr => arr,
    IMPORT_LOG_PATH: path.join(TEMP_DIR, 'import.log'),
    RECONCILE_LOG_PATH: path.join(TEMP_DIR, 'reconcile.log'),
    UNITY_LOG_DIR: path.join(TEMP_DIR, 'unity_logs'),
    APP_DATA_ROOT: PROD_DATA_DIR,
    LEGACY_APP_ROOT: ROOT,
    INSTALL_SCRIPTS_DIR: path.join(ROOT, 'lib', 'unity_templates'),
    backgroundImportRunningProjects: new Set(),
    unityEditorSupport: {
      ensureUnityBatchImporterReady: async () => ({ ok: true, status: 'unchanged' }),
      ensureUnityLiveImporterReady: async () => ({ ok: true, status: 'unchanged' }),
      ensureUnityFolderIconBootstrapReady: async () => ({ ok: true, status: 'unchanged' }),
      cleanupAutoBootstrapSupportScripts: async () => ({}),
    },
    dbgUpdate: () => {},
    appendOperationLog: () => {},
    SIMPLE_FOLDER_ICON_PACKAGE_NAME: 'simple-folder-icon',
    SIMPLE_FOLDER_ICON_PACKAGE_ID: '3220035',
    buildItemDir: (asset) => path.join(TEMP_DIR, 'downloads', String(asset?.itemId || 'unknown')),
    isVpmPackageDir: () => false,
    listVpmPackageRootsInDir: () => [],
    applyVpmPackagesToProject: async () => ({ ok: true }),
    ensureModularAvatarDependency: async () => ({ ok: true }),
    ensureLiltoonDependency: async () => ({ ok: true }),
    VCC_SETTINGS_PATH: path.join(process.env.LOCALAPPDATA, 'VRChatCreatorCompanion', 'settings.json'),
    enqueueAutoBootstrap: () => {},
    runWithBoothCookieLoginFallback: (fn) => fn(),
    getBoothClient: () => null,
    emitVccProjectsUpdated: () => {},
    vccSyncService: { syncVccProjectsToSettings: async () => {} },
    VCC_LOG_DIR: TEMP_DIR,
    ORIG_CONSOLE: console,
    appendRuntimeLog: () => {},
  };

  return createUnityManager(deps);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEMP_DIR, 'unity_logs'), { recursive: true });
  console.log(`TEMP_DIR : ${TEMP_DIR}`);
  console.log(`FULL mode: ${FULL}`);
  console.log(`Electron : ${IN_ELECTRON}`);

  try {
    // -----------------------------------------------------------------------
    console.log('\n=== Phase 1: モジュールロード ===');

    for (const mod of [
      'lib/settings_manager.js',
      'lib/meta_manager.js',
      'lib/download_queue.js',
      'lib/unity_manager.js',
      'lib/ipc_handlers.js',
      'lib/booth_downloader.js',
      'lib/booth_meta_fetcher.js',
      'lib/autobootstrap_service.js',
      'lib/vcc_sync_service.js',
      'lib/unity_editor_support.js',
    ]) {
      await test(mod, () => { require(path.join(ROOT, mod)); });
    }

    // -----------------------------------------------------------------------
    console.log('\n=== Phase 2: 設定ファイル ===');

    await test('settings.json 読み込み・キー確認', () => {
      const s = loadSettings();
      assertHasKeys(s, ['autoBootstrapEnabled', 'autoBootstrapIncludeAvatoolScripts', 'unityProjects', 'concurrency']);
      assert(Array.isArray(s.unityProjects), 'unityProjects is array');
    });

    await test('settings JSON ラウンドトリップ', () => {
      const s = loadSettings();
      const copy = JSON.parse(JSON.stringify(s));
      assert(JSON.stringify(copy) === JSON.stringify(s), 'round-trip mismatch');
    });

    await test('librarymeta.json 読み込み', () => {
      const items = loadLibraryMeta();
      assert(items.length > 0, 'no items');
      for (const item of items.slice(0, 3)) {
        assertHasKeys(item, ['itemId', 'downloadLinks']);
        assert(Array.isArray(item.downloadLinks), 'downloadLinks is not array');
      }
    });

    // -----------------------------------------------------------------------
    console.log('\n=== Phase 3: VCC プロジェクト同期 ===');

    await test('VCC settings.json 存在確認', () => {
      const p = path.join(process.env.LOCALAPPDATA, 'VRChatCreatorCompanion', 'settings.json');
      assert(fs.existsSync(p), `not found: ${p}`);
    });

    await test('VCC ↔ Avatool プロジェクト一致', () => {
      const normalize = p => path.resolve(String(p || '')).replace(/[\\/]+$/, '').toLowerCase();
      const vcc = readJsonFile(path.join(process.env.LOCALAPPDATA, 'VRChatCreatorCompanion', 'settings.json'));
      const vccPaths = (vcc.userProjects || []).map(p => normalize(p.Path || p));
      const s = loadSettings();
      const avatoolPaths = (s.unityProjects || []).map(p => normalize(p.path || p));
      const onlyVcc = vccPaths.filter(p => !avatoolPaths.includes(p));
      const onlyAvatool = avatoolPaths.filter(p => !vccPaths.includes(p));
      assert(onlyVcc.length === 0, `VCCのみ: ${onlyVcc.join(', ')}`);
      assert(onlyAvatool.length === 0, `Avatoolのみ: ${onlyAvatool.join(', ')}`);
    });

    // -----------------------------------------------------------------------
    console.log('\n=== Phase 4: Booth セッション確認 ===');

    await test('Cookie ファイル読み込み', () => {
      const cookies = tryLoadBoothCookies();
      assert(Array.isArray(cookies) && cookies.length > 0, 'no cookies');
    }, { skip: !IN_ELECTRON, skipReason: 'safeStorage は Electron 内でのみ利用可能' });

    await test('Booth ライブラリ API 疎通', async () => {
      const cookies = tryLoadBoothCookies();
      const client = createBoothClientFromCookies(cookies);
      const res = await client.get('/ja/library.json', { params: { page: 1 } });
      assert(res.status === 200, `status: ${res.status}`);
      assert(res.data && typeof res.data === 'object', 'invalid response');
      assert('pages' in res.data || 'items' in res.data || Array.isArray(res.data), 'unexpected shape');
    }, { skip: !IN_ELECTRON, skipReason: 'safeStorage は Electron 内でのみ利用可能' });

    // -----------------------------------------------------------------------
    console.log('\n=== Phase 5: スクリプトテンプレート生成 ===');

    await test('createUnityEditorSupport 初期化', () => {
      const { createUnityEditorSupport } = require(path.join(ROOT, 'lib/unity_editor_support'));
      const support = createUnityEditorSupport({ fs, path, appRoot: ROOT, resourcesPath: null });
      assert(typeof support.ensureBatchImporter === 'function', 'missing ensureBatchImporter');
      assert(typeof support.ensureLiveImporter === 'function', 'missing ensureLiveImporter');
      assert(typeof support.ensureFolderIconBootstrap === 'function', 'missing ensureFolderIconBootstrap');
    });

    for (const name of ['BoothBatchImporter.cs', 'BoothLiveImportBridge.cs', 'AvatoolFolderIconBootstrap.cs']) {
      await test(`${name} テンプレート読み込み`, () => {
        const csPath = path.join(ROOT, 'lib', 'unity_templates', name);
        assert(fs.existsSync(csPath), `not found: ${csPath}`);
        const src = fs.readFileSync(csPath, 'utf8');
        assert(src.length > 100, 'suspiciously small template');
      });
    }

    await test('テンプレートを temp へ書き出し', () => {
      const destDir = path.join(TEMP_DIR, 'templates_out', 'Assets', 'Editor');
      fs.mkdirSync(destDir, { recursive: true });
      for (const name of ['BoothBatchImporter.cs', 'BoothLiveImportBridge.cs', 'AvatoolFolderIconBootstrap.cs']) {
        fs.copyFileSync(path.join(ROOT, 'lib', 'unity_templates', name), path.join(destDir, name));
        assert(fs.existsSync(path.join(destDir, name)), `${name} not copied`);
      }
    });

    await test('ensureUnityBatchImporterReady → temp プロジェクト', async () => {
      const { createUnityEditorSupport } = require(path.join(ROOT, 'lib/unity_editor_support'));
      const support = createUnityEditorSupport({ fs, path, appRoot: ROOT, resourcesPath: null });
      const tempProject = path.join(TEMP_DIR, 'cs_gen_test');
      fs.mkdirSync(path.join(tempProject, 'Assets', 'Editor'), { recursive: true });
      const settings = loadSettings();
      const result = await support.ensureBatchImporter(tempProject, settings);
      assert(result && (result.ok || result.status), `failed: ${JSON.stringify(result)}`);
      assert(fs.existsSync(path.join(tempProject, 'Assets', 'Editor', 'BoothBatchImporter.cs')), 'BatchImporter.cs not written');
      assert(fs.existsSync(path.join(tempProject, 'Assets', 'Editor', 'BoothImportShared.cs')), 'BoothImportShared.cs not written');
    });

    // -----------------------------------------------------------------------
    console.log('\n=== Phase 6: ドライラン解析 ===');

    const existingPackages = [
      path.join(PROD_DATA_DIR, 'downloads', '3087170_liltoon', '__extracted', 'lilToon_1.x.x', 'lilToon_1.x.x', 'jp.lilxyzw.liltoon-1.x.x-installer.unitypackage'),
      path.join(PROD_DATA_DIR, 'downloads', '4915091_FaceEmo', '__extracted', 'FaceEmo-1.x.x-installer-1.2.0', 'FaceEmo-1.x.x-installer-1.2.0', 'FaceEmo-1.x.x-installer.unitypackage'),
    ].filter(p => fs.existsSync(p));
    const smokeUnityProject = findSmokeUnityProject();

    await test('.unitypackage ファイル確認', () => {
      assert(existingPackages.length > 0, 'no .unitypackage files found');
    });

    await test('validateImportPackages', () => {
      const unityMgr = createMinimalUnityManager();
      const pkgs = existingPackages.map(p => ({ packagePath: p }));
      const result = unityMgr.validateImportPackages(pkgs);
      assertHasKeys(result, ['validPackages', 'invalidPaths']);
      assert(result.validPackages.length > 0, `all packages invalid (invalidPaths: ${result.invalidPaths.join(', ')})`);
    });

    await test('planTopFolderRenames', () => {
      const unityMgr = createMinimalUnityManager();
      const pkgs = existingPackages.map(p => ({
        packagePath: p,
        itemId: path.basename(path.dirname(path.dirname(path.dirname(p)))).split('_')[0],
        title: path.basename(p, '.unitypackage'),
        meta: { topFolders: [], tokens: [] },
      }));
      const result = unityMgr.planTopFolderRenames(smokeUnityProject || TEMP_DIR, pkgs);
      assertHasKeys(result, ['packages', 'renameEntries']);
      assert(Array.isArray(result.renameEntries), 'renameEntries is not array');
    });

    await test('analyzeImportToolDependencies', async () => {
      const unityMgr = createMinimalUnityManager();
      const pkgs = existingPackages.map(p => ({ packagePath: p, meta: {} }));
      const result = await unityMgr.analyzeImportToolDependencies(smokeUnityProject || TEMP_DIR, pkgs);
      assertHasKeys(result, ['ok', 'missing', 'scannedPackages']);
      assert(result.ok === true, 'result.ok is not true');
      assert(Array.isArray(result.missing), 'missing is not array');
    });

    // -----------------------------------------------------------------------
    console.log('\n=== Phase 7: Booth ダウンロード (temp) ===');

    await test('ダウンロード実行 (liltoon 1ファイル → temp)', async () => {
      const cookies = tryLoadBoothCookies();
      const client = createBoothClientFromCookies(cookies);

      const downloader = require(path.join(ROOT, 'lib/booth_downloader'));
      downloader.setDataRoot(TEMP_DIR);

      const items = loadLibraryMeta();
      const liltoon = items.find(i => String(i.itemId) === '3087170');
      assert(liltoon, 'liltoon not found in librarymeta');

      const asset = {
        itemId: liltoon.itemId,
        title: liltoon.itemName || 'liltoon',
        files: [liltoon.downloadLinks[0]], // 最初の1ファイルのみ
      };

      const result = await downloader.downloadItemFiles(asset, client, cookies, (p) => {
        if (p?.status === 'progress') {
          process.stdout.write(`\r    ${Math.round((p.receivedBytes || 0) / 1024)}KB / ${Math.round((p.totalBytes || 0) / 1024)}KB`);
        }
      });
      process.stdout.write('\r                                        \r');

      assert(!result?.error, `download error: ${result?.error}`);
      const downloadedDir = path.join(TEMP_DIR, 'downloads');
      const entries = fs.readdirSync(downloadedDir).filter(e => e.startsWith('3087170'));
      assert(entries.length > 0, 'no downloaded dir in temp');
      const files = fs.readdirSync(path.join(downloadedDir, entries[0]));
      assert(files.length > 0, 'no files downloaded');
    }, { skip: !IN_ELECTRON, skipReason: 'safeStorage は Electron 内でのみ利用可能' });

    // -----------------------------------------------------------------------
    if (FULL) {
      console.log('\n=== Phase 8: Unity バッチインポート (temp プロジェクト) ===');

      const tempProjectPath = path.join(TEMP_DIR, 'unity_project');

      await test('temp Unity プロジェクト作成', () => {
        assert(smokeUnityProject, 'no VCC/Avatool Unity project with ProjectSettings/ProjectVersion.txt found');
        fs.mkdirSync(path.join(tempProjectPath, 'ProjectSettings'), { recursive: true });
        fs.mkdirSync(path.join(tempProjectPath, 'Assets', 'Editor'), { recursive: true });
        const srcVersion = path.join(smokeUnityProject, 'ProjectSettings', 'ProjectVersion.txt');
        fs.copyFileSync(srcVersion, path.join(tempProjectPath, 'ProjectSettings', 'ProjectVersion.txt'));
        fs.copyFileSync(
          path.join(ROOT, 'lib', 'unity_templates', 'BoothBatchImporter.cs'),
          path.join(tempProjectPath, 'Assets', 'Editor', 'BoothBatchImporter.cs')
        );
        fs.copyFileSync(
          path.join(ROOT, 'lib', 'unity_templates', 'BoothImportShared.cs'),
          path.join(tempProjectPath, 'Assets', 'Editor', 'BoothImportShared.cs')
        );
        assert(fs.existsSync(path.join(tempProjectPath, 'Assets', 'Editor', 'BoothBatchImporter.cs')));
        assert(fs.existsSync(path.join(tempProjectPath, 'Assets', 'Editor', 'BoothImportShared.cs')));
      });

      await test('runUnityBatchImport (liltoon → temp プロジェクト)', async () => {
        assert(existingPackages.length > 0, 'no packages for import');
        const unityMgr = createMinimalUnityManager();
        const result = await unityMgr.runUnityBatchImport(
          tempProjectPath,
          [existingPackages[0]],
          (p) => {
            if (p?.phase) process.stdout.write(`\r    Unity: ${p.phase} ${p.completed || 0}/${p.total || 0}`);
          },
          {}
        );
        process.stdout.write('\r                                              \r');
        assert(!result?.error, `import error: ${result?.error}`);
      });
    } else {
      console.log('\n=== Phase 8: Unity バッチインポート → --full で有効 ===');
    }

  } finally {
    try {
      const downloader = require(path.join(ROOT, 'lib/booth_downloader'));
      downloader.setDataRoot('');
    } catch {}

    try {
      await removeDirWithRetry(TEMP_DIR);
      console.log(`\nTEMP_DIR 削除済み: ${TEMP_DIR}`);
    } catch (e) {
      console.warn(`TEMP_DIR 削除失敗: ${e.message}`);
    }
  }

  console.log('\n========================================');
  console.log(`結果: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failures.length > 0) {
    console.log('\n失敗一覧:');
    for (const f of failures) console.log(`  [FAIL] ${f.name}: ${f.msg}`);
  }
  console.log('========================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\n予期しないエラー:', e);
  process.exit(1);
});
