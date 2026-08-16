'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getDedicatedPreviewProjectPath,
  getMapperProjectPath,
  packageFingerprint,
  hasMatchingPackageMarker,
  writePackageMarker,
  prunePreviewProjectCache,
  pruneStaleTempDirs,
  isProjectLocked,
  waitForProjectUnlock,
  isUsableEditorBinary,
  compareUnityVersionsDesc,
  MAPPER_PROJECT_NAME,
} = require('../lib/unity_preview_project');

describe('unity_preview_project', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'avatool-preview-project-test-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('uses a stable isolated project path per package', () => {
    const first = getDedicatedPreviewProjectPath(path.join(root, 'a.unitypackage'));
    expect(first).toBe(getDedicatedPreviewProjectPath(path.join(root, 'a.unitypackage')));
    expect(first).not.toBe(getDedicatedPreviewProjectPath(path.join(root, 'b.unitypackage')));
  });

  test('package marker matches only the current package fingerprint', () => {
    const project = path.join(root, 'project');
    const packagePath = path.join(root, 'avatar.unitypackage');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(packagePath, 'first');
    const fingerprint = packageFingerprint(packagePath);
    writePackageMarker(project, fingerprint);
    expect(hasMatchingPackageMarker(project, fingerprint)).toBe(true);
    fs.appendFileSync(packagePath, 'changed');
    expect(hasMatchingPackageMarker(project, packageFingerprint(packagePath))).toBe(false);
  });

  test('stale Unity lock file is not treated as an active lock', () => {
    const project = path.join(root, 'project');
    fs.mkdirSync(path.join(project, 'Temp'), { recursive: true });
    fs.writeFileSync(path.join(project, 'Temp', 'UnityLockfile'), '');
    expect(isProjectLocked(project)).toBe(false);
  });

  test('waiting for an unlocked project returns immediately', async () => {
    const project = path.join(root, 'project');
    fs.mkdirSync(path.join(project, 'Temp'), { recursive: true });
    fs.writeFileSync(path.join(project, 'Temp', 'UnityLockfile'), '');
    const startedAt = Date.now();
    await expect(waitForProjectUnlock(project, 5000)).resolves.toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  test('cache pruning retains the current project and newest sibling', async () => {
    const cacheRoot = path.join(root, 'cache');
    const current = path.join(cacheRoot, 'current');
    const older = path.join(cacheRoot, 'older');
    const newer = path.join(cacheRoot, 'newer');
    for (const directory of [current, older, newer]) fs.mkdirSync(directory, { recursive: true });
    const now = Date.now() / 1000;
    fs.utimesSync(older, now - 100, now - 100);
    fs.utimesSync(newer, now, now);
    const result = await prunePreviewProjectCache(current, 2, cacheRoot, Number.MAX_SAFE_INTEGER);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(current)).toBe(true);
    expect(fs.existsSync(newer)).toBe(true);
    expect(fs.existsSync(older)).toBe(false);
  });

  test('cache pruning never deletes the shared FBX object map project', async () => {
    const cacheRoot = path.join(root, 'cache');
    const current = path.join(cacheRoot, 'current');
    const mapper = path.join(cacheRoot, MAPPER_PROJECT_NAME);
    const older = path.join(cacheRoot, 'older');
    for (const directory of [current, mapper, older]) fs.mkdirSync(directory, { recursive: true });
    const now = Date.now() / 1000;
    // Oldest of all, so a name-agnostic prune would evict it first.
    fs.utimesSync(mapper, now - 5000, now - 5000);
    fs.utimesSync(older, now - 100, now - 100);
    const result = await prunePreviewProjectCache(current, 1, cacheRoot, Number.MAX_SAFE_INTEGER);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(mapper)).toBe(true);
    expect(fs.existsSync(older)).toBe(false);
    expect(result.removed).not.toContain(mapper);
  });

  test('mapper project lives under the shared preview project root', () => {
    expect(getMapperProjectPath()).toBe(path.join(getDedicatedPreviewProjectPath(), MAPPER_PROJECT_NAME));
  });

  test('stale scratch directories are swept but recent ones are kept', async () => {
    const base = path.join(root, 'sessions');
    const stale = path.join(base, 'stale');
    const fresh = path.join(base, 'fresh');
    for (const directory of [stale, fresh]) fs.mkdirSync(directory, { recursive: true });
    const now = Date.now() / 1000;
    fs.utimesSync(stale, now - 7200, now - 7200);
    const result = await pruneStaleTempDirs(base, 60 * 60 * 1000);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  test('Unity versions compare numerically, not lexically', () => {
    const sorted = ['2022.3.6f1', '2022.3.22f1', '2019.4.31f1', '6000.0.5f1'].sort(compareUnityVersionsDesc);
    expect(sorted).toEqual(['6000.0.5f1', '2022.3.22f1', '2022.3.6f1', '2019.4.31f1']);
  });

  test('editor binary validation rejects relative paths, directories, and non-Unity files', () => {
    const dir = path.join(root, 'Editor');
    fs.mkdirSync(dir, { recursive: true });
    expect(isUsableEditorBinary('')).toBe(false);
    expect(isUsableEditorBinary('Unity.exe')).toBe(false);
    expect(isUsableEditorBinary(dir)).toBe(false);
    const notUnity = path.join(dir, 'notes.txt');
    fs.writeFileSync(notUnity, 'x');
    if (process.platform === 'win32') expect(isUsableEditorBinary(notUnity)).toBe(false);
    const unity = path.join(dir, 'Unity.exe');
    fs.writeFileSync(unity, 'x');
    expect(isUsableEditorBinary(unity)).toBe(true);
  });
});
