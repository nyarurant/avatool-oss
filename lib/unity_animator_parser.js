'use strict';

const { parsePrefabDocuments } = require('./unity_prefab_parser');

const VRC_AVATAR_SDK_GUID = '67cc4cb7839cd3741b63733d5adf0442';
const VRC_BEHAVIOUR_FILE_IDS = Object.freeze({
  '-706344726': 'parameterDriver',
  '-646210727': 'trackingControl',
  '1852460640': 'playableLayerControl',
  '-1936262289': 'animatorLayerControl',
  '-453519674': 'locomotionControl',
  '141706016': 'temporaryPoseSpace',
  '1859411423': 'playAudio',
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

function curveNumber(body, key, fallback = 0) {
  const value = Number(scalar(body, key, String(fallback)));
  return Number.isNaN(value) ? fallback : value;
}

function fileId(body, key) {
  return String(body || '').match(new RegExp(`^[ \\t]*${key}:[ \\t]*\\{fileID:[ \\t]*(-?\\d+)`, 'm'))?.[1] || null;
}

function assetReference(body, key) {
  const match = String(body || '').match(new RegExp(
    `^[ \\t]*${key}:[ \\t]*\\{fileID:[ \\t]*(-?\\d+)(?:,[ \\t]*guid:[ \\t]*([a-f0-9]{32}))?`,
    'mi'
  ));
  return match ? { fileId: match[1], guid: match[2]?.toLowerCase() || null } : null;
}

function inlineVector(body, key) {
  const inline = String(body || '').match(new RegExp(`^[ \\t]*${key}:[ \\t]*\\{([^}]*)\\}`, 'm'))?.[1];
  if (!inline) return null;
  const out = {};
  for (const match of inline.matchAll(/([xyzw]):\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/gi)) {
    out[match[1].toLowerCase()] = Number(match[2]);
  }
  return Object.keys(out).length ? out : null;
}

function referenceList(body, key, childKey = null) {
  const source = String(body || '');
  const start = source.search(new RegExp(`^[ \\t]*${key}:[ \\t]*(?:\\[\\])?[ \\t]*$`, 'm'));
  if (start < 0) return [];
  const tail = source.slice(start).split(/\r?\n/).slice(1);
  const refs = [];
  const refPattern = childKey
    ? new RegExp(`^\\s+(?:-\\s+)?${childKey}:\\s*\\{fileID:\\s*(-?\\d+)`)
    : /^\s+-\s+\{fileID:\s*(-?\d+)/;
  for (const line of tail) {
    const match = line.match(refPattern);
    if (match) refs.push(match[1]);
    else if (/^\s{0,2}\w[^:]*:/.test(line)) break;
  }
  return refs;
}

function assetReferenceList(body, key) {
  const source = String(body || '');
  const start = source.search(new RegExp(`^[ \\t]*${key}:[ \\t]*(?:\\[\\])?[ \\t]*$`, 'm'));
  if (start < 0) return [];
  const lines = source.slice(start).split(/\r?\n/).slice(1);
  const values = [];
  for (const line of lines) {
    const match = line.match(/^\s+-\s+\{fileID:\s*(-?\d+)(?:,\s*guid:\s*([a-f0-9]{32}))?/i);
    if (!match) break;
    if (match[1] !== '0') values.push({ fileId: match[1], guid: match[2]?.toLowerCase() || null });
  }
  return values;
}

function parseControllerParameters(body) {
  const block = String(body || '').match(/^ {2}m_AnimatorParameters:[ \t]*\r?\n([\s\S]*?)(?=^ {2}m_AnimatorLayers:|(?![\s\S]))/m)?.[1] || '';
  return block.split(/^ {2}-\s+m_Name:\s*/m).slice(1).map((row) => ({
    name: parseYamlScalar(row.split(/\r?\n/, 1)[0]),
    type: number(row, 'm_Type'),
    defaultFloat: number(row, 'm_DefaultFloat'),
    defaultInt: number(row, 'm_DefaultInt'),
    defaultBool: bool(row, 'm_DefaultBool'),
    controller: fileId(row, 'm_Controller'),
  })).filter((row) => row.name);
}

function parseControllerLayers(body) {
  const block = String(body || '').match(/^ {2}m_AnimatorLayers:[ \t]*\r?\n([\s\S]*)$/m)?.[1] || '';
  return block.split(/^ {2}-\s+serializedVersion:\s*\d+\s*$/m).slice(1).map((row) => ({
    name: scalar(row, 'm_Name', ''),
    stateMachineFileId: fileId(row, 'm_StateMachine'),
    avatarMask: assetReference(row, 'm_Mask'),
    blendingMode: number(row, 'm_BlendingMode'),
    syncedLayerIndex: number(row, 'm_SyncedLayerIndex', -1),
    defaultWeight: number(row, 'm_DefaultWeight', 1),
    ikPass: bool(row, 'm_IKPass'),
    syncedLayerAffectsTiming: bool(row, 'm_SyncedLayerAffectsTiming'),
  })).filter((row) => row.name || row.stateMachineFileId);
}

function parseConditions(body) {
  const block = String(body || '').match(/^ {2}m_Conditions:[ \t]*(?:\[\])?[ \t]*\r?\n?([\s\S]*?)(?=^ {2}m_DstStateMachine:|(?![\s\S]))/m)?.[1] || '';
  return block.split(/^ {2}-\s+m_ConditionMode:\s*/m).slice(1).map((row) => ({
    mode: Number(row.split(/\r?\n/, 1)[0].trim()),
    parameter: scalar(row, 'm_ConditionEvent', ''),
    threshold: number(row, 'm_EventTreshold'),
  })).filter((row) => row.parameter);
}

function parseVrcBehaviour(doc) {
  const script = doc.body.match(/m_Script:\s*\{fileID:\s*(-?\d+),\s*guid:\s*([a-f0-9]{32})/i);
  if (!script || script[2].toLowerCase() !== VRC_AVATAR_SDK_GUID) return null;
  const behaviourType = VRC_BEHAVIOUR_FILE_IDS[script[1]] || 'vrcStateMachineBehaviour';
  const base = { fileId: doc.fileId, type: behaviourType, scriptFileId: script[1] };
  if (behaviourType === 'parameterDriver') {
    const parameters = doc.body.split(/^ {2}-\s+type:\s*/m).slice(1).map((row) => ({
      changeType: Number(row.split(/\r?\n/, 1)[0].trim()),
      name: scalar(row, 'name', ''),
      source: scalar(row, 'source', ''),
      value: number(row, 'value'),
      valueMin: number(row, 'valueMin'),
      valueMax: number(row, 'valueMax', 1),
      chance: number(row, 'chance', 1),
      preventRepeats: bool(row, 'preventRepeats'),
      convertRange: bool(row, 'convertRange'),
      sourceMin: number(row, 'sourceMin'),
      sourceMax: number(row, 'sourceMax'),
      destMin: number(row, 'destMin'),
      destMax: number(row, 'destMax'),
    })).filter((row) => row.name);
    return { ...base, localOnly: bool(doc.body, 'localOnly'), debugString: scalar(doc.body, 'debugString', ''), parameters };
  }
  if (behaviourType === 'trackingControl') {
    return {
      ...base,
      tracking: {
        head: number(doc.body, 'trackingHead'),
        leftHand: number(doc.body, 'trackingLeftHand'),
        rightHand: number(doc.body, 'trackingRightHand'),
        hip: number(doc.body, 'trackingHip'),
        leftFoot: number(doc.body, 'trackingLeftFoot'),
        rightFoot: number(doc.body, 'trackingRightFoot'),
        leftFingers: number(doc.body, 'trackingLeftFingers'),
        rightFingers: number(doc.body, 'trackingRightFingers'),
        eyes: number(doc.body, 'trackingEyes'),
        mouth: number(doc.body, 'trackingMouth'),
      },
      debugString: scalar(doc.body, 'debugString', ''),
    };
  }
  if (behaviourType === 'playableLayerControl') {
    return {
      ...base,
      layer: number(doc.body, 'layer'),
      goalWeight: number(doc.body, 'goalWeight'),
      blendDuration: number(doc.body, 'blendDuration'),
      outputParamHash: number(doc.body, 'outputParamHash'),
      debugString: scalar(doc.body, 'debugString', ''),
    };
  }
  if (behaviourType === 'animatorLayerControl') {
    return {
      ...base,
      playable: number(doc.body, 'playable'),
      layer: number(doc.body, 'layer', 1),
      goalWeight: number(doc.body, 'goalWeight'),
      blendDuration: number(doc.body, 'blendDuration'),
      debugString: scalar(doc.body, 'debugString', ''),
    };
  }
  if (behaviourType === 'locomotionControl') {
    return { ...base, disableLocomotion: bool(doc.body, 'disableLocomotion'), debugString: scalar(doc.body, 'debugString', '') };
  }
  if (behaviourType === 'temporaryPoseSpace') {
    return {
      ...base,
      enterPoseSpace: bool(doc.body, 'enterPoseSpace'),
      fixedDelay: bool(doc.body, 'fixedDelay', true),
      delayTime: number(doc.body, 'delayTime'),
      debugString: scalar(doc.body, 'debugString', ''),
    };
  }
  if (behaviourType === 'playAudio') {
    return {
      ...base,
      sourcePath: scalar(doc.body, 'SourcePath', ''),
      playbackOrder: number(doc.body, 'PlaybackOrder'),
      parameterName: scalar(doc.body, 'ParameterName', ''),
      volume: inlineVector(doc.body, 'Volume') || { x: 1, y: 1 },
      volumeApplySettings: number(doc.body, 'VolumeApplySettings', 1),
      pitch: inlineVector(doc.body, 'Pitch') || { x: 1, y: 1 },
      pitchApplySettings: number(doc.body, 'PitchApplySettings', 1),
      clips: assetReferenceList(doc.body, 'Clips'),
      clipsApplySettings: number(doc.body, 'ClipsApplySettings', 1),
      loop: bool(doc.body, 'Loop'),
      loopApplySettings: number(doc.body, 'LoopApplySettings', 1),
      delaySeconds: number(doc.body, 'DelayInSeconds'),
      playOnEnter: bool(doc.body, 'PlayOnEnter', true),
      stopOnEnter: bool(doc.body, 'StopOnEnter', true),
      playOnExit: bool(doc.body, 'PlayOnExit'),
      stopOnExit: bool(doc.body, 'StopOnExit'),
    };
  }
  return { ...base, fields: doc.body };
}

function parseAnimatorController(yamlText, opts = {}) {
  const docs = parsePrefabDocuments(yamlText);
  const controller = docs.find((doc) => doc.classId === '91');
  if (!controller) return null;
  const states = docs.filter((doc) => doc.classId === '1102').map((doc) => ({
    fileId: doc.fileId,
    name: scalar(doc.body, 'm_Name', ''),
    speed: number(doc.body, 'm_Speed', 1),
    cycleOffset: number(doc.body, 'm_CycleOffset'),
    transitionFileIds: referenceList(doc.body, 'm_Transitions'),
    behaviourFileIds: referenceList(doc.body, 'm_StateMachineBehaviours'),
    writeDefaultValues: bool(doc.body, 'm_WriteDefaultValues', true),
    motion: assetReference(doc.body, 'm_Motion'),
    tag: scalar(doc.body, 'm_Tag', ''),
    timeParameter: scalar(doc.body, 'm_TimeParameter', ''),
    timeParameterActive: bool(doc.body, 'm_TimeParameterActive'),
  }));
  const stateMachines = docs.filter((doc) => doc.classId === '1107').map((doc) => ({
    fileId: doc.fileId,
    name: scalar(doc.body, 'm_Name', ''),
    childStateFileIds: referenceList(doc.body, 'm_ChildStates', 'm_State'),
    childStateMachineFileIds: referenceList(doc.body, 'm_ChildStateMachines', 'm_StateMachine'),
    anyStateTransitionFileIds: referenceList(doc.body, 'm_AnyStateTransitions'),
    entryTransitionFileIds: referenceList(doc.body, 'm_EntryTransitions'),
    behaviourFileIds: referenceList(doc.body, 'm_StateMachineBehaviours'),
    defaultStateFileId: fileId(doc.body, 'm_DefaultState'),
  }));
  const transitions = docs.filter((doc) => doc.classId === '1101').map((doc) => ({
    fileId: doc.fileId,
    name: scalar(doc.body, 'm_Name', ''),
    conditions: parseConditions(doc.body),
    destinationStateFileId: fileId(doc.body, 'm_DstState'),
    destinationStateMachineFileId: fileId(doc.body, 'm_DstStateMachine'),
    isExit: bool(doc.body, 'm_IsExit'),
    duration: number(doc.body, 'm_TransitionDuration'),
    offset: number(doc.body, 'm_TransitionOffset'),
    exitTime: number(doc.body, 'm_ExitTime'),
    hasExitTime: bool(doc.body, 'm_HasExitTime'),
    hasFixedDuration: bool(doc.body, 'm_HasFixedDuration', true),
  }));
  const blendTrees = docs.filter((doc) => doc.classId === '206').map((doc) => {
    const childBlock = doc.body.match(/^ {2}m_Childs:[ \t]*(?:\[\])?[ \t]*\r?\n?([\s\S]*?)(?=^ {2}m_BlendParameter:|(?![\s\S]))/m)?.[1] || '';
    const children = childBlock.split(/^ {2}-\s+serializedVersion:\s*\d+\s*$/m).slice(1).map((row) => ({
      motion: assetReference(row, 'm_Motion'),
      threshold: number(row, 'm_Threshold'),
      position: inlineVector(row, 'm_Position') || { x: 0, y: 0 },
      timeScale: number(row, 'm_TimeScale', 1),
      cycleOffset: number(row, 'm_CycleOffset'),
      directBlendParameter: scalar(row, 'm_DirectBlendParameter', ''),
      mirror: bool(row, 'm_Mirror'),
    })).filter((row) => row.motion?.fileId && row.motion.fileId !== '0');
    return {
      fileId: doc.fileId,
      name: scalar(doc.body, 'm_Name', ''),
      children,
      blendParameter: scalar(doc.body, 'm_BlendParameter', ''),
      blendParameterY: scalar(doc.body, 'm_BlendParameterY', ''),
      minThreshold: number(doc.body, 'm_MinThreshold'),
      maxThreshold: number(doc.body, 'm_MaxThreshold', 1),
      useAutomaticThresholds: bool(doc.body, 'm_UseAutomaticThresholds', true),
      normalizedBlendValues: bool(doc.body, 'm_NormalizedBlendValues'),
      blendType: number(doc.body, 'm_BlendType'),
    };
  });
  return {
    type: 'animatorController',
    assetGuid: opts.guid || null,
    assetRelPath: opts.relPath || null,
    name: scalar(controller.body, 'm_Name', ''),
    parameters: parseControllerParameters(controller.body),
    layers: parseControllerLayers(controller.body),
    states,
    stateMachines,
    transitions,
    blendTrees,
    behaviours: docs.filter((doc) => doc.classId === '114').map(parseVrcBehaviour).filter(Boolean),
  };
}

function parseKeyframes(row) {
  const points = [];
  for (const part of String(row || '').split(/^ {6}-\s+serializedVersion:\s*\d+\s*$/m).slice(1)) {
    const time = number(part, 'time', NaN);
    const value = number(part, 'value', NaN);
    if (Number.isFinite(time) && Number.isFinite(value)) points.push({
      time,
      value,
      inSlope: curveNumber(part, 'inSlope'),
      outSlope: curveNumber(part, 'outSlope'),
    });
  }
  return points;
}

function topLevelFieldBlock(body, key) {
  const source = String(body || '');
  const match = new RegExp(`^ {2}${key}:[^\\r\\n]*(?:\\r?\\n|$)`, 'm').exec(source);
  if (!match || /\[\]\s*$/.test(match[0].trim())) return '';
  const tail = source.slice(match.index + match[0].length);
  const end = tail.search(/^ {2}m_[A-Za-z0-9_]+:/m);
  return end >= 0 ? tail.slice(0, end) : tail;
}

function parseVectorKeyframes(row) {
  const points = [];
  for (const part of String(row || '').split(/^ {6}-\s+serializedVersion:\s*\d+\s*$/m).slice(1)) {
    const time = number(part, 'time', NaN);
    const value = inlineVector(part, 'value');
    if (!Number.isFinite(time) || !value) continue;
    points.push({
      time,
      value,
      inSlope: inlineVector(part, 'inSlope') || {},
      outSlope: inlineVector(part, 'outSlope') || {},
    });
  }
  return points;
}

function parseVectorCurveSection(body, key) {
  return topLevelFieldBlock(body, key).split(/^ {2}-\s+curve:\s*$/m).slice(1).map((row) => ({
    path: scalar(row, 'path', ''),
    keyframes: parseVectorKeyframes(row),
  })).filter((row) => row.path && row.keyframes.length);
}

function clipTimeRange(curveGroups, fallbackStart = 0, fallbackStop = 0) {
  const times = [];
  for (const curves of curveGroups) {
    for (const curve of curves || []) {
      for (const keyframe of curve.keyframes || []) {
        if (Number.isFinite(Number(keyframe.time))) times.push(Number(keyframe.time));
      }
    }
  }
  return {
    startTime: times.length ? Math.min(fallbackStart, ...times) : fallbackStart,
    stopTime: times.length ? Math.max(fallbackStop, ...times) : fallbackStop,
  };
}

function parseAnimationClip(yamlText, opts = {}) {
  const doc = parsePrefabDocuments(yamlText).find((row) => row.classId === '74');
  if (!doc) return null;
  const block = topLevelFieldBlock(doc.body, 'm_FloatCurves');
  // Unity writes FloatCurve list entries in two valid shapes depending on serializer
  // version: `- curve:` first (AnimationClip serializedVersion 6, seen on some avatars)
  // or `- serializedVersion: N` first with `curve:` nested below (serializedVersion 7,
  // seen on others). Both must be accepted or one avatar's clips silently lose all curves.
  const floatCurves = block.split(/^ {2}-\s+(?:serializedVersion:\s*\d+\s*|curve:\s*)$/m).slice(1).map((row) => ({
    path: scalar(row, 'path', ''),
    attribute: scalar(row, 'attribute', ''),
    classId: number(row, 'classID'),
    script: assetReference(row, 'script'),
    keyframes: parseKeyframes(row),
  })).filter((row) => row.path || row.attribute);
  const rotationCurves = parseVectorCurveSection(doc.body, 'm_RotationCurves');
  const eulerCurves = parseVectorCurveSection(doc.body, 'm_EulerCurves');
  const positionCurves = parseVectorCurveSection(doc.body, 'm_PositionCurves');
  const scaleCurves = parseVectorCurveSection(doc.body, 'm_ScaleCurves');
  const range = clipTimeRange(
    [floatCurves, rotationCurves, eulerCurves, positionCurves, scaleCurves],
    number(doc.body, 'm_StartTime'),
    number(doc.body, 'm_StopTime')
  );
  return {
    type: 'animationClip',
    curveSchemaVersion: 4,
    assetGuid: opts.guid || null,
    assetRelPath: opts.relPath || null,
    name: scalar(doc.body, 'm_Name', ''),
    sampleRate: number(doc.body, 'm_SampleRate', 60),
    startTime: range.startTime,
    stopTime: range.stopTime,
    loopTime: bool(doc.body, 'm_LoopTime'),
    floatCurves,
    rotationCurves,
    eulerCurves,
    positionCurves,
    scaleCurves,
    motionCurveCount: rotationCurves.length + eulerCurves.length + positionCurves.length + scaleCurves.length
      + floatCurves.filter((row) => row.classId === 95 || row.classId === 4).length,
    hasHumanoidMuscles: floatCurves.some((row) => row.classId === 95),
  };
}

function collectAnimatorAssets(files) {
  const out = [];
  for (const file of files || []) {
    try {
      const ext = String(file.relPath || '').toLowerCase().split('.').pop();
      const parsed = ext === 'controller'
        ? parseAnimatorController(file.text, file)
        : ext === 'anim' ? parseAnimationClip(file.text, file) : null;
      if (parsed) out.push(parsed);
    } catch {
      // Ignore unsupported controller/clip serialization without breaking preview.
    }
  }
  return out;
}

module.exports = {
  VRC_BEHAVIOUR_FILE_IDS,
  parseAnimatorController,
  parseAnimationClip,
  collectAnimatorAssets,
};
