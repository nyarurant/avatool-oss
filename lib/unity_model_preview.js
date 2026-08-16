'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
const { sanitizePathSegment, safeResolveUnder } = require('./utils');
const {
  parseUnityMaterial,
  resolveMaterialTexturePaths,
  parseGuidFromMeta,
} = require('./unity_material_parser');
const { collectPrefabBindings } = require('./unity_prefab_parser');
const { collectModularAvatarComponents } = require('./unity_ma_parser');
const { collectVrcComponents, collectVrcExpressionAssets } = require('./unity_vrc_parser');
const { collectAnimatorAssets } = require('./unity_animator_parser');

const PREVIEWABLE_MESH_EXTS = new Set(['.fbx', '.obj']);
// .asset: Unity may store Materials as .asset (not only .mat). Prefab refs often use them.
const PREVIEWABLE_AUX_EXTS = new Set([
  '.mtl', '.mat', '.asset', '.prefab', '.controller', '.overridecontroller', '.anim', '.mask',
  '.png', '.jpg', '.jpeg', '.tga',
]);
const PREVIEW_CACHE_DIRNAME = '__preview_cache';
const PREVIEW_CACHE_FLAG = '__preview_cache.flag';
const PREVIEW_MATERIALS_JSON = '__preview_materials.json';
const PREVIEW_GUID_MAP_JSON = '__preview_guid_map.json';
const PREVIEW_PREFAB_BINDINGS_JSON = '__preview_prefab_bindings.json';
const PREVIEW_MA_COMPONENTS_JSON = '__preview_ma_components.json';
const PREVIEW_VRC_COMPONENTS_JSON = '__preview_vrc_components.json';
const PREVIEW_VRC_SUMMARY_JSON = '__preview_vrc_summary.json';
/** Bump when extraction schema or materials.json fields change. */
const PREVIEW_CACHE_VERSION = 24;

/** Serialize extracts per cacheDir so double-clicks don't thrash the same package. */
const inflightExtracts = new Map();

function isPreviewableExt(ext) {
  return PREVIEWABLE_MESH_EXTS.has(ext) || PREVIEWABLE_AUX_EXTS.has(ext);
}

function copyPreviewAssetWithMetaSync(assetFile, metaFile, destPath) {
  fs.copyFileSync(assetFile, destPath);
  if (metaFile && fs.existsSync(metaFile)) fs.copyFileSync(metaFile, `${destPath}.meta`);
}

async function copyPreviewAssetWithMeta(assetFile, metaFile, destPath) {
  await fsp.copyFile(assetFile, destPath);
  if (metaFile && fs.existsSync(metaFile)) await fsp.copyFile(metaFile, `${destPath}.meta`);
}

function walkForGuidFolders(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (e.isFile() && e.name === 'pathname') out.push(dir);
    }
  }
  return out;
}

function getPreviewCacheDir(itemDir, pkgPath) {
  const resolved = path.resolve(String(pkgPath || ''));
  const safeName = sanitizePathSegment(path.basename(resolved), 'package');
  const pathKey = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const suffix = crypto.createHash('sha256').update(pathKey).digest('hex').slice(0, 12);
  return path.join(itemDir, PREVIEW_CACHE_DIRNAME, `${safeName}-${suffix}`);
}

function isPreviewCacheFresh(cacheDir, pkgPath) {
  const flagFile = path.join(cacheDir, PREVIEW_CACHE_FLAG);
  if (!fs.existsSync(flagFile)) return false;
  try {
    const stat = fs.statSync(pkgPath);
    const flag = JSON.parse(fs.readFileSync(flagFile, 'utf8'));
    return (
      flag?.sourceMtimeMs === stat.mtimeMs &&
      flag?.sourceSize === stat.size &&
      Number(flag?.cacheVersion) === PREVIEW_CACHE_VERSION
    );
  } catch {
    return false;
  }
}

