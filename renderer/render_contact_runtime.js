import * as THREE from './vendor/three/three.module.js';

const EPSILON = 1e-7;

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
  root.traverse((object) => {
    const names = [];
    let current = object;
    while (current && current !== root) {
      names.unshift(current.name || '');
      current = current.parent;
    }
    rows.push({ object, path: normalizedPath(names.join('/')), leaf: normalizedPath(object.name) });
  });
  return (wantedPath) => {
    const wanted = normalizedPath(wantedPath);
    if (!wanted) return null;
    const leaf = wanted.split('/').at(-1);
    const candidates = rows.filter((row) => row.path === wanted || row.path.endsWith(`/${wanted}`) || wanted.endsWith(`/${row.path}`));
    if (candidates.length) return candidates.find((row) => row.leaf === leaf)?.object || candidates[0].object;
    const leaves = rows.filter((row) => row.leaf === leaf);
    return leaves.length === 1 ? leaves[0].object : null;
  };
}

function unityVector(value) {
  return new THREE.Vector3(Number(value?.x) || 0, Number(value?.y) || 0, -(Number(value?.z) || 0));
}

function unityQuaternion(value) {
  return new THREE.Quaternion(
    -(Number(value?.x) || 0),
    -(Number(value?.y) || 0),
    Number(value?.z) || 0,
    Number.isFinite(Number(value?.w)) ? Number(value.w) : 1
  ).normalize();
}

function shapeWorld(row) {
  const { component, object } = row;
  const scale = object.getWorldScale(new THREE.Vector3());
  const rotation = object.getWorldQuaternion(new THREE.Quaternion()).multiply(unityQuaternion(component.rotation));
  const maxScale = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
  const center = unityVector(component.position).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()))
    .add(object.getWorldPosition(new THREE.Vector3()));
  const radius = Math.max(0, Number(component.radius) || 0) * maxScale;
  const height = Math.max(radius * 2, Number(component.height) * maxScale || 0);
  const halfLine = Math.max(0, (height * 0.5) - radius);
  const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation).normalize();
  const size = new THREE.Vector3(
    Math.abs(Number(component.size?.x) || 0),
    Math.abs(Number(component.size?.y) || 0),
    Math.abs(Number(component.size?.z) || 0)
  ).multiply(new THREE.Vector3(
    Math.abs(scale.x),
    Math.abs(scale.y),
    Math.abs(scale.z)
  )).multiplyScalar(0.5);
  const boundingRadius = Number(component.shapeType) === 2 ? size.length() : Math.max(radius, radius + halfLine);
  return {
    type: Number(component.shapeType) || 0,
    center,
    rotation,
    inverseRotation: rotation.clone().invert(),
    radius,
    halfLine,
    axis,
    start: center.clone().addScaledVector(axis, -halfLine),
    end: center.clone().addScaledVector(axis, halfLine),
    halfSize: size,
    boundingRadius,
  };
}

function closestSegment(point, start, end) {
  const segment = end.clone().sub(start);
  const lengthSq = segment.lengthSq();
  const t = lengthSq > EPSILON
    ? Math.max(0, Math.min(1, point.clone().sub(start).dot(segment) / lengthSq))
    : 0;
  return start.clone().addScaledVector(segment, t);
}

function receiverDistance(receiver, sender) {
  if (receiver.type === 1) {
    return sender.center.distanceTo(closestSegment(sender.center, receiver.start, receiver.end))
      - sender.boundingRadius - receiver.radius;
  }
  if (receiver.type === 2) {
    const local = sender.center.clone().sub(receiver.center).applyQuaternion(receiver.inverseRotation);
    const closest = local.clone().clamp(receiver.halfSize.clone().multiplyScalar(-1), receiver.halfSize);
    return local.distanceTo(closest) - sender.boundingRadius;
  }
  return receiver.center.distanceTo(sender.center) - sender.boundingRadius - receiver.radius;
}

function receiverRange(shape) {
  if (shape.type === 1) return Math.max(EPSILON, shape.radius + shape.halfLine);
  if (shape.type === 2) return Math.max(EPSILON, shape.halfSize.length());
  return Math.max(EPSILON, shape.radius);
}

function tagsMatch(a, b) {
  const right = new Set((b || []).slice(0, 16).map(String));
  return (a || []).slice(0, 16).some((tag) => right.has(String(tag)));
}

export function createContactRuntime({ root, components = [], onParameters = () => {} } = {}) {
  const resolve = createResolver(root);
  const senders = components.filter((row) => row?.type === 'contactSender' && row.enabled !== false)
    .map((component) => ({ component, object: resolve(component.rootTransformPath || component.objectPath), previous: null }))
    .filter((row) => row.object);
  const receivers = components.filter((row) => row?.type === 'contactReceiver' && row.enabled !== false && row.parameter)
    .map((component) => ({ component, object: resolve(component.rootTransformPath || component.objectPath), colliding: false, value: 0 }))
    .filter((row) => row.object);
  const values = new Map();
  let lastNow = 0;
  let accumulator = 0;

  function simulate(dt) {
    root.updateMatrixWorld(true);
    const senderShapes = senders.map((row) => {
      const shape = shapeWorld(row);
      const velocity = row.previous ? shape.center.distanceTo(row.previous) / Math.max(EPSILON, dt) : 0;
      row.previous = shape.center.clone();
      return { row, shape, velocity };
    });
    let changed = false;
    for (const receiver of receivers) {
      const component = receiver.component;
      const receiverShape = shapeWorld(receiver);
      let colliding = false;
      let proximity = 0;
      let enterVelocity = 0;
      for (const sender of senderShapes) {
        if (component.allowSelf === false || !tagsMatch(component.collisionTags, sender.row.component.collisionTags)) continue;
        const distance = receiverDistance(receiverShape, sender.shape);
        if (distance > 0) continue;
        colliding = true;
        enterVelocity = Math.max(enterVelocity, sender.velocity);
        proximity = Math.max(proximity, Math.max(0, Math.min(1, -distance / receiverRange(receiverShape))));
      }
      const receiverType = Number(component.receiverType) || 0;
      let next = receiver.value;
      if (receiverType === 0) next = colliding ? 1 : 0;
      else if (receiverType === 1) {
        const entered = colliding && !receiver.colliding && enterVelocity > (Number(component.minVelocity) || 0);
        next = entered ? 1 : THREE.MathUtils.lerp(receiver.value, 0, Math.min(1, 5 * dt));
      } else if (receiverType === 2) next = colliding ? proximity : 0;
      receiver.colliding = colliding;
      receiver.value = next;
      const previous = values.get(component.parameter);
      if (previous == null || Math.abs(previous - next) > 1e-4) {
        values.set(component.parameter, next);
        changed = true;
      }
    }
    if (changed) onParameters(Object.fromEntries(values));
    return changed;
  }

  function update(now) {
    if (!receivers.length || !senders.length) return false;
    if (!lastNow) lastNow = now;
    accumulator += Math.max(0, Math.min(0.1, (now - lastNow) / 1000));
    lastNow = now;
    let changed = false;
    while (accumulator >= 1 / 30) {
      changed = simulate(1 / 30) || changed;
      accumulator -= 1 / 30;
    }
    return changed;
  }

  function reset() {
    for (const receiver of receivers) {
      receiver.colliding = false;
      receiver.value = 0;
    }
    for (const sender of senders) sender.previous = null;
    values.clear();
    onParameters({});
  }

  return {
    update,
    reset,
    dispose: reset,
    values: () => Object.fromEntries(values),
    stats: () => ({ senderCount: senders.length, receiverCount: receivers.length }),
  };
}
