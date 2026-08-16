'use strict';

/**
 * Records the library-sync + update demo GIF.
 * Usage: node scripts/demo/demo_library_sync.js [outPath]
 * Requires ffmpeg on PATH.
 */

const path = require('path');
const { runDemo, ROOT } = require('./demo_runner');

const OUT_PATH = process.argv[2] || path.join(ROOT, 'assets', 'demo', 'avatool-demo-library-sync.gif');

// Storyboard: static library (6 items) -> click the real "更新アクション"
// entry point (#check-updates-btn, top toolbar) -> its real SELECT MODE
// modal opens -> pick "両方（推奨）" -> the real click handler
// (renderer/render_aux_ui.js) runs refreshMetaNewUI() (sync: discovers one
// brand-new item) then, since it succeeded, checkForUpdates() (check: flags
// one already-downloaded item as updatable) -> the real "N件の更新を検出"
// notification modal (renderer/render_overlays.js#showUpdateNotification)
// pops up automatically -> click its "更新分をダウンロード" button -> the
// update downloads and the flag clears -> close the notification -> hold on
// the update-free grid -> loop.
//
// This is the single real feature the user meant by "更新同期" — one button,
// one mode-picker modal, that runs sync and update-check together. An
// earlier version of this demo wired the "更新あり" tab + a per-card update
// button directly, which is a *different*, secondary path in the real app;
// this rewrite drives the actual #check-updates-btn -> モード選択 ->
// 更新検出ポップアップ flow instead.
//
// Real BOOTH sync/update-check both need network access and a live cookie
// session, neither of which the demo sandbox has.
// - Sync: lib/ipc_handlers.js's sync-library handler is gated — in demo mode
//   it delegates to lib/demo_recording_service.js#simulateLibrarySync(),
//   which writes one new fictional item straight into librarymeta.json and
//   returns a summary shaped like the real handler's response.
// - Check: lib/ipc_handlers.js's check-updates handler is gated the same
//   way — in demo mode it delegates to #simulateCheckUpdates(), which flags
//   one already-downloaded demo item (Starlit Original Avatar, 80004) as
//   hasUpdate and returns an { updates, totalUpdates } shaped like the real
//   handler's response, so the real showUpdateNotification() popup fires.
// - Update download: the notification popup's real "更新分をダウンロード"
//   click handler would call the real download queue, so this only
//   *visually* clicks it (clickVisual) and separately invokes
//   window.boothAPI.demoSimulateUpdateDownload(...), which fires the same
//   download-queue/download-progress events as a real update, then clears
//   hasUpdate in librarymeta.json — the one piece a plain file-write
//   wouldn't do.
// Everything else — the mode-picker modal, spinners, the notification popup,
// grid re-render, badges — is the real renderer code path, unmodified.
async function sequence({ evalJs, delay }) {
  const UPDATE_ITEM_ID = '80004';
  const UPDATE_TITLE = 'Starlit Original Avatar';
  const UPDATE_FILE = 'Starlit_Original_Avatar_v2.unitypackage';

  await evalJs(`window.__demoCursor.pause(400)`);
  await evalJs(`window.__demoCursor.show()`);

  await evalJs(`window.__demoCursor.moveTo('#check-updates-btn', 600)`);
  await evalJs(`window.__demoCursor.click('#check-updates-btn')`); // real: opens the 更新アクション SELECT MODE modal
  await delay(500);

  await evalJs(`window.__demoCursor.moveTo('[data-action-mode="both"]', 500)`);
  await evalJs(`window.__demoCursor.click('[data-action-mode="both"]')`); // real: runs sync then check-updates
  await delay(1700); // simulateLibrarySync's internal phase delays
  await delay(1700); // simulateCheckUpdates's internal phase delays + the real showUpdateNotification popup appearing

  await evalJs(`window.__demoCursor.moveTo('#updates-download', 500)`);
  // Visual-only: a real click here would call the real download queue.
  await evalJs(`window.__demoCursor.clickVisual('#updates-download')`);
  await evalJs(`window.boothAPI.demoSimulateUpdateDownload({ itemId: '${UPDATE_ITEM_ID}', title: '${UPDATE_TITLE}', fileName: '${UPDATE_FILE}' })`);
  await delay(1300); // covers simulateUpdateDownload's internal phase delays + real re-render

  await evalJs(`window.__demoCursor.moveTo('#updates-close', 450)`);
  await evalJs(`window.__demoCursor.click('#updates-close')`); // real: dismiss the notification popup
  await delay(1200); // hold on the update-free grid

  await evalJs(`window.__demoCursor.hide()`);
  await delay(1000); // static hold before the GIF loops
}

runDemo({ outPath: OUT_PATH, sequence }).catch((e) => {
  console.error('ERROR:', e.stack || e.message || String(e));
  process.exit(1);
});
