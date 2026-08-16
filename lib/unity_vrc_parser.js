'use strict';

const { parsePrefabDocuments } = require('./unity_prefab_parser');

const VRC_SCRIPT_GUIDS = Object.freeze({
  avatar: '67cc4cb7839cd3741b63733d5adf0442',
  physBone: '2a2c05204084d904aa4945ccff20d8e5',
  contact: '80f1b8067b0760e4bb45023bc2e9de66',
  constraint: '58e2f01a24261a14cb82e6d3399e8b16',
});

const VRC_SCRIPT_FILE_IDS = Object.freeze({
  avatarDescriptor: '542108242',
  expressionMenu: '-340790334',
  expressionParameters: '-1506855854',
  physBone: '1661641543',
  physBoneCollider: '-1631200402',
  contactSender: '-802764141',
  contactReceiver: '-1450912254',
});

function parseYamlScalar(value) {
  const raw = String(value).trim();
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\(?:["\\ntr0]|u[0-9a-fA-F]{4})/g, (escape) => {
      const code = escape[1];
      if (code === 'u') return String.fromCharCode(Number.parseInt(escape.slice(2), 16));
      if (code === '"') return '"';
      if (code === '\\') return '\\';
      if (code === 'n') return '\n';
      if (code === 't') return '\t';
      if (code === 'r') return '\r';
      return '\0';
    });
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

function scalar(body, key, fallback = '') {
  const match = String(body || '').match(new RegExp(`^[ \\t]*${key}:[ \\t]*(.*)$`, 'm'));
  return match ? parseYamlScalar(match[1]) : fallback;
}

function number(body, key, fallback = 0) {
  const value = Number(scalar(body, key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function bool(body, key, fallback = false) {
  return number(body, key, fallback ? 1 : 0) !== 0;
}

function fileId(body, key) {
  return String(body || '').match(new RegExp(`^[ \\t]*${key}:[ \\t]*\\{fileID:[ \\t]*(-?\\d+)`, 'm'))?.[1] || null;
}

function fileIdList(body, key) {
  const source = String(body || '');
  const start = source.search(new RegExp(`^[ \\t]*${key}:[ \\t]*(?:$|\\[)`, 'm'));
  if (start < 0) return [];
  const firstLine = source.slice(start).split(/\r?\n/, 1)[0];
  if (/\[\s*\]\s*$/.test(firstLine)) return [];
  const lines = source.slice(start).split(/\r?\n/).slice(1);
  const values = [];
  for (const line of lines) {
    const match = line.match(/^\s{2,}-\s*\{fileID:\s*(-?\d+)/);
    if (!match) break;
    if (match[1] !== '0') values.push(match[1]);
  }
  return values;
}

function assetReference(body, key) {
  const match = String(body || '').match(new RegExp(
    `^[ \\t]*${key}:[ \\t]*\\{fileID:[ \\t]*(-?\\d+)(?:,[ \\t]*guid:[ \\t]*([a-f0-9]{32}))?`,
    'mi'
  ));
  return match ? { fileId: match[1], guid: match[2]?.toLowerCase() || null } : null;
}

function vector(body, key) {
  const inline = String(body || '').match(new RegExp(`^[ \\t]*${key}:[ \\t]*\\{([^}]*)\\}`, 'm'))?.[1];
  if (!inline) return null;
  const out = {};
  for (const match of inline.matchAll(/([xyzw]):\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/gi)) {
    out[match[1].toLowerCase()] = Number(match[2]);
  }
  return Object.keys(out).length ? out : null;
}

function stringList(body, key) {
  const source = String(body || '');
  const start = source.search(new RegExp(`^[ \\t]*${key}:[ \\t]*$`, 'm'));
  if (start < 0) return [];
  const after = source.slice(start).replace(/^[^\r\n]*(?:\r?\n)?/, '');
  const lines = after.split(/\r?\n/);
  const values = [];
  for (const line of lines) {
    const match = line.match(/^\s{2,}-\s*(.*)$/);
    if (!match) break;
    values.push(parseYamlScalar(match[1]));
  }
  return values;
}

function nestedBlock(body, key) {
  const lines = String(body || '').split(/\r?\n/);
  const keyPattern = new RegExp(`^(\\s*)${key}:[ \\t]*$`);
  const start = lines.findIndex((line) => keyPattern.test(line));
  if (start < 0) return '';
  const baseIndent = lines[start].match(/^\s*/)?.[0].length || 0;
  const out = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && (line.match(/^\s*/)?.[0].length || 0) <= baseIndent) break;
    out.push(line);
  }
  return out.join('\n');
}

function packedInt32List(body, key) {
  const raw = scalar(body, key, '').replace(/\s+/g, '');
  if (!/^(?:[a-f0-9]{8})+$/i.test(raw)) return [];
  const values = [];
  for (let offset = 0; offset < raw.length; offset += 8) {
    const bytes = raw.slice(offset, offset + 8).match(/../g).reverse().join('');
    const unsigned = Number.parseInt(bytes, 16);
    values.push(unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned);
  }
  return values;
}

function parseEyeRotations(body, key) {
  const block = nestedBlock(body, key);
  return {
    linked: bool(block, 'linked', true),
    left: vector(block, 'left'),
    right: vector(block, 'right'),
  };
}

function parseEyelidRotations(body, key) {
  const block = nestedBlock(body, key);
  return {
    upper: parseEyeRotations(block, 'upper'),
    lower: parseEyeRotations(block, 'lower'),
  };
}

function parseCurve(body, key) {
  const source = String(body || '');
  const start = source.search(new RegExp(`^[ \\t]*${key}:[ \\t]*$`, 'm'));
  if (start < 0) return [];
  const tail = source.slice(start).split(/\r?\n/).slice(1);
  const points = [];
  let point = null;
  for (const line of tail) {
    if (/^\s{0,2}\w[^:]*:/.test(line)) break;
    if (/^\s+-\s+serializedVersion:/.test(line)) {
      if (point) points.push(point);
      point = {};
    } else if (point) {
      const match = line.match(/^\s+(time|value|inSlope|outSlope):\s*(-?[\d.e+-]+)/i);
      if (match) point[match[1]] = Number(match[2]);
    }
  }
  if (point) points.push(point);
  return points.filter((row) => Number.isFinite(row.time) || Number.isFinite(row.value));
}

function parseAnimationLayers(body, key) {
  const source = String(body || '');
  const start = source.search(new RegExp(`^[ \\t]*${key}:[ \\t]*$`, 'm'));
  if (start < 0) return [];
  const tail = source.slice(start).split(/\r?\n/).slice(1);
  const rows = [];
  let row = null;
  for (const line of tail) {
    if (/^\s{0,2}\w[^:]*:/.test(line)) break;
    if (/^\s+-\s+isEnabled:/.test(line)) {
      if (row) rows.push(row);
      row = { enabled: /:\s*1\s*$/.test(line) };
      continue;
    }
    if (!row) continue;
    const type = line.match(/^ {4}type:\s*(-?\d+)/);
    if (type) row.type = Number(type[1]);
    const controller = line.match(/^ {4}animatorController:\s*\{fileID:\s*(-?\d+)(?:,\s*guid:\s*([a-f0-9]{32}))?/i);
    if (controller) row.animatorController = { fileId: controller[1], guid: controller[2]?.toLowerCase() || null };
    const mask = line.match(/^ {4}mask:\s*\{fileID:\s*(-?\d+)(?:,\s*guid:\s*([a-f0-9]{32}))?/i);
    if (mask) row.mask = { fileId: mask[1], guid: mask[2]?.toLowerCase() || null };
    const isDefault = line.match(/^ {4}isDefault:\s*([01])/);
    if (isDefault) row.isDefault = isDefault[1] === '1';
  }
  if (row) rows.push(row);
  return rows;
}

function parseConstraintSources(body, objectIndex) {
  const source = String(body || '');
  const start = source.search(/^[ \t]*Sources:[ \t]*$/m);
  if (start < 0) return [];
  const tail = source.slice(start).split(/\r?\n/).slice(1);
  const rows = [];
  let row = null;
  for (const line of tail) {
    if (/^\s{0,2}\w[^:]*:/.test(line)) break;
    const sourceTransform = line.match(/^\s+(?:-\s+)?SourceTransform:\s*\{fileID:\s*(-?\d+)/);
    if (sourceTransform) {
      if (row) rows.push(row);
      row = {
        transformFileId: sourceTransform[1],
        transformPath: objectIndex.transformPath(sourceTransform[1]),
        weight: 1,
        parentPositionOffset: null,
        parentRotationOffset: null,
      };
      continue;
    }
    if (!row) continue;
    const weight = line.match(/^\s+Weight:\s*(-?[\d.e+-]+)/i);
    if (weight) row.weight = Number(weight[1]);
    const parentPositionOffset = line.match(/^\s+ParentPositionOffset:\s*\{([^}]*)\}/);
    if (parentPositionOffset) row.parentPositionOffset = vector(`v: {${parentPositionOffset[1]}}`, 'v');
    const parentRotationOffset = line.match(/^\s+ParentRotationOffset:\s*\{([^}]*)\}/);
    if (parentRotationOffset) row.parentRotationOffset = vector(`v: {${parentRotationOffset[1]}}`, 'v');
  }
  if (row) rows.push(row);
  return rows.filter((row) => row.transformFileId !== '0');
}

function buildObjectIndex(docs, externalTransformPath = null) {
  const gameObjects = new Map();
  const transforms = new Map();
  const componentGameObjects = new Map();
  const transformByGameObject = new Map();
  for (const doc of docs) {
    const componentGameObjectFileId = fileId(doc.body, 'm_GameObject');
    if (componentGameObjectFileId) componentGameObjects.set(doc.fileId, componentGameObjectFileId);
    if (doc.classId === '1') {
      gameObjects.set(doc.fileId, { name: scalar(doc.body, 'm_Name', ''), transformFileId: null });
    } else if (doc.classId === '4' || doc.classId === '224') {
      const gameObjectFileId = fileId(doc.body, 'm_GameObject');
      const row = { gameObjectFileId, parentTransformFileId: fileId(doc.body, 'm_Father') };
      transforms.set(doc.fileId, row);
      if (gameObjectFileId) transformByGameObject.set(gameObjectFileId, doc.fileId);
    }
  }
  for (const [gameObjectFileId, transformFileId] of transformByGameObject) {
    const row = gameObjects.get(gameObjectFileId);
    if (row) row.transformFileId = transformFileId;
  }
  const pathCache = new Map();
  function objectPath(gameObjectFileId, seen = new Set()) {
    if (!gameObjectFileId) return null;
    if (pathCache.has(gameObjectFileId)) return pathCache.get(gameObjectFileId);
    if (seen.has(gameObjectFileId)) return gameObjects.get(gameObjectFileId)?.name || null;
    seen.add(gameObjectFileId);
    const gameObject = gameObjects.get(gameObjectFileId);
    if (!gameObject) return null;
    const transform = transforms.get(gameObject.transformFileId);
    const parentTransform = transform?.parentTransformFileId && transform.parentTransformFileId !== '0'
      ? transforms.get(transform.parentTransformFileId)
      : null;
    const parentPath = parentTransform ? objectPath(parentTransform.gameObjectFileId, seen) : null;
    const value = parentPath ? `${parentPath}/${gameObject.name}` : gameObject.name;
    pathCache.set(gameObjectFileId, value || null);
    return value || null;
  }
  function transformPath(transformFileId) {
    const transform = transforms.get(String(transformFileId || ''));
    if (transform?.gameObjectFileId) return objectPath(transform.gameObjectFileId);
    return typeof externalTransformPath === 'function'
      ? externalTransformPath(String(transformFileId || ''))
      : null;
  }
  function componentPath(componentFileId) {
    return objectPath(componentGameObjects.get(String(componentFileId || '')));
  }
  return { gameObjects, transforms, objectPath, transformPath, componentPath };
}

function componentBase(doc, opts, scriptGuid, scriptFileId, objectIndex) {
  const gameObjectFileId = fileId(doc.body, 'm_GameObject');
  return {
    scriptGuid,
    scriptFileId,
    gameObjectFileId,
    gameObjectName: objectIndex.gameObjects.get(gameObjectFileId)?.name || null,
    objectPath: objectIndex.objectPath(gameObjectFileId),
    componentFileId: doc.fileId || null,
    prefabRelPath: opts.relPath || null,
    enabled: bool(doc.body, 'm_Enabled', true),
  };
}

function parseAvatarDescriptor(doc, opts, base, objectIndex) {
  const eye = nestedBlock(doc.body, 'customEyeLookSettings');
  const eyeMovement = nestedBlock(eye, 'eyeMovement');
  const leftEyeFileId = fileId(eye, 'leftEye');
  const rightEyeFileId = fileId(eye, 'rightEye');
  const jawFileId = fileId(doc.body, 'lipSyncJawBone');
  const visemeMeshFileId = fileId(doc.body, 'VisemeSkinnedMesh');
  const eyelidsMeshFileId = fileId(eye, 'eyelidsSkinnedMesh');
  return {
    ...base,
    type: 'avatarDescriptor',
    viewPosition: vector(doc.body, 'ViewPosition'),
    lipSync: number(doc.body, 'lipSync', 0),
    lipSyncJawBoneFileId: jawFileId,
    lipSyncJawBonePath: objectIndex.transformPath(jawFileId),
    lipSyncJawClosed: vector(doc.body, 'lipSyncJawClosed'),
    lipSyncJawOpen: vector(doc.body, 'lipSyncJawOpen'),
    visemeSkinnedMeshFileId: visemeMeshFileId,
    visemeSkinnedMeshPath: objectIndex.componentPath(visemeMeshFileId),
    mouthOpenBlendShapeName: scalar(doc.body, 'MouthOpenBlendShapeName', ''),
    visemeBlendShapes: stringList(doc.body, 'VisemeBlendShapes'),
    customExpressions: bool(doc.body, 'customExpressions'),
    expressionsMenu: assetReference(doc.body, 'expressionsMenu'),
    expressionParameters: assetReference(doc.body, 'expressionParameters'),
    enableEyeLook: bool(doc.body, 'enableEyeLook'),
    customEyeLook: {
      confidence: number(eyeMovement, 'confidence', 0.5),
      excitement: number(eyeMovement, 'excitement', 0.5),
      leftEyeFileId,
      rightEyeFileId,
      leftEyePath: objectIndex.transformPath(leftEyeFileId),
      rightEyePath: objectIndex.transformPath(rightEyeFileId),
      lookingStraight: parseEyeRotations(eye, 'eyesLookingStraight'),
      lookingUp: parseEyeRotations(eye, 'eyesLookingUp'),
      lookingDown: parseEyeRotations(eye, 'eyesLookingDown'),
      lookingLeft: parseEyeRotations(eye, 'eyesLookingLeft'),
      lookingRight: parseEyeRotations(eye, 'eyesLookingRight'),
      eyelidType: number(eye, 'eyelidType'),
      upperLeftEyelidPath: objectIndex.transformPath(fileId(eye, 'upperLeftEyelid')),
      upperRightEyelidPath: objectIndex.transformPath(fileId(eye, 'upperRightEyelid')),
      lowerLeftEyelidPath: objectIndex.transformPath(fileId(eye, 'lowerLeftEyelid')),
      lowerRightEyelidPath: objectIndex.transformPath(fileId(eye, 'lowerRightEyelid')),
      eyelidsDefault: parseEyelidRotations(eye, 'eyelidsDefault'),
      eyelidsClosed: parseEyelidRotations(eye, 'eyelidsClosed'),
      eyelidsLookingUp: parseEyelidRotations(eye, 'eyelidsLookingUp'),
      eyelidsLookingDown: parseEyelidRotations(eye, 'eyelidsLookingDown'),
      eyelidsSkinnedMeshFileId: eyelidsMeshFileId,
      eyelidsSkinnedMeshPath: objectIndex.componentPath(eyelidsMeshFileId),
      eyelidsBlendshapes: packedInt32List(eye, 'eyelidsBlendshapes'),
    },
    customizeAnimationLayers: bool(doc.body, 'customizeAnimationLayers'),
    baseAnimationLayers: parseAnimationLayers(doc.body, 'baseAnimationLayers'),
    specialAnimationLayers: parseAnimationLayers(doc.body, 'specialAnimationLayers'),
  };
}

function parsePhysBone(doc, opts, base, objectIndex) {
  const body = doc.body;
  const rootTransformFileId = fileId(body, 'rootTransform');
  return {
    ...base,
    type: 'physBone',
    version: number(body, 'version', 1),
    rootTransformFileId,
    rootTransformPath: rootTransformFileId && rootTransformFileId !== '0'
      ? objectIndex.transformPath(rootTransformFileId)
      : base.objectPath,
    ignoreTransformFileIds: fileIdList(body, 'ignoreTransforms'),
    ignoreTransformPaths: fileIdList(body, 'ignoreTransforms').map((id) => objectIndex.transformPath(id)).filter(Boolean),
    endpointPosition: vector(body, 'endpointPosition'),
    integrationType: number(body, 'integrationType'),
    multiChildType: number(body, 'multiChildType'),
    pull: number(body, 'pull'),
    spring: number(body, 'spring'),
    stiffness: number(body, 'stiffness'),
    gravity: number(body, 'gravity'),
    gravityFalloff: number(body, 'gravityFalloff'),
    immobileType: number(body, 'immobileType'),
    immobile: number(body, 'immobile'),
    radius: number(body, 'radius'),
    colliderComponentFileIds: fileIdList(body, 'colliders'),
    limitType: number(body, 'limitType'),
    maxAngleX: number(body, 'maxAngleX'),
    maxAngleZ: number(body, 'maxAngleZ'),
    limitRotation: vector(body, 'limitRotation'),
    allowCollision: bool(body, 'allowCollision', true),
    allowGrabbing: bool(body, 'allowGrabbing', true),
    allowPosing: bool(body, 'allowPosing', true),
    snapToHand: bool(body, 'snapToHand'),
    grabMovement: number(body, 'grabMovement'),
    maxStretch: number(body, 'maxStretch'),
    maxSquish: number(body, 'maxSquish'),
    stretchMotion: number(body, 'stretchMotion'),
    isAnimated: bool(body, 'isAnimated'),
    resetWhenDisabled: bool(body, 'resetWhenDisabled'),
    parameter: scalar(body, 'parameter', ''),
    curves: {
      pull: parseCurve(body, 'pullCurve'),
      spring: parseCurve(body, 'springCurve'),
      stiffness: parseCurve(body, 'stiffnessCurve'),
      gravity: parseCurve(body, 'gravityCurve'),
      gravityFalloff: parseCurve(body, 'gravityFalloffCurve'),
      immobile: parseCurve(body, 'immobileCurve'),
      radius: parseCurve(body, 'radiusCurve'),
      maxAngleX: parseCurve(body, 'maxAngleXCurve'),
      maxAngleZ: parseCurve(body, 'maxAngleZCurve'),
      maxStretch: parseCurve(body, 'maxStretchCurve'),
      maxSquish: parseCurve(body, 'maxSquishCurve'),
      stretchMotion: parseCurve(body, 'stretchMotionCurve'),
    },
  };
}

function parseShapeComponent(doc, opts, base, type, objectIndex) {
  const body = doc.body;
  const rootTransformFileId = fileId(body, 'rootTransform');
  return {
    ...base,
    type,
    rootTransformFileId,
    rootTransformPath: rootTransformFileId && rootTransformFileId !== '0'
      ? objectIndex.transformPath(rootTransformFileId)
      : base.objectPath,
    shapeType: number(body, 'shapeType'),
    insideBounds: bool(body, 'insideBounds'),
    radius: number(body, 'radius'),
    height: number(body, 'height'),
    size: vector(body, 'size'),
    position: vector(body, 'position'),
    rotation: vector(body, 'rotation'),
  };
}

function parseContact(doc, opts, base, type, objectIndex) {
  return {
    ...parseShapeComponent(doc, opts, base, type, objectIndex),
    localOnly: bool(doc.body, 'localOnly'),
    contentTypes: number(doc.body, 'contentTypes', -1),
    collisionTags: stringList(doc.body, 'collisionTags'),
    allowSelf: bool(doc.body, 'allowSelf', true),
    allowOthers: bool(doc.body, 'allowOthers', true),
    useFaceProximity: type === 'contactReceiver' ? bool(doc.body, 'useFaceProximity') : false,
    receiverType: type === 'contactReceiver' ? number(doc.body, 'receiverType') : null,
    parameter: type === 'contactReceiver' ? scalar(doc.body, 'parameter', '') : '',
    minVelocity: type === 'contactReceiver' ? number(doc.body, 'minVelocity') : null,
  };
}

function classifyConstraint(body) {
  if (/^\s*AimAxis:/m.test(body)) return 'aimConstraint';
  if (/^\s*LookAtAxis:/m.test(body)) return 'lookAtConstraint';
  const position = /^\s*(?:PositionAtRest|PositionOffset):/m.test(body);
  const rotation = /^\s*(?:RotationAtRest|RotationOffset):/m.test(body);
  const scale = /^\s*(?:ScaleAtRest|ScaleOffset):/m.test(body);
  if (position && rotation) return 'parentConstraint';
  if (position) return 'positionConstraint';
  if (rotation) return 'rotationConstraint';
  if (scale) return 'scaleConstraint';
  return 'constraint';
}

function parseConstraint(doc, opts, base, objectIndex) {
  const targetTransformFileId = fileId(doc.body, 'TargetTransform');
  const worldUpTransformFileId = fileId(doc.body, 'WorldUpTransform');
  return {
    ...base,
    type: classifyConstraint(doc.body),
    active: bool(doc.body, 'IsActive', true),
    globalWeight: number(doc.body, 'GlobalWeight', 1),
    targetTransformFileId,
    targetTransformPath: targetTransformFileId && targetTransformFileId !== '0'
      ? (objectIndex.transformPath(targetTransformFileId) || base.gameObjectName)
      : base.objectPath,
    sources: parseConstraintSources(doc.body, objectIndex),
    solveInLocalSpace: bool(doc.body, 'SolveInLocalSpace'),
    freezeToWorld: bool(doc.body, 'FreezeToWorld'),
    locked: bool(doc.body, 'Locked'),
    positionAtRest: vector(doc.body, 'PositionAtRest'),
    positionOffset: vector(doc.body, 'PositionOffset'),
    rotationAtRest: vector(doc.body, 'RotationAtRest'),
    rotationOffset: vector(doc.body, 'RotationOffset'),
    scaleAtRest: vector(doc.body, 'ScaleAtRest'),
    scaleOffset: vector(doc.body, 'ScaleOffset'),
    affectsPositionX: bool(doc.body, 'AffectsPositionX', true),
    affectsPositionY: bool(doc.body, 'AffectsPositionY', true),
    affectsPositionZ: bool(doc.body, 'AffectsPositionZ', true),
    affectsRotationX: bool(doc.body, 'AffectsRotationX', true),
    affectsRotationY: bool(doc.body, 'AffectsRotationY', true),
    affectsRotationZ: bool(doc.body, 'AffectsRotationZ', true),
    affectsScaleX: bool(doc.body, 'AffectsScaleX', true),
    affectsScaleY: bool(doc.body, 'AffectsScaleY', true),
    affectsScaleZ: bool(doc.body, 'AffectsScaleZ', true),
    aimAxis: vector(doc.body, 'AimAxis'),
    upAxis: vector(doc.body, 'UpAxis'),
    worldUp: number(doc.body, 'WorldUp'),
    worldUpVector: vector(doc.body, 'WorldUpVector'),
    worldUpTransformFileId,
    worldUpTransformPath: worldUpTransformFileId && worldUpTransformFileId !== '0'
      ? objectIndex.transformPath(worldUpTransformFileId)
      : null,
    lookAtAxis: vector(doc.body, 'LookAtAxis'),
    useUpTransform: bool(doc.body, 'UseUpTransform'),
    roll: number(doc.body, 'Roll'),
  };
}

function parseVrcComponents(yamlText, opts = {}) {
  const out = [];
  const docs = parsePrefabDocuments(yamlText);
  const objectIndex = buildObjectIndex(docs, opts.externalTransformPath);
  for (const doc of docs) {
    if (doc.classId !== '114') continue;
    const script = doc.body.match(/m_Script:\s*\{fileID:\s*(-?\d+),\s*guid:\s*([a-f0-9]{32})/i);
    if (!script) continue;
    const scriptFileId = script[1];
    const scriptGuid = script[2].toLowerCase();
    const base = componentBase(doc, opts, scriptGuid, scriptFileId, objectIndex);
    if (scriptGuid === VRC_SCRIPT_GUIDS.avatar && scriptFileId === VRC_SCRIPT_FILE_IDS.avatarDescriptor) {
      out.push(parseAvatarDescriptor(doc, opts, base, objectIndex));
    } else if (scriptGuid === VRC_SCRIPT_GUIDS.physBone && scriptFileId === VRC_SCRIPT_FILE_IDS.physBone) {
      out.push(parsePhysBone(doc, opts, base, objectIndex));
    } else if (scriptGuid === VRC_SCRIPT_GUIDS.physBone && scriptFileId === VRC_SCRIPT_FILE_IDS.physBoneCollider) {
      out.push(parseShapeComponent(doc, opts, base, 'physBoneCollider', objectIndex));
    } else if (scriptGuid === VRC_SCRIPT_GUIDS.contact && scriptFileId === VRC_SCRIPT_FILE_IDS.contactSender) {
      out.push(parseContact(doc, opts, base, 'contactSender', objectIndex));
    } else if (scriptGuid === VRC_SCRIPT_GUIDS.contact && scriptFileId === VRC_SCRIPT_FILE_IDS.contactReceiver) {
      out.push(parseContact(doc, opts, base, 'contactReceiver', objectIndex));
    } else if (scriptGuid === VRC_SCRIPT_GUIDS.constraint) {
      out.push(parseConstraint(doc, opts, base, objectIndex));
    }
  }
  return out;
}

function collectVrcComponents(prefabFiles, guidMap = {}) {
  const files = Array.isArray(prefabFiles) ? prefabFiles : [];
  const normalizedFiles = new Map(files.map((file) => [String(file.relPath || '').replace(/\\/g, '/').toLowerCase(), file]));
  const guidEntries = guidMap instanceof Map ? [...guidMap.entries()] : Object.entries(guidMap || {});
  const relPathByGuid = new Map(guidEntries.map(([guid, relPath]) => [
    String(guid || '').toLowerCase(),
    String(relPath || '').replace(/\\/g, '/').replace(/^Assets\//i, '').toLowerCase(),
  ]));
  const contexts = new Map();
  for (const file of files) {
    try {
      const relPath = String(file.relPath || '').replace(/\\/g, '/').toLowerCase();
      const docs = parsePrefabDocuments(file.text);
      contexts.set(relPath, {
        docs,
        docById: new Map(docs.map((doc) => [doc.fileId, doc])),
        localIndex: buildObjectIndex(docs),
      });
    } catch {
      // Keep parsing the remaining prefabs when one entry is unreadable.
    }
  }

  function resolveExternalTransform(relPath, transformFileId, seen = new Set()) {
    const key = `${relPath}|${transformFileId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const context = contexts.get(relPath);
    const direct = context?.localIndex.transformPath(transformFileId);
    if (direct) return direct;
    const doc = context?.docById.get(String(transformFileId || ''));
    const corresponding = doc?.body.match(/m_CorrespondingSourceObject:\s*\{fileID:\s*(-?\d+),\s*guid:\s*([a-f0-9]{32})/i);
    if (!corresponding) return null;
    const sourceRelPath = relPathByGuid.get(corresponding[2].toLowerCase());
    if (!sourceRelPath || !normalizedFiles.has(sourceRelPath)) return null;
    return resolveExternalTransform(sourceRelPath, corresponding[1], seen);
  }

  const out = [];
  for (const file of files) {
    try {
      const relPath = String(file.relPath || '').replace(/\\/g, '/').toLowerCase();
      out.push(...parseVrcComponents(file.text, {
        relPath: file.relPath,
        externalTransformPath: (transformFileId) => resolveExternalTransform(relPath, transformFileId),
      }));
    } catch {
      // One corrupt or newer prefab must not discard the remaining preview metadata.
    }
  }
  return out;
}

function parseExpressionParameters(body, base) {
  return String(body || '').split(/^ {2}-\s+name:\s*/m).slice(1).map((row) => ({
    name: parseYamlScalar(row.split(/\r?\n/, 1)[0]),
    valueType: number(row, 'valueType'),
    saved: bool(row, 'saved'),
    defaultValue: number(row, 'defaultValue'),
    networkSynced: bool(row, 'networkSynced', true),
  })).filter((row) => row.name);
}

function parseExpressionControls(body) {
  return String(body || '').split(/^ {2}-\s+name:\s*/m).slice(1).map((row) => {
    const lines = row.split(/\r?\n/);
    const parameterBlock = row.match(/^\s*parameter:\s*\r?\n([\s\S]*?)(?=^\s{4}\w|$)/m)?.[1] || '';
    const subParameterBlock = row.match(/^\s*subParameters:\s*(?:\[\])?\s*\r?\n?([\s\S]*?)(?=^\s*labels:|(?![\s\S]))/m)?.[1] || '';
    const subParameters = [...subParameterBlock.matchAll(/^\s*-\s+name:\s*(.*)$/gm)]
      .map((match) => parseYamlScalar(match[1]))
      .filter(Boolean);
    const labelBlock = row.match(/^\s*labels:\s*(?:\[\])?\s*\r?\n?([\s\S]*)$/m)?.[1] || '';
    const labels = labelBlock.split(/^\s*-\s+name:\s*/m).slice(1).map((labelRow) => ({
      name: parseYamlScalar(labelRow.split(/\r?\n/, 1)[0]),
      icon: assetReference(labelRow, 'icon'),
    })).filter((label) => label.name);
    return {
      name: parseYamlScalar(lines[0]),
      icon: assetReference(row, 'icon'),
      controlType: number(row, 'type'),
      parameter: scalar(parameterBlock, 'name', ''),
      value: number(row, 'value', 1),
      style: number(row, 'style'),
      subMenu: assetReference(row, 'subMenu'),
      subParameters,
      labels,
    };
  }).filter((row) => row.name);
}

function parseVrcExpressionAsset(yamlText, opts = {}) {
  const doc = parsePrefabDocuments(yamlText).find((row) => row.classId === '114');
  if (!doc) return null;
  const script = doc.body.match(/m_Script:\s*\{fileID:\s*(-?\d+),\s*guid:\s*([a-f0-9]{32})/i);
  if (!script || script[2].toLowerCase() !== VRC_SCRIPT_GUIDS.avatar) return null;
  const base = {
    scriptGuid: script[2].toLowerCase(),
    scriptFileId: script[1],
    componentFileId: doc.fileId,
    assetGuid: opts.guid || null,
    assetRelPath: opts.relPath || null,
    name: scalar(doc.body, 'm_Name', ''),
  };
  if (script[1] === VRC_SCRIPT_FILE_IDS.expressionParameters) {
    return { ...base, type: 'expressionParameters', parameters: parseExpressionParameters(doc.body, base) };
  }
  if (script[1] === VRC_SCRIPT_FILE_IDS.expressionMenu) {
    return {
      ...base,
      type: 'expressionMenu',
      parameters: assetReference(doc.body, 'Parameters'),
      controls: parseExpressionControls(doc.body),
    };
  }
  return null;
}

function collectVrcExpressionAssets(assetFiles) {
  const out = [];
  for (const file of assetFiles || []) {
    try {
      const parsed = parseVrcExpressionAsset(file.text, file);
      if (parsed) out.push(parsed);
    } catch {
      // Ignore non-VRC .asset files and forward-version serialization safely.
    }
  }
  return out;
}

module.exports = {
  VRC_SCRIPT_GUIDS,
  VRC_SCRIPT_FILE_IDS,
  parseVrcComponents,
  collectVrcComponents,
  parseVrcExpressionAsset,
  collectVrcExpressionAssets,
};
