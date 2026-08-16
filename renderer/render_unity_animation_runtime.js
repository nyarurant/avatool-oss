import * as THREE from './vendor/three/three.module.js';

const DEG = THREE.MathUtils.degToRad;

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function buildResolver(root) {
  const rows = [];
  const exact = new Map();
  root.traverse((object) => {
    const names = [];
    let current = object;
    while (current && current !== root) {
      names.unshift(String(current.name || ''));
      current = current.parent;
    }
    const path = normalizePath(names.join('/'));
    const row = { object, path, normalizedPath: normalized(path), leaf: normalized(object.name) };
    rows.push(row);
    if (path) {
      if (!exact.has(path)) exact.set(path, []);
      exact.get(path).push(object);
    }
  });
  return {
    path(value) {
      const wanted = normalizePath(value);
      if (!wanted) return root;
      const direct = exact.get(wanted);
      if (direct?.length) return direct[0];
      const normalizedWanted = normalized(wanted);
      const leaf = normalized(wanted.split('/').at(-1));
      const suffix = rows.filter((row) => row.normalizedPath
        && row.leaf === leaf
        && (
          row.normalizedPath.endsWith(normalizedWanted)
          || normalizedWanted.endsWith(row.normalizedPath)
        ));
      if (suffix.length) return suffix.sort((a, b) => b.normalizedPath.length - a.normalizedPath.length)[0].object;
      const leaves = rows.filter((row) => row.leaf === leaf);
      return leaves.length === 1 ? leaves[0].object : null;
    },
    patterns(patterns) {
      for (const pattern of patterns || []) {
        const matches = rows.filter((row) => row.object.isBone && pattern.test(row.leaf));
        if (matches.length) return matches.sort((a, b) => a.leaf.length - b.leaf.length)[0].object;
      }
      return null;
    },
    patternMatches(patterns) {
      return rows
        .filter((row) => row.object.isBone && (patterns || []).some((pattern) => pattern.test(row.leaf)))
        .map((row) => row.object);
    },
  };
}

const HUMAN_PATTERNS = Object.freeze({
  hips: [/^hips?$/, /^pelvis$/],
  spine: [/^spine$/, /^spine1$/],
  chest: [/^chest$/, /^spine2$/],
  upperChest: [/^upperchest$/, /^spine3$/],
  neck: [/^neck$/],
  head: [/^head$/],
  leftShoulder: [/^leftshoulder$/, /^shoulderl$/, /^lshoulder$/],
  rightShoulder: [/^rightshoulder$/, /^shoulderr$/, /^rshoulder$/],
  leftUpperArm: [/^leftupperarm$/, /^upperarml$/, /^lupperarm$/],
  rightUpperArm: [/^rightupperarm$/, /^upperarmr$/, /^rupperarm$/],
  leftLowerArm: [/^leftlowerarm$/, /^lowerarml$/, /^forearml$/, /^lforearm$/],
  rightLowerArm: [/^rightlowerarm$/, /^lowerarmr$/, /^forearmr$/, /^rforearm$/],
  leftHand: [/^lefthand$/, /^handl$/, /^lhand$/],
  rightHand: [/^righthand$/, /^handr$/, /^rhand$/],
  leftUpperLeg: [/^leftupperleg$/, /^upperlegl$/, /^thighl$/, /^lthigh$/],
  rightUpperLeg: [/^rightupperleg$/, /^upperlegr$/, /^thighr$/, /^rthigh$/],
  leftLowerLeg: [/^leftlowerleg$/, /^lowerlegl$/, /^calfl$/, /^lcalf$/],
  rightLowerLeg: [/^rightlowerleg$/, /^lowerlegr$/, /^calfr$/, /^rcalf$/],
  leftFoot: [/^leftfoot$/, /^footl$/, /^lfoot$/],
  rightFoot: [/^rightfoot$/, /^footr$/, /^rfoot$/],
  leftToes: [/^lefttoes?$/, /^toes?l$/, /^ltoes?$/],
  rightToes: [/^righttoes?$/, /^toes?r$/, /^rtoes?$/],
  leftEye: [/^lefteye$/, /^eyel$/, /^leye$/],
  rightEye: [/^righteye$/, /^eyer$/, /^reye$/],
  jaw: [/^jaw$/, /^jawbone$/],
});

