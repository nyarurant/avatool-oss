'use strict';

/**
 * Shared CDP/ffmpeg plumbing for the README demo recorders
 * (scripts/demo/demo_*.js). Each recorder only supplies a `sequence`
 * callback describing its own cursor choreography; this module handles
 * spawning Electron, connecting over CDP, injecting the fake cursor,
 * capturing frames, and encoding the GIF.
 *
 * Never shipped (scripts/** is excluded from both the packaged app and
 * source-<version>.zip).
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { createDemoData } = require('./demo_data');

const ROOT = path.resolve(__dirname, '..', '..');
const CDP_PORT = 9222;
const GIF_FPS = 30; // Page.startScreencast easily sustains this; ffmpeg retimes to the real measured fps if it can't.
const GIF_WIDTH = 960;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPageWsPath() {
  return new Promise((resolve, reject) => {
    let data = '';
    let settled = false;
    const req = net.createConnection(CDP_PORT, 'localhost', () => {
      req.write(`GET /json HTTP/1.1\r\nHost: localhost:${CDP_PORT}\r\nConnection: close\r\n\r\n`);
    });
    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(new Error('getPageWsPath timed out'));
    }, 5000);
    function settle(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      fn(value);
    }
    req.on('data', (d) => {
      data += d;
      const bodyStart = data.indexOf('\r\n\r\n');
      if (bodyStart === -1 || settled) return;
      try {
        const targets = JSON.parse(data.slice(bodyStart + 4));
        const page = targets.find((t) => t.type === 'page');
        req.destroy();
        settle(resolve, page ? page.webSocketDebuggerUrl.replace(`ws://localhost:${CDP_PORT}`, '') : null);
      } catch {
        // wait for more data
      }
    });
    req.on('end', () => settle(reject, new Error('closed before valid /json response')));
    req.on('error', (e) => settle(reject, e));
  });
}

function connectCdp(wsPath) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const client = net.createConnection(CDP_PORT, 'localhost', () => {
      client.write(
        `GET ${wsPath} HTTP/1.1\r\nHost: localhost:${CDP_PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    let upgraded = false;
    let buf = Buffer.alloc(0);
    const pending = new Map();
    const eventHandlers = new Map();
    let nextId = 1;

    function on(method, handler) {
      eventHandlers.set(method, handler);
    }

    function send(method, params = {}) {
      const id = nextId++;
      const payload = { id, method, params };
      const p = Buffer.from(JSON.stringify(payload));
      const m = crypto.randomBytes(4);
      const lenByte = p.length < 126 ? p.length : p.length <= 0xffff ? 126 : 127;
      const hlen = p.length < 126 ? 6 : p.length <= 0xffff ? 8 : 14;
      const h = Buffer.alloc(hlen);
      h[0] = 0x81;
      h[1] = 0x80 | lenByte;
      if (lenByte === 126) h.writeUInt16BE(p.length, 2);
      else if (lenByte === 127) h.writeBigUInt64BE(BigInt(p.length), 2);
      const o = p.length < 126 ? 2 : p.length <= 0xffff ? 4 : 10;
      m.copy(h, o);
      const mp = Buffer.alloc(p.length);
      for (let i = 0; i < p.length; i++) mp[i] = p[i] ^ m[i % 4];
      client.write(Buffer.concat([h, mp]));
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            rej(new Error(`timeout for ${method}`));
          }
        }, 20000);
        pending.set(id, {
          res: (value) => { clearTimeout(timer); res(value); },
          rej: (error) => { clearTimeout(timer); rej(error); },
        });
      });
    }

    function parseFrames(b) {
      const out = [];
      let offset = 0;
      while (true) {
        if (b.length - offset < 2) break;
        const l = b[offset + 1] & 0x7f;
        const s = l < 126 ? 2 : l === 126 ? 4 : 10;
        if (b.length - offset < s) break;
        const pl = l < 126 ? l : l === 126 ? b.readUInt16BE(offset + 2) : Number(b.readBigUInt64BE(offset + 2));
        if (b.length - offset < s + pl) break;
        out.push(b.slice(offset + s, offset + s + pl).toString());
        offset += s + pl;
      }
      return { frames: out, rest: b.slice(offset) };
    }

    client.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const str = buf.toString();
        if (str.includes('\r\n\r\n')) {
          upgraded = true;
          buf = buf.slice(buf.indexOf('\r\n\r\n') + 4);
          resolve({ send, on, client });
        }
        return;
      }
      const { frames, rest } = parseFrames(buf);
      buf = rest;
      for (const f of frames) {
        try {
          const msg = JSON.parse(f);
          if (msg.id && pending.has(msg.id)) {
            const { res, rej } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) rej(new Error(JSON.stringify(msg.error)));
            else res(msg.result);
          } else if (msg.method && eventHandlers.has(msg.method)) {
            eventHandlers.get(msg.method)(msg.params);
          }
        } catch {
          // ignore malformed frame
        }
      }
    });
    client.on('error', reject);
  });
}

async function evalJs(send, expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const d = result.exceptionDetails;
    throw new Error(d.exception?.description || d.text || 'evaluate failed');
  }
  return result.result?.value;
}

async function waitForPort(port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const sock = net.createConnection(port, 'localhost');
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => resolve(false));
    });
    if (ok) return;
    await delay(200);
  }
  throw new Error(`port ${port} did not open within ${timeoutMs}ms`);
}

/**
 * @param {object} opts
 * @param {string} opts.outPath - absolute path for the output GIF
 * @param {(ctx: { send: Function, evalJs: (expr: string) => Promise<any>, delay: (ms:number) => Promise<void>, dataDir: string, fakeVccProjectPath: string }) => Promise<void>} opts.sequence
 * @param {(dataDir: string) => void} [opts.prepareData] - called after createDemoData, before Electron starts, for scenario-specific data tweaks
 */
