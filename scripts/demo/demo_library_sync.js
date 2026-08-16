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
// refreshMetaNewUI()/runLibrarySync() code path runs end-to-end -> hold on
// the "同期完了" toast and the newly-appeared 7th item in the grid -> loop.
//
// Real BOOTH sync needs network access and a live cookie session, neither of
// which the demo sandbox has. lib/ipc_handlers.js's sync-library handler is
// gated: in demo mode it delegates to
// lib/demo_recording_service.js#simulateLibrarySync(), which writes one new
// fictional item straight into librarymeta.json and returns a summary object
// shaped like the real handler's response. Everything downstream of that —
// the spinner, the "Updating meta..." placeholder, boothAPI.loadAssets(),
// the grid re-render, the sidebar counts, and the completion toast — is the
// real renderer code path, unmodified.
async function sequence({ evalJs, delay }) {
  await evalJs(`window.__demoCursor.pause(400)`);
  await evalJs(`window.__demoCursor.show()`);

  await evalJs(`window.__demoCursor.moveTo('#sync-library-btn', 600)`);
  await evalJs(`window.__demoCursor.click('#sync-library-btn')`);
  await delay(1700); // covers simulateLibrarySync's internal phase delays + real re-render

  await delay(1600); // hold on the completion toast and the new item in the grid

  await evalJs(`window.__demoCursor.hide()`);
  await delay(1000); // static hold before the GIF loops
}

runDemo({ outPath: OUT_PATH, sequence }).catch((e) => {
  console.error('ERROR:', e.stack || e.message || String(e));
  process.exit(1);
});