function fingerPatterns(side, finger, segment) {
  const s = side === 'left' ? 'l' : 'r';
  const long = side;
  const number = Number(segment);
  const word = ['proximal', 'intermediate', 'distal'][number - 1] || String(number);
  const aliases = finger === 'little' ? '(?:little|pinky)' : finger;
  return [
    new RegExp(`^${long}${aliases}${word}$`),
    new RegExp(`^${aliases}${word}${long}$`),
    new RegExp(`^${aliases}(?:finger)?${number}${s}$`),
    new RegExp(`^${s}${aliases}(?:finger)?${number}$`),
    new RegExp(`^${aliases}${number}${s}$`),
    new RegExp(`^${aliases}${word}${s}$`),
    new RegExp(`^${s}${aliases}${word}$`),
  ];
}

function sampleTime(clip, timeSeconds, reverse, loopOverride) {
  const start = Number(clip?.startTime) || 0;
  const stop = Number(clip?.stopTime) || start;
  let time = Number(timeSeconds);
  if (!Number.isFinite(time)) return NaN;
  if (reverse) time = stop - (time - start);
  const shouldLoop = typeof loopOverride === 'boolean' ? loopOverride : Boolean(clip?.loopTime);
  if (shouldLoop && stop > start) {
    return start + ((((time - start) % (stop - start)) + (stop - start)) % (stop - start));
  }
  return Math.max(start, Math.min(stop, time));
}

function hermite(leftValue, rightValue, leftSlope, rightSlope, duration, t) {
  if (!Number.isFinite(leftSlope) || !Number.isFinite(rightSlope)) return Number(leftValue);
  const t2 = t * t;
  const t3 = t2 * t;
  return (((2 * t3) - (3 * t2) + 1) * Number(leftValue))
    + ((t3 - (2 * t2) + t) * duration * leftSlope)
    + (((-2 * t3) + (3 * t2)) * Number(rightValue))
    + ((t3 - t2) * duration * rightSlope);
}

function sampleScalar(curve, timeSeconds, clip, reverse = false, loopOverride) {
  const keys = Array.isArray(curve?.keyframes) ? curve.keyframes : [];
  if (!keys.length) return NaN;
  const time = sampleTime(clip, timeSeconds, reverse, loopOverride);
  if (!Number.isFinite(time)) return Number(keys.at(-1).value);
  if (time <= Number(keys[0].time)) return Number(keys[0].value);
  if (time >= Number(keys.at(-1).time)) return Number(keys.at(-1).value);
  for (let index = 0; index < keys.length - 1; index += 1) {
    const left = keys[index];
    const right = keys[index + 1];
    if (time < Number(left.time) || time > Number(right.time)) continue;
    const duration = Number(right.time) - Number(left.time);
    if (!(duration > 0)) return Number(right.value);
    return hermite(left.value, right.value, Number(left.outSlope), Number(right.inSlope), duration, (time - Number(left.time)) / duration);
  }
  return Number(keys.at(-1).value);
}

function sampleVector(curve, timeSeconds, clip, reverse = false, loopOverride) {
  const keys = Array.isArray(curve?.keyframes) ? curve.keyframes : [];
  if (!keys.length) return null;
  const time = sampleTime(clip, timeSeconds, reverse, loopOverride);
  const components = ['x', 'y', 'z', 'w'];
  if (!Number.isFinite(time) || time >= Number(keys.at(-1).time)) return { ...keys.at(-1).value };
  if (time <= Number(keys[0].time)) return { ...keys[0].value };
  for (let index = 0; index < keys.length - 1; index += 1) {
    const left = keys[index];
    const right = keys[index + 1];
    if (time < Number(left.time) || time > Number(right.time)) continue;
    const duration = Number(right.time) - Number(left.time);
    if (!(duration > 0)) return { ...right.value };
    const t = (time - Number(left.time)) / duration;
    const value = {};
    for (const key of components) {
      if (!Number.isFinite(Number(left.value?.[key])) || !Number.isFinite(Number(right.value?.[key]))) continue;
      value[key] = hermite(
        left.value[key],
        right.value[key],
        Number(left.outSlope?.[key]),
        Number(right.inSlope?.[key]),
        duration,
        t
      );
    }
    return value;
  }
  return { ...keys.at(-1).value };
}

