'use strict';

/**
 * Parse Unity .prefab YAML for MeshRenderer / SkinnedMeshRenderer material bindings.
 * Used by model preview to assign the same .mat the Prefab uses (not FBX defaults).
 */

function parsePrefabDocuments(yamlText) {
  const text = String(yamlText || '');
  // Unity YAML docs start with --- !u!CLASSID &fileID (optionally " stripped" for
  // Nested Prefab / Prefab Variant override components).
  const parts = text.split(/^---\s*/m).filter((p) => p.trim());
  const docs = [];
  for (const part of parts) {
    const header = part.match(/!u!(\d+)\s+&(-?\d+)(\s+stripped\b)?/);
    if (!header) continue;
    docs.push({
      classId: header[1],
      fileId: header[2],
      stripped: !!header[3],
      body: part,
    });
  }
  return docs;
}

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
  const match = String(body || '').match(new RegExp('^[ \\t]*' + key + ':[ \\t]*(.*)$', 'm'));
  return match ? parseYamlScalar(match[1]) : fallback;
}

// Nested Prefab / Prefab Variant: a "stripped" renderer document carries no inline
// m_Materials/m_Mesh — it only points at the source object it overrides via
// m_CorrespondingSourceObject. The actual material/mesh data lives either on that
// source object (not present in our extracted file set) or as a diff entry in the
// enclosing !u!1001 PrefabInstance's m_Modification list.
function extractCorrespondingSource(body) {
  const m = body.match(/m_CorrespondingSourceObject:\s*\{fileID:\s*(-?\d+),\s*guid:\s*([a-f0-9]{32})/i);
  if (!m) return null;
  return { fileID: m[1], guid: m[2].toLowerCase() };
}

// Builds an index of PrefabInstance material-slot overrides, keyed by the stripped
// component's own "fileID|guid" (i.e. the same pair a stripped renderer's
// m_CorrespondingSourceObject points at), so a stripped SkinnedMeshRenderer/MeshRenderer
// can recover which .mat it actually uses in this particular prefab/variant.
function buildModificationIndex(docs) {
  const index = new Map();
  const entryRe = /-\s*target:\s*\{fileID:\s*(-?\d+),\s*guid:\s*([a-f0-9]{32})[^}]*\}\s*[\r\n]+\s*propertyPath:\s*([^\r\n]+)[\r\n]+\s*value:[^\r\n]*[\r\n]+\s*objectReference:\s*\{fileID:\s*(-?\d+)(?:,\s*guid:\s*([a-f0-9]{32}))?/gi;
  for (const d of docs) {
    if (d.classId !== '1001') continue;
    entryRe.lastIndex = 0;
    let m;
    while ((m = entryRe.exec(d.body))) {
      const [, fileID, guid, propertyPath, , refGuid] = m;
      if (!refGuid) continue;
      const key = `${fileID}|${guid}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ propertyPath: propertyPath.trim(), guid: refGuid.toLowerCase() });
    }
  }
  return index;
}

function extractName(body) {
  return scalar(body, 'm_Name', null);
}

function extractGameObjectFileId(body) {
  const m = body.match(/m_GameObject:\s*\{fileID:\s*(-?\d+)/);
  return m ? m[1] : null;
}

function extractIsActive(body) {
  const m = body.match(/m_IsActive:\s*(\d+)/);
  return m ? m[1] !== '0' : true;
}

function extractEnabled(body) {
  const m = body.match(/m_Enabled:\s*(\d+)/);
  return m ? m[1] !== '0' : true;
}

function extractMaterialGuids(body) {
  const block = body.match(/m_Materials:\s*\n((?:[ \t]*-[ \t]*\{[^}]*\}[ \t]*\n?)*)/);
  if (!block) return [];
  const guids = [];
  const re = /guid:\s*([a-f0-9]{32})/gi;
  let m;
  while ((m = re.exec(block[1]))) {
    guids.push(m[1].toLowerCase());
  }
  // Also handle stripped form on one line
  if (!guids.length) {
    const re2 = /m_Materials:[\s\S]{0,400}?guid:\s*([a-f0-9]{32})/i;
    const one = body.match(re2);
    if (one) guids.push(one[1].toLowerCase());
  }
  return guids;
}

function extractMeshGuid(body) {
  const m = body.match(/m_Mesh:\s*\{[^}]*guid:\s*([a-f0-9]{32})/i);
  return m ? m[1].toLowerCase() : null;
}

function extractSourcePrefabGuids(yamlText) {
  const guids = [];
  const seen = new Set();
  const re = /m_SourcePrefab:\s*\{fileID:\s*[^,}]+,\s*guid:\s*([a-f0-9]{32})/gi;
  let match;
  while ((match = re.exec(String(yamlText || '')))) {
    const guid = match[1].toLowerCase();
    if (seen.has(guid)) continue;
    seen.add(guid);
    guids.push(guid);
  }
  return guids;
}

/**
 * @param {string} yamlText
 * @param {{ relPath?: string, guidMap?: Map|Record<string,string> }} [opts]
 * @returns {Array<object>}
 */
function parsePrefabMaterialBindings(yamlText, opts = {}) {
  const guidMap = opts.guidMap || {};
  const lookup = (guid) => {
    if (!guid) return null;
    const key = String(guid).toLowerCase();
    if (guidMap instanceof Map) return guidMap.get(key) || null;
    return guidMap[key] || null;
  };

  const docs = parsePrefabDocuments(yamlText);
  const byId = new Map();
  for (const d of docs) {
    byId.set(d.fileId, {
      classId: d.classId,
      name: extractName(d.body),
      gameObject: extractGameObjectFileId(d.body),
      isActive: d.classId === '1' ? extractIsActive(d.body) : true,
      body: d.body,
    });
  }

  // !u!23 MeshRenderer, !u!137 SkinnedMeshRenderer
  // MeshFilter (!u!33) holds m_Mesh for MeshRenderer; SMR holds m_Mesh itself.
  const bindings = [];
  let modIndex = null; // built lazily; only needed when a stripped doc shows up

  for (const d of docs) {
    if (d.classId !== '137' && d.classId !== '23') continue;
    let matGuids = extractMaterialGuids(d.body);
    let meshGuid = extractMeshGuid(d.body);

    // Nested Prefab / Prefab Variant: this renderer has no inline data of its own —
    // recover the mesh from the source object it overrides (its guid already resolves
    // straight to the source FBX/prefab via guidMap), and recover any per-slot material
    // overrides this specific prefab applies from the enclosing PrefabInstance's diff list.
    if (d.stripped && (!matGuids.length || !meshGuid)) {
      const src = extractCorrespondingSource(d.body);
      if (src) {
        if (!meshGuid) meshGuid = src.guid;
        if (!matGuids.length) {
          if (!modIndex) modIndex = buildModificationIndex(docs);
          const mods = modIndex.get(`${src.fileID}|${src.guid}`) || [];
          const bySlot = new Map();
          for (const mod of mods) {
            const slotMatch = mod.propertyPath.match(/^m_Materials\.Array\.data\[(\d+)\]$/);
            if (!slotMatch) continue;
            bySlot.set(Number(slotMatch[1]), mod.guid);
          }
          if (bySlot.size) {
            const maxSlot = Math.max(...bySlot.keys());
            for (let i = 0; i <= maxSlot; i++) matGuids.push(bySlot.get(i) || null);
          }
        }
      }
    }
    if (!matGuids.length && !meshGuid) continue;

    // MeshRenderer: mesh is on sibling MeshFilter pointing at same GameObject
    if (!meshGuid && d.classId === '23') {
      const goId = extractGameObjectFileId(d.body);
      if (goId) {
        for (const other of docs) {
          if (other.classId !== '33') continue;
          if (extractGameObjectFileId(other.body) !== goId) continue;
          meshGuid = extractMeshGuid(other.body);
          if (meshGuid) break;
        }
      }
    }

    const goId = extractGameObjectFileId(d.body);
    const go = goId ? byId.get(goId) : null;
    const goName = go?.name || null;
    // Respect Unity's own default-enabled state: a disabled GameObject (m_IsActive: 0,
    // e.g. underwear hidden under clothes) or a disabled renderer component
    // (m_Enabled: 0) means this part is NOT shown by default in-game.
    const active = (go?.isActive !== false) && extractEnabled(d.body);

    const materialRelPaths = matGuids.map((g) => lookup(g));
    const materialNames = materialRelPaths.map((p, i) => {
      if (!p) return null;
      return String(p)
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/\.mat$/i, '')
        .replace(/\.asset$/i, '');
    });

    // Keep parallel arrays aligned with guids (null path/guid allowed for unresolved slots)
    const namesOut = materialNames.map((n, i) => n || (matGuids[i] ? `guid_${matGuids[i].slice(0, 8)}` : null));
    const pathsOut = materialRelPaths.map((p) => p || null);

    bindings.push({
      rendererClassId: d.classId,
      goName,
      active,
      meshGuid,
      meshRelPath: lookup(meshGuid),
      materialGuids: matGuids,
      materialRelPaths: pathsOut,
      materialNames: namesOut,
      prefabRelPath: opts.relPath || null,
    });
  }

  // Some Unity-authored Prefabs instantiate an FBX but serialize no stripped
  // SkinnedMeshRenderer document at all. The renderer/material overrides are then
  // entirely implicit in the FBX import and the only usable mesh reference is the
  // PrefabInstance's m_SourcePrefab. Keep a mesh-only binding for that legitimate
  // form so the preview does not silently drop the whole clothing/body FBX.
  for (const guid of extractSourcePrefabGuids(yamlText)) {
    const meshRelPath = lookup(guid);
    if (!/\.(?:fbx|obj)$/i.test(String(meshRelPath || ''))) continue;
    if (bindings.some((binding) => meshPathMatches(binding.meshRelPath, meshRelPath))) continue;
    const goName = String(meshRelPath)
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .replace(/\.(?:fbx|obj)$/i, '');
    bindings.push({
      rendererClassId: '137',
      goName,
      active: true,
      meshGuid: guid,
      meshRelPath,
      materialGuids: [],
      materialRelPaths: [],
      materialNames: [],
      prefabRelPath: opts.relPath || null,
      syntheticSourcePrefab: true,
    });
  }

  return bindings;
}

/**
 * Aggregate bindings from multiple prefabs; stable order.
 * @param {Array<{relPath:string, text:string}>} prefabFiles
 * @param {Map|Record<string,string>} guidMap
 */
function collectPrefabBindings(prefabFiles, guidMap) {
  const files = Array.isArray(prefabFiles) ? prefabFiles : [];
  const lookup = (guid) => {
    if (!guid) return null;
    const key = String(guid).toLowerCase();
    if (guidMap instanceof Map) return guidMap.get(key) || null;
    return guidMap?.[key] || null;
  };
  const normalizedPath = (value) => String(value || '').replace(/\\/g, '/');
  const fileByPath = new Map(files.map((file) => [normalizedPath(file.relPath), file]));
  const directByPath = new Map();
  for (const f of files) {
    const relPath = normalizedPath(f.relPath);
    try {
      const bindings = parsePrefabMaterialBindings(f.text, {
        relPath,
        guidMap,
      });
      directByPath.set(relPath, bindings);
    } catch {
      // ignore corrupt prefab
      directByPath.set(relPath, []);
    }
  }

  // A fully assembled avatar Prefab can be composed only from nested body/clothes
  // Prefabs and therefore contain no renderer documents of its own. Resolve that
  // cross-file inheritance when (and only when) the parent has no direct mesh
  // bindings, preserving the parent's identity so the UI can offer the complete
  // Prefab instead of only its individual source pieces.
  const resolvedByPath = new Map();
  const resolveBindings = (relPath, stack = new Set()) => {
    const normalized = normalizedPath(relPath);
    if (resolvedByPath.has(normalized)) return resolvedByPath.get(normalized);
    const direct = directByPath.get(normalized) || [];
    if (direct.length || stack.has(normalized)) {
      resolvedByPath.set(normalized, direct);
      return direct;
    }
    const file = fileByPath.get(normalized);
    if (!file) return [];
    const nextStack = new Set(stack);
    nextStack.add(normalized);
    const inherited = [];
    const seen = new Set();
    for (const guid of extractSourcePrefabGuids(file.text)) {
      const sourceRelPath = normalizedPath(lookup(guid));
      if (!/\.prefab$/i.test(sourceRelPath) || !fileByPath.has(sourceRelPath)) continue;
      for (const binding of resolveBindings(sourceRelPath, nextStack)) {
        const key = `${normalizedPath(binding.meshRelPath)}|${binding.goName || ''}|${(binding.materialRelPaths || []).join('|')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        inherited.push({
          ...binding,
          prefabRelPath: normalized,
          sourcePrefabRelPath: binding.prefabRelPath || sourceRelPath,
          inheritedPrefabBinding: true,
        });
      }
    }
    resolvedByPath.set(normalized, inherited);
    return inherited;
  };

  const out = [];
  for (const file of files) {
    for (const binding of resolveBindings(file.relPath)) out.push(binding);
  }
  // Prefer bindings that resolved both mesh + at least one material
  out.sort((a, b) => {
    const sa = (a.meshRelPath ? 2 : 0) + (a.materialRelPaths?.length ? 1 : 0);
    const sb = (b.meshRelPath ? 2 : 0) + (b.materialRelPaths?.length ? 1 : 0);
    return sb - sa;
  });
  return out;
}

function meshPathMatches(bindingMeshRelPath, meshRelPath) {
  const mesh = String(meshRelPath || '').replace(/\\/g, '/');
  const base = mesh.split('/').pop() || '';
  const mp = String(bindingMeshRelPath || '').replace(/\\/g, '/');
  if (!mp || !mesh) return false;
  return mp === mesh || mp.endsWith('/' + base) || mp.split('/').pop() === base;
}

function prefabDisplayName(prefabRelPath) {
  if (!prefabRelPath) return '';
  return String(prefabRelPath)
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/\.prefab$/i, '');
}

