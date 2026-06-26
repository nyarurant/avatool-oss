const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parentPort, workerData } = require('worker_threads');
const SCAN_CACHE_FILE_NAME = 'unitypackage_scan_cache.json';
const SCAN_CACHE_VERSION = 2;
const SCAN_CACHE_MAX_BYTES = 500 * 1024 * 1024; // 500 MiB
let scanCacheState = null;

function parseTarOctal(buf, offset, length) {
  let value = 0;
  const end = offset + length;
  let i = offset;
  while (i < end && (buf[i] === 0 || buf[i] === 32)) i += 1;
  for (; i < end; i += 1) {
    const c = buf[i];
    if (c < 48 || c > 55) break;
    value = (value * 8) + (c - 48);
  }
  return value;
}

function parseTarString(buf, offset, length) {
  let end = offset;
  const max = offset + length;
  while (end < max && buf[end] !== 0) end += 1;
  return buf.toString('utf8', offset, end);
}

function extractPathnamesNative(pkgPath) {
  const gzBuf = fs.readFileSync(pkgPath);
  const tarBuf = zlib.gunzipSync(gzBuf);
  const out = [];
  let pos = 0;
  while (pos + 512 <= tarBuf.length) {
    let allZero = true;
    for (let i = 0; i < 16; i++) { if (tarBuf[pos + i] !== 0) { allZero = false; break; } }
    if (allZero) break;
    const entryName = parseTarString(tarBuf, pos, 100);
    const size = parseTarOctal(tarBuf, pos + 124, 12);
    const dataStart = pos + 512;
    const dataEnd = Math.min(dataStart + size, tarBuf.length);
    if (entryName.endsWith('/pathname') && dataStart < dataEnd) {
      const pathname = tarBuf.toString('utf8', dataStart, dataEnd).replace(/\0+$/g, '').trim();
      if (pathname) out.push(normalizeAssetRelPath(pathname));
    }
    pos = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

function normalizeAssetRelPath(p) {
  return String(p || '').replace(/\\/g, '/').normalize('NFC').trim();
}

function normalizeProjectPath(projectPath) {
  const raw = String(projectPath || '').trim();
  if (!raw) return '';
  let resolved = path.resolve(raw).replace(/[\\/]+$/, '');
  if (process.platform === 'win32') resolved = resolved.toLowerCase();
  return resolved;
}

function normalizeCachePath(p) {
  let resolved = path.resolve(String(p || '').trim());
  if (process.platform === 'win32') resolved = resolved.toLowerCase();
  return resolved;
}

function buildTokensFromAssetPaths(assetPaths, candidateTokens = []) {
  const joined = (Array.isArray(assetPaths) ? assetPaths : []).join(' ').toLowerCase();
  const tokensSet = new Set();
  for (const cand of candidateTokens || []) {
    const key = String(cand || '').toLowerCase().normalize('NFC').trim();
    if (!key) continue;
    if (joined.includes(key)) tokensSet.add(key);
  }
  return Array.from(tokensSet);
}

function getScanCacheFilePath(appDataRoot) {
  const root = String(appDataRoot || '').trim();
  if (root) return path.join(root, SCAN_CACHE_FILE_NAME);
  return path.join(__dirname, SCAN_CACHE_FILE_NAME);
}

function loadScanCache(cacheFilePath) {
  if (!cacheFilePath) return { version: SCAN_CACHE_VERSION, entries: {} };
  try {
    if (!fs.existsSync(cacheFilePath)) return { version: SCAN_CACHE_VERSION, entries: {} };
    const raw = fs.readFileSync(cacheFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { version: SCAN_CACHE_VERSION, entries: {} };
    if (Number(parsed.version || 0) !== SCAN_CACHE_VERSION) {
      return { version: SCAN_CACHE_VERSION, entries: {} };
    }
    const entries = (parsed.entries && typeof parsed.entries === 'object') ? parsed.entries : {};
    return { version: SCAN_CACHE_VERSION, entries };
  } catch {
    return { version: SCAN_CACHE_VERSION, entries: {} };
  }
}

function getOrInitScanCache(appDataRoot) {
  const cacheFilePath = getScanCacheFilePath(appDataRoot);
  if (scanCacheState && scanCacheState.cacheFilePath === cacheFilePath) return scanCacheState;
  scanCacheState = {
    cacheFilePath,
    data: loadScanCache(cacheFilePath),
    dirty: false,
  };
  return scanCacheState;
}

function estimateEntryBytes(entry) {
  try {
    return Buffer.byteLength(JSON.stringify(entry), 'utf8');
  } catch {
    return 0;
  }
}

function pruneScanCacheEntries(entries, maxBytes = SCAN_CACHE_MAX_BYTES) {
  const rows = Object.entries(entries || {}).map(([key, value]) => {
    const bytes = Number(value?.bytes || 0) > 0 ? Number(value.bytes) : estimateEntryBytes(value);
    return {
      key,
      value: { ...(value || {}), bytes },
      lastUsedAt: Number(value?.lastUsedAt || 0),
      bytes,
    };
  });
  let totalBytes = rows.reduce((acc, r) => acc + Math.max(0, Number(r.bytes || 0)), 0);
  if (totalBytes <= maxBytes) return { entries, totalBytes };
  rows.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  for (const r of rows) {
    if (totalBytes <= maxBytes) break;
    delete entries[r.key];
    totalBytes -= Math.max(0, Number(r.bytes || 0));
  }
  return { entries, totalBytes };
}

function flushScanCache(appDataRoot) {
  const state = getOrInitScanCache(appDataRoot);
  if (!state?.dirty) return;
  try {
    const parent = path.dirname(state.cacheFilePath);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    pruneScanCacheEntries(state.data.entries, SCAN_CACHE_MAX_BYTES);
    const out = {
      version: SCAN_CACHE_VERSION,
      entries: state.data.entries,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(state.cacheFilePath, JSON.stringify(out), 'utf8');
    state.dirty = false;
  } catch {
    // ignore cache write failure
  }
}

function getPackageIdentity(pkgPath) {
  let st;
  try { st = fs.statSync(pkgPath); } catch { throw new Error('package_not_found'); }
  const norm = normalizeCachePath(pkgPath);
  const size = Number(st.size || 0);
  const mtimeMs = Number(st.mtimeMs || 0);
  const key = `${norm}::${size}::${mtimeMs}`;
  return { key, norm, size, mtimeMs };
}

function listProjectRelativePaths(projectPath, limit = 40000) {
  const out = [];
  const root = path.join(projectPath, 'Assets');
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = normalizeAssetRelPath(path.relative(projectPath, full));
      if (e.isDirectory()) stack.push(full);
      out.push(rel);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function scanUnityPackageLite(pkgPath, candidateTokens = [], options = {}) {
  const appDataRoot = String(options?.appDataRoot || '').trim();
  const cache = getOrInitScanCache(appDataRoot);
  const identity = getPackageIdentity(pkgPath); // statSync で存在確認も兼ねる（例外なら package_not_found 扱い）
  const nowIso = new Date().toISOString();
  const hit = cache.data.entries?.[identity.key];
  if (hit && Array.isArray(hit?.assetPaths) && Array.isArray(hit?.topFolders)) {
    // lastUsedAt は1時間以上経過した場合のみ更新（毎ヒットで dirty にしない）
    const now = Date.now();
    if (now - Number(hit.lastUsedAt || 0) > 3600000) {
      hit.lastUsedAt = now;
      cache.dirty = true;
    }
    const tokens = Array.isArray(hit.allTokens) && candidateTokens.length
      ? hit.allTokens.filter((t) => candidateTokens.some((c) => String(c || '').toLowerCase().normalize('NFC').trim() === t))
      : buildTokensFromAssetPaths(hit.assetPaths, candidateTokens);
    return { topFolders: hit.topFolders, tokens, assetPaths: hit.assetPaths, lcAssetPaths: hit.lcAssetPaths };
  }

  const rawPaths = extractPathnamesNative(pkgPath);

    const assetPaths = rawPaths.filter((p) => p.startsWith('Assets/') || p.startsWith('Packages/'));
    const assetsOnlyPaths = assetPaths.filter((p) => p.startsWith('Assets/'));

    const topFoldersMap = {};
    for (const p of assetsOnlyPaths) {
      const segs = p.split('/');
      if (segs.length >= 2 && segs[1]) {
        const top = segs[1];
        topFoldersMap[top] = (topFoldersMap[top] || 0) + 1;
      }
    }
    const topFolders = Object.entries(topFoldersMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const tokens = buildTokensFromAssetPaths(assetPaths, candidateTokens);
    const entry = {
      packagePath: identity.norm,
      size: identity.size,
      mtimeMs: identity.mtimeMs,
      scannedAt: nowIso,
      lastUsedAt: Date.now(),
      topFolders,
      assetPaths,
      lcAssetPaths: assetPaths.map((p) => p.toLowerCase()),
      allTokens: buildTokensFromAssetPaths(assetPaths, []),
    };
    entry.bytes = estimateEntryBytes(entry);
    if (entry.bytes <= SCAN_CACHE_MAX_BYTES) {
      cache.data.entries[identity.key] = entry;
      cache.dirty = true;
      pruneScanCacheEntries(cache.data.entries, SCAN_CACHE_MAX_BYTES);
    }

    return {
      topFolders,
      tokens,
      assetPaths,
      lcAssetPaths: entry.lcAssetPaths,
    };
}

function reconcilePackageToProject(projectPath, pkg, threshold = 0.6, projectPathsSet = null, projectLcPaths = null, projectWords = null) {
  const packagePath = String(pkg?.packagePath || '').trim();
  const candidateTokens = Array.isArray(pkg?.candidateTokens) ? pkg.candidateTokens : [];
  const meta = pkg?.meta && Array.isArray(pkg.meta.assetPaths)
    ? pkg.meta
    : scanUnityPackageLite(packagePath, candidateTokens, {
      appDataRoot: pkg?.appDataRoot,
    });

  const assetPaths = (Array.isArray(meta?.assetPaths) ? meta.assetPaths : []).map(normalizeAssetRelPath);
  const lcAssetPaths = Array.isArray(meta?.lcAssetPaths) ? meta.lcAssetPaths : assetPaths.map((p) => p.toLowerCase());
  const topFolders = Array.isArray(meta?.topFolders) ? meta.topFolders : [];
  const tokens = (Array.isArray(meta?.tokens) ? meta.tokens : [])
    .map((t) => String(t || '').toLowerCase().normalize('NFC').trim())
    .filter(Boolean);

  const existingAssetPaths = [];
  for (let i = 0; i < assetPaths.length; i++) {
    const check = projectPathsSet
      ? projectPathsSet.has(lcAssetPaths[i])
      : fs.existsSync(path.join(projectPath, assetPaths[i].replace(/\//g, path.sep)));
    if (check) existingAssetPaths.push(assetPaths[i]);
  }

  const existingTopFolders = [];
  for (const tf of topFolders) {
    const tfName = String(tf?.name || '');
    const check = projectPathsSet
      ? projectPathsSet.has(`assets/${tfName.toLowerCase()}`)
      : fs.existsSync(path.join(projectPath, 'Assets', tfName));
    if (check) existingTopFolders.push(tf);
  }

  const tokenMatches = tokens.filter((t) => {
    if (projectWords?.has(t)) return true;
    if (projectLcPaths) return projectLcPaths.some((p) => p.includes(t));
    if (projectPathsSet) return [...projectPathsSet].some((p) => p.includes(t));
    return false;
  });

  const total = assetPaths.length;
  const matchedAssetCount = existingAssetPaths.length;
  const matchedTopFolderCount = existingTopFolders.length;
  const tokenMatchCount = tokenMatches.length;

  const topWeight = 10;
  const assetWeight = 5;
  const tokenWeight = 1;
  const maxScore = (topFolders.length * topWeight) + (assetPaths.length * assetWeight) + (tokens.length * tokenWeight);
  const rawScore = (matchedTopFolderCount * topWeight) + (matchedAssetCount * assetWeight) + (tokenMatchCount * tokenWeight);
  const score = maxScore > 0 ? rawScore / maxScore : 0;
  const matched = score >= threshold;

  return {
    itemId: String(pkg?.itemId || ''),
    title: String(pkg?.title || ''),
    packagePath,
    meta: {
      topFolders,
      tokens,
      assetPaths,
    },
    matched,
    score,
    threshold,
    scoreBreakdown: {
      rawScore,
      maxScore,
      topWeight,
      assetWeight,
      tokenWeight,
      tokenMatchCount,
    },
    matchedAssetCount,
    totalAssetCount: total,
    matchedTopFolderCount,
    tokenMatchCount,
    tokenMatches,
    existingTopFolders,
    sampleExistingPaths: existingAssetPaths.slice(0, 20),
    normalizedProjectPath: normalizeProjectPath(projectPath),
  };
}

function runScanBatch(payload) {
  const packages = Array.isArray(payload?.packages) ? payload.packages : [];
  const appDataRoot = String(payload?.appDataRoot || '').trim();
  const results = packages.map(({ pkgPath, candidateTokens }) => {
    const p = String(pkgPath || '').trim();
    try {
      const meta = scanUnityPackageLite(p, Array.isArray(candidateTokens) ? candidateTokens : [], { appDataRoot });
      return { ok: true, ...meta };
    } catch (e) {
      return { ok: false, error: e?.message || String(e), pkgPath: p };
    }
  });
  return { ok: true, results };
}

function runScan(payload) {
  const pkgPath = String(payload?.pkgPath || '').trim();
  const candidateTokens = Array.isArray(payload?.candidateTokens) ? payload.candidateTokens : [];
  const scanned = scanUnityPackageLite(pkgPath, candidateTokens, {
    appDataRoot: payload?.appDataRoot,
  });
  return { ok: true, ...scanned };
}

function runReconcile(payload) {
  const projectPath = String(payload?.projectPath || '').trim();
  const packages = Array.isArray(payload?.packages) ? payload.packages : [];
  const threshold = Number(payload?.threshold ?? 0.6);

  if (!projectPath || !fs.existsSync(projectPath)) return { error: 'project_not_found' };
  if (!packages.length) return { error: 'no_packages' };

  const validPackages = [];
  const invalidPaths = [];
  for (const p of packages) {
    const pkgPath = String(p?.packagePath || '').trim();
    if (!pkgPath) continue;
    validPackages.push({ ...p, packagePath: pkgPath });
  }
  if (!validPackages.length) {
    return {
      ok: true,
      projectPath,
      threshold,
      total: packages.length,
      scanned: 0,
      matched: 0,
      invalidPaths,
      results: [],
    };
  }

  // キャッシュ済みインデックスがあればプロジェクト走査をスキップ
  let projectPathsSet, projectLcPaths, projectWords, indexFromCache;
  const injected = payload?.projectIndex;
  if (injected && injected.pathsSet && injected.lcPaths && injected.words) {
    projectPathsSet = new Set(injected.pathsSet);
    projectLcPaths = injected.lcPaths;
    projectWords = new Set(injected.words);
    indexFromCache = true;
  } else {
    const projectRelPaths = listProjectRelativePaths(projectPath);
    projectLcPaths = projectRelPaths.map((p) => p.toLowerCase());
    projectPathsSet = new Set(projectLcPaths);
    projectWords = new Set();
    for (const lp of projectLcPaths) {
      for (const seg of lp.split('/')) {
        for (const part of seg.split(/[.\-_]/)) {
          if (part.length >= 2) projectWords.add(part);
        }
      }
    }
    indexFromCache = false;
  }

  const results = validPackages.map((pkg) => reconcilePackageToProject(projectPath, {
    ...pkg,
    appDataRoot: payload?.appDataRoot,
  }, threshold, projectPathsSet, projectLcPaths, projectWords));
  const matched = results.filter((r) => r.matched).length;

  return {
    ok: true,
    projectPath,
    threshold,
    total: packages.length,
    scanned: results.length,
    matched,
    invalidPaths,
    results,
    // キャッシュ未使用の場合はインデックスを返してメインプロセスが保存
    projectIndex: indexFromCache ? null : {
      pathsSet: Array.from(projectPathsSet),
      lcPaths: projectLcPaths,
      words: Array.from(projectWords),
    },
  };
}

(function main() {
  try {
    const mode = String(workerData?.mode || '');
    let result;
    if (mode === 'scan') {
      result = runScan(workerData?.payload || {});
    } else if (mode === 'scan_batch') {
      result = runScanBatch(workerData?.payload || {});
    } else if (mode === 'reconcile') {
      result = runReconcile(workerData?.payload || {});
    } else {
      result = { error: `unknown_mode:${mode}` };
    }
    flushScanCache(workerData?.payload?.appDataRoot);
    parentPort.postMessage(result);
  } catch (e) {
    flushScanCache(workerData?.payload?.appDataRoot);
    parentPort.postMessage({ error: e?.message || String(e) });
  }
})();
