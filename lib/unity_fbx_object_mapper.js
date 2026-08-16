'use strict';

const { parsePrefabDocuments } = require('./unity_prefab_parser');
// Shared with the preview-project cache so pruning knows to spare this project.
const { MAPPER_PROJECT_NAME } = require('./unity_preview_project');

const MAP_CACHE_FILE = '__preview_fbx_object_paths.json';
const REQUEST_ARG = '-avatoolFbxMapRequest';

// One Unity project is shared by every mapping request, so concurrent IPC calls
// must not launch a second Editor against it.
let mapperChain = Promise.resolve();

function runExclusive(task) {
  const run = mapperChain.then(task, task);
  mapperChain = run.catch(() => {});
  return run;
}

function normalizeRelPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function sourceReference(doc) {
  const match = String(doc?.body || '').match(
    /m_CorrespondingSourceObject:\s*\{fileID:\s*(-?\d+),\s*guid:\s*([a-f0-9]{32})/i
  );
  return match ? { fileId: match[1], guid: match[2].toLowerCase() } : null;
}

function buildPrefabSourceIndex(prefabText) {
  const docs = parsePrefabDocuments(prefabText);
  return new Map(docs.map((doc) => [String(doc.fileId), sourceReference(doc)]));
}

function loadMapCache(fs, path, cacheDir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(cacheDir, MAP_CACHE_FILE), 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function collectRequiredModelGuids(rows, prefabText, guidMap = {}) {
  return [...new Set(collectRequiredModelReferences(rows, prefabText, guidMap).map((ref) => ref.guid))];
}

function collectRequiredModelReferences(rows, prefabText, guidMap = {}) {
  const sourceByLocalId = buildPrefabSourceIndex(prefabText);
  const guidEntries = guidMap instanceof Map ? [...guidMap.entries()] : Object.entries(guidMap || {});
  const modelGuids = new Set(guidEntries
    .filter(([, relPath]) => /\.fbx$/i.test(normalizeRelPath(relPath)))
    .map(([guid]) => String(guid).toLowerCase()));
  const required = new Map();
  function add(localId, kind) {
    const source = sourceByLocalId.get(String(localId || ''));
    if (!source || !modelGuids.has(source.guid)) return;
    const key = `${source.guid}:${kind}:${source.fileId}`;
    required.set(key, { guid: source.guid, kind, fileId: source.fileId });
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!['physBone', 'physBoneCollider'].includes(String(row?.type || ''))) continue;
    add(row.gameObjectFileId, 'gameObjects');
    if (row.rootTransformFileId && String(row.rootTransformFileId) !== '0') {
      add(row.rootTransformFileId, 'transforms');
    }
    for (const id of Array.isArray(row.ignoreTransformFileIds) ? row.ignoreTransformFileIds : []) {
      add(id, 'transforms');
    }
  }
  return [...required.values()];
}

function inspectModelMapCoverage(rows, prefabText, guidMap = {}, modelMaps = {}) {
  const references = collectRequiredModelReferences(rows, prefabText, guidMap);
  const unresolved = references.filter((ref) => !normalizeRelPath(modelMaps?.[ref.guid]?.[ref.kind]?.[ref.fileId] || ''));
  return {
    required: references.length,
    resolved: references.length - unresolved.length,
    unresolved,
  };
}

function patchVrcComponentModelPaths(rows, prefabText, modelMaps = {}) {
  const sourceByLocalId = buildPrefabSourceIndex(prefabText);
  function lookup(localId, kind) {
    const source = sourceByLocalId.get(String(localId || ''));
    if (!source) return null;
    const mapped = normalizeRelPath(modelMaps?.[source.guid]?.[kind]?.[source.fileId] || '');
    if (!mapped) return null;
    // The mapper imports the FBX under a GUID filename, while three.js retains
    // the original FBX root name. Remove that importer-only root so suffix path
    // matching is stable regardless of the temporary filename.
    const parts = mapped.split('/').filter(Boolean);
    return parts.length > 1 ? parts.slice(1).join('/') : parts[0];
  }
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || !['physBone', 'physBoneCollider'].includes(String(row.type || ''))) return row;
    const next = { ...row };
    if (!next.objectPath) next.objectPath = lookup(next.gameObjectFileId, 'gameObjects');
    if (!next.gameObjectName && next.objectPath) next.gameObjectName = next.objectPath.split('/').at(-1) || null;
    if (!next.rootTransformPath) {
      next.rootTransformPath = next.rootTransformFileId && String(next.rootTransformFileId) !== '0'
        ? lookup(next.rootTransformFileId, 'transforms')
        : next.objectPath;
    }
    if (Array.isArray(next.ignoreTransformFileIds)) {
      const resolved = next.ignoreTransformFileIds.map((id) => lookup(id, 'transforms')).filter(Boolean);
      if (resolved.length) next.ignoreTransformPaths = resolved;
    }
    return next;
  });
}

