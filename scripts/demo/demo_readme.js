'use strict';

/**
 * Records the "download -> import" demo GIF for the README's hero image.
 * Usage: node scripts/demo/demo_readme.js [outPath]
 * Requires ffmpeg on PATH.
 */

const path = require('path');
const { runDemo, ROOT } = require('./demo_runner');

const OUT_PATH = process.argv[2] || path.join(ROOT, 'assets', 'demo', 'avatool-demo.gif');

// Storyboard: static library -> select asset -> Download -> progress ->
// complete -> Import -> Unity import progress -> complete -> hold -> loop.
// Every screen shown is the REAL production UI (queue bar, progress bar,
// package-selection/import modals). Only two things are faked, both via
// lib/demo_recording_service.js (active only when AVATOOL_DEMO_RECORDING is
// set): the download-queue/download-progress event *source* (no real BOOTH
// network call), and the unity-import-progress event *source* (no real
// Unity CLI invocation). Everything downstream of those events — rendering,
// button-state transitions, file listing — is genuine app code running
// against real (demo-placeholder) files this writes to disk.
async function sequence({ evalJs, delay }) {
  // Real item the user owns (see scripts/demo/demo_data.js) — not yet
  // downloaded at the start of this demo, so its dl-btn genuinely reads
  // "ダウンロード".
  const ITEM_ID = '4358263';
  const ITEM_TITLE = '[VRC Hair]オオカミ少女！ (オオカミ少女！)';
  const ITEM_FILE = 'ANKA_オオカミ少女_.zip';
  const CARD = `[data-item-id="${ITEM_ID}"]`;
  const DL_BTN = `[data-item-id="${ITEM_ID}"] .dl-btn`;

  await evalJs(`window.__demoCursor.pause(400)`); // static library screen
  await evalJs(`window.__demoCursor.show()`);

  await evalJs(`window.__demoCursor.moveTo('${CARD}', 600)`);
  await evalJs(`window.__demoCursor.clickVisual('${CARD}')`); // visual only: opening the preview isn't part of this storyboard
  await delay(150);

  await evalJs(`window.__demoCursor.moveTo('${DL_BTN}', 550)`);
  // Visual-only: a real click here would call the real BOOTH download path.
  await evalJs(`window.__demoCursor.clickVisual('${DL_BTN}')`);
  await evalJs(`window.boothAPI.demoSimulateDownload({ itemId: '${ITEM_ID}', title: '${ITEM_TITLE}', fileName: '${ITEM_FILE}' })`);
  await delay(400); // let the real assets-refreshed re-render settle (dl-btn now reads インポート)

  await evalJs(`window.__demoCursor.moveTo('${DL_BTN}', 500)`);
  await evalJs(`window.__demoCursor.click('${DL_BTN}')`); // real click: opens the real package-selection modal
  await delay(500);

  await evalJs(`window.__demoCursor.moveTo('#pkg-mode-bg-btn', 450)`);
  await evalJs(`window.__demoCursor.click('#pkg-mode-bg-btn')`); // real: switches to background mode (no live-Unity requirement)
  await delay(250);

  await evalJs(`window.__demoCursor.moveTo('#pkg-select-confirm', 450)`);
  await evalJs(`window.__demoCursor.click('#pkg-select-confirm')`); // real: safely opens the import modal (just lists Unity projects)
  await delay(500);

  await evalJs(`window.__demoCursor.moveTo('#import-project-list > div:first-child', 500)`);
  await evalJs(`window.__demoCursor.click('#import-project-list > div:first-child')`); // real: selects the demo project
  await delay(300);

  await evalJs(`window.__demoCursor.moveTo('#import-execute', 450)`);
  // Visual-only: a real click here would invoke the real Unity import pipeline.
  await evalJs(`window.__demoCursor.clickVisual('#import-execute')`);
  await evalJs(`window.boothAPI.demoSimulateUnityImport()`); // fires real unity-import-progress events into the now-open real modal
  await delay(400);

  await evalJs(`window.__demoCursor.moveTo('#import-close', 450)`);
  await evalJs(`window.__demoCursor.click('#import-close')`); // real: closes the modal

  await evalJs(`window.__demoCursor.hide()`);
  await delay(1000); // static hold before the GIF loops
}

runDemo({ outPath: OUT_PATH, sequence }).catch((e) => {
  console.error('ERROR:', e.stack || e.message || String(e));
  process.exit(1);
});
