'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const {
  resolveEditorPath,
  getDedicatedPreviewProjectPath,
  waitForProjectUnlock,
  createUnityProject,
  packageFingerprint,
  hasMatchingPackageMarker,
  writePackageMarker,
  prunePreviewProjectCache,
  pruneStaleTempDirs,
  removeDirSafe,
} = require('./unity_preview_project');

const SESSION_ROOT = path.join(os.tmpdir(), 'avatool-physbone');
const EDITOR_SCRIPT = 'AvatoolPhysBoneBridge.cs';
const RUNTIME_SCRIPT = 'AvatoolPhysBonePoseStreamer.cs';
const SDK_PACKAGES = ['com.vrchat.base', 'com.vrchat.avatars'];
const SDK_UNITY_DEPENDENCIES = {
  'com.unity.test-framework': '1.1.29',
};

let activeSession = null;

function normalizeWindOptions(opts = {}) {
  const clamp = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  return {
    pseudoWind: opts.pseudoWind !== false && opts.autoMotion !== false,
    windStrength: clamp(opts.windStrength, 1, 0, 3),
    windFrequency: clamp(opts.windFrequency, 1, 0.2, 3),
  };
}

function copyDirRecursive(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dest = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirRecursive(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

function findSdkDonor(settings) {
  for (const row of (Array.isArray(settings?.unityProjects) ? settings.unityProjects : [])) {
    const projectPath = path.resolve(String(row?.path || row || '').trim());
    if (SDK_PACKAGES.every((name) => fs.existsSync(path.join(projectPath, 'Packages', name, 'package.json')))) {
      return projectPath;
    }
  }
  return null;
}

function ensureVrcSdk(projectPath, settings) {
  const packagesDir = path.join(projectPath, 'Packages');
  const already = SDK_PACKAGES.every((name) => fs.existsSync(path.join(packagesDir, name, 'package.json')));
  if (!already) {
    const donor = findSdkDonor(settings);
    if (!donor) return { error: 'vrcsdk_donor_not_found' };
    for (const name of SDK_PACKAGES) {
      const source = path.join(donor, 'Packages', name);
      const destination = path.join(packagesDir, name);
      fs.rmSync(destination, { recursive: true, force: true });
      copyDirRecursive(source, destination);
    }
  }

  const manifestPath = path.join(packagesDir, 'manifest.json');
  let manifest = { dependencies: {} };
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* create */ }
  if (!manifest.dependencies || typeof manifest.dependencies !== 'object') manifest.dependencies = {};
  for (const name of SDK_PACKAGES) manifest.dependencies[name] = `file:${name}`;
  for (const [name, version] of Object.entries(SDK_UNITY_DEPENDENCIES)) {
    manifest.dependencies[name] = version;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { ok: true };
}

function ensureBridgeScripts(projectPath) {
  const runtimeDir = path.join(projectPath, 'Assets', 'Avatool');
  const editorDir = path.join(runtimeDir, 'Editor');
  fs.mkdirSync(editorDir, { recursive: true });
  const copies = [
    [path.join(__dirname, 'unity_templates', RUNTIME_SCRIPT), path.join(runtimeDir, RUNTIME_SCRIPT)],
    [path.join(__dirname, 'unity_templates', EDITOR_SCRIPT), path.join(editorDir, EDITOR_SCRIPT)],
  ];
  for (const [source, destination] of copies) {
    if (!fs.existsSync(source)) return { error: 'physbone_bridge_script_missing' };
    const body = fs.readFileSync(source, 'utf8');
    if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== body) {
      fs.writeFileSync(destination, body, 'utf8');
    }
  }
  return { ok: true };
}

function safeUnlink(filePath) {
  try { fs.rmSync(filePath, { force: true }); } catch { /* ignore */ }
}

/**
 * Async on purpose: this runs 40x/second on the Electron main process, so the
 * old sync statSync/readFileSync pair stalled the UI thread while Unity streamed.
 */
async function parseLatestFrame(session) {
  if (!session || session.reading) return;
  session.reading = true;
  try {
    const stat = await fsp.stat(session.outputJson);
    if (stat.mtimeMs === session.lastFrameMtime) return;
    session.lastFrameMtime = stat.mtimeMs;
    const frame = JSON.parse(await fsp.readFile(session.outputJson, 'utf8'));
    // The session can be stopped while the reads above are in flight.
    if (activeSession !== session) return;
    if (!Array.isArray(frame?.bones) || frame.sequence === session.lastSequence) return;
    session.lastSequence = frame.sequence;
    if (session.startupTimer) {
      clearTimeout(session.startupTimer);
      session.startupTimer = null;
      session.onState?.({ state: 'ready', sessionId: session.id, boneCount: frame.bones.length });
    }
    if (!session.markerWritten && session.fingerprint) {
      writePackageMarker(session.projectPath, session.fingerprint);
      session.markerWritten = true;
    }
    session.onFrame?.({ ...frame, sessionId: session.id });
  } catch {
    // Missing file before the first frame, or an atomic rename racing antivirus —
    // either way the next tick picks it up.
  } finally {
    session.reading = false;
  }
}

function waitForProcessClose(session, timeoutMs) {
  const proc = session?.process;
  if (!proc || session.processClosed || proc.exitCode !== null || proc.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    proc.once('close', () => finish(true));
    proc.once('exit', () => finish(true));
  });
}

