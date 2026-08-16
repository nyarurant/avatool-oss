import * as THREE from './vendor/three/three.module.js';

const EPSILON = 1e-6;
const DOWN = new THREE.Vector3(0, -1, 0);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizedPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((part) => part.replace(/\./g, ''))
    .filter(Boolean)
    .join('/')
    .toLowerCase();
}

function compactBoneName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function physBoneWrapperTarget(value) {
  const parts = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
  const leaf = parts.at(-1) || '';
  if (/^(?:pb|physbone)[_. -]/i.test(leaf)) {
    return compactBoneName(leaf.replace(/^(?:pb|physbone)[_. -]+/i, ''));
  }
  if (parts.some((part) => /^(?:pb|physbone)$/i.test(part))) {
    return compactBoneName(leaf);
  }
  return '';
}

function rootAlias(value) {
  return compactBoneName(value)
    .replace(/^kemono/, '')
    .replace(/root$/, '')
    .replace(/01([lr])$/, '$1')
    .replace(/01$/, '');
}

function evaluateCurve(points, t, fallback = 1) {
  const rows = (Array.isArray(points) ? points : [])
    .filter((row) => Number.isFinite(Number(row?.time)) && Number.isFinite(Number(row?.value)))
    .sort((a, b) => Number(a.time) - Number(b.time));
  if (!rows.length) return fallback;
  if (t <= rows[0].time) return Number(rows[0].value);
  if (t >= rows.at(-1).time) return Number(rows.at(-1).value);
  for (let i = 1; i < rows.length; i += 1) {
    const right = rows[i];
    const left = rows[i - 1];
    if (t > right.time) continue;
    const span = Math.max(EPSILON, right.time - left.time);
    const u = (t - left.time) / span;
    const u2 = u * u;
    const u3 = u2 * u;
    const outSlope = Number.isFinite(Number(left.outSlope)) ? Number(left.outSlope) : 0;
    const inSlope = Number.isFinite(Number(right.inSlope)) ? Number(right.inSlope) : 0;
    return ((2 * u3) - (3 * u2) + 1) * left.value
      + (u3 - (2 * u2) + u) * span * outSlope
      + ((-2 * u3) + (3 * u2)) * right.value
      + (u3 - u2) * span * inSlope;
  }
  return fallback;
}

function scaled(component, key, t, min = -Infinity, max = Infinity) {
  const base = Number(component?.[key]) || 0;
  const multiplier = evaluateCurve(component?.curves?.[key], t, 1);
  return clamp(base * multiplier, min, max);
}

function setFromTo(out, from, to) {
  const a = from.clone().normalize();
  const b = to.clone().normalize();
  if (a.lengthSq() < EPSILON || b.lengthSq() < EPSILON) return out.identity();
  return out.setFromUnitVectors(a, b);
}

function clampCone(axis, center, maxRadians, fallbackAxis) {
  const angle = center.angleTo(axis);
  if (!Number.isFinite(angle) || angle <= maxRadians) return axis;
  const normal = new THREE.Vector3().crossVectors(center, axis);
  if (normal.lengthSq() < EPSILON) normal.copy(fallbackAxis);
  normal.normalize();
  return axis.copy(center).applyAxisAngle(normal, maxRadians).normalize();
}

function limitAxes(restDirection, rotation) {
  const rest = restDirection.clone().normalize();
  const fromUp = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), rest);
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(Number(rotation?.x) || 0),
    THREE.MathUtils.degToRad(-(Number(rotation?.y) || 0)),
    THREE.MathUtils.degToRad(-(Number(rotation?.z) || 0)),
    'XYZ'
  );
  const offset = new THREE.Quaternion().setFromEuler(euler);
  const basis = fromUp.multiply(offset);
  return {
    x: new THREE.Vector3(1, 0, 0).applyQuaternion(basis).normalize(),
    y: new THREE.Vector3(0, 1, 0).applyQuaternion(basis).normalize(),
  };
}

