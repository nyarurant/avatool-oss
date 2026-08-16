import * as THREE from './vendor/three/three.module.js';

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const BONE_PATTERNS = Object.freeze({
  hips: [/^hips?$/, /^pelvis$/],
  head: [/^head$/],
  neck: [/^neck$/],
  leftUpperArm: [/^leftupperarm$/, /^upperarml$/, /^lupperarm$/],
  leftLowerArm: [/^leftlowerarm$/, /^lowerarml$/, /^lforearm$/, /^forearml$/],
  leftHand: [/^lefthand$/, /^handl$/, /^lhand$/],
  rightUpperArm: [/^rightupperarm$/, /^upperarmr$/, /^rupperarm$/],
  rightLowerArm: [/^rightlowerarm$/, /^lowerarmr$/, /^rforearm$/, /^forearmr$/],
  rightHand: [/^righthand$/, /^handr$/, /^rhand$/],
  leftUpperLeg: [/^leftupperleg$/, /^upperlegl$/, /^lthigh$/, /^thighl$/],
  leftLowerLeg: [/^leftlowerleg$/, /^lowerlegl$/, /^lcalf$/, /^calfl$/],
  leftFoot: [/^leftfoot$/, /^footl$/, /^lfoot$/],
  rightUpperLeg: [/^rightupperleg$/, /^upperlegr$/, /^rthigh$/, /^thighr$/],
  rightLowerLeg: [/^rightlowerleg$/, /^lowerlegr$/, /^rcalf$/, /^calfr$/],
  rightFoot: [/^rightfoot$/, /^footr$/, /^rfoot$/],
});

function findBones(root) {
  const rows = [];
  root.traverse((object) => rows.push({ object, name: normalized(object.name) }));
  const result = {};
  for (const [key, patterns] of Object.entries(BONE_PATTERNS)) {
    for (const pattern of patterns) {
      const matches = rows.filter((row) => pattern.test(row.name));
      if (matches.length) {
        result[key] = matches.sort((a, b) => a.name.length - b.name.length)[0].object;
        break;
      }
    }
  }
  return result;
}

function worldPosition(object) {
  return object?.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3();
}

function solveCcd(root, chain, end, target, iterations = 6) {
  if (!end || chain.some((bone) => !bone)) return 0;
  let applied = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const joint of chain) {
      root.updateMatrixWorld(true);
      const jointPos = worldPosition(joint);
      const endDirection = worldPosition(end).sub(jointPos);
      const targetDirection = target.clone().sub(jointPos);
      if (endDirection.lengthSq() < 1e-10 || targetDirection.lengthSq() < 1e-10) continue;
      const deltaWorld = new THREE.Quaternion().setFromUnitVectors(endDirection.normalize(), targetDirection.normalize());
      const worldRotation = joint.getWorldQuaternion(new THREE.Quaternion());
      const desiredWorld = deltaWorld.multiply(worldRotation);
      const parentWorld = joint.parent?.getWorldQuaternion(new THREE.Quaternion()) || new THREE.Quaternion();
      joint.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize();
      applied += 1;
    }
    if (worldPosition(end).distanceToSquared(target) < 1e-7) break;
  }
  root.updateMatrixWorld(true);
  return applied;
}

