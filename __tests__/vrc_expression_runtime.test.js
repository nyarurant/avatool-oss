'use strict';

const {
  CONTROL,
  conditionMatches,
  computeBlendWeights,
  createRuntime,
} = require('../renderer/render_vrc_expression_runtime');

function fixture() {
  const menuGuid = '11111111111111111111111111111111';
  const paramsGuid = '22222222222222222222222222222222';
  const controllerGuid = '33333333333333333333333333333333';
  const offClipGuid = '44444444444444444444444444444444';
  const onClipGuid = '55555555555555555555555555555555';
  return [
    {
      type: 'avatarDescriptor',
      expressionsMenu: { guid: menuGuid },
      expressionParameters: { guid: paramsGuid },
      baseAnimationLayers: [{ type: 5, enabled: true, animatorController: { guid: controllerGuid } }],
    },
    {
      type: 'expressionParameters', assetGuid: paramsGuid,
      parameters: [{ name: 'Hat', valueType: 2, defaultValue: 0 }],
    },
    {
      type: 'expressionMenu', assetGuid: menuGuid, name: 'Root',
      controls: [{ name: 'Hat', controlType: CONTROL.TOGGLE, parameter: 'Hat', value: 1 }],
    },
    {
      type: 'animatorController', assetGuid: controllerGuid, name: 'FX',
      parameters: [{ name: 'Hat', type: 4, defaultBool: false }],
      layers: [{ name: 'Toggle', stateMachineFileId: '10', defaultWeight: 1 }],
      stateMachines: [{ fileId: '10', defaultStateFileId: '20', anyStateTransitionFileIds: [] }],
      states: [
        { fileId: '20', name: 'Off', transitionFileIds: ['31'], behaviourFileIds: [], motion: { guid: offClipGuid } },
        { fileId: '21', name: 'On', transitionFileIds: ['32'], behaviourFileIds: [], motion: { guid: onClipGuid } },
      ],
      transitions: [
        { fileId: '31', destinationStateFileId: '21', conditions: [{ mode: 1, parameter: 'Hat' }] },
        { fileId: '32', destinationStateFileId: '20', conditions: [{ mode: 2, parameter: 'Hat' }] },
      ],
      behaviours: [],
    },
    { type: 'animationClip', assetGuid: offClipGuid, name: 'Off', floatCurves: [] },
    { type: 'animationClip', assetGuid: onClipGuid, name: 'On', floatCurves: [] },
  ];
}