function applyAngleLimit(direction, link) {
  const type = Number(link.component.limitType) || 0;
  if (!type) return direction;
  const maxX = THREE.MathUtils.degToRad(scaled(link.component, 'maxAngleX', link.t, 0, 180));
  const maxZ = THREE.MathUtils.degToRad(scaled(link.component, 'maxAngleZ', link.t, 0, 180));
  const center = link.limitY;
  if (type === 1) return clampCone(direction, center, maxX, link.limitX);
  if (type === 2) {
    direction.addScaledVector(link.limitX, -direction.dot(link.limitX)).normalize();
    return clampCone(direction, center, maxX, link.limitX);
  }
  if (type === 3) {
    const z = new THREE.Vector3().crossVectors(link.limitX, link.limitY).normalize();
    const xAngle = Math.atan2(direction.dot(link.limitX), direction.dot(center));
    const zAngle = Math.atan2(direction.dot(z), direction.dot(center));
    const cx = clamp(xAngle, -maxX, maxX);
    const cz = clamp(zAngle, -maxZ, maxZ);
    return direction.copy(center)
      .addScaledVector(link.limitX, Math.tan(cx))
      .addScaledVector(z, Math.tan(cz))
      .normalize();
  }
  return direction;
}

function closestPointOnSegment(point, start, end, out) {
  const segment = end.clone().sub(start);
  const lengthSq = segment.lengthSq();
  const ratio = lengthSq > EPSILON ? clamp(point.clone().sub(start).dot(segment) / lengthSq, 0, 1) : 0;
  return out.copy(start).addScaledVector(segment, ratio);
}

function createObjectResolver(root) {
  const rows = [];
  const exact = new Map();
  const byLeaf = new Map();
  root.traverse((object) => {
    if (!object.isBone) return;
    const names = [];
    let current = object;
    while (current && current !== root) {
      names.unshift(current.name || '');
      current = current.parent;
    }
    const path = normalizedPath(names.join('/'));
    const leaf = normalizedPath(object.name);
    const row = { object, path, leaf, compactLeaf: compactBoneName(object.name) };
    rows.push(row);
    if (!exact.has(path)) exact.set(path, []);
    exact.get(path).push(object);
    if (!byLeaf.has(leaf)) byLeaf.set(leaf, []);
    byLeaf.get(leaf).push(object);
  });

  return (wantedPath) => {
    const wanted = normalizedPath(wantedPath);
    if (!wanted) return null;
    const direct = exact.get(wanted);
    if (direct?.length) return direct[0];
    const leaf = wanted.split('/').at(-1);
    const leafRows = byLeaf.get(leaf) || [];
    if (leafRows.length === 1) return leafRows[0];
    const candidates = rows.filter((row) => (
      row.path.endsWith(`/${wanted}`) || wanted.endsWith(`/${row.path}`)
    ));
    const pathMatch = candidates.find((row) => row.leaf === leaf)?.object || candidates[0]?.object;
    if (pathMatch) return pathMatch;

    // Some avatars keep PhysBone components on prefab-only wrapper objects such
    // as PB_Tail or PB_Bust_R with an empty Root Transform. Those wrappers do
    // not exist in the FBX skeleton loaded by three.js. Resolve only explicit
    // PB_/PhysBone_ names to a conservative root-bone alias.
    const wrapperTarget = physBoneWrapperTarget(wantedPath);
    if (!wrapperTarget) return null;
    const exactAlias = rows.filter((row) => row.compactLeaf === wrapperTarget);
    if (exactAlias.length === 1) return exactAlias[0].object;
    const wantedAlias = rootAlias(wrapperTarget);
    const aliases = rows.filter((row) => (
      rootAlias(row.compactLeaf) === wantedAlias
      && row.object.children.some((child) => child.isBone && child.position.lengthSq() > EPSILON)
    ));
    return aliases.length === 1 ? aliases[0].object : null;
  };
}