export function createHumanoidRuntime({ root, invalidate = () => {} } = {}) {
  const bones = findBones(root);
  const baselines = new Map();
  for (const bone of Object.values(bones)) {
    if (bone && !baselines.has(bone)) baselines.set(bone, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
  }
  root.updateMatrixWorld(true);
  const worldBaseline = {
    leftHand: worldPosition(bones.leftHand),
    rightHand: worldPosition(bones.rightHand),
    leftFoot: worldPosition(bones.leftFoot),
    rightFoot: worldPosition(bones.rightFoot),
  };
  const state = { headYaw: 0, headPitch: 0, handReach: 0, crouch: 0 };
  const tracking = { head: 1, leftHand: 1, rightHand: 1, hip: 1, leftFoot: 1, rightFoot: 1 };
  let disposed = false;

  function restore() {
    for (const [bone, baseline] of baselines) {
      bone.position.copy(baseline.position);
      bone.quaternion.copy(baseline.quaternion);
    }
    root.updateMatrixWorld(true);
  }

  function apply() {
    if (disposed) return { error: 'disposed' };
    restore();
    let solvedJointCount = 0;
    if (bones.head && tracking.head !== 2) {
      const baseline = baselines.get(bones.head);
      const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(-state.headPitch * 35),
        THREE.MathUtils.degToRad(state.headYaw * 55),
        0,
        'YXZ'
      ));
      bones.head.quaternion.copy(baseline.quaternion).multiply(delta).normalize();
    }
    if (bones.hips && state.crouch > 0 && tracking.hip !== 2) {
      const baseline = baselines.get(bones.hips);
      const legLength = worldBaseline.leftFoot.distanceTo(worldPosition(bones.hips));
      bones.hips.position.copy(baseline.position);
      bones.hips.position.y -= Math.max(0.01, legLength) * 0.28 * state.crouch;
      root.updateMatrixWorld(true);
      if (tracking.leftFoot !== 2) solvedJointCount += solveCcd(root, [bones.leftLowerLeg, bones.leftUpperLeg], bones.leftFoot, worldBaseline.leftFoot);
      if (tracking.rightFoot !== 2) solvedJointCount += solveCcd(root, [bones.rightLowerLeg, bones.rightUpperLeg], bones.rightFoot, worldBaseline.rightFoot);
    }
    if (state.handReach > 0) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
      const leftLength = worldBaseline.leftHand.distanceTo(worldPosition(bones.leftUpperArm));
      const rightLength = worldBaseline.rightHand.distanceTo(worldPosition(bones.rightUpperArm));
      const leftTarget = worldBaseline.leftHand.clone().addScaledVector(forward, leftLength * 0.65 * state.handReach);
      const rightTarget = worldBaseline.rightHand.clone().addScaledVector(forward, rightLength * 0.65 * state.handReach);
      if (tracking.leftHand !== 2) solvedJointCount += solveCcd(root, [bones.leftLowerArm, bones.leftUpperArm], bones.leftHand, leftTarget);
      if (tracking.rightHand !== 2) solvedJointCount += solveCcd(root, [bones.rightLowerArm, bones.rightUpperArm], bones.rightHand, rightTarget);
    }
    root.updateMatrixWorld(true);
    invalidate(100);
    return { ...state, solvedJointCount };
  }

  function setPose(next = {}) {
    for (const key of Object.keys(state)) {
      if (Number.isFinite(Number(next[key]))) state[key] = THREE.MathUtils.clamp(Number(next[key]), key.startsWith('head') ? -1 : 0, 1);
    }
    return apply();
  }

  function setTracking(next = {}) {
    for (const key of Object.keys(tracking)) {
      const value = Number(next[key]) || 0;
      if (value) tracking[key] = value;
    }
    return apply();
  }

  function dispose() {
    if (disposed) return;
    restore();
    disposed = true;
    invalidate();
  }

  return {
    setPose,
    setTracking,
    reset: () => setPose({ headYaw: 0, headPitch: 0, handReach: 0, crouch: 0 }),
    dispose,
    state: () => ({ ...state, tracking: { ...tracking } }),
    stats: () => ({
      boneCount: Object.values(bones).filter(Boolean).length,
      armChainCount: Number(Boolean(bones.leftUpperArm && bones.leftLowerArm && bones.leftHand)) + Number(Boolean(bones.rightUpperArm && bones.rightLowerArm && bones.rightHand)),
      legChainCount: Number(Boolean(bones.leftUpperLeg && bones.leftLowerLeg && bones.leftFoot)) + Number(Boolean(bones.rightUpperLeg && bones.rightLowerLeg && bones.rightFoot)),
      hasHead: Boolean(bones.head),
    }),
  };
}