async function stopPhysBoneBridge(sessionId = '') {
  const session = activeSession;
  if (!session || (sessionId && session.id !== sessionId)) return { ok: true, stopped: false };
  activeSession = null;
  session.stopping = true;
  clearInterval(session.pollTimer);
  clearTimeout(session.startupTimer);
  try { fs.writeFileSync(session.stopFile, 'stop', 'utf8'); } catch { /* process may already be gone */ }
  session.onState?.({ state: 'stopped', sessionId: session.id });
  // Unity holds Temp/UnityLockfile until the process actually exits. Returning
  // before that makes an immediate restart fail with unity_project_locked.
  let closed = await waitForProcessClose(session, 5000);
  if (!closed) {
    try { session.process?.kill(); } catch { /* already exited */ }
    closed = await waitForProcessClose(session, 10000);
  }
  await removeDirSafe(session.sessionDir);
  return { ok: true, stopped: true, closed };
}

async function startPhysBoneBridge(opts = {}) {
  await stopPhysBoneBridge();
  const settings = opts.settings || {};
  const editor = resolveEditorPath(settings);
  if (!editor) return { error: 'unity_editor_not_found' };
  const packagePath = path.resolve(String(opts.packagePath || ''));
  if (!packagePath || !fs.existsSync(packagePath)) return { error: 'package_not_found' };

  const projectPath = getDedicatedPreviewProjectPath(packagePath);
  // Housekeeping only. A sibling project that is busy (or a transient FS error)
  // must not block the preview the user just asked for — surface it as a warning.
  const pruned = await prunePreviewProjectCache(projectPath, 3);
  const pruneWarning = pruned?.error || '';
  await pruneStaleTempDirs(SESSION_ROOT);
  // A Unity that was just stopped can still hold the lock for a moment; a user
  // who toggles PhysBone off and straight back on must not hit unity_project_locked.
  if (!await waitForProjectUnlock(projectPath, 30000)) {
    return { error: 'unity_project_locked', projectPath, pruneWarning };
  }
  if (!fs.existsSync(path.join(projectPath, 'Assets'))) {
    const created = await createUnityProject(editor, projectPath);
    if (created.error) return created;
  }
  const sdk = ensureVrcSdk(projectPath, settings);
  if (sdk.error) return sdk;
  const scripts = ensureBridgeScripts(projectPath);
  if (scripts.error) return scripts;

  const id = crypto.randomBytes(8).toString('hex');
  const sessionDir = path.join(SESSION_ROOT, id);
  fs.mkdirSync(sessionDir, { recursive: true });
  const outputJson = path.join(sessionDir, 'pose.json');
  const stopFile = path.join(sessionDir, 'stop.flag');
  const requestPath = path.join(sessionDir, 'request.json');
  const logPath = path.join(sessionDir, 'unity.log');
  safeUnlink(outputJson);
  safeUnlink(stopFile);
  const fingerprint = packageFingerprint(packagePath);
  const packageAlreadyImported = hasMatchingPackageMarker(projectPath, fingerprint);
  const wind = normalizeWindOptions(opts);
  fs.writeFileSync(requestPath, JSON.stringify({
    packagePath: packageAlreadyImported ? '' : packagePath,
    prefabPathContains: String(opts.prefabPathContains || ''),
    prefabName: String(opts.prefabName || ''),
    outputJson,
    stopFile,
    fps: Math.max(10, Math.min(60, Number(opts.fps) || 30)),
    ...wind,
  }, null, 2), 'utf8');

  const args = [
    '-batchmode',
    '-projectPath', projectPath,
    '-executeMethod', 'AvatoolPhysBoneBridge.Run',
    '-physBoneRequest', requestPath,
    '-logFile', logPath,
  ];
  const proc = spawn(editor, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
  const session = {
    id,
    process: proc,
    projectPath,
    packagePath,
    sessionDir,
    fingerprint,
    outputJson,
    stopFile,
    logPath,
    requestPath,
    lastFrameMtime: 0,
    lastSequence: 0,
    markerWritten: packageAlreadyImported,
    onFrame: opts.onFrame,
    onState: opts.onState,
    pollTimer: null,
    startupTimer: null,
    reading: false,
    stopping: false,
    processClosed: false,
  };
  activeSession = session;
  session.pollTimer = setInterval(() => { void parseLatestFrame(session); }, 25);
  session.pollTimer.unref?.();
  session.startupTimer = setTimeout(() => {
    if (activeSession !== session || session.lastSequence > 0) return;
    activeSession = null;
    clearInterval(session.pollTimer);
    try { fs.writeFileSync(session.stopFile, 'stop', 'utf8'); } catch { /* Unity may still be compiling */ }
    try { session.process?.kill(); } catch { /* process already exited */ }
    session.onState?.({ state: 'error', sessionId: id, error: 'unity_physbone_startup_timeout', logPath });
  }, 300000);
  session.startupTimer.unref?.();
  proc.on('error', (error) => {
    session.processClosed = true;
    if (activeSession === session) activeSession = null;
    clearInterval(session.pollTimer);
    clearTimeout(session.startupTimer);
    session.onState?.({ state: 'error', sessionId: id, error: error.message, logPath });
  });
  proc.on('close', (code) => {
    session.processClosed = true;
    if (activeSession === session) activeSession = null;
    clearInterval(session.pollTimer);
    clearTimeout(session.startupTimer);
    // stopPhysBoneBridge already reported 'stopped' and owns the scratch cleanup.
    if (session.stopping) return;
    session.onState?.({ state: code === 0 ? 'stopped' : 'error', sessionId: id, code, logPath });
    // Keep the scratch directory (and its Unity log) when the run failed.
    if (code === 0) void removeDirSafe(session.sessionDir);
  });
  session.onState?.({ state: 'starting', sessionId: id, projectPath, logPath });
  return { ok: true, sessionId: id, projectPath, logPath, pruneWarning };
}

module.exports = {
  startPhysBoneBridge,
  stopPhysBoneBridge,
  ensureVrcSdk,
  ensureBridgeScripts,
  findSdkDonor,
  normalizeWindOptions,
  waitForProcessClose,
};

process.once('exit', () => {
  try { activeSession?.process?.kill(); } catch { /* process already exited */ }
});
