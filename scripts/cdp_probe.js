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
    let settled = false;
    // Electron's CDP HTTP server keeps the connection alive even when we send
    // "Connection: close", so 'end' never fires — parse as soon as the body looks
    // complete instead of waiting for the socket to close, and always time out.
    const req = net.createConnection(PORT, 'localhost', () => {
      req.write('GET /json HTTP/1.1\r\nHost: localhost:' + PORT + '\r\nConnection: close\r\n\r\n');
    });
    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(new Error('getTarget timed out waiting for CDP /json response.'));
    }, 5000);
    function settle(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      fn(value);
    }
    req.on('data', d => {
      data += d;
      const bodyStart = data.indexOf('\r\n\r\n');
      if (bodyStart === -1 || settled) return;
      try {
        const targets = JSON.parse(data.slice(bodyStart + 4));
        const page = targets.find(t => t.type === 'page');
        req.destroy();
        settle(resolve, page ? page.webSocketDebuggerUrl.replace('ws://localhost:9222', '') : null);
      } catch {
        // body not fully received yet; keep buffering until it parses or we time out
      }
    });
    req.on('end', () => {
      settle(reject, new Error('Connection closed before a valid /json response was received.'));
    });
    req.on('error', (e) => settle(reject, e));
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

    let settled = false;
    // Without clearing this on success, the dangling timer keeps the Node process
    // alive for the full 15s even after we've already resolved.
    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(new Error('timeout'));
    }, 15000);
    function settle(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      fn(value);
    }

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
                settle(reject, new Error(msg.result.exceptionDetails.text));
              } else {
                settle(resolve, msg.result?.result?.value);
              }
            }
          } catch { /* デバッグ用CDPメッセージ解析の失敗は無視 */ }
        }
      }
    });

    client.on('error', (e) => settle(reject, e));
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
