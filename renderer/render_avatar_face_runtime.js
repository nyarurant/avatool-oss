import * as THREE from './vendor/three/three.module.js';

const VISEME_NAMES = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'ih', 'oh', 'ou'];

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\p{L}]+/gu, '');
}

function createResolver(root) {
  const rows = [];
  root.traverse((object) => {
    const names = [];
    let current = object;
    while (current && current !== root) {
      names.unshift(current.name || '');
      current = current.parent;
    }
    rows.push({ object, path: normalized(names.join('/')), leaf: normalized(object.name) });
  });
  return (path, fallbackPatterns = []) => {
    const wanted = normalized(path);
    if (wanted) {
      const exact = rows.filter((row) => row.path === wanted || row.path.endsWith(wanted));
      if (exact.length) return exact[0].object;
    }
    for (const pattern of fallbackPatterns) {
      const matches = rows.filter((row) => pattern.test(row.leaf));
      if (matches.length === 1) return matches[0].object;
      if (matches.length) return matches.sort((a, b) => a.leaf.length - b.leaf.length)[0].object;
    }
    return null;
  };
}

function unityQuaternion(value) {
  return new THREE.Quaternion(
    -(Number(value?.x) || 0),
    -(Number(value?.y) || 0),
    Number(value?.z) || 0,
    Number.isFinite(Number(value?.w)) ? Number(value.w) : 1
  ).normalize();
}

function morphIndex(mesh, name) {
  const dictionary = mesh?.morphTargetDictionary;
  if (!dictionary || !name) return null;
  if (Number.isInteger(dictionary[name])) return dictionary[name];
  const wanted = normalized(name).replace(/^blendshape/, '');
  const entry = Object.entries(dictionary).find(([key]) => {
    const candidate = normalized(key).replace(/^blendshape/, '');
    return candidate === wanted || candidate.endsWith(wanted) || wanted.endsWith(candidate);
  });
  return Number.isInteger(entry?.[1]) ? entry[1] : null;
}

function findMorphMesh(root, preferredPath, names, resolve) {
  const preferred = resolve(preferredPath);
  const candidates = [];
  root.traverse((object) => {
    if (object.morphTargetDictionary && object.morphTargetInfluences) candidates.push(object);
  });
  if (preferred?.morphTargetDictionary) return preferred;
  let best = null;
  let bestScore = 0;
  for (const mesh of candidates) {
    const score = names.reduce((sum, name) => sum + (Number.isInteger(morphIndex(mesh, name)) ? 1 : 0), 0);
    if (score > bestScore) {
      best = mesh;
      bestScore = score;
    }
  }
  return best;
}

function directionalRotation(settings, side, x, y) {
  const straight = unityQuaternion(settings?.lookingStraight?.[side]);
  const horizontalTarget = unityQuaternion((x < 0 ? settings?.lookingLeft : settings?.lookingRight)?.[side]);
  const verticalTarget = unityQuaternion((y < 0 ? settings?.lookingDown : settings?.lookingUp)?.[side]);
  const horizontal = straight.clone().slerp(horizontalTarget, Math.min(1, Math.abs(x)));
  const verticalDelta = straight.clone().invert().multiply(verticalTarget);
  return horizontal.multiply(new THREE.Quaternion().identity().slerp(verticalDelta, Math.min(1, Math.abs(y))));
}

