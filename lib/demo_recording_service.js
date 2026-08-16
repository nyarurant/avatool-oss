'use strict';

/**
 * README demo recording support. Only active when AVATOOL_DEMO_RECORDING is
 * set (set by scripts/demo/demo_readme.js). Fires the exact same IPC events
 * production download/import flows send, so the real queue bar, progress
 * bar, and button-state transitions render authentically — no network or
 * Unity CLI calls are ever made. Dormant (returns an error) for normal use,
 * mirroring the existing AVATOOL_UI_PROBE-gated lib/ui_probe_service.js.
 */
function createDemoRecordingService({ getMainWindow, fs, path, appDataRoot }) {
  const zlib = require('zlib');
  // unitypackage files are gzip-compressed tar archives; real code (e.g. the
  // reconcile worker) gunzips them, so a plain-text placeholder would fail
  // with "incorrect header check". A gzipped, all-zero "tar" (no entries)
  // parses cleanly as an empty package instead.
  const FAKE_UNITYPACKAGE_BYTES = zlib.gzipSync(Buffer.alloc(1024));

  function isDemoModeEnabled() {
    return String(process.env.AVATOOL_DEMO_RECORDING || '').trim().length > 0;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function simulateDownload({ itemId, title, fileName }) {
    if (!isDemoModeEnabled()) return { ok: false, error: 'demo_mode_disabled' };
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { ok: false, error: 'no_window' };
    const send = (channel, payload) => win.webContents.send(channel, payload);

    send('download-queue', {
      status: 'running', queued: 0, running: [{ itemId, title }], done: 0, failed: [], paused: false, concurrency: 2,
    });
    send('download-progress', {
      itemId, phase: 'downloading', status: 'progress', fileName, fileIndex: 1, fileTotal: 1, receivedBytes: 15, totalBytes: 100,
    });
    await delay(500);
    send('download-progress', {
      itemId, phase: 'downloading', status: 'progress', fileName, fileIndex: 1, fileTotal: 1, receivedBytes: 100, totalBytes: 100,
    });
    await delay(300);
    send('download-progress', {
      itemId, phase: 'extracting', status: 'entry', zipIndex: 1, zipTotal: 1, entryIndex: 2, entryTotal: 4, currentEntry: 'Assets/DemoModel.prefab',
    });

    // Real (demo-placeholder) files so the subsequent real listItemFiles/
    // loadAssets calls genuinely see this item as downloaded.
    const safeName = String(title || '').replace(/[\\/:*?"<>|]/g, '_');
    const itemDir = path.join(appDataRoot, 'downloads', `${itemId}_${safeName}`);
    fs.mkdirSync(itemDir, { recursive: true });
    fs.writeFileSync(path.join(itemDir, fileName), 'demo placeholder\n', 'utf8');
    const extractedRoot = path.join(itemDir, '__extracted', safeName);
    fs.mkdirSync(extractedRoot, { recursive: true });
    fs.writeFileSync(path.join(extractedRoot, `${safeName}.unitypackage`), FAKE_UNITYPACKAGE_BYTES);
    fs.writeFileSync(path.join(itemDir, '__extracted', '__extracted.flag'), 'ok', 'utf8');

    await delay(400);
    send('download-progress', {
      itemId, phase: 'done', fileIndex: 1, fileTotal: 1, receivedBytes: 100, totalBytes: 100,
    });
    send('download-queue', {
      status: 'idle', queued: 0, running: [], done: 1, failed: [], paused: false, concurrency: 2,
    });
    await delay(300);

    try {
      const refreshedAssets = await win.webContents.executeJavaScript('window.boothAPI?.loadAssets?.()', true);
      send('assets-refreshed', refreshedAssets);
    } catch {
      // If the real reload fails, the queue events above have already shown
      // real progress; the caller can still proceed with the demo.
    }
    return { ok: true };
  }

  async function simulateUnityImportProgress() {
    if (!isDemoModeEnabled()) return { ok: false, error: 'demo_mode_disabled' };
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { ok: false, error: 'no_window' };
    const send = (channel, payload) => win.webContents.send(channel, payload);

    const steps = [
      { percent: 10, completed: 0, message: '準備中...' },
      { percent: 40, completed: 1, message: 'インポート中... 1/3' },
      { percent: 75, completed: 2, message: 'インポート中... 2/3' },
      { percent: 100, completed: 3, message: 'インポート完了' },
    ];
    for (const step of steps) {
      send('unity-import-progress', { scope: 'manual-background-import', total: 3, ...step });
      await delay(350);
    }
    return { ok: true };
  }

  // Real sync-library hits BOOTH's network and requires a real cookie
  // session, neither of which exist in the demo sandbox. Instead of firing
  // synthetic IPC events on top of a no-op backend (as the download/import
  // simulations do), this replaces the whole IPC handler body: it writes one
  // new (fictional) purchased item straight into librarymeta.json — the same
  // file the real handler would have updated — then returns a summary object
  // shaped exactly like the real handler's return value. The renderer's own
  // subsequent boothAPI.loadAssets() call (already made by runLibrarySync)
  // picks the new file up for real, so the grid re-render, sidebar counts,
  // and "同期完了" toast are all genuine, not scripted.
  async function simulateLibrarySync() {
    if (!isDemoModeEnabled()) return { error: 'demo_mode_disabled' };
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { error: 'no_window' };
    const send = (channel, payload) => win.webContents.send(channel, payload);
    const startedAt = Date.now();

    send('meta-progress', { phase: 'prepare', index: 0, total: 1, scope: 'sync-library' });
    await delay(350);
    send('meta-progress', { phase: 'fetch', index: 1, total: 1, scope: 'sync-library' });
    await delay(500);

    const metaPath = path.join(appDataRoot, 'librarymeta.json');
    let items;
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      items = Array.isArray(parsed) ? parsed : [];
    } catch {
      items = [];
    }

    const now = new Date().toISOString();
    const newItemId = '80007';
    let changed = false;
    if (!items.some((it) => String(it?.itemId || '') === newItemId)) {
      items.unshift({
        itemId: newItemId,
        itemName: 'Aurora Tail Accessory',
        authorName: 'Ember Works',
        orderDateTime: now,
        imageUrl: '',
        localImagePath: '',
        categories: [{ name: '小物', slug: '小物' }],
        primaryCategory: { name: '小物', slug: '小物' },
        tagNames: ['demo'],
        downloadLinks: [{ downloadableId: `9${newItemId}`, fileName: 'Aurora_Tail_Accessory.zip' }],
        versionHistory: [],
        latestVersion: { detectedAt: now, filesHash: `demo-hash-${newItemId}`, filesHashStable: `demo-stable-${newItemId}` },
        hasUpdate: false,
        lastChecked: now,
        isAvatarItem: false,
        supportedAvatars: [],
        supportedAvatarsInferred: [],
        supportedAvatarAnalysis: null,
        avatarAnalysisCheckedAt: '',
      });
      changed = true;
    }

    // Also mark the one already-downloaded demo item (Starlit Original
    // Avatar, 80004 — see scripts/demo/demo_data.js) as having a new version,
    // so the sync demonstrates both halves of the feature: discovering a
    // brand-new purchase AND detecting an update to something already owned.
    const updateItemId = '80004';
    const updateTarget = items.find((it) => String(it?.itemId || '') === updateItemId);
    if (updateTarget && !updateTarget.hasUpdate) {
      updateTarget.hasUpdate = true;
      updateTarget.latestVersion = {
        detectedAt: now,
        filesHash: 'demo-hash-80004-v2',
        filesHashStable: 'demo-stable-80004-v2',
      };
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(metaPath, JSON.stringify(items, null, 2), 'utf8');
    }

    send('meta-progress', { phase: 'done', scope: 'sync-library' });

    return {
      ok: true,
      refreshed: true,
      summary: {
        elapsedMs: Date.now() - startedAt,
        totalItemCount: items.length,
        emptyReason: '',
        boothLoggedIn: true,
        boothLoginReason: '',
        boothLibraryItemCount: items.length,
        newItemCount: 1,
        categoryBackfillCount: 0,
        categoryBackfillTargets: 0,
        fallbackPreviewCount: 0,
        fallbackAuthorIconCount: 0,
      },
    };
  }

  // Mirrors simulateDownload's event/file-write sequence for an item that is
  // already downloaded and flagged hasUpdate (see simulateLibrarySync above),
  // then additionally clears hasUpdate in librarymeta.json — the one piece
  // simulateDownload doesn't touch — so the real "更新あり" badge/tab and the
  // update button genuinely disappear afterward, matching what a real
  // update-download does to the metadata once it completes.
  async function simulateUpdateDownload({ itemId, title, fileName }) {
    if (!isDemoModeEnabled()) return { ok: false, error: 'demo_mode_disabled' };
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { ok: false, error: 'no_window' };
    const send = (channel, payload) => win.webContents.send(channel, payload);

    send('download-queue', {
      status: 'running', queued: 0, running: [{ itemId, title }], done: 0, failed: [], paused: false, concurrency: 2,
    });
    send('download-progress', {
      itemId, phase: 'downloading', status: 'progress', fileName, fileIndex: 1, fileTotal: 1, receivedBytes: 20, totalBytes: 100,
    });
    await delay(450);
    send('download-progress', {
      itemId, phase: 'downloading', status: 'progress', fileName, fileIndex: 1, fileTotal: 1, receivedBytes: 100, totalBytes: 100,
    });
    await delay(300);

    const safeName = String(title || '').replace(/[\\/:*?"<>|]/g, '_');
    const itemDir = path.join(appDataRoot, 'downloads', `${itemId}_${safeName}`);
    fs.mkdirSync(itemDir, { recursive: true });
    fs.writeFileSync(path.join(itemDir, fileName), 'demo placeholder v2\n', 'utf8');
    const extractedRoot = path.join(itemDir, '__extracted', safeName);
    fs.mkdirSync(extractedRoot, { recursive: true });
    fs.writeFileSync(path.join(extractedRoot, `${safeName}.unitypackage`), FAKE_UNITYPACKAGE_BYTES);
    fs.writeFileSync(path.join(itemDir, '__extracted', '__extracted.flag'), 'ok', 'utf8');

    send('download-progress', {
      itemId, phase: 'done', fileIndex: 1, fileTotal: 1, receivedBytes: 100, totalBytes: 100,
    });
    send('download-queue', {
      status: 'idle', queued: 0, running: [], done: 1, failed: [], paused: false, concurrency: 2,
    });
    await delay(300);

    try {
      const metaPath = path.join(appDataRoot, 'librarymeta.json');
      const items = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const target = Array.isArray(items) ? items.find((it) => String(it?.itemId || '') === itemId) : null;
      if (target) {
        target.hasUpdate = false;
        fs.writeFileSync(metaPath, JSON.stringify(items, null, 2), 'utf8');
      }
    } catch {
      // If the meta patch fails, the queue/progress events above have
      // already shown a real-looking completion; not fatal for the demo.
    }

    try {
      const refreshedAssets = await win.webContents.executeJavaScript('window.boothAPI?.loadAssets?.()', true);
      send('assets-refreshed', refreshedAssets);
    } catch {
      // See simulateDownload's identical fallback comment.
    }
    return { ok: true };
  }

  return {
    isDemoModeEnabled,
    simulateDownload,
    simulateUnityImportProgress,
    simulateLibrarySync,
    simulateUpdateDownload,
  };
}

module.exports = { createDemoRecordingService };
