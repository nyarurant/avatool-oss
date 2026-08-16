'use strict';

const nodeFs = require('node:fs');
const nodePath = require('node:path');
const nodeCrypto = require('node:crypto');
const { spawn: nodeSpawn } = require('node:child_process');

const SKILL_NAME = 'avatool-mcp';
const MANAGED_MARKER = '.avatool-managed.json';
const MCP_NAME = 'avatool';
const COMMAND_TIMEOUT_MS = 15_000;
const MANAGED_MARKER_VERSION = 1;

function normaliseCommandResult(result) {
  const code = Number.isInteger(result?.code) ? result.code
    : Number.isInteger(result?.exitCode) ? result.exitCode : null;
  return {
    code,
    stdout: String(result?.stdout || ''),
    stderr: String(result?.stderr || ''),
    timedOut: Boolean(result?.timedOut),
    error: result?.error ? String(result.error.message || result.error) : null,
    errorCode: result?.errorCode || result?.error?.code || null,
  };
}

function createProcessRunner({ spawn = nodeSpawn, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  return (command, args, { timeoutMs = COMMAND_TIMEOUT_MS } = {}) => new Promise((resolve) => {
    let child;
    let finished = false;
    let fallbackStarted = false;
    let stdout = '';
    let stderr = '';
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeoutImpl(timer);
      resolve(normaliseCommandResult(result));
    };
    const timer = setTimeoutImpl(() => {
      try { child?.kill(); } catch { /* best-effort timeout cleanup */ }
      finish({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    const fallbackCommand = /^[a-z0-9_-]+$/i.test(command) ? `${command}.cmd` : null;
    const fallbackScript = '& $args[0] @($args[1..($args.Length - 1)]); exit $LASTEXITCODE';
    const launch = (executable, commandArgs, canFallback) => {
      let launched;
      try {
        launched = spawn(executable, commandArgs, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        if (canFallback && fallbackCommand && !fallbackStarted && (error?.code === 'ENOENT' || error?.code === 'EINVAL')) {
          fallbackStarted = true;
          launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', fallbackScript, fallbackCommand, ...args], false);
          return;
        }
        finish({ code: null, stdout, stderr, error });
        return;
      }
      child = launched;
      launched.stdout?.on('data', (chunk) => { stdout += chunk; });
      launched.stderr?.on('data', (chunk) => { stderr += chunk; });
      launched.once('error', (error) => {
        if (finished || launched !== child) return;
        if (canFallback && fallbackCommand && !fallbackStarted && (error?.code === 'ENOENT' || error?.code === 'EINVAL')) {
          fallbackStarted = true;
          launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', fallbackScript, fallbackCommand, ...args], false);
          return;
        }
        finish({ code: null, stdout, stderr, error });
      });
      launched.once('close', (code, signal) => {
        if (launched !== child) return;
        finish({ code, stdout, stderr: signal ? `${stderr}\n${signal}` : stderr });
      });
    };
    launch(command, args, true);
  });
}

function createAgentIntegrationService({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  processObj = process,
  env = process.env,
  appRoot = process.cwd(),
  executablePath = process.execPath,
  runner,
  commandTimeoutMs = COMMAND_TIMEOUT_MS,
} = {}) {
  const run = runner || createProcessRunner();
  const sourceSkillPath = path.resolve(appRoot, 'skills', SKILL_NAME);
  const serverPath = path.resolve(appRoot, 'mcp', 'server.js');
  const mcpExecutablePath = path.resolve(executablePath);
  const userProfile = env.USERPROFILE || '';
  const agents = Object.freeze([
    { id: 'codex', command: 'codex', skillRoot: ['.agents', 'skills'] },
    { id: 'claude', command: 'claude', skillRoot: ['.claude', 'skills'] },
  ]);

  function targetSkillPath(agent) {
    return userProfile ? path.join(userProfile, ...agent.skillRoot, SKILL_NAME) : null;
  }

  function markerPath(directory) {
    return path.join(directory, MANAGED_MARKER);
  }

  function readMarker(directory) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath(directory), 'utf8'));
      return marker && marker.manager === 'avatool' && marker.skill === SKILL_NAME ? marker : null;
    } catch {
      return null;
    }
  }

  function directoryHash(directory, { excludeMarker = false } = {}) {
    const hash = crypto.createHash('sha256');
    const visit = (current, relative) => {
      const entries = fs.readdirSync(current, { withFileTypes: true })
        .filter((entry) => !(excludeMarker && !relative && entry.name === MANAGED_MARKER))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        const childPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          hash.update(`d:${childRelative}\0`);
          visit(childPath, childRelative);
        } else if (entry.isFile()) {
          hash.update(`f:${childRelative}\0`);
          hash.update(fs.readFileSync(childPath));
        }
      }
    };
    visit(directory, '');
    return hash.digest('hex');
  }

  function sourceState() {
    if (!fs.existsSync(sourceSkillPath) || !fs.existsSync(path.join(sourceSkillPath, 'SKILL.md'))) {
      return { ok: false, path: sourceSkillPath, error: 'bundled_skill_missing' };
    }
    try {
      return { ok: true, path: sourceSkillPath, hash: directoryHash(sourceSkillPath, { excludeMarker: true }) };
    } catch (error) {
      return { ok: false, path: sourceSkillPath, error: error.message || String(error) };
    }
  }

  function inspectSkill(destination, source) {
    if (!destination) return { state: 'unavailable', path: null, reason: 'USERPROFILE is unavailable' };
    if (!fs.existsSync(destination)) return { state: 'missing', path: destination };
    const marker = readMarker(destination);
    if (!marker) {
      try {
        const actualHash = directoryHash(destination, { excludeMarker: true });
        if (source?.ok && actualHash === source.hash) {
          return { state: 'unmanaged_current', path: destination, sourceHash: actualHash };
        }
      } catch { /* classify unreadable unmanaged content as user-owned below */ }
      return { state: 'user_owned', path: destination };
    }
    let actualHash;
    try { actualHash = directoryHash(destination, { excludeMarker: true }); } catch (error) {
      return { state: 'invalid', path: destination, managed: true, error: error.message || String(error) };
    }
    if (actualHash !== marker.sourceHash) {
      return { state: 'modified', path: destination, managed: true, sourceHash: marker.sourceHash, actualHash };
    }
    return {
      state: source?.ok && marker.sourceHash === source.hash ? 'current' : 'outdated',
      path: destination,
      managed: true,
      sourceHash: marker.sourceHash,
    };
  }

  function installManagedSkill(destination, source) {
    const before = inspectSkill(destination, source);
    if (!source.ok) return { action: 'failed', ...before, error: source.error };
    if (before.state === 'current') return { action: 'unchanged', ...before };
    if (before.state === 'unmanaged_current') return { action: 'preserved', ...before };
    if (before.state === 'user_owned' || before.state === 'modified') return { action: 'preserved', ...before };
    if (before.state === 'unavailable' || before.state === 'invalid') return { action: 'failed', ...before };

    const parent = path.dirname(destination);
    const nonce = crypto.randomBytes(8).toString('hex');
    const temporary = path.join(parent, `.${SKILL_NAME}.avatool-tmp-${nonce}`);
    const backup = path.join(parent, `.${SKILL_NAME}.avatool-backup-${nonce}`);
    fs.mkdirSync(parent, { recursive: true });
    try {
      fs.cpSync(sourceSkillPath, temporary, { recursive: true, errorOnExist: true, force: false });
      fs.writeFileSync(markerPath(temporary), JSON.stringify({
        manager: 'avatool',
        skill: SKILL_NAME,
        version: MANAGED_MARKER_VERSION,
        sourceHash: source.hash,
      }, null, 2));
      if (before.state === 'outdated') fs.renameSync(destination, backup);
      try {
        fs.renameSync(temporary, destination);
      } catch (error) {
        if (fs.existsSync(backup)) fs.renameSync(backup, destination);
        throw error;
      }
      if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
      return { action: before.state === 'outdated' ? 'updated' : 'installed', ...inspectSkill(destination, source) };
    } catch (error) {
      try { if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* cleanup only */ }
      return { action: 'failed', ...before, error: error.message || String(error) };
    }
  }

  async function runCli(command, args) {
    try {
      return normaliseCommandResult(await run(command, args, { shell: false, timeoutMs: commandTimeoutMs }));
    } catch (error) {
      return normaliseCommandResult({ code: null, error });
    }
  }

  function commandAvailable(result) {
    return result.code === 0 && !result.timedOut;
  }

  async function inspectMcp(agent, available) {
    if (!available) return { state: 'unavailable' };
    const getArgs = agent.id === 'codex'
      ? ['mcp', 'get', MCP_NAME, '--json']
      : ['mcp', 'get', MCP_NAME];
    const result = await runCli(agent.command, getArgs);
    const output = `${result.stdout}\n${result.stderr}`;
    if (agent.id === 'codex' && result.code === 0) {
      try {
        const registration = JSON.parse(result.stdout);
        const transport = registration?.transport;
        const samePath = (actual, expected) => typeof actual === 'string' && actual.replace(/[\\/]+/g, '\\').toLowerCase() === expected.replace(/[\\/]+/g, '\\').toLowerCase();
        const hasExpectedTransport = registration?.name === MCP_NAME && registration?.enabled === true &&
          transport?.type === 'stdio' && samePath(transport.command, mcpExecutablePath) &&
          Array.isArray(transport.args) && transport.args.length === 1 && samePath(transport.args[0], serverPath) &&
          transport.env?.ELECTRON_RUN_AS_NODE === '1';
        return { state: hasExpectedTransport ? 'current' : 'mismatch', checked: true };
      } catch {
        return { state: 'mismatch', checked: true };
      }
    }
    const normalisedOutput = output.replace(/[\\/]+/g, '\\').toLowerCase();
    const expectedPath = serverPath.replace(/[\\/]+/g, '\\').toLowerCase();
    const expectedExecutable = mcpExecutablePath.replace(/[\\/]+/g, '\\').toLowerCase();
    const hasRequiredEnvironment = /electron_run_as_node\s*[:=]\s*["']?1\b/i.test(output);
    if (result.code === 0 && normalisedOutput.includes(MCP_NAME) && normalisedOutput.includes(expectedExecutable) && normalisedOutput.includes(expectedPath) && hasRequiredEnvironment) {
      return { state: 'current', checked: true };
    }
    const absent = result.code !== 0 && /not found|unknown.*avatool|no .*avatool/i.test(output);
    if (absent) return { state: 'missing', checked: true };
    if (result.code === 0) return { state: 'mismatch', checked: true };
    return { state: 'unknown', checked: true, error: result.error || result.stderr || 'MCP registration could not be inspected' };
  }

  async function inspectAgent(agent, source) {
    const availability = await runCli(agent.command, ['--version']);
    const available = commandAvailable(availability);
    return {
      cli: { available, code: availability.code, timedOut: availability.timedOut, error: availability.error || undefined },
      skill: inspectSkill(targetSkillPath(agent), source),
      mcp: await inspectMcp(agent, available),
    };
  }

  async function getStatus() {
    const source = sourceState();
    if (processObj.platform !== 'win32') {
      return { ok: false, readOnly: true, platform: processObj.platform, reason: 'windows_only', sourceSkill: source, agents: {} };
    }
    const inspected = await Promise.all(agents.map(async (agent) => [agent.id, await inspectAgent(agent, source)]));
    return { ok: source.ok, readOnly: true, platform: processObj.platform, sourceSkill: source, serverPath, executablePath: mcpExecutablePath, agents: Object.fromEntries(inspected) };
  }

  async function ensureMcp(agent, current) {
    if (current.state === 'current') return { action: 'unchanged', ...current };
    if (current.state === 'unknown' || current.state === 'unavailable') return { action: 'failed', ...current };
    if (current.state === 'mismatch') {
      const removeArgs = agent.id === 'claude'
        ? ['mcp', 'remove', MCP_NAME, '--scope', 'user']
        : ['mcp', 'remove', MCP_NAME];
      const removed = await runCli(agent.command, removeArgs);
      if (removed.code !== 0 || removed.timedOut) return { action: 'failed', state: 'mismatch', error: removed.error || removed.stderr || 'MCP removal failed' };
    }
    const addArgs = agent.id === 'claude'
      ? ['mcp', 'add', MCP_NAME, '--scope', 'user', '--transport', 'stdio', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', mcpExecutablePath, serverPath]
      : ['mcp', 'add', MCP_NAME, '--env', 'ELECTRON_RUN_AS_NODE=1', '--', mcpExecutablePath, serverPath];
    const added = await runCli(agent.command, addArgs);
    if (added.code !== 0 || added.timedOut) return { action: 'failed', state: current.state, error: added.error || added.stderr || 'MCP registration failed' };
    const verified = await inspectMcp(agent, true);
    return verified.state === 'current'
      ? { action: current.state === 'mismatch' ? 'updated' : 'installed', ...verified }
      : { action: 'failed', ...verified, error: verified.error || 'MCP registration could not be verified' };
  }

  async function setup({ confirmed = false } = {}) {
    if (!confirmed) return { ok: false, reason: 'confirmation_required', agents: {} };
    if (processObj.platform !== 'win32') return { ok: false, reason: 'windows_only', platform: processObj.platform, agents: {} };
    const source = sourceState();
    if (!source.ok) return { ok: false, reason: source.error, sourceSkill: source, agents: {} };
    const results = {};
    for (const agent of agents) {
      const availability = await runCli(agent.command, ['--version']);
      const available = commandAvailable(availability);
      const cli = { available, code: availability.code, timedOut: availability.timedOut, error: availability.error || undefined };
      if (!available) {
        results[agent.id] = { cli, skill: { action: 'skipped', reason: 'cli_unavailable' }, mcp: { action: 'skipped', reason: 'cli_unavailable' } };
        continue;
      }
      const skill = installManagedSkill(targetSkillPath(agent), source);
      const mcp = await ensureMcp(agent, await inspectMcp(agent, true));
      results[agent.id] = { cli, skill, mcp };
    }
    const values = Object.values(results);
    const unavailableAgents = Object.entries(results).filter(([, result]) => !result.cli.available).map(([id]) => id);
    const failedAgents = Object.entries(results).filter(([, result]) => result.cli.available && (result.skill.action === 'failed' || result.mcp.action === 'failed')).map(([id]) => id);
    const preservedAgents = Object.entries(results).filter(([, result]) => result.skill.action === 'preserved' && result.skill.state === 'user_owned').map(([id]) => id);
    const restartRequired = values.some((result) => ['installed', 'updated'].includes(result.skill.action) || ['installed', 'updated'].includes(result.mcp.action));
    const partial = unavailableAgents.length > 0 || failedAgents.length > 0 || preservedAgents.length > 0;
    return {
      ok: !partial,
      partial,
      confirmed: true,
      sourceSkill: source,
      serverPath,
      executablePath: mcpExecutablePath,
      unavailableAgents,
      failedAgents,
      preservedAgents,
      restartRequired,
      agents: results,
    };
  }

  return { getStatus, setup };
}

module.exports = { createAgentIntegrationService, createProcessRunner, normaliseCommandResult };