export function createAvatarFaceRuntime({ root, components = [], invalidate = () => {} } = {}) {
  const descriptor = components.find((row) => row?.type === 'avatarDescriptor') || null;
  const resolve = createResolver(root);
  const eyeSettings = descriptor?.customEyeLook || {};
  const leftEye = resolve(eyeSettings.leftEyePath, [/^(?:j)?lefteye$/, /^eye(?:bone)?l$/, /eyel$/]);
  const rightEye = resolve(eyeSettings.rightEyePath, [/^(?:j)?righteye$/, /^eye(?:bone)?r$/, /eyer$/]);
  const eyelidBones = {
    upperLeft: resolve(eyeSettings.upperLeftEyelidPath, [/upper.*(?:eyelid|lid).*l$/, /l.*upper.*(?:eyelid|lid)/]),
    upperRight: resolve(eyeSettings.upperRightEyelidPath, [/upper.*(?:eyelid|lid).*r$/, /r.*upper.*(?:eyelid|lid)/]),
    lowerLeft: resolve(eyeSettings.lowerLeftEyelidPath, [/lower.*(?:eyelid|lid).*l$/, /l.*lower.*(?:eyelid|lid)/]),
    lowerRight: resolve(eyeSettings.lowerRightEyelidPath, [/lower.*(?:eyelid|lid).*r$/, /r.*lower.*(?:eyelid|lid)/]),
  };
  const jaw = resolve(descriptor?.lipSyncJawBonePath, [/^jaw$/, /jawbone$/, /chin/]);
  const visemeNames = Array.isArray(descriptor?.visemeBlendShapes) ? descriptor.visemeBlendShapes : [];
  const visemeMesh = findMorphMesh(root, descriptor?.visemeSkinnedMeshPath, visemeNames.concat(descriptor?.mouthOpenBlendShapeName || []), resolve);
  const eyelidMesh = findMorphMesh(root, eyeSettings.eyelidsSkinnedMeshPath, visemeNames, resolve) || visemeMesh;
  const state = { lookX: 0, lookY: 0, blink: 0, viseme: 0, visemeWeight: 0, auto: false };
  const tracking = { eyes: 1, mouth: 1 };
  const lastMorphValues = new Map();
  const lastBoneRotations = new Map();
  let disposed = false;
  let saccadeTimer = null;
  let blinkTimer = null;
  let blinkReleaseTimer = null;

  function rememberMorph(mesh, index) {
    if (!mesh?.morphTargetInfluences || !Number.isInteger(index)) return false;
    if (!lastMorphValues.has(mesh)) lastMorphValues.set(mesh, new Map());
    const values = lastMorphValues.get(mesh);
    if (!values.has(index)) values.set(index, mesh.morphTargetInfluences[index] || 0);
    return true;
  }

  function setMorph(mesh, index, value) {
    if (!rememberMorph(mesh, index)) return false;
    mesh.morphTargetInfluences[index] = Math.max(0, Math.min(1, Number(value) || 0));
    return true;
  }

  function rememberBone(bone) {
    if (bone && !lastBoneRotations.has(bone)) lastBoneRotations.set(bone, bone.quaternion.clone());
  }

  function restoreUnderlying() {
    for (const [mesh, values] of lastMorphValues) {
      if (!mesh.morphTargetInfluences) continue;
      for (const [index, value] of values) mesh.morphTargetInfluences[index] = value;
    }
    for (const [bone, rotation] of lastBoneRotations) bone.quaternion.copy(rotation);
    lastMorphValues.clear();
    lastBoneRotations.clear();
  }

  function applyEyes() {
    if (!descriptor?.enableEyeLook || tracking.eyes === 2) return 0;
    let applied = 0;
    if (leftEye) {
      rememberBone(leftEye);
      leftEye.quaternion.copy(directionalRotation(eyeSettings, 'left', state.lookX, state.lookY));
      applied += 1;
    }
    if (rightEye) {
      rememberBone(rightEye);
      rightEye.quaternion.copy(directionalRotation(eyeSettings, 'right', state.lookX, state.lookY));
      applied += 1;
    }
    if (Number(eyeSettings.eyelidType) === 2 && eyelidMesh) {
      const indices = eyeSettings.eyelidsBlendshapes || [];
      if (indices[0] >= 0 && setMorph(eyelidMesh, indices[0], state.blink)) applied += 1;
      if (indices[1] >= 0 && setMorph(eyelidMesh, indices[1], Math.max(0, state.lookY))) applied += 1;
      if (indices[2] >= 0 && setMorph(eyelidMesh, indices[2], Math.max(0, -state.lookY))) applied += 1;
    } else if (Number(eyeSettings.eyelidType) === 1) {
      const applyLid = (bone, lid, side) => {
        if (!bone) return;
        const defaults = unityQuaternion(eyeSettings?.eyelidsDefault?.[lid]?.[side]);
        const lookTarget = unityQuaternion((state.lookY < 0 ? eyeSettings?.eyelidsLookingDown : eyeSettings?.eyelidsLookingUp)?.[lid]?.[side]);
        const closed = unityQuaternion(eyeSettings?.eyelidsClosed?.[lid]?.[side]);
        const rotation = defaults.clone().slerp(lookTarget, Math.min(1, Math.abs(state.lookY))).slerp(closed, state.blink);
        rememberBone(bone);
        bone.quaternion.copy(rotation);
        applied += 1;
      };
      applyLid(eyelidBones.upperLeft, 'upper', 'left');
      applyLid(eyelidBones.upperRight, 'upper', 'right');
      applyLid(eyelidBones.lowerLeft, 'lower', 'left');
      applyLid(eyelidBones.lowerRight, 'lower', 'right');
    }
    return applied;
  }

  function applyMouth() {
    if (tracking.mouth === 2) return 0;
    const style = Number(descriptor?.lipSync) || 0;
    const amount = Math.max(0, Math.min(1, Number(state.visemeWeight) || 0));
    let applied = 0;
    if (style === 1 && jaw) {
      rememberBone(jaw);
      jaw.quaternion.copy(unityQuaternion(descriptor?.lipSyncJawClosed))
        .slerp(unityQuaternion(descriptor?.lipSyncJawOpen), amount);
      return 1;
    }
    if (!visemeMesh) return 0;
    if (style === 2) {
      const index = morphIndex(visemeMesh, descriptor?.mouthOpenBlendShapeName);
      return setMorph(visemeMesh, index, amount) ? 1 : 0;
    }
    if (style === 4) return 0;
    for (let index = 0; index < visemeNames.length; index += 1) {
      const targetIndex = morphIndex(visemeMesh, visemeNames[index]);
      const value = index === Number(state.viseme) && index !== 0 ? amount : 0;
      if (setMorph(visemeMesh, targetIndex, value)) applied += 1;
    }
    return applied;
  }

  function apply() {
    if (disposed || !descriptor) return { eyeCount: 0, mouthCount: 0 };
    restoreUnderlying();
    const result = { eyeCount: applyEyes(), mouthCount: applyMouth() };
    invalidate(100);
    return result;
  }

  function setFace(next = {}) {
    const autoChanged = Object.hasOwn(next, 'auto') && Boolean(next.auto) !== state.auto;
    for (const key of Object.keys(state).filter((name) => name !== 'auto')) {
      if (Number.isFinite(Number(next[key]))) state[key] = Number(next[key]);
    }
    if (Object.hasOwn(next, 'auto')) state.auto = Boolean(next.auto);
    state.lookX = THREE.MathUtils.clamp(state.lookX, -1, 1);
    state.lookY = THREE.MathUtils.clamp(state.lookY, -1, 1);
    state.blink = THREE.MathUtils.clamp(state.blink, 0, 1);
    state.viseme = THREE.MathUtils.clamp(Math.round(state.viseme), 0, Math.max(0, visemeNames.length - 1));
    state.visemeWeight = THREE.MathUtils.clamp(state.visemeWeight, 0, 1);
    if (autoChanged) syncAutoTimers();
    return { ...state, ...apply() };
  }

  function clearAutoTimers() {
    clearTimeout(saccadeTimer);
    clearTimeout(blinkTimer);
    clearTimeout(blinkReleaseTimer);
    saccadeTimer = null;
    blinkTimer = null;
    blinkReleaseTimer = null;
  }

  function scheduleSaccade() {
    if (!state.auto || disposed) return;
    const confidence = THREE.MathUtils.clamp(Number(eyeSettings.confidence) || 0.5, 0, 1);
    const excitement = THREE.MathUtils.clamp(Number(eyeSettings.excitement) || 0.5, 0, 1);
    const delay = 700 + Math.random() * (2800 - excitement * 1400);
    saccadeTimer = setTimeout(() => {
      if (!state.auto || disposed) return;
      state.lookX = (Math.random() * 2 - 1) * (0.25 + confidence * 0.55);
      state.lookY = (Math.random() * 2 - 1) * (0.15 + confidence * 0.35);
      apply();
      scheduleSaccade();
    }, delay);
  }

  function scheduleBlink() {
    if (!state.auto || disposed) return;
    const excitement = THREE.MathUtils.clamp(Number(eyeSettings.excitement) || 0.5, 0, 1);
    const delay = 2600 + Math.random() * (4200 - excitement * 1300);
    blinkTimer = setTimeout(() => {
      if (!state.auto || disposed) return;
      state.blink = 1;
      apply();
      blinkReleaseTimer = setTimeout(() => {
        if (!state.auto || disposed) return;
        state.blink = 0;
        apply();
        scheduleBlink();
      }, 90 + Math.random() * 70);
    }, delay);
  }

  function syncAutoTimers() {
    clearAutoTimers();
    if (!state.auto || disposed) return;
    scheduleSaccade();
    scheduleBlink();
  }

  function setTracking(next = {}) {
    if (Number(next.eyes)) tracking.eyes = Number(next.eyes);
    if (Number(next.mouth)) tracking.mouth = Number(next.mouth);
    return apply();
  }

  function beforeAnimation() {
    restoreUnderlying();
  }

  function afterAnimation() {
    return apply();
  }

  function dispose() {
    if (disposed) return;
    restoreUnderlying();
    clearAutoTimers();
    disposed = true;
    invalidate();
  }

  return {
    setFace,
    setTracking,
    beforeAnimation,
    afterAnimation,
    dispose,
    state: () => ({ ...state, tracking: { ...tracking } }),
    stats: () => ({
      enabled: Boolean(descriptor),
      eyeBoneCount: Number(Boolean(leftEye)) + Number(Boolean(rightEye)),
      visemeCount: visemeNames.filter((name) => Number.isInteger(morphIndex(visemeMesh, name))).length,
      eyelidBlendShapeCount: (eyeSettings.eyelidsBlendshapes || []).filter((index) => index >= 0).length,
      eyelidBoneCount: Object.values(eyelidBones).filter(Boolean).length,
      lipSyncStyle: Number(descriptor?.lipSync) || 0,
      visemeNames: visemeNames.length ? visemeNames.slice() : VISEME_NAMES.slice(),
    }),
  };
}
