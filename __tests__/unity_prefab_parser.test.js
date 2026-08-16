'use strict';

const {
  parsePrefabMaterialBindings,
  resolvePreferredMaterialsForMesh,
  collectPrefabBindings,
  collectColorOptionsForMesh,
} = require('../lib/unity_prefab_parser');

const PREFAB = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Name: Hair
  m_Component:
  - component: {fileID: 200}
--- !u!137 &200
SkinnedMeshRenderer:
  m_GameObject: {fileID: 100}
  m_Materials:
  - {fileID: 2100000, guid: f34f45680f6d63248be53af549c58c2d, type: 2}
  m_Mesh: {fileID: -3178576508544696699, guid: 579ef464a6e000d468cd68f26732eebb, type: 3}
`;

describe('unity_prefab_parser', () => {
  const guidMap = {
    f34f45680f6d63248be53af549c58c2d: 'ANKA/M/Beige.mat',
    '579ef464a6e000d468cd68f26732eebb': 'ANKA/FBX/Hair.fbx',
  };

  test('parses SkinnedMeshRenderer materials and mesh from prefab', () => {
    const bindings = parsePrefabMaterialBindings(PREFAB, { relPath: 'ANKA/Hair.prefab', guidMap });
    expect(bindings).toHaveLength(1);
    expect(bindings[0].goName).toBe('Hair');
    expect(bindings[0].meshRelPath).toBe('ANKA/FBX/Hair.fbx');
    expect(bindings[0].materialRelPaths).toEqual(['ANKA/M/Beige.mat']);
    expect(bindings[0].materialNames).toEqual(['Beige']);
  });

  test('decodes double-quoted YAML escapes in prefab GameObject names', () => {
    const escapedNamePrefab = PREFAB.replace(
      'm_Name: Hair',
      'm_Name: "\\u3007\\u3007\\n\\\"Hair\\\""'
    );
    const [binding] = parsePrefabMaterialBindings(escapedNamePrefab, { guidMap });
    expect(binding.goName).toBe('〇〇\n"Hair"');
  });

  test('resolvePreferredMaterialsForMesh matches mesh path', () => {
    const bindings = parsePrefabMaterialBindings(PREFAB, { guidMap });
    const r = resolvePreferredMaterialsForMesh(bindings, 'ANKA/FBX/Hair.fbx');
    expect(r.preferredName).toBe('Beige');
    expect(r.goName).toBe('Hair');
    expect(r.source).toBe('prefab');
  });

  test('collectPrefabBindings aggregates files', () => {
    const out = collectPrefabBindings([{ relPath: 'x.prefab', text: PREFAB }], guidMap);
    expect(out).toHaveLength(1);
    expect(out[0].materialNames[0]).toBe('Beige');
  });

  test('resolves stripped SkinnedMeshRenderer (Nested Prefab / Prefab Variant) via PrefabInstance modifications', () => {
    // Mirrors the real-world shape of a Prefab Variant body: the renderer document is
    // "stripped" (no inline m_Materials/m_Mesh, only a pointer to the source FBX-derived
    // object), and the actual per-slot material overrides live in the enclosing
    // !u!1001 PrefabInstance's m_Modification.m_Modifications diff list.
    const strippedPrefab = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!137 &500 stripped
SkinnedMeshRenderer:
  m_CorrespondingSourceObject: {fileID: 900, guid: bbd1ddc987dc3d646aa8d77be2cad481,
    type: 3}
  m_PrefabInstance: {fileID: 600}
  m_PrefabAsset: {fileID: 0}
--- !u!1001 &600
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications:
    - target: {fileID: 900, guid: bbd1ddc987dc3d646aa8d77be2cad481,
        type: 3}
      propertyPath: m_Materials.Array.data[0]
      value:
      objectReference: {fileID: 2100000, guid: 10c51391a4972fe4fa628e9001468168, type: 2}
    - target: {fileID: 900, guid: bbd1ddc987dc3d646aa8d77be2cad481,
        type: 3}
      propertyPath: m_Materials.Array.data[1]
      value:
      objectReference: {fileID: 2100000, guid: e6a82c4f76055e646bbb09fc01d7d17f, type: 2}
    m_RemovedComponents: []
`;
    const strippedGuidMap = {
      bbd1ddc987dc3d646aa8d77be2cad481: 'IKUSIA/rurune/FBX/rurune.fbx',
      '10c51391a4972fe4fa628e9001468168': 'IKUSIA/rurune/Materials/body.mat',
      e6a82c4f76055e646bbb09fc01d7d17f: 'IKUSIA/rurune/Materials/body_option.mat',
    };
    const bindings = parsePrefabMaterialBindings(strippedPrefab, {
      relPath: 'IKUSIA/rurune/Prefab/rurune.prefab',
      guidMap: strippedGuidMap,
    });
    expect(bindings).toHaveLength(1);
    expect(bindings[0].meshRelPath).toBe('IKUSIA/rurune/FBX/rurune.fbx');
    expect(bindings[0].materialNames).toEqual(['body', 'body_option']);
  });

  test('stripped renderer with a resolvable mesh but no material override still yields a mesh-only binding', () => {
    const strippedPrefabNoMatOverride = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!137 &500 stripped
SkinnedMeshRenderer:
  m_CorrespondingSourceObject: {fileID: 900, guid: bbd1ddc987dc3d646aa8d77be2cad481,
    type: 3}
  m_PrefabInstance: {fileID: 600}
  m_PrefabAsset: {fileID: 0}
--- !u!1001 &600
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications:
    - target: {fileID: 900, guid: bbd1ddc987dc3d646aa8d77be2cad481,
        type: 3}
      propertyPath: m_LocalPosition.x
      value: 0
      objectReference: {fileID: 0}
    m_RemovedComponents: []
`;
    const guidMap2 = { bbd1ddc987dc3d646aa8d77be2cad481: 'IKUSIA/rurune/FBX/rurune.fbx' };
    const bindings = parsePrefabMaterialBindings(strippedPrefabNoMatOverride, {
      relPath: 'IKUSIA/rurune/Prefab/rurune.prefab',
      guidMap: guidMap2,
    });
    expect(bindings).toHaveLength(1);
    expect(bindings[0].meshRelPath).toBe('IKUSIA/rurune/FBX/rurune.fbx');
    expect(bindings[0].materialNames).toEqual([]);
  });

  test('keeps an FBX PrefabInstance as a mesh-only binding when Unity emits no stripped renderer document', () => {
    const implicitFbxPrefab = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &600
PrefabInstance:
  m_Modification:
    m_Modifications: []
  m_SourcePrefab: {fileID: 100100000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
`;
    const bindings = parsePrefabMaterialBindings(implicitFbxPrefab, {
      relPath: 'Komane/Models/Prefabs/Komane_Cloth.prefab',
      guidMap: { aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: 'Komane/Models/FBX/Komane_Cloth.fbx' },
    });
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      meshRelPath: 'Komane/Models/FBX/Komane_Cloth.fbx',
      goName: 'Komane_Cloth',
      syntheticSourcePrefab: true,
    });
  });

  test('inherits bindings from multiple nested Prefabs for an assembled avatar Prefab', () => {
    const sourceBodyGuid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const sourceClothGuid = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const bodyFbxGuid = 'cccccccccccccccccccccccccccccccc';
    const clothFbxGuid = 'dddddddddddddddddddddddddddddddd';
    const nested = (guid) => `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &1
PrefabInstance:
  m_SourcePrefab: {fileID: 100100000, guid: ${guid}, type: 3}
`;
    const assembled = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &1
PrefabInstance:
  m_SourcePrefab: {fileID: 100100000, guid: ${sourceBodyGuid}, type: 3}
--- !u!1001 &2
PrefabInstance:
  m_SourcePrefab: {fileID: 100100000, guid: ${sourceClothGuid}, type: 3}
`;
    const files = [
      { relPath: 'Komane/Models/Prefabs/Komane.prefab', text: assembled },
      { relPath: 'Komane/Models/Prefabs/Komane_Sotai.prefab', text: nested(bodyFbxGuid) },
      { relPath: 'Komane/Models/Prefabs/Komane_Cloth.prefab', text: nested(clothFbxGuid) },
    ];
    const bindings = collectPrefabBindings(files, {
      [sourceBodyGuid]: 'Komane/Models/Prefabs/Komane_Sotai.prefab',
      [sourceClothGuid]: 'Komane/Models/Prefabs/Komane_Cloth.prefab',
      [bodyFbxGuid]: 'Komane/Models/FBX/Komane_Sotai.fbx',
      [clothFbxGuid]: 'Komane/Models/FBX/Komane_Cloth.fbx',
    });
    const assembledBindings = bindings.filter((binding) => binding.prefabRelPath === 'Komane/Models/Prefabs/Komane.prefab');
    expect(assembledBindings.map((binding) => binding.meshRelPath).sort()).toEqual([
      'Komane/Models/FBX/Komane_Cloth.fbx',
      'Komane/Models/FBX/Komane_Sotai.fbx',
    ]);
    expect(assembledBindings.every((binding) => binding.inheritedPrefabBinding)).toBe(true);
  });

  test('collectColorOptionsForMesh gathers colors from multiple prefabs on same mesh', () => {
    const prefabBrown = PREFAB
      .replace(/Beige/g, 'Brown')
      .replace(/f34f45680f6d63248be53af549c58c2d/g, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const guidMap2 = {
      ...guidMap,
      aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: 'ANKA/M/Brown.mat',
    };
    const bindings = collectPrefabBindings(
      [
        { relPath: 'ANKA/Hair_Beige.prefab', text: PREFAB },
        { relPath: 'ANKA/Hair_Brown.prefab', text: prefabBrown },
      ],
      guidMap2
    );
    // Fix brown material name resolution
    bindings.forEach((b) => {
      if (b.prefabRelPath && b.prefabRelPath.includes('Brown')) {
        b.materialNames = ['Brown'];
        b.materialRelPaths = ['ANKA/M/Brown.mat'];
      }
    });
    const materials = [
      { name: 'Beige', relPath: 'ANKA/M/Beige.mat', mainTexRelPath: 'T/Beige.png' },
      { name: 'Brown', relPath: 'ANKA/M/Brown.mat', mainTexRelPath: 'T/Brown.png' },
      { name: 'Unused', relPath: 'ANKA/M/Unused.mat', mainTexRelPath: 'T/x.png' },
    ];
    const colors = collectColorOptionsForMesh(bindings, 'ANKA/FBX/Hair.fbx', materials);
    expect(colors.mode).toBe('multi_prefab');
    expect(colors.options.map((o) => o.materialName).sort()).toEqual(['Beige', 'Brown']);
    expect(colors.options.find((o) => o.materialName === 'Beige')?.prefabLabel).toMatch(/Beige/i);
  });
});
