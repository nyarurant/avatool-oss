'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
  ensureVrcSdk,
  ensureBridgeScripts,
  findSdkDonor,
  normalizeWindOptions,
  waitForProcessClose,
} = require('../lib/unity_physbone_bridge');

describe('unity_physbone_bridge project provisioning', () => {
  let root;
  let donor;
  let project;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'avatool-physbone-test-'));
    donor = path.join(root, 'donor');
    project = path.join(root, 'preview');
    fs.mkdirSync(path.join(project, 'Packages'), { recursive: true });
    fs.writeFileSync(path.join(project, 'Packages', 'manifest.json'), JSON.stringify({ dependencies: {} }));
    for (const name of ['com.vrchat.base', 'com.vrchat.avatars']) {
      const dir = path.join(donor, 'Packages', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: 'test' }));
      fs.writeFileSync(path.join(dir, 'payload.txt'), name);
    }
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('finds a local project containing both official VRCSDK packages', () => {
    expect(findSdkDonor({ unityProjects: [{ path: donor }] })).toBe(donor);
  });

  test('embeds VRCSDK packages and updates the preview manifest', () => {
    expect(ensureVrcSdk(project, { unityProjects: [{ path: donor }] })).toEqual({ ok: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'Packages', 'manifest.json'), 'utf8'));
    expect(manifest.dependencies['com.vrchat.base']).toBe('file:com.vrchat.base');
    expect(manifest.dependencies['com.vrchat.avatars']).toBe('file:com.vrchat.avatars');
    expect(manifest.dependencies['com.unity.test-framework']).toBe('1.1.29');
    expect(fs.readFileSync(path.join(project, 'Packages', 'com.vrchat.base', 'payload.txt'), 'utf8'))
      .toBe('com.vrchat.base');
  });

  test('installs editor and runtime bridge scripts into separate Unity assemblies', () => {
    expect(ensureBridgeScripts(project)).toEqual({ ok: true });
    expect(fs.existsSync(path.join(project, 'Assets', 'Avatool', 'AvatoolPhysBonePoseStreamer.cs'))).toBe(true);
    expect(fs.existsSync(path.join(project, 'Assets', 'Avatool', 'Editor', 'AvatoolPhysBoneBridge.cs'))).toBe(true);
  });

  test('normalizes pseudo wind settings and clamps unsafe values', () => {
    expect(normalizeWindOptions({})).toEqual({
      pseudoWind: true,
      windStrength: 1,
      windFrequency: 1,
    });
    expect(normalizeWindOptions({ pseudoWind: false, windStrength: 99, windFrequency: 0 })).toEqual({
      pseudoWind: false,
      windStrength: 3,
      windFrequency: 0.2,
    });
    expect(normalizeWindOptions({ autoMotion: false })).toHaveProperty('pseudoWind', false);
  });
});

describe('unity_physbone_bridge shutdown', () => {
  function fakeSession() {
    const proc = new EventEmitter();
    proc.exitCode = null;
    proc.signalCode = null;
    return { process: proc, processClosed: false };
  }

  // Unity keeps Temp/UnityLockfile until the process exits, so stopping must not
  // report done before then or an immediate restart fails with unity_project_locked.
  test('waits for the Unity process to actually close', async () => {
    const session = fakeSession();
    let settled = false;
    const pending = waitForProcessClose(session, 5000).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    session.process.emit('close', 0);
    await expect(pending).resolves.toBe(true);
  });

  test('gives up after the timeout so a hung Unity cannot block forever', async () => {
    const session = fakeSession();
    await expect(waitForProcessClose(session, 20)).resolves.toBe(false);
  });

  test('resolves immediately when the process already exited', async () => {
    const session = fakeSession();
    session.process.exitCode = 0;
    await expect(waitForProcessClose(session, 5000)).resolves.toBe(true);
  });

  // Stopping waits for the process, but a fast off/on toggle can still race the
  // lock, so starting waits it out instead of failing the click outright.
  test('starting waits for the project lock instead of failing immediately', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'unity_physbone_bridge.js'), 'utf8');
    expect(source).toContain('await waitForProjectUnlock(projectPath, 30000)');
  });
});
