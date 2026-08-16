/**
 * CDP screencast recorder — run as: node scripts/cdp_screencast.js <outDir> <durationMs>
 * Connects to --remote-debugging-port=9222 and records Page.screencastFrame events
 * as sequential JPEG files (frame_00001.jpg, ...) for later ffmpeg assembly.
 */
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = 9222;
const OUT_DIR = process.argv[2];
const DURATION_MS = Number(process.argv[3] || 5000);

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

function record(wsPath) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const client = net.createConnection(PORT, 'localhost', () => {
      client.write(
        `GET ${wsPath} HTTP/1.1\r\nHost: localhost:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });

    let upgraded = false;
    let buf = Buffer.alloc(0);
    let msgId = 1;
    let frameCount = 0;
    let settled = false;

    function send(data) {
      const p = Buffer.from(JSON.stringify(data));
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

    const stopTimer = setTimeout(() => {
      send({ id: 900, method: 'Page.stopScreencast' });
      setTimeout(() => {
        if (!settled) {
          settled = true;
          client.destroy();
          resolve(frameCount);
        }
      }, 300);
    }, DURATION_MS);

    client.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const str = buf.toString();
        if (str.includes('\r\n\r\n')) {
          upgraded = true;
          buf = buf.slice(buf.indexOf('\r\n\r\n') + 4);
          send({ id: msgId++, method: 'Page.enable' });
          send({
            id: msgId++,
            method: 'Page.startScreencast',
            params: { format: 'jpeg', quality: 80, everyNthFrame: 1 },
          });
        }
      } else {
        const { frames, rest } = parseFrames(buf);
        buf = rest;
        for (const f of frames) {
          try {
            const msg = JSON.parse(f);
            process.stderr.write('MSG: ' + f.slice(0, 200) + '\n');
            if (msg.method === 'Page.screencastFrame') {
              const { data, sessionId } = msg.params;
              frameCount += 1;
              const fname = path.join(OUT_DIR, `frame_${String(frameCount).padStart(5, '0')}.jpg`);
              fs.writeFileSync(fname, Buffer.from(data, 'base64'));
              send({ id: msgId++, method: 'Page.screencastFrameAck', params: { sessionId } });
            } else if (msg.error) {
              process.stderr.write('CDP error: ' + JSON.stringify(msg) + '\n');
            }
          } catch {
            // ignore malformed frame during shutdown
          }
        }
      }
    });

    client.on('error', (e) => {
      clearTimeout(stopTimer);
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
    client.on('close', () => {
      clearTimeout(stopTimer);
      if (!settled) {
        settled = true;
        resolve(frameCount);
      }
    });
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const wsPath = await getTarget();
  if (!wsPath) throw new Error('No page target found');
  const count = await record(wsPath);
  console.log(`captured ${count} frames to ${OUT_DIR}`);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
