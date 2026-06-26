'use strict';

function createStorageManager(deps) {
  const {
    fs,
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
  } = deps;

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

  return { getPathSizeBytes, getStorageUsageSnapshot };
}

module.exports = { createStorageManager };