function addComponent(group, key, component, value, weight) {
  if (!group[key]) group[key] = {};
  if (!group[key][component]) group[key][component] = { value: 0, weight: 0 };
  group[key][component].value += value * weight;
  group[key][component].weight += weight;
}

function addSourcedComponent(group, key, component, value, weight, source) {
  if (!group[key]) group[key] = {};
  if (!group[key][component]) group[key][component] = { sources: new Map() };
  const row = group[key][component];
  const current = row.sources.get(source) || { value: 0, weight };
  current.value += value;
  current.weight = weight;
  row.sources.set(source, current);
}

function addVector(group, key, value, weight) {
  for (const component of ['x', 'y', 'z', 'w']) {
    if (Number.isFinite(Number(value?.[component]))) addComponent(group, key, component, Number(value[component]), weight);
  }
}

function averaged(group, fallback) {
  const result = { ...fallback };
  for (const component of ['x', 'y', 'z', 'w']) {
    const row = group?.[component];
    if (row?.weight > 0) result[component] = row.value / row.weight;
  }
  return result;
}

function averagedSourced(group, fallback) {
  const result = { ...fallback };
  for (const component of ['x', 'y', 'z', 'w']) {
    const sources = group?.[component]?.sources;
    if (!(sources instanceof Map) || !sources.size) continue;
    let value = 0;
    let weight = 0;
    for (const source of sources.values()) {
      value += source.value * source.weight;
      weight += source.weight;
    }
    if (weight > 0) result[component] = value / weight;
  }
  return result;
}

function ranged(binding, minDegrees, maxDegrees, sign = 1) {
  // Limits mirror Unity 2022.3 HumanTrait.GetMuscleDefaultMin/Max. The sign
  // only converts Unity humanoid axes into the three.js avatar coordinate basis.
  return { ...binding, minDegrees, maxDegrees, sign };
}

function muscleDegrees(binding, value) {
  const degreesAt = (normalized) => {
    const clamped = THREE.MathUtils.clamp(Number(normalized) || 0, -1, 1);
    const limit = clamped < 0
      ? Math.abs(Number(binding.minDegrees) || 0)
      : Math.abs(Number(binding.maxDegrees) || 0);
    return clamped * limit;
  };
  return (degreesAt(value) - degreesAt(binding.neutralValue)) * (Number(binding.sign) || 1);
}

