'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
  collectRequiredModelGuids,
  inspectModelMapCoverage,
  patchVrcComponentModelPaths,
  createUnityFbxObjectMapper,
} = require('../lib/unity_fbx_object_mapper');

const FBX_GUID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const PREFAB = `--- !u!1 &10 stripped
GameObject:
  m_CorrespondingSourceObject: {fileID: 1001, guid: ${FBX_GUID}, type: 3}
--- !u!4 &20 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 2001, guid: ${FBX_GUID}, type: 3}
`;

describe('unity_fbx_object_mapper', () => {
  test('collects only FBX GUIDs referenced by PhysBone objects', () => {
    const rows = [{ type: 'physBone', gameObjectFileId: '10', rootTransformFileId: '20' }];
    expect(collectRequiredModelGuids(rows, PREFAB, {
      [FBX_GUID]: 'Avatar/Model.fbx',
      bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: 'Avatar/Base.prefab',
    })).toEqual([FBX_GUID]);
  });

  test('patches stripped GameObject and Transform paths from a cached Unity map', () => {
    const rows = [{
      type: 'physBone',
      gameObjectFileId: '10',
      objectPath: null,
      rootTransformFileId: '20',
      rootTransformPath: null,
      ignoreTransformFileIds: [],
    }];
    const [row] = patchVrcComponentModelPaths(rows, PREFAB, {
      [FBX_GUID]: {
        gameObjects: { 1001: 'Avatar/Armature/Hair' },
        transforms: { 2001: 'Avatar/Armature/HairRoot' },
      },
    });
    expect(row).toMatchObject({
      gameObjectName: 'Hair',
      objectPath: 'Armature/Hair',
      rootTransformPath: 'Armature/HairRoot',
    });
  });

  test('uses a stripped component GameObject when Root Transform is empty', () => {
    const [row] = patchVrcComponentModelPaths([{
      type: 'physBoneCollider',
      gameObjectFileId: '10',
      rootTransformFileId: '0',
      rootTransformPath: null,
    }], PREFAB, {
      [FBX_GUID]: { gameObjects: { 1001: 'Avatar/Armature/Chest' }, transforms: {} },
    });
    expect(row.rootTransformPath).toBe('Armature/Chest');
  });

  test('reports unresolved FBX local references instead of accepting a partial map', () => {
    const rows = [{
      type: 'physBone',
      gameObjectFileId: '10',
      rootTransformFileId: '20',
    }];
    const coverage = inspectModelMapCoverage(rows, PREFAB, { [FBX_GUID]: 'Avatar/Model.fbx' }, {
      [FBX_GUID]: { gameObjects: { 1001: 'Avatar/Hair' }, transforms: {} },
    });
    expect(coverage).toMatchObject({ required: 2, resolved: 1 });
    expect(coverage.unresolved).toEqual([{
      guid: FBX_GUID,
      kind: 'transforms',
      fileId: '2001',
    }]);
  });

  test('imports with the original ModelImporter meta and validates complete coverage', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-map-test-'));
    try {
      const cacheDir = path.join(tmpDir, 'cache');
      const modelPath = path.join(cacheDir, 'Avatar', 'Model.fbx');
      const prefabPath = path.join(cacheDir, 'Avatar.prefab');
      const templatePath = path.join(tmpDir, 'AvatoolFbxObjectMapper.cs');
      fs.mkdirSync(path.dirname(modelPath), { recursive: true });
      fs.writeFileSync(modelPath, 'fbx');
      const originalMeta = `fileFormatVersion: 2\nguid: ${FBX_GUID}\nModelImporter:\n  optimizeGameObjects: 1\n`;
      fs.writeFileSync(`${modelPath}.meta`, originalMeta);
      fs.writeFileSync(prefabPath, PREFAB);
      fs.writeFileSync(templatePath, '// mapper');

      const spawn = jest.fn((_editor, args) => {
        const requestPath = args[args.indexOf('-avatoolFbxMapRequest') + 1];
        const projectPath = args[args.indexOf('-projectPath') + 1];
        const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
        const importedMeta = path.join(projectPath, `${request.models[0].assetPath}.meta`);
        expect(fs.readFileSync(importedMeta, 'utf8')).toBe(originalMeta);
        fs.writeFileSync(request.outputPath, JSON.stringify({
          models: [{
            guid: FBX_GUID,
            entries: [{
              gameObjectFileId: '1001',
              transformFileId: '2001',
              path: 'Avatar/Armature/Hair',
            }],
          }],
        }));
        const proc = new EventEmitter();
        proc.kill = jest.fn();
        setImmediate(() => proc.emit('close', 0));
        return proc;
      });
      const mapper = createUnityFbxObjectMapper({
        fs,
        path,
        os,
        spawn,
        resolveEditorPath: () => 'Unity.exe',
        createUnityProject: async (_editor, projectPath) => {
          fs.mkdirSync(projectPath, { recursive: true });
          return { ok: true };
        },
        templatePath,
      });

      const result = await mapper.ensureMaps({
        cacheDir,
        prefabRelPath: 'Avatar.prefab',
        rows: [{ type: 'physBone', gameObjectFileId: '10', rootTransformFileId: '20' }],
        guidMap: { [FBX_GUID]: 'Avatar/Model.fbx' },
      });

      expect(result.error).toBeUndefined();
      expect(result.coverage).toMatchObject({ required: 2, resolved: 2, unresolved: [] });
      expect(result.rows[0]).toMatchObject({ objectPath: 'Armature/Hair', rootTransformPath: 'Armature/Hair' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