function unityVector(value) {
  return new THREE.Vector3(Number(value?.x) || 0, Number(value?.y) || 0, -(Number(value?.z) || 0));
}

function buildCollider(resolveObject, component) {
  const object = resolveObject(component.rootTransformPath || component.objectPath);
  if (!object) return null;
  return { component, object };
}

function colliderWorldShape(row) {
  const { component, object } = row;
  const scale = new THREE.Vector3();
  const worldQuaternion = new THREE.Quaternion();
  object.getWorldScale(scale);
  object.getWorldQuaternion(worldQuaternion);
  const maxScale = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
  const center = unityVector(component.position).applyQuaternion(worldQuaternion).add(object.getWorldPosition(new THREE.Vector3()));
  const offsetRotation = new THREE.Quaternion(
    -(Number(component.rotation?.x) || 0),
    -(Number(component.rotation?.y) || 0),
    Number(component.rotation?.z) || 0,
    Number.isFinite(Number(component.rotation?.w)) ? Number(component.rotation.w) : 1
  ).normalize();
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(offsetRotation).applyQuaternion(worldQuaternion).normalize();
  const radius = Math.max(0, Number(component.radius) || 0) * maxScale;
  const halfLine = Math.max(0, ((Number(component.height) || 0) * 0.5) - (Number(component.radius) || 0)) * maxScale;
  return {
    type: Number(component.shapeType) || 0,
    inside: Boolean(component.insideBounds),
    center,
    axis,
    radius,
    start: center.clone().addScaledVector(axis, -halfLine),
    end: center.clone().addScaledVector(axis, halfLine),
  };
}

function solveCollision(endpoint, boneRadius, collider, scratch) {
  if (collider.type === 2) {
    const distance = endpoint.clone().sub(collider.center).dot(collider.axis) + boneRadius;
    if (distance > 0) endpoint.addScaledVector(collider.axis, -distance);
    return;
  }
  const center = collider.type === 0
    ? scratch.copy(collider.center)
    : closestPointOnSegment(endpoint, collider.start, collider.end, scratch);
  const delta = endpoint.clone().sub(center);
  const distance = delta.length();
  const allowed = collider.inside ? Math.max(0, collider.radius - boneRadius) : collider.radius + boneRadius;
  if (collider.inside) {
    if (distance > allowed) endpoint.copy(center).addScaledVector(delta.normalize(), allowed);
  } else if (distance < allowed) {
    if (distance < EPSILON) delta.set(0, 1, 0);
    endpoint.copy(center).addScaledVector(delta.normalize(), allowed);
  }
}