function muscleBinding(attribute) {
  const text = String(attribute || '');
  const torso = text.match(/^(Spine|Chest|UpperChest) (Front-Back|Left-Right|Twist Left-Right)$/);
  if (torso) {
    const axes = { 'Front-Back': ['x', -1], 'Left-Right': ['z', -1], 'Twist Left-Right': ['y', 1] };
    const limit = torso[1] === 'UpperChest' ? 20 : 40;
    return ranged({ bone: torso[1][0].toLowerCase() + torso[1].slice(1), axis: axes[torso[2]][0] }, -limit, limit, axes[torso[2]][1]);
  }
  const headOrNeck = text.match(/^(Head|Neck) (Nod Down-Up|Tilt Left-Right|Turn Left-Right)$/);
  if (headOrNeck) {
    const axes = { 'Nod Down-Up': ['x', -1], 'Tilt Left-Right': ['z', -1], 'Turn Left-Right': ['y', 1] };
    return ranged({ bone: headOrNeck[1].toLowerCase(), axis: axes[headOrNeck[2]][0] }, -40, 40, axes[headOrNeck[2]][1]);
  }
  const eye = text.match(/^(Left|Right) Eye (Down-Up|In-Out)$/);
  if (eye) {
    const side = eye[1].toLowerCase();
    return ranged(
      { bone: `${side}Eye`, axis: eye[2] === 'Down-Up' ? 'x' : 'y', optional: true },
      eye[2] === 'Down-Up' ? -10 : -20,
      eye[2] === 'Down-Up' ? 15 : 20,
      eye[2] === 'Down-Up' ? 1 : (side === 'left' ? -1 : 1)
    );
  }
  const jaw = text.match(/^Jaw (Close|Left-Right)$/);
  if (jaw) return ranged({ bone: 'jaw', axis: jaw[1] === 'Close' ? 'x' : 'y', optional: true }, -10, 10, jaw[1] === 'Close' ? -1 : 1);
  const shoulder = text.match(/^(Left|Right) Shoulder (Down-Up|Front-Back)$/);
  if (shoulder) {
    return ranged(
      { bone: `${shoulder[1].toLowerCase()}Shoulder`, axis: shoulder[2] === 'Down-Up' ? 'z' : 'y' },
      -15,
      shoulder[2] === 'Down-Up' ? 30 : 15,
      shoulder[1] === 'Left' ? -1 : 1
    );
  }
  const arm = text.match(/^(Left|Right) Arm (Down-Up|Front-Back|Twist In-Out)$/);
  if (arm) {
    const side = arm[1].toLowerCase();
    const axes = {
      'Down-Up': ['z', -60, 100, side === 'left' ? -1 : 1],
      'Front-Back': ['y', -100, 100, side === 'left' ? -1 : 1],
      'Twist In-Out': ['x', -90, 90, -1],
    };
    const row = axes[arm[2]];
    const neutralValue = arm[2] === 'Down-Up' ? 0.4 : arm[2] === 'Front-Back' ? 0.3 : 0;
    return ranged({ bone: `${side}UpperArm`, axis: row[0], neutralValue }, row[1], row[2], row[3]);
  }
  const forearm = text.match(/^(Left|Right) Forearm (Stretch|Twist In-Out)$/);
  if (forearm) {
    const side = forearm[1].toLowerCase();
    // Humanoid "Stretch" is the elbow flexion muscle. +1 is Unity's straight
    // T-pose neutral, while values toward -1 bend the elbow by up to 160 degrees.
    // The previous implementation treated 0 as neutral (then later ignored the
    // curve entirely), which either over-rotated the arm or left every elbow rigid.
    if (forearm[2] === 'Stretch') {
      return ranged({ bone: `${side}LowerArm`, axis: 'y', neutralValue: 1 }, -80, 80, side === 'left' ? -1 : 1);
    }
    return ranged({ bone: `${side}LowerArm`, axis: 'x' }, -90, 90, -1);
  }
  const hand = text.match(/^(Left|Right) Hand (Down-Up|In-Out)$/);
  if (hand) {
    const side = hand[1].toLowerCase();
    return ranged(
      { bone: `${side}Hand`, axis: hand[2] === 'Down-Up' ? 'z' : 'y' },
      hand[2] === 'Down-Up' ? -80 : -40,
      hand[2] === 'Down-Up' ? 80 : 40,
      side === 'left' ? -1 : 1
    );
  }
  const upperLeg = text.match(/^(Left|Right) Upper Leg (Front-Back|In-Out|Twist In-Out)$/);
  if (upperLeg) {
    const side = upperLeg[1].toLowerCase();
    const axes = {
      'Front-Back': ['x', -90, 50, 1],
      'In-Out': ['z', -60, 60, side === 'left' ? -1 : 1],
      'Twist In-Out': ['y', -60, 60, side === 'left' ? -1 : 1],
    };
    const row = axes[upperLeg[2]];
    return ranged({
      bone: `${side}UpperLeg`,
      axis: row[0],
      neutralValue: upperLeg[2] === 'Front-Back' ? 0.6 : 0,
    }, row[1], row[2], row[3]);
  }
  const lowerLeg = text.match(/^(Left|Right) Lower Leg (Stretch|Twist In-Out)$/);
  if (lowerLeg) {
    const side = lowerLeg[1].toLowerCase();
    // Lower Leg Stretch is knee flexion with the same +1 straight-pose neutral.
    if (lowerLeg[2] === 'Stretch') {
      return ranged({ bone: `${side}LowerLeg`, axis: 'x', neutralValue: 1, localAxis: true }, -80, 80, -1);
    }
    return ranged({ bone: `${side}LowerLeg`, axis: 'y' }, -90, 90, side === 'left' ? -1 : 1);
  }
  const foot = text.match(/^(Left|Right) Foot (Up-Down|Twist In-Out)$/);
  if (foot) {
    const side = foot[1].toLowerCase();
    return ranged(
      { bone: `${side}Foot`, axis: foot[2] === 'Up-Down' ? 'x' : 'z' },
      foot[2] === 'Up-Down' ? -50 : -30,
      foot[2] === 'Up-Down' ? 50 : 30,
      foot[2] === 'Up-Down' ? 1 : (side === 'left' ? -1 : 1)
    );
  }
  const toes = text.match(/^(Left|Right) Toes Up-Down$/);
  if (toes) return ranged({ bone: `${toes[1].toLowerCase()}Toes`, axis: 'x' }, -50, 50);
  const finger = text.match(/^(Left|Right)Hand\.(Thumb|Index|Middle|Ring|Little)\.(?:(1|2|3) )?(Stretched|Spread)$/);
  if (finger) {
    const side = finger[1].toLowerCase();
    const name = finger[2].toLowerCase();
    const segment = Number(finger[3]) || 1;
    const action = finger[4];
    let min = -45;
    let max = 45;
    if (action === 'Spread') {
      const spread = name === 'thumb' ? 25 : ((name === 'middle' || name === 'ring') ? 7.5 : 20);
      min = -spread;
      max = spread;
    } else if (name === 'thumb') {
      min = segment === 1 ? -20 : -40;
      max = segment === 1 ? 20 : 35;
    } else if (segment === 1) {
      min = -50;
      max = 50;
    }
    const neutralByFinger = {
      thumb: { stretched: [-0.72, 0.64, 0.64], spread: 0.39 },
      index: { stretched: [0.67, 0.81, 0.81], spread: -0.46 },
      middle: { stretched: [0.67, 0.81, 0.81], spread: -0.60 },
      ring: { stretched: [0.67, 0.81, 0.81], spread: -0.66 },
      little: { stretched: [0.66, 0.81, 0.81], spread: -0.49 },
    };
    const neutral = neutralByFinger[name];
    const neutralValue = action === 'Spread' ? neutral.spread : neutral.stretched[segment - 1];
    return ranged({
      finger: { side, name, segment },
      axis: action === 'Spread' ? 'z' : (name === 'thumb' ? 'z' : 'x'),
      neutralValue,
    }, min, max, action === 'Spread' ? (side === 'left' ? -1 : 1) : -1);
  }
  return null;
}

