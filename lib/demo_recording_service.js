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
    fs.writeFileSync(path.join(extractedRoot, `${safeName}.unitypackage`), 'demo unitypackage placeholder\n', 'utf8');
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

  return { isDemoModeEnabled, simulateDownload, simulateUnityImportProgress };
}

module.exports = { createDemoRecordingService };
