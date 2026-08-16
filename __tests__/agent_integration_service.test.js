'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createAgentIntegrationService, createProcessRunner } = require('../lib/agent_integration_service');

describe('agent integration service', () => {
  let root;
  let userProfile;
  let serverPath;
  let executablePath;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'avatool-agent-integration-'));
    userProfile = path.join(root, 'user');
    serverPath = path.join(root, 'mcp', 'server.js');
    executablePath = path.join(root, 'Avatool.exe');
    fs.mkdirSync(path.join(root, 'skills', 'avatool-mcp'), { recursive: true });
    fs.mkdirSync(path.dirname(serverPath), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'avatool-mcp', 'SKILL.md'), '# Avatool MCP\n');
    fs.writeFileSync(serverPath, '// server\n');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function runnerFor({ codex = 'current', claude = 'missing' } = {}) {
    const states = { codex, claude };
    const runner = jest.fn(async (command, args, options) => {
      const id = command;
      expect(options).toMatchObject({ shell: false, timeoutMs: 15_000 });
      if (args[0] === '--version') return { code: 0, stdout: `${id} 1.0` };
      if (args[0] === 'mcp' && args[1] === 'get') {
        if (states[id] === 'missing') return { code: 1, stderr: 'MCP server avatool not found' };
        if (states[id] === 'failed') return { code: 2, stderr: 'CLI failed unexpectedly' };
        if (id === 'codex' && states[id] === 'malformed') return { code: 0, stdout: '{not json' };
        if (id === 'codex') {
          const transport = states[id] === 'mismatch'
            ? { type: 'stdio', command: 'C:\\old\\Avatool.exe', args: ['C:\\old\\server.js'], env: { ELECTRON_RUN_AS_NODE: '1' } }
            : { type: 'stdio', command: executablePath, args: [serverPath], env: { ELECTRON_RUN_AS_NODE: '1' } };
          return { code: 0, stdout: JSON.stringify({ name: 'avatool', enabled: true, transport }) };
        }
        if (states[id] === 'mismatch') return { code: 0, stdout: 'avatool: node C:\\old\\server.js' };
        return { code: 0, stdout: `avatool: ELECTRON_RUN_AS_NODE=1 ${executablePath} ${serverPath}` };
      }
      if (args[0] === 'mcp' && args[1] === 'remove') {
        states[id] = 'missing';
        return { code: 0, stdout: 'removed avatool' };
      }
      if (args[0] === 'mcp' && args[1] === 'add') {
        const expected = id === 'claude'
          ? ['mcp', 'add', 'avatool', '--scope', 'user', '--transport', 'stdio', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', executablePath, serverPath]
          : ['mcp', 'add', 'avatool', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', executablePath, serverPath];
        expect(args).toEqual(expected);
        states[id] = 'current';
        return { code: 0, stdout: 'added avatool' };
      }
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    });
    return runner;
  }

  function service(runner) {
    return createAgentIntegrationService({
      fs,
      path,
      crypto,
      appRoot: root,
      env: { USERPROFILE: userProfile },
      processObj: { platform: 'win32' },
      executablePath,
      runner,
    });
  }

  test('status is read-only and identifies a correct CLI registration', async () => {
    const runner = runnerFor({ codex: 'current', claude: 'missing' });
    const result = await service(runner).getStatus();
    expect(result.readOnly).toBe(true);
    expect(result.agents.codex.mcp.state).toBe('current');
    expect(result.agents.claude.mcp.state).toBe('missing');
    expect(runner.mock.calls.some(([command, args]) => command === 'codex' && args.join(' ') === 'mcp get avatool --json')).toBe(true);
    expect(runner.mock.calls.some(([, args]) => args.includes('add') || args.includes('remove'))).toBe(false);
  });

  test.each([
    ['missing', 'missing'],
    ['mismatch', 'mismatch'],
    ['malformed', 'mismatch'],
    ['failed', 'unknown'],
  ])('classifies Codex JSON registration %s as %s', async (input, expected) => {
    const result = await service(runnerFor({ codex: input, claude: 'current' })).getStatus();
    expect(result.agents.codex.mcp.state).toBe(expected);
  });

  test('setup requires explicit confirmation before changing files or registrations', async () => {
    const runner = runnerFor();
    const result = await service(runner).setup();
    expect(result).toMatchObject({ ok: false, reason: 'confirmation_required' });
    expect(runner).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(userProfile, '.agents', 'skills', 'avatool-mcp'))).toBe(false);
  });

  test('setup installs managed skills atomically and adds a missing MCP registration', async () => {
    const runner = runnerFor({ codex: 'missing', claude: 'missing' });
    const result = await service(runner).setup({ confirmed: true });
    const destination = path.join(userProfile, '.agents', 'skills', 'avatool-mcp');
    expect(result.ok).toBe(true);
    expect(result.restartRequired).toBe(true);
    expect(result.agents.codex.skill.action).toBe('installed');
    expect(result.agents.codex.mcp.action).toBe('installed');
    expect(JSON.parse(fs.readFileSync(path.join(destination, '.avatool-managed.json'), 'utf8'))).toMatchObject({ manager: 'avatool', skill: 'avatool-mcp' });
    expect(runner.mock.calls.some(([, args]) => args[1] === 'add')).toBe(true);
  });

  test('does not overwrite a user-created skill and leaves a correct registration alone', async () => {
    const destination = path.join(userProfile, '.agents', 'skills', 'avatool-mcp');
    const claudeDestination = path.join(userProfile, '.claude', 'skills', 'avatool-mcp');
    fs.mkdirSync(destination, { recursive: true });
    fs.mkdirSync(claudeDestination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'SKILL.md'), '# Personal skill\n');
    fs.writeFileSync(path.join(claudeDestination, 'SKILL.md'), '# Personal Claude skill\n');
    const runner = runnerFor({ codex: 'current', claude: 'current' });
    const result = await service(runner).setup({ confirmed: true });
    expect(result.agents.codex.skill.action).toBe('preserved');
    expect(result).toMatchObject({ ok: false, partial: true, preservedAgents: ['codex', 'claude'] });
    expect(fs.readFileSync(path.join(destination, 'SKILL.md'), 'utf8')).toBe('# Personal skill\n');
    expect(result.agents.codex.mcp.action).toBe('unchanged');
    expect(result.restartRequired).toBe(false);
    expect(runner.mock.calls.some(([, args]) => args[1] === 'add' || args[1] === 'remove')).toBe(false);
  });

  test('updates only an unmodified managed skill and replaces a mismatched registration', async () => {
    const runner = runnerFor({ codex: 'missing', claude: 'current' });
    const first = await service(runner).setup({ confirmed: true });
    expect(first.agents.codex.skill.action).toBe('installed');
    fs.writeFileSync(path.join(root, 'skills', 'avatool-mcp', 'SKILL.md'), '# Avatool MCP v2\n');
    runner.mockClear();
    const updatingRunner = runnerFor({ codex: 'mismatch', claude: 'current' });
    const second = await service(updatingRunner).setup({ confirmed: true });
    expect(second.agents.codex.skill.action).toBe('updated');
    expect(second.agents.codex.mcp.action).toBe('updated');
    expect(updatingRunner.mock.calls.some(([, args]) => args[1] === 'remove')).toBe(true);
    expect(fs.readFileSync(path.join(userProfile, '.agents', 'skills', 'avatool-mcp', 'SKILL.md'), 'utf8')).toBe('# Avatool MCP v2\n');
  });

  test('skips unavailable CLIs without touching their destination', async () => {
    const runner = jest.fn(async (command, args) => {
      if (command === 'codex' && args[0] === '--version') return { code: null, error: new Error('ENOENT') };
      return { code: 0, stdout: 'claude 1.0' };
    });
    const result = await service(runner).setup({ confirmed: true });
    expect(result).toMatchObject({ ok: false, partial: true, unavailableAgents: ['codex'] });
    expect(result.agents.codex).toMatchObject({ cli: { available: false }, skill: { action: 'skipped' } });
    expect(fs.existsSync(path.join(userProfile, '.agents', 'skills', 'avatool-mcp'))).toBe(false);
  });

  test('falls back from EINVAL to a fixed PowerShell cmd wrapper without interpolating arguments', async () => {
    const spawned = [];
    const spawn = jest.fn((command, args) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = jest.fn();
      spawned.push({ command, args, child });
      if (command === 'codex') {
        Promise.resolve().then(() => {
          const error = new Error('invalid argument');
          error.code = 'EINVAL';
          child.emit('error', error);
        });
      } else {
        Promise.resolve().then(() => {
          child.stdout.emit('data', 'codex 1.0');
          child.emit('close', 0);
        });
      }
      return child;
    });
    const result = await createProcessRunner({ spawn })('codex', ['mcp', 'add', 'avatool', '--', 'C:\\path with spaces\\Avatool.exe', 'C:\\unsafe&name\\server.js']);
    expect(result).toMatchObject({ code: 0, stdout: 'codex 1.0' });
    expect(spawned).toHaveLength(2);
    expect(spawned[1].command).toBe('powershell.exe');
    expect(spawned[1].args).toEqual(expect.arrayContaining(['codex.cmd', 'C:\\path with spaces\\Avatool.exe', 'C:\\unsafe&name\\server.js']));
    const script = spawned[1].args[3];
    expect(script).toContain('$args');
    expect(script).not.toContain('unsafe&name');
    expect(script).not.toContain('path with spaces');
  });
});