/**
 * Pick best preferred material name(s) for a mesh path from prefab bindings.
 * @param {Array<object>} bindings
 * @param {string} meshRelPath
 * @returns {{ preferredName: string|null, materialNames: string[], goName: string|null }}
 */
function resolvePreferredMaterialsForMesh(bindings, meshRelPath) {
  const list = Array.isArray(bindings) ? bindings : [];

  const matches = list.filter((b) => meshPathMatches(b.meshRelPath, meshRelPath));

  const pick = matches[0] || null;
  if (!pick) {
    // No mesh guid match — if exactly one binding in package, use it
    if (list.length === 1 && list[0].materialNames?.length) {
      return {
        preferredName: list[0].materialNames[0] || null,
        materialNames: list[0].materialNames.slice(),
        goName: list[0].goName || null,
        source: 'single_binding',
      };
    }
    return { preferredName: null, materialNames: [], goName: null, source: null };
  }

  return {
    preferredName: pick.materialNames[0] || null,
    materialNames: (pick.materialNames || []).slice(),
    goName: pick.goName || null,
    source: 'prefab',
    prefabRelPath: pick.prefabRelPath || null,
  };
}

/**
 * Color options for a mesh when colors are split across multiple Prefabs
 * (common BOOTH hair packs: Hair_Beige.prefab / Hair_Brown.prefab → same FBX, different .mat).
 *
 * @param {Array<object>} bindings prefabBindings from extract
 * @param {string} meshRelPath
 * @param {Array<object>} allMaterials resolved materials list
 * @returns {{
 *   mode: 'multi_prefab'|'single_prefab'|'none',
 *   defaultName: string|null,
 *   options: Array<{ materialName: string, material: object|null, prefabRelPath: string|null, prefabLabel: string, goName: string|null }>
 * }}
 */
