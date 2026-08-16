'use strict';

/**
 * Records the avatar-filter demo GIF.
 * Usage: node scripts/demo/demo_avatar_filter.js [outPath]
 * Requires ffmpeg on PATH.
 */

const path = require('path');
const { runDemo, ROOT } = require('./demo_runner');

const OUT_PATH = process.argv[2] || path.join(ROOT, 'assets', 'demo', 'avatool-demo-avatar-filter.gif');

// Storyboard: static library (6 items) -> open avatar filter -> select "ニクス"
// -> grid narrows to the 3 ニクス-compatible items (still visible behind the
// open panel) -> close panel -> hold on the filtered grid -> reopen -> clear
// filter -> grid returns to all 6 -> hold -> loop.
// Everything here is 100% real UI driven by real clicks — no backend
// simulation needed (avatar filtering is pure client-side state).
async function sequence({ evalJs, delay }) {
  await evalJs(`window.__demoCursor.pause(400)`);
  await evalJs(`window.__demoCursor.show()`);

  await evalJs(`window.__demoCursor.moveTo('#avatar-filter-button', 600)`);
  await evalJs(`window.__demoCursor.click('#avatar-filter-button')`);
  await delay(400);

  await evalJs(`window.__demoCursor.moveTo('[data-value="ニクス"]', 500)`);
  await evalJs(`window.__demoCursor.click('[data-value="ニクス"]')`);
  await delay(900); // hold with the panel open and the grid already filtered behind it

  await evalJs(`window.__demoCursor.moveTo('#avatar-filter-button', 450)`);
  await evalJs(`window.__demoCursor.click('#avatar-filter-button')`); // closes the panel (already open)
  await delay(1000); // hold on the filtered grid, panel closed

  await evalJs(`window.__demoCursor.moveTo('#avatar-filter-button', 450)`);
  await evalJs(`window.__demoCursor.click('#avatar-filter-button')`); // reopen
  await delay(350);

  await evalJs(`window.__demoCursor.moveTo('[data-value=""]', 450)`);
  await evalJs(`window.__demoCursor.click('[data-value=""]')`); // clear filter, panel auto-closes
  await delay(900);

  await evalJs(`window.__demoCursor.hide()`);
  await delay(1000); // static hold before the GIF loops
}

runDemo({ outPath: OUT_PATH, sequence }).catch((e) => {
  console.error('ERROR:', e.stack || e.message || String(e));
  process.exit(1);
});
