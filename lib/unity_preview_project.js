'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PACKAGE_MARKER = 'AvatoolPreviewPackage.json';
// Shared, long-lived helper projects live under the same root as the per-package
// preview projects but must never be pruned as if they were one of them.
const MAPPER_PROJECT_NAME = 'fbx-object-map';
const PROTECTED_PROJECT_NAMES = new Set([MAPPER_PROJECT_NAME]);

function isUsableEditorBinary(candidate) {
  try {
    const raw = String(candidate || '').trim();
    if (!raw || !path.isAbsolute(raw)) return false;
    if (process.platform === 'win32' && path.basename(raw).toLowerCase() !== 'unity.exe') return false;
    if (!fs.statSync(raw).isFile()) return false;
    fs.accessSync(raw, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unity folder names ("2022.3.22f1") sort incorrectly as plain strings —
 * "2022.3.6f1" would beat "2022.3.22f1". Compare each dotted segment numerically.
 * Returns a descending comparator (newest first).
 */
function compareUnityVersionsDesc(a, b) {
  const parts = (value) => String(value || '').split('.').map((part) => {
    const match = /^(\d+)/.exec(part);
    return match ? Number(match[1]) : 0;
  });
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (right[i] || 0) - (left[i] || 0);
    if (diff) return diff;
  }
  return String(b || '').localeCompare(String(a || ''));
}

function readProjectUnityVersion(projectPath) {
  try {
    const text = fs.readFileSync(path.join(projectPath, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8');
    const match = /m_EditorVersion:\s*(\S+)/.exec(text);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

/**
 * VRCSDK only builds against the Unity version the user's own projects are on,
 * so a Hub scan prefers those versions before falling back to the newest install.
 */
function collectPreferredUnityVersions(settings) {
  const wanted = new Set();
  for (const row of (Array.isArray(settings?.unityProjects) ? settings.unityProjects : [])) {
    const projectPath = String(row?.path || row || '').trim();
    if (!projectPath) continue;
    const version = readProjectUnityVersion(path.resolve(projectPath));
    if (version) wanted.add(version);
  }
  return wanted;
}

function resolveEditorPath(settings) {
  const raw = String(settings?.unityEditorPath || '').trim();
  if (isUsableEditorBinary(raw)) return raw;
  const hub = 'C:\\Program Files\\Unity\\Hub\\Editor';
  if (!fs.existsSync(hub)) return null;
  let versions;
  try {
    versions = fs.readdirSync(hub).filter((name) => /^\d+\.\d+/.test(name)).sort(compareUnityVersionsDesc);
  } catch {
    return null;
  }
  const preferred = collectPreferredUnityVersions(settings);
  const ordered = [
    ...versions.filter((version) => preferred.has(version)),
    ...versions.filter((version) => !preferred.has(version)),
  ];
  for (const version of ordered) {
    const editor = path.join(hub, version, 'Editor', 'Unity.exe');
    if (isUsableEditorBinary(editor)) return editor;
  }
  return null;
}

function getDedicatedPreviewProjectPath(packagePath = '') {
  const base = process.env.APPDATA || process.env.HOME || os.tmpdir();
  const root = path.join(base, 'avatool', 'unity_preview_projects');
  const raw = String(packagePath || '').trim();
  if (!raw) return root;
  const resolved = path.resolve(raw);
  const keySource = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const key = crypto.createHash('sha256').update(keySource).digest('hex').slice(0, 16);
  return path.join(root, key);
}

function getMapperProjectPath() {
  return path.join(getDedicatedPreviewProjectPath(), MAPPER_PROJECT_NAME);
}

function packageFingerprint(packagePath) {
  try {
    const stat = fs.statSync(packagePath);
    return { path: path.resolve(packagePath), size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function hasMatchingPackageMarker(projectPath, fingerprint) {
  if (!fingerprint) return false;
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(projectPath, PACKAGE_MARKER), 'utf8'));
    const markerPath = path.resolve(String(marker?.path || ''));
    const expectedPath = path.resolve(fingerprint.path);
    const samePath = process.platform === 'win32'
      ? markerPath.toLowerCase() === expectedPath.toLowerCase()
      : markerPath === expectedPath;
    return samePath && marker.size === fingerprint.size && marker.mtimeMs === fingerprint.mtimeMs;
  } catch {
    return false;
  }
}

function writePackageMarker(projectPath, fingerprint) {
  if (!fingerprint) return;
  fs.writeFileSync(path.join(projectPath, PACKAGE_MARKER), JSON.stringify(fingerprint, null, 2), 'utf8');
}

/**
 * Async on purpose: a Unity project holds tens of thousands of files, and this
 * runs on the Electron main process right before a preview starts.
 */
async function directorySize(directory) {
  let total = 0;
  let visited = 0;
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += (await fsp.stat(full)).size;
        } catch {
          // file vanished
        }
      }
      visited += 1;
      if (visited % 500 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return total;
}

async function removeDirSafe(directory) {
  try {
    await fsp.rm(directory, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Session/request scratch directories are kept on failure so their Unity logs stay
 * available for diagnosis. Sweep the stale ones instead of letting them pile up.
 */
async function pruneStaleTempDirs(baseDir, maxAgeMs = 24 * 60 * 60 * 1000) {
  const removed = [];
  let entries;
  try {
    entries = await fsp.readdir(baseDir, { withFileTypes: true });
  } catch {
    return { ok: true, removed };
  }
  const deadline = Date.now() - Math.max(0, Number(maxAgeMs) || 0);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(baseDir, entry.name);
    try {
      const stat = await fsp.stat(full);
      if (stat.mtimeMs > deadline) continue;
    } catch {
      continue;
    }
    if (await removeDirSafe(full)) removed.push(full);
  }
  return { ok: true, removed };
}

async function prunePreviewProjectCache(
  currentProjectPath,
  maxProjects = 3,
  rootOverride = '',
  maxBytes = 4 * 1024 * 1024 * 1024
) {
  const root = path.resolve(rootOverride || getDedicatedPreviewProjectPath());
  const current = path.resolve(String(currentProjectPath || ''));
  if (!current.startsWith(`${root}${path.sep}`)) return { error: 'invalid_preview_project_path' };
  try {
    await fsp.mkdir(root, { recursive: true });
    const dirEntries = await fsp.readdir(root, { withFileTypes: true });
    const others = [];
    for (const entry of dirEntries) {
      if (!entry.isDirectory() || PROTECTED_PROJECT_NAMES.has(entry.name)) continue;
      const full = path.join(root, entry.name);
      if (path.resolve(full) === current) continue;
      let mtimeMs = 0;
      try {
        const marker = path.join(full, PACKAGE_MARKER);
        const target = fs.existsSync(marker) ? marker : full;
        mtimeMs = (await fsp.stat(target)).mtimeMs;
      } catch {
        // keep zero
      }
      others.push({ full, mtimeMs });
    }
    others.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const kept = others.slice(0, Math.max(0, Math.max(1, Number(maxProjects) || 3) - 1));
    const removed = [];
    for (const row of others.slice(kept.length)) {
      await fsp.rm(row.full, { recursive: true, force: true });
      removed.push(row.full);
    }
    const byteLimit = Math.max(0, Number(maxBytes) || 0);
    if (byteLimit > 0) {
      let totalBytes = await directorySize(current);
      for (const row of kept) {
        row.bytes = await directorySize(row.full);
        totalBytes += row.bytes;
      }
      while (totalBytes > byteLimit && kept.length) {
        const row = kept.pop();
        await fsp.rm(row.full, { recursive: true, force: true });
        totalBytes -= row.bytes || 0;
        removed.push(row.full);
      }
    }
    return { ok: true, removed };
  } catch (error) {
    return { error: error?.message || 'preview_cache_prune_failed' };
  }
}

function isProjectLocked(projectPath) {
  try {
    const lockFile = path.join(projectPath, 'Temp', 'UnityLockfile');
    if (!fs.existsSync(lockFile)) return false;
    try {
      const fd = fs.openSync(lockFile, 'r+');
      fs.closeSync(fd);
      return false;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * A Unity that was just asked to quit still holds the project lock for a moment.
 * Callers that are about to launch their own Editor wait it out instead of
 * failing the user's very next click.
 */
async function waitForProjectUnlock(projectPath, timeoutMs = 120000) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  while (isProjectLocked(projectPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !isProjectLocked(projectPath);
}

function createUnityProject(editor, projectPath) {
  return new Promise((resolve) => {
    if (fs.existsSync(path.join(projectPath, 'Assets'))) {
      resolve({ ok: true, created: false });
      return;
    }
    fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    const logPath = path.join(os.tmpdir(), `avatool-create-project-${Date.now()}.log`);
    const proc = spawn(editor, ['-batchmode', '-quit', '-createProject', projectPath, '-logFile', logPath], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* process already stopped */ }
      resolve({ error: 'create_project_timeout', logPath });
    }, 300000);
    proc.on('error', (error) => {
      clearTimeout(timer);
      resolve({ error: error.message, logPath });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(path.join(projectPath, 'Assets'))) {
        resolve({ ok: true, created: true, logPath });
      } else {
        resolve({ error: `create_project_failed_${code}`, logPath });
      }
    });
  });
}

module.exports = {
  PACKAGE_MARKER,
  MAPPER_PROJECT_NAME,
  PROTECTED_PROJECT_NAMES,
  compareUnityVersionsDesc,
  readProjectUnityVersion,
  isUsableEditorBinary,
  resolveEditorPath,
  getDedicatedPreviewProjectPath,
  getMapperProjectPath,
  packageFingerprint,
  hasMatchingPackageMarker,
  writePackageMarker,
  directorySize,
  removeDirSafe,
  pruneStaleTempDirs,
  prunePreviewProjectCache,
  isProjectLocked,
  waitForProjectUnlock,
  createUnityProject,
};
