'use strict';

const fs = require('fs');
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

const EDITOR_SCRIPT = 'AvatoolAnimationBake.cs';
const SESSION_ROOT = path.join(os.tmpdir(), 'avatool-animation-bake');
const inFlight = new Map();
// Requests for different clips hash to different inFlight keys but share one
// dedicated Unity project per package, so they must still run one at a time.
const projectChains = new Map();

function runExclusiveForProject(projectPath, task) {
  const previous = projectChains.get(projectPath) || Promise.resolve();
  const run = previous.then(task, task);
  const tracked = run.catch(() => {});
  projectChains.set(projectPath, tracked);
  tracked.then(() => {
    if (projectChains.get(projectPath) === tracked) projectChains.delete(projectPath);
  });
  return run;
}

function ensureBakeScript(projectPath) {
  const source = path.join(__dirname, 'unity_templates', EDITOR_SCRIPT);
  const directory = path.join(projectPath, 'Assets', 'Avatool', 'Editor');
  const destination = path.join(directory, EDITOR_SCRIPT);
  if (!fs.existsSync(source)) return { error: 'animation_bake_script_missing' };
  fs.mkdirSync(directory, { recursive: true });
  const body = fs.readFileSync(source, 'utf8');
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== body) {
    fs.writeFileSync(destination, body, 'utf8');
  }
  return { ok: true };
}

function readBake(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(value?.frames) || !value.frames.length) return null;
    if (!value.frames.every((frame) => Array.isArray(frame?.bones))) return null;
    return value;
  } catch {
    return null;
  }
}

function spawnBake(editor, args, outputJson, logPath, timeoutMs = 600000) {
  return new Promise((resolve) => {
    const proc = spawn(editor, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* already stopped */ }
      finish({ error: 'animation_bake_timeout', logPath });
    }, timeoutMs);
    timer.unref?.();
    proc.on('error', (error) => finish({ error: error.message, logPath }));
    proc.on('close', (code) => {
      const baked = readBake(outputJson);
      if (baked) finish({ ok: true, baked, code, logPath });
      else finish({ error: `animation_bake_failed_${code}`, code, logPath });
    });
  });
}

async function bakeUnityAnimation(opts = {}) {
  const settings = opts.settings || {};
  const editor = resolveEditorPath(settings);
  if (!editor) return { error: 'unity_editor_not_found' };
  const packagePath = path.resolve(String(opts.packagePath || ''));
  if (!packagePath || !fs.existsSync(packagePath)) return { error: 'package_not_found' };
  const prefabPathContains = String(opts.prefabPathContains || '').replace(/\\/g, '/');
  const clipPathContains = String(opts.clipPathContains || '').replace(/\\/g, '/');
  if (!prefabPathContains || !clipPathContains) return { error: 'animation_bake_asset_path_missing' };
  const fps = Math.max(15, Math.min(60, Number(opts.fps) || 60));
  const fingerprint = packageFingerprint(packagePath);
  const key = crypto.createHash('sha256').update(JSON.stringify({
    fingerprint,
    prefabPathContains: prefabPathContains.toLowerCase(),
    clipPathContains: clipPathContains.toLowerCase(),
    fps,
    schema: 2,
  })).digest('hex').slice(0, 24);
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    const projectPath = getDedicatedPreviewProjectPath(packagePath);
    const cacheDir = path.join(projectPath, 'AvatoolAnimationCache');
    const outputJson = path.join(cacheDir, `${key}.json`);
    const cached = readBake(outputJson);
    if (cached) return { ok: true, cached: true, ...cached };

    return runExclusiveForProject(projectPath, async () => {
      // Another request may have baked this clip while we waited for the project.
      const bakedMeanwhile = readBake(outputJson);
      if (bakedMeanwhile) return { ok: true, cached: true, ...bakedMeanwhile };

      // Housekeeping only — a busy sibling project must not fail the bake.
      const pruned = await prunePreviewProjectCache(projectPath, 3);
      const pruneWarning = pruned?.error || '';
      await pruneStaleTempDirs(SESSION_ROOT);
      if (!await waitForProjectUnlock(projectPath)) {
        return { error: 'unity_project_locked', projectPath, pruneWarning };
      }
      if (!fs.existsSync(path.join(projectPath, 'Assets'))) {
        const created = await createUnityProject(editor, projectPath);
        if (created.error) return { ...created, pruneWarning };
      }
      const script = ensureBakeScript(projectPath);
      if (script.error) return { ...script, pruneWarning };

      fs.mkdirSync(cacheDir, { recursive: true });

      const sessionDir = path.join(SESSION_ROOT, key);
      fs.mkdirSync(sessionDir, { recursive: true });
      const requestPath = path.join(sessionDir, 'request.json');
      const logPath = path.join(sessionDir, 'unity.log');
      const packageAlreadyImported = hasMatchingPackageMarker(projectPath, fingerprint);
      fs.writeFileSync(requestPath, JSON.stringify({
        packagePath: packageAlreadyImported ? '' : packagePath,
        prefabPathContains,
        clipPathContains,
        outputJson,
        fps,
      }, null, 2), 'utf8');

      const args = [
        '-batchmode',
        '-nographics',
        '-projectPath', projectPath,
        '-executeMethod', 'AvatoolAnimationBake.Run',
        '-animationBakeRequest', requestPath,
        '-logFile', logPath,
      ];
      let result = await spawnBake(editor, args, outputJson, logPath);
      // A newly copied editor script can trigger a domain reload before the
      // requested method runs. A second launch then executes against compiled code.
      if (result.error && result.code === 0) result = await spawnBake(editor, args, outputJson, logPath);
      // Keep the scratch directory on failure so its Unity log stays available.
      if (result.error) return { ...result, pruneWarning };
      if (!packageAlreadyImported && fingerprint) writePackageMarker(projectPath, fingerprint);
      await removeDirSafe(sessionDir);
      return { ok: true, cached: false, ...result.baked, logPath, pruneWarning };
    });
  })();
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

module.exports = {
  bakeUnityAnimation,
  ensureBakeScript,
  readBake,
  waitForProjectUnlock,
  runExclusiveForProject,
};
