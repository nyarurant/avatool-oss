'use strict';

function createStorageManager(deps) {
  const {
    fs,
    path,
    getSettings,
    CACHE_DIR,
    AUTHOR_ICON_DIR,
    UNITY_LOG_DIR,
    META_PATH,
    SETTINGS_PATH,
    IMPORT_LOG_PATH,
    RECONCILE_LOG_PATH,
    AVATARS_PATH,
    APP_DATA_ROOT,
    sanitizePathSegment,
  } = deps;

  function ensureRuntimeDirs() {
    try {
      const settings = getSettings();
      if (!fs.existsSync(settings.downloadPath)) {
        fs.mkdirSync(settings.downloadPath, { recursive: true });
      }
    } catch (e) {
      console.warn('Failed to ensure runtime dirs:', e?.message || e);
    }
  }

  function buildItemDir(itemId, title) {
    const settings = getSettings();
    const safeItemId = sanitizePathSegment(itemId, 'NO_ID');
    const safeName = sanitizePathSegment(title, 'NO_NAME');
    const canonical = path.join(settings.downloadPath, `${safeItemId}_${safeName}`);
    try {
      if (!fs.existsSync(settings.downloadPath)) return canonical;
      const dirs = fs.readdirSync(settings.downloadPath, { withFileTypes: true })
        .filter((e) => e.isDirectory() && String(e.name || '').startsWith(`${safeItemId}_`));
      // A stale empty folder can exist under the exact current title (e.g. after an
      // itemName change) while the real downloaded content sits in a differently-named
      // sibling. Only short-circuit on the exact-title match when it's the sole folder
      // for this itemId — otherwise score all siblings so an empty canonical folder
      // never wins over one that actually has the downloaded content.
      if (!dirs.some((d) => path.join(settings.downloadPath, d.name) === canonical) && fs.existsSync(canonical)) {
        return canonical;
      }
      if (!dirs.length) return canonical;
      if (dirs.length === 1) return path.join(settings.downloadPath, dirs[0].name);

      // Prefer extracted-ready/non-empty directory when multiple folders with same itemId exist.
      const withScore = dirs.map((d) => {
        const full = path.join(settings.downloadPath, d.name);
        const flag = path.join(full, '__extracted', '__extracted.flag');
        let mtimeMs = 0;
        let childCount = 0;
        try { mtimeMs = fs.statSync(full).mtimeMs || 0; } catch { /* stat失敗時は0のままスコアリング続行 */ }
        try { childCount = fs.readdirSync(full).length || 0; } catch { /* readdir失敗時は0のままスコアリング続行 */ }
        return { full, isCanonical: full === canonical, hasExtractedFlag: fs.existsSync(flag), childCount, mtimeMs };
      });
      withScore.sort((a, b) => {
        if (a.hasExtractedFlag !== b.hasExtractedFlag) return a.hasExtractedFlag ? -1 : 1;
        if (Boolean(a.childCount) !== Boolean(b.childCount)) return a.childCount ? -1 : 1;
        if (a.isCanonical !== b.isCanonical) return a.isCanonical ? -1 : 1;
        return Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0);
      });
      return withScore[0]?.full || canonical;
    } catch {
      return canonical;
    }
  }

  function getPathSizeBytes(targetPath) {
    if (!targetPath || !fs.existsSync(targetPath)) return 0;
    let total = 0;
    let st;
    try {
      st = fs.lstatSync(targetPath);
    } catch {
      return 0;
    }
    if (st.isSymbolicLink()) return 0;
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;

    const stack = [targetPath];
    while (stack.length) {
      const cur = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        const full = require('path').join(cur, ent.name);
        try {
          const entSt = fs.lstatSync(full);
          if (entSt.isSymbolicLink()) continue;
          if (entSt.isDirectory()) stack.push(full);
          else if (entSt.isFile()) total += entSt.size;
        } catch {
          continue;
        }
      }
    }
    return total;
  }

  let storageSnapshotCache = null;
  let storageSnapshotCachedAt = 0;
  const STORAGE_CACHE_TTL_MS = 30000;

  function getStorageUsageSnapshot() {
    const now = Date.now();
    if (storageSnapshotCache && (now - storageSnapshotCachedAt) < STORAGE_CACHE_TTL_MS) {
      return storageSnapshotCache;
    }
    const settings = getSettings();
    const dirs = [
      { key: 'downloads', path: settings.downloadPath },
      { key: 'cache', path: CACHE_DIR },
      { key: 'authorIcons', path: AUTHOR_ICON_DIR },
      { key: 'logs', path: UNITY_LOG_DIR },
    ];
    const files = [
      { key: 'meta', path: META_PATH },
      { key: 'settings', path: SETTINGS_PATH },
      { key: 'importHistory', path: IMPORT_LOG_PATH },
      { key: 'reconcileLog', path: RECONCILE_LOG_PATH },
      { key: 'avatars', path: AVATARS_PATH },
    ];

    const entries = [];
    let totalBytes = 0;

    for (const d of dirs) {
      const bytes = getPathSizeBytes(d.path);
      if (bytes <= 0) continue;
      entries.push({ type: 'dir', key: d.key, path: d.path, bytes });
      totalBytes += bytes;
    }
    for (const f of files) {
      const bytes = getPathSizeBytes(f.path);
      if (bytes <= 0) continue;
      entries.push({ type: 'file', key: f.key, path: f.path, bytes });
      totalBytes += bytes;
    }

    let drive = null;
    try {
      if (typeof fs.statfsSync === 'function') {
        const st = fs.statfsSync(settings.downloadPath || APP_DATA_ROOT);
        const bsize = Number(st?.bsize || 0);
        const blocks = Number(st?.blocks || 0);
        const bfree = Number(st?.bfree || 0);
        const total = Math.max(0, bsize * blocks);
        const free = Math.max(0, bsize * bfree);
        const used = Math.max(0, total - free);
        if (total > 0) {
          drive = {
            totalBytes: total,
            usedBytes: used,
            freeBytes: free,
            mountPath: settings.downloadPath || APP_DATA_ROOT,
          };
        }
      }
    } catch {
      drive = null;
    }

    const snapshot = {
      ok: true,
      totalBytes,
      appBytes: totalBytes,
      drive,
      entries,
      generatedAt: new Date().toISOString(),
    };
    storageSnapshotCache = snapshot;
    storageSnapshotCachedAt = Date.now();
    return snapshot;
  }

  return { getPathSizeBytes, getStorageUsageSnapshot, ensureRuntimeDirs, buildItemDir };
}

module.exports = { createStorageManager };
