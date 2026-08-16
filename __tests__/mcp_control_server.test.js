'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMcpControlServer } = require('../lib/mcp_control_server');

function request(endpoint, options = {}, body = '') {
  const url = new URL(endpoint);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: options.method || 'POST', headers: options.headers || {} }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('mcp control server', () => {
  let directory;
  let endpointPath;
  let control;

  beforeEach(async () => {
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'avatool-mcp-'));
    endpointPath = path.join(directory, 'mcp-endpoint.json');
    control = createMcpControlServer({
      endpointPath,
      version: 'test-version',
      allowedTools: ['library.list'],
      process: { pid: 12345, env: {}, cwd: () => directory },
      callTool: async (tool, args) => ({ tool, args }),
    });
  });

  afterEach(async () => {
    await control.stop();
    await fs.promises.rm(directory, { recursive: true, force: true });
  });

  test('requires bearer authentication', async () => {
    const endpoint = await control.start();
    const response = await request(endpoint.endpoint, { headers: { 'Content-Type': 'application/json' } }, '{}');
    expect(response.status).toBe(401);
  });

  test('dispatches an allowed tool', async () => {
    const endpoint = await control.start();
    const response = await request(endpoint.endpoint, { headers: { Authorization: `Bearer ${endpoint.token}`, 'Content-Type': 'application/json' } }, JSON.stringify({ tool: 'library.list', args: { limit: 2 } }));
    expect(response.status).toBe(200);
    expect(response.body.result).toEqual({ tool: 'library.list', args: { limit: 2 } });
  });

  test('rejects an unknown tool without dispatching', async () => {
    const endpoint = await control.start();
    const response = await request(endpoint.endpoint, { headers: { Authorization: `Bearer ${endpoint.token}`, 'Content-Type': 'application/json' } }, JSON.stringify({ tool: 'secret.deleteAll', args: {} }));
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'unknown_tool' });
  });

  test('rejects oversized, malformed JSON, and wrong content type requests', async () => {
    const endpoint = await control.start();
    const headers = { Authorization: `Bearer ${endpoint.token}`, 'Content-Type': 'application/json' };
    expect((await request(endpoint.endpoint, { headers }, 'x'.repeat(1048577))).status).toBe(413);
    expect((await request(endpoint.endpoint, { headers }, '{')).status).toBe(400);
    expect((await request(endpoint.endpoint, { headers: { ...headers, 'Content-Type': 'text/plain' } }, '{}')).status).toBe(415);
  });

  test('writes endpoint metadata and removes it on stop', async () => {
    const endpoint = await control.start();
    const saved = JSON.parse(await fs.promises.readFile(endpointPath, 'utf8'));
    expect(saved).toEqual(endpoint);
    await control.stop();
    await expect(fs.promises.access(endpointPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(control.getEndpoint()).toBeNull();
  });
});
