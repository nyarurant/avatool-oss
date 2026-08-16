import * as THREE from './vendor/three/three.module.js';

const EPSILON = 1e-7;
const CONSTRAINT_TYPES = new Set([
  'positionConstraint',
  'rotationConstraint',
  'scaleConstraint',
  'parentConstraint',
  'aimConstraint',
  'lookAtConstraint',
]);

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function normalizedPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((part) => part.replace(/\./g, ''))
    .filter(Boolean)
    .join('/');
}

function createResolver(root) {
  const rows = [];
  const exact = new Map();
  root.traverse((object) => {
    const names = [];
    let current = object;
    while (current && current !== root) {
      names.unshift(current.name || '');
      current = current.parent;
    }
    const path = normalizedPath(names.join('/'));
    if (!path) return;
    const row = { object, path, leaf: normalizedPath(object.name) };
    rows.push(row);
    if (!exact.has(path)) exact.set(path, []);
    exact.get(path).push(object);
  });
  return (wantedPath) => {
    const wanted = normalizedPath(wantedPath);
    if (!wanted) return null;
    const direct = exact.get(wanted);
    if (direct?.length) return direct[0];
    const leaf = wanted.split('/').at(-1);
    const candidates = rows.filter((row) => (
      row.path.endsWith(`/${wanted}`) || wanted.endsWith(`/${row.path}`)
    ));
    if (candidates.length) return candidates.find((row) => row.leaf === leaf)?.object || candidates[0].object;
    const leaves = rows.filter((row) => row.leaf === leaf);
    return leaves.length === 1 ? leaves[0].object : null;
  };
}

function unityVector(value, fallback = 0) {
  return new THREE.Vector3(
    Number.isFinite(Number(value?.x)) ? Number(value.x) : fallback,
    Number.isFinite(Number(value?.y)) ? Number(value.y) : fallback,
    Number.isFinite(Number(value?.z)) ? -Number(value.z) : fallback
  );
}

function unityScale(value) {
  return new THREE.Vector3(
    Number.isFinite(Number(value?.x)) ? Number(value.x) : 1,
    Number.isFinite(Number(value?.y)) ? Number(value.y) : 1,
    Number.isFinite(Number(value?.z)) ? Number(value.z) : 1
  );
}

function unityEuler(value) {
  const unity = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(Number(value?.x) || 0),
    THREE.MathUtils.degToRad(Number(value?.y) || 0),
    THREE.MathUtils.degToRad(Number(value?.z) || 0),
    'ZXY'
  ));
  return new THREE.Quaternion(-unity.x, -unity.y, unity.z, unity.w).normalize();
}

function worldToLocalPosition(object, worldPosition) {
  return object.parent ? object.parent.worldToLocal(worldPosition.clone()) : worldPosition.clone();
}

function worldToLocalQuaternion(object, worldQuaternion) {
  if (!object.parent) return worldQuaternion.clone();
  const parentWorld = object.parent.getWorldQuaternion(new THREE.Quaternion());
  return parentWorld.invert().multiply(worldQuaternion).normalize();
}

function weightedQuaternion(rows, localSpace) {
  let result = null;
  let accumulated = 0;
  for (const row of rows) {
    const weight = Math.max(0, Number(row.weight) || 0);
    if (weight <= 0) continue;
    const quaternion = localSpace
      ? row.object.quaternion.clone()
      : row.object.getWorldQuaternion(new THREE.Quaternion());
    if (!result) {
      result = quaternion;
      accumulated = weight;
      continue;
    }
    if (result.dot(quaternion) < 0) quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w);
    accumulated += weight;
    result.slerp(quaternion, weight / accumulated);
  }
  return result?.normalize() || null;
}

function maskVector(current, desired, x, y, z) {
  return new THREE.Vector3(x ? desired.x : current.x, y ? desired.y : current.y, z ? desired.z : current.z);
}

function maskQuaternion(current, desired, x, y, z) {
  if (x && y && z) return desired;
  const currentEuler = new THREE.Euler().setFromQuaternion(current, 'ZXY');
  const desiredEuler = new THREE.Euler().setFromQuaternion(desired, 'ZXY');
  currentEuler.x = x ? desiredEuler.x : currentEuler.x;
  currentEuler.y = y ? desiredEuler.y : currentEuler.y;
  currentEuler.z = z ? desiredEuler.z : currentEuler.z;
  return new THREE.Quaternion().setFromEuler(currentEuler).normalize();
}

