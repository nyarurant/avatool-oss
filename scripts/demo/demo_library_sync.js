'use strict';

/**
 * Records the library-sync demo GIF.
 * Usage: node scripts/demo/demo_library_sync.js [outPath]
 * Requires ffmpeg on PATH.
 */

const path = require('path');
const { runDemo, ROOT } = require('./demo_runner');

const OUT_PATH = process.argv[2] || path.join(ROOT, 'assets', 'demo', 'avatool-demo-library-sync.gif');

// Storyboard: static library (6 items) -> click the sync button -> the real
// refreshMetaNewUI()/runLibrarySync() code path runs end-to-end, discovering
// one brand-new item AND flagging one already-downloaded item as updatable ->
// switch to the "更新あり" tab to show the flagged item -> click its update
// button -> the update downloads and the flag clears -> switch back to "すべて"
// -> loop. Covers both halves of "同期" (sync: new items) and "更新"
// (update: new version of something already owned).
//
// Real BOOTH sync/update both need network access and a live cookie session,
// neither of which the demo sandbox has.
// - Sync: lib/ipc_handlers.js's sync-library handler is gated — in demo mode
//   it delegates to lib/demo_recording_service.js#simulateLibrarySync(),
//   which writes the new item and the hasUpdate flag straight into
//   librarymeta.json and returns a summary shaped like the real handler's
//   response.
// - Update: the update button's real click handler
//   (renderer/render_download_actions.js#handleUpdateDownload) would call
//   the real download queue, so this only *visually* clicks it
//   (clickVisual) and separately invokes
//   window.boothAPI.demoSimulateUpdateDownload(...), which fires the same
//   download-queue/download-progress events as a real update, then clears
//   hasUpdate in librarymeta.json — the one piece a plain file-write
//   wouldn't do.
// Everything else — the spinner, tab switching, grid re-render, badges, and
// toasts — is the real renderer code path, unmodified.
async function sequence({ evalJs, delay }) {
  const UPDATE_ITEM_ID = '80004';
  const UPDATE_TITLE = 'Starlit Original Avatar';
  const UPDATE_FILE = 'Starlit_Original_Avatar_v2.unitypackage';
  const UPDATE_BTN = `[data-item-id="${UPDATE_ITEM_ID}"] .update-btn`;

  await evalJs(`window.__demoCursor.pause(400)`);
  await evalJs(`window.__demoCursor.show()`);

  await evalJs(`window.__demoCursor.moveTo('#sync-library-btn', 600)`);
  await evalJs(`window.__demoCursor.click('#sync-library-btn')`);
  await delay(1700); // covers simulateLibrarySync's internal phase delays + real re-render
  await delay(1100); // hold on the completion toast and the new item in the grid

  await evalJs(`window.__demoCursor.moveTo('.filter-btn[data-filter="updated"]', 550)`);
  await evalJs(`window.__demoCursor.click('.filter-btn[data-filter="updated"]')`); // real: filters to the 1 flagged item
  await delay(900);

  await evalJs(`window.__demoCursor.moveTo('${UPDATE_BTN}', 500)`);
  // Visual-only: a real click here would call the real download queue.
  await evalJs(`window.__demoCursor.clickVisual('${UPDATE_BTN}')`);
  await evalJs(`window.boothAPI.demoSimulateUpdateDownload({ itemId: '${UPDATE_ITEM_ID}', title: '${UPDATE_TITLE}', fileName: '${UPDATE_FILE}' })`);
  await delay(1300); // covers simulateUpdateDownload's internal phase delays + real re-render

  await evalJs(`window.__demoCursor.moveTo('.filter-btn[data-filter="all"]', 500)`);
  await evalJs(`window.__demoCursor.click('.filter-btn[data-filter="all"]')`); // real: back to the full (now update-free) grid
  await delay(1200);

  await evalJs(`window.__demoCursor.hide()`);
  await delay(1000); // static hold before the GIF loops
}

runDemo({ outPath: OUT_PATH, sequence }).catch((e) => {
  console.error('ERROR:', e.stack || e.message || String(e));
  process.exit(1);
});
