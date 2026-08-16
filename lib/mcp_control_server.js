'use strict';

const nodeHttp = require('http');
const nodeCrypto = require('crypto');
const nodeFs = require('fs');
const nodePath = require('path');

const MAX_BODY_BYTES = 1024 * 1024;

function createMcpControlServer(deps = {}) {
  const http = deps.http || nodeHttp;
  const crypto = deps.crypto || nodeCrypto;
  const fs = deps.fs || nodeFs;
  const path = deps.path || nodePath;
  const processLike = deps.process || process;
  const version = deps.version || (() => {
    try { return require('../package.json').version; } catch { return 'unknown'; }
  })();
  const endpointPath = deps.endpointPath || path.join(
    processLike.env?.APPDATA || path.join(processLike.cwd(), 'data'),
    'avatool', 'data', 'mcp-endpoint.json',
  );
  const allowedTools = deps.allowedTools || deps.toolAllowlist || [];
  const callTool = typeof deps.callTool === 'function' ? deps.callTool : async () => {
    throw new Error('MCP tool dispatcher is not configured');
  };

  let server = null;
  let endpoint = null;
  let endpointFileOwned = false;

  const isAllowed = (tool) => {
    if (typeof allowedTools === 'function') return !!allowedTools(tool);
    if (allowedTools instanceof Set) return allowedTools.has(tool);
    return Array.isArray(allowedTools) && allowedTools.includes(tool);
  };

  const writeEndpoint = async (value) => {
    const directory = path.dirname(endpointPath);
    await fs.promises.mkdir(directory, { recursive: true });
    const temporary = `${endpointPath}.${processLike.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    try {
      await fs.promises.rename(temporary, endpointPath);
    } catch (error) {
      try { await fs.promises.unlink(temporary); } catch { /* preserve original error */ }
      throw error;
    }
  };

  const removeEndpoint = async () => {
    if (!endpointFileOwned) return;
    endpointFileOwned = false;
    try { await fs.promises.unlink(endpointPath); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  };

  const send = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  };

  const handle = (req, res) => {
    if (req.method !== 'POST' || req.url !== '/call') {
      send(res, 404, { error: 'not_found' });
      return;
    }
    if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
      send(res, 415, { error: 'content_type_required' });
      return;
    }
    const authorization = String(req.headers.authorization || '');
    if (!endpoint || authorization !== `Bearer ${endpoint.token}`) {
      send(res, 401, { error: 'unauthorized' });
      return;
    }
    const declaredLength = req.headers['content-length'];
    if (declaredLength !== undefined && (!/^\d+$/.test(String(declaredLength)) || Number(declaredLength) > MAX_BODY_BYTES)) {
      send(res, 413, { error: 'request_too_large' });
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on('error', () => send(res, 400, { error: 'invalid_request' }));
    req.on('end', async () => {
      if (tooLarge) { send(res, 413, { error: 'request_too_large' }); return; }
      let request;
      try { request = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { send(res, 400, { error: 'invalid_json' }); return; }
      if (!request || typeof request !== 'object' || typeof request.tool !== 'string' || !Object.prototype.hasOwnProperty.call(request, 'args')) {
        send(res, 400, { error: 'invalid_call' });
        return;
      }
      if (!isAllowed(request.tool)) { send(res, 404, { error: 'unknown_tool' }); return; }
      try {
        const result = await callTool(request.tool, request.args);
        send(res, 200, { result });
      } catch (error) {
        send(res, 500, { error: error && error.message ? error.message : 'tool_failed' });
      }
    });
  };

  const start = async () => {
    if (server) return endpoint;
    const token = crypto.randomBytes(32).toString('hex');
    server = http.createServer(handle);
    await new Promise((resolve, reject) => {
      const onError = (error) => { server.off('listening', onListening); reject(error); };
      const onListening = async () => {
        server.off('error', onError);
        const address = server.address();
        endpoint = { endpoint: `http://127.0.0.1:${address.port}/call`, token, pid: processLike.pid, version };
        try { await writeEndpoint(endpoint); endpointFileOwned = true; resolve(); }
        catch (error) { server.close(); server = null; reject(error); }
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, '127.0.0.1');
    });
    return endpoint;
  };

  const stop = async () => {
    if (server) await new Promise((resolve) => server.close(() => resolve()));
    server = null;
    endpoint = null;
    await removeEndpoint();
  };

  return { start, stop, getEndpoint: () => endpoint };
}

module.exports = { createMcpControlServer, MAX_BODY_BYTES };