function unityQuaternion(value) {
  return new THREE.Quaternion(
    -(Number(value?.x) || 0),
    -(Number(value?.y) || 0),
    Number(value?.z) || 0,
    Number.isFinite(Number(value?.w)) ? Number(value.w) : 1
  ).normalize();
}

function unityEuler(value) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    DEG(Number(value?.x) || 0), DEG(Number(value?.y) || 0), DEG(Number(value?.z) || 0), 'ZXY'
  ));
  return new THREE.Quaternion(-q.x, -q.y, q.z, q.w).normalize();
}

export function createUnityAnimationRuntime({ root, invalidate = () => {} } = {}) {
  const resolve = buildResolver(root);
  const baselines = new Map();
  const humanBones = new Map();
  const avatarAxes = new Map();
  const exactHumanBones = new Map();
  let disposed = false;

  function humanBone(binding) {
    const key = binding.bone || `${binding.finger.side}:${binding.finger.name}:${binding.finger.segment}`;
    if (humanBones.has(key)) return humanBones.get(key);
    const patterns = binding.bone ? HUMAN_PATTERNS[binding.bone] : fingerPatterns(binding.finger.side, binding.finger.name, binding.finger.segment);
    let bone = resolve.patterns(patterns);
    const sideMatch = binding.bone?.match(/^(left|right)(.+)$/i);
    const fingerSide = binding.finger?.side;
    const side = sideMatch?.[1]?.toLowerCase() || fingerSide;
    if (side === 'left' || side === 'right') {
      const counterpartKey = sideMatch
        ? `${side === 'left' ? 'right' : 'left'}${sideMatch[2]}`
        : null;
      const counterpartPatterns = counterpartKey
        ? HUMAN_PATTERNS[counterpartKey]
        : fingerPatterns(side === 'left' ? 'right' : 'left', binding.finger.name, binding.finger.segment);
      const counterpart = counterpartPatterns ? resolve.patterns(counterpartPatterns) : null;
      const candidates = [...new Set([bone, counterpart].filter(Boolean))];
      if (candidates.length > 1) {
        root.updateMatrixWorld(true);
        candidates.sort((left, right) => {
          const leftX = root.worldToLocal(left.getWorldPosition(new THREE.Vector3())).x;
          const rightX = root.worldToLocal(right.getWorldPosition(new THREE.Vector3())).x;
          return leftX - rightX;
        });
        // Unity Humanoid defines Left on the avatar's negative-X side. Some FBX
        // exporters label that hierarchy with an R suffix, so spatial anatomy is
        // authoritative and the source name is only a candidate lookup hint.
        bone = side === 'left' ? candidates[0] : candidates.at(-1);
      }
    }
    if (!bone && binding.bone === 'upperChest') bone = humanBone({ bone: 'chest' });
    humanBones.set(key, bone || null);
    return bone;
  }

  function bindingFromHumanBoneName(value) {
    const name = String(value || '');
    const direct = name.charAt(0).toLowerCase() + name.slice(1);
    if (HUMAN_PATTERNS[direct]) return { bone: direct };
    const finger = name.match(/^(Left|Right)(Thumb|Index|Middle|Ring|Little)(Proximal|Intermediate|Distal)$/);
    if (!finger) return null;
    return {
      finger: {
        side: finger[1].toLowerCase(),
        name: finger[2].toLowerCase(),
        segment: ['Proximal', 'Intermediate', 'Distal'].indexOf(finger[3]) + 1,
      },
    };
  }

  function resolveHumanBones(humanBoneName) {
    const cacheKey = String(humanBoneName || '');
    if (exactHumanBones.has(cacheKey)) return exactHumanBones.get(cacheKey);
    const binding = bindingFromHumanBoneName(cacheKey);
    if (!binding) return [];
    const patterns = binding.bone
      ? HUMAN_PATTERNS[binding.bone]
      : fingerPatterns(binding.finger.side, binding.finger.name, binding.finger.segment);
    const sideMatch = binding.bone?.match(/^(left|right)(.+)$/i);
    const side = sideMatch?.[1]?.toLowerCase() || binding.finger?.side;
    let candidates = resolve.patternMatches(patterns);
    if (side === 'left' || side === 'right') {
      const counterpartPatterns = sideMatch
        ? HUMAN_PATTERNS[`${side === 'left' ? 'right' : 'left'}${sideMatch[2]}`]
        : fingerPatterns(side === 'left' ? 'right' : 'left', binding.finger.name, binding.finger.segment);
      candidates = [...new Set([...candidates, ...resolve.patternMatches(counterpartPatterns)])];
      if (candidates.length) {
        root.updateMatrixWorld(true);
        const rows = candidates.map((object) => ({
          object,
          x: root.worldToLocal(object.getWorldPosition(new THREE.Vector3())).x,
        }));
        const targetX = side === 'left'
          ? Math.min(...rows.map((row) => row.x))
          : Math.max(...rows.map((row) => row.x));
        const tolerance = Math.max(1e-5, Math.abs(targetX) * 1e-3);
        candidates = rows.filter((row) => Math.abs(row.x - targetX) <= tolerance).map((row) => row.object);
      }
    }
    if (!candidates.length && binding.bone === 'upperChest') candidates = resolveHumanBones('Chest');
    const result = [...new Set(candidates)];
    exactHumanBones.set(cacheKey, result);
    return result;
  }

  function remember(object) {
    if (!baselines.has(object)) {
      baselines.set(object, {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      });
    }
    return baselines.get(object);
  }

  function avatarLocalAxes(object) {
    if (avatarAxes.has(object)) return avatarAxes.get(object);
    root.updateMatrixWorld(true);
    const rootWorld = root.getWorldQuaternion(new THREE.Quaternion());
    const inverseObjectWorld = object.getWorldQuaternion(new THREE.Quaternion()).invert();
    const axes = {};
    for (const [name, vector] of Object.entries({
      x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, 1, 0),
      z: new THREE.Vector3(0, 0, 1),
    })) {
      axes[name] = vector.applyQuaternion(rootWorld).applyQuaternion(inverseObjectWorld).normalize();
    }
    avatarAxes.set(object, axes);
    return axes;
  }

  function reset() {
    for (const [object, baseline] of baselines) {
      object.position.copy(baseline.position);
      object.quaternion.copy(baseline.quaternion);
      object.scale.copy(baseline.scale);
    }
    baselines.clear();
    root.updateMatrixWorld(true);
    invalidate();
  }

  function apply(entries) {
    if (disposed) return { error: 'disposed' };
    reset();
    const poses = new Map();
    const stats = {
      transformCount: 0,
      muscleCount: 0,
      ignoredCurveCount: 0,
      unresolvedTransformCount: 0,
      unresolvedAttributes: [],
    };
    const pose = (object) => {
      if (!poses.has(object)) poses.set(object, { position: {}, rotation: {}, euler: {}, scale: {}, muscle: {}, localMuscle: {} });
      return poses.get(object);
    };
    const sourceEntries = Array.isArray(entries) ? entries : [];
    for (let sourceIndex = 0; sourceIndex < sourceEntries.length; sourceIndex += 1) {
      const entry = sourceEntries[sourceIndex];
      const clip = entry?.clip || entry;
      const weight = Math.max(0, Number(entry?.clip ? entry.weight : 1) || 0);
      let time = entry?.clip ? Number(entry.time) : NaN;
      if (entry?.normalizedTime && Number.isFinite(time)) {
        const start = Number(clip?.startTime) || 0;
        const stop = Number(clip?.stopTime) || start;
        time = start + Math.max(0, Math.min(1, time)) * Math.max(0, stop - start);
      }
      if (!clip || weight <= 0) continue;
      const loopOverride = typeof entry?.loop === 'boolean' ? entry.loop : undefined;
      for (const [key, channel] of [['positionCurves', 'position'], ['rotationCurves', 'rotation'], ['eulerCurves', 'euler'], ['scaleCurves', 'scale']]) {
        for (const curve of clip[key] || []) {
          const object = resolve.path(curve.path);
          const value = sampleVector(curve, time, clip, Boolean(entry?.reverse), loopOverride);
          if (!object || !value) {
            stats.unresolvedTransformCount += 1;
            continue;
          }
          addVector(pose(object), channel, value, weight);
          stats.transformCount += 1;
        }
      }
      for (const curve of clip.floatCurves || []) {
        const value = sampleScalar(curve, time, clip, Boolean(entry?.reverse), loopOverride);
        if (!Number.isFinite(value)) continue;
        if (Number(curve.classId) === 95) {
          const bodyCurve = String(curve.attribute || '').match(/^Root([TQ])\.([xyzw])$/);
          if (bodyCurve) {
            if (bodyCurve[1] === 'T') {
              // HumanPose RootT is an avatar-space body position, not the FBX Hips
              // localPosition. Applying it to the imported Hips makes the skeleton
              // leave its bind space, so the lightweight preview intentionally plays
              // locomotion in-place while preserving RootQ and all muscle rotation.
              stats.ignoredCurveCount += 1;
              continue;
            }
            // HumanPose RootQ is the avatar-space body orientation. Applying it
            // as an FBX Hips local quaternion destroys that bone's bind rotation
            // and can send skinned vertices out of view. Rotate the model root
            // instead so locomotion stays in-place without corrupting the rig.
            addComponent(pose(root), 'rotation', bodyCurve[2], value, weight);
            stats.transformCount += 1;
            continue;
          }
          const binding = muscleBinding(curve.attribute);
          const object = binding ? humanBone(binding) : null;
          if (!binding) {
            stats.ignoredCurveCount += 1;
            continue;
          }
          if (!object) {
            if (binding.optional) stats.ignoredCurveCount += 1;
            else {
              stats.unresolvedTransformCount += 1;
              stats.unresolvedAttributes.push(curve.attribute);
            }
            continue;
          }
          addSourcedComponent(
            pose(object),
            binding.localAxis ? 'localMuscle' : 'muscle',
            binding.axis,
            muscleDegrees(binding, value),
            weight,
            sourceIndex
          );
          stats.muscleCount += 1;
          continue;
        }
        if (Number(curve.classId) !== 4) continue;
        const match = String(curve.attribute || '').match(/^(?:m_)?(?:Local)?(Position|Rotation|Scale)\.([xyzw])$/i)
          || String(curve.attribute || '').match(/^localEulerAngles(?:Raw|Baked)?\.([xyz])$/i);
        if (!match) continue;
        const object = resolve.path(curve.path);
        if (!object) {
          stats.unresolvedTransformCount += 1;
          continue;
        }
        const isEuler = match.length === 2;
        const channel = isEuler ? 'euler' : match[1].toLowerCase();
        const component = isEuler ? match[1].toLowerCase() : match[2].toLowerCase();
        addComponent(pose(object), channel, component, value, weight);
        stats.transformCount += 1;
      }
    }
    for (const [object, channels] of poses) {
      const baseline = remember(object);
      if (Object.keys(channels.position).length) {
        const value = averaged(channels.position, { x: baseline.position.x, y: baseline.position.y, z: -baseline.position.z });
        object.position.set(Number(value.x) || 0, Number(value.y) || 0, -(Number(value.z) || 0));
      }
      if (Object.keys(channels.scale).length) {
        const value = averaged(channels.scale, baseline.scale);
        object.scale.set(Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0);
      }
      if (Object.keys(channels.rotation).length) {
        const fallback = { x: -baseline.quaternion.x, y: -baseline.quaternion.y, z: baseline.quaternion.z, w: baseline.quaternion.w };
        object.quaternion.copy(unityQuaternion(averaged(channels.rotation, fallback)));
      } else if (Object.keys(channels.euler).length) {
        object.quaternion.copy(unityEuler(averaged(channels.euler, { x: 0, y: 0, z: 0 })));
      }
      if (Object.keys(channels.muscle).length || Object.keys(channels.localMuscle).length) {
        const value = averagedSourced(channels.muscle, { x: 0, y: 0, z: 0 });
        const axes = avatarLocalAxes(object);
        const delta = new THREE.Quaternion();
        for (const axis of ['z', 'x', 'y']) {
          const angle = DEG(Number(value[axis]) || 0);
          if (Math.abs(angle) <= 1e-9) continue;
          delta.multiply(new THREE.Quaternion().setFromAxisAngle(axes[axis], angle));
        }
        const localValue = averagedSourced(channels.localMuscle, { x: 0, y: 0, z: 0 });
        for (const axis of ['z', 'x', 'y']) {
          const angle = DEG(Number(localValue[axis]) || 0);
          if (Math.abs(angle) <= 1e-9) continue;
          const vector = axis === 'x'
            ? new THREE.Vector3(1, 0, 0)
            : axis === 'y'
              ? new THREE.Vector3(0, 1, 0)
              : new THREE.Vector3(0, 0, 1);
          delta.multiply(new THREE.Quaternion().setFromAxisAngle(vector, angle));
        }
        object.quaternion.copy(baseline.quaternion).multiply(delta).normalize();
      }
    }
    root.updateMatrixWorld(true);
    invalidate(100);
    return stats;
  }

  function dispose() {
    if (disposed) return;
    reset();
    avatarAxes.clear();
    disposed = true;
  }

  return { apply, reset, dispose, resolveHumanBones };
}
