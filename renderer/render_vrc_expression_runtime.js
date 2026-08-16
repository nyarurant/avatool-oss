(function attachVrcExpressionRuntime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AvatoolVrcExpressionRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis, function createApi() {
  'use strict';

  const CONTROL = Object.freeze({
    BUTTON: 101,
    TOGGLE: 102,
    SUB_MENU: 103,
    TWO_AXIS_PUPPET: 201,
    FOUR_AXIS_PUPPET: 202,
    RADIAL_PUPPET: 203,
  });

  function guid(value) {
    return String(value || '').toLowerCase();
  }

  function parameterValue(parameters, name) {
    return parameters.has(name) ? parameters.get(name) : 0;
  }

  function conditionMatches(condition, parameters) {
    const value = parameterValue(parameters, condition?.parameter);
    const threshold = Number(condition?.threshold) || 0;
    switch (Number(condition?.mode)) {
      case 1: return !!value;
      case 2: return !value;
      case 3: return Number(value) > threshold;
      case 4: return Number(value) < threshold;
      case 6: return Number(value) === threshold;
      case 7: return Number(value) !== threshold;
      default: return false;
    }
  }

  function transitionMatches(transition, parameters) {
    const conditions = Array.isArray(transition?.conditions) ? transition.conditions : [];
    return conditions.length > 0 && conditions.every((row) => conditionMatches(row, parameters));
  }

  function normalizeWeights(rows) {
    const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.weight) || 0), 0);
    if (total <= 0) return [];
    return rows.filter((row) => row.weight > 0).map((row) => ({ ...row, weight: row.weight / total }));
  }

  function computeBlendWeights(tree, parameters) {
    const children = Array.isArray(tree?.children) ? tree.children : [];
    if (!children.length) return [];
    const blendType = Number(tree.blendType) || 0;
    if (blendType === 4) {
      const direct = children.map((child) => ({
        child,
        weight: Math.max(0, Number(parameterValue(parameters, child.directBlendParameter)) || 0),
      }));
      return normalizeWeights(direct);
    }
    if (blendType === 0) {
      const value = Number(parameterValue(parameters, tree.blendParameter)) || 0;
      const sorted = children.map((child) => ({ child, threshold: Number(child.threshold) || 0 }))
        .sort((a, b) => a.threshold - b.threshold);
      if (value <= sorted[0].threshold) return [{ child: sorted[0].child, weight: 1 }];
      if (value >= sorted.at(-1).threshold) return [{ child: sorted.at(-1).child, weight: 1 }];
      for (let index = 0; index < sorted.length - 1; index += 1) {
        const left = sorted[index];
        const right = sorted[index + 1];
        if (value < left.threshold || value > right.threshold) continue;
        const span = right.threshold - left.threshold;
        const t = span > 0 ? (value - left.threshold) / span : 0;
        return [
          { child: left.child, weight: 1 - t },
          { child: right.child, weight: t },
        ].filter((row) => row.weight > 0);
      }
    }
    const x = Number(parameterValue(parameters, tree.blendParameter)) || 0;
    const y = Number(parameterValue(parameters, tree.blendParameterY)) || 0;
    const distances = children.map((child) => {
      const dx = x - Number(child.position?.x || 0);
      const dy = y - Number(child.position?.y || 0);
      return { child, distanceSquared: dx * dx + dy * dy };
    });
    const exact = distances.find((row) => row.distanceSquared <= 1e-8);
    if (exact) return [{ child: exact.child, weight: 1 }];
    // Unity's directional/freeform algorithms differ around collinear points.
    // Inverse-distance weighting preserves every authored point and produces a
    // continuous preview for all 2D tree variants without discontinuities.
    return normalizeWeights(distances.map((row) => ({
      child: row.child,
      weight: 1 / Math.max(1e-8, row.distanceSquared),
    })));
  }

  function createRuntime(components) {
    const rows = Array.isArray(components) ? components : [];
    const descriptor = rows.find((row) => row?.type === 'avatarDescriptor') || null;
    const menus = new Map(rows.filter((row) => row?.type === 'expressionMenu').map((row) => [guid(row.assetGuid), row]));
    const parameterAssets = new Map(rows.filter((row) => row?.type === 'expressionParameters').map((row) => [guid(row.assetGuid), row]));
    const controllers = rows.filter((row) => row?.type === 'animatorController');
    const clips = new Map(rows.filter((row) => row?.type === 'animationClip').map((row) => [guid(row.assetGuid), row]));
    const parameters = new Map();
    const parameterTypes = new Map();
    const stateByLayer = new Map();
    const stateEnteredAtByLayer = new Map();
    const tracking = {
      head: 1, leftHand: 1, rightHand: 1, hip: 1, leftFoot: 1, rightFoot: 1,
      leftFingers: 1, rightFingers: 1, eyes: 1, mouth: 1,
    };
    const playableLayerWeights = new Map([[0, 1], [1, 1], [2, 1], [3, 1]]);
    const animatorLayerWeights = new Map();
    const temporaryPoseApplied = new Set();
    const audioPlaybackIndices = new Map();
    let locomotionDisabled = false;
    let poseSpace = false;
    let runtimeRevision = 0;
    let audioEvents = [];

    const expressionParams = parameterAssets.get(guid(descriptor?.expressionParameters?.guid))
      || parameterAssets.values().next().value;
    for (const row of expressionParams?.parameters || []) {
      parameters.set(row.name, row.defaultValue ?? 0);
      parameterTypes.set(row.name, Number(row.valueType) === 2 ? 'bool' : Number(row.valueType) === 0 ? 'int' : 'float');
    }
    for (const controller of controllers) {
      for (const row of controller.parameters || []) {
        if (!parameterTypes.has(row.name)) {
          parameterTypes.set(row.name, Number(row.type) === 4 || Number(row.type) === 9 ? 'bool' : Number(row.type) === 3 ? 'int' : 'float');
        }
        if (parameters.has(row.name)) continue;
        const value = Number(row.type) === 4 || Number(row.type) === 9
          ? Boolean(row.defaultBool)
          : Number(row.type) === 3 ? Number(row.defaultInt) || 0 : Number(row.defaultFloat) || 0;
        parameters.set(row.name, value);
      }
    }

    // VRCSDK serializes isEnabled as 0 even for custom base layers in current
    // avatar prefabs. isDefault=false plus a controller reference is the
    // reliable signal that the custom FX layer is active.
    const fxGuids = new Set((descriptor?.baseAnimationLayers || [])
      .filter((row) => Number(row?.type) === 5 && row?.isDefault !== true && row?.animatorController?.guid)
      .map((row) => guid(row.animatorController.guid)));
    const customLayerGuids = new Set([
      ...(descriptor?.baseAnimationLayers || []),
      ...(descriptor?.specialAnimationLayers || []),
    ].filter((row) => row?.isDefault !== true && row?.animatorController?.guid)
      .map((row) => guid(row.animatorController.guid)));
    const activeControllerRows = controllers.map((controller, controllerIndex) => ({ controller, controllerIndex }))
      .filter(({ controller }) => !fxGuids.size || fxGuids.has(guid(controller.assetGuid)));
    const behaviourOnlyControllerRows = controllers.map((controller, controllerIndex) => ({ controller, controllerIndex }))
      .filter(({ controller }) => customLayerGuids.has(guid(controller.assetGuid)) && !fxGuids.has(guid(controller.assetGuid)));
    const playableTypeByGuid = new Map();
    for (const row of descriptor?.baseAnimationLayers || []) {
      const layerGuid = guid(row?.animatorController?.guid);
      const playableType = Number(row?.type) === 4 ? 0 : Number(row?.type) === 5 ? 1 : Number(row?.type) === 3 ? 2 : Number(row?.type) === 2 ? 3 : null;
      if (layerGuid && playableType != null) playableTypeByGuid.set(layerGuid, playableType);
    }

    function setParameter(name, value) {
      if (name) parameters.set(name, value);
    }

    function applyDriver(behaviour) {
      let changed = false;
      for (const action of behaviour?.parameters || []) {
        const oldValue = parameterValue(parameters, action.name);
        let nextValue = oldValue;
        switch (Number(action.changeType)) {
          case 0: nextValue = action.value; break;
          case 1: nextValue = Number(oldValue) + Number(action.value || 0); break;
          case 2: {
            const chance = Number(action.chance);
            const min = Number(action.valueMin) || 0;
            const max = Number(action.valueMax) || 0;
            const parameterType = parameterTypes.get(action.name) || 'float';
            if (parameterType === 'bool') {
              nextValue = Math.random() < Math.max(0, Math.min(1, Number.isFinite(chance) ? chance : 1)) ? 1 : 0;
            } else {
              if (Number.isFinite(chance) && chance < 1 && Math.random() > Math.max(0, chance)) break;
              if (parameterType === 'int') {
                const low = Math.ceil(Math.min(min, max));
                const high = Math.floor(Math.max(min, max));
                nextValue = low + Math.floor(Math.random() * Math.max(1, high - low + 1));
                if (action.preventRepeats && high > low && nextValue === Number(oldValue)) {
                  nextValue = nextValue >= high ? low : nextValue + 1;
                }
              } else nextValue = min + Math.random() * (max - min);
            }
            break;
          }
          case 3: {
            const source = Number(parameterValue(parameters, action.source));
            if (action.convertRange && action.sourceMax !== action.sourceMin) {
              const t = (source - action.sourceMin) / (action.sourceMax - action.sourceMin);
              nextValue = action.destMin + t * (action.destMax - action.destMin);
            } else nextValue = source;
            break;
          }
          default: break;
        }
        if (nextValue !== oldValue) {
          parameters.set(action.name, nextValue);
          changed = true;
        }
      }
      return changed;
    }

    function applyTrackingControl(behaviour) {
      for (const [name, value] of Object.entries(behaviour?.tracking || {})) {
        const next = Number(value) || 0;
        if (next !== 0 && Object.hasOwn(tracking, name)) tracking[name] = next;
      }
    }

    function setRuntimeValue(target, key, value) {
      if (target.get(key) === value) return;
      target.set(key, value);
      runtimeRevision += 1;
    }

    function chooseAudioClip(behaviour) {
      const clips = behaviour?.clips || [];
      if (!clips.length) return null;
      const order = Number(behaviour.playbackOrder) || 0;
      let index;
      if (order === 3) index = Math.floor(Number(parameterValue(parameters, behaviour.parameterName)) || 0);
      else if (order === 2) {
        index = Number(audioPlaybackIndices.get(behaviour.fileId)) || 0;
        audioPlaybackIndices.set(behaviour.fileId, (index + 1) % clips.length);
      } else index = Math.floor(Math.random() * clips.length);
      return clips[Math.max(0, Math.min(clips.length - 1, index))];
    }

    function applyAudioBehaviour(behaviour, phase) {
      const play = phase === 'enter' ? behaviour.playOnEnter : behaviour.playOnExit;
      const stop = phase === 'enter' ? behaviour.stopOnEnter : behaviour.stopOnExit;
      if (!play && !stop) return;
      audioEvents.push({
        phase,
        sourcePath: behaviour.sourcePath,
        clip: play ? chooseAudioClip(behaviour) : null,
        play: Boolean(play),
        stop: Boolean(stop),
        loop: Boolean(behaviour.loop),
        delaySeconds: Number(behaviour.delaySeconds) || 0,
        volume: behaviour.volume,
        pitch: behaviour.pitch,
      });
    }

    function applyStateBehaviour(behaviour, phase, stateTime, staticEvaluation) {
      if (!behaviour) return;
      if (behaviour.type === 'playAudio') {
        if (phase === 'enter' || phase === 'exit') applyAudioBehaviour(behaviour, phase);
        return;
      }
      if (phase !== 'enter' && phase !== 'update') return;
      if (phase === 'enter' && behaviour.type === 'parameterDriver') applyDriver(behaviour);
      else if (phase === 'enter' && behaviour.type === 'trackingControl') applyTrackingControl(behaviour);
      else if (phase === 'enter' && behaviour.type === 'playableLayerControl') {
        setRuntimeValue(playableLayerWeights, Number(behaviour.layer) || 0, Math.max(0, Math.min(1, Number(behaviour.goalWeight) || 0)));
      } else if (phase === 'enter' && behaviour.type === 'animatorLayerControl') {
        setRuntimeValue(animatorLayerWeights, `${Number(behaviour.playable) || 0}:${Number(behaviour.layer) || 0}`, Math.max(0, Math.min(1, Number(behaviour.goalWeight) || 0)));
      } else if (phase === 'enter' && behaviour.type === 'locomotionControl') {
        if (locomotionDisabled !== Boolean(behaviour.disableLocomotion)) runtimeRevision += 1;
        locomotionDisabled = Boolean(behaviour.disableLocomotion);
      } else if (behaviour.type === 'temporaryPoseSpace') {
        const key = String(behaviour.fileId);
        const ready = staticEvaluation || stateTime >= Math.max(0, Number(behaviour.delayTime) || 0);
        if (ready && !temporaryPoseApplied.has(key)) {
          temporaryPoseApplied.add(key);
          poseSpace = Boolean(behaviour.enterPoseSpace);
          runtimeRevision += 1;
        }
      }
    }

    function evaluateLayer(controller, layer, controllerIndex, layerIndex, timeSeconds, staticEvaluation) {
      const states = new Map((controller.states || []).map((row) => [String(row.fileId), row]));
      const machines = new Map((controller.stateMachines || []).map((row) => [String(row.fileId), row]));
      const transitions = new Map((controller.transitions || []).map((row) => [String(row.fileId), row]));
      const behaviours = new Map((controller.behaviours || []).map((row) => [String(row.fileId), row]));
      const machine = machines.get(String(layer.stateMachineFileId));
      if (!machine) return null;
      const layerKey = `${controllerIndex}:${layerIndex}`;
      let stateId = stateByLayer.get(layerKey);
      if (!states.has(String(stateId))) stateId = machine.defaultStateFileId;

      for (let guard = 0; guard < 32; guard += 1) {
        const state = states.get(String(stateId));
        if (!state) break;
        const candidates = [
          ...(machine.anyStateTransitionFileIds || []),
          ...(state.transitionFileIds || []),
        ].map((id) => transitions.get(String(id))).filter(Boolean);
        const match = candidates.find((row) => transitionMatches(row, parameters));
        if (!match?.destinationStateFileId || String(match.destinationStateFileId) === String(stateId)) break;
        const nextState = states.get(String(match.destinationStateFileId));
        if (!nextState) break;
        stateId = nextState.fileId;
      }

      const previous = stateByLayer.get(layerKey);
      stateByLayer.set(layerKey, stateId);
      const state = states.get(String(stateId));
      if (state && String(previous || '') !== String(stateId)) {
        stateEnteredAtByLayer.set(layerKey, timeSeconds);
        const previousState = states.get(String(previous));
        for (const id of previousState?.behaviourFileIds || []) applyStateBehaviour(behaviours.get(String(id)), 'exit', 0, staticEvaluation);
        for (const id of state.behaviourFileIds || []) {
          applyStateBehaviour(behaviours.get(String(id)), 'enter', 0, staticEvaluation);
        }
      }
      if (!state) return null;
      const stateTime = Math.max(0, timeSeconds - Number(stateEnteredAtByLayer.get(layerKey) || 0));
      for (const id of state.behaviourFileIds || []) applyStateBehaviour(behaviours.get(String(id)), 'update', stateTime, staticEvaluation);
      return { state, stateTime };
    }

    function resolveMotionSamples(controller, motion, timeSeconds, weight = 1, guard = 0, normalizedTime = false, reverse = false) {
      if (!motion || weight <= 0 || guard > 12) return [];
      if (motion.guid) {
        const clip = clips.get(guid(motion.guid));
        return clip ? [{ clip, weight, time: timeSeconds, normalizedTime, reverse }] : [];
      }
      const tree = (controller.blendTrees || []).find((row) => String(row.fileId) === String(motion.fileId));
      if (!tree) return [];
      return computeBlendWeights(tree, parameters).flatMap(({ child, weight: childWeight }) => (
        resolveMotionSamples(
          controller,
          child.motion,
          (timeSeconds * Number(child.timeScale ?? 1)) + Number(child.cycleOffset || 0),
          weight * childWeight,
          guard + 1,
          normalizedTime,
          reverse
        )
      ));
    }

    function evaluate(timeSeconds = 0) {
      // Calls without an explicit clock are event-driven UI evaluations. Unity would
      // advance a newly entered toggle state to its settled pose, but the preview has
      // no continuous clock in this mode. Sample the clip end instead of pinning every
      // 0 -> 1 GameObject activation curve to its first (OFF) key. Passing an explicit
      // time (including 0) is reserved for the optional playback loop and keeps normal
      // time-based animation sampling.
      const staticEvaluation = arguments.length === 0;
      audioEvents = [];
      const samples = [];
      const states = [];
      // Parameter Drivers can unlock another transition. A small bounded pass
      // mirrors the static end result without running an animation clock.
      for (let pass = 0; pass < 8; pass += 1) {
        const before = `${JSON.stringify([...parameters])}:${runtimeRevision}`;
        samples.length = 0;
        states.length = 0;
        activeControllerRows.forEach(({ controller, controllerIndex }) => {
          (controller.layers || []).forEach((layer, layerIndex) => {
            if (Number(layer.defaultWeight ?? 1) <= 0) return;
            const evaluated = evaluateLayer(controller, layer, controllerIndex, layerIndex, timeSeconds, staticEvaluation);
            if (!evaluated) return;
            const { state, stateTime } = evaluated;
            const playableType = playableTypeByGuid.get(guid(controller.assetGuid)) ?? 1;
            const playableWeight = Number(playableLayerWeights.get(playableType) ?? 1);
            const controlledLayerWeight = Number(animatorLayerWeights.get(`${playableType}:${layerIndex}`) ?? layer.defaultWeight ?? 1);
            const effectiveWeight = Math.max(0, playableWeight * controlledLayerWeight);
            if (effectiveWeight <= 0) return;
            const stateSpeed = Number(state.speed ?? 1);
            const reverse = stateSpeed < 0;
            states.push({ controller: controller.name, layer: layer.name, state: state.name });
            samples.push(...resolveMotionSamples(
              controller,
              state.motion,
              state.timeParameter && state.timeParameterActive !== false
                ? Number(parameterValue(parameters, state.timeParameter)) || 0
                : staticEvaluation
                  ? Number.POSITIVE_INFINITY
                  : stateTime * Math.abs(stateSpeed) + Number(state.cycleOffset || 0),
              effectiveWeight,
              0,
              Boolean(state.timeParameter && state.timeParameterActive !== false),
              reverse
            ));
          });
        });
        behaviourOnlyControllerRows.forEach(({ controller, controllerIndex }) => {
          (controller.layers || []).forEach((layer, layerIndex) => {
            if (Number(layer.defaultWeight ?? 1) <= 0) return;
            const evaluated = evaluateLayer(controller, layer, controllerIndex, layerIndex, timeSeconds, staticEvaluation);
            if (evaluated) states.push({ controller: controller.name, layer: layer.name, state: evaluated.state.name });
          });
        });
        if (before === `${JSON.stringify([...parameters])}:${runtimeRevision}`) break;
      }
      const merged = new Map();
      for (const sample of samples) {
        const key = `${guid(sample.clip?.assetGuid)}:${sample.clip?.name || ''}:${sample.time}:${sample.normalizedTime ? 1 : 0}:${sample.reverse ? 1 : 0}`;
        if (!merged.has(key)) merged.set(key, { ...sample });
        else merged.get(key).weight += sample.weight;
      }
      const finalSamples = [...merged.values()].filter((row) => row.weight > 0);
      return {
        clips: [...new Set(finalSamples.map((row) => row.clip))],
        samples: finalSamples,
        states,
        tracking: { ...tracking },
        runtime: {
          playableLayerWeights: Object.fromEntries(playableLayerWeights),
          animatorLayerWeights: Object.fromEntries(animatorLayerWeights),
          locomotionDisabled,
          poseSpace,
          audioEvents: audioEvents.slice(),
        },
        parameters: Object.fromEntries(parameters),
      };
    }

    function applyControl(control, active = true) {
      if (!control) return evaluate();
      const name = control.parameter;
      const value = Number(control.value ?? 1);
      if (Number(control.controlType) === CONTROL.TOGGLE) {
        const current = Number(parameterValue(parameters, name));
        setParameter(name, current === value ? 0 : value);
      } else if (Number(control.controlType) === CONTROL.BUTTON) {
        setParameter(name, active ? value : 0);
      }
      return evaluate();
    }

    function rootMenu() {
      return menus.get(guid(descriptor?.expressionsMenu?.guid)) || menus.values().next().value || null;
    }

    return {
      CONTROL,
      descriptor,
      rootMenu,
      menuByGuid: (value) => menus.get(guid(value)) || null,
      hasParameter: (name) => parameters.has(name),
      getParameter: (name) => parameterValue(parameters, name),
      getParameters: () => Object.fromEntries(parameters),
      setParameter,
      applyControl,
      evaluate,
    };
  }

  return { CONTROL, conditionMatches, transitionMatches, computeBlendWeights, createRuntime };
});