function collectColorOptionsForMesh(bindings, meshRelPath, allMaterials) {
  const list = Array.isArray(bindings) ? bindings : [];
  const mats = Array.isArray(allMaterials) ? allMaterials : [];
  const byName = new Map(mats.map((m) => [String(m.name || '').toLowerCase(), m]));
  const byPath = new Map(
    mats.map((m) => [String(m.relPath || '').replace(/\\/g, '/').toLowerCase(), m])
  );

  let matches = list.filter((b) => meshPathMatches(b.meshRelPath, meshRelPath));
  // If nothing matched this mesh but several prefabs exist with materials, still offer them
  // when they all point at the same mesh basename family or only one mesh in package.
  if (!matches.length && list.length >= 2) {
    const meshBases = new Set(
      list.map((b) => String(b.meshRelPath || '').replace(/\\/g, '/').split('/').pop()).filter(Boolean)
    );
    if (meshBases.size <= 1) matches = list.slice();
  }

  const options = [];
  const seenMat = new Set();

  for (const b of matches) {
    const prefabLabel = prefabDisplayName(b.prefabRelPath);
    const names = b.materialNames || [];
    const paths = b.materialRelPaths || [];
    const n = Math.max(names.length, paths.length, 1);
    for (let i = 0; i < n; i++) {
      let mat =
        (names[i] && byName.get(String(names[i]).toLowerCase())) ||
        (paths[i] && byPath.get(String(paths[i]).replace(/\\/g, '/').toLowerCase())) ||
        null;
      const materialName = mat?.name || names[i] || null;
      if (!materialName) continue;
      const key = String(materialName).toLowerCase();
      if (seenMat.has(key)) {
        // Same mat referenced by multiple prefabs — keep first, note extra prefab in label later if needed
        continue;
      }
      seenMat.add(key);
      options.push({
        materialName,
        material: mat,
        prefabRelPath: b.prefabRelPath || null,
        prefabLabel,
        goName: b.goName || null,
      });
    }
  }

  // Distinct prefabs with different materials → multi_prefab color split
  const prefabKeys = new Set(options.map((o) => o.prefabRelPath || o.materialName));
  const matKeys = new Set(options.map((o) => o.materialName.toLowerCase()));
  let mode = 'none';
  if (options.length >= 2 && (prefabKeys.size >= 2 || matKeys.size >= 2)) {
    mode = prefabKeys.size >= 2 && matches.length >= 2 ? 'multi_prefab' : 'single_prefab';
    // If multiple matches from different prefab files → multi_prefab
    const prefabFiles = new Set(matches.map((b) => b.prefabRelPath).filter(Boolean));
    if (prefabFiles.size >= 2 && matKeys.size >= 2) mode = 'multi_prefab';
    else if (options.length >= 1) mode = matKeys.size >= 2 ? 'multi_prefab' : 'single_prefab';
  } else if (options.length === 1) {
    mode = 'single_prefab';
  }

  // Stable sort by prefab label / material name
  options.sort((a, b) => {
    const la = a.prefabLabel || a.materialName;
    const lb = b.prefabLabel || b.materialName;
    return String(la).localeCompare(String(lb), 'ja');
  });

  return {
    mode,
    defaultName: options[0]?.materialName || null,
    options,
    prefabCount: new Set(matches.map((b) => b.prefabRelPath).filter(Boolean)).size,
  };
}

module.exports = {
  parsePrefabDocuments,
  parsePrefabMaterialBindings,
  collectPrefabBindings,
  resolvePreferredMaterialsForMesh,
  collectColorOptionsForMesh,
  meshPathMatches,
  prefabDisplayName,
};