function averagePosition(sources, localSpace) {
  const result = new THREE.Vector3();
  let total = 0;
  for (const row of sources) {
    const weight = Math.max(0, Number(row.weight) || 0);
    if (weight <= 0) continue;
    result.addScaledVector(
      localSpace ? row.object.position : row.object.getWorldPosition(new THREE.Vector3()),
      weight
    );
    total += weight;
  }
  return total > EPSILON ? result.multiplyScalar(1 / total) : null;
}

function averageScale(sources, localSpace) {
  const result = new THREE.Vector3();
  let total = 0;
  for (const row of sources) {
    const weight = Math.max(0, Number(row.weight) || 0);
    if (weight <= 0) continue;
    const scale = localSpace ? row.object.scale : row.object.getWorldScale(new THREE.Vector3());
    result.addScaledVector(scale, weight);
    total += weight;
  }
  return total > EPSILON ? result.multiplyScalar(1 / total) : null;
}

function lookQuaternion(direction, up) {
  if (direction.lengthSq() < EPSILON) return null;
  const forward = direction.clone().normalize();
  let safeUp = up.clone().normalize();
  if (safeUp.lengthSq() < EPSILON || Math.abs(forward.dot(safeUp)) > 0.9999) {
    safeUp = Math.abs(forward.y) < 0.9999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  }
  const right = new THREE.Vector3().crossVectors(safeUp, forward).normalize();
  const correctedUp = new THREE.Vector3().crossVectors(forward, right).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, correctedUp, forward));
}

function inferSource(target, resolve) {
  const name = String(target?.name || '');
  const side = /(?:_|\.)([LR])$/i.exec(name)?.[1]?.toUpperCase();
  if (/Sleeve.*Upper/i.test(name) && side) return resolve(`UpperArm_${side}`);
  if (/Belt|Waist|Hip/i.test(name)) return resolve('Hips') || resolve('Hip');
  if (/Twist/i.test(name) && target.parent) return target.parent;
  return target?.parent?.isBone ? target.parent : null;
}

