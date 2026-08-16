'use strict';

/**
 * Records the "一括インポート" (batch import) demo GIF.
 * Usage: node scripts/demo/demo_batch_import.js [outPath]
 * Requires ffmpeg on PATH.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { runDemo, ROOT } = require('./demo_runner');

const OUT_PATH = process.argv[2] || path.join(ROOT, 'assets', 'demo', 'avatool-demo-batch-import.gif');

// Batch import only offers a checkbox on already-downloaded items (see
// renderer/render_category_filter_ui.js#toggleSelection — undownloaded
// items just show a warning toast and refuse to select), and the base demo
// library only has one downloaded item (Nix, 6481122, set up by
// createDemoData() for the other demos). This prepareData hook gives a
// second real item — くろねこロングヘア (6618782), already tagged
// Nix-compatible so the pairing reads naturally — real (placeholder-content)
// downloaded files too, scoped to only this demo run.
function prepareData(dataDir) {
  const itemId = '6618782';
  const itemName = '【18アバター対応】くろねこロングヘア【VRChat】 (くろねこロングヘア)';
  const fileName = 'kuroneko_TEX.zip';
  const safeName = itemName.replace(/[\\/:*?"<>|]/g, '_');
  const itemDir = path.join(dataDir, 'downloads', `${itemId}_${safeName}`);
  fs.mkdirSync(itemDir, { recursive: true });
  fs.writeFileSync(path.join(itemDir, fileName), 'demo placeholder\n', 'utf8');
  const extractedRoot = path.join(itemDir, '__extracted', safeName);
  fs.mkdirSync(extractedRoot, { recursive: true });
  fs.writeFileSync(path.join(extractedRoot, `${safeName}.unitypackage`), zlib.gzipSync(Buffer.alloc(1024)));
  fs.writeFileSync(path.join(itemDir, '__extracted', '__extracted.flag'), 'ok', 'utf8');
}

// Storyboard: static library -> enter selection mode ("一括インポート") ->
// check 2 already-downloaded items (Nix + くろねこロングヘア) -> click
// "一括インポート" to scan both for packages -> the real package-selection
// modal opens listing packages from both items -> background mode -> pick
// the (fake demo) project -> import -> exit selection mode -> hold -> loop.
//
// 100% real UI + real local scan (renderer/render_library_actions.js
// #handleBatchImportSelection calls boothAPI.listItemFiles per selected
// item, a local filesystem read — no network). Only the final "インポート
// 開始" click is faked (clickVisual + demoSimulateUnityImport), same as
// every other demo that reaches this same shared import modal — a real
// click there would invoke the real Unity import pipeline.
async function sequence({ evalJs, delay }) {
  const NIX_CHECKBOX = `[data-item-id="6481122"] .selection-checkbox`;
  const KURONEKO_CHECKBOX = `[data-item-id="6618782"] .selection-checkbox`;

  await evalJs(`window.__demoCursor.pause(400)`);
  await evalJs(`window.__demoCursor.show()`);

  await evalJs(`window.__demoCursor.moveTo('#btn-toggle-select', 600)`);
  await evalJs(`window.__demoCursor.click('#btn-toggle-select')`); // real: enters selection mode
  await delay(400);

  await evalJs(`window.__demoCursor.moveTo('${NIX_CHECKBOX}', 500)`);
  await evalJs(`window.__demoCursor.click('${NIX_CHECKBOX}')`); // real: select Nix
  await delay(250);

  await evalJs(`window.__demoCursor.moveTo('${KURONEKO_CHECKBOX}', 450)`);
  await evalJs(`window.__demoCursor.click('${KURONEKO_CHECKBOX}')`); // real: select くろねこロングヘア
  await delay(600); // hold with both checked

  await evalJs(`window.__demoCursor.moveTo('#btn-batch-import', 500)`);
  await evalJs(`window.__demoCursor.click('#btn-batch-import')`); // real: local-only package scan across both items
  await delay(700);

  await evalJs(`window.__demoCursor.moveTo('#pkg-mode-bg-btn', 450)`);
  await evalJs(`window.__demoCursor.click('#pkg-mode-bg-btn')`); // real: background mode
  await delay(250);

  await evalJs(`window.__demoCursor.moveTo('#pkg-select-confirm', 450)`);
  await evalJs(`window.__demoCursor.click('#pkg-select-confirm')`); // real: opens the import modal
  await delay(500);

  await evalJs(`window.__demoCursor.moveTo('#import-project-list > div:first-child', 500)`);
  await evalJs(`window.__demoCursor.click('#import-project-list > div:first-child')`); // real: selects the demo project
  await delay(300);

  await evalJs(`window.__demoCursor.moveTo('#import-execute', 450)`);
  // Visual-only: a real click here would invoke the real Unity import pipeline.
  await evalJs(`window.__demoCursor.clickVisual('#import-execute')`);
  await evalJs(`window.boothAPI.demoSimulateUnityImport()`);
  await delay(400);

  await evalJs(`window.__demoCursor.moveTo('#import-close', 450)`);
  await evalJs(`window.__demoCursor.click('#import-close')`); // real: closes the modal
  await delay(300);

  await evalJs(`window.__demoCursor.moveTo('#btn-toggle-select', 500)`);
  await evalJs(`window.__demoCursor.click('#btn-toggle-select')`); // real: exits selection mode
  await delay(900);

  await evalJs(`window.__demoCursor.hide()`);
  await delay(1000); // static hold before the GIF loops
}

runDemo({
  outPath: OUT_PATH, sequence, prepareData,
}).catch((e) => {
  console.error('ERROR:', e.stack || e.message || String(e));
  process.exit(1);
});
