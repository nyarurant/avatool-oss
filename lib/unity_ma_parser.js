'use strict';

const { parsePrefabDocuments } = require('./unity_prefab_parser');

// Script GUIDs are Unity asset identities and remain stable across MA package versions.
const MA_SCRIPT_GUIDS = Object.freeze({
  '2df373bf91cf30b4bbd495e11cb1a2ec': 'mergeArmature',
  '42581d8044b64899834d3d515ab3a144': 'boneProxy',
  '2db441f589c3407bb6fb5f02ff8ab541': 'shapeChanger',
  '6fd7cab7d93b403280f2f9da978d8a4f': 'blendshapeSync',
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
  // Horizontal whitespace only after ':'. Using \s here consumes the newline when
  // Unity serializes an empty string as `prefix:` and accidentally reads the next key.
  const re = new RegExp(`^[ \\t]*${key}:[ \\t]*(.*)$`, 'm');
  const match = String(body || '').match(re);
  return match ? parseYamlScalar(match[1]) : fallback;
}

function objectReferencePath(body, field) {
  const re = new RegExp(`^\\s*${field}:\\s*(?:\\r?\\n)?([\\s\\S]*?)(?=^\\s{0,2}\\w[^\\r\\n]*:|\\Z)`, 'm');
  const block = String(body || '').match(re)?.[1] || '';
  return scalar(block, 'referencePath', '') || scalar(block, 'ReferencePath', '');
}

function parseShapeChanges(body) {
  const block = String(body || '').match(/^\s*m_shapes:\s*\r?\n([\s\S]*?)(?=^\s{0,2}\w[^\r\n]*:|\Z)/m)?.[1] || '';
  const rows = block.split(/^\s*-\s+Object:\s*/m).slice(1);
  return rows.map((row) => ({
    objectPath: scalar(row, 'referencePath', ''),
    shapeName: scalar(row, 'ShapeName', ''),
    changeType: Number(scalar(row, 'ChangeType', '0')),
    value: Number(scalar(row, 'Value', '0')),
  })).filter((row) => row.objectPath || row.shapeName);
}

function parseBlendshapeBindings(body) {
  const rows = String(body || '').split(/^\s*-\s+ReferenceMesh:\s*/m).slice(1);
  return rows.map((row) => ({
    referencePath: scalar(row, 'referencePath', ''),
    blendshape: scalar(row, 'Blendshape', ''),
    localBlendshape: scalar(row, 'LocalBlendshape', ''),
  })).filter((row) => row.referencePath || row.blendshape || row.localBlendshape);
}

function parseModularAvatarComponents(yamlText, opts = {}) {
  const components = [];
  for (const doc of parsePrefabDocuments(yamlText)) {
    if (doc.classId !== '114') continue;
    const scriptGuid = doc.body.match(/m_Script:\s*\{[^}]*guid:\s*([a-f0-9]{32})/i)?.[1]?.toLowerCase();
    const type = MA_SCRIPT_GUIDS[scriptGuid];
    if (!type) continue;
    const base = {
      type,
      scriptGuid,
      gameObjectFileId: doc.body.match(/m_GameObject:\s*\{fileID:\s*(-?\d+)/)?.[1] || null,
      prefabRelPath: opts.relPath || null,
    };
    if (type === 'mergeArmature') {
      components.push({
        ...base,
        mergeTargetPath: objectReferencePath(doc.body, 'mergeTarget'),
        prefix: scalar(doc.body, 'prefix', ''),
        suffix: scalar(doc.body, 'suffix', ''),
        mangleNames: scalar(doc.body, 'mangleNames', '1') !== '0',
      });
    } else if (type === 'boneProxy') {
      components.push({
        ...base,
        boneReference: Number(scalar(doc.body, 'boneReference', '-1')),
        subPath: scalar(doc.body, 'subPath', ''),
        attachmentMode: Number(scalar(doc.body, 'attachmentMode', '0')),
        matchScale: scalar(doc.body, 'matchScale', '0') !== '0',
      });
    } else if (type === 'shapeChanger') {
      components.push({ ...base, shapes: parseShapeChanges(doc.body) });
    } else if (type === 'blendshapeSync') {
      components.push({ ...base, bindings: parseBlendshapeBindings(doc.body) });
    }
  }
  return components;
}

function collectModularAvatarComponents(prefabFiles) {
  const out = [];
  for (const file of prefabFiles || []) {
    try {
      out.push(...parseModularAvatarComponents(file.text, { relPath: file.relPath }));
    } catch {
      // Corrupt or unsupported YAML must not break the rest of preview extraction.
    }
  }
  return out;
}

module.exports = {
  MA_SCRIPT_GUIDS,
  parseModularAvatarComponents,
  collectModularAvatarComponents,
};