function createUnityFbxObjectMapper({
  fs,
  path,
  os,
  spawn,
  resolveEditorPath,
  createUnityProject,
  templatePath,
  mapperProjectPath = '',
} = {}) {
  if (!fs || !path || !os || !spawn || !resolveEditorPath || !createUnityProject || !templatePath) {
    throw new Error('createUnityFbxObjectMapper requires filesystem, process, Unity project, and template dependencies.');
  }

  function resolveMapperProjectPath() {
    if (mapperProjectPath) return mapperProjectPath;
    const appData = process.env.APPDATA || process.env.HOME || os.tmpdir();
    return path.join(appData, 'avatool', 'unity_preview_projects', MAPPER_PROJECT_NAME);
  }

  function writeMapperFiles(projectPath) {
    const editorDir = path.join(projectPath, 'Assets', 'Avatool', 'Editor');
    fs.mkdirSync(editorDir, { recursive: true });
    const destination = path.join(editorDir, 'AvatoolFbxObjectMapper.cs');
    const body = fs.readFileSync(templatePath, 'utf8');
    if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== body) {
      fs.writeFileSync(destination, body, 'utf8');
    }
  }

  function runUnity(editor, projectPath, requestPath, logPath, timeoutMs = 300000) {
    return new Promise((resolve) => {
      const proc = spawn(editor, [
        '-batchmode', '-nographics', '-quit',
        '-projectPath', projectPath,
        '-executeMethod', 'AvatoolFbxObjectMapper.Run',
        REQUEST_ARG, requestPath,
        '-logFile', logPath,
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
      let settled = false;
      let timedOut = false;
      let hardTimer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (hardTimer) clearTimeout(hardTimer);
        resolve(value);
      };
      // On timeout, wait for the kill to actually land before resolving —
      // otherwise the next request starts Unity while this one still holds the project.
      const timer = setTimeout(() => {
        timedOut = true;
        try { proc.kill(); } catch { /* already stopped */ }
        hardTimer = setTimeout(() => finish({ error: 'fbx_object_map_timeout', logPath }), 10000);
        hardTimer.unref?.();
      }, timeoutMs);
      timer.unref?.();
      proc.on('error', (error) => finish({ error: error.message, logPath }));
      proc.on('close', (code) => finish(
        timedOut
          ? { error: 'fbx_object_map_timeout', logPath }
          : code === 0 ? { ok: true } : { error: `fbx_object_map_failed_${code}`, logPath }
      ));
    });
  }

  async function ensureMaps({ cacheDir, prefabRelPath, rows, guidMap = {}, settings = {} } = {}) {
    const normalizedPrefab = normalizeRelPath(prefabRelPath);
    const prefabPath = path.resolve(cacheDir, normalizedPrefab);
    const resolvedCache = path.resolve(cacheDir);
    if (!prefabPath.startsWith(`${resolvedCache}${path.sep}`) || !fs.existsSync(prefabPath)) {
      return { rows, error: 'prefab_not_found' };
    }
    const prefabText = fs.readFileSync(prefabPath, 'utf8');
    const maps = loadMapCache(fs, path, cacheDir);
    const required = collectRequiredModelGuids(rows, prefabText, guidMap);
    const initialCoverage = inspectModelMapCoverage(rows, prefabText, guidMap, maps);
    const missing = [...new Set(initialCoverage.unresolved.map((ref) => ref.guid))];
    if (!missing.length) {
      return {
        rows: patchVrcComponentModelPaths(rows, prefabText, maps),
        mapped: required.length,
        coverage: initialCoverage,
      };
    }

    return runExclusive(() => runMapping({
      cacheDir,
      resolvedCache,
      prefabText,
      rows,
      guidMap,
      settings,
      required,
    }));
  }

  async function runMapping({ cacheDir, resolvedCache, prefabText, rows, guidMap, settings, required }) {
    // A request that queued behind another run may already have what it needs.
    const maps = loadMapCache(fs, path, cacheDir);
    const initialCoverage = inspectModelMapCoverage(rows, prefabText, guidMap, maps);
    const missing = [...new Set(initialCoverage.unresolved.map((ref) => ref.guid))];
    if (!missing.length) {
      return {
        rows: patchVrcComponentModelPaths(rows, prefabText, maps),
        mapped: required.length,
        coverage: initialCoverage,
      };
    }

    const editor = resolveEditorPath(settings);
    if (!editor) return { rows, error: 'unity_editor_not_found' };
    const projectPath = resolveMapperProjectPath();
    const created = await createUnityProject(editor, projectPath);
    if (created?.error) return { rows, ...created };
    writeMapperFiles(projectPath);

    const guidEntries = guidMap instanceof Map ? [...guidMap.entries()] : Object.entries(guidMap || {});
    const relPathByGuid = new Map(guidEntries.map(([guid, relPath]) => [String(guid).toLowerCase(), normalizeRelPath(relPath)]));
    const importDir = path.join(projectPath, 'Assets', 'AvatoolFbxMap');
    fs.mkdirSync(importDir, { recursive: true });
    const models = [];
    const missingMeta = [];
    for (const guid of missing) {
      const relPath = relPathByGuid.get(guid);
      if (!relPath || !/\.fbx$/i.test(relPath)) continue;
      const source = path.resolve(cacheDir, relPath);
      if (!source.startsWith(`${resolvedCache}${path.sep}`) || !fs.existsSync(source)) continue;
      const sourceMeta = `${source}.meta`;
      if (!fs.existsSync(sourceMeta)) {
        missingMeta.push(guid);
        continue;
      }
      const assetRelPath = `Assets/AvatoolFbxMap/${guid}.fbx`;
      const destination = path.join(projectPath, ...assetRelPath.split('/'));
      fs.copyFileSync(source, destination);
      fs.copyFileSync(sourceMeta, `${destination}.meta`);
      models.push({ guid, assetPath: assetRelPath });
    }
    if (missingMeta.length) {
      return {
        rows,
        error: 'fbx_model_meta_not_found',
        missingGuids: missingMeta,
        coverage: initialCoverage,
      };
    }
    if (!models.length) return { rows, error: 'fbx_model_source_not_found' };

    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatool-fbx-map-'));
    const requestPath = path.join(runDir, 'request.json');
    const outputPath = path.join(runDir, 'result.json');
    const logPath = path.join(runDir, 'unity.log');
    fs.writeFileSync(requestPath, JSON.stringify({ outputPath, models }), 'utf8');
    const result = await runUnity(editor, projectPath, requestPath, logPath);
    // The scratch directory is kept on every failure path so its Unity log survives.
    if (result.error) return { rows, ...result };
    let generated;
    try {
      generated = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    } catch {
      return { rows, error: 'fbx_object_map_result_missing', logPath };
    }
    for (const model of generated?.models || []) {
      const gameObjects = {};
      const transforms = {};
      for (const entry of model.entries || []) {
        if (entry.gameObjectFileId) gameObjects[String(entry.gameObjectFileId)] = entry.path;
        if (entry.transformFileId) transforms[String(entry.transformFileId)] = entry.path;
      }
      maps[String(model.guid || '').toLowerCase()] = { gameObjects, transforms };
    }
    fs.writeFileSync(path.join(cacheDir, MAP_CACHE_FILE), JSON.stringify(maps), 'utf8');
    const patchedRows = patchVrcComponentModelPaths(rows, prefabText, maps);
    const coverage = inspectModelMapCoverage(rows, prefabText, guidMap, maps);
    if (coverage.unresolved.length) {
      return {
        rows: patchedRows,
        error: 'fbx_object_map_incomplete',
        mapped: required.length,
        generated: models.length,
        coverage,
        logPath,
      };
    }
    try { fs.rmSync(runDir, { recursive: true, force: true }); } catch { /* swept later */ }
    return { rows: patchedRows, mapped: required.length, generated: models.length, coverage };
  }

  return { ensureMaps };
}

module.exports = {
  MAP_CACHE_FILE,
  collectRequiredModelGuids,
  collectRequiredModelReferences,
  inspectModelMapCoverage,
  patchVrcComponentModelPaths,
  createUnityFbxObjectMapper,
};