function listCachedFiles(cacheDir) {
  const meshes = [];
  const textures = [];
  const materials = [];
  const prefabs = [];
  const animations = [];
  const stack = [cacheDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (
        e.name === PREVIEW_CACHE_FLAG ||
        e.name === PREVIEW_MATERIALS_JSON ||
        e.name === PREVIEW_GUID_MAP_JSON ||
        e.name === PREVIEW_PREFAB_BINDINGS_JSON ||
        e.name === PREVIEW_MA_COMPONENTS_JSON ||
        e.name === PREVIEW_VRC_COMPONENTS_JSON ||
        e.name === PREVIEW_VRC_SUMMARY_JSON
      ) {
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      const relPath = path.relative(cacheDir, full).replace(/\\/g, '/');
      if (PREVIEWABLE_MESH_EXTS.has(ext)) meshes.push({ relPath, ext });
      else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.tga') {
        textures.push({ relPath, ext });
      } else if (ext === '.mat' || ext === '.asset') materials.push({ relPath, ext });
      else if (ext === '.prefab') prefabs.push({ relPath, ext });
      else if (ext === '.controller' || ext === '.overridecontroller' || ext === '.anim' || ext === '.mask') {
        animations.push({ relPath, ext });
      }
    }
  }
  return { meshes, textures, materials, prefabs, animations };
}

