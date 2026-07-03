'use strict';

function createMetaManager(deps) {
  const {
    fs,
    path,
    zlib,
    pathToFileURL,
    META_PATH,
    AVATARS_PATH,
    CACHE_DIR,
    AUTHOR_ICON_DIR,
    APP_DATA_ROOT,
    LEGACY_APP_ROOT,
    AUTO_BOOTSTRAP_FIXED_ITEMS,
    getSettings,
    getMainWindow,
    getQueueSender,
    backupCorruptedJson,
    generateLibraryMeta,
    checkLibraryHasNewItems,
    applyVersionTracking,
    generateFilesHash,
    generateFilesStableHash,
    dedupeMetaItemsByItemId,
    listUnityPackagesInDir,
    buildItemDir,
    runWithBoothCookieLoginFallback,
    dbgUpdate,
    appendAvatarDebugLog,
    dedupeDownloadLinks,
    iconvLite,
  } = deps;

  const ENV_DEBUG_VERBOSE = /^(1|true|on)$/i.test(String(process.env.AVATOOL_DEBUG_VERBOSE || '').trim());

  function isDebugVerboseEnabled() {
    if (ENV_DEBUG_VERBOSE) return true;
    try {
      return Boolean(getSettings?.()?.debugLogEnabled);
    } catch {
      return false;
    }
  }

  function dbgAvatar(...args) {
    if (!isDebugVerboseEnabled()) return;
    console.log('[AVATAR-DEBUG]', ...args);
    if (typeof appendAvatarDebugLog === 'function') appendAvatarDebugLog(...args);
  }

  function scoreReasons(reasons) {
    return (Array.isArray(reasons) ? reasons : []).map((reason) => ({
      reason,
      weight: SIGNAL_WEIGHTS[reason] || 1,
    }));
  }

  function scoreReasonTotal(reasons) {
    return scoreReasons(reasons).reduce((sum, row) => sum + row.weight, 0);
  }

  function hasLocalAvatarEvidence(reasons) {
    const localReasons = new Set(['pkg直接フォルダ一致', '同梱README一致', 'フォルダ一致', 'pkgファイル一致']);
    return (Array.isArray(reasons) ? reasons : []).some((reason) => localReasons.has(reason));
  }

  function buildAvatarScoreDebugRows(signalMap, inferredFromMeta = []) {
    const metaNames = (Array.isArray(inferredFromMeta) ? inferredFromMeta : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean);
    const metaSet = new Set(
      metaNames
        .map((name) => normalizeAvatarMatchText(name))
        .filter(Boolean)
    );
    const entries = Object.entries(signalMap || {});
    for (const name of metaNames) {
      const key = normalizeAvatarMatchText(name);
      if (!key) continue;
      if (!entries.some(([existing]) => normalizeAvatarMatchText(existing) === key)) {
        entries.push([name, []]);
      }
    }
    return entries
      .map(([name, reasons]) => {
        const breakdown = scoreReasons(reasons);
        const score = breakdown.reduce((sum, row) => sum + row.weight, 0);
        return {
          name,
          score,
          acceptedBySignals: score >= 6 && hasLocalAvatarEvidence(reasons),
          acceptedByMeta: metaSet.has(normalizeAvatarMatchText(name)),
          blockedReason: score >= 6 && !hasLocalAvatarEvidence(reasons) ? 'weak_sources_without_local_evidence' : '',
          breakdown,
        };
      })
      .sort((a, b) => b.score - a.score || String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
  }

  function countSignalNames(signalMap) {
    return Object.keys(signalMap || {}).length;
  }

  function countReadmeFilesShallow(extractedRoot) {
    if (!extractedRoot || !fs.existsSync(extractedRoot)) return 0;
    const README_EXTS = new Set(['.txt', '.md', '.pdf']);
    try {
      return fs.readdirSync(extractedRoot, { withFileTypes: true })
        .filter((ent) => ent?.isFile?.() && README_EXTS.has(path.extname(String(ent?.name || '')).toLowerCase()))
        .length;
    } catch {
      return 0;
    }
  }

  function buildAvatarAnalysisInputDebugSummary(item, itemDir, extractedRoot, isTextureCategory) {
    let packageCount = 0;
    try {
      packageCount = listUnityPackagesInDir(itemDir).length;
    } catch {
      packageCount = 0;
    }
    return {
      itemId: String(item?.itemId || ''),
      itemName: String(item?.itemName || item?.title || ''),
      isAvatarItem: Boolean(item?.isAvatarItem),
      primaryCategory: String(item?.primaryCategory?.text || item?.primaryCategory?.name || ''),
      isTextureCategory: Boolean(isTextureCategory),
      hasExtracted: Boolean(extractedRoot && fs.existsSync(extractedRoot)),
      packageCount,
      readmeCount: countReadmeFilesShallow(extractedRoot),
      tagCount: Array.isArray(item?.tagNames) ? item.tagNames.length : 0,
      downloadLinkCount: Array.isArray(item?.downloadLinks) ? item.downloadLinks.length : 0,
    };
  }

  function buildAvatarSignalSourceCounts(sources) {
    return {
      meta: Array.isArray(sources?.meta) ? sources.meta.length : 0,
      folder: countSignalNames(sources?.folder),
      readme: countSignalNames(sources?.readme),
      title: countSignalNames(sources?.title),
      description: countSignalNames(sources?.description),
      tags: countSignalNames(sources?.tags),
    };
  }

  // Internal mutable state
  let metaCache = null;
  let metaCacheAvatarEnriched = false;
  let didStartupNewItemCheck = false;
  let startupMetaRefreshPromise = null;
  let postLoginRefreshPromise = null;
  let avatarNameCache = { mtimeMs: -1, names: [], entries: [] };
  let unitypackagePathNameCache = new Map();

  // ---------------------------------------------------------------------------
  // Disk cache for unitypackage scan results
  // ---------------------------------------------------------------------------
  const PKG_SCAN_DISK_CACHE_PATH = path.join(APP_DATA_ROOT, 'avatar_pkg_scan_cache.json');
  const PKG_SCAN_DISK_CACHE_VERSION = 1;
  const PKG_SCAN_DISK_CACHE_MAX = 300;
  let pkgScanDiskCache = null;
  let pkgScanDiskCacheDirty = false;

  function loadPkgScanDiskCache() {
    if (pkgScanDiskCache) return;
    try {
      if (!fs.existsSync(PKG_SCAN_DISK_CACHE_PATH)) {
        pkgScanDiskCache = {};
        return;
      }
      const raw = JSON.parse(fs.readFileSync(PKG_SCAN_DISK_CACHE_PATH, 'utf8'));
      if (raw?.version === PKG_SCAN_DISK_CACHE_VERSION && raw?.entries && typeof raw.entries === 'object') {
        pkgScanDiskCache = raw.entries;
      } else {
        pkgScanDiskCache = {};
      }
    } catch {
      pkgScanDiskCache = {};
    }
  }

  function savePkgScanDiskCache() {
    if (!pkgScanDiskCacheDirty || !pkgScanDiskCache) return;
    try {
      // Keep only the most recent PKG_SCAN_DISK_CACHE_MAX entries
      const entries = pkgScanDiskCache;
      const keys = Object.keys(entries);
      if (keys.length > PKG_SCAN_DISK_CACHE_MAX) {
        const sorted = keys.sort((a, b) => Number(entries[b]?.t || 0) - Number(entries[a]?.t || 0));
        for (const k of sorted.slice(PKG_SCAN_DISK_CACHE_MAX)) delete entries[k];
      }
      fs.writeFileSync(
        PKG_SCAN_DISK_CACHE_PATH,
        JSON.stringify({ version: PKG_SCAN_DISK_CACHE_VERSION, entries }),
        'utf8'
      );
      pkgScanDiskCacheDirty = false;
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Avatar helper functions
  // ---------------------------------------------------------------------------

  function normalizeAvatarAliasValues(value) {
    if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter((s) => s.length >= 2);
    const s = String(value || '').trim();
    return s.length >= 2 ? [s] : [];
  }

  function collectAvatarLookupNamesFromRows(rows) {
    const set = new Set();
    for (const row of (Array.isArray(rows) ? rows : [])) {
      if (!row || typeof row !== 'object') continue;
      const primary = String(row.name || '').trim();
      if (primary.length >= 2) set.add(primary);
      for (const v of normalizeAvatarAliasValues(row.alphabet)) set.add(v);
      for (const v of normalizeAvatarAliasValues(row.hiragana)) set.add(v);
      for (const v of normalizeAvatarAliasValues(row.katakana)) set.add(v);
      for (const v of normalizeAvatarAliasValues(row.kanji)) set.add(v);
    }
    return Array.from(set).slice(0, 4000);
  }

  function pickAvatarDisplayNameFromRow(row) {
    const kata = normalizeAvatarAliasValues(row?.katakana);
    if (kata.length > 0) return kata[0];
    const hira = normalizeAvatarAliasValues(row?.hiragana);
    if (hira.length > 0) return hira[0];
    const alpha = normalizeAvatarAliasValues(row?.alphabet);
    if (alpha.length > 0) return alpha[0];
    return String(row?.name || '').trim();
  }

  function buildAvatarEntriesFromRows(rows) {
    const out = [];
    for (const row of (Array.isArray(rows) ? rows : [])) {
      if (!row || typeof row !== 'object') continue;
      const label = String(pickAvatarDisplayNameFromRow(row) || '').trim();
      if (!label) continue;
      const aliases = collectAvatarLookupNamesFromRows([row]);
      if (!aliases.length) continue;
      out.push({ label, aliases });
    }
    return out.slice(0, 2000);
  }

  function parseAvatarRowsSafe(rawText) {
    const text = String(rawText || '');
    if (!text.trim()) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      const out = [];
      const re = /"name"\s*:\s*"([^"]+)"/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const name = String(m[1] || '').trim();
        if (!name) continue;
        out.push({ name });
      }
      return out;
    }
  }

  function loadAvatarNamesCached() {
    try {
      if (!fs.existsSync(AVATARS_PATH)) return [];
      const st = fs.statSync(AVATARS_PATH);
      const mtimeMs = Number(st?.mtimeMs || 0);
      if (
        avatarNameCache.mtimeMs === mtimeMs
        && Array.isArray(avatarNameCache.names)
        && Array.isArray(avatarNameCache.entries)
      ) {
        return avatarNameCache.names;
      }
      const parsed = parseAvatarRowsSafe(fs.readFileSync(AVATARS_PATH, 'utf8'));
      const rows = Array.isArray(parsed) ? parsed : [];
      const names = collectAvatarLookupNamesFromRows(rows);
      const entries = buildAvatarEntriesFromRows(rows);
      avatarNameCache = { mtimeMs, names, entries };
      return names;
    } catch {
      return [];
    }
  }

  function loadAvatarEntriesCached() {
    loadAvatarNamesCached();
    return Array.isArray(avatarNameCache.entries) ? avatarNameCache.entries : [];
  }

  function normalizeAvatarMatchText(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[._\-()\[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function kanaToHiragana(value) {
    return String(value || '').replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }

  function kanaToKatakana(value) {
    return String(value || '').replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  }

  function splitAvatarMatchTokens(value) {
    const normalized = normalizeAvatarMatchText(value);
    if (!normalized) return [];
    return normalized.split(' ').map((v) => v.trim()).filter(Boolean);
  }

  function isLikelyCjkText(value) {
    return /[\u3040-\u30FF\u3400-\u9FFF々]/u.test(String(value || ''));
  }

  function collectExtractedNameRowsLimited(rootDir, maxEntries = 2400) {
    const out = [];
    if (!rootDir || !fs.existsSync(rootDir)) return out;
    const stack = [rootDir];
    while (stack.length && out.length < maxEntries) {
      const cur = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        const name = String(ent?.name || '').trim();
        if (!name) continue;
        const full = path.join(cur, name);
        if (ent.isDirectory()) {
          out.push({ raw: name, kind: 'dir' });
          if (out.length >= maxEntries) break;
          stack.push(full);
          continue;
        }
        if (!ent.isFile()) continue;
        out.push({ raw: name, kind: 'file' });
        if (out.length >= maxEntries) break;
        const ext = path.extname(name);
        const stem = ext ? name.slice(0, -ext.length).trim() : '';
        if (stem && stem !== name) {
          out.push({ raw: stem, kind: 'file' });
          if (out.length >= maxEntries) break;
        }
      }
    }
    return out;
  }

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

  function addPathSegmentsAsRows(pathText, out, maxEntries) {
    const raw = String(pathText || '').trim();
    if (!raw) return;
    const normalized = raw.replace(/\\/g, '/');
    const parts = normalized.split('/').map((p) => String(p || '').trim()).filter(Boolean);
    const assetsIdx = parts.findIndex((p) => p.toLowerCase() === 'assets');
    for (let i = 0; i < parts.length; i += 1) {
      // Direct child of Assets/ is the avatar folder → highest confidence signal
      const kind = (assetsIdx >= 0 && i === assetsIdx + 1) ? 'pkg-top' : 'pkg';
      out.push({ raw: parts[i], kind });
      if (out.length >= maxEntries) break;
    }
  }

  function extractUnitypackageNameRowsCached(pkgPath, maxEntries = 1200) {
    try {
      const full = String(pkgPath || '').trim();
      if (!full || !fs.existsSync(full)) return [];
      const st = fs.statSync(full);
      const cacheKey = `${full}|${Number(st.mtimeMs || 0)}|${Number(st.size || 0)}|${maxEntries}|v2`;

      // 1. In-memory cache
      const cached = unitypackagePathNameCache.get(cacheKey);
      if (Array.isArray(cached)) return cached;

      // 2. Disk cache (avoids re-gunzip across sessions)
      loadPkgScanDiskCache();
      const diskHit = pkgScanDiskCache?.[cacheKey];
      if (diskHit && Array.isArray(diskHit.rows)) {
        unitypackagePathNameCache.set(cacheKey, diskHit.rows);
        return diskHit.rows;
      }

      const gzBuf = fs.readFileSync(full);
      const tarBuf = zlib.gunzipSync(gzBuf);
      const out = [];
      let pos = 0;
      while (pos + 512 <= tarBuf.length && out.length < maxEntries) {
        const header = tarBuf.subarray(pos, pos + 512);
        let allZero = true;
        for (let i = 0; i < 512; i += 1) {
          if (header[i] !== 0) { allZero = false; break; }
        }
        if (allZero) break;

        const entryName = parseTarString(tarBuf, pos, 100);
        const size = parseTarOctal(tarBuf, pos + 124, 12);
        const dataStart = pos + 512;
        const dataEnd = Math.min(dataStart + Math.max(0, size), tarBuf.length);
        if (entryName.endsWith('/pathname') && dataStart < dataEnd) {
          const pathname = tarBuf.toString('utf8', dataStart, dataEnd).replace(/\0+$/g, '').trim();
          addPathSegmentsAsRows(pathname, out, maxEntries);
        }

        const aligned = Math.ceil(Math.max(0, size) / 512) * 512;
        pos = dataStart + aligned;
      }

      if (unitypackagePathNameCache.size > 200) {
        // keep cache bounded — evict oldest 50 entries at once
        let evicted = 0;
        for (const k of unitypackagePathNameCache.keys()) {
          unitypackagePathNameCache.delete(k);
          if (++evicted >= 50) break;
        }
      }
      unitypackagePathNameCache.set(cacheKey, out);
      // 3. Write to disk cache so next session skips gunzip
      if (pkgScanDiskCache) {
        pkgScanDiskCache[cacheKey] = { rows: out, t: Date.now() };
        pkgScanDiskCacheDirty = true;
      }
      return out;
    } catch {
      return [];
    }
  }

  function collectUnitypackageNameRowsLimited(itemDir, maxEntries = 1200) {
    const out = [];
    const pkgPaths = listUnityPackagesInDir(itemDir);
    for (const pkg of pkgPaths) {
      const rows = extractUnitypackageNameRowsCached(pkg, Math.max(200, maxEntries - out.length));
      out.push(...rows);
      if (out.length >= maxEntries) break;
    }
    return out;
  }

  function scoreAvatarMatchRow(row, key, keyTokens, compactKey, cjk) {
    const normalized = String(row?.normalized || '');
    const tokens = Array.isArray(row?.tokens) ? row.tokens : [];
    const kind = String(row?.kind || 'dir');

    // Assets/ direct child in unitypackage = highest confidence
    if (kind === 'pkg-top') {
      if (tokens.includes(key)) return 8;
      if (keyTokens.length > 1 && keyTokens.every((t) => tokens.includes(t))) return 7;
      if (cjk && compactKey.length >= 3 && normalized.includes(key)) return 5;
      if (!cjk && compactKey.length >= 4 && normalized.includes(key)) return 4;
      return 0;
    }

    const exactScore = kind === 'dir' ? 3 : 2;
    const tokenScore = kind === 'dir' ? 2 : 1;
    const includeScore = kind === 'dir' ? 1 : 1;

    if (tokens.includes(key)) return exactScore;
    if (keyTokens.length > 1 && keyTokens.every((t) => tokens.includes(t))) return tokenScore;
    if (!cjk && compactKey.length >= 4 && normalized.includes(key)) return includeScore;
    if (cjk && compactKey.length >= 3 && normalized.includes(key)) return includeScore + 1;
    return 0;
  }

  function inferSupportedAvatarsFromMetaFields(item, avatarEntries) {
    void item;
    void avatarEntries;
    return [];
  }

  function inferSupportedAvatarsFromFolders(itemDir, avatarEntries) {
    const extractedRoot = path.join(String(itemDir || ''), '__extracted');
    if (!fs.existsSync(extractedRoot)) return [];
    const dict = Array.isArray(avatarEntries) ? avatarEntries : [];
    if (!dict.length) return [];
    const extractedRows = collectExtractedNameRowsLimited(extractedRoot, 1800);
    const packageRows = collectUnitypackageNameRowsLimited(itemDir, 1200);
    const rawRows = [...extractedRows, ...packageRows].filter((r) => String(r?.raw || '').trim());
    if (!rawRows.length) return [];
    const rows = rawRows.map((row) => ({
      kind: String(row.kind || 'dir'),
      raw: String(row.raw || ''),
      normalized: normalizeAvatarMatchText(row.raw),
      tokens: splitAvatarMatchTokens(row.raw),
    })).filter((r) => r.normalized);
    const matched = [];
    const matchedScore = new Map();
    for (const entry of dict) {
      const label = String(entry?.label || '').trim();
      if (!label) continue;
      const aliases = Array.isArray(entry?.aliases) ? entry.aliases : [];
      let bestTotal = 0;
      for (const alias of aliases) {
        const key = normalizeAvatarMatchText(alias);
        if (!key || key.length < 2) continue;
        const keyTokens = splitAvatarMatchTokens(alias);
        const compactKey = key.replace(/\s+/g, '');
        const cjk = isLikelyCjkText(key);
        if (!cjk && compactKey.length < 3) continue;
        let dirScore = 0;
        let fileScore = 0;
        for (const row of rows) {
          const score = scoreAvatarMatchRow(row, key, keyTokens, compactKey, cjk);
          if (!score) continue;
          if (row.kind === 'file') fileScore = Math.max(fileScore, score);
          else dirScore = Math.max(dirScore, score);
          if (dirScore >= 3 && fileScore >= 2) break;
        }
        const total = dirScore + fileScore;
        const accepted = total >= 3 || dirScore >= 2 || fileScore >= 2;
        if (accepted) bestTotal = Math.max(bestTotal, total);
      }
      if (bestTotal > 0) {
        matched.push(label);
        matchedScore.set(label, bestTotal);
      }
    }
    matched.sort((a, b) => (Number(matchedScore.get(b) || 0) - Number(matchedScore.get(a) || 0)));
    return matched;
  }

  function collectFolderSignals(itemDir, avatarEntries) {
    const result = {};
    const dict = Array.isArray(avatarEntries) ? avatarEntries : [];
    if (!dict.length) return result;
    const extractedRoot = path.join(String(itemDir || ''), '__extracted');
    const extractedRows = collectExtractedNameRowsLimited(extractedRoot, 1800);
    const packageRows = collectUnitypackageNameRowsLimited(itemDir, 1200);
    const allRows = [...extractedRows, ...packageRows]
      .map((row) => ({
        kind: String(row.kind || 'dir'),
        raw: String(row.raw || ''),
        normalized: normalizeAvatarMatchText(row.raw),
        tokens: splitAvatarMatchTokens(row.raw),
      }))
      .filter((r) => r.normalized);
    if (!allRows.length) return result;
    for (const entry of dict) {
      const label = String(entry?.label || '').trim();
      if (!label) continue;
      const aliases = Array.isArray(entry?.aliases) ? entry.aliases : [];
      let bestPkgTop = 0;
      let bestDir = 0;
      let bestFile = 0;
      let bestPkg = 0;
      for (const alias of aliases) {
        const key = normalizeAvatarMatchText(alias);
        if (!key || key.length < 2) continue;
        const keyTokens = splitAvatarMatchTokens(alias);
        const compactKey = key.replace(/\s+/g, '');
        const cjk = isLikelyCjkText(key);
        if (!cjk && compactKey.length < 3) continue;
        for (const row of allRows) {
          const score = scoreAvatarMatchRow(row, key, keyTokens, compactKey, cjk);
          if (!score) continue;
          if (row.kind === 'pkg-top') bestPkgTop = Math.max(bestPkgTop, score);
          else if (row.kind === 'dir') bestDir = Math.max(bestDir, score);
          else if (row.kind === 'file') bestFile = Math.max(bestFile, score);
          else if (row.kind === 'pkg') bestPkg = Math.max(bestPkg, score);
        }
        if (bestPkgTop >= 4) break;
      }
      if (bestPkgTop >= 4) {
        if (!result[label]) result[label] = [];
        result[label].push('pkg直接フォルダ一致');
      } else {
        const folderTotal = bestDir + bestFile;
        const folderAccepted = folderTotal >= 3 || bestDir >= 2 || bestFile >= 2;
        if (folderAccepted) {
          if (!result[label]) result[label] = [];
          result[label].push('フォルダ一致');
        } else if (bestPkg >= 2) {
          // pkg エントリの exactScore 上限は 2 なので閾値は >= 2 が正しい
          if (!result[label]) result[label] = [];
          result[label].push('pkgファイル一致');
        }
      }
    }
    return result;
  }

  function mergeUniqueAvatarNames(existing, inferred) {
    const out = [];
    const seen = new Set();
    for (const src of [existing, inferred]) {
      for (const name of (Array.isArray(src) ? src : [])) {
        const n = String(name || '').trim();
        if (!n) continue;
        const k = normalizeAvatarMatchText(n);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(n);
      }
    }
    return out;
  }

  function extractPdfTextBasic(buffer) {
    const str = buffer.toString('latin1');
    const parts = [];
    const btRe = /BT([\s\S]*?)ET/g;
    let m;
    while ((m = btRe.exec(str)) !== null) {
      const block = m[1];
      const tjRe = /\(([^)]*)\)\s*Tj/g;
      let t;
      while ((t = tjRe.exec(block)) !== null) {
        parts.push(t[1]);
      }
    }
    return parts.join(' ');
  }

  function readTextContent(filePath, rawBuffer) {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    if (ext === '.pdf') return extractPdfTextBasic(rawBuffer);
    const utf8 = rawBuffer.toString('utf8');
    if (!utf8.includes('\ufffd')) return utf8;
    try {
      if (iconvLite && typeof iconvLite.decode === 'function') {
        return iconvLite.decode(rawBuffer, 'cp932');
      }
    } catch { /* ignore */ }
    return utf8;
  }

  function matchAvatarsInText(text, avatarEntries) {
    const normalized = normalizeAvatarMatchText(text);
    if (!normalized) return [];
    const matched = [];
    for (const entry of (Array.isArray(avatarEntries) ? avatarEntries : [])) {
      const label = String(entry?.label || '').trim();
      if (!label) continue;
      const aliases = Array.isArray(entry?.aliases) ? entry.aliases : [];
      let hit = false;
      for (const alias of aliases) {
        const key = normalizeAvatarMatchText(alias);
        if (!key || key.length < 2) continue;
        const compactKey = key.replace(/\s+/g, '');
        const cjk = isLikelyCjkText(key);
        if (!cjk && compactKey.length < 3) continue;
        // Non-CJK keys always require word boundary to avoid e.g. "chocolat" matching "chocolate".
        const found = cjk
          ? normalized.includes(key)
          : new RegExp(`(?<![a-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(normalized);
        if (found) { hit = true; break; }
      }
      if (hit) matched.push(label);
    }
    return matched;
  }

  function collectReadmeContentSignals(extractedRoot, avatarEntries) {
    const result = {};
    if (!extractedRoot || !fs.existsSync(extractedRoot)) return result;
    const README_EXTS = new Set(['.txt', '.md', '.pdf']);
    let entries = [];
    try {
      entries = fs.readdirSync(extractedRoot, { withFileTypes: true });
    } catch { return result; }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const name = String(ent?.name || '');
      const ext = path.extname(name).toLowerCase();
      if (!README_EXTS.has(ext)) continue;
      try {
        const filePath = path.join(extractedRoot, name);
        const buf = fs.readFileSync(filePath);
        const text = readTextContent(filePath, buf);
        const matches = matchAvatarsInText(text, avatarEntries);
        for (const label of matches) {
          if (!result[label]) result[label] = [];
          if (!result[label].includes('同梱README一致')) result[label].push('同梱README一致');
        }
      } catch { /* ignore per-file errors */ }
    }
    return result;
  }

  function collectTitleSignals(itemName, avatarEntries) {
    const result = {};
    const matches = matchAvatarsInText(String(itemName || ''), avatarEntries);
    if (!matches.length) return result;
    const reason = matches.length > 1 ? '複数対応明示' : 'タイトル明示';
    for (const label of matches) {
      result[label] = [reason];
    }
    return result;
  }

  function collectDescriptionSignals(description, avatarEntries) {
    const result = {};
    if (!description) return result;
    const matches = matchAvatarsInText(String(description || ''), avatarEntries);
    for (const label of matches) {
      if (!result[label]) result[label] = [];
      if (!result[label].includes('説明文一致')) result[label].push('説明文一致');
    }
    return result;
  }

  function collectTagSignals(tagNames, avatarEntries) {
    const result = {};
    const tags = Array.isArray(tagNames) ? tagNames : [];
    if (!tags.length) return result;
    const combined = tags.map((t) => String(t || '')).join(' ');
    const matches = matchAvatarsInText(combined, avatarEntries);
    for (const label of matches) {
      if (!result[label]) result[label] = [];
      if (!result[label].includes('タグ一致')) result[label].push('タグ一致');
    }
    return result;
  }

  function mergeSignalMaps(...maps) {
    const result = {};
    for (const map of (Array.isArray(maps) ? maps : [])) {
      for (const [label, reasons] of Object.entries(map || {})) {
        if (!result[label]) result[label] = [];
        for (const r of (Array.isArray(reasons) ? reasons : [])) {
          if (!result[label].includes(r)) result[label].push(r);
        }
      }
    }
    return result;
  }

  const SIGNAL_WEIGHTS = {
    'pkg直接フォルダ一致': 20,
    'タイトル明示': 10,
    '複数対応明示': 10,
    '同梱README一致': 7,
    'フォルダ一致': 5,
    'pkgファイル一致': 6,
    'タグ一致': 3,
    '説明文一致': 1,
  };

  function buildAvatarAnalysis(signalMap) {
    const candidates = Object.entries(signalMap || {})
      .filter(([, reasons]) => scoreReasonTotal(reasons) >= 6 && hasLocalAvatarEvidence(reasons))
      .map(([name, reasons]) => {
      const score = scoreReasonTotal(reasons);
      return { name, reasons, score };
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    const primaryAvatar = candidates[0]?.name || null;
    return { primaryAvatar, status: 'confirmed', candidates };
  }

  function arraysEqualStrings(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (String(a[i] || '') !== String(b[i] || '')) return false;
    }
    return true;
  }

  async function enrichMetaSupportedAvatarsFromFolders(items, options = {}) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) return { items: rows, changed: false };
    const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;
    const progressEvery = Math.max(1, Number(options?.progressEvery || 1));
    const yieldEvery = Math.max(1, Number(options?.yieldEvery || 1));
    const onlyItemIds = options?.onlyItemIds;
    const onlyItemIdSet = (
      onlyItemIds instanceof Set
        ? new Set(Array.from(onlyItemIds).map((v) => String(v || '').trim()).filter(Boolean))
        : (Array.isArray(onlyItemIds)
          ? new Set(onlyItemIds.map((v) => String(v || '').trim()).filter(Boolean))
          : null)
    );
    const targetRows = onlyItemIdSet
      ? rows.filter((item) => item && onlyItemIdSet.has(String(item.itemId || '').trim()))
      : rows;
    if (!targetRows.length) return { items: rows, changed: false };
    let lastProgressAt = 0;
    const avatarEntries = loadAvatarEntriesCached();
    if (!avatarEntries.length) {
      dbgAvatar('avatar-analysis-skip', {
        reason: 'avatar_dictionary_empty',
        itemCount: targetRows.length,
        itemCountAll: rows.length,
      });
      return { items: rows, changed: false };
    }
    let changed = false;
    let inferredHitItems = 0;
    let mergedHitItems = 0;
    let inferredMetaHitItems = 0;
    let inferredFolderHitItems = 0;
    const inferredMetaItemIds = [];
    const inferredFolderItemIds = [];
    const mergedItemIds = [];
    for (let idx = 0; idx < targetRows.length; idx += 1) {
      const item = targetRows[idx];
      if (!item || typeof item !== 'object') continue;
      const itemName = String(item?.itemName || item?.title || '');
      // 全アバター対応商品はアバター特定の推論をスキップ
      if (/全アバター|all\s*avatar/i.test(itemName)) {
        dbgAvatar('avatar-analysis-skip', {
          reason: 'universal_avatar_item',
          itemId: String(item.itemId || ''),
          itemName,
        });
        continue;
      }
      const itemDir = buildItemDir(item.itemId, item.itemName || '');
      const inferredFromMeta = inferSupportedAvatarsFromMetaFields(item, avatarEntries);
      const extractedRoot = path.join(String(itemDir || ''), '__extracted');
      const folderSignals = collectFolderSignals(itemDir, avatarEntries);
      const readmeSignals = collectReadmeContentSignals(extractedRoot, avatarEntries);
      const isTextureCategory = String(item?.primaryCategory?.text || '').includes('テクスチャ');
      const titleSignals = isTextureCategory ? collectTitleSignals(itemName, avatarEntries) : {};
      const descSignals = isTextureCategory ? collectDescriptionSignals(String(item?.boothDescription || ''), avatarEntries) : {};
      const tagSignals = isTextureCategory ? collectTagSignals(item?.tagNames, avatarEntries) : {};
      const allSignals = mergeSignalMaps(folderSignals, readmeSignals, titleSignals, descSignals, tagSignals);
      const debugSources = {
        meta: inferredFromMeta,
        folder: folderSignals,
        readme: readmeSignals,
        title: titleSignals,
        description: descSignals,
        tags: tagSignals,
      };
      const inferredFromSignals = Object.entries(allSignals)
        .filter(([, reasons]) => scoreReasonTotal(reasons) >= 6 && hasLocalAvatarEvidence(reasons))
        .map(([name]) => name);
      const inferred = mergeUniqueAvatarNames(inferredFromMeta, inferredFromSignals);
      const avatarAnalysis = buildAvatarAnalysis(allSignals);
      const existing = Array.isArray(item.supportedAvatars) ? item.supportedAvatars : [];
      const merged = item?.isAvatarItem
        ? mergeUniqueAvatarNames(existing, inferred)
        : [...inferred];
      if (inferredFromMeta.length > 0) {
        inferredMetaHitItems += 1;
        if (inferredMetaItemIds.length < 12) inferredMetaItemIds.push(String(item.itemId || ''));
      }
      if (Object.keys(folderSignals).length > 0) {
        inferredFolderHitItems += 1;
        if (inferredFolderItemIds.length < 12) inferredFolderItemIds.push(String(item.itemId || ''));
      }
      if (inferred.length > 0) inferredHitItems += 1;
      if (merged.length > 0) {
        mergedHitItems += 1;
        if (mergedItemIds.length < 12) mergedItemIds.push(String(item.itemId || ''));
      }
      const prevInferred = Array.isArray(item.supportedAvatarsInferred) ? item.supportedAvatarsInferred : [];
      const prevCheckedAt = String(item.avatarAnalysisCheckedAt || '').trim();
      const nextCheckedAt = new Date().toISOString();
      const manualConfirmed = item?.supportedAvatarAnalysis?.manualConfirmed === true;
      const supportedWillChange = !item.isAvatarItem && !manualConfirmed && !arraysEqualStrings(existing, merged);
      const inferredWillChange = !arraysEqualStrings(prevInferred, inferred);
      const analysisWillChange = !item.isAvatarItem && !manualConfirmed && (avatarAnalysis !== null || Boolean(item.supportedAvatarAnalysis));
      const checkedAtWillSet = !prevCheckedAt;
      if (isDebugVerboseEnabled() && (Object.keys(allSignals).length > 0 || inferredFromMeta.length > 0)) {
        dbgAvatar('avatar-score-breakdown', {
          item: buildAvatarAnalysisInputDebugSummary(item, itemDir, extractedRoot, isTextureCategory),
          threshold: 6,
          weights: SIGNAL_WEIGHTS,
          sourceCounts: buildAvatarSignalSourceCounts(debugSources),
          sources: debugSources,
          candidates: buildAvatarScoreDebugRows(allSignals, inferredFromMeta),
          inferredFromSignals,
          inferred,
          merged,
          primaryAvatar: avatarAnalysis?.primaryAvatar || null,
          result: {
            supportedWillChange,
            inferredWillChange,
            analysisWillChange,
            checkedAtWillSet,
            manualConfirmed,
          },
        });
      } else if (isDebugVerboseEnabled()) {
        dbgAvatar('avatar-analysis-no-candidates', {
          item: buildAvatarAnalysisInputDebugSummary(item, itemDir, extractedRoot, isTextureCategory),
          reason: 'no_signal_or_meta_match',
          sourceCounts: buildAvatarSignalSourceCounts(debugSources),
          skippedSources: {
            titleDescriptionTags: isTextureCategory ? '' : 'non_texture_category',
            readme: fs.existsSync(extractedRoot) ? '' : 'extracted_folder_missing',
          },
          result: {
            supportedWillChange,
            inferredWillChange,
            analysisWillChange,
            checkedAtWillSet,
            manualConfirmed,
          },
        });
      }
      // Avatar base items: supportedAvatars locked by fixAvatarItemFields — never overwrite.
      // Non-avatar items: automatic results follow the current local-first analysis, including empty results.
      // Manual confirmations are preserved until the user changes them explicitly.
      if (supportedWillChange) {
        item.supportedAvatars = merged;
        changed = true;
      }
      if (inferredWillChange) {
        item.supportedAvatarsInferred = inferred;
        changed = true;
      }
      if (analysisWillChange) {
        item.supportedAvatarAnalysis = avatarAnalysis;
        changed = true;
      }
      if (checkedAtWillSet) {
        item.avatarAnalysisCheckedAt = nextCheckedAt;
        changed = true;
      }
      if (onProgress) {
        const now = Date.now();
        const index = idx + 1;
        const shouldEmit = (
          index === 1
          || index === targetRows.length
          || (index % progressEvery) === 0
          || (now - lastProgressAt) >= 120
        );
        if (shouldEmit) {
          lastProgressAt = now;
          try {
            onProgress({ phase: 'avatar-enrich', index, total: targetRows.length });
          } catch {
            // ignore progress callback errors
          }
        }
      }
      if (((idx + 1) % yieldEvery) === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    dbgAvatar('enrichMetaSupportedAvatarsFromFolders summary', {
      itemCount: targetRows.length,
      itemCountAll: rows.length,
      avatarDictionaryCount: avatarEntries.length,
      inferredMetaHitItems,
      inferredFolderHitItems,
      inferredHitItems,
      mergedHitItems,
      inferredMetaItemIds,
      inferredFolderItemIds,
      mergedItemIds,
      changed,
      persist: Boolean(options.persist),
    });
    if (changed && options.persist) {
      writeMetaFile(rows);
    }
    savePkgScanDiskCache();
    return { items: rows, changed };
  }

  async function runAvatarEnrichAfterDownload(itemIds, senderOverride) {
    const targetIds = new Set(
      Array.from(itemIds || [])
        .map((v) => String(v || '').trim())
        .filter(Boolean),
    );
    if (!targetIds.size) return { ok: true, analyzed: 0, changed: false };

    const queueSender = getQueueSender ? getQueueSender() : null;
    const mainWindow = getMainWindow ? getMainWindow() : null;
    const sender = senderOverride || queueSender || mainWindow?.webContents;
    const sendProgress = (payload) => {
      try {
        if (sender && !sender.isDestroyed?.()) {
          sender.send('meta-progress', { ...(payload || {}), scope: 'avatar-post-download' });
        }
      } catch {
        // ignore
      }
    };

    sendProgress({ phase: 'prepare', message: 'ダウンロード後の対応アバター解析を開始中...', index: 0, total: targetIds.size });

    let latest = Array.isArray(metaCache) ? [...metaCache] : [];
    if (!latest.length && fs.existsSync(META_PATH)) {
      try {
        latest = normalizeAndPersistMeta(JSON.parse(fs.readFileSync(META_PATH, 'utf8')));
      } catch {
        latest = [];
      }
    }
    if (!latest.length) {
      sendProgress({ phase: 'done' });
      return { ok: true, analyzed: 0, changed: false };
    }

    const res = await enrichMetaSupportedAvatarsFromFolders(latest, {
      persist: true,
      onProgress: sendProgress,
      progressEvery: 2,
      yieldEvery: 1,
      onlyItemIds: targetIds,
    });
    metaCache = res.items;
    metaCacheAvatarEnriched = true;
    try {
      if (sender && !sender.isDestroyed?.()) {
        sender.send('assets-refreshed', toAssetMap(metaCache || []));
      }
    } catch {
      // ignore
    }
    sendProgress({ phase: 'done' });
    return { ok: true, analyzed: targetIds.size, changed: Boolean(res.changed) };
  }

  // ---------------------------------------------------------------------------
  // Meta file I/O and asset map
  // ---------------------------------------------------------------------------

  function isItemDownloadedOnDisk(itemId, itemName) {
    const itemDir = buildItemDir(itemId, itemName || 'NO_NAME');
    const extractedFlag = path.join(itemDir, '__extracted', '__extracted.flag');
    try {
      if (fs.existsSync(extractedFlag)) return true;
      if (!fs.existsSync(itemDir)) return false;
      const entries = fs.readdirSync(itemDir, { withFileTypes: true });
      return entries.some(e => e.isFile()) || entries.some(e => e.isDirectory());
    } catch {
      return false;
    }
  }

  function toAssetMap(data) {
    const resolveMediaPath = (rawPath) => {
      const raw = String(rawPath || '').trim();
      if (!raw) return '';
      if (/^[a-z]+:\/\//i.test(raw)) return raw;
      if (path.isAbsolute(raw)) {
        try { return pathToFileURL(raw).toString(); } catch { return raw; }
      }
      if (raw.startsWith('./cache/')) {
        const rel = raw.slice('./cache/'.length).replace(/[\\/]/g, path.sep);
        const next = path.join(CACHE_DIR, rel);
        const legacy = path.join(LEGACY_APP_ROOT, 'cache', rel);
        const picked = fs.existsSync(next) ? next : (fs.existsSync(legacy) ? legacy : next);
        try { return pathToFileURL(picked).toString(); } catch { return raw; }
      }
      if (raw.startsWith('./author_icons/')) {
        const rel = raw.slice('./author_icons/'.length).replace(/[\\/]/g, path.sep);
        const next = path.join(AUTHOR_ICON_DIR, rel);
        const legacy = path.join(LEGACY_APP_ROOT, 'author_icons', rel);
        const picked = fs.existsSync(next) ? next : (fs.existsSync(legacy) ? legacy : next);
        try { return pathToFileURL(picked).toString(); } catch { return raw; }
      }
      const fallback = path.join(APP_DATA_ROOT, raw.replace(/^\.?[\\/]/, '').replace(/[\\/]/g, path.sep));
      try { return pathToFileURL(fallback).toString(); } catch { return raw; }
    };
    const map = {};
    for (const item of (data || [])) {
      const supportedAvatars = Array.isArray(item?.supportedAvatars) ? item.supportedAvatars : [];
      const inferredAvatars = Array.isArray(item?.supportedAvatarsInferred) ? item.supportedAvatarsInferred : [];
      const supportedAvatarAnalysis = item?.supportedAvatarAnalysis && typeof item.supportedAvatarAnalysis === 'object'
        ? item.supportedAvatarAnalysis
        : null;
      const nameVariants = (item?.nameVariants && typeof item.nameVariants === 'object')
        ? item.nameVariants
        : null;
      const isDownloaded = isItemDownloadedOnDisk(item.itemId, item.itemName);

      map[item.itemId] = {
        itemId: item.itemId,
        title: item.itemName,
        author: item.authorName,
        authorId: item.authorId || '',
        authorShopUrl: item.authorShopUrl || '',
        authorIcon: resolveMediaPath(item.localAuthorIconPath || item.authorIconUrl || ''),
        orderDate: item.orderDateTime,
        preview: (item.localImagePath || item.imageUrl)
          ? [resolveMediaPath(item.localImagePath || item.imageUrl)]
          : [],
        downloaded: isDownloaded,
        isAvatarItem: Boolean(item?.isAvatarItem),
        isGift: Boolean(item.isGift),
        isFreeDownload: Boolean(item.isFreeDownload),
        categories: item.categories || [],
        tagNames: Array.isArray(item?.tagNames) ? item.tagNames : [],
        primaryCategory: item.primaryCategory || null,
        supportedAvatars,
        supportedAvatarsInferred: inferredAvatars,
        supportedAvatarAnalysis,
        avatarAnalysisCheckedAt: item.avatarAnalysisCheckedAt || null,
        nameVariants,
        nameAliases: Array.isArray(nameVariants?.all) ? nameVariants.all : [],
        files: (item.downloadLinks || []).map(dl => ({
          downloadableId: dl.downloadableId,
          fileName: dl.fileName,
        })),
        versionHistory: item.versionHistory || [],
        latestVersion: item.latestVersion || null,
        hasUpdate: Boolean(item.hasUpdate),
        lastChecked: item.lastChecked || null,
        isWishlisted: Boolean(item.isWishlisted),
        wishlistAddedAt: item.wishlistAddedAt || null,
        price: typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null,
        priceMin: typeof item.priceMin === 'number' && Number.isFinite(item.priceMin) ? item.priceMin : null,
        priceMax: typeof item.priceMax === 'number' && Number.isFinite(item.priceMax) ? item.priceMax : null,
        priceVariationCount: Number.isFinite(Number(item.priceVariationCount)) ? Number(item.priceVariationCount) : 0,
        priceVariations: Array.isArray(item.priceVariations) ? item.priceVariations : [],
        lastPriceCheckedAt: item.lastPriceCheckedAt || null,
        isRemoved: Boolean(item.isRemoved),
        removedAt: item.removedAt || null,
        userTags: Array.isArray(item.userTags) ? item.userTags : [],
        userNote: item.userNote || '',
      };
    }
    return map;
  }

  function writeMetaFile(items) {
    const rows = Array.isArray(items) ? items : [];
    const tmpPath = META_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(rows, null, 2), 'utf8');
    fs.renameSync(tmpPath, META_PATH);
    metaCache = rows;
    metaCacheAvatarEnriched = false;
  }

  function normalizeAndPersistMeta(items) {
    const before = Array.isArray(items) ? items.length : 0;
    let normalized = dedupeMetaItemsByItemId(items || []);
    let changed = before !== normalized.length;
    if (changed) {
      dbgUpdate('meta:dedupe', `before=${before}`, `after=${normalized.length}`);
    }
    const removedCount = normalized.filter((item) => Boolean(item?.isRemoved)).length;
    if (normalized.length >= 10 && removedCount >= Math.ceil(normalized.length * 0.5)) {
      normalized = normalized.map((item) => (
        item?.isRemoved
          ? { ...item, isRemoved: false, removedAt: undefined }
          : item
      ));
      changed = true;
      dbgUpdate('meta:mass-removed-recovery', `total=${normalized.length}`, `removed=${removedCount}`);
    }
    // Older createWishlistMetaItem versions stamped orderDateTime with the moment the
    // item was added to the wishlist, causing unpurchased items to leak into "recent
    // orders" / order history (which key off orderDate being set and not 'Unknown').
    // Backfill those to 'Unknown' for any item that's still wishlist-only.
    const staleWishlistOrderCount = normalized.filter((item) => (
      isWishlistOnlyMetaItem(item) && item?.orderDateTime && item.orderDateTime !== 'Unknown'
    )).length;
    if (staleWishlistOrderCount > 0) {
      normalized = normalized.map((item) => (
        isWishlistOnlyMetaItem(item) && item?.orderDateTime && item.orderDateTime !== 'Unknown'
          ? { ...item, orderDateTime: 'Unknown' }
          : item
      ));
      changed = true;
      dbgUpdate('meta:wishlist-orderdate-backfill', `count=${staleWishlistOrderCount}`);
    }
    if (changed) {
      writeMetaFile(normalized);
    }
    metaCache = normalized;
    metaCacheAvatarEnriched = false;
    return normalized;
  }

  function markItemUpdatedInMeta(itemId, files = [], expectedStableHash = null) {
    try {
      if (!fs.existsSync(META_PATH)) return { ok: false, error: 'meta_not_found' };
      const meta = normalizeAndPersistMeta(JSON.parse(fs.readFileSync(META_PATH, 'utf8')));
      const target = (meta || []).find((i) => String(i.itemId) === String(itemId));
      if (!target) return { ok: false, error: 'item_not_found' };

      const now = new Date().toISOString();
      const normalizedLinks = Array.isArray(files)
        ? files.map((f) => ({
            downloadableId: String(f?.downloadableId || ''),
            fileName: String(f?.fileName || ''),
          }))
        : [];

      if (normalizedLinks.length > 0) {
        target.downloadLinks = normalizedLinks;
        target.latestVersion = {
          detectedAt: now,
          filesHash: generateFilesHash(normalizedLinks),
          filesHashStable: expectedStableHash
            ? String(expectedStableHash)
            : generateFilesStableHash(normalizedLinks),
        };
      } else if (expectedStableHash && target.latestVersion) {
        target.latestVersion = {
          ...target.latestVersion,
          detectedAt: now,
          filesHashStable: String(expectedStableHash),
        };
      }
      target.hasUpdate = false;
      target.lastChecked = now;
      writeMetaFile(meta);
      metaCache = meta;
      metaCacheAvatarEnriched = false;
      return { ok: true, stable: target?.latestVersion?.filesHashStable || '' };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // ---------------------------------------------------------------------------
  // Meta cache and asset map fast path
  // ---------------------------------------------------------------------------

  function getMetaAssetMapFast() {
    if (Array.isArray(metaCache)) {
      return toAssetMap(metaCache);
    }
    if (!fs.existsSync(META_PATH)) return {};
    try {
      const raw = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
      const normalized = normalizeAndPersistMeta(raw);
      return toAssetMap(normalized);
    } catch {
      return {};
    }
  }

  function pickBootstrapAssets(assetMap) {
    const rows = Object.values(assetMap || {});
    const map = new Map(rows.map((r) => [String(r?.itemId || ''), r]));
    const fixed = [];
    for (const spec of AUTO_BOOTSTRAP_FIXED_ITEMS) {
      const id = String(spec?.itemId || '').trim();
      if (!id) continue;
      const hit = map.get(id);
      if (hit) {
        fixed.push(hit);
      } else {
        // Fixed items (e.g. liltoon, FaceEmo) are free tools that may never end up
        // in the user's purchased-library meta. Without a meta entry there's no
        // toAssetMap() to compute `downloaded` from, so check disk directly —
        // otherwise this would hardcode downloaded:false and re-download on every
        // single app startup forever, even after a successful download.
        const title = String(spec?.title || id);
        fixed.push({
          itemId: id,
          title,
          downloaded: isItemDownloadedOnDisk(id, title),
          files: [],
        });
      }
    }
    dbgUpdate('autoboot:targets:fixed', `count=${fixed.length}`, `ids=${fixed.map((x) => x.itemId).join(',')}`);
    return fixed;
  }

  function pickPurchasedBootstrapAssets(assetMap, excludeIds = new Set()) {
    const rows = Object.values(assetMap || {});
    const out = [];
    for (const row of rows) {
      const itemId = String(row?.itemId || '').trim();
      if (!itemId) continue;
      if (excludeIds.has(itemId)) continue;
      if (!row?.downloaded) continue;
      out.push(row);
    }
    dbgUpdate('autoboot:targets:purchased', `count=${out.length}`);
    return out;
  }

  function isWishlistOnlyMetaItem(item) {
    const noDownloadLinks = !Array.isArray(item?.downloadLinks) || item.downloadLinks.length === 0;
    if (!noDownloadLinks) return false;
    // Also treat manually-removed wishlist items (isWishlisted cleared but wishlistAddedAt kept)
    // as "not yet a known purchased item" so the next sync can detect and fetch their downloadLinks.
    return Boolean(item?.isWishlisted) || Boolean(item?.wishlistAddedAt);
  }

  function getKnownPurchasedItemIds(items) {
    return (Array.isArray(items) ? items : [])
      .filter((item) => !isWishlistOnlyMetaItem(item))
      .map((item) => String(item?.itemId || '').trim())
      .filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Manual meta item helpers
  // ---------------------------------------------------------------------------

  function listManualMetaItems(items) {
    return (items || []).filter((it) => Boolean(it?.manualAdded));
  }

  function mergeLatestWithManualItems(existingMeta, latestMeta) {
    const latest = Array.isArray(latestMeta) ? [...latestMeta] : [];
    const latestIds = new Set(latest.map((it) => String(it?.itemId || '')).filter(Boolean));

    // reappeared items: explicitly set isRemoved:false so applyVersionTracking's
    // { ...prev, ...item } spread will override prev.isRemoved:true
    const existingById = new Map((existingMeta || []).map((it) => [String(it?.itemId || ''), it]));
    for (let i = 0; i < latest.length; i++) {
      const id = String(latest[i]?.itemId || '');
      if (!id) continue;
      const existing = existingById.get(id);
      const latestItem = latest[i] || {};
      const shouldRestoreRemoved = Boolean(existing?.isRemoved) && !latestItem.isRemoved;
      const shouldUpgradeWishlist = Boolean(existing?.isWishlisted) && !latestItem.isWishlisted;
      if (shouldRestoreRemoved || shouldUpgradeWishlist) {
        latest[i] = {
          ...latestItem,
          ...(shouldRestoreRemoved ? { isRemoved: false, removedAt: undefined } : {}),
          ...(shouldUpgradeWishlist ? { isWishlisted: false, wishlistAddedAt: undefined } : {}),
        };
      }
    }

    for (const item of (existingMeta || [])) {
      const id = String(item?.itemId || '').trim();
      if (!id || latestIds.has(id)) continue;
      if (item?.manualAdded || item?.isWishlisted) {
        latest.push({ ...item });
      } else {
        // BOOTH library HTML can be incomplete when login/session/category fetch
        // changes. Do not hide existing purchased items just because one sync
        // did not return them.
        latest.push({ ...item });
      }
      latestIds.add(id);
    }
    return latest;
  }

  function applyVersionTrackingKeepingManual(existingMeta, latestMeta, detectedAt = new Date().toISOString()) {
    const latestWithManual = mergeLatestWithManualItems(existingMeta, latestMeta);
    return applyVersionTracking(existingMeta || [], latestWithManual || [], detectedAt);
  }

  // ---------------------------------------------------------------------------
  // Version diff helpers
  // ---------------------------------------------------------------------------

  function buildVersionDiffForItem(item) {
    const history = Array.isArray(item?.versionHistory) ? item.versionHistory : [];
    if (!history.length) return { addedFiles: [], removedFiles: [] };
    const newest = history[0];
    const prev = history[1] || null;
    const toKeySet = (entry) => new Set((entry?.downloadLinks || []).map((dl) => `${dl.downloadableId || ''}:${dl.fileName || ''}`));
    const newestSet = toKeySet(newest);
    const prevSet = toKeySet(prev);
    const addedKeys = [...newestSet].filter((k) => !prevSet.has(k));
    const removedKeys = [...prevSet].filter((k) => !newestSet.has(k));
    const toFileName = (key) => {
      const idx = String(key || '').indexOf(':');
      return idx >= 0 ? key.slice(idx + 1) : key;
    };
    return {
      addedFiles: addedKeys.map(toFileName).filter(Boolean),
      removedFiles: removedKeys.map(toFileName).filter(Boolean),
    };
  }

  function enrichUpdatesWithVersionDiff(items, updates) {
    const map = new Map((Array.isArray(items) ? items : []).map((it) => [String(it?.itemId || ''), it]));
    return (Array.isArray(updates) ? updates : []).map((u) => {
      const id = String(u?.itemId || '');
      const it = map.get(id);
      const diff = buildVersionDiffForItem(it);
      return {
        ...u,
        addedFiles: diff.addedFiles,
        removedFiles: diff.removedFiles,
        addedCount: diff.addedFiles.length,
        removedCount: diff.removedFiles.length,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Version tracking persistence
  // ---------------------------------------------------------------------------

  function ensureMetaWithVersionTracking(existingMeta, latestMeta) {
    const { items } = applyVersionTrackingKeepingManual(existingMeta || [], latestMeta || [], new Date().toISOString());
    writeMetaFile(items);
    metaCache = items;
    metaCacheAvatarEnriched = false;
    return items;
  }

  function metaNeedsVersionBackfill(items) {
    return (items || []).some((item) => {
      const hasHistory = Array.isArray(item.versionHistory);
      const hasLatest = !!item.latestVersion?.filesHash;
      const hasLastChecked = typeof item.lastChecked === 'string' && item.lastChecked.length > 0;
      return !hasHistory || !hasLatest || !hasLastChecked;
    });
  }

  // ---------------------------------------------------------------------------
  // Main meta load/generate entry point
  // ---------------------------------------------------------------------------

  async function loadOrGenerateMeta(event, progressScope = 'load-assets') {
    const sender = event?.sender || null;
    const sendMetaLog = (msg) => {
      try {
        if (sender && !sender.isDestroyed?.()) sender.send('meta-log', msg);
      } catch {
        // ignore
      }
    };
    const sendMetaProgress = (p) => {
      try {
        if (sender && !sender.isDestroyed?.()) sender.send('meta-progress', { ...(p || {}), scope: progressScope });
      } catch {
        // ignore
      }
    };
    sendMetaProgress({ phase: 'prepare', index: 0, total: 1 });

    if (!fs.existsSync(META_PATH)) {
      const generated = await generateLibraryMeta(
        sendMetaLog,
        sendMetaProgress,
      );
      const next = ensureMetaWithVersionTracking([], generated);
      metaCacheAvatarEnriched = false;
      return next;
    }

    const raw = fs.readFileSync(META_PATH, 'utf8');
    let parsedMeta = null;
    try {
      parsedMeta = JSON.parse(raw);
    } catch (e) {
      const backupPath = backupCorruptedJson(META_PATH, raw);
      console.warn('Meta file parse failed. Regenerating.', e?.message || e, backupPath ? `(backup: ${backupPath})` : '');
      const generated = await generateLibraryMeta(
        sendMetaLog,
        sendMetaProgress,
      );
      const next = ensureMetaWithVersionTracking([], generated);
      metaCacheAvatarEnriched = false;
      return next;
    }
    metaCache = normalizeAndPersistMeta(parsedMeta);
    if (metaNeedsVersionBackfill(metaCache)) {
      metaCache = ensureMetaWithVersionTracking(metaCache, metaCache);
    }
    metaCacheAvatarEnriched = false;

    // Startup: check once whether online library has new items, then refresh meta.
    if (!didStartupNewItemCheck) {
      didStartupNewItemCheck = true;
      startupMetaRefreshPromise = (async () => {
        try {
          const existingIds = getKnownPurchasedItemIds(metaCache || []);
          const hasNew = await runWithBoothCookieLoginFallback(async () => (
            await checkLibraryHasNewItems(existingIds)
          ));
          if (!hasNew) return;
          const generated = await runWithBoothCookieLoginFallback(async () => (
            await generateLibraryMeta(sendMetaLog, sendMetaProgress, {
              lightweight: true,
              persist: false,
            })
          ));
          metaCache = ensureMetaWithVersionTracking(metaCache, generated);
          metaCacheAvatarEnriched = false;
          try {
            if (sender && !sender.isDestroyed?.()) {
              sender.send('assets-refreshed', toAssetMap(metaCache));
            }
          } catch {
            // ignore
          }
        } catch (e) {
          // 起動時チェック失敗時は既存メタを継続利用する
          const msg = e?.message || e;
          if (String(msg) !== 'cookie_decrypt_failed') {
            console.warn('startup new-item check failed:', msg);
          } else {
            console.warn('startup new-item check skipped (cookie decrypt failed; login required)');
          }
        } finally {
          startupMetaRefreshPromise = null;
        }
      })();
    }

    return metaCache;
  }

  function createManualFreeMetaItem(itemId, itemJson, downloadLinks) {
    const now = new Date().toISOString();
    const data = itemJson && typeof itemJson === 'object' ? itemJson : {};
    const links = dedupeDownloadLinks(Array.isArray(downloadLinks) ? downloadLinks : []);
    const category = data?.category || null;
    const categories = [];
    if (category?.parent) {
      categories.push({
        href: String(category.parent.url || ''),
        text: String(category.parent.name || ''),
        slug: String(category.parent.url || '').replace(/^https:\/\/booth\.pm\/ja\/browse\//, ''),
      });
    }
    if (category) {
      categories.push({
        href: String(category.url || ''),
        text: String(category.name || ''),
        slug: String(category.url || '').replace(/^https:\/\/booth\.pm\/ja\/browse\//, ''),
      });
    }
    const imageUrl = String(
      data?.image_url
      || data?.thumbnail_image_url
      || data?.thumbnail_image_urls?.[0]
      || data?.images?.[0]?.original
      || '',
    );
    const authorName = String(data?.shop?.name || data?.shop_name || data?.creator?.name || data?.user?.name || '');
    const authorShopUrl = String(data?.shop?.url || data?.shop_url || '');
    const authorIconUrl = String(data?.shop?.thumbnail_url || data?.shop?.icon_image_url || data?.creator?.avatar_url || '');
    const filesHash = generateFilesHash(links);
    const filesHashStable = generateFilesStableHash(links);

    return {
      itemId: String(itemId || ''),
      itemName: String(data?.name || `Manual Item ${itemId}`),
      orderDateTime: now,
      authorId: String(data?.shop?.id || data?.creator?.id || data?.user?.id || 'manual'),
      authorName: authorName || 'Unknown',
      authorShopUrl,
      authorIconUrl,
      imageUrl,
      downloadLinks: links,
      categories,
      primaryCategory: categories.length ? categories[categories.length - 1] : null,
      isAvatarItem: false,
      supportedAvatars: [],
      localAuthorIconPath: authorIconUrl || '',
      localImagePath: imageUrl || '',
      versionHistory: [{
        detectedAt: now,
        downloadLinks: links,
        filesHash,
        filesHashStable,
      }],
      latestVersion: {
        detectedAt: now,
        filesHash,
        filesHashStable,
      },
      hasUpdate: false,
      lastChecked: now,
      manualAdded: true,
    };
  }

  // カテゴリ名は取得元エンドポイントによって形が異なる:
  //  - /ja/items/{id}.json 由来: category.name は文字列
  //  - wish_list_name_items.json 由来: category.name は {en, ja} オブジェクト
  function categoryNameToText(name) {
    if (name && typeof name === 'object') return String(name.ja || name.en || '');
    return String(name || '');
  }

  function createWishlistMetaItem(itemId, itemJson) {
    const now = new Date().toISOString();
    const data = itemJson && typeof itemJson === 'object' ? itemJson : {};
    const category = data?.category || null;
    const categories = [];
    if (category?.parent) {
      categories.push({
        href: String(category.parent.url || ''),
        text: categoryNameToText(category.parent.name),
        slug: String(category.parent.url || '').replace(/^https:\/\/booth\.pm\/ja\/browse\//, ''),
      });
    }
    if (category) {
      categories.push({
        href: String(category.url || ''),
        text: categoryNameToText(category.name),
        slug: String(category.url || '').replace(/^https:\/\/booth\.pm\/ja\/browse\//, ''),
      });
    }
    const imageUrl = String(
      data?.image_url
      || data?.thumbnail_image_url
      || data?.thumbnail_image_urls?.[0]
      || data?.images?.[0]?.original
      || '',
    );
    const authorName = String(data?.shop?.name || data?.shop_name || data?.creator?.name || data?.user?.name || '');
    const authorShopUrl = String(data?.shop?.url || data?.shop_url || '');
    const authorIconUrl = String(data?.shop?.thumbnail_url || data?.shop?.icon_image_url || data?.creator?.avatar_url || '');

    return {
      itemId: String(itemId || ''),
      itemName: String(data?.name || `Wishlist Item ${itemId}`),
      orderDateTime: 'Unknown',
      authorId: String(data?.shop?.id || data?.creator?.id || data?.user?.id || 'wishlist'),
      authorName: authorName || 'Unknown',
      authorShopUrl,
      authorIconUrl,
      imageUrl,
      downloadLinks: [],
      categories,
      primaryCategory: categories.length ? categories[categories.length - 1] : null,
      isAvatarItem: false,
      supportedAvatars: [],
      localAuthorIconPath: authorIconUrl || '',
      localImagePath: imageUrl || '',
      versionHistory: [],
      latestVersion: null,
      hasUpdate: false,
      lastChecked: now,
      isWishlisted: true,
      wishlistAddedAt: now,
      ...extractPriceSummaryFromVariations(data?.variations),
      lastPriceCheckedAt: Date.now(),
    };
  }

  function extractPriceSummaryFromVariations(variations) {
    if (!Array.isArray(variations)) {
      return { price: null, priceMin: null, priceMax: null, priceVariationCount: 0, priceVariations: [] };
    }
    const rows = variations
      .map((v, index) => {
        const p = v?.price ?? v?.price_yen ?? v?.price_jpy ?? v?.amount;
        if (typeof p !== 'number' || p <= 0) return null;
        const name = String(v?.name || v?.title || v?.label || v?.variation_name || '').trim();
        const id = v?.id != null ? String(v.id) : undefined;
        return {
          ...(id ? { id } : {}),
          name: name || `Variation ${index + 1}`,
          price: p,
        };
      })
      .filter(Boolean);
    if (!rows.length) {
      return { price: null, priceMin: null, priceMax: null, priceVariationCount: 0, priceVariations: [] };
    }
    const prices = rows.map((row) => row.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return {
      price: min,
      priceMin: min,
      priceMax: max,
      priceVariationCount: rows.length,
      priceVariations: rows
        .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, 'ja'))
        .slice(0, 30),
    };
  }

  async function refreshMetaAfterLogin(sender) {
    const sendLog = (msg) => {
      try {
        if (sender && !sender.isDestroyed?.()) sender.send('meta-log', msg);
      } catch {
        // ignore
      }
    };
    const sendProgress = (payload) => {
      try {
        if (sender && !sender.isDestroyed?.()) sender.send('meta-progress', { ...(payload || {}), scope: 'post-login-refresh' });
      } catch {
        // ignore
      }
    };

    let existing = [];
    if (fs.existsSync(META_PATH)) {
      try {
        existing = normalizeAndPersistMeta(JSON.parse(fs.readFileSync(META_PATH, 'utf8')));
      } catch {
        existing = [];
      }
    }
    const latest = await generateLibraryMeta(sendLog, sendProgress, { lightweight: false, persist: true });
    const merged = ensureMetaWithVersionTracking(existing, latest);
    try {
      if (sender && !sender.isDestroyed?.()) {
        sender.send('assets-refreshed', toAssetMap(merged));
      }
    } catch {
      // ignore
    }
    return { ok: true, itemCount: Array.isArray(merged) ? merged.length : 0 };
  }

  async function refreshMetaAfterLoginDedup(sender) {
    if (postLoginRefreshPromise) return await postLoginRefreshPromise;
    postLoginRefreshPromise = (async () => {
      try {
        return await refreshMetaAfterLogin(sender);
      } finally {
        postLoginRefreshPromise = null;
      }
    })();
    return await postLoginRefreshPromise;
  }

  return {
    getMetaCache: () => metaCache,
    setMetaCache: (v) => { metaCache = v; },
    isMetaCacheAvatarEnriched: () => metaCacheAvatarEnriched,
    setMetaCacheAvatarEnriched: (v) => { metaCacheAvatarEnriched = v; },
    toAssetMap,
    writeMetaFile,
    normalizeAndPersistMeta,
    markItemUpdatedInMeta,
    getMetaAssetMapFast,
    pickBootstrapAssets,
    pickPurchasedBootstrapAssets,
    isWishlistOnlyMetaItem,
    getKnownPurchasedItemIds,
    ensureMetaWithVersionTracking,
    applyVersionTrackingKeepingManual,
    buildVersionDiffForItem,
    enrichUpdatesWithVersionDiff,
    metaNeedsVersionBackfill,
    loadOrGenerateMeta,
    runAvatarEnrichAfterDownload,
    enrichMetaSupportedAvatarsFromFolders,
    loadAvatarEntriesCached,
    createManualFreeMetaItem,
    createWishlistMetaItem,
    refreshMetaAfterLogin,
    refreshMetaAfterLoginDedup,
  };
}

module.exports = { createMetaManager };