export function createPhysBoneRuntime({ root, components = [], invalidate = () => {} } = {}) {
  const physBones = components.filter((row) => row?.type === 'physBone' && row.enabled !== false);
  const colliderById = new Map(components.filter((row) => row?.type === 'physBoneCollider')
    .map((row) => [String(row.componentFileId || ''), row]));
  const baselines = new Map();
  const chains = [];
  const claimed = new Set();
  let active = false;
  let elapsed = 0;
  let lastNow = 0;
  let accumulator = 0;
  const fixedStep = 1 / 30;
  const scratchCollision = new THREE.Vector3();
  const resolveObject = createObjectResolver(root);

  function remember(object) {
    if (!object || baselines.has(object)) return;
    baselines.set(object, {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
    });
  }

  function usableChildren(object, ignored) {
    return object.children.filter((child) => child.isBone && !ignored.has(child));
  }

  for (const component of physBones) {
    const chainRoot = resolveObject(component.rootTransformPath || component.objectPath);
    if (!chainRoot || claimed.has(chainRoot)) continue;
    const ignored = new Set((component.ignoreTransformPaths || []).map((path) => resolveObject(path)).filter(Boolean));
    const endpoint = unityVector(component.endpointPosition);
    const colliders = (component.colliderComponentFileIds || [])
      .map((id) => colliderById.get(String(id)))
      .map((row) => row && buildCollider(resolveObject, row))
      .filter(Boolean);
    const candidates = [];
    const visited = new Set();
    function collect(bone, depth = 0) {
      if (!bone || visited.has(bone) || visited.size >= 512) return;
      visited.add(bone);
      // FBXLoader may attach zero-length duplicate skeleton nodes to the visible
      // hierarchy. They are not Unity child bones and must not become PhysBone links.
      const children = usableChildren(bone, ignored)
        .filter((child) => child.position.lengthSq() > EPSILON);
      let child = null;
      let restVector = null;
      if (children.length === 1 || (children.length > 1 && Number(component.multiChildType) === 1)) {
        [child] = children;
        restVector = child.position.clone();
      } else if (children.length > 1 && Number(component.multiChildType) === 2) {
        restVector = children.reduce((sum, row) => sum.add(row.position), new THREE.Vector3())
          .multiplyScalar(1 / children.length);
      } else if (!children.length && endpoint.lengthSq() >= EPSILON) {
        restVector = endpoint.clone();
      }
      if (restVector?.lengthSq() >= EPSILON) candidates.push({ bone, child, restVector, depth });
      for (const row of children) collect(row, depth + 1);
    }
    collect(chainRoot);
    if (!candidates.length) continue;
    const maxDepth = Math.max(1, ...candidates.map((row) => row.depth));
    const links = [];
    for (const candidate of candidates) {
      const { bone, child, restVector, depth } = candidate;
      if (!bone || claimed.has(bone)) continue;
      remember(bone);
      if (child) remember(child);
      claimed.add(bone);
      const t = depth / maxDepth;
      const axes = limitAxes(restVector, component.limitRotation);
      links.push({
        bone,
        child,
        component,
        t,
        restVector,
        restDirection: restVector.clone().normalize(),
        restLength: restVector.length(),
        restQuaternion: bone.quaternion.clone(),
        limitX: axes.x,
        limitY: axes.y,
        endpoint: new THREE.Vector3(),
        previousEndpoint: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        initialized: false,
      });
    }
    if (links.length) chains.push({ component, links, colliders });
  }

  function restorePose() {
    for (const [object, baseline] of baselines) {
      object.position.copy(baseline.position);
      object.quaternion.copy(baseline.quaternion);
    }
    root?.updateMatrixWorld?.(true);
  }

  function windOffset() {
    const gust = 0.72 + Math.sin((elapsed * 0.31) + 1.4) * 0.28;
    return new THREE.Vector3(
      (Math.sin(elapsed * 1.17) + Math.sin((elapsed * 2.73) + 0.8) * 0.35) * 0.0025 * gust,
      0,
      -Math.sin((elapsed * 0.79) + 1.1) * 0.0012 * gust
    );
  }

  function simulate(dt) {
    elapsed += dt;
    restorePose();
    const wind = windOffset();
    for (const chain of chains) {
      const worldColliders = chain.colliders.map(colliderWorldShape);
      for (const link of chain.links) {
        const begin = link.bone.getWorldPosition(new THREE.Vector3());
        const restEnd = link.restVector.clone().applyMatrix4(link.bone.matrixWorld).add(wind);
        if (!link.initialized) {
          link.endpoint.copy(restEnd).sub(wind);
          link.previousEndpoint.copy(link.endpoint);
          link.initialized = true;
        }
        const previousVector = link.endpoint.clone().sub(begin);
        let poseVector = restEnd.clone().sub(begin);
        const gravity = scaled(link.component, 'gravity', link.t, -1, 1);
        if (Math.abs(gravity) > EPSILON) {
          const gravityStrength = Math.abs(gravity);
          const gravityDirection = DOWN.clone().multiplyScalar(Math.sign(gravity));
          poseVector.lerp(gravityDirection.setLength(poseVector.length()), gravityStrength).normalize()
            .multiplyScalar(restEnd.distanceTo(begin));
        }
        const poseEnd = begin.clone().add(poseVector);
        const pull = scaled(link.component, 'pull', link.t, 0, 1);
        const spring = scaled(link.component, 'spring', link.t, 0, 1);
        const stiffness = scaled(link.component, 'stiffness', link.t, 0, 1);
        const nextVelocity = new THREE.Vector3();
        if (Number(link.component.integrationType) === 0) {
          nextVelocity.copy(poseEnd).sub(link.endpoint).multiplyScalar(pull);
          nextVelocity.lerp(link.velocity, clamp(spring * 0.99, 0, 0.99));
        } else {
          nextVelocity.copy(link.velocity).multiplyScalar(spring);
          nextVelocity.add(poseEnd.clone().sub(link.endpoint.clone().add(nextVelocity)).multiplyScalar(pull));
          nextVelocity.add(previousVector.clone().sub(link.endpoint.clone().add(nextVelocity).sub(begin)).multiplyScalar(stiffness));
        }
        link.previousEndpoint.copy(link.endpoint);
        link.endpoint.add(nextVelocity);
        const maxStretch = scaled(link.component, 'maxStretch', link.t, 0, 4);
        const maxSquish = scaled(link.component, 'maxSquish', link.t, 0, 1);
        const minLength = link.restLength * (1 - maxSquish);
        const maxLength = link.restLength * (1 + maxStretch);
        const direction = link.endpoint.clone().sub(begin);
        const length = clamp(direction.length(), Math.max(EPSILON, minLength), Math.max(EPSILON, maxLength));
        if (direction.lengthSq() < EPSILON) direction.copy(link.restDirection);
        link.endpoint.copy(begin).add(direction.normalize().multiplyScalar(length));
        const radius = scaled(link.component, 'radius', link.t, 0, 10);
        for (const collider of worldColliders) solveCollision(link.endpoint, radius, collider, scratchCollision);
        const localEndpoint = link.bone.worldToLocal(link.endpoint.clone());
        const localLength = clamp(localEndpoint.length() || link.restLength, Math.max(EPSILON, minLength), Math.max(EPSILON, maxLength));
        const limited = applyAngleLimit(localEndpoint.normalize(), link);
        if (link.child) link.child.position.copy(link.restDirection).multiplyScalar(localLength);
        const delta = setFromTo(new THREE.Quaternion(), link.restDirection, limited);
        link.bone.quaternion.copy(link.restQuaternion).multiply(delta);
        link.bone.updateMatrixWorld(true);
        link.endpoint.copy(link.child
          ? link.child.getWorldPosition(new THREE.Vector3())
          : link.restDirection.clone().multiplyScalar(localLength).applyMatrix4(link.bone.matrixWorld));
        link.velocity.copy(link.endpoint).sub(link.previousEndpoint);
      }
    }
  }

  function start() {
    active = chains.length > 0;
    lastNow = 0;
    accumulator = 0;
    invalidate(1000);
    return { ok: active, chainCount: chains.length, boneCount: claimed.size };
  }

  function stop() {
    active = false;
    restorePose();
    invalidate(1000);
    return { ok: true };
  }

  function update(now) {
    if (!active) return false;
    if (!lastNow) lastNow = now;
    const frameSeconds = clamp((now - lastNow) / 1000, 0, 0.1);
    lastNow = now;
    accumulator = Math.min(0.2, accumulator + frameSeconds);
    let simulated = false;
    while (accumulator >= fixedStep) {
      simulate(fixedStep);
      accumulator -= fixedStep;
      simulated = true;
    }
    if (simulated) invalidate();
    return simulated;
  }

  function dispose() {
    stop();
    baselines.clear();
    chains.length = 0;
  }

  return {
    start,
    stop,
    update,
    dispose,
    isActive: () => active,
    stats: () => ({ chainCount: chains.length, boneCount: claimed.size }),
  };
}
