/**
 * CDP probe helper — run as: node scripts/cdp_probe.js [expression]
 * Connects to --remote-debugging-port=9222 and evaluates an expression.
 */
const net = require('net');
const crypto = require('crypto');

const WS_PATH = process.env.CDP_PATH || null;
const EXPRESSION = process.argv[2] || 'document.title';
const PORT = 9222;

async function getTarget() {
  return new Promise((resolve, reject) => {
    let data = '';
    const req = net.createConnection(PORT, 'localhost', () => {
      req.write('GET /json HTTP/1.1\r\nHost: localhost:' + PORT + '\r\nConnection: close\r\n\r\n');
    });
    req.on('data', d => { data += d; });
    req.on('end', () => {
      try {
        const json = data.slice(data.indexOf('\r\n\r\n') + 4);
        const targets = JSON.parse(json);
        const page = targets.find(t => t.type === 'page');
        resolve(page ? page.webSocketDebuggerUrl.replace('ws://localhost:9222', '') : null);
      } catch(e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function cdpEval(expression) {
  const path = WS_PATH || await getTarget();
  if (!path) throw new Error('No page target found');

  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const client = net.createConnection(PORT, 'localhost', () => {
      client.write(
        `GET ${path} HTTP/1.1\r\nHost: localhost:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });

    let upgraded = false, buf = Buffer.alloc(0);

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

    function parseFrame(b) {
      if (b.length < 2) return null;
      const l = b[1] & 0x7f;
      const s = l < 126 ? 2 : 4;
      const pl = l < 126 ? l : b.readUInt16BE(2);
      if (b.length < s + pl) return null;
      return { data: b.slice(s, s + pl).toString(), consumed: s + pl };
    }

    client.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const str = buf.toString();
        if (str.includes('\r\n\r\n')) {
          upgraded = true;
          buf = buf.slice(buf.indexOf('\r\n\r\n') + 4);
          send({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } });
        }
      } else {
        let f;
        while ((f = parseFrame(buf))) {
          buf = buf.slice(f.consumed);
          try {
            const msg = JSON.parse(f.data);
            if (msg.id === 1) {
              client.destroy();
              if (msg.result?.exceptionDetails) {
                reject(new Error(msg.result.exceptionDetails.text));
              } else {
                resolve(msg.result?.result?.value);
              }
            }
          } catch {}
        }
      }
    });

    client.on('error', reject);
    setTimeout(() => { client.destroy(); reject(new Error('timeout')); }, 15000);
  });
}

cdpEval(EXPRESSION).then(v => {
  if (typeof v === 'string') {
    try { console.log(JSON.stringify(JSON.parse(v), null, 2)); }
    catch { console.log(v); }
  } else {
    console.log(v);
  }
}).catch(e => { console.error('ERROR:', e.message); process.exit(1); });
