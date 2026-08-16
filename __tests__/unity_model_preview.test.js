'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildResolvedMaterials,
  buildVrcComponentsFromCache,
  listCachedFiles,
  isPreviewCacheFresh,
  PREVIEW_CACHE_VERSION,
  PREVIEW_MATERIALS_JSON,
  getPreviewCacheDir,
  summarizeVrcComponents,
  copyPreviewAssetWithMetaSync,
  refreshCachedVrcComponentsSync,
  extractInWorker,
} = require('../lib/unity_model_preview');

const FLAG = '__preview_cache.flag';

describe('unity_model_preview materials', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ump-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('listCachedFiles classifies mesh/texture/mat', () => {
    fs.mkdirSync(path.join(tmpDir, 'M'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'mesh.fbx'), 'x');
    fs.writeFileSync(path.join(tmpDir, 'tex.png'), 'x');
    fs.writeFileSync(path.join(tmpDir, 'M', 'Brown.mat'), 'x');
    fs.writeFileSync(path.join(tmpDir, 'FX.controller'), 'x');
    fs.writeFileSync(path.join(tmpDir, 'Toggle.anim'), 'x');
    fs.writeFileSync(path.join(tmpDir, FLAG), '{}');
    fs.writeFileSync(path.join(tmpDir, PREVIEW_MATERIALS_JSON), '[]');

    const listed = listCachedFiles(tmpDir);
    expect(listed.meshes).toEqual([{ relPath: 'mesh.fbx', ext: '.fbx' }]);
    expect(listed.textures).toEqual([{ relPath: 'tex.png', ext: '.png' }]);
    expect(listed.materials).toEqual([{ relPath: 'M/Brown.mat', ext: '.mat' }]);
    expect(listed.animations).toEqual(expect.arrayContaining([
      { relPath: 'FX.controller', ext: '.controller' },
      { relPath: 'Toggle.anim', ext: '.anim' },
    ]));
  });

  test('copies the original Unity meta beside a cached preview asset', () => {
    const asset = path.join(tmpDir, 'asset');
    const meta = path.join(tmpDir, 'asset.meta');
    const destination = path.join(tmpDir, 'cached.fbx');
    const importer = 'fileFormatVersion: 2\nguid: abcdef\nModelImporter:\n  optimizeGameObjects: 1\n';
    fs.writeFileSync(asset, 'fbx');
    fs.writeFileSync(meta, importer);

    copyPreviewAssetWithMetaSync(asset, meta, destination);

    expect(fs.readFileSync(destination, 'utf8')).toBe('fbx');
    expect(fs.readFileSync(`${destination}.meta`, 'utf8')).toBe(importer);
  });

  test('buildResolvedMaterials parses .mat and resolves guids', () => {
    fs.mkdirSync(path.join(tmpDir, 'M'), { recursive: true });
    const matYaml = `%YAML 1.1
Material:
  m_Name: Brown
  m_SavedProperties:
    m_TexEnvs:
    - _MainTex:
        m_Texture: {fileID: 2800000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    m_Floats:
    - _OutlineWidth: 0.05
    m_Colors:
    - _Color: {r: 1, g: 0, b: 0, a: 1}
    - _OutlineColor: {r: 0, g: 0, b: 0, a: 1}
    - _MainTexHSVG: {r: 0, g: 1, b: 1, a: 1}
`;
    fs.writeFileSync(path.join(tmpDir, 'M', 'Brown.mat'), matYaml);
    const guidMap = { aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: 'T/Brown.png' };
    const mats = buildResolvedMaterials(tmpDir, guidMap, [{ relPath: 'M/Brown.mat' }]);
    expect(mats).toHaveLength(1);
    expect(mats[0].name).toBe('Brown');
    expect(mats[0].mainTexRelPath).toBe('T/Brown.png');
    expect(mats[0].shaderFamily).toBe('liltoon');
    expect(mats[0].color[0]).toBe(1);
  });

  test('buildVrcComponentsFromCache resolves asset GUIDs from a Map', () => {
    const assetDir = path.join(tmpDir, 'Expressions');
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, 'Menu.asset'), `%YAML 1.1
--- !u!114 &11400000
MonoBehaviour:
  m_Script: {fileID: -340790334, guid: 67cc4cb7839cd3741b63733d5adf0442, type: 3}
  m_Name: Menu
  Parameters: {fileID: 0}
  controls: []
`);
    const expectedGuid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const rows = buildVrcComponentsFromCache(tmpDir, [], new Map([
      [expectedGuid, 'Expressions/Menu.asset'],
    ]));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'expressionMenu', assetGuid: expectedGuid }),
    ]));
  });

  test('isPreviewCacheFresh requires matching cacheVersion', () => {
    const pkg = path.join(tmpDir, 'pkg.unitypackage');
    fs.writeFileSync(pkg, 'fake');
    const cacheDir = path.join(tmpDir, 'cache');
    fs.mkdirSync(cacheDir);
    const stat = fs.statSync(pkg);

    fs.writeFileSync(
      path.join(cacheDir, FLAG),
      JSON.stringify({ sourceMtimeMs: stat.mtimeMs, sourceSize: stat.size, cacheVersion: 1 })
    );
    expect(isPreviewCacheFresh(cacheDir, pkg)).toBe(false);

    fs.writeFileSync(
      path.join(cacheDir, FLAG),
      JSON.stringify({
        sourceMtimeMs: stat.mtimeMs,
        sourceSize: stat.size,
        cacheVersion: PREVIEW_CACHE_VERSION,
      })
    );
    expect(isPreviewCacheFresh(cacheDir, pkg)).toBe(true);
  });

  test('preview cache key distinguishes same-named packages in different folders', () => {
    const a = getPreviewCacheDir(tmpDir, path.join(tmpDir, 'a', 'model.unitypackage'));
    const b = getPreviewCacheDir(tmpDir, path.join(tmpDir, 'b', 'model.unitypackage'));
    expect(a).not.toBe(b);
    expect(path.basename(a)).toMatch(/^model\.unitypackage-[0-9a-f]{12}$/);
  });

  test('VRC summary separates selected-prefab counts from shared Animator assets', () => {
    const summary = summarizeVrcComponents([
      { type: 'physBone', prefabRelPath: 'A/Avatar.prefab' },
      { type: 'physBoneCollider', prefabRelPath: 'A/Avatar.prefab' },
      { type: 'physBone', prefabRelPath: 'B/Avatar.prefab' },
      { type: 'animatorController', assetRelPath: 'FX.controller' },
      { type: 'animationClip', assetRelPath: 'Toggle.anim' },
    ]);
    expect(summary.total).toBe(5);
    expect(summary.counts).toMatchObject({ physBone: 2, animatorController: 1, animationClip: 1 });
    expect(summary.unscopedCounts).toEqual({ animatorController: 1, animationClip: 1 });
    expect(summary.byPrefab['A/Avatar.prefab']).toEqual({ physBone: 1, physBoneCollider: 1 });
  });

  test('refreshes legacy VRC cache with transform curve schema without re-extracting', () => {
    fs.writeFileSync(path.join(tmpDir, '__preview_vrc_components.json'), JSON.stringify([
      { type: 'animationClip', name: 'Legacy', floatCurves: [] },
    ]));
    fs.writeFileSync(path.join(tmpDir, 'Move.anim'), `%YAML 1.1
--- !u!74 &7400000
AnimationClip:
  m_Name: Move
  m_RotationCurves: []
  m_EulerCurves: []
  m_PositionCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: {x: 0, y: 1, z: 2}
        inSlope: {x: 0, y: 0, z: 0}
        outSlope: {x: 0, y: 0, z: 0}
    path: Armature/Hips
  m_ScaleCurves: []
  m_FloatCurves: []
  m_SampleRate: 60
  m_AnimationClipSettings:
    m_StartTime: 0
    m_StopTime: 0
    m_LoopTime: 0
`);

    expect(refreshCachedVrcComponentsSync(tmpDir)).toMatchObject({ ok: true, refreshed: true });
    const refreshed = JSON.parse(fs.readFileSync(path.join(tmpDir, '__preview_vrc_components.json'), 'utf8'));
    expect(refreshed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'animationClip', name: 'Move', curveSchemaVersion: 4,
        positionCurves: [expect.objectContaining({ path: 'Armature/Hips' })],
      }),
    ]));
  });

  test('a worker that exits without posting a result still settles the extract', async () => {
    // Exiting cleanly with no message used to leave the promise pending forever,
    // freezing the preview on "読込中" because the timeout was already cleared.
    const stubWorker = path.join(tmpDir, 'silent_worker.js');
    fs.writeFileSync(stubWorker, "'use strict';\n");
    const result = await extractInWorker(path.join(tmpDir, 'x.unitypackage'), tmpDir, stubWorker);
    expect(result).toEqual({ error: 'worker_exit_without_result_0' });
  });

  test('a worker that crashes settles with the worker error', async () => {
    const stubWorker = path.join(tmpDir, 'crashing_worker.js');
    fs.writeFileSync(stubWorker, "throw new Error('worker_boom');\n");
    const result = await extractInWorker(path.join(tmpDir, 'x.unitypackage'), tmpDir, stubWorker);
    expect(result.error).toContain('worker_boom');
  });
});
