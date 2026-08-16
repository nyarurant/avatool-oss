'use strict';

const os = require('os');
const net = require('net');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { fileURLToPath } = require('url');
const axios = require('axios');

const MODULAR_AVATAR_PACKAGE_NAME = 'nadena.dev.modular-avatar';
const NDMF_PACKAGE_NAME = 'nadena.dev.ndmf';

function createUnityManager(deps) {
  const {
    fs,
    path,
    spawn,
    Worker,
    nativeImage,
    shell,
    getSettings,
    saveSettings,
    normalizeProjectPath,
    normalizeUnityProjects,
    dedupeProjects,
    IMPORT_LOG_PATH,
    RECONCILE_LOG_PATH,
    UNITY_LOG_DIR,
    APP_DATA_ROOT,
    LEGACY_APP_ROOT,
    INSTALL_SCRIPTS_DIR,
    backgroundImportRunningProjects,
    unityEditorSupport,
    dbgUpdate,
    appendOperationLog,
    SIMPLE_FOLDER_ICON_PACKAGE_NAME,
    SIMPLE_FOLDER_ICON_PACKAGE_ID,
    buildItemDir,
    isVpmPackageDir,
    listVpmPackageRootsInDir,
    applyVpmPackagesToProject,
    ensureModularAvatarDependency,
    ensureLiltoonDependency,
    VCC_SETTINGS_PATH,
    enqueueAutoBootstrap,
    runWithBoothCookieLoginFallback,
    getBoothClient,
    emitVccProjectsUpdated,
    vccSyncService,
    VCC_LOG_DIR,
    ORIG_CONSOLE,
    appendRuntimeLog,
  } = deps;

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function readJsonSafe(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Path/key utilities
  // ---------------------------------------------------------------------------

  function normalizeFsPathKey(targetPath) {
    const raw = String(targetPath || '').trim();
    if (!raw) return '';
    let resolved = '';
    try {
      resolved = path.resolve(raw);
    } catch {
      resolved = raw;
    }
    resolved = resolved.replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  // ---------------------------------------------------------------------------
  // Settings helpers
  // ---------------------------------------------------------------------------

  function isRegisteredUnityProject(projectPath) {
    const settings = getSettings();
    const target = normalizeProjectPath(projectPath);
    if (!target) return false;
    const rows = normalizeUnityProjects(settings?.unityProjects);
    return rows.some((p) => normalizeProjectPath(p?.path || '') === target);
  }

  // ---------------------------------------------------------------------------
  // Unity editor validation
  // ---------------------------------------------------------------------------

  function validateUnityEditorPathSetting() {
    const settings = getSettings();
    const raw = String(settings?.unityEditorPath || '').trim();
    if (!raw) return { ok: false, error: 'unity_editor_not_found' };
    if (!path.isAbsolute(raw)) return { ok: false, error: 'unity_editor_path_not_absolute' };
    if (!fs.existsSync(raw)) return { ok: false, error: 'unity_editor_not_found' };
    let stat = null;
    try {
      stat = fs.statSync(raw);
    } catch {
      return { ok: false, error: 'unity_editor_not_found' };
    }
    if (!stat?.isFile?.()) return { ok: false, error: 'unity_editor_invalid' };
    const base = String(path.basename(raw || '') || '').toLowerCase();
    if (process.platform === 'win32' && base !== 'unity.exe') return { ok: false, error: 'unity_editor_invalid' };
    try {
      fs.accessSync(raw, fs.constants.R_OK);
    } catch {
      return { ok: false, error: 'unity_editor_invalid' };
    }
    return { ok: true, path: raw };
  }

  function isValidUnityPackagePath(pkgPath) {
    const raw = String(pkgPath || '').trim();
    if (!raw) return false;
    if (raw.includes('\u0000')) return false;
    if (!path.isAbsolute(raw)) return false;
    if (String(path.extname(raw) || '').toLowerCase() !== '.unitypackage') return false;
    try {
      const stat = fs.statSync(raw);
      return Boolean(stat?.isFile?.());
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Feature flags
  // ---------------------------------------------------------------------------

  function isFolderIconBootstrapEnabled() {
    const settings = getSettings();
    return settings.autoBootstrapIncludeAvatoolScripts !== false
      && settings.autoBootstrapIncludeFolderIconBootstrap !== false;
  }

  function canRunUnityImport() {
    const settings = getSettings();
    return settings.autoBootstrapIncludeAvatoolScripts !== false;
  }

  // ---------------------------------------------------------------------------
  // Background import project lock
  // ---------------------------------------------------------------------------

  function acquireBackgroundImportProjectLock(projectPath) {
    const key = normalizeFsPathKey(projectPath);
    if (!key) return { ok: false, error: 'project_not_found' };
    if (backgroundImportRunningProjects.has(key)) return { ok: false, error: 'background_import_already_running' };
    backgroundImportRunningProjects.add(key);
    return { ok: true, key };
  }

  function releaseBackgroundImportProjectLock(lockKey) {
    const key = normalizeFsPathKey(lockKey);
    if (!key) return;
    backgroundImportRunningProjects.delete(key);
  }

  // ---------------------------------------------------------------------------
  // Unity project lock detection
  // ---------------------------------------------------------------------------

  function isUnityProjectLocked(projectPath) {
    try {
      const lockFile = path.join(projectPath, 'Temp', 'UnityLockfile');
      if (!fs.existsSync(lockFile)) return false;
      const probePath = `${lockFile}.probe.${process.pid}`;
      try {
        fs.renameSync(lockFile, probePath);
        fs.renameSync(probePath, lockFile);
        console.log('[UnityLock] stale lockfile detected; allowing import:', lockFile);
        return false;
      } catch (e) {
        console.warn('[UnityLock] lockfile appears active; blocking import:', lockFile, e?.message || e);
        try {
          if (fs.existsSync(probePath) && !fs.existsSync(lockFile)) {
            fs.renameSync(probePath, lockFile);
          }
        } catch {
          // ignore restore failure
        }
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Import history
  // ---------------------------------------------------------------------------

  function loadImportHistory() {
    try {
      if (!fs.existsSync(IMPORT_LOG_PATH)) return {};
      const parsed = JSON.parse(fs.readFileSync(IMPORT_LOG_PATH, 'utf8'));
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
      return parsed;
    } catch {
      return {};
    }
  }

  function writeImportHistory(history) {
    try {
      fs.writeFileSync(IMPORT_LOG_PATH, JSON.stringify(history, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.warn('Import history save failed:', e?.message || e);
      return false;
    }
  }

  function appendImportHistory(projectPath, packages) {
    const history = loadImportHistory();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const projectName = path.basename(projectPath || '');
    const importedAt = new Date().toISOString();

    for (const p of (packages || [])) {
      const key = String(p?.itemId || '').trim();
      if (!key) continue;
      if (!Array.isArray(history[key])) history[key] = [];
      history[key].push({
        projectPath: normalizedProjectPath,
        projectName,
        importedAt,
        title: String(p?.title || ''),
        packagePath: String(p?.packagePath || ''),
        topFolders: Array.isArray(p?.meta?.topFolders) ? p.meta.topFolders : [],
        tokens: Array.isArray(p?.meta?.tokens) ? p.meta.tokens : [],
      });
    }

    writeImportHistory(history);
  }

  function appendReconciledImportHistory(projectPath, packages) {
    const history = loadImportHistory();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const projectName = path.basename(projectPath || '');
    const importedAt = new Date().toISOString();

    // 重複チェック用 Set を itemId ごとに事前構築
    const existingSets = new Map();
    const getExistingSet = (itemKey) => {
      if (!existingSets.has(itemKey)) {
        const set = new Set((history[itemKey] || []).map((h) =>
          `${normalizeProjectPath(h?.projectPath || '')}::${String(h?.packagePath || '')}`
        ));
        existingSets.set(itemKey, set);
      }
      return existingSets.get(itemKey);
    };

    for (const p of (packages || [])) {
      const key = String(p?.itemId || '').trim();
      if (!key) continue;
      if (!Array.isArray(history[key])) history[key] = [];
      const existingSet = getExistingSet(key);
      const dedupeKey = `${normalizedProjectPath}::${String(p?.packagePath || '')}`;
      if (existingSet.has(dedupeKey)) continue;
      existingSet.add(dedupeKey);
      history[key].push({
        projectPath: normalizedProjectPath,
        projectName,
        importedAt,
        title: String(p?.title || ''),
        packagePath: String(p?.packagePath || ''),
        topFolders: Array.isArray(p?.meta?.topFolders) ? p.meta.topFolders : [],
        tokens: Array.isArray(p?.meta?.tokens) ? p.meta.tokens : [],
        reconciled: true,
      });
    }

    writeImportHistory(history);
  }

  // ---------------------------------------------------------------------------
  // Reconcile log
  // ---------------------------------------------------------------------------

  function loadReconcileLog() {
    try {
      if (!fs.existsSync(RECONCILE_LOG_PATH)) return [];
      const text = fs.readFileSync(RECONCILE_LOG_PATH, 'utf8');
      return text.split(/\r?\n/).filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  function writeReconcileLog(entry) {
    try {
      fs.appendFileSync(RECONCILE_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch { /* 診断ログ書き込み失敗は本処理に影響しないため無視 */ }
  }

  function writeReconcileLogBatch(entries) {
    if (!Array.isArray(entries) || !entries.length) return;
    try {
      fs.appendFileSync(RECONCILE_LOG_PATH, entries.map((e) => `${JSON.stringify(e)}\n`).join(''), 'utf8');
    } catch { /* 診断ログ書き込み失敗は本処理に影響しないため無視 */ }
  }

  // ---------------------------------------------------------------------------
  // Package path listing
  // ---------------------------------------------------------------------------

  function listUnityPackagesInDir(rootDir) {
    const out = [];
    if (!rootDir || !fs.existsSync(rootDir)) return out;
    const stack = [rootDir];
    while (stack.length) {
      const cur = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        const full = path.join(cur, ent.name);
        if (ent.isDirectory()) {
          stack.push(full);
        } else if (ent.isFile() && String(ent.name || '').toLowerCase().endsWith('.unitypackage')) {
          out.push(full);
        }
      }
    }
    return out;
  }

  function listSourceImportRootsInDir(itemDir) {
    const out = [];
    const extractedRoot = path.join(String(itemDir || ''), '__extracted');
    if (!extractedRoot || !fs.existsSync(extractedRoot)) return out;
    const stack = [extractedRoot];
    while (stack.length) {
      const cur = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      const hasAssetsDir = entries.some((e) => e.isDirectory() && String(e.name || '') === 'Assets');
      if (hasAssetsDir) out.push(cur);
      for (const ent of entries) {
        if (ent.isDirectory()) stack.push(path.join(cur, ent.name));
      }
    }
    return Array.from(new Set(out));
  }

  // ---------------------------------------------------------------------------
  // Directory copy helpers
  // ---------------------------------------------------------------------------

  function copyDirMerge(srcDir, dstDir) {
    if (!fs.existsSync(srcDir)) return;
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const ent of entries) {
      const src = path.join(srcDir, ent.name);
      const dst = path.join(dstDir, ent.name);
      if (ent.isDirectory()) {
        copyDirMerge(src, dst);
      } else if (ent.isFile()) {
        fs.copyFileSync(src, dst);
      }
    }
  }

  function applySourceRootsToProject(projectPath, sourceRows) {
    const rows = Array.isArray(sourceRows) ? sourceRows : [];
    let applied = 0;
    for (const row of rows) {
      const sourceRoot = String(row?.sourceRoot || '').trim();
      if (!sourceRoot || !fs.existsSync(sourceRoot)) continue;
      const roots = ['Assets', 'Packages'];
      let copiedAny = false;
      for (const top of roots) {
        const srcTop = path.join(sourceRoot, top);
        if (!fs.existsSync(srcTop)) continue;
        const dstTop = path.join(projectPath, top);
        copyDirMerge(srcTop, dstTop);
        copiedAny = true;
      }
      if (copiedAny) applied += 1;
    }
    return { ok: true, applied };
  }

  // ---------------------------------------------------------------------------
  // Package validation
  // ---------------------------------------------------------------------------

  function validateImportPackages(packages) {
    const validPackages = [];
    const invalidPaths = [];
    for (const p of (packages || [])) {
      const pkgPath = String(p?.packagePath || '').trim();
      if (!pkgPath) continue;
      if (isValidUnityPackagePath(pkgPath)) validPackages.push({ ...p, packagePath: pkgPath });
      else invalidPaths.push(pkgPath);
    }
    return { validPackages, invalidPaths };
  }

  // ---------------------------------------------------------------------------
  // SimpleFolderIcon helpers
  // ---------------------------------------------------------------------------

  function resolveSimpleFolderIconPackagePath() {
    const candidates = [
      path.join(INSTALL_SCRIPTS_DIR, SIMPLE_FOLDER_ICON_PACKAGE_NAME),
      path.join(__dirname, 'unity_templates', SIMPLE_FOLDER_ICON_PACKAGE_NAME),
      path.join(LEGACY_APP_ROOT, 'scripts', SIMPLE_FOLDER_ICON_PACKAGE_NAME),
    ];
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'lib', 'unity_templates', SIMPLE_FOLDER_ICON_PACKAGE_NAME));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'lib', 'unity_templates', SIMPLE_FOLDER_ICON_PACKAGE_NAME));
    }
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return '';
  }

  function ensureInstallScriptsAssets() {
    try {
      if (!fs.existsSync(INSTALL_SCRIPTS_DIR)) fs.mkdirSync(INSTALL_SCRIPTS_DIR, { recursive: true });
      const dst = path.join(INSTALL_SCRIPTS_DIR, SIMPLE_FOLDER_ICON_PACKAGE_NAME);
      const srcCandidates = [
        path.join(__dirname, 'unity_templates', SIMPLE_FOLDER_ICON_PACKAGE_NAME),
        path.join(LEGACY_APP_ROOT, 'scripts', SIMPLE_FOLDER_ICON_PACKAGE_NAME),
        process.resourcesPath ? path.join(process.resourcesPath, 'lib', 'unity_templates', SIMPLE_FOLDER_ICON_PACKAGE_NAME) : '',
        process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'lib', 'unity_templates', SIMPLE_FOLDER_ICON_PACKAGE_NAME) : '',
      ].filter(Boolean);
      const src = srcCandidates.find((p) => fs.existsSync(p)) || '';
      if (!src) return { ok: false, error: 'source_not_found' };
      if (path.resolve(src) === path.resolve(dst)) return { ok: true, path: dst, copied: false };
      let shouldCopy = !fs.existsSync(dst);
      if (!shouldCopy) {
        try {
          const srcStat = fs.statSync(src);
          const dstStat = fs.statSync(dst);
          shouldCopy = srcStat.size !== dstStat.size;
        } catch {
          shouldCopy = true;
        }
      }
      if (shouldCopy) fs.copyFileSync(src, dst);
      return { ok: true, path: dst, copied: shouldCopy };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  function installSimpleFolderIconAsPackage(projectPath) {
    const settings = getSettings();
    if (settings.autoBootstrapIncludeSimpleFolderIcon === false) {
      return { ok: true, installed: 0, skipped: 0, status: 'disabled' };
    }
    const zlib = require('zlib');
    const destRoot = path.join(String(projectPath || ''), 'Packages', 'com.seaeees.simple-folder-icon');
    if (fs.existsSync(destRoot)) return { ok: true, installed: 0, skipped: 0, status: 'already_installed' };
    const pkgPath = resolveSimpleFolderIconPackagePath();
    if (!pkgPath) return { ok: false, error: 'package_not_found' };
    try {
      const raw = fs.readFileSync(pkgPath);
      const buf = zlib.gunzipSync(raw);
      const fileMap = {};
      let offset = 0;
      while (offset + 512 <= buf.length) {
        const hdr = buf.slice(offset, offset + 512);
        offset += 512;
        let allZero = true;
        for (let i = 0; i < 512; i++) { if (hdr[i] !== 0) { allZero = false; break; } }
        if (allZero) break;
        let nameEnd = 0;
        while (nameEnd < 100 && hdr[nameEnd] !== 0) nameEnd++;
        const name = hdr.slice(0, nameEnd).toString('utf8');
        let sizeOctal = '';
        for (let i = 124; i < 136; i++) { const b = hdr[i]; if (b === 0 || b === 32) break; sizeOctal += String.fromCharCode(b); }
        const size = parseInt(sizeOctal, 8) || 0;
        const typeFlag = String.fromCharCode(hdr[156]);
        const data = (size > 0 && typeFlag !== '5') ? Buffer.from(buf.slice(offset, offset + size)) : null;
        offset += Math.ceil(size / 512) * 512;
        const slashIdx = name.indexOf('/');
        if (slashIdx < 0) continue;
        const guid = name.slice(0, slashIdx);
        const entryName = name.slice(slashIdx + 1).replace(/\/$/, '');
        if (!fileMap[guid]) fileMap[guid] = {};
        if (entryName === 'pathname' && data) fileMap[guid].pathname = data.toString('utf8').split('\n')[0].trim();
        else if (entryName === 'asset' && data) fileMap[guid].asset = data;
        else if (entryName === 'asset.meta' && data) fileMap[guid].assetMeta = data;
      }
      let installed = 0;
      let skipped = 0;
      for (const entry of Object.values(fileMap)) {
        const pname = String(entry.pathname || '').trim();
        if (!pname.startsWith('Packages/com.seaeees.simple-folder-icon')) continue;
        const rel = pname.slice('Packages/'.length).split('/');
        const destFile = path.join(String(projectPath || ''), 'Packages', ...rel);
        if (entry.asset) {
          if (fs.existsSync(destFile)) { skipped++; continue; }
          fs.mkdirSync(path.dirname(destFile), { recursive: true });
          fs.writeFileSync(destFile, entry.asset);
          installed++;
          if (entry.assetMeta) fs.writeFileSync(destFile + '.meta', entry.assetMeta);
        } else if (entry.assetMeta) {
          fs.mkdirSync(destFile, { recursive: true });
          const metaPath = destFile + '.meta';
          if (!fs.existsSync(metaPath)) fs.writeFileSync(metaPath, entry.assetMeta);
        }
      }
      const manifestPath = path.join(String(projectPath || ''), 'Packages', 'manifest.json');
      try {
        const manifest = readJsonSafe(manifestPath) || {};
        if (!manifest.dependencies || typeof manifest.dependencies !== 'object') manifest.dependencies = {};
        if (!manifest.dependencies[SIMPLE_FOLDER_ICON_PACKAGE_ID]) {
          manifest.dependencies[SIMPLE_FOLDER_ICON_PACKAGE_ID] = `file:${SIMPLE_FOLDER_ICON_PACKAGE_ID}`;
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        }
      } catch { /* manifest.json更新失敗時もパッケージ本体は展開済みのためok:trueで継続 */ }
      return { ok: true, installed, skipped };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  function appendSimpleFolderIconToBatchPackages(packages) {
    return Array.isArray(packages) ? [...packages] : [];
  }

  // ---------------------------------------------------------------------------
  // File name sanitization and folder naming
  // ---------------------------------------------------------------------------

  function sanitizeFileName(name, fallback = 'icon') {
    const raw = String(name || '').trim();
    const cleaned = raw
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim();
    if (cleaned) return cleaned.slice(0, 120);
    const fallbackName = String(fallback || 'icon').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim();
    return (fallbackName || 'icon').slice(0, 120);
  }

  function listTopAssetFolderNames(projectPath) {
    try {
      const assetsDir = path.join(String(projectPath || '').trim(), 'Assets');
      if (!assetsDir || !fs.existsSync(assetsDir)) return [];
      return fs.readdirSync(assetsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => String(e.name || '').trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function createUniqueTopFolderName(baseName, suffixSeed, reservedLowerSet) {
    const base = sanitizeFileName(baseName, 'Asset');
    const suffix = sanitizeFileName(suffixSeed, 'item');
    const primary = sanitizeFileName(`${base}__${suffix}`, base);
    let candidate = primary;
    let n = 2;
    while (reservedLowerSet.has(String(candidate || '').toLowerCase())) {
      candidate = sanitizeFileName(`${primary}_${n}`, primary);
      n += 1;
      if (n > 2000) break;
    }
    return candidate;
  }

  function planTopFolderRenames(projectPath, importedPackages) {
    const rows = Array.isArray(importedPackages) ? importedPackages : [];
    const cloned = rows.map((row) => ({
      ...(row || {}),
      meta: {
        topFolders: Array.isArray(row?.meta?.topFolders)
          ? row.meta.topFolders.map((tf) => ({ ...(tf || {}) }))
          : [],
        tokens: Array.isArray(row?.meta?.tokens) ? [...row.meta.tokens] : [],
      },
    }));
    const reserved = new Set(listTopAssetFolderNames(projectPath).map((n) => String(n || '').toLowerCase()));
    const renameEntries = [];
    const targetByTopAndItem = new Map();

    for (const row of cloned) {
      const pkgPath = String(row?.packagePath || '').trim();
      const pkgName = String(path.basename(pkgPath) || '').toLowerCase();
      if (!pkgPath || pkgName === SIMPLE_FOLDER_ICON_PACKAGE_NAME.toLowerCase()) continue;
      const top = String(row?.meta?.topFolders?.[0]?.name || '').trim();
      if (!top) continue;

      const topLower = top.toLowerCase();
      const itemId = String(row?.itemId || '').trim();

      if (itemId) {
        // itemId がある場合は常に top__itemId 形式に強制する（同一 itemId は同一フォルダ）
        let nextName = String(targetByTopAndItem.get(itemId) || '').trim();
        if (!nextName) {
          nextName = createUniqueTopFolderName(top, itemId, reserved);
          if (nextName) targetByTopAndItem.set(itemId, nextName);
        }
        const nextLower = String(nextName || '').toLowerCase();
        if (!nextName || nextLower === topLower) {
          reserved.add(topLower);
          continue;
        }
        if (!reserved.has(nextLower)) reserved.add(nextLower);
        row.meta.topFolders[0] = {
          ...(row.meta.topFolders[0] || {}),
          name: nextName,
          originalName: top,
        };
        appendOperationLog('import-rename-plan', `アイテムID強制リネーム: ${top} -> ${nextName}`, {
          packagePath: pkgPath,
          itemId,
          title: String(row?.title || ''),
          sourceTopFolder: top,
          targetTopFolder: nextName,
        });
        renameEntries.push({
          packagePath: pkgPath,
          sourceTopFolder: top,
          targetTopFolder: nextName,
        });
        continue;
      }

      // itemId なし: 既存の衝突時のみリネーム
      const groupKey = `${topLower}::`;
      if (!reserved.has(topLower)) {
        reserved.add(topLower);
        continue;
      }
      let nextName = String(targetByTopAndItem.get(groupKey) || '').trim();
      if (!nextName) {
        const suffixSeed = String(row?.title || path.basename(pkgPath, path.extname(pkgPath)) || 'item').trim();
        nextName = createUniqueTopFolderName(top, suffixSeed, reserved);
        if (nextName) targetByTopAndItem.set(groupKey, nextName);
      }
      if (!nextName || nextName.toLowerCase() === topLower) continue;
      reserved.add(nextName.toLowerCase());
      row.meta.topFolders[0] = {
        ...(row.meta.topFolders[0] || {}),
        name: nextName,
        originalName: top,
      };
      appendOperationLog('import-rename-plan', `フォルダ重複を検出: ${top} -> ${nextName}`, {
        packagePath: pkgPath,
        itemId: '',
        title: String(row?.title || ''),
        sourceTopFolder: top,
        targetTopFolder: nextName,
      });
      renameEntries.push({
        packagePath: pkgPath,
        sourceTopFolder: top,
        targetTopFolder: nextName,
      });
    }

    if (renameEntries.length > 0) {
      appendOperationLog('import-rename-plan', `リネーム計画を作成: ${renameEntries.length} 件`, {
        projectPath: normalizeProjectPath(projectPath),
        count: renameEntries.length,
      });
    }
    return { packages: cloned, renameEntries };
  }

  // ---------------------------------------------------------------------------
  // プロジェクトインデックスキャッシュ（Assets/ mtime で無効化）
  // ---------------------------------------------------------------------------

  const projectIndexCache = new Map(); // projectPath → { mtimeMs, pathsSet, lcPaths, words }

  function computeProjectFingerprint(projectPath) {
    const assetsDir = path.join(projectPath, 'Assets');
    let fp = '';
    try {
      fp += fs.statSync(assetsDir).mtimeMs + '|';
      const children = fs.readdirSync(assetsDir, { withFileTypes: true });
      for (const e of children) {
        if (!e.isDirectory()) continue;
        try { fp += `${e.name}:${fs.statSync(path.join(assetsDir, e.name)).mtimeMs};`; } catch { /* 走査中の削除等でstat失敗した項目はfingerprintから除外 */ }
      }
    } catch { return null; }
    return fp;
  }

  function getProjectIndexCached(projectPath) {
    const cached = projectIndexCache.get(projectPath);
    if (!cached) return null;
    const fp = computeProjectFingerprint(projectPath);
    if (!fp || cached.fingerprint !== fp) { projectIndexCache.delete(projectPath); return null; }
    return cached;
  }

  function setProjectIndexCache(projectPath, index) {
    projectIndexCache.set(projectPath, index);
    // 最大10プロジェクト保持
    if (projectIndexCache.size > 10) {
      projectIndexCache.delete(projectIndexCache.keys().next().value);
    }
  }

  // ---------------------------------------------------------------------------
  // Reconcile worker
  // ---------------------------------------------------------------------------

  function runReconcileWorker(mode, payload) {
    return new Promise((resolve) => {
      const workerPath = path.join(__dirname, 'unity_reconcile_worker.js');
      const workerPayload = {
        ...(payload && typeof payload === 'object' ? payload : {}),
        appDataRoot: APP_DATA_ROOT,
      };
      const worker = new Worker(workerPath, { workerData: { mode, payload: workerPayload } });
      let settled = false;
      let timer = null;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(v);
      };
      timer = setTimeout(() => {
        worker.terminate();
        finish({ error: 'worker_timeout' });
      }, 120000);
      worker.once('message', (msg) => finish(msg || { error: 'empty_worker_response' }));
      worker.once('error', (err) => finish({ error: err?.message || String(err) }));
      worker.once('exit', (code) => {
        if (!settled) finish({ error: code !== 0 ? `worker_exit_${code}` : 'worker_exit_no_message' });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Package meta scan
  // ---------------------------------------------------------------------------

  async function fillPackageMetaByScan(packages) {
    const rows = Array.isArray(packages) ? packages : [];
    return Promise.all(rows.map(async (row) => {
      const next = {
        ...(row || {}),
        meta: {
          topFolders: Array.isArray(row?.meta?.topFolders) ? row.meta.topFolders : [],
          tokens: Array.isArray(row?.meta?.tokens) ? row.meta.tokens : [],
        },
      };
      const pkgPath = String(next?.packagePath || '').trim();
      const pkgName = String(path.basename(pkgPath || '') || '').toLowerCase();
      const hasTopFolders = Array.isArray(next.meta.topFolders) && next.meta.topFolders.length > 0;
      if (!hasTopFolders && pkgPath && fs.existsSync(pkgPath) && pkgName !== SIMPLE_FOLDER_ICON_PACKAGE_NAME.toLowerCase()) {
        try {
          const scanRes = await runReconcileWorker('scan', {
            pkgPath,
            candidateTokens: Array.isArray(next.meta.tokens) ? next.meta.tokens : [],
          });
          if (scanRes?.ok) {
            next.meta.topFolders = Array.isArray(scanRes.topFolders) ? scanRes.topFolders : [];
            if (!next.meta.tokens.length) {
              next.meta.tokens = Array.isArray(scanRes.tokens) ? scanRes.tokens : [];
            }
          }
        } catch {
          // ignore per-package scan errors
        }
      }
      return next;
    }));
  }

  function extractVpmAutoInstallerConfig(pkgPath) {
    try {
      const gzBuf = fs.readFileSync(pkgPath);
      const tarBuf = zlib.gunzipSync(gzBuf);
      const guids = {};
      let pos = 0;
      while (pos + 512 <= tarBuf.length) {
        let allZero = true;
        for (let i = 0; i < 16; i++) { if (tarBuf[pos + i] !== 0) { allZero = false; break; } }
        if (allZero) break;
        const entryName = tarBuf.toString('utf8', pos, pos + 100).replace(/\0+$/, '').trim();
        const size = parseInt(tarBuf.toString('utf8', pos + 124, pos + 136).trim(), 8) || 0;
        const match = entryName.match(/^\.?\/?([0-9a-f]{32})\/(pathname|asset)$/i);
        if (match) {
          const guid = match[1];
          const type = match[2];
          if (!guids[guid]) guids[guid] = {};
          if (type === 'pathname') {
            guids[guid].pathname = tarBuf.toString('utf8', pos + 512, pos + 512 + size).replace(/\0+$/, '').trim();
          } else if (type === 'asset' && size > 0 && size < 65536) {
            guids[guid].asset = tarBuf.toString('utf8', pos + 512, pos + 512 + size).replace(/\0+$/, '').trim();
          }
        }
        pos = pos + 512 + Math.ceil(size / 512) * 512;
      }
      const CONFIG_SUFFIX = 'com.anatawa12.vpm-package-auto-installer/config.json';
      const entry = Object.values(guids).find((e) => String(e.pathname || '').replace(/\\/g, '/').endsWith(CONFIG_SUFFIX));
      if (!entry?.asset) return null;
      return JSON.parse(entry.asset);
    } catch {
      return null;
    }
  }

  function getCpuCount() {
    try {
      const rows = os.cpus();
      return Array.isArray(rows) && rows.length > 0 ? rows.length : 1;
    } catch {
      return 1;
    }
  }

  function getRecommendedReconcileWorkerCount(totalPackages = 1) {
    const cpuCount = getCpuCount();
    const adaptive = Math.max(2, Math.floor(cpuCount * 0.5));
    return Math.max(1, Math.min(8, adaptive, Math.max(1, Number(totalPackages || 1))));
  }

  async function buildPackageMetasAdaptive(packages = [], workerCount = 1) {
    const rows = Array.isArray(packages) ? packages : [];
    const out = new Array(rows.length);

    // 既にスキャン済みのものを先に処理し、未スキャン分だけ Worker に渡す
    const toScan = [];
    for (let i = 0; i < rows.length; i++) {
      const pkg = rows[i] || {};
      const pkgPath = String(pkg?.packagePath || '').trim();
      if (!pkgPath) { out[i] = { ok: false, error: 'package_path_empty' }; continue; }
      if (Array.isArray(pkg?.meta?.assetPaths)) { out[i] = { ok: true, meta: pkg.meta }; continue; }
      toScan.push({ i, pkg, pkgPath });
    }

    if (!toScan.length) return out;

    // LPT スケジューリング: ファイルサイズ大きい順に並べ、ラウンドロビンで各 Worker に割り当て
    // → 最も重いパッケージが異なる Worker に分散され、待ち時間を最小化
    toScan.forEach((item) => {
      try { item.size = fs.statSync(item.pkgPath).size; } catch { item.size = 0; }
    });
    toScan.sort((a, b) => b.size - a.size);
    const n = Math.max(1, Math.min(Math.trunc(Number(workerCount || 1)), toScan.length));
    const chunks = Array.from({ length: n }, () => []);
    const chunkSizes = new Array(n).fill(0);
    for (const item of toScan) {
      const minIdx = chunkSizes.indexOf(Math.min(...chunkSizes));
      chunks[minIdx].push(item);
      chunkSizes[minIdx] += item.size;
    }

    await Promise.all(chunks.map(async (chunk) => {
      const pkgs = chunk.map(({ pkg, pkgPath }) => ({
        pkgPath,
        candidateTokens: Array.isArray(pkg?.candidateTokens)
          ? pkg.candidateTokens
          : (Array.isArray(pkg?.meta?.tokens) ? pkg.meta.tokens : []),
      }));
      const res = await runReconcileWorker('scan_batch', { packages: pkgs });
      chunk.forEach(({ i }, j) => {
        const r = res?.results?.[j];
        if (!res?.ok || !r?.ok) {
          out[i] = { ok: false, error: r?.error || res?.error || 'scan_failed', pkgPath: pkgs[j]?.pkgPath };
        } else {
          out[i] = {
            ok: true,
            meta: {
              topFolders: Array.isArray(r?.topFolders) ? r.topFolders : [],
              tokens: Array.isArray(r?.tokens) ? r.tokens : [],
              assetPaths: Array.isArray(r?.assetPaths) ? r.assetPaths : [],
            },
          };
        }
      });
    }));

    return out;
  }

  // ---------------------------------------------------------------------------
  // Unity log analysis
  // ---------------------------------------------------------------------------

  function analyzeUnityImportLog(logPath) {
    const out = {
      hasAssemblyReloadFailure: false,
      hasArgumentRangeError: false,
      hasNetworkResolveError: false,
    };
    try {
      if (!logPath || !fs.existsSync(logPath)) return out;
      const text = fs.readFileSync(logPath, 'utf8');
      out.hasAssemblyReloadFailure = /Reloading assemblies failed/i.test(text);
      out.hasArgumentRangeError = /ArgumentException:\s*Value does not fall within the expected range/i.test(text);
      out.hasNetworkResolveError = /Could not resolve host/i.test(text);
    } catch { /* ログ読み取り失敗時はデフォルト値(false)のまま返す */ }
    return out;
  }

  function pruneUnityLogs(logDir, maxFiles = 200, maxAgeDays = 30) {
    try {
      if (!fs.existsSync(logDir)) return;
      const now = Date.now();
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      const entries = fs.readdirSync(logDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.log'))
        .map((e) => {
          const fullPath = path.join(logDir, e.name);
          let mtimeMs = 0;
          try {
            mtimeMs = fs.statSync(fullPath).mtimeMs;
          } catch {
            mtimeMs = 0;
          }
          return { fullPath, mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      for (const ent of entries) {
        if (ent.mtimeMs > 0 && (now - ent.mtimeMs) > maxAgeMs) {
          fs.rmSync(ent.fullPath, { force: true });
        }
      }

      const fresh = entries
        .filter((e) => fs.existsSync(e.fullPath))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (let i = maxFiles; i < fresh.length; i += 1) {
        fs.rmSync(fresh[i].fullPath, { force: true });
      }
    } catch (e) {
      console.warn('[unity_manager] pruneUnityLogs failed:', e?.message || e);
    }
  }

  // ---------------------------------------------------------------------------
  // Import result validation
  // ---------------------------------------------------------------------------

  function isLiltoonInstalledInProject(projectPath) {
    try {
      const deps = readProjectManifestDependencies(projectPath);
      if (Object.prototype.hasOwnProperty.call(deps, 'jp.lilxyzw.liltoon')) return true;
      const packagesDir = path.join(String(projectPath || ''), 'Packages');
      if (fs.existsSync(path.join(packagesDir, 'jp.lilxyzw.liltoon'))) return true;
      if (fs.existsSync(path.join(packagesDir, 'jp.lilxyzw.liltoon-2.x.x'))) return true;
      if (fs.existsSync(path.join(String(projectPath || ''), 'Assets', 'lilToon'))) return true;
    } catch { /* 判定失敗時は未インストール扱い(false)として安全側に倒す */ }
    return false;
  }

  function validateAutoBootstrapImportResult(projectPath, packageRows, logPath) {
    const rows = Array.isArray(packageRows) ? packageRows : [];
    const targetedItemIds = new Set(rows.map((r) => String(r?.itemId || '').trim()).filter(Boolean));
    const logFlags = analyzeUnityImportLog(logPath);
    const issues = [];

    // liltoon(3087170) ships installer unitypackage in many cases.
    // Ensure the actual package is present after import.
    if (targetedItemIds.has('3087170') && !isLiltoonInstalledInProject(projectPath)) {
      issues.push('liltoon_not_installed');
    }

    return {
      ok: issues.length === 0,
      issues,
      logFlags,
    };
  }

  // ---------------------------------------------------------------------------
  // Project manifest / tool detection
  // ---------------------------------------------------------------------------

  function readProjectManifestDependencies(projectPath) {
    try {
      const manifestPath = path.join(String(projectPath || ''), 'Packages', 'manifest.json');
      const manifest = readJsonSafe(manifestPath) || {};
      if (manifest.dependencies && typeof manifest.dependencies === 'object') {
        return manifest.dependencies;
      }
    } catch { /* manifest読み取り失敗時は依存関係なし扱いで空オブジェクトを返す */ }
    return {};
  }

  function isModularAvatarInstalledInProject(projectPath) {
    try {
      const deps = readProjectManifestDependencies(projectPath);
      if (Object.prototype.hasOwnProperty.call(deps, MODULAR_AVATAR_PACKAGE_NAME)) return true;
      if (Object.prototype.hasOwnProperty.call(deps, NDMF_PACKAGE_NAME)) return true;
      const packagesDir = path.join(String(projectPath || ''), 'Packages');
      if (fs.existsSync(path.join(packagesDir, MODULAR_AVATAR_PACKAGE_NAME))) return true;
      if (fs.existsSync(path.join(packagesDir, NDMF_PACKAGE_NAME))) return true;
      if (fs.existsSync(path.join(String(projectPath || ''), 'Assets', 'ModularAvatar'))) return true;
    } catch { /* 判定失敗時は未インストール扱い(false)として安全側に倒す */ }
    return false;
  }

  function isVrcFuryInstalledInProject(projectPath) {
    try {
      const deps = readProjectManifestDependencies(projectPath);
      if (Object.prototype.hasOwnProperty.call(deps, 'com.vrcfury.vrcfury')) return true;
      const packagesDir = path.join(String(projectPath || ''), 'Packages');
      if (fs.existsSync(path.join(packagesDir, 'com.vrcfury.vrcfury'))) return true;
      if (fs.existsSync(path.join(String(projectPath || ''), 'Assets', 'VRCFury'))) return true;
    } catch { /* 判定失敗時は未インストール扱い(false)として安全側に倒す */ }
    return false;
  }

  function isAvatarOptimizerInstalledInProject(projectPath) {
    try {
      const deps = readProjectManifestDependencies(projectPath);
      if (Object.prototype.hasOwnProperty.call(deps, 'com.anatawa12.avatar-optimizer')) return true;
      const packagesDir = path.join(String(projectPath || ''), 'Packages');
      if (fs.existsSync(path.join(packagesDir, 'com.anatawa12.avatar-optimizer'))) return true;
      if (fs.existsSync(path.join(String(projectPath || ''), 'Assets', 'AvatarOptimizer'))) return true;
      if (fs.existsSync(path.join(String(projectPath || ''), 'Assets', 'anatawa12', 'AvatarOptimizer'))) return true;
    } catch { /* 判定失敗時は未インストール扱い(false)として安全側に倒す */ }
    return false;
  }

  function isPoiyomiInstalledInProject(projectPath) {
    try {
      const deps = readProjectManifestDependencies(projectPath);
      if (Object.prototype.hasOwnProperty.call(deps, 'com.poiyomi.toon')) return true;
      const packagesDir = path.join(String(projectPath || ''), 'Packages');
      if (fs.existsSync(path.join(packagesDir, 'com.poiyomi.toon'))) return true;
      if (fs.existsSync(path.join(String(projectPath || ''), 'Assets', 'Poiyomi'))) return true;
      if (fs.existsSync(path.join(String(projectPath || ''), 'Assets', '_PoiyomiShaders'))) return true;
    } catch { /* 判定失敗時は未インストール扱い(false)として安全側に倒す */ }
    return false;
  }

  function detectRequiredToolsFromAssetPaths(assetPaths) {
    const set = new Set();
    const paths = Array.isArray(assetPaths) ? assetPaths : [];
    for (const raw of paths) {
      const p = String(raw || '').toLowerCase();
      if (!p) continue;
      if (p.includes('modularavatar') || p.includes('nadena.dev.modular-avatar') || p.includes('/ndmf') || p.includes('nadena.dev.ndmf')) {
        set.add('ma');
      }
      if (p.includes('liltoon') || p.includes('jp.lilxyzw.liltoon')) {
        set.add('liltoon');
      }
      if (p.includes('vrcfury') || p.includes('com.vrcfury.vrcfury')) {
        set.add('vrcfury');
      }
      if (p.includes('avataroptimizer') || p.includes('avatar-optimizer') || p.includes('com.anatawa12.avatar-optimizer')) {
        set.add('avatar_optimizer');
      }
      if (p.includes('poiyomi') || p.includes('com.poiyomi.toon') || p.includes('_poiyomishaders')) {
        set.add('poiyomi');
      }
    }
    return Array.from(set);
  }

  async function analyzeImportToolDependencies(projectPath, packages = []) {
    const rows = Array.isArray(packages) ? packages : [];
    const required = new Set();
    const validPackages = rows
      .map((p) => ({
        packagePath: String(p?.packagePath || '').trim(),
        meta: p?.meta && typeof p.meta === 'object' ? p.meta : {},
      }))
      .filter((p) => p.packagePath && fs.existsSync(p.packagePath));
    for (const p of validPackages) {
      let assetPaths = Array.isArray(p?.meta?.assetPaths) ? p.meta.assetPaths : [];
      if (!assetPaths.length) {
        const scanRes = await runReconcileWorker('scan', {
          pkgPath: p.packagePath,
          candidateTokens: ['modularavatar', 'ndmf', 'liltoon', 'vrcfury', 'avataroptimizer', 'avatar-optimizer', 'poiyomi'],
        });
        if (scanRes?.ok && Array.isArray(scanRes.assetPaths)) {
          assetPaths = scanRes.assetPaths;
        }
      }
      for (const t of detectRequiredToolsFromAssetPaths(assetPaths)) required.add(t);
    }
    const requiredList = Array.from(required);
    const missing = [];
    if (required.has('ma') && !isModularAvatarInstalledInProject(projectPath)) {
      missing.push({ tool: 'ma', label: 'Modular Avatar', installable: true });
    }
    if (required.has('liltoon') && !isLiltoonInstalledInProject(projectPath)) {
      missing.push({ tool: 'liltoon', label: 'liltoon', installable: true });
    }
    if (required.has('vrcfury') && !isVrcFuryInstalledInProject(projectPath)) {
      missing.push({ tool: 'vrcfury', label: 'VRCFury', installable: false });
    }
    if (required.has('avatar_optimizer') && !isAvatarOptimizerInstalledInProject(projectPath)) {
      missing.push({ tool: 'avatar_optimizer', label: 'Avatar Optimizer', installable: false });
    }
    if (required.has('poiyomi') && !isPoiyomiInstalledInProject(projectPath)) {
      missing.push({ tool: 'poiyomi', label: 'Poiyomi', installable: false });
    }
    return {
      ok: true,
      required: requiredList,
      missing,
      scannedPackages: validPackages.length,
    };
  }

  async function installImportToolDependencies(projectPath, tools = []) {
    const req = Array.isArray(tools) ? tools.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean) : [];
    const unique = Array.from(new Set(req));
    const installed = [];
    const failed = [];
    const skipped = [];
    for (const t of unique) {
      if (t === 'ma') {
        const res = await ensureModularAvatarDependency(projectPath);
        if (res?.ok) installed.push('ma');
        else failed.push({ tool: 'ma', error: res?.error || 'ma_install_failed' });
        continue;
      }
      if (t === 'liltoon') {
        const res = await ensureLiltoonDependency(projectPath);
        if (res?.ok) installed.push('liltoon');
        else failed.push({ tool: 'liltoon', error: res?.error || 'liltoon_install_failed' });
        continue;
      }
      skipped.push(t);
    }
    return { ok: failed.length === 0, installed, failed, skipped };
  }

  // ---------------------------------------------------------------------------
  // Image helpers (nativeImage / electron)
  // ---------------------------------------------------------------------------

  async function readImageBytesFromSource(source) {
    const raw = String(source || '').trim();
    if (!raw) return null;
    try {
      if (/^https?:\/\//i.test(raw)) {
        const res = await axios.get(raw, {
          responseType: 'arraybuffer',
          timeout: 15000,
          maxRedirects: 5,
        });
        return Buffer.from(res.data || []);
      }
      let filePath = raw;
      if (/^file:\/\//i.test(raw)) {
        filePath = fileURLToPath(raw);
      }
      if (!path.isAbsolute(filePath)) return null;
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath);
    } catch {
      return null;
    }
  }

  function toPngBuffer(imageBytes) {
    try {
      const img = nativeImage.createFromBuffer(Buffer.from(imageBytes || []));
      if (!img || img.isEmpty()) return null;
      const png = img.toPNG();
      if (!png || !png.length) return null;
      return png;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Folder icon writing
  // ---------------------------------------------------------------------------

  async function writeSimpleFolderIcons(projectPath, importedPackages) {
    try {
      const rows = Array.isArray(importedPackages) ? importedPackages : [];
      if (!rows.length) return { ok: true, written: 0, skipped: 0, reason: 'no_packages' };
      const iconDir = path.join(String(projectPath || ''), 'Packages', SIMPLE_FOLDER_ICON_PACKAGE_ID, 'Icons');
      if (!fs.existsSync(iconDir)) return { ok: true, written: 0, skipped: rows.length, reason: 'icons_dir_not_found' };
      let written = 0;
      let skipped = 0;
      let conflicts = 0;
      const fileOwnerByName = new Map();
      const iconHandledByFolderAndItem = new Set();
      for (const row of rows) {
        const pkgPath = String(row?.packagePath || '').trim();
        const pkgName = String(path.basename(pkgPath) || '').toLowerCase();
        if (!pkgPath || pkgName === SIMPLE_FOLDER_ICON_PACKAGE_NAME.toLowerCase()) {
          skipped += 1;
          continue;
        }
        const primaryFolderName = String(row?.meta?.topFolders?.[0]?.name || '').trim();
        const originalFolderName = String(row?.meta?.topFolders?.[0]?.originalName || '').trim();
        let folderName = primaryFolderName;
        const primaryFolderPath = path.join(String(projectPath || ''), 'Assets', primaryFolderName);
        if (primaryFolderName && !fs.existsSync(primaryFolderPath) && originalFolderName) {
          const fallbackFolderPath = path.join(String(projectPath || ''), 'Assets', originalFolderName);
          if (fs.existsSync(fallbackFolderPath)) {
            folderName = originalFolderName;
            appendOperationLog('icon-write', `アイコン名フォールバック: ${primaryFolderName} -> ${originalFolderName}`, {
              itemId: String(row?.itemId || ''),
              title: String(row?.title || ''),
              packagePath: pkgPath,
            });
          } else if (primaryFolderName) {
            appendOperationLog('icon-write', `フォルダ未検出でスキップ: ${primaryFolderName}`, {
              itemId: String(row?.itemId || ''),
              title: String(row?.title || ''),
              packagePath: pkgPath,
              originalFolderName,
            });
          }
        }
        if (!folderName) {
          skipped += 1;
          continue;
        }
        const previewSource = String(row?.previewUrl || '').trim();
        if (!previewSource) {
          skipped += 1;
          continue;
        }
        const imageBytes = await readImageBytesFromSource(previewSource);
        if (!imageBytes || !imageBytes.length) {
          skipped += 1;
          continue;
        }
        const pngBuffer = toPngBuffer(imageBytes);
        if (!pngBuffer || !pngBuffer.length) {
          skipped += 1;
          continue;
        }
        const fileName = `${sanitizeFileName(folderName, String(row?.itemId || row?.title || 'icon'))}.png`;
        const itemId = String(row?.itemId || '').trim();
        const iconKey = `${folderName.toLowerCase()}::${itemId}`;
        if (iconHandledByFolderAndItem.has(iconKey)) {
          skipped += 1;
          continue;
        }
        try {
          const outPath = path.join(iconDir, fileName);
          if (fs.existsSync(outPath)) {
            const existingOwner = String(fileOwnerByName.get(fileName) || '').trim();
            if (existingOwner && existingOwner === itemId) {
              iconHandledByFolderAndItem.add(iconKey);
              skipped += 1;
              continue;
            }
            // SimpleFolderIcon maps by folder-name filename, so same top-folder names collide.
            // Keep the first icon to avoid non-deterministic overwrite.
            conflicts += 1;
            skipped += 1;
            appendOperationLog('icon-write', `アイコン競合でスキップ: ${fileName}`, {
              itemId: String(row?.itemId || ''),
              title: String(row?.title || ''),
              packagePath: pkgPath,
              folderName,
            });
            iconHandledByFolderAndItem.add(iconKey);
            continue;
          }
          fs.writeFileSync(outPath, pngBuffer);
          if (itemId) fileOwnerByName.set(fileName, itemId);
          iconHandledByFolderAndItem.add(iconKey);
          written += 1;
        } catch {
          skipped += 1;
        }
      }
      appendOperationLog('icon-write', `SimpleFolderIcon書き込み完了: generated=${written} skipped=${skipped} conflicts=${conflicts}`, {
        projectPath: normalizeProjectPath(projectPath),
        generated: written,
        skipped,
        conflicts,
        total: rows.length,
      });
      return { ok: true, written, skipped, conflicts };
    } catch (e) {
      appendOperationLog('icon-write', `SimpleFolderIcon icon write skipped: ${String(e?.message || e)}`);
      return {
        ok: true,
        written: 0,
        skipped: Array.isArray(importedPackages) ? importedPackages.length : 0,
        conflicts: 0,
        reason: 'icon_write_failed',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Unity batch import
  // ---------------------------------------------------------------------------

  async function runUnityBatchImport(projectPath, packagePaths, onProgress = null, options = {}) {
    const editorCheck = validateUnityEditorPathSetting();
    if (!editorCheck?.ok) return { error: editorCheck?.error || 'unity_editor_not_found' };
    let resolvedProjectPath;
    try { resolvedProjectPath = fs.realpathSync(projectPath); } catch { return { error: 'project_not_found' }; }
    projectPath = resolvedProjectPath;
    const sanitizedFiles = Array.isArray(packagePaths) ? packagePaths.map((p) => String(p || '').trim()).filter((p) => isValidUnityPackagePath(p)) : [];
    if (!sanitizedFiles.length) return { error: 'no_valid_packages' };
    const listPath = path.join(projectPath, 'booth_import_list.json');
    const renameEntries = Array.isArray(options?.renameEntries)
      ? options.renameEntries.map((e) => ({
        packagePath: String(e?.packagePath || '').trim(),
        sourceTopFolder: String(e?.sourceTopFolder || '').trim(),
        targetTopFolder: String(e?.targetTopFolder || '').trim(),
      })).filter((e) => e.packagePath && e.sourceTopFolder && e.targetTopFolder && e.sourceTopFolder !== e.targetTopFolder)
      : [];
    if (renameEntries.length > 0) {
      appendOperationLog('import-rename-apply', `バッチインポートへリネーム計画を適用: ${renameEntries.length} 件`, {
        projectPath: normalizeProjectPath(projectPath),
        count: renameEntries.length,
        mode: 'batch',
      });
    }
    const renamePlanPath = path.join(projectPath, 'booth_folder_rename_plan.json');
    fs.writeFileSync(listPath, JSON.stringify({ files: sanitizedFiles }, null, 2), 'utf8');
    if (renameEntries.length > 0) {
      fs.writeFileSync(renamePlanPath, JSON.stringify({ entries: renameEntries }, null, 2), 'utf8');
    } else {
      try { fs.rmSync(renamePlanPath, { force: true }); } catch { /* 古いリネーム計画ファイルが無い場合も含め失敗は無視 */ }
    }
    try {
      const verify = JSON.parse(fs.readFileSync(listPath, 'utf8'));
      const listed = Array.isArray(verify?.files) ? verify.files.map((p) => String(p || '').trim()) : [];
      if (listed.length !== sanitizedFiles.length || listed.some((p, i) => p !== sanitizedFiles[i])) {
        return { error: 'import_list_integrity_failed' };
      }
    } catch {
      return { error: 'import_list_integrity_failed' };
    }

    const logDir = UNITY_LOG_DIR;
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    pruneUnityLogs(logDir);
    const logPath = path.join(logDir, `batch_import_${Date.now()}.log`);
    const totalPackages = sanitizedFiles.length;
    const emitProgress = (payload = {}) => {
      if (typeof onProgress !== 'function') return;
      try {
        onProgress({ ...(payload || {}), total: totalPackages });
      } catch {
        // ignore progress callback failures
      }
    };
    emitProgress({
      phase: 'prepare',
      completed: 0,
      message: `インポート準備中... 0/${totalPackages}`,
    });

    const args = [
      '-quit',
      '-batchmode',
      '-projectPath', projectPath,
      '-executeMethod', 'BoothBatchImporter.ImportFromList',
      '-boothImportList', listPath,
      '-boothRenamePlan', renamePlanPath,
      '-logFile', logPath,
    ];

    return await new Promise((resolve) => {
      const importLog = (...parts) => {
        try {
          if (ORIG_CONSOLE) ORIG_CONSOLE.log('[UNITY-IMPORT]', ...parts);
          if (appendRuntimeLog) appendRuntimeLog('log', 'main', '[UNITY-IMPORT]', ...parts);
        } catch {
          // ignore
        }
      };
      let proc = null;
      let settled = false;
      let timeoutTimer = null;
      let unitySpawned = false;
      let sawIpcProgress = false;
      let ipcServer = null;
      let ipcReady = false;
      let ipcPort = 0;
      let readOffset = 0;
      let tailCarry = '';
      let importedCount = 0;
      let currentPackagePath = '';
      let currentPackageIndex = 1;
      let currentPackageTotal = Math.max(1, totalPackages);
      let currentPackageEstimatedAssets = 1;
      const importingPrefix = '[BoothBatchImporter] Importing: ';
      const deltaPrefix = '[BoothBatchImporter] Delta files: ';
      const packageMissingPrefix = '[BoothBatchImporter] Package not found: ';
      const packageBeginPattern = /\[BoothBatchImporter\] PackageBegin:\s*package=(\d+)\/(\d+)\s*estimatedAssets=(\d+)\s*path=(.+)$/i;
      const assetProgressPattern = /\[BoothBatchImporter\] AssetProgress:\s*imported=(\d+)\/(\d+)\s*package=(\d+)\/(\d+)/i;
      const importedSummaryPattern = /\[BoothBatchImporter\] Imported packages:\s*(\d+)\s*\/\s*(\d+)/i;
      const finalize = (result) => {
        if (settled) return;
        settled = true;
        importLog('finalize', JSON.stringify({
          ok: Boolean(result?.ok),
          error: String(result?.error || ''),
          logPath: String(result?.logPath || ''),
        }));
        try { if (timeoutTimer) clearTimeout(timeoutTimer); } catch { /* 終了処理継続を優先しタイマー解除失敗は無視 */ }
        try { clearInterval(logTimer); } catch { /* 終了処理継続を優先しタイマー解除失敗は無視 */ }
        try { flushLogTail(); } catch { /* 終了処理継続を優先しログフラッシュ失敗は無視 */ }
        try { if (ipcServer) ipcServer.close(); } catch { /* 終了処理継続を優先しIPCサーバー停止失敗は無視 */ }
        resolve(result);
      };
      const emitGlobalProgress = (packageIndex, packageTotal, localRatio, phase = 'importing', message = '') => {
        const total = Math.max(1, Number(packageTotal) || totalPackages || 1);
        const index = Math.max(1, Math.min(total, Number(packageIndex) || 1));
        const ratio = Math.max(0, Math.min(1, Number(localRatio) || 0));
        const global = (((index - 1) + ratio) / total) * 100;
        emitProgress({
          phase,
          percent: Math.round(global),
          completed: Math.max(importedCount, index - 1),
          current: index,
          currentPackage: currentPackagePath,
          message: message || `インポート中... ${Math.max(importedCount, index - 1)}/${total}`,
        });
      };
      const emitPackageProgress = (phase = 'importing') => {
        const safeTotal = Math.max(1, totalPackages);
        const percent = Math.round((Math.min(importedCount, safeTotal) / safeTotal) * 100);
        emitProgress({
          phase,
          percent,
          completed: importedCount,
          current: Math.min(importedCount + 1, safeTotal),
          currentPackage: currentPackagePath,
          message: `${phase === 'done' ? 'インポート完了' : 'インポート中...'} ${Math.min(importedCount, safeTotal)}/${safeTotal}`,
        });
      };
      const processLogText = (text) => {
        if (sawIpcProgress) return;
        if (!text) return;
        const joined = `${tailCarry}${text}`;
        const rows = joined.split(/\r?\n/);
        tailCarry = rows.pop() || '';
        for (const row of rows) {
          const line = String(row || '');
          if (!line) continue;
          const packageBegin = line.match(packageBeginPattern);
          if (packageBegin) {
            currentPackageIndex = Number(packageBegin[1] || 1) || 1;
            currentPackageTotal = Number(packageBegin[2] || totalPackages) || Math.max(1, totalPackages);
            currentPackageEstimatedAssets = Math.max(1, Number(packageBegin[3] || 1) || 1);
            currentPackagePath = String(packageBegin[4] || '').trim();
            emitGlobalProgress(
              currentPackageIndex,
              currentPackageTotal,
              0,
              'importing',
              `インポート中... ${Math.max(importedCount, currentPackageIndex - 1)}/${currentPackageTotal}`
            );
            continue;
          }
          const assetProgress = line.match(assetProgressPattern);
          if (assetProgress) {
            const localImported = Number(assetProgress[1] || 0) || 0;
            const localTotal = Math.max(1, Number(assetProgress[2] || currentPackageEstimatedAssets) || currentPackageEstimatedAssets);
            currentPackageIndex = Number(assetProgress[3] || currentPackageIndex) || currentPackageIndex;
            currentPackageTotal = Number(assetProgress[4] || currentPackageTotal) || currentPackageTotal;
            const localRatio = Math.max(0, Math.min(1, localImported / localTotal));
            emitGlobalProgress(
              currentPackageIndex,
              currentPackageTotal,
              localRatio,
              'importing',
              `インポート中... ${Math.max(importedCount, currentPackageIndex - 1)}/${currentPackageTotal} (${Math.round(localRatio * 100)}%)`
            );
            continue;
          }
          if (line.includes(importingPrefix)) {
            currentPackagePath = line.split(importingPrefix)[1]?.trim() || '';
            emitPackageProgress('importing');
            continue;
          }
          if (line.includes(deltaPrefix)) {
            importedCount = Math.min(totalPackages, importedCount + 1);
            emitPackageProgress(importedCount >= totalPackages ? 'done' : 'importing');
            continue;
          }
          if (line.includes(packageMissingPrefix)) {
            importedCount = Math.min(totalPackages, importedCount + 1);
            emitPackageProgress(importedCount >= totalPackages ? 'done' : 'importing');
            continue;
          }
          const summary = line.match(importedSummaryPattern);
          if (summary) {
            importedCount = Math.max(importedCount, Number(summary[1] || 0));
            const total = Number(summary[2] || totalPackages) || totalPackages;
            emitProgress({
              phase: importedCount >= total ? 'done' : 'importing',
              percent: Math.round((Math.min(importedCount, total) / Math.max(1, total)) * 100),
              completed: importedCount,
              message: `インポート中... ${Math.min(importedCount, total)}/${total}`,
            });
          }
        }
      };
      const flushLogTail = () => {
        try {
          if (!fs.existsSync(logPath)) return;
          const raw = fs.readFileSync(logPath, 'utf8');
          if (!raw || raw.length <= readOffset) return;
          const delta = raw.slice(readOffset);
          readOffset = raw.length;
          processLogText(delta);
        } catch {
          // ignore tailing failures
        }
      };
      const logTimer = setInterval(flushLogTail, 700);
      const timeoutMs = Math.max(60000, Number(options?.timeoutMs || 30 * 60 * 1000) || (30 * 60 * 1000));
      timeoutTimer = setTimeout(() => {
        importLog('timeout', `ms=${timeoutMs}`);
        dbgUpdate('unity-import:timeout', `ms=${timeoutMs}`, `log=${logPath}`);
        emitProgress({
          phase: 'error',
          completed: importedCount,
          message: `Unity import timed out after ${Math.round(timeoutMs / 1000)}s`,
        });
        try {
          if (proc && !proc.killed) proc.kill();
        } catch {
          // ignore kill failures
        }
        finalize({ error: 'unity_import_timeout', logPath });
      }, timeoutMs);
      const handleIpcPayload = (payload) => {
        if (!payload || typeof payload !== 'object') return;
        sawIpcProgress = true;
        const type = String(payload.type || '').trim();
        importLog('ipc', type);
        const packageTotal = Math.max(1, Number(payload.packageTotal || payload.totalPackages || totalPackages) || totalPackages || 1);
        const packageIndex = Math.max(1, Math.min(packageTotal, Number(payload.packageIndex || currentPackageIndex) || currentPackageIndex));
        if (payload.packagePath) currentPackagePath = String(payload.packagePath);
        if (type === 'package-begin') {
          currentPackageIndex = packageIndex;
          currentPackageTotal = packageTotal;
          currentPackageEstimatedAssets = Math.max(1, Number(payload.estimatedAssets || currentPackageEstimatedAssets) || currentPackageEstimatedAssets);
          emitGlobalProgress(packageIndex, packageTotal, 0, 'importing', `インポート中... ${Math.max(importedCount, packageIndex - 1)}/${packageTotal}`);
          return;
        }
        if (type === 'asset') {
          currentPackageIndex = packageIndex;
          currentPackageTotal = packageTotal;
          const localImported = Math.max(0, Number(payload.importedAssets || 0) || 0);
          const localTotal = Math.max(1, Number(payload.estimatedAssets || currentPackageEstimatedAssets) || currentPackageEstimatedAssets);
          currentPackageEstimatedAssets = localTotal;
          const localRatio = Math.max(0, Math.min(1, localImported / localTotal));
          emitGlobalProgress(packageIndex, packageTotal, localRatio, 'importing', `インポート中... ${Math.max(importedCount, packageIndex - 1)}/${packageTotal} (${Math.round(localRatio * 100)}%)`);
          return;
        }
        if (type === 'package-done' || type === 'package-skip') {
          importedCount = Math.max(importedCount, Number(payload.importedPackages || packageIndex) || packageIndex);
          emitPackageProgress(importedCount >= packageTotal ? 'done' : 'importing');
          return;
        }
        if (type === 'done') {
          const done = Math.max(importedCount, Number(payload.importedPackages || totalPackages) || totalPackages);
          importedCount = done;
          emitProgress({
            phase: 'done',
            percent: 100,
            completed: done,
            current: packageTotal,
            currentPackage: currentPackagePath,
            message: `インポート完了 ${Math.min(done, packageTotal)}/${packageTotal}`,
          });
          return;
        }
        if (type === 'error') {
          emitProgress({
            phase: 'error',
            completed: importedCount,
            current: currentPackageIndex,
            currentPackage: currentPackagePath,
            message: `インポート失敗: ${String(payload.message || 'unknown')}`,
          });
        }
      };
      const startUnityProcess = () => {
        if (unitySpawned) return;
        unitySpawned = true;
        const finalArgs = [...args];
        if (ipcReady && ipcPort > 0) {
          finalArgs.push('-boothIpcHost', '127.0.0.1', '-boothIpcPort', String(ipcPort));
        }
        importLog('spawn', `ipc=${ipcReady ? `127.0.0.1:${ipcPort}` : 'disabled'}`, `packages=${totalPackages}`);
        dbgUpdate('unity-import:start', `project=${projectPath}`, `packages=${totalPackages}`, `ipc=${ipcReady ? `127.0.0.1:${ipcPort}` : 'disabled'}`);
        dbgUpdate('unity-import:args', finalArgs.join(' '));
        proc = spawn(String(editorCheck.path || '').trim(), finalArgs, { windowsHide: true });
        proc.on('close', (code) => {
          importLog('close', `code=${code}`, `sawIpc=${sawIpcProgress}`);
          dbgUpdate('unity-import:close', `code=${code}`, `log=${logPath}`, `sawIpc=${sawIpcProgress}`);
          if (code === 0) {
            emitProgress({
              phase: 'done',
              completed: totalPackages,
              percent: 100,
              message: `インポート完了 ${totalPackages}/${totalPackages}`,
            });
            finalize({ ok: true, logPath });
          } else {
            emitProgress({
              phase: 'error',
              completed: importedCount,
              message: `インポート失敗: Unity終了コード ${code}`,
            });
            finalize({ error: `unity_exit_code_${code}`, logPath });
          }
        });
        proc.on('error', (err) => {
          importLog('spawn-error', String(err?.message || err));
          dbgUpdate('unity-import:spawn-error', err?.message || String(err));
          emitProgress({
            phase: 'error',
            completed: importedCount,
            message: `インポート失敗: ${err?.message || String(err)}`,
          });
          finalize({ error: err.message, logPath });
        });
      };
      ipcServer = net.createServer((socket) => {
        socket.setEncoding('utf8');
        let buf = '';
        socket.on('data', (chunk) => {
          buf += String(chunk || '');
          let idx = buf.indexOf('\n');
          while (idx >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (line) {
              try {
                const payload = JSON.parse(line);
                dbgUpdate('unity-import:ipc', String(payload?.type || 'unknown'));
                handleIpcPayload(payload);
              } catch {
                // ignore malformed IPC payload
              }
            }
            idx = buf.indexOf('\n');
          }
        });
      });
      ipcServer.on('error', () => {
        importLog('ipc-server-error', 'fallback-to-log-tail');
        dbgUpdate('unity-import:ipc-error', 'fallback-to-log-tail');
        ipcReady = false;
        ipcPort = 0;
        startUnityProcess();
      });
      ipcServer.listen(0, '127.0.0.1', () => {
        try {
          const addr = ipcServer.address();
          ipcPort = Number(addr?.port || 0);
          ipcReady = ipcPort > 0;
        } catch {
          ipcReady = false;
          ipcPort = 0;
        }
        importLog('ipc-listen', `ready=${ipcReady}`, `port=${ipcPort || 0}`);
        dbgUpdate('unity-import:ipc-listen', `ready=${ipcReady}`, `port=${ipcPort || 0}`);
        startUnityProcess();
      });
    });
  }

  async function runUnityBatchRefresh(projectPath) {
    const editorCheck = validateUnityEditorPathSetting();
    if (!editorCheck?.ok) return { error: editorCheck?.error || 'unity_editor_not_found' };
    let resolvedProjectPath;
    try { resolvedProjectPath = fs.realpathSync(projectPath); } catch { return { error: 'project_not_found' }; }
    projectPath = resolvedProjectPath;
    const logDir = UNITY_LOG_DIR;
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    pruneUnityLogs(logDir);
    const logPath = path.join(logDir, `batch_refresh_${Date.now()}.log`);
    const args = [
      '-quit',
      '-batchmode',
      '-projectPath', projectPath,
      '-logFile', logPath,
    ];
    return await new Promise((resolve) => {
      const proc = spawn(String(editorCheck.path || '').trim(), args, { windowsHide: true });
      proc.on('close', (code) => {
        if (code === 0) resolve({ ok: true, logPath });
        else resolve({ error: `unity_exit_code_${code}`, logPath });
      });
      proc.on('error', (err) => resolve({ error: err.message }));
    });
  }

  function normalizeImportMode(mode) {
    const v = String(mode || '').trim().toLowerCase();
    return v === 'background' ? 'background' : 'normal';
  }

  // ---------------------------------------------------------------------------
  // Unity importer/bootstrap script management
  // ---------------------------------------------------------------------------

  function ensureUnityFolderIconBootstrapReady(projectPath) {
    return unityEditorSupport.ensureFolderIconBootstrap(projectPath);
  }

  function ensureUnityBatchImporterReady(projectPath) {
    try {
      const targetProject = String(projectPath || '').trim();
      if (!targetProject || !fs.existsSync(targetProject)) return { error: 'project_not_found' };
      if (isFolderIconBootstrapEnabled()) {
        const bootstrapRes = ensureUnityFolderIconBootstrapReady(targetProject);
        if (!bootstrapRes?.ok) {
          appendOperationLog('folder-icon-bootstrap', `起動時フォルダアイコン再適用スクリプトの準備に失敗: ${String(bootstrapRes?.error || 'unknown')}`, {
            projectPath: normalizeProjectPath(targetProject),
          });
        } else if (bootstrapRes?.status && bootstrapRes.status !== 'unchanged') {
          appendOperationLog('folder-icon-bootstrap', `起動時フォルダアイコン再適用スクリプトを${bootstrapRes.status === 'created' ? '作成' : '更新'}しました`, {
            projectPath: normalizeProjectPath(targetProject),
            scriptPath: String(bootstrapRes.scriptPath || ''),
            status: bootstrapRes.status,
          });
        }
      }
      const prepRes = unityEditorSupport.ensureBatchImporter(targetProject);
      if (!prepRes?.ok) return { error: prepRes?.error || 'batch_importer_prepare_failed' };
      return { ok: true, scriptPath: prepRes.scriptPath };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  }

  function ensureUnityLiveImporterReady(projectPath) {
    try {
      const targetProject = String(projectPath || '').trim();
      if (!targetProject || !fs.existsSync(targetProject)) return { error: 'project_not_found' };
      if (isFolderIconBootstrapEnabled()) {
        const bootstrapRes = ensureUnityFolderIconBootstrapReady(targetProject);
        if (!bootstrapRes?.ok) {
          appendOperationLog('folder-icon-bootstrap', `起動時フォルダアイコン再適用スクリプトの準備に失敗: ${String(bootstrapRes?.error || 'unknown')}`, {
            projectPath: normalizeProjectPath(targetProject),
          });
        } else if (bootstrapRes?.status && bootstrapRes.status !== 'unchanged') {
          appendOperationLog('folder-icon-bootstrap', `起動時フォルダアイコン再適用スクリプトを${bootstrapRes.status === 'created' ? '作成' : '更新'}しました`, {
            projectPath: normalizeProjectPath(targetProject),
            scriptPath: String(bootstrapRes.scriptPath || ''),
            status: bootstrapRes.status,
          });
        }
      }
      const prepRes = unityEditorSupport.ensureLiveImporter(targetProject);
      if (!prepRes?.ok) return { error: prepRes?.error || 'live_importer_prepare_failed' };
      return { ok: true, scriptPath: prepRes.scriptPath };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  }

  function cleanupAutoBootstrapSupportScripts(projectPath) {
    return unityEditorSupport.cleanupAutoBootstrapSupportScripts(projectPath);
  }

  function enqueueUnityLiveImport(projectPath, packagePaths, renameEntries = []) {
    try {
      const targetProject = String(projectPath || '').trim();
      if (!targetProject || !fs.existsSync(targetProject)) return { error: 'project_not_found' };
      const rows = Array.isArray(packagePaths) ? packagePaths.map((p) => String(p || '').trim()).filter(Boolean) : [];
      if (!rows.length) return { error: 'no_packages' };
      const validRows = rows.filter((p) => isValidUnityPackagePath(p));
      if (!validRows.length) return { error: 'no_valid_packages' };
      const queuePath = path.join(targetProject, 'booth_live_import_queue.json');
      let existing = [];
      let existingRenameEntries = [];
      if (fs.existsSync(queuePath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
          existing = Array.isArray(parsed?.files) ? parsed.files.map((p) => String(p || '').trim()).filter(Boolean) : [];
          existingRenameEntries = Array.isArray(parsed?.renames)
            ? parsed.renames.map((e) => ({
              packagePath: String(e?.packagePath || '').trim(),
              sourceTopFolder: String(e?.sourceTopFolder || '').trim(),
              targetTopFolder: String(e?.targetTopFolder || '').trim(),
            })).filter((e) => e.packagePath && e.sourceTopFolder && e.targetTopFolder)
            : [];
        } catch {
          existing = [];
          existingRenameEntries = [];
        }
      }
      const merged = Array.from(new Set([...existing, ...validRows]));
      const nextRenameMap = new Map();
      for (const e of existingRenameEntries) {
        nextRenameMap.set(String(e.packagePath || '').toLowerCase(), e);
      }
      const incoming = Array.isArray(renameEntries) ? renameEntries : [];
      for (const e of incoming) {
        const row = {
          packagePath: String(e?.packagePath || '').trim(),
          sourceTopFolder: String(e?.sourceTopFolder || '').trim(),
          targetTopFolder: String(e?.targetTopFolder || '').trim(),
        };
        if (!row.packagePath || !row.sourceTopFolder || !row.targetTopFolder) continue;
        nextRenameMap.set(row.packagePath.toLowerCase(), row);
      }
      const mergedRenames = Array.from(nextRenameMap.values());
      fs.writeFileSync(queuePath, JSON.stringify({ files: merged, renames: mergedRenames }, null, 2), 'utf8');
      if (mergedRenames.length > 0) {
        appendOperationLog('import-rename-apply', `ライブインポートへリネーム計画を適用: ${mergedRenames.length} 件`, {
          projectPath: normalizeProjectPath(projectPath),
          count: mergedRenames.length,
          mode: 'live',
        });
      }
      return { ok: true, queued: validRows.length, totalQueued: merged.length, queuePath };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  }

  // ---------------------------------------------------------------------------
  // OS association / project selection
  // ---------------------------------------------------------------------------

  async function openPackagesViaOsAssociation(packagePaths) {
    const rows = Array.isArray(packagePaths) ? packagePaths.map((p) => String(p || '').trim()).filter(Boolean) : [];
    const uniqueRows = Array.from(new Set(rows));
    if (!uniqueRows.length) return { error: 'no_valid_packages' };
    const failed = [];
    let opened = 0;
    for (const pkg of uniqueRows) {
      if (!fs.existsSync(pkg)) {
        failed.push({ packagePath: pkg, error: 'package_not_found' });
        continue;
      }
      try {
        const err = await shell.openPath(pkg);
        if (err) {
          failed.push({ packagePath: pkg, error: String(err) });
        } else {
          opened += 1;
        }
      } catch (e) {
        failed.push({ packagePath: pkg, error: e?.message || String(e) });
      }
      // Prevent spawning too aggressively when many packages are selected.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 180));
    }
    if (!opened) {
      return { error: 'os_association_failed', mode: 'os_association', opened, failed };
    }
    return { ok: true, mode: 'os_association', opened, failed };
  }

  function parseProjectPathFromUnityCommandLine(commandLine) {
    const raw = String(commandLine || '').trim();
    if (!raw) return '';
    const m = raw.match(/-projectPath\s+("([^"]+)"|'([^']+)'|([^\s]+))/i);
    if (!m) return '';
    const picked = String(m[2] || m[3] || m[4] || '').trim();
    if (!picked) return '';
    return path.resolve(picked);
  }

  function listRunningUnityProjectPaths() {
    if (process.platform !== 'win32') return [];
    try {
      const psScript = "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process -Filter \"Name='Unity.exe'\" | Select-Object -ExpandProperty CommandLine";
      const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', psScript], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000,
      });
      const out = String(res?.stdout || '');
      if (!out.trim()) return [];
      const rows = out
        .split(/\r?\n/)
        .map((line) => parseProjectPathFromUnityCommandLine(line))
        .filter(Boolean)
        .filter((p) => fs.existsSync(p));
      return Array.from(new Set(rows.map((p) => normalizeProjectPath(p)).filter(Boolean)));
    } catch {
      return [];
    }
  }

  function findLatestOpenedProjectFromVccLogs() {
    try {
      if (!VCC_LOG_DIR || !fs.existsSync(VCC_LOG_DIR)) return '';
      const files = fs.readdirSync(VCC_LOG_DIR, { withFileTypes: true })
        .filter((e) => e.isFile() && /-log\.txt$/i.test(e.name))
        .map((e) => {
          const fullPath = path.join(VCC_LOG_DIR, e.name);
          let mtimeMs = 0;
          try { mtimeMs = fs.statSync(fullPath).mtimeMs; } catch { /* stat失敗時は0のままソート続行 */ }
          return { fullPath, mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 6);
      const openPattern = /Opening project:\s*(.+)$/i;
      for (const f of files) {
        let text = '';
        try { text = fs.readFileSync(f.fullPath, 'utf8'); } catch { continue; }
        if (!text) continue;
        const lines = text.split(/\r?\n/);
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          const m = String(lines[i] || '').match(openPattern);
          if (!m) continue;
          const project = normalizeProjectPath(m[1]);
          if (project && fs.existsSync(project)) return project;
        }
      }
    } catch {
      // ignore vcc log parse failures
    }
    return '';
  }

  async function selectProjectPathForOsAssociation(event) {
    const { BrowserWindow, dialog } = require('electron');
    const running = listRunningUnityProjectPaths();
    if (running.length === 1) return { projectPath: running[0], source: 'unity_process' };
    if (running.length > 1) {
      const parentWindow = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
      const buttons = running.map((p) => path.basename(p || p)).slice(0, 7);
      const detail = running.map((p, idx) => `${idx + 1}. ${p}`).join('\n');
      const choice = await dialog.showMessageBox(parentWindow || null, {
        type: 'question',
        title: 'プロジェクト選択',
        message: `Unityプロジェクトが複数起動中です（${running.length}件）。`,
        detail: `Scriptインポート（OS連携）の対象プロジェクトを選択してください。\n\n${detail}`,
        buttons: [...buttons, 'キャンセル'],
        cancelId: buttons.length,
        defaultId: 0,
        noLink: true,
      });
      if (choice.response >= 0 && choice.response < running.length) {
        return { projectPath: running[choice.response], source: 'unity_process_dialog' };
      }
      return { error: 'os_assoc_project_selection_cancelled' };
    }
    const fromVccLogs = findLatestOpenedProjectFromVccLogs();
    if (fromVccLogs) return { projectPath: fromVccLogs, source: 'vcc_logs' };
    return { error: 'os_assoc_project_not_found' };
  }

  // ---------------------------------------------------------------------------
  // Folder icon bootstrap for project list
  // ---------------------------------------------------------------------------

  function ensureFolderIconBootstrapForProjects(projectRows, trigger = 'manual') {
    if (!isFolderIconBootstrapEnabled()) return;
    const rows = Array.isArray(projectRows) ? projectRows : [];
    for (const row of rows) {
      const projectPath = normalizeProjectPath(row?.path || row);
      if (!projectPath || !fs.existsSync(projectPath)) continue;
      const res = ensureUnityFolderIconBootstrapReady(projectPath);
      if (!res?.ok) {
        appendOperationLog('folder-icon-bootstrap', `起動時フォルダアイコン再適用スクリプトの準備に失敗: ${String(res?.error || 'unknown')}`, {
          projectPath,
          trigger,
        });
        continue;
      }
      if (res.status && res.status !== 'unchanged') {
        appendOperationLog('folder-icon-bootstrap', `起動時フォルダアイコン再適用スクリプトを${res.status === 'created' ? '作成' : '更新'}しました`, {
          projectPath,
          scriptPath: String(res.scriptPath || ''),
          status: res.status,
          trigger,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------

  return {
    normalizeProjectPath,
    isRegisteredUnityProject,
    canRunUnityImport,
    validateUnityEditorPathSetting,
    listUnityPackagesInDir,
    listSourceImportRootsInDir,
    fillPackageMetaByScan,
    extractVpmAutoInstallerConfig,
    validateImportPackages,
    planTopFolderRenames,
    buildPackageMetasAdaptive,
    getRecommendedReconcileWorkerCount,
    getProjectIndexCached,
    setProjectIndexCache,
    computeProjectFingerprint,
    runReconcileWorker,
    analyzeImportToolDependencies,
    installImportToolDependencies,
    loadImportHistory,
    writeImportHistory,
    appendImportHistory,
    appendReconciledImportHistory,
    loadReconcileLog,
    writeReconcileLog,
    writeReconcileLogBatch,
    acquireBackgroundImportProjectLock,
    releaseBackgroundImportProjectLock,
    isUnityProjectLocked,
    runUnityBatchImport,
    runUnityBatchRefresh,
    normalizeImportMode,
    validateAutoBootstrapImportResult,
    appendSimpleFolderIconToBatchPackages,
    installSimpleFolderIconAsPackage,
    ensureUnityFolderIconBootstrapReady,
    ensureUnityBatchImporterReady,
    ensureUnityLiveImporterReady,
    cleanupAutoBootstrapSupportScripts,
    enqueueUnityLiveImport,
    openPackagesViaOsAssociation,
    listRunningUnityProjectPaths,
    findLatestOpenedProjectFromVccLogs,
    selectProjectPathForOsAssociation,
    ensureFolderIconBootstrapForProjects,
    isFolderIconBootstrapEnabled,
    resolveSimpleFolderIconPackagePath,
    ensureInstallScriptsAssets,
    writeSimpleFolderIcons,
    applySourceRootsToProject,
    copyDirMerge,
    analyzeUnityImportLog,
    pruneUnityLogs,
  };
}

module.exports = { createUnityManager };
