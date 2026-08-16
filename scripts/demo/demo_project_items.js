'use strict';

/**
 * Records the "which project has this item" (project-items reconcile) demo
 * GIF. Usage: node scripts/demo/demo_project_items.js [outPath]
 * Requires ffmpeg on PATH.
 */

const fs = require('fs');
const path = require('path');
const { runDemo, ROOT } = require('./demo_runner');
const { HERO_PACKAGE_ASSET_PATHS } = require('./demo_data');

const OUT_PATH = process.argv[2] || path.join(ROOT, 'assets', 'demo', 'avatool-demo-project-items.gif');

// Storyboard: static library -> open "プロジェクト内検索" -> project already
// selected (the one fake VCC project demo_runner sets up) -> click "照合" ->
// real progress bar (real local file scan, no network/Unity) -> a genuine
// match is found and shown -> close -> hold -> loop.
// 100% real UI+backend: reconcileImports only reads local files (the demo's
// own downloaded placeholder .unitypackage) and scans the target project
// directory on disk — no network call, no Unity process spawn — so nothing
// needs to be faked here.
//
// For the result to be meaningful (not just "0/1 matched", which
// demonstrates nothing), this writes real files at
// demo_data.js#HERO_PACKAGE_ASSET_PATHS into the fake Unity project's
// Assets/ folder before reconciling — the same relative paths the "Nix"
// item's placeholder .unitypackage (built by
// demo_data.js#buildFakeUnityPackageWithPaths) genuinely declares via real
// tar "pathname" entries, so lib/unity_reconcile_worker.js's path/folder
// matching finds an authentic hit.
async function sequence({ evalJs, delay, fakeVccProjectPath }) {
  for (const assetPath of HERO_PACKAGE_ASSET_PATHS) {
    const target = path.join(fakeVccProjectPath, ...assetPath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'demo placeholder\n', 'utf8');
  }

  await evalJs(`window.__demoCursor.pause(400)`);
  await evalJs(`window.__demoCursor.show()`);

  await evalJs(`window.__demoCursor.moveTo('#project-items-btn', 600)`);
  await evalJs(`window.__demoCursor.click('#project-items-btn')`); // real: opens the modal, lists the (fake demo) Unity project
  await delay(600);

  await evalJs(`window.__demoCursor.moveTo('#project-items-reconcile', 550)`);
  await evalJs(`window.__demoCursor.click('#project-items-reconcile')`); // real: local file scan only
  await delay(1400); // let the real progress bar animate through collect -> reconcile -> done

  await evalJs(`window.__demoCursor.pause(1200)`); // hold on the (genuine, positive) result

  await evalJs(`window.__demoCursor.moveTo('#project-items-close', 500)`);
  await evalJs(`window.__demoCursor.click('#project-items-close')`);

  await evalJs(`window.__demoCursor.hide()`);
  await delay(1000); // static hold before the GIF loops
}

runDemo({ outPath: OUT_PATH, sequence }).catch((e) => {
  console.error('ERROR:', e.stack || e.message || String(e));
  process.exit(1);
});
