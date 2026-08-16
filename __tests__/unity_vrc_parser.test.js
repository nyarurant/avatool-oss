'use strict';

const {
  VRC_SCRIPT_GUIDS,
  VRC_SCRIPT_FILE_IDS,
  parseVrcComponents,
  collectVrcComponents,
  parseVrcExpressionAsset,
} = require('../lib/unity_vrc_parser');

function component(fileId, scriptFileId, guid, body) {
  return `--- !u!114 &${fileId}\nMonoBehaviour:\n  m_GameObject: {fileID: 42}\n  m_Enabled: 1\n  m_Script: {fileID: ${scriptFileId}, guid: ${guid}, type: 3}\n${body}\n`;
}

describe('unity_vrc_parser', () => {
  test('parses Avatar Descriptor expressions, visemes, eye look, and playable layers', () => {
    const yaml = component(100, VRC_SCRIPT_FILE_IDS.avatarDescriptor, VRC_SCRIPT_GUIDS.avatar, `  ViewPosition: {x: 0, y: 1.5, z: 0.1}
  lipSync: 3
  lipSyncJawBone: {fileID: 0}
  lipSyncJawClosed: {x: 0, y: 0, z: 0, w: 1}
  lipSyncJawOpen: {x: 0.1, y: 0, z: 0, w: 0.99}
  VisemeSkinnedMesh: {fileID: 777}
  MouthOpenBlendShapeName: JawOpen
  VisemeBlendShapes:
  - vrc.v_sil
  - vrc.v_pp
  customExpressions: 1
  expressionsMenu: {fileID: 11400000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 2}
  expressionParameters: {fileID: 11400000, guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, type: 2}
  enableEyeLook: 1
  customEyeLookSettings:
    eyeMovement:
      confidence: 0.8
      excitement: 0.6
    leftEye: {fileID: 123}
    rightEye: {fileID: 124}
    eyesLookingStraight:
      linked: 1
      left: {x: 0, y: 0, z: 0, w: 1}
      right: {x: 0, y: 0, z: 0, w: 1}
    eyesLookingUp:
      linked: 1
      left: {x: -0.1, y: 0, z: 0, w: 0.99}
      right: {x: -0.1, y: 0, z: 0, w: 0.99}
    eyelidType: 2
    eyelidsSkinnedMesh: {fileID: 888}
    eyelidsBlendshapes: 120000001100000010000000
  customizeAnimationLayers: 1
  baseAnimationLayers:
  - isEnabled: 1
    type: 5
    animatorController: {fileID: 9100000, guid: cccccccccccccccccccccccccccccccc, type: 2}
    mask: {fileID: 0}
    isDefault: 0
  specialAnimationLayers:
  - isEnabled: 0
    type: 6
    animatorController: {fileID: 0}
    mask: {fileID: 0}
    isDefault: 1`);
    const [descriptor] = parseVrcComponents(yaml, { relPath: 'Avatar.prefab' });
    expect(descriptor).toMatchObject({
      type: 'avatarDescriptor',
      componentFileId: '100',
      gameObjectFileId: '42',
      prefabRelPath: 'Avatar.prefab',
      viewPosition: { x: 0, y: 1.5, z: 0.1 },
      lipSync: 3,
      visemeSkinnedMeshFileId: '777',
      mouthOpenBlendShapeName: 'JawOpen',
      visemeBlendShapes: ['vrc.v_sil', 'vrc.v_pp'],
      customExpressions: true,
      enableEyeLook: true,
      lipSyncJawOpen: { x: 0.1, y: 0, z: 0, w: 0.99 },
      customEyeLook: {
        confidence: 0.8,
        excitement: 0.6,
        leftEyeFileId: '123',
        rightEyeFileId: '124',
        eyelidType: 2,
        eyelidsBlendshapes: [18, 17, 16],
      },
    });
    expect(descriptor.expressionsMenu.guid).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(descriptor.baseAnimationLayers[0]).toMatchObject({ type: 5, enabled: true, isDefault: false });
    expect(descriptor.specialAnimationLayers[0]).toMatchObject({ type: 6, enabled: false, isDefault: true });
  });

  test('parses PhysBone simulation parameters and collider shapes', () => {
    const yaml = component(200, VRC_SCRIPT_FILE_IDS.physBone, VRC_SCRIPT_GUIDS.physBone, `  integrationType: 1
  rootTransform: {fileID: 123}
  ignoreTransforms:
  - {fileID: 321}
  colliders:
  - {fileID: 201}
  endpointPosition: {x: 0, y: 0.2, z: 0}
  pull: 0.3
  pullCurve:
    serializedVersion: 2
    m_Curve:
    - serializedVersion: 3
      time: 0
      value: 0.5
  spring: 0.4
  stiffness: 0.6
  gravity: -0.2
  radius: 0.05
  limitType: 1
  maxAngleX: 25
  allowCollision: 1
  allowGrabbing: 1
  allowPosing: 0
  parameter: Hair`) + component(201, VRC_SCRIPT_FILE_IDS.physBoneCollider, VRC_SCRIPT_GUIDS.physBone, `  rootTransform: {fileID: 321}
  shapeType: 1
  insideBounds: 0
  radius: 0.08
  height: 0.4
  position: {x: 0, y: 0.1, z: 0}
  rotation: {x: 0, y: 0, z: 0, w: 1}`);
    const rows = parseVrcComponents(yaml);
    expect(rows[0]).toMatchObject({
      type: 'physBone',
      rootTransformFileId: '123',
      ignoreTransformFileIds: ['321'],
      colliderComponentFileIds: ['201'],
      pull: 0.3,
      spring: 0.4,
      allowPosing: false,
      parameter: 'Hair',
    });
    expect(rows[0].curves.pull).toEqual([{ time: 0, value: 0.5 }]);
    expect(rows[1]).toMatchObject({ type: 'physBoneCollider', rootTransformFileId: '321', shapeType: 1, radius: 0.08, height: 0.4 });
  });

  test('distinguishes Contact Sender and Receiver', () => {
    const yaml = component(300, VRC_SCRIPT_FILE_IDS.contactSender, VRC_SCRIPT_GUIDS.contact, `  shapeType: 0
  radius: 0.5
  size: {x: 0.1, y: 0.2, z: 0.3}
  collisionTags:
  - Head
  localOnly: 0`) + component(301, VRC_SCRIPT_FILE_IDS.contactReceiver, VRC_SCRIPT_GUIDS.contact, `  shapeType: 2
  radius: 0.2
  collisionTags:
  - Hand
  allowSelf: 0
  allowOthers: 1
  receiverType: 2
  parameter: Touch
  minVelocity: 0.05`);
    const rows = parseVrcComponents(yaml);
    expect(rows[0]).toMatchObject({ type: 'contactSender', size: { x: 0.1, y: 0.2, z: 0.3 }, collisionTags: ['Head'], allowSelf: true, allowOthers: true });
    expect(rows[1]).toMatchObject({ type: 'contactReceiver', collisionTags: ['Hand'], allowOthers: true, receiverType: 2, parameter: 'Touch', minVelocity: 0.05 });
  });

  test('resolves stripped transforms through a nested prefab source', () => {
    const source = `--- !u!1 &10
GameObject:
  m_Name: SourceArm
--- !u!4 &900
Transform:
  m_GameObject: {fileID: 10}
  m_Father: {fileID: 0}
`;
    const variant = `--- !u!4 &55 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 900, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
` + component(450, 575728033, VRC_SCRIPT_GUIDS.constraint, `  TargetTransform: {fileID: 55}
  Sources:
    source0:
      SourceTransform: {fileID: 55}
      Weight: 1`);
    const rows = collectVrcComponents([
      { relPath: 'Source.prefab', text: source },
      { relPath: 'Variant.prefab', text: variant },
    ], { aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: 'Source.prefab' });
    const row = rows.find((value) => value.prefabRelPath === 'Variant.prefab');
    expect(row).toMatchObject({
      targetTransformPath: 'SourceArm',
      sources: [{ transformPath: 'SourceArm', weight: 1 }],
    });
  });

  test('classifies constraints by serialized SDK fields and tolerates bad files', () => {
    const hierarchy = `--- !u!1 &42
GameObject:
  m_Name: Constrained
--- !u!4 &55
Transform:
  m_GameObject: {fileID: 42}
  m_Father: {fileID: 0}
--- !u!1 &43
GameObject:
  m_Name: Source
--- !u!4 &56
Transform:
  m_GameObject: {fileID: 43}
  m_Father: {fileID: 0}
`;
    const parent = hierarchy + component(400, 575728033, VRC_SCRIPT_GUIDS.constraint, `  IsActive: 1
  GlobalWeight: 0.75
  TargetTransform: {fileID: 55}
  Sources:
    source0:
      SourceTransform: {fileID: 56}
      Weight: 0.8
      ParentPositionOffset: {x: 1, y: 0, z: 0}
      ParentRotationOffset: {x: 0, y: 15, z: 0}
  PositionAtRest: {x: 1, y: 2, z: 3}
  RotationAtRest: {x: 4, y: 5, z: 6}
  AffectsPositionZ: 0`);
    const position = component(401, 1116338486, VRC_SCRIPT_GUIDS.constraint, `  PositionAtRest: {x: 0, y: 0, z: 0}
  PositionOffset: {x: 1, y: 0, z: 0}`);
    const rows = collectVrcComponents([
      { relPath: 'constraints.prefab', text: parent + position },
      { relPath: 'broken.prefab', get text() { throw new Error('bad'); } },
    ]);
    expect(rows.map((row) => row.type)).toEqual(['parentConstraint', 'positionConstraint']);
    expect(rows[0]).toMatchObject({
      globalWeight: 0.75,
      targetTransformFileId: '55',
      targetTransformPath: 'Constrained',
      affectsPositionZ: false,
      prefabRelPath: 'constraints.prefab',
      sources: [{
        transformFileId: '56',
        transformPath: 'Source',
        weight: 0.8,
        parentPositionOffset: { x: 1, y: 0, z: 0 },
        parentRotationOffset: { x: 0, y: 15, z: 0 },
      }],
    });
  });

  test('resolves component GameObjects to stable prefab hierarchy paths', () => {
    const hierarchy = `--- !u!1 &10
GameObject:
  m_Name: Avatar
--- !u!4 &11
Transform:
  m_GameObject: {fileID: 10}
  m_Father: {fileID: 0}
--- !u!1 &20
GameObject:
  m_Name: Hair
--- !u!4 &21
Transform:
  m_GameObject: {fileID: 20}
  m_Father: {fileID: 11}
`;
    const yaml = hierarchy + component(500, VRC_SCRIPT_FILE_IDS.physBone, VRC_SCRIPT_GUIDS.physBone, '  pull: 0.2').replace('m_GameObject: {fileID: 42}', 'm_GameObject: {fileID: 20}');
    const [row] = parseVrcComponents(yaml);
    expect(row).toMatchObject({ gameObjectName: 'Hair', objectPath: 'Avatar/Hair', rootTransformPath: 'Avatar/Hair' });
  });

  test('parses expression parameter and menu assets', () => {
    const parameters = component(11400000, VRC_SCRIPT_FILE_IDS.expressionParameters, VRC_SCRIPT_GUIDS.avatar, `  m_Name: Parameters
  parameters:
  - name: Outfit
    valueType: 2
    saved: 1
    defaultValue: 1
    networkSynced: 1`);
    const menu = component(11400000, VRC_SCRIPT_FILE_IDS.expressionMenu, VRC_SCRIPT_GUIDS.avatar, `  m_Name: Menu
  Parameters: {fileID: 11400000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 2}
  controls:
  - name: Outfit
    icon: {fileID: 2800000, guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, type: 3}
    type: 101
    parameter:
      name: Outfit
    value: 1
    style: 0
    subMenu: {fileID: 0}
    subParameters: []
    labels: []`);
    expect(parseVrcExpressionAsset(parameters, { guid: 'p', relPath: 'p.asset' })).toMatchObject({
      type: 'expressionParameters',
      name: 'Parameters',
      parameters: [{ name: 'Outfit', valueType: 2, saved: true, defaultValue: 1, networkSynced: true }],
    });
    expect(parseVrcExpressionAsset(menu, { guid: 'm', relPath: 'm.asset' })).toMatchObject({
      type: 'expressionMenu',
      controls: [{ name: 'Outfit', controlType: 101, parameter: 'Outfit', value: 1 }],
    });
  });

  test('decodes expression names only when they are double-quoted YAML scalars', () => {
    const parameters = component(
      11400000,
      VRC_SCRIPT_FILE_IDS.expressionParameters,
      VRC_SCRIPT_GUIDS.avatar,
      [
        '  m_Name: "\\u3007\\u3007"',
        '  parameters:',
        '  - name: "Smile\\\"Wide"',
        '    valueType: 2',
        '    saved: 1',
        '    defaultValue: 0',
        '    networkSynced: 1',
        "  - name: 'literal\\nname'",
        '    valueType: 2',
        '    saved: 0',
        '    defaultValue: 0',
        '    networkSynced: 1',
      ].join('\n')
    );
    expect(parseVrcExpressionAsset(parameters)).toMatchObject({
      name: '〇〇',
      parameters: [
        expect.objectContaining({ name: 'Smile"Wide' }),
        expect.objectContaining({ name: 'literal\\nname' }),
      ],
    });
  });

  test('parses Radial/Axis Puppet sub-parameters and labels', () => {
    const menu = component(11400000, VRC_SCRIPT_FILE_IDS.expressionMenu, VRC_SCRIPT_GUIDS.avatar, `  m_Name: Puppet Menu
  controls:
  - name: Face
    icon: {fileID: 0}
    type: 202
    parameter:
      name:
    value: 1
    style: 0
    subMenu: {fileID: 0}
    subParameters:
    - name: FaceUp
    - name: FaceRight
    - name: FaceDown
    - name: FaceLeft
    labels:
    - name: Up
      icon: {fileID: 2800000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}`);
    expect(parseVrcExpressionAsset(menu)).toMatchObject({
      controls: [{
        name: 'Face',
        controlType: 202,
        subParameters: ['FaceUp', 'FaceRight', 'FaceDown', 'FaceLeft'],
        labels: [{ name: 'Up', icon: { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } }],
      }],
    });
  });
});
