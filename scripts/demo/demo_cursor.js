(function installDemoCursor(global) {
  'use strict';

  // README demo recording helper. Injected at runtime via CDP Runtime.evaluate
  // by scripts/demo_readme.js — never shipped with the app (scripts/** is
  // excluded from both the packaged build and source-<version>.zip).
  //
  // This only draws a fake cursor + click ripple on top of the real,
  // unmodified app UI. It never fabricates its own progress/status UI —
  // anything that looks like app state (queue bar, progress bars, button
  // text) must come from the real UI, driven by real events (see
  // lib/demo_recording_service.js) or real clicks.

  if (global.__demoCursor) return;

  const style = document.createElement('style');
  style.textContent = `
    #demo-cursor {
      position: fixed;
      left: 0;
      top: 0;
      width: 30px;
      height: 30px;
      pointer-events: none;
      z-index: 999999;
      transform: translate(-6px, -4px);
      filter: drop-shadow(0 2px 4px rgba(0,0,0,.45));
      transition: opacity .15s ease;
    }
    #demo-cursor svg { display: block; }
    .demo-click-ring {
      position: fixed;
      width: 26px;
      height: 26px;
      margin-left: -13px;
      margin-top: -13px;
      border: 2px solid #7dd3fc;
      border-radius: 50%;
      pointer-events: none;
      z-index: 999998;
      animation: demo-click-ring .45s cubic-bezier(.2,.7,.3,1) forwards;
    }
    @keyframes demo-click-ring {
      from { transform: scale(.4); opacity: .9; }
      to   { transform: scale(2.1); opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';
  cursor.innerHTML = `<svg width="30" height="30" viewBox="0 0 30 30" fill="none">
    <path d="M6 2 L6 24 L11.5 19.5 L15 27 L18.5 25.5 L15 18 L23 18 Z"
      fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
  cursor.style.opacity = '0';
  document.body.appendChild(cursor);

  let pos = { x: -50, y: -50 };
  cursor.style.left = pos.x + 'px';
  cursor.style.top = pos.y + 'px';

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function show() {
    cursor.style.opacity = '1';
    await sleep(160);
  }

  async function hide() {
    cursor.style.opacity = '0';
    await sleep(160);
  }

  function targetPoint(selector) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) throw new Error('demo cursor target not found: ' + selector);
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, el };
  }

  async function moveTo(selector, durationMs = 650) {
    const { x, y } = targetPoint(selector);
    const from = { ...pos };
    const start = performance.now();
    await new Promise((resolve) => {
      function step(now) {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = easeOutCubic(t);
        pos = { x: from.x + (x - from.x) * eased, y: from.y + (y - from.y) * eased };
        cursor.style.left = pos.x + 'px';
        cursor.style.top = pos.y + 'px';
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  async function ripple(x, y) {
    const ring = document.createElement('div');
    ring.className = 'demo-click-ring';
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    document.body.appendChild(ring);
    cursor.style.transform = 'translate(-6px, -4px) scale(.85)';
    await sleep(90);
    cursor.style.transform = 'translate(-6px, -4px) scale(1)';
    await sleep(400);
    ring.remove();
  }

  // Real click: dispatches the click at the cursor's current target, so it
  // runs the app's real event handler.
  async function click(selector) {
    const { x, y, el } = selector ? targetPoint(selector) : { x: pos.x, y: pos.y, el: null };
    await ripple(x, y);
    if (el) el.click();
    else if (document.elementFromPoint) document.elementFromPoint(x, y)?.click?.();
  }

  // Visual-only click: same ripple/bounce, but never dispatches the real
  // click — used where the real handler would hit the network or spawn a
  // real Unity process (see demo_readme.js for which steps need this).
  async function clickVisual(selector) {
    const { x, y } = targetPoint(selector);
    await ripple(x, y);
  }

  async function typeInto(selector, text, perCharMs = 55) {
    const el = document.querySelector(selector);
    if (!el) throw new Error('demo cursor typeInto target not found: ' + selector);
    el.focus();
    el.value = '';
    for (const ch of text) {
      el.value += ch;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(perCharMs);
    }
  }

  async function pause(ms) {
    await sleep(ms);
  }

  global.__demoCursor = { show, hide, moveTo, click, clickVisual, typeInto, pause };
})(window);