async function runDemo({ outPath, sequence, prepareData }) {
  const OUT_PATH = path.resolve(outPath);
  // Deliberately NOT under os.tmpdir() (%TEMP%): that resolves under the
  // real Windows profile (C:\Users\<real-username>\...), and several demo
  // screens display full paths. Keep everything under the repo instead so
  // no real username ever appears in a captured frame.
  const base = path.join(ROOT, '.demo-tmp', `run-${Date.now().toString(36)}`);
  const dataDir = path.join(base, 'data');
  const framesDir = path.join(base, 'frames');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  createDemoData(dataDir);
  if (typeof prepareData === 'function') prepareData(dataDir);

  // main.js reads the real VCC project registry from
  // %LOCALAPPDATA%\VRChatCreatorCompanion\settings.json unconditionally
  // (lib/vcc_sync_service.js) — this is NOT scoped by AVATOOL_DATA_DIR, so
  // without this override any demo screen touching Unity project lists
  // would show the operator's real project names and paths. Point
  // LOCALAPPDATA at an isolated fake registry with one fictional project.
  const fakeLocalAppData = path.join(base, 'fake_local_appdata');
  const fakeVccProjectPath = path.join(fakeLocalAppData, 'SampleAvatarProject');
  fs.mkdirSync(fakeVccProjectPath, { recursive: true });
  fs.mkdirSync(path.join(fakeLocalAppData, 'VRChatCreatorCompanion'), { recursive: true });
  fs.writeFileSync(
    path.join(fakeLocalAppData, 'VRChatCreatorCompanion', 'settings.json'),
    JSON.stringify({ userProjects: [fakeVccProjectPath], preferredUnityEditors: {} }, null, 2),
    'utf8'
  );

  const electronCmd = require('electron');
  const child = spawn(electronCmd, ['.', `--remote-debugging-port=${CDP_PORT}`], {
    cwd: ROOT,
    env: {
      ...process.env,
      AVATOOL_DATA_DIR: dataDir,
      AVATOOL_KEEP_SESSION: 'false',
      AVATOOL_EDITION: '',
      AVATOOL_DEMO_RECORDING: '1',
      LOCALAPPDATA: fakeLocalAppData,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  try {
    // The window is created lazily by main.js's boot sequence; give it time
    // to reach app.whenReady() and open the debugging port before polling.
    await waitForPort(CDP_PORT, 20000);
    await delay(1500);
    const wsPath = await getPageWsPath();
    if (!wsPath) throw new Error('no page target found');
    const { send, on } = await connectCdp(wsPath);

    await send('Page.enable');
    await send('Runtime.enable');

    // Fixed viewport so every recording produces identical frame geometry.
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    });

    const evalJsBound = (expr) => evalJs(send, expr);

    // The renderer's own startup sequence (loadAssets, renderGrid, wiring
    // renderer modules, ...) takes a variable amount of time — a fixed
    // sleep here was observed to be flaky (sidebar buttons like
    // #project-items-btn not yet bound). Poll for the asset grid actually
    // having rendered cards instead.
    {
      const start = Date.now();
      let ready = false;
      // 40s, not 20s: the real-data library (real cached JPG thumbnails
      // copied in by createDemoData) takes measurably longer to load and
      // render than the old all-placeholder fictional dataset did.
      while (Date.now() - start < 40000) {
        ready = await evalJsBound(`document.querySelectorAll('[data-item-id]').length > 0 && typeof window.boothAPI?.getAppEdition === 'function'`);
        if (ready) break;
        await delay(250);
      }
      if (!ready) throw new Error('renderer did not finish its startup sequence in time');
    }

    const cursorScript = fs.readFileSync(path.join(__dirname, 'demo_cursor.js'), 'utf8');
    await evalJsBound(cursorScript);
    await evalJsBound(`(async () => { document.querySelector('#view-grid-btn')?.click(); await window.__demoCursor.pause(200); })()`);

    // Background capture — runs concurrently with the sequence below.
    // Previously polled Page.captureScreenshot in a loop sharing the same
    // CDP connection as the interaction calls; each call is a synchronous
    // request/response round trip (full compositor readback + encode +
    // base64 transfer), which measured only ~6-10fps against the 25fps
    // nominal target no matter how the format/quality/interval were tuned —
    // that per-call overhead, not encoding cost, was the real ceiling.
    // Page.startScreencast instead has Chromium push frames as they're
    // actually composited (event-driven, no per-frame request needed),
    // which is the CDP-intended mechanism for continuous capture and
    // measurably outperforms polling (~60fps vs ~6-10fps). Every pushed
    // frame must be acknowledged (Page.screencastFrameAck) or the stream
    // stalls. PNG, not JPEG: JPEG screencast frames carried inconsistent
    // per-frame colorimetry metadata that also broke the filter graph (see
    // below) — PNG doesn't have that specific problem, though it still has
    // the one below.
    //
    // The very first couple of screencast frames arrive at 1280x796, one
    // viewport layout pass short of the 1280x800 that Emulation.setDevice­
    // MetricsOverride actually requested and every later frame honors.
    // ffmpeg's paletteuse filter cannot survive ANY mid-stream input-size
    // change in its threaded filter graph — even one a `scale` filter
    // upstream fully absorbs — and aborts with "Internal bug, should not
    // have happened" the instant frame 3 shows up at the "real" size. So
    // this discards any frame that isn't exactly 1280x800 (read straight
    // out of the PNG IHDR chunk, offset 16) rather than trying to make
    // ffmpeg tolerant of a size change it never actually needs to see.
    let frameCount = 0;
    const captureStart = Date.now();
    let captureEnd = captureStart;
    on('Page.screencastFrame', (params) => {
      const buf = Buffer.from(params.data, 'base64');
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
      if (width !== 1280 || height !== 800) return;
      frameCount += 1;
      fs.writeFileSync(path.join(framesDir, `frame_${String(frameCount).padStart(5, '0')}.png`), buf);
      captureEnd = Date.now();
    });
    await send('Page.startScreencast', {
      format: 'png', maxWidth: 1280, maxHeight: 800, everyNthFrame: 1,
    });

    await sequence({ send, evalJs: evalJsBound, delay, dataDir, fakeVccProjectPath });

    await send('Page.stopScreencast');
    await delay(150); // let any in-flight screencastFrame event finish writing to disk

    const actualElapsedSec = Math.max(0.5, (captureEnd - captureStart) / 1000);
    const actualFps = frameCount / actualElapsedSec;
    const effectiveFps = Math.max(6, Math.min(GIF_FPS, Math.round(actualFps)));
    console.log(`captured ${frameCount} frames over ${actualElapsedSec.toFixed(2)}s (${actualFps.toFixed(2)} fps actual, encoding at ${effectiveFps} fps)`);
    if (frameCount < 10) throw new Error('too few frames captured, aborting GIF encode');

    // scale=1280:800 first: Page.startScreencast's maxWidth/maxHeight
    // clamp occasionally yields a frame or two at a slightly different
    // pixel size than the rest (observed 1280x796 among a run of otherwise
    // 1280x800 frames) — ffmpeg's filter graph errors ("Internal bug,
    // should not have happened") if the input stream's dimensions change
    // mid-stream, so every frame is forced to the exact requested viewport
    // size before the real downscale to GIF_WIDTH.
    const palettePath = path.join(base, 'palette.png');
    execFileSync('ffmpeg', [
      '-y', '-framerate', actualFps.toFixed(3),
      '-i', path.join(framesDir, 'frame_%05d.png'),
      '-vf', `fps=${effectiveFps},scale=1280:800,scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff`,
      '-update', '1',
      palettePath,
    ], { stdio: 'inherit' });
    execFileSync('ffmpeg', [
      '-y', '-framerate', actualFps.toFixed(3),
      '-i', path.join(framesDir, 'frame_%05d.png'),
      '-i', palettePath,
      '-lavfi', `fps=${effectiveFps},scale=1280:800,scale=${GIF_WIDTH}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer`,
      '-loop', '0',
      OUT_PATH,
    ], { stdio: 'inherit' });

    console.log(`GIF written to ${OUT_PATH}`);
    return OUT_PATH;
  } finally {
    child.kill();
    if (stderr.trim()) console.error('[electron stderr]\n' + stderr.trim());
  }
}

module.exports = { runDemo, ROOT };
