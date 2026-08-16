/**
 * CDP burst screenshot capture — run as: node scripts/cdp_burst_capture.js <outDir> <durationMs> <intervalMs>
 * Keeps a single CDP connection open and repeatedly calls Page.captureScreenshot,
 * saving each result as a sequential PNG for later ffmpeg assembly.
 */
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = 9222;
const OUT_DIR = process.argv[2];
const DURATION_MS = Number(process.argv[3] || 5000);
const INTERVAL_MS = Number(process.argv[4] || 150);

async function getTarget() {
  return new Promise((resolve, reject) => {
    let data = '';
    let settled = false;
    const req = net.createConnection(PORT, 'localhost', () => {
      req.write('GET /json HTTP/1.1\r\nHost: localhost:' + PORT + '\r\nConnection: close\r\n\r\n');
    });
    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(new Error('getTarget timed out'));
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
        settle(resolve, page ? page.webSocketDebuggerUrl.replace('ws://localhost:9222', '') : null);
      } catch {
        // wait for more data
      }
    });
    req.on('end', () => settle(reject, new Error('closed before valid /json response')));
    req.on('error', (e) => settle(reject, e));
  });
}

function connect(wsPath) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const client = net.createConnection(PORT, 'localhost', () => {
      client.write(
        `GET ${wsPath} HTTP/1.1\r\nHost: localhost:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    let upgraded = false;
    let buf = Buffer.alloc(0);
    const pending = new Map();
    let nextId = 1;

    function send(method, params = {}) {
      const id = nextId++;
      const payload = { id, method, params };
      const p = Buffer.from(JSON.stringify(payload));
      const m = crypto.randomBytes(4);
      const hlen = p.length < 126 ? 6 : 8;
      const h = Buffer.alloc(hlen);
      h[0] = 0x81;
      h[1] = 0x80 | (p.length < 126 ? p.length : 126);
      if (p.length >= 126) h.writeUInt16BE(p.length, 2);
      const o = p.length < 126 ? 2 : 4;
      m.copy(h, o);
      const mp = Buffer.alloc(p.length);
      for (let i = 0; i < p.length; i++) mp[i] = p[i] ^ m[i % 4];
      client.write(Buffer.concat([h, mp]));
      return new Promise((res, rej) => {
        // Clear the timer on reply; a live 8s timer per request keeps the Node
        // process alive well after the capture finishes.
        const timer = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            rej(new Error(`timeout for ${method}`));
          }
        }, 8000);
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
          resolve({ send, client });
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
          }
        } catch {
          // ignore
        }
      }
    });
    client.on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const wsPath = await getTarget();
  if (!wsPath) throw new Error('No page target found');
  const { send, client } = await connect(wsPath);
  const start = Date.now();
  let n = 0;
  while (Date.now() - start < DURATION_MS) {
    const frameStart = Date.now();
    try {
      const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      n += 1;
      fs.writeFileSync(path.join(OUT_DIR, `frame_${String(n).padStart(5, '0')}.png`), Buffer.from(result.data, 'base64'));
    } catch (e) {
      process.stderr.write('capture error: ' + e.message + '\n');
    }
    const elapsed = Date.now() - frameStart;
    const wait = INTERVAL_MS - elapsed;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  client.destroy();
  console.log(`captured ${n} frames to ${OUT_DIR}`);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
