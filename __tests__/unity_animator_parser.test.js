'use strict';

const {
  parseAnimatorController,
  parseAnimationClip,
  collectAnimatorAssets,
} = require('../lib/unity_animator_parser');

const SDK_GUID = '67cc4cb7839cd3741b63733d5adf0442';

describe('unity_animator_parser', () => {
  test('parses controller parameters, layers, graph, transitions, and Parameter Driver', () => {
    const yaml = `%YAML 1.1
--- !u!1107 &10
AnimatorStateMachine:
  m_Name: Outfit
  m_ChildStates:
  - serializedVersion: 1
    m_State: {fileID: 20}
  m_ChildStateMachines: []
  m_AnyStateTransitions:
  - {fileID: 30}
  m_EntryTransitions: []
  m_StateMachineBehaviours: []
  m_DefaultState: {fileID: 20}
--- !u!1102 &20
AnimatorState:
  m_Name: Outfit ON
  m_Speed: 1
  m_Transitions:
  - {fileID: 30}
  m_StateMachineBehaviours:
  - {fileID: 40}
  - {fileID: 41}
  m_WriteDefaultValues: 0
  m_TimeParameterActive: 1
  m_Motion: {fileID: 7400000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 2}
  m_Tag:
  m_TimeParameter: OutfitTime
--- !u!1101 &30
AnimatorStateTransition:
  m_Name:
  m_Conditions:
  - m_ConditionMode: 1
    m_ConditionEvent: Outfit
    m_EventTreshold: 0
  m_DstStateMachine: {fileID: 0}
  m_DstState: {fileID: 20}
  m_IsExit: 0
  m_TransitionDuration: 0.1
  m_TransitionOffset: 0
  m_ExitTime: 0
  m_HasExitTime: 0
  m_HasFixedDuration: 1
--- !u!114 &40
MonoBehaviour:
  m_Script: {fileID: -706344726, guid: ${SDK_GUID}, type: 3}
  parameters:
  - type: 0
    name: Outfit
    source:
    value: 1
    valueMin: 0
    valueMax: 0
    chance: 0
    preventRepeats: 1
    convertRange: 0
    sourceMin: 0
    sourceMax: 0
    destMin: 0
    destMax: 0
  localOnly: 1
  debugString: driver entered
--- !u!114 &41
MonoBehaviour:
  m_Script: {fileID: -646210727, guid: ${SDK_GUID}, type: 3}
  trackingHead: 0
  trackingLeftHand: 0
  trackingRightHand: 0
  trackingHip: 0
  trackingLeftFoot: 0
  trackingRightFoot: 0
  trackingLeftFingers: 0
  trackingRightFingers: 0
  trackingEyes: 2
  trackingMouth: 1
  debugString: animated eyes
--- !u!91 &9100000
AnimatorController:
  m_Name: FX
  m_AnimatorParameters:
  - m_Name: Outfit
    m_Type: 4
    m_DefaultFloat: 0
    m_DefaultInt: 0
    m_DefaultBool: 1
    m_Controller: {fileID: 9100000}
  m_AnimatorLayers:
  - serializedVersion: 5
    m_Name: Outfit
    m_StateMachine: {fileID: 10}
    m_Mask: {fileID: 0}
    m_BlendingMode: 0
    m_SyncedLayerIndex: -1
    m_DefaultWeight: 1
    m_IKPass: 0
    m_SyncedLayerAffectsTiming: 0
`;
    const result = parseAnimatorController(yaml, { guid: 'controller-guid', relPath: 'FX.controller' });
    expect(result).toMatchObject({ type: 'animatorController', name: 'FX', assetRelPath: 'FX.controller' });
    expect(result.parameters).toEqual([expect.objectContaining({ name: 'Outfit', type: 4, defaultBool: true })]);
    expect(result.layers).toEqual([expect.objectContaining({ name: 'Outfit', stateMachineFileId: '10', defaultWeight: 1 })]);
    expect(result.states[0]).toMatchObject({ name: 'Outfit ON', writeDefaultValues: false, timeParameter: 'OutfitTime', timeParameterActive: true, transitionFileIds: ['30'], behaviourFileIds: ['40', '41'] });
    expect(result.stateMachines[0]).toMatchObject({ childStateFileIds: ['20'], anyStateTransitionFileIds: ['30'], defaultStateFileId: '20' });
    expect(result.transitions[0].conditions).toEqual([{ mode: 1, parameter: 'Outfit', threshold: 0 }]);
    expect(result.behaviours[0]).toMatchObject({ type: 'parameterDriver', localOnly: true, debugString: 'driver entered', parameters: [{ name: 'Outfit', changeType: 0, value: 1, preventRepeats: true }] });
    expect(result.behaviours[1]).toMatchObject({ type: 'trackingControl', debugString: 'animated eyes', tracking: { eyes: 2, mouth: 1 } });
  });

  test('parses the remaining VRC avatar State Behaviours', () => {
    const yaml = `%YAML 1.1
--- !u!114 &1
MonoBehaviour:
  m_Script: {fileID: 1852460640, guid: ${SDK_GUID}, type: 3}
  layer: 1
  goalWeight: 0.25
  blendDuration: 0.2
  outputParamHash: 123
--- !u!114 &2
MonoBehaviour:
  m_Script: {fileID: -1936262289, guid: ${SDK_GUID}, type: 3}
  playable: 1
  layer: 3
  goalWeight: 0.5
  blendDuration: 0.1
--- !u!114 &3
MonoBehaviour:
  m_Script: {fileID: -453519674, guid: ${SDK_GUID}, type: 3}
  disableLocomotion: 1
--- !u!114 &4
MonoBehaviour:
  m_Script: {fileID: 141706016, guid: ${SDK_GUID}, type: 3}
  enterPoseSpace: 1
  fixedDelay: 0
  delayTime: 0.5
--- !u!114 &5
MonoBehaviour:
  m_Script: {fileID: 1859411423, guid: ${SDK_GUID}, type: 3}
  SourcePath: Audio/Voice
  PlaybackOrder: 3
  ParameterName: AudioIndex
  Volume: {x: 0.5, y: 0.8}
  VolumeApplySettings: 0
  Pitch: {x: 0.9, y: 1.1}
  PitchApplySettings: 1
  Clips:
  - {fileID: 8300000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
  ClipsApplySettings: 1
  Loop: 1
  LoopApplySettings: 0
  DelayInSeconds: 0.2
  PlayOnEnter: 1
  StopOnEnter: 0
  PlayOnExit: 0
  StopOnExit: 1
--- !u!91 &9100000
AnimatorController:
  m_Name: Behaviours
  m_AnimatorParameters: []
  m_AnimatorLayers: []
`;
    const result = parseAnimatorController(yaml);
    expect(result.behaviours).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'playableLayerControl', layer: 1, goalWeight: 0.25, outputParamHash: 123 }),
      expect.objectContaining({ type: 'animatorLayerControl', playable: 1, layer: 3, goalWeight: 0.5 }),
      expect.objectContaining({ type: 'locomotionControl', disableLocomotion: true }),
      expect.objectContaining({ type: 'temporaryPoseSpace', enterPoseSpace: true, fixedDelay: false, delayTime: 0.5 }),
      expect.objectContaining({
        type: 'playAudio', sourcePath: 'Audio/Voice', playbackOrder: 3, parameterName: 'AudioIndex',
        volume: { x: 0.5, y: 0.8 }, pitch: { x: 0.9, y: 1.1 }, loop: true,
        clips: [{ fileId: '8300000', guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
      }),
    ]));
  });

  test('parses AnimationClip GameObject activation and blendshape-style float curves', () => {
    const yaml = `%YAML 1.1
--- !u!74 &7400000
AnimationClip:
  m_Name: Outfit_ON
  m_FloatCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: 0
        inSlope: Infinity
        outSlope: Infinity
      - serializedVersion: 3
        time: 0.2
        value: 1
        inSlope: Infinity
        outSlope: Infinity
    attribute: m_IsActive
    path: Outfit/Jacket
    classID: 1
    script: {fileID: 0}
  m_PPtrCurves: []
  m_SampleRate: 60
  m_AnimationClipSettings:
    m_StartTime: 0
    m_StopTime: 0.2
    m_LoopTime: 0
`;
    const result = parseAnimationClip(yaml, { guid: 'clip-guid', relPath: 'Outfit.anim' });
    expect(result).toMatchObject({ type: 'animationClip', name: 'Outfit_ON', sampleRate: 60, stopTime: 0.2 });
    expect(result.floatCurves).toEqual([expect.objectContaining({
      path: 'Outfit/Jacket',
      attribute: 'm_IsActive',
      classId: 1,
      keyframes: [
        { time: 0, value: 0, inSlope: Infinity, outSlope: Infinity },
        { time: 0.2, value: 1, inSlope: Infinity, outSlope: Infinity },
      ],
    })]);
  });

  test('parses AnimationClip float curves serialized with `- serializedVersion:` before `curve:` (AnimationClip serializedVersion 7 shape, seen on real exported avatars)', () => {
    const yaml = `%YAML 1.1
--- !u!74 &7400000
AnimationClip:
  m_Name: Sio_Sitting
  serializedVersion: 7
  m_FloatCurves:
  - serializedVersion: 2
    curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: -0.11977903
        inSlope: -0.013461783
        outSlope: 0
        tangentMode: 69
        weightedMode: 0
        inWeight: 0.33333334
        outWeight: 0.33333334
      m_PreInfinity: 2
      m_PostInfinity: 2
      m_RotationOrder: 4
    attribute: Chest Front-Back
    path:
    classID: 95
    script: {fileID: 0}
    flags: 16
  - serializedVersion: 2
    curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: 0.023645801
        inSlope: -0.014964043
        outSlope: 0
        tangentMode: 69
        weightedMode: 0
        inWeight: 0.33333334
        outWeight: 0.33333334
      m_PreInfinity: 2
      m_PostInfinity: 2
      m_RotationOrder: 4
    attribute: Chest Left-Right
    path:
    classID: 95
    script: {fileID: 0}
    flags: 16
  m_PPtrCurves: []
  m_SampleRate: 60
  m_AnimationClipSettings:
    m_StartTime: 0
    m_StopTime: 1
    m_LoopTime: 0
`;
    const result = parseAnimationClip(yaml, { guid: 'clip-guid', relPath: 'Sio_Sitting.anim' });
    expect(result.floatCurves).toHaveLength(2);
    expect(result.floatCurves).toEqual([
      expect.objectContaining({ path: '', attribute: 'Chest Front-Back', classId: 95 }),
      expect.objectContaining({ path: '', attribute: 'Chest Left-Right', classId: 95 }),
    ]);
    expect(result.hasHumanoidMuscles).toBe(true);
  });

  test('decodes double-quoted YAML escapes without treating single-quoted backslashes as escapes', () => {
    const escaped = parseAnimationClip([
      '--- !u!74 &7400000',
      'AnimationClip:',
      '  m_Name: "\\u3007\\u3007\\n\\\"quoted\\\""',
      '  m_FloatCurves: []',
      '  m_SampleRate: 60',
    ].join('\n'));
    expect(escaped.name).toBe('〇〇\n"quoted"');

    const singleQuoted = parseAnimationClip([
      '--- !u!74 &7400000',
      'AnimationClip:',
      "  m_Name: 'literal\\nname'",
      '  m_FloatCurves: []',
      '  m_SampleRate: 60',
    ].join('\n'));
    expect(singleQuoted.name).toBe('literal\\nname');
  });

  test('parses transform vector curves and humanoid muscle metadata', () => {
    const yaml = `%YAML 1.1
--- !u!74 &7400000
AnimationClip:
  m_Name: Walk
  m_RotationCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: {x: 0, y: 0, z: 0, w: 1}
        inSlope: {x: 0, y: 0, z: 0, w: 0}
        outSlope: {x: 0, y: 0, z: 0, w: 0}
      - serializedVersion: 3
        time: 1
        value: {x: 0, y: 0.5, z: 0, w: 0.866}
        inSlope: {x: 0, y: 0, z: 0, w: 0}
        outSlope: {x: 0, y: 0, z: 0, w: 0}
    path: Armature/Hips
  m_EulerCurves: []
  m_PositionCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: {x: 0, y: 1, z: 2}
        inSlope: {x: 0, y: 0, z: 0}
        outSlope: {x: 1, y: 0, z: 0}
      - serializedVersion: 3
        time: 1
        value: {x: 1, y: 1, z: 2}
        inSlope: {x: 1, y: 0, z: 0}
        outSlope: {x: 0, y: 0, z: 0}
    path: Armature/Hips
  m_ScaleCurves: []
  m_FloatCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: 0
        inSlope: 0
        outSlope: 0
      - serializedVersion: 3
        time: 1
        value: 1
        inSlope: 0
        outSlope: 0
    attribute: Head Turn Left-Right
    path:
    classID: 95
    script: {fileID: 0}
  m_SampleRate: 60
  m_AnimationClipSettings:
    m_StartTime: 0
    m_StopTime: 1
    m_LoopTime: 1
`;
    const result = parseAnimationClip(yaml, { guid: 'walk-guid', relPath: 'Walk.anim' });
    expect(result).toMatchObject({
      name: 'Walk', startTime: 0, stopTime: 1, loopTime: true,
      motionCurveCount: 3, hasHumanoidMuscles: true,
    });
    expect(result.rotationCurves[0]).toMatchObject({
      path: 'Armature/Hips',
      keyframes: expect.arrayContaining([expect.objectContaining({ value: { x: 0, y: 0, z: 0, w: 1 } })]),
    });
    expect(result.positionCurves[0].keyframes[1]).toMatchObject({
      time: 1,
      value: { x: 1, y: 1, z: 2 },
      inSlope: { x: 1, y: 0, z: 0 },
    });
    expect(result.floatCurves[0]).toMatchObject({ classId: 95, attribute: 'Head Turn Left-Right' });
  });

  test('parses realistic multi-entry Unity float curves including an empty-path humanoid muscle', () => {
    const yaml = `%YAML 1.1
--- !u!74 &7400000
AnimationClip:
  m_Name: RurunePose
  m_FloatCurves:
  - curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: 0.035461966
        inSlope: 0
        outSlope: 0
        tangentMode: 136
        weightedMode: 0
        inWeight: 0.33333334
        outWeight: 0.33333334
      m_PreInfinity: 2
      m_PostInfinity: 2
      m_RotationOrder: 4
    attribute: Chest Front-Back
    path:
    classID: 95
    script: {fileID: 0}
  - curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: 1
        inSlope: Infinity
        outSlope: Infinity
        tangentMode: 136
        weightedMode: 0
        inWeight: 0.33333334
        outWeight: 0.33333334
      m_PreInfinity: 2
      m_PostInfinity: 2
      m_RotationOrder: 4
    attribute: m_IsActive
    path: Outfit/Jacket
    classID: 1
    script: {fileID: 0}
  - curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: 0.5
        inSlope: 0
        outSlope: 0
        tangentMode: 136
        weightedMode: 0
        inWeight: 0.33333334
        outWeight: 0.33333334
      m_PreInfinity: 2
      m_PostInfinity: 2
      m_RotationOrder: 4
    attribute: material._Alpha
    path: Body
    classID: 23
    script: {fileID: 0}
  m_SampleRate: 60
  m_AnimationClipSettings:
    m_StartTime: 0
    m_StopTime: 0
    m_LoopTime: 0
`;
    const result = parseAnimationClip(yaml, { guid: 'rurune-pose-guid', relPath: 'RurunePose.anim' });

    expect(result.floatCurves).toHaveLength(3);
    expect(result.floatCurves).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '',
        attribute: 'Chest Front-Back',
        classId: 95,
        keyframes: expect.arrayContaining([
          expect.objectContaining({ time: 0, value: 0.035461966 }),
        ]),
      }),
    ]));
    expect(result).toMatchObject({ motionCurveCount: 1, hasHumanoidMuscles: true });
  });

  test('parses nested Unity BlendTree children and parameters', () => {
    const yaml = `%YAML 1.1
--- !u!206 &20600000
BlendTree:
  m_Name: Radial Blend
  m_Childs:
  - serializedVersion: 2
    m_Motion: {fileID: 7400000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 2}
    m_Threshold: 0
    m_Position: {x: -1, y: 0}
    m_TimeScale: 1
    m_CycleOffset: 0
    m_DirectBlendParameter: Left
    m_Mirror: 0
  - serializedVersion: 2
    m_Motion: {fileID: 7400000, guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, type: 2}
    m_Threshold: 1
    m_Position: {x: 1, y: 0}
    m_TimeScale: 0.5
    m_CycleOffset: 0.25
    m_DirectBlendParameter: Right
    m_Mirror: 0
  m_BlendParameter: Breast
  m_BlendParameterY: FaceY
  m_MinThreshold: 0
  m_MaxThreshold: 1
  m_UseAutomaticThresholds: 0
  m_NormalizedBlendValues: 0
  m_BlendType: 0
--- !u!91 &9100000
AnimatorController:
  m_Name: FX
  m_AnimatorParameters: []
  m_AnimatorLayers: []
`;
    const result = parseAnimatorController(yaml);
    expect(result.blendTrees).toEqual([expect.objectContaining({
      fileId: '20600000',
      name: 'Radial Blend',
      blendParameter: 'Breast',
      blendParameterY: 'FaceY',
      blendType: 0,
      children: [
        expect.objectContaining({ threshold: 0, position: { x: -1, y: 0 } }),
        expect.objectContaining({ threshold: 1, timeScale: 0.5, cycleOffset: 0.25 }),
      ],
    })]);
  });

  test('collects supported files and skips unsupported assets safely', () => {
    const clip = `--- !u!74 &7400000\nAnimationClip:\n  m_Name: Empty\n  m_FloatCurves: []\n  m_SampleRate: 60\n`;
    const rows = collectAnimatorAssets([
      { relPath: 'Empty.anim', text: clip },
      { relPath: 'Mask.mask', text: 'not an animator asset' },
      { relPath: 'Broken.anim', get text() { throw new Error('bad'); } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'animationClip', name: 'Empty' });
  });
});