describe('VRC expression preview runtime', () => {
  test('resolves descriptor menu and toggles the FX Animator state', () => {
    const runtime = createRuntime(fixture());
    expect(runtime.rootMenu().name).toBe('Root');
    expect(runtime.evaluate().clips[0].name).toBe('Off');
    const result = runtime.applyControl(runtime.rootMenu().controls[0]);
    expect(runtime.getParameter('Hat')).toBe(1);
    expect(result.states[0].state).toBe('On');
    expect(result.clips[0].name).toBe('On');
  });

  test('supports Unity bool and numeric condition modes', () => {
    const values = new Map([['Bool', true], ['Number', 2]]);
    expect(conditionMatches({ mode: 1, parameter: 'Bool' }, values)).toBe(true);
    expect(conditionMatches({ mode: 2, parameter: 'Bool' }, values)).toBe(false);
    expect(conditionMatches({ mode: 3, parameter: 'Number', threshold: 1 }, values)).toBe(true);
    expect(conditionMatches({ mode: 4, parameter: 'Number', threshold: 3 }, values)).toBe(true);
    expect(conditionMatches({ mode: 6, parameter: 'Number', threshold: 2 }, values)).toBe(true);
    expect(conditionMatches({ mode: 7, parameter: 'Number', threshold: 1 }, values)).toBe(true);
  });

  test('applies a Parameter Driver once on state entry and reevaluates transitions', () => {
    const rows = fixture();
    const controller = rows.find((row) => row.type === 'animatorController');
    controller.behaviours.push({
      fileId: '90', type: 'parameterDriver',
      parameters: [{ changeType: 0, name: 'Hat', value: 1 }],
    });
    controller.states[0].behaviourFileIds = ['90'];
    const result = createRuntime(rows).evaluate();
    expect(result.parameters.Hat).toBe(1);
    expect(result.states[0].state).toBe('On');
  });

  test('applies Tracking Control on state entry and preserves NoChange fields', () => {
    const rows = fixture();
    const controller = rows.find((row) => row.type === 'animatorController');
    controller.behaviours.push({
      fileId: '91', type: 'trackingControl', tracking: { eyes: 2, mouth: 0, head: 2 },
    });
    controller.states[0].behaviourFileIds = ['91'];
    const result = createRuntime(rows).evaluate();
    expect(result.tracking).toMatchObject({ eyes: 2, mouth: 1, head: 2 });
  });

  test('evaluates Tracking Control from a non-FX custom playable layer without sampling its motion', () => {
    const rows = fixture();
    const descriptor = rows.find((row) => row.type === 'avatarDescriptor');
    const gestureGuid = '66666666666666666666666666666666';
    descriptor.baseAnimationLayers.push({ type: 3, isDefault: false, animatorController: { guid: gestureGuid } });
    rows.push({
      type: 'animatorController', assetGuid: gestureGuid, name: 'Gesture', parameters: [],
      layers: [{ name: 'Tracking', stateMachineFileId: '110', defaultWeight: 1 }],
      stateMachines: [{ fileId: '110', defaultStateFileId: '120', anyStateTransitionFileIds: [] }],
      states: [{ fileId: '120', name: 'Animated Eyes', transitionFileIds: [], behaviourFileIds: ['190'], motion: null }],
      transitions: [], blendTrees: [],
      behaviours: [{ fileId: '190', type: 'trackingControl', tracking: { eyes: 2, mouth: 0 } }],
    });
    const result = createRuntime(rows).evaluate();
    expect(result.tracking).toMatchObject({ eyes: 2, mouth: 1 });
    expect(result.clips).toHaveLength(1);
    expect(result.states.some((row) => row.controller === 'Gesture' && row.state === 'Animated Eyes')).toBe(true);
  });

  test('uses VRChat Random semantics for Bool chance and Int preventRepeats', () => {
    const rows = fixture();
    const params = rows.find((row) => row.type === 'expressionParameters').parameters;
    params.push(
      { name: 'Flag', valueType: 2, defaultValue: 1 },
      { name: 'Index', valueType: 0, defaultValue: 1 }
    );
    const controller = rows.find((row) => row.type === 'animatorController');
    controller.behaviours.push({
      fileId: '92', type: 'parameterDriver', parameters: [
        { changeType: 2, name: 'Flag', valueMin: 0, valueMax: 1, chance: 0.1 },
        { changeType: 2, name: 'Index', valueMin: 1, valueMax: 2, chance: 1, preventRepeats: true },
      ],
    });
    controller.states[0].behaviourFileIds = ['92'];
    const random = jest.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValueOnce(0);
    const result = createRuntime(rows).evaluate();
    random.mockRestore();
    expect(result.parameters).toMatchObject({ Flag: 0, Index: 2 });
  });

  test('applies layer weight, locomotion, pose-space, and audio State Behaviours', () => {
    const rows = fixture();
    const controller = rows.find((row) => row.type === 'animatorController');
    controller.states[0].behaviourFileIds = ['101', '102', '103', '104', '105'];
    controller.behaviours.push(
      { fileId: '101', type: 'playableLayerControl', layer: 1, goalWeight: 0.5 },
      { fileId: '102', type: 'animatorLayerControl', playable: 1, layer: 0, goalWeight: 0.5 },
      { fileId: '103', type: 'locomotionControl', disableLocomotion: true },
      { fileId: '104', type: 'temporaryPoseSpace', enterPoseSpace: true, delayTime: 0 },
      {
        fileId: '105', type: 'playAudio', sourcePath: 'Audio', playbackOrder: 3, parameterName: 'Hat',
        clips: [{ guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', fileId: '8300000' }],
        playOnEnter: true, stopOnEnter: false, playOnExit: false, stopOnExit: true,
      }
    );
    const result = createRuntime(rows).evaluate();
    expect(result.samples[0].weight).toBe(0.25);
    expect(result.runtime).toMatchObject({ locomotionDisabled: true, poseSpace: true });
    expect(result.runtime.playableLayerWeights['1']).toBe(0.5);
    expect(result.runtime.animatorLayerWeights['1:0']).toBe(0.5);
    expect(result.runtime.audioEvents).toEqual([expect.objectContaining({ phase: 'enter', sourcePath: 'Audio', play: true })]);
  });

  test('interpolates 1D BlendTree clips from a Puppet parameter', () => {
    const rows = fixture();
    const controller = rows.find((row) => row.type === 'animatorController');
    controller.states[0].motion = { fileId: '70', guid: null };
    controller.blendTrees = [{
      fileId: '70', blendType: 0, blendParameter: 'Breast',
      children: [
        { threshold: 0, motion: { guid: rows.at(-2).assetGuid }, timeScale: 1, cycleOffset: 0 },
        { threshold: 1, motion: { guid: rows.at(-1).assetGuid }, timeScale: 1, cycleOffset: 0 },
      ],
    }];
    rows.find((row) => row.type === 'expressionParameters').parameters.push({
      name: 'Breast', valueType: 1, defaultValue: 0.25,
    });
    const runtime = createRuntime(rows);
    runtime.evaluate(0);
    const result = runtime.evaluate(0.5);
    expect(result.samples).toHaveLength(2);
    expect(result.samples.map((row) => row.weight)).toEqual([0.75, 0.25]);
    expect(result.samples.map((row) => row.time)).toEqual([0.5, 0.5]);
  });

  test('computes continuous 2D and normalized Direct BlendTree weights', () => {
    const parameters = new Map([['X', 0], ['Y', 0], ['A', 1], ['B', 3]]);
    const twoD = computeBlendWeights({
      blendType: 2, blendParameter: 'X', blendParameterY: 'Y',
      children: [
        { position: { x: -1, y: 0 } },
        { position: { x: 1, y: 0 } },
      ],
    }, parameters);
    expect(twoD.map((row) => row.weight)).toEqual([0.5, 0.5]);
    const direct = computeBlendWeights({
      blendType: 4,
      children: [{ directBlendParameter: 'A' }, { directBlendParameter: 'B' }],
    }, parameters);
    expect(direct.map((row) => row.weight)).toEqual([0.25, 0.75]);
  });

  test('uses an Animator State time parameter as normalized clip time', () => {
    const rows = fixture();
    const controller = rows.find((row) => row.type === 'animatorController');
    controller.states[0].timeParameter = 'Breast';
    rows.find((row) => row.type === 'expressionParameters').parameters.push({
      name: 'Breast', valueType: 1, defaultValue: 0.75,
    });
    const result = createRuntime(rows).evaluate(10);
    expect(result.samples[0]).toMatchObject({ time: 0.75, normalizedTime: true });
  });

  test('static UI evaluation settles at the clip end while playback keeps explicit time', () => {
    const runtime = createRuntime(fixture());
    expect(runtime.evaluate().samples[0].time).toBe(Number.POSITIVE_INFINITY);
    expect(runtime.evaluate(0).samples[0].time).toBe(0);
  });

  test('preserves negative Animator State speed as reverse clip sampling', () => {
    const rows = fixture();
    const states = rows.find((row) => row.type === 'animatorController').states;
    states[0].speed = -1;
    states[1].speed = 1;
    const runtime = createRuntime(rows);
    expect(runtime.evaluate().samples[0]).toMatchObject({ reverse: true, time: Number.POSITIVE_INFINITY });
    runtime.applyControl(runtime.rootMenu().controls[0]);
    expect(runtime.evaluate().samples[0].reverse).toBe(false);
    runtime.applyControl(runtime.rootMenu().controls[0]);
    expect(runtime.evaluate().samples[0].reverse).toBe(true);
  });
});