export function createConstraintRuntime({ root, components = [], invalidate = () => {} } = {}) {
  const resolve = createResolver(root);
  const baselines = new Map();
  const constraints = [];
  const observed = new Map();
  let dirty = true;

  for (const component of components) {
    if (!CONSTRAINT_TYPES.has(component?.type) || component.enabled === false || component.active === false) continue;
    const target = resolve(component.targetTransformPath || component.objectPath);
    if (!target) continue;
    const sources = (component.sources || []).map((source) => ({
      ...source,
      object: resolve(source.transformPath) || inferSource(target, resolve),
    })).filter((source) => source.object);
    if (!sources.length && !component.freezeToWorld) continue;
    if (!baselines.has(target)) {
      baselines.set(target, {
        position: target.position.clone(),
        quaternion: target.quaternion.clone(),
        scale: target.scale.clone(),
      });
    }
    constraints.push({
      component,
      target,
      sources,
      worldUp: resolve(component.worldUpTransformPath),
      frozenPosition: target.getWorldPosition(new THREE.Vector3()),
      frozenQuaternion: target.getWorldQuaternion(new THREE.Quaternion()),
      frozenScale: target.getWorldScale(new THREE.Vector3()),
    });
  }

  function solve(row) {
    const { component, target, sources } = row;
    const baseline = baselines.get(target);
    const weight = clamp01(component.globalWeight);
    if (!baseline || weight <= 0) return;
    const localSpace = Boolean(component.solveInLocalSpace);
    const currentPosition = target.position.clone();
    const currentQuaternion = target.quaternion.clone();
    const currentScale = target.scale.clone();

    if (component.type === 'positionConstraint' || component.type === 'parentConstraint') {
      let desired = component.freezeToWorld
        ? worldToLocalPosition(target, row.frozenPosition)
        : averagePosition(sources, localSpace);
      if (desired) {
        if (!localSpace) desired = worldToLocalPosition(target, desired);
        if (component.type === 'parentConstraint' && sources.length === 1) {
          const source = sources[0];
          const offset = unityVector(source.parentPositionOffset);
          if (localSpace) desired.add(offset.applyQuaternion(source.object.quaternion));
          else {
            const sourceWorld = source.object.getWorldQuaternion(new THREE.Quaternion());
            desired = worldToLocalPosition(target, source.object.getWorldPosition(new THREE.Vector3()).add(offset.applyQuaternion(sourceWorld)));
          }
        } else {
          desired.add(unityVector(component.positionOffset));
        }
        desired = maskVector(
          currentPosition,
          desired,
          component.affectsPositionX !== false,
          component.affectsPositionY !== false,
          component.affectsPositionZ !== false
        );
        target.position.lerp(desired, weight);
      }
    }

    if (component.type === 'rotationConstraint' || component.type === 'parentConstraint') {
      let desired = component.freezeToWorld
        ? worldToLocalQuaternion(target, row.frozenQuaternion)
        : weightedQuaternion(sources, localSpace);
      if (desired) {
        if (!localSpace) desired = worldToLocalQuaternion(target, desired);
        let offset = component.rotationOffset;
        if (component.type === 'parentConstraint' && sources.length === 1) offset = sources[0].parentRotationOffset;
        desired.multiply(unityEuler(offset));
        desired = maskQuaternion(
          currentQuaternion,
          desired,
          component.affectsRotationX !== false,
          component.affectsRotationY !== false,
          component.affectsRotationZ !== false
        );
        target.quaternion.slerp(desired, weight);
      }
    }

    if (component.type === 'scaleConstraint') {
      let desired = component.freezeToWorld ? row.frozenScale.clone() : averageScale(sources, localSpace);
      if (desired) {
        if (!localSpace && target.parent) desired.divide(target.parent.getWorldScale(new THREE.Vector3()));
        desired.multiply(unityScale(component.scaleOffset));
        desired = maskVector(
          currentScale,
          desired,
          component.affectsScaleX !== false,
          component.affectsScaleY !== false,
          component.affectsScaleZ !== false
        );
        target.scale.lerp(desired, weight);
      }
    }

    if (component.type === 'aimConstraint' || component.type === 'lookAtConstraint') {
      const sourcePosition = averagePosition(sources, false);
      if (sourcePosition) {
        const targetPosition = target.getWorldPosition(new THREE.Vector3());
        const direction = sourcePosition.sub(targetPosition);
        let up = new THREE.Vector3(0, 1, 0);
        if (row.worldUp) {
          if (component.type === 'lookAtConstraint' || Number(component.worldUp) === 1) {
            up = row.worldUp.getWorldPosition(new THREE.Vector3()).sub(targetPosition);
          } else if (Number(component.worldUp) === 2) {
            up = unityVector(component.worldUpVector, 0).applyQuaternion(row.worldUp.getWorldQuaternion(new THREE.Quaternion()));
          }
        } else if (Number(component.worldUp) === 3) {
          up = unityVector(component.worldUpVector, 0);
        } else if (Number(component.worldUp) === 4) {
          up.set(0, 0, 0);
        }
        let desiredWorld = lookQuaternion(direction, up);
        if (desiredWorld) {
          if (component.type === 'aimConstraint') {
            const aimAxis = unityVector(component.aimAxis || { z: 1 }).normalize();
            const upAxis = unityVector(component.upAxis || { y: 1 }).normalize();
            const basis = lookQuaternion(aimAxis, upAxis);
            if (basis) desiredWorld.multiply(basis.invert());
          } else if (Number(component.roll)) {
            desiredWorld.multiply(new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 0, 1),
              THREE.MathUtils.degToRad(-Number(component.roll))
            ));
          }
          desiredWorld.multiply(unityEuler(component.rotationOffset));
          const desired = maskQuaternion(
            currentQuaternion,
            worldToLocalQuaternion(target, desiredWorld),
            component.affectsRotationX !== false,
            component.affectsRotationY !== false,
            component.affectsRotationZ !== false
          );
          target.quaternion.slerp(desired, weight);
        }
      }
    }
    target.updateMatrixWorld(true);
  }

  function update() {
    if (!constraints.length) return false;
    root.updateMatrixWorld(true);
    let changed = dirty;
    const objects = new Set();
    for (const row of constraints) {
      objects.add(row.target);
      for (const source of row.sources) objects.add(source.object);
      if (row.worldUp) objects.add(row.worldUp);
    }
    for (const object of objects) {
      const elements = object.matrixWorld.elements;
      const previous = observed.get(object);
      if (!previous || elements.some((value, index) => Math.abs(value - previous[index]) > EPSILON)) changed = true;
    }
    if (!changed) return false;
    for (const row of constraints) solve(row);
    root.updateMatrixWorld(true);
    for (const object of objects) observed.set(object, [...object.matrixWorld.elements]);
    dirty = false;
    invalidate();
    return true;
  }

  function restore() {
    for (const [target, baseline] of baselines) {
      target.position.copy(baseline.position);
      target.quaternion.copy(baseline.quaternion);
      target.scale.copy(baseline.scale);
    }
    root.updateMatrixWorld(true);
    observed.clear();
    dirty = true;
    invalidate();
  }

  return {
    update,
    restore,
    dispose: restore,
    stats: () => ({ constraintCount: constraints.length, targetCount: baselines.size }),
  };
}