function loadCachedMaterials(cacheDir) {
  const jsonPath = path.join(cacheDir, PREVIEW_MATERIALS_JSON);
  if (!fs.existsSync(jsonPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeMaterialsCache(cacheDir, materials) {
  fs.writeFileSync(path.join(cacheDir, PREVIEW_MATERIALS_JSON), JSON.stringify(materials, null, 0));
}

function writeGuidMapCache(cacheDir, guidMap) {
  const obj = guidMap instanceof Map ? Object.fromEntries(guidMap) : guidMap;
  fs.writeFileSync(path.join(cacheDir, PREVIEW_GUID_MAP_JSON), JSON.stringify(obj, null, 0));
}

function writePrefabBindingsCache(cacheDir, bindings) {
  fs.writeFileSync(path.join(cacheDir, PREVIEW_PREFAB_BINDINGS_JSON), JSON.stringify(bindings || [], null, 0));
}

function loadCachedPrefabBindings(cacheDir) {
  const jsonPath = path.join(cacheDir, PREVIEW_PREFAB_BINDINGS_JSON);
  if (!fs.existsSync(jsonPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function buildPrefabBindingsFromCache(cacheDir, guidMap, prefabEntries) {
  const entries = prefabEntries || listCachedFiles(cacheDir).prefabs || [];
  const files = [];
  for (const entry of entries) {
    const relPath = entry.relPath || entry;
    let full;
    try {
      full = safeResolveUnder(cacheDir, relPath);
    } catch {
      continue;
    }
    if (!fs.existsSync(full)) continue;
    try {
      files.push({ relPath, text: fs.readFileSync(full, 'utf8') });
    } catch {
      // skip
    }
  }
  return collectPrefabBindings(files, guidMap);
}

function buildMaComponentsFromCache(cacheDir, prefabEntries) {
  const entries = prefabEntries || listCachedFiles(cacheDir).prefabs || [];
  const files = [];
  for (const entry of entries) {
    const relPath = entry.relPath || entry;
    try {
      const full = safeResolveUnder(cacheDir, relPath);
      if (fs.existsSync(full)) files.push({ relPath, text: fs.readFileSync(full, 'utf8') });
    } catch {
      // Skip malformed paths and unreadable prefabs.
    }
  }
  return collectModularAvatarComponents(files);
}

function loadCachedMaComponents(cacheDir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(cacheDir, PREVIEW_MA_COMPONENTS_JSON), 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeMaComponentsCache(cacheDir, components) {
  fs.writeFileSync(path.join(cacheDir, PREVIEW_MA_COMPONENTS_JSON), JSON.stringify(components || []));
}

function buildVrcComponentsFromCache(cacheDir, prefabEntries, guidMap = {}) {
  const entries = prefabEntries || listCachedFiles(cacheDir).prefabs || [];
  const files = [];
  for (const entry of entries) {
    const relPath = entry.relPath || entry;
    try {
      const full = safeResolveUnder(cacheDir, relPath);
      if (fs.existsSync(full)) files.push({ relPath, text: fs.readFileSync(full, 'utf8') });
    } catch {
      // Skip malformed paths and unreadable prefabs.
    }
  }
  const assetFiles = [];
  const assetEntries = listCachedFiles(cacheDir).materials.filter((entry) => entry.ext === '.asset');
  const guidEntries = guidMap instanceof Map ? [...guidMap.entries()] : Object.entries(guidMap || {});
  const guidByRelPath = new Map(guidEntries.map(([guid, relPath]) => [
    String(relPath || '').replace(/\\/g, '/').toLowerCase(),
    guid.toLowerCase(),
  ]));
  for (const entry of assetEntries) {
    try {
      const full = safeResolveUnder(cacheDir, entry.relPath);
      if (!fs.existsSync(full)) continue;
      assetFiles.push({
        relPath: entry.relPath,
        guid: guidByRelPath.get(String(entry.relPath).toLowerCase()) || null,
        text: fs.readFileSync(full, 'utf8'),
      });
    } catch {
      // Skip unreadable ScriptableObject assets.
    }
  }
  const animatorFiles = [];
  for (const entry of listCachedFiles(cacheDir).animations) {
    try {
      const full = safeResolveUnder(cacheDir, entry.relPath);
      if (!fs.existsSync(full)) continue;
      animatorFiles.push({
        relPath: entry.relPath,
        guid: guidByRelPath.get(String(entry.relPath).toLowerCase()) || null,
        text: fs.readFileSync(full, 'utf8'),
      });
    } catch {
      // Skip unreadable Animator assets.
    }
  }
  return [
    ...collectVrcComponents(files, guidMap),
    ...collectVrcExpressionAssets(assetFiles),
    ...collectAnimatorAssets(animatorFiles),
  ];
}

function loadCachedVrcComponents(cacheDir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(cacheDir, PREVIEW_VRC_COMPONENTS_JSON), 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeVrcComponentsCache(cacheDir, components) {
  fs.writeFileSync(path.join(cacheDir, PREVIEW_VRC_COMPONENTS_JSON), JSON.stringify(components || []));
}

function isVrcCurveCacheCurrent(components) {
  const clips = (Array.isArray(components) ? components : []).filter((row) => row?.type === 'animationClip');
  return clips.length === 0 || clips.every((clip) => Number(clip.curveSchemaVersion) >= 4);
}

function refreshCachedVrcComponentsSync(cacheDir) {
  const cached = loadCachedVrcComponents(cacheDir);
  if (isVrcCurveCacheCurrent(cached)) return { ok: true, refreshed: false, componentCount: cached.length };
  let guidMap = {};
  try {
    guidMap = JSON.parse(fs.readFileSync(path.join(cacheDir, PREVIEW_GUID_MAP_JSON), 'utf8'));
  } catch {
    // Rebuilding without a GUID map still refreshes the AnimationClip curve schema.
  }
  const components = buildVrcComponentsFromCache(cacheDir, undefined, guidMap);
  writeVrcComponentsCache(cacheDir, components);
  writeVrcSummaryCache(cacheDir, summarizeVrcComponents(components));
  return { ok: true, refreshed: true, componentCount: components.length };
}

function refreshCachedVrcComponents(cacheDir) {
  const cached = loadCachedVrcComponents(cacheDir);
  if (isVrcCurveCacheCurrent(cached)) return Promise.resolve(cached);
  return new Promise((resolve) => {
    let settled = false;
    let worker;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(loadCachedVrcComponents(cacheDir));
    };
    try {
      worker = new Worker(path.join(__dirname, 'unity_model_preview_worker.js'), {
        workerData: { action: 'refresh-vrc', cacheDir },
      });
    } catch {
      refreshCachedVrcComponentsSync(cacheDir);
      resolve(loadCachedVrcComponents(cacheDir));
      return;
    }
    const timeout = setTimeout(() => {
      worker.terminate().catch(() => {});
      finish();
    }, 120000);
    worker.once('message', finish);
    worker.once('error', finish);
    worker.once('exit', finish);
  });
}

function summarizeVrcComponents(components) {
  const counts = {};
  const unscopedCounts = {};
  const byPrefabMap = new Map();
  for (const row of Array.isArray(components) ? components : []) {
    const type = String(row?.type || 'unknown');
    counts[type] = (counts[type] || 0) + 1;
    const prefabRelPath = String(row?.prefabRelPath || '').replace(/\\/g, '/');
    if (!prefabRelPath) {
      unscopedCounts[type] = (unscopedCounts[type] || 0) + 1;
      continue;
    }
    if (!byPrefabMap.has(prefabRelPath)) byPrefabMap.set(prefabRelPath, {});
    const prefabCounts = byPrefabMap.get(prefabRelPath);
    prefabCounts[type] = (prefabCounts[type] || 0) + 1;
  }
  const byPrefab = {};
  for (const [prefabRelPath, prefabCounts] of byPrefabMap) {
    byPrefab[prefabRelPath] = prefabCounts;
  }
  return {
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    counts,
    unscopedCounts,
    byPrefab,
  };
}

function writeVrcSummaryCache(cacheDir, summary) {
  fs.writeFileSync(path.join(cacheDir, PREVIEW_VRC_SUMMARY_JSON), JSON.stringify(summary || summarizeVrcComponents([])));
}

function loadCachedVrcSummary(cacheDir) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(cacheDir, PREVIEW_VRC_SUMMARY_JSON), 'utf8'));
    return value && typeof value === 'object' ? value : summarizeVrcComponents([]);
  } catch {
    return summarizeVrcComponents([]);
  }
}

function looksLikeUnityMaterialYaml(text) {
  const t = String(text || '');
  // !u!21 is Unity Material class ID; skip MonoBehaviour menus etc.
  return t.includes('Material:') || /!u!21\s+&/.test(t);
}

function buildResolvedMaterials(cacheDir, guidMap, matEntries) {
  const entries = matEntries || listCachedFiles(cacheDir).materials || [];
  const out = [];
  for (const entry of entries) {
    const relPath = entry.relPath || entry;
    const ext = path.extname(String(relPath)).toLowerCase();
    let full;
    try {
      full = safeResolveUnder(cacheDir, relPath);
    } catch {
      continue;
    }
    if (!fs.existsSync(full)) continue;
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    // .asset files may be menus/scriptable objects — only keep real Materials
    if (ext === '.asset' && !looksLikeUnityMaterialYaml(text)) continue;
    const parsed = parseUnityMaterial(text, { relPath });
    if (!parsed) continue;
    const resolved = resolveMaterialTexturePaths(parsed, guidMap);
    if (resolved) out.push(resolved);
  }
  out.sort(
    (a, b) =>
      String(a.name).localeCompare(String(b.name)) ||
      String(a.relPath || '').localeCompare(String(b.relPath || ''))
  );
  return out;
}

function materialsNeedRebuild(materials) {
  // Older caches only stored base fields — rebuild from .mat when lilToon fields are missing.
  if (!Array.isArray(materials) || !materials.length) return true;
  const sample = materials[0];
  return sample.shadowBorder == null && sample.useRim == null && sample.shadowColor == null;
}

function tryLoadFreshCache(pkgPath, cacheDir) {
  if (!isPreviewCacheFresh(cacheDir, pkgPath)) return null;
  const { meshes, textures, materials: matFiles, prefabs: prefabFiles } = listCachedFiles(cacheDir);
  if (meshes.length > 0) {
    let guidMap = {};
    try {
      const gmPath = path.join(cacheDir, PREVIEW_GUID_MAP_JSON);
      if (fs.existsSync(gmPath)) guidMap = JSON.parse(fs.readFileSync(gmPath, 'utf8'));
    } catch {
      guidMap = {};
    }

    let materials = loadCachedMaterials(cacheDir);
    if (!materials.length || materialsNeedRebuild(materials)) {
      if (matFiles.length) {
        materials = buildResolvedMaterials(cacheDir, guidMap, matFiles);
        if (materials.length) writeMaterialsCache(cacheDir, materials);
      }
    }

    let prefabBindings = loadCachedPrefabBindings(cacheDir);
    if ((!prefabBindings.length || materialsNeedRebuild(materials)) && prefabFiles.length) {
      prefabBindings = buildPrefabBindingsFromCache(cacheDir, guidMap, prefabFiles);
      if (prefabBindings.length) writePrefabBindingsCache(cacheDir, prefabBindings);
    }

    let maComponents = loadCachedMaComponents(cacheDir);
    if (!maComponents.length && prefabFiles.length) {
      maComponents = buildMaComponentsFromCache(cacheDir, prefabFiles);
      if (maComponents.length) writeMaComponentsCache(cacheDir, maComponents);
    }

    const vrcSummary = loadCachedVrcSummary(cacheDir);

    return { ok: true, cacheDir, meshes, textures, materials, prefabBindings, maComponents, vrcSummary, prefabs: prefabFiles };
  }
  return {
    ok: true,
    cacheDir,
    meshes: [],
    textures: [],
    materials: [],
    prefabBindings: [],
    maComponents: [],
    vrcSummary: summarizeVrcComponents([]),
    prefabs: [],
    noMeshFound: true,
  };
}

function spawnTarExtract(cmd, args) {
  return new Promise((resolve) => {
    let stderr = '';
    let stdout = '';
    let child;
    try {
      child = spawn(cmd, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ status: -1, error: e, stderr: e?.message || String(e) });
      return;
    }
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (e) => {
      resolve({ status: -1, error: e, stderr: e?.message || String(e), stdout });
    });
    child.on('close', (code) => {
      resolve({ status: code, stderr, stdout });
    });
  });
}

/**
 * Heavy extract work. Safe to run inside a Worker (blocks only the worker thread).
 * @returns {{ ok?: boolean, error?: string, cacheDir?: string, meshes?: any[], textures?: any[], materials?: any[], noMeshFound?: boolean }}
 */
function extractRelevantAssetsFromPackageSync(pkgPath, itemDir) {
  if (!fs.existsSync(pkgPath)) {
    return { error: 'package_not_found' };
  }

  const cacheDir = getPreviewCacheDir(itemDir, pkgPath);

  const cached = tryLoadFreshCache(pkgPath, cacheDir);
  if (cached) return cached;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkgpreview-'));
  try {
    const localPkgPath = path.join(tmpDir, 'pkg.unitypackage');
    fs.copyFileSync(pkgPath, localPkgPath);

    // Prefer Windows tar.exe; fall back to PATH "tar"
    const tarCandidates = [
      process.env.SYSTEMROOT ? path.join(process.env.SYSTEMROOT, 'System32', 'tar.exe') : '',
      'tar',
    ].filter(Boolean);

    // Sync spawn is OK inside worker; on main we never call this path.
    const { spawnSync } = require('child_process');
    let extracted = false;
    let lastErr = '';
    for (const cmd of tarCandidates) {
      const res = spawnSync(cmd, ['-xf', localPkgPath, '-C', tmpDir], { encoding: 'utf8' });
      if (res.status === 0) {
        extracted = true;
        break;
      }
      const msg = [res.error?.message || '', res.stderr || '', res.stdout || '']
        .filter(Boolean)
        .join(' ')
        .trim();
      lastErr = msg || `status=${res.status}`;
    }

    if (!extracted) {
      return { error: `tar_failed: ${lastErr}` };
    }

    const guidFolders = walkForGuidFolders(tmpDir);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });

    const meshes = [];
    const textures = [];
    const matFiles = [];
    const prefabFiles = [];
    const guidMap = new Map();

    for (const guidFolder of guidFolders) {
      const pathnameFile = path.join(guidFolder, 'pathname');
      const metaFile = path.join(guidFolder, 'asset.meta');
      let relAssetPath;
      try {
        relAssetPath = fs.readFileSync(pathnameFile, 'utf8').replace(/\\/g, '/').trim();
      } catch {
        continue;
      }
      if (!relAssetPath || !relAssetPath.startsWith('Assets/')) continue;
      if (fs.existsSync(metaFile)) {
        try {
          const guid = parseGuidFromMeta(fs.readFileSync(metaFile, 'utf8'));
          if (guid) guidMap.set(guid, relAssetPath.slice('Assets/'.length));
        } catch {
          // ignore
        }
      }
    }

    for (const guidFolder of guidFolders) {
      const pathnameFile = path.join(guidFolder, 'pathname');
      const assetFile = path.join(guidFolder, 'asset');
      if (!fs.existsSync(assetFile)) continue;

      let relAssetPath;
      try {
        relAssetPath = fs.readFileSync(pathnameFile, 'utf8').replace(/\\/g, '/').trim();
      } catch {
        continue;
      }
      if (!relAssetPath || !relAssetPath.startsWith('Assets/')) continue;

      const ext = path.extname(relAssetPath).toLowerCase();
      if (!isPreviewableExt(ext)) continue;

      const destRelPath = relAssetPath.slice('Assets/'.length);
      let destPath;
      try {
        destPath = safeResolveUnder(cacheDir, destRelPath);
      } catch {
        continue;
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      copyPreviewAssetWithMetaSync(assetFile, path.join(guidFolder, 'asset.meta'), destPath);

      const normalizedRelPath = destRelPath.replace(/\\/g, '/');
      if (PREVIEWABLE_MESH_EXTS.has(ext)) meshes.push({ relPath: normalizedRelPath, ext });
      else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.tga') {
        textures.push({ relPath: normalizedRelPath, ext });
      } else if (ext === '.mat' || ext === '.asset') {
        matFiles.push({ relPath: normalizedRelPath, ext });
      } else if (ext === '.prefab') {
        prefabFiles.push({ relPath: normalizedRelPath, ext });
      }
    }

    const materials = buildResolvedMaterials(cacheDir, guidMap, matFiles);
    const prefabBindings = buildPrefabBindingsFromCache(cacheDir, guidMap, prefabFiles);
    const maComponents = buildMaComponentsFromCache(cacheDir, prefabFiles);
    const vrcComponents = buildVrcComponentsFromCache(cacheDir, prefabFiles, guidMap);
    const vrcSummary = summarizeVrcComponents(vrcComponents);
    writeMaterialsCache(cacheDir, materials);
    writeGuidMapCache(cacheDir, guidMap);
    writePrefabBindingsCache(cacheDir, prefabBindings);
    writeMaComponentsCache(cacheDir, maComponents);
    writeVrcComponentsCache(cacheDir, vrcComponents);
    writeVrcSummaryCache(cacheDir, vrcSummary);

    const stat = fs.statSync(pkgPath);
    fs.writeFileSync(
      path.join(cacheDir, PREVIEW_CACHE_FLAG),
      JSON.stringify({
        sourceMtimeMs: stat.mtimeMs,
        sourceSize: stat.size,
        extractedAt: new Date().toISOString(),
        cacheVersion: PREVIEW_CACHE_VERSION,
        materialCount: materials.length,
        prefabBindingCount: prefabBindings.length,
      })
    );

    if (!meshes.length) {
      return {
        ok: true,
        cacheDir,
        meshes: [],
        textures,
        materials,
        prefabBindings,
        maComponents,
        vrcSummary,
        noMeshFound: true,
      };
    }
    return { ok: true, cacheDir, meshes, textures, materials, prefabBindings, maComponents, vrcSummary, prefabs: prefabFiles };
  } catch (e) {
    return { error: e?.message || String(e) };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Run extract on a Worker thread so Electron main never blocks (no "応答なし").
 */
function extractInWorker(pkgPath, itemDir, workerPath = path.join(__dirname, 'unity_model_preview_worker.js')) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let worker;
    try {
      worker = new Worker(workerPath, {
        workerData: { pkgPath, itemDir },
      });
    } catch {
      // Worker failed to start (packaging edge case) — fall back to async main-thread extract.
      extractOnMainAsync(pkgPath, itemDir).then(finish);
      return;
    }

    const timeoutMs = 10 * 60 * 1000;
    timer = setTimeout(() => {
      try {
        worker.terminate();
      } catch {
        // ignore
      }
      finish({ error: 'extract_timeout' });
    }, timeoutMs);
    timer.unref?.();

    worker.on('message', (msg) => {
      finish(msg && typeof msg === 'object' ? msg : { error: 'invalid_worker_result' });
      worker.terminate().catch(() => {});
    });
    worker.on('error', (err) => {
      finish({ error: err?.message || String(err) });
    });
    // Every exit path must settle. A worker that dies (or exits cleanly) without
    // posting a result would otherwise leave the IPC await pending forever and
    // freeze the preview on "読込中" — the timeout is already cleared by then.
    worker.on('exit', (code) => {
      finish({ error: `worker_exit_without_result_${code}` });
    });
  });
}

/**
 * Fallback: async extract on main with non-blocking tar + event-loop yields.
 * Still slower for huge packages than the worker path, but avoids spawnSync freezes.
 */
async function extractOnMainAsync(pkgPath, itemDir) {
  if (!fs.existsSync(pkgPath)) return { error: 'package_not_found' };

  const cacheDir = getPreviewCacheDir(itemDir, pkgPath);
  const cached = tryLoadFreshCache(pkgPath, cacheDir);
  if (cached) return cached;

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pkgpreview-'));
  try {
    const localPkgPath = path.join(tmpDir, 'pkg.unitypackage');
    await fsp.copyFile(pkgPath, localPkgPath);

    const tarCandidates = [
      process.env.SYSTEMROOT ? path.join(process.env.SYSTEMROOT, 'System32', 'tar.exe') : '',
      'tar',
    ].filter(Boolean);

    let extracted = false;
    let lastErr = '';
    for (const cmd of tarCandidates) {
      const res = await spawnTarExtract(cmd, ['-xf', localPkgPath, '-C', tmpDir]);
      if (res.status === 0) {
        extracted = true;
        break;
      }
      lastErr = [res.error?.message || '', res.stderr || '', res.stdout || '']
        .filter(Boolean)
        .join(' ')
        .trim() || `status=${res.status}`;
    }
    if (!extracted) return { error: `tar_failed: ${lastErr}` };

    // Remaining post-processing is still CPU/IO heavy — do it in small chunks with yields.
    const guidFolders = walkForGuidFolders(tmpDir);
    await fsp.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
    await fsp.mkdir(cacheDir, { recursive: true });

    const meshes = [];
    const textures = [];
    const matFiles = [];
    const prefabFiles = [];
    const guidMap = new Map();

    const YIELD_EVERY = 25;
    for (let i = 0; i < guidFolders.length; i++) {
      if (i > 0 && i % YIELD_EVERY === 0) {
        await new Promise((r) => setImmediate(r));
      }
      const guidFolder = guidFolders[i];
      const pathnameFile = path.join(guidFolder, 'pathname');
      const metaFile = path.join(guidFolder, 'asset.meta');
      let relAssetPath;
      try {
        relAssetPath = fs.readFileSync(pathnameFile, 'utf8').replace(/\\/g, '/').trim();
      } catch {
        continue;
      }
      if (!relAssetPath || !relAssetPath.startsWith('Assets/')) continue;
      if (fs.existsSync(metaFile)) {
        try {
          const guid = parseGuidFromMeta(fs.readFileSync(metaFile, 'utf8'));
          if (guid) guidMap.set(guid, relAssetPath.slice('Assets/'.length));
        } catch {
          // ignore
        }
      }
    }

    for (let i = 0; i < guidFolders.length; i++) {
      if (i > 0 && i % YIELD_EVERY === 0) {
        await new Promise((r) => setImmediate(r));
      }
      const guidFolder = guidFolders[i];
      const pathnameFile = path.join(guidFolder, 'pathname');
      const assetFile = path.join(guidFolder, 'asset');
      if (!fs.existsSync(assetFile)) continue;
      let relAssetPath;
      try {
        relAssetPath = fs.readFileSync(pathnameFile, 'utf8').replace(/\\/g, '/').trim();
      } catch {
        continue;
      }
      if (!relAssetPath || !relAssetPath.startsWith('Assets/')) continue;
      const ext = path.extname(relAssetPath).toLowerCase();
      if (!isPreviewableExt(ext)) continue;
      const destRelPath = relAssetPath.slice('Assets/'.length);
      let destPath;
      try {
        destPath = safeResolveUnder(cacheDir, destRelPath);
      } catch {
        continue;
      }
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await copyPreviewAssetWithMeta(assetFile, path.join(guidFolder, 'asset.meta'), destPath);
      const normalizedRelPath = destRelPath.replace(/\\/g, '/');
      if (PREVIEWABLE_MESH_EXTS.has(ext)) meshes.push({ relPath: normalizedRelPath, ext });
      else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.tga') {
        textures.push({ relPath: normalizedRelPath, ext });
      } else if (ext === '.mat' || ext === '.asset') {
        matFiles.push({ relPath: normalizedRelPath, ext });
      } else if (ext === '.prefab') {
        prefabFiles.push({ relPath: normalizedRelPath, ext });
      }
    }

    const materials = buildResolvedMaterials(cacheDir, guidMap, matFiles);
    const prefabBindings = buildPrefabBindingsFromCache(cacheDir, guidMap, prefabFiles);
    const maComponents = buildMaComponentsFromCache(cacheDir, prefabFiles);
    const vrcComponents = buildVrcComponentsFromCache(cacheDir, prefabFiles, guidMap);
    const vrcSummary = summarizeVrcComponents(vrcComponents);
    writeMaterialsCache(cacheDir, materials);
    writeGuidMapCache(cacheDir, guidMap);
    writePrefabBindingsCache(cacheDir, prefabBindings);
    writeMaComponentsCache(cacheDir, maComponents);
    writeVrcComponentsCache(cacheDir, vrcComponents);
    writeVrcSummaryCache(cacheDir, vrcSummary);
    const stat = fs.statSync(pkgPath);
    fs.writeFileSync(
      path.join(cacheDir, PREVIEW_CACHE_FLAG),
      JSON.stringify({
        sourceMtimeMs: stat.mtimeMs,
        sourceSize: stat.size,
        extractedAt: new Date().toISOString(),
        cacheVersion: PREVIEW_CACHE_VERSION,
        materialCount: materials.length,
        prefabBindingCount: prefabBindings.length,
      })
    );

    if (!meshes.length) {
      return {
        ok: true,
        cacheDir,
        meshes: [],
        textures,
        materials,
        prefabBindings,
        maComponents,
        vrcSummary,
        noMeshFound: true,
      };
    }
    return { ok: true, cacheDir, meshes, textures, materials, prefabBindings, maComponents, vrcSummary, prefabs: prefabFiles };
  } catch (e) {
    return { error: e?.message || String(e) };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Extracts mesh/texture/mat assets from a .unitypackage into a persistent cache.
 * Always returns a Promise. Heavy work runs off the Electron main thread (Worker).
 */
function extractRelevantAssetsFromPackage(pkgPath, itemDir) {
  if (!fs.existsSync(pkgPath)) {
    return Promise.resolve({ error: 'package_not_found' });
  }

  const cacheDir = getPreviewCacheDir(itemDir, pkgPath);

  const cached = tryLoadFreshCache(pkgPath, cacheDir);
  if (cached) return Promise.resolve(cached);

  const key = cacheDir;
  if (inflightExtracts.has(key)) {
    return inflightExtracts.get(key);
  }

  const job = extractInWorker(pkgPath, itemDir).finally(() => {
    inflightExtracts.delete(key);
  });
  inflightExtracts.set(key, job);
  return job;
}

module.exports = {
  extractRelevantAssetsFromPackage,
  extractRelevantAssetsFromPackageSync,
  extractInWorker,
  getPreviewCacheDir,
  isPreviewCacheFresh,
  listCachedFiles,
  buildResolvedMaterials,
  buildVrcComponentsFromCache,
  loadCachedMaterials,
  loadCachedVrcComponents,
  refreshCachedVrcComponents,
  refreshCachedVrcComponentsSync,
  summarizeVrcComponents,
  PREVIEWABLE_MESH_EXTS,
  PREVIEWABLE_AUX_EXTS,
  PREVIEW_CACHE_VERSION,
  PREVIEW_MATERIALS_JSON,
  PREVIEW_GUID_MAP_JSON,
  PREVIEW_PREFAB_BINDINGS_JSON,
  copyPreviewAssetWithMetaSync,
};
