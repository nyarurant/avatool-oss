// booth_meta_fetcher.js

const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const crypto = require('crypto');
const { readBoothCookiesFromFile } = require('./booth_cookie_store');
const { dedupeDownloadLinks } = require('./utils');
let dataRootOverride = '';

function setDataRoot(dataRoot) {
  const next = String(dataRoot || '').trim();
  dataRootOverride = next || '';
}

function getDataRoot() {
  if (dataRootOverride) return dataRootOverride;
  const fromEnv = String(process.env.AVATOOL_DATA_DIR || '').trim();
  if (fromEnv) return fromEnv;
  return __dirname;
}

function getPrimaryCategory(categories) {
  if (!Array.isArray(categories) || categories.length === 0) return null;
  return categories[categories.length - 1];
}

function createBoothClientFromCookies() {
  const cookies = readBoothCookiesFromFile(path.join(getDataRoot(), 'booth.pm.json'));
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const client = axios.create({
    baseURL: 'https://booth.pm',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://accounts.booth.pm/library',
      'Origin': 'https://booth.pm',
      'Cookie': cookieHeader,
    },
  });
  return client;
}

function pickAvatarDisplayName(entry) {
  const candidates = [
    ...normalizeAvatarAliasValues(entry?.katakana),
    ...normalizeAvatarAliasValues(entry?.hiragana),
    ...normalizeAvatarAliasValues(entry?.alphabet),
    String(entry?.name || '').trim(),
  ];
  for (const raw of candidates) {
    const name = normalizeNameToken(raw);
    if (!name) continue;
    if (name.length < 2 || name.length > 32) continue;
    if (isTagLikelyAvatarNoise(name)) continue;
    return name;
  }
  return normalizeNameToken(entry?.name || '');
}

function buildKnownAvatarLookupEntries(knownAvatarRows) {
  const rows = Array.isArray(knownAvatarRows) ? knownAvatarRows : [];
  const map = new Map();
  for (const rawRow of rows) {
    const row = (rawRow && typeof rawRow === 'object') ? rawRow : { name: rawRow };
    const display = pickAvatarDisplayName(row);
    if (!display) continue;

    const aliases = new Set();
    const seeds = [
      String(row?.name || ''),
      ...normalizeAvatarAliasValues(row?.aliases),
      ...normalizeAvatarAliasValues(row?.alphabet),
      ...normalizeAvatarAliasValues(row?.hiragana),
      ...normalizeAvatarAliasValues(row?.katakana),
      ...normalizeAvatarAliasValues(row?.kanji),
    ];
    for (const seed of seeds) {
      const normalizedSeed = normalizeNameToken(seed);
      if (!normalizedSeed) continue;
      const variants = extractNameVariantsFromText(normalizedSeed, { avatarLike: true });
      for (const v of (variants.all || [])) {
        const token = normalizeAvatarLookupToken(v);
        if (!token || token.length < 2) continue;
        if (isTagLikelyAvatarNoise(v)) continue;
        aliases.add(token);
      }
      const hira = normalizeNameToken(kanaToHiragana(normalizedSeed));
      const kata = normalizeNameToken(kanaToKatakana(normalizedSeed));
      if (hira) aliases.add(normalizeAvatarLookupToken(hira));
      if (kata) aliases.add(normalizeAvatarLookupToken(kata));
    }
    const displayToken = normalizeAvatarLookupToken(display);
    if (displayToken) aliases.add(displayToken);
    const filteredAliases = Array.from(aliases).filter((t) => t && t.length >= 2);
    if (!filteredAliases.length) continue;

    const key = normalizeAvatarLookupToken(display);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { name: display, aliases: filteredAliases });
      continue;
    }
    prev.aliases = Array.from(new Set([...(prev.aliases || []), ...filteredAliases]));
  }
  return Array.from(map.values());
}

function resolveKnownAvatarLookupEntries(knownAvatarLookup) {
  const rows = Array.isArray(knownAvatarLookup) ? knownAvatarLookup : [];
  if (
    rows.length > 0
    && rows.every((r) => r && typeof r === 'object' && typeof r.name === 'string' && Array.isArray(r.aliases))
  ) {
    return rows;
  }
  return buildKnownAvatarLookupEntries(rows);
}

// Returns true if alias appears in text with word-boundary awareness.
// For pure Latin aliases (e.g. "chocolat"), requires a non-alphanumeric boundary so that
// "chocolat" does NOT match "chocolate_rice" but DOES match "astel_chocolat".
// CJK aliases (e.g. "ショコラ") use plain substring match as before.
function aliasMatchesText(text, alias) {
  if (!alias || !text) return false;
  if (/^[a-z0-9]+$/.test(alias)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text);
  }
  return text.includes(alias);
}

// Infer supported avatars from purchased variation names using text-blob search.
// Uses the same alias-matching approach as extractSupportedAvatarsFromJson so that
// "ルルネ対応" style names are matched without being discarded as noise.
function extractSupportedAvatarsFromVariations(data, knownAvatarLookup) {
  const variations = Array.isArray(data?.variations) ? data.variations : [];
  if (!variations.length) return [];
  const text = normalizeAvatarLookupToken(
    variations
      .map(v => String(v?.name || v?.variation_name || '').trim())
      .filter(Boolean)
      .join(' ')
  );
  if (!text) return [];
  const known = resolveKnownAvatarLookupEntries(knownAvatarLookup);
  const set = new Set();
  for (const entry of known) {
    for (const alias of (entry.aliases || [])) {
      if (alias && aliasMatchesText(text, alias)) {
        set.add(entry.name);
        break;
      }
    }
  }
  return Array.from(set);
}

// Infer supported avatars from downloaded file names (item.downloadLinks[].fileName).
// File names like "Tech_Wear_Cat_Sio.zip" are highly reliable signals because they
// are generated by the seller and contain avatar names directly.
function extractSupportedAvatarsFromFileNames(item, knownAvatarLookup) {
  const links = Array.isArray(item?.downloadLinks) ? item.downloadLinks : [];
  if (!links.length) return [];
  // Check each filename individually to preserve word boundaries between filenames.
  // Joining then removing spaces would merge e.g. "Astel_Sio" + "Astel_Rurune"
  // into "astel_sioastel_rurune", breaking boundary detection for Latin aliases.
  const fileTexts = links
    .map(dl => normalizeAvatarLookupToken(String(dl?.fileName || '').replace(/\.[^.]+$/, '')))
    .filter(Boolean);
  if (!fileTexts.length) return [];
  const known = resolveKnownAvatarLookupEntries(knownAvatarLookup);
  const set = new Set();
  for (const entry of known) {
    for (const alias of (entry.aliases || [])) {
      if (!alias) continue;
      if (fileTexts.some((fn) => aliasMatchesText(fn, alias))) {
        set.add(entry.name);
        break;
      }
    }
  }
  return Array.from(set);
}

// Return true if this is a purchased item (data.order is populated by BOOTH API
// only for authenticated users who own the item) and any variation name strongly
// indicates avatar base content — e.g. "アバター本体".
// NOTE: data.variations[].downloadable is always null in BOOTH API responses;
//       data.order is the actual purchase indicator.
const AVATAR_BASE_VARIATION_TOKENS = ['アバター本体', 'avatar本体', 'avatarbase'];

function hasPurchasedAvatarBaseVariation(data) {
  if (!data?.order) return false; // not purchased
  const variations = Array.isArray(data?.variations) ? data.variations : [];
  for (const v of variations) {
    const token = normalizeAvatarLookupToken(String(v?.name || v?.variation_name || ''));
    if (!token) continue;
    for (const kw of AVATAR_BASE_VARIATION_TOKENS) {
      if (token.includes(normalizeAvatarLookupToken(kw))) return true;
    }
  }
  return false;
}

// Infer supported avatars from description/tags using known avatar aliases.
function extractSupportedAvatarsFromJson(data, knownAvatarLookup) {
  const textParts = [];

  if (typeof data.description === 'string') {
    textParts.push(data.description);
  }
  if (Array.isArray(data.tags)) {
    for (const t of data.tags) {
      if (t && typeof t.name === 'string') {
        textParts.push(t.name);
      }
    }
  }

  const text = normalizeAvatarLookupToken(textParts.join(' '));
  const known = resolveKnownAvatarLookupEntries(knownAvatarLookup);
  const set = new Set();

  for (const entry of known) {
    for (const alias of (entry.aliases || [])) {
      if (alias && aliasMatchesText(text, alias)) {
        set.add(entry.name);
        break;
      }
    }
  }

  return Array.from(set);
}

function mergeUniqueStrings(...lists) {
  const set = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      const s = String(value || '').trim();
      if (s) set.add(s);
    }
  }
  return Array.from(set);
}

function normalizeAvatarLookupToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function extractTagNamesFromItemJson(data) {
  const names = [];
  if (Array.isArray(data?.tags)) {
    for (const tag of data.tags) {
      if (tag && typeof tag.name === 'string') names.push(tag.name);
    }
  }
  if (Array.isArray(data?.tag_banners)) {
    for (const banner of data.tag_banners) {
      if (banner && typeof banner.name === 'string') names.push(banner.name);
    }
  }
  if (data?.tag_combination && typeof data.tag_combination.tag === 'string') {
    names.push(data.tag_combination.tag);
  }
  return mergeUniqueStrings(names);
}

function isTagLikelyAvatarNoise(tagName) {
  const token = normalizeAvatarLookupToken(tagName);
  if (!token) return true;
  const exactNoise = new Set([
    'vrchat',
    'vrc',
    'vrc想定モデル',
    '3d',
    '3dモデル',
    '3d衣装',
    '衣装',
    'モデル',
    'アバター',
    'アクセサリー',
    '小物',
    'ギミック',
    'unity',
    'avatar',
  ]);
  if (exactNoise.has(token)) return true;
  if (token.includes('対応')) return true;
  if (token.includes('想定')) return true;
  if (/^\d+d$/.test(token)) return true;
  return false;
}

function inferSupportedAvatarsFromTags(tagNames, knownAvatarLookup) {
  if (!Array.isArray(tagNames)) return [];
  const known = resolveKnownAvatarLookupEntries(knownAvatarLookup);
  if (!known.length) return [];
  const set = new Set();
  for (const rawTag of tagNames) {
    if (isTagLikelyAvatarNoise(rawTag)) continue;
    const tagToken = normalizeAvatarLookupToken(rawTag);
    if (!tagToken || tagToken.length < 2) continue;
    for (const entry of known) {
      for (const alias of entry.aliases) {
        if (tagToken === alias || tagToken.includes(alias) || alias.includes(tagToken)) {
          set.add(entry.name);
          break;
        }
      }
    }
  }
  return Array.from(set);
}

function inferAvatarCandidatesFromTagsHeuristic(tagNames) {
  if (!Array.isArray(tagNames)) return [];
  const result = [];
  for (const tagName of tagNames) {
    const name = normalizeNameToken(tagName);
    if (!name) continue;
    if (name.length < 2 || name.length > 50) continue;
    if (isTagLikelyAvatarNoise(name)) continue;
    result.push(name);
  }
  return mergeUniqueStrings(result);
}

const AVATAR_TITLE_NOISE_RE = /(?:オリジナル|3D|３D|モデル|アバター|衣装|アクセサリ|ギミック|対応|VRChat|VRC|無料)/iu;

function isLikelyAvatarNameFromTitle(value) {
  const s = normalizeNameToken(value);
  if (!s) return false;
  if (s.length < 2 || s.length > 32) return false;
  if (!hasNameChars(s)) return false;
  if (isTagLikelyAvatarNoise(s)) return false;
  if (AVATAR_TITLE_NOISE_RE.test(s)) return false;
  return true;
}

// Collect avatar-name-like tokens from 3D-character item title.
function collectAvatarNameCandidatesFromItemJson(data) {
  const title = normalizeNameToken(data?.name || '');
  if (!title) return [];

  const results = [];
  const variants = extractNameVariantsFromText(title, { avatarLike: true });
  for (const v of variants.all || []) {
    if (isLikelyAvatarNameFromTitle(v)) results.push(v);
  }

  const parts = title
    .split(/[\s\/|・,，、\-_ー‐–—\(\)（）\[\]【】「」『』"']+/u)
    .map((p) => normalizeNameToken(p))
    .filter(Boolean);
  for (const p of parts) {
    if (isLikelyAvatarNameFromTitle(p)) results.push(p);
  }

  // Fallback for unusual titles where tokenization fails.
  if (!results.length) {
    const primary = stripNameDecorators(title);
    if (isLikelyAvatarNameFromTitle(primary)) results.push(primary);
  }

  return mergeUniqueStrings(results);
}

function mergeAliasRecord(base = {}, extra = {}) {
  const out = {
    alphabet: mergeUniqueStrings(base.alphabet, extra.alphabet),
    hiragana: mergeUniqueStrings(base.hiragana, extra.hiragana),
    katakana: mergeUniqueStrings(base.katakana, extra.katakana),
    kanji: mergeUniqueStrings(base.kanji, extra.kanji),
  };
  return out;
}

function buildAvatarAliasesFromName(name) {
  const variants = extractNameVariantsFromText(name, { avatarLike: true });
  const alias = {
    alphabet: [],
    hiragana: [],
    katakana: [],
    kanji: [],
  };
  for (const value of variants.all || []) {
    const bucket = classifyNameScript(value);
    if (bucket === 'latin') alias.alphabet.push(value);
    else if (bucket === 'hiragana') alias.hiragana.push(value);
    else if (bucket === 'katakana') alias.katakana.push(value);
    else if (bucket === 'kanji') alias.kanji.push(value);
  }
  return mergeAliasRecord({}, alias);
}

function normalizeAvatarEntry(row) {
  const name = normalizeNameToken(row?.name || '');
  if (!name) return null;
  const countNum = Number(row?.count);
  const count = Number.isFinite(countNum) && countNum > 0 ? Math.floor(countNum) : 1;
  const fromName = buildAvatarAliasesFromName(name);
  const fromRow = {
    alphabet: Array.isArray(row?.alphabet) ? row.alphabet : (row?.alphabet ? [row.alphabet] : []),
    hiragana: Array.isArray(row?.hiragana) ? row.hiragana : (row?.hiragana ? [row.hiragana] : []),
    katakana: Array.isArray(row?.katakana) ? row.katakana : (row?.katakana ? [row.katakana] : []),
    kanji: Array.isArray(row?.kanji) ? row.kanji : (row?.kanji ? [row.kanji] : []),
  };
  const merged = mergeAliasRecord(fromName, fromRow);
  return {
    name,
    count,
    alphabet: merged.alphabet,
    hiragana: merged.hiragana,
    katakana: merged.katakana,
    kanji: merged.kanji,
  };
}

function parseAvatarRowsFromRawText(rawText) {
  const text = String(rawText || '');
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Fallback for truncated/corrupted JSON: salvage "name" fields.
    const out = [];
    const re = /"name"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const name = normalizeNameToken(m[1] || '');
      if (!name) continue;
      out.push({ name, count: 1 });
    }
    return out;
  }
}

function writeJsonFileAtomic(filePath, value) {
  const dst = String(filePath || '');
  const dir = path.dirname(dst);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${dst}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, dst);
}

function serializeAvatarEntryForFile(entry) {
  const normalized = normalizeAvatarEntry(entry);
  if (!normalized) return null;
  const out = {
    name: normalized.name,
    count: Number(normalized.count || 1),
  };
  const compact = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return undefined;
    if (arr.length === 1) return arr[0];
    return arr;
  };
  const alphabet = compact(normalized.alphabet);
  const hiragana = compact(normalized.hiragana);
  const katakana = compact(normalized.katakana);
  const kanji = compact(normalized.kanji);
  if (typeof alphabet !== 'undefined') out.alphabet = alphabet;
  if (typeof hiragana !== 'undefined') out.hiragana = hiragana;
  if (typeof katakana !== 'undefined') out.katakana = katakana;
  if (typeof kanji !== 'undefined') out.kanji = kanji;
  return out;
}

function isLikelyProductTitleName(name) {
  const s = normalizeNameToken(name);
  if (!s) return false;
  if (s.length >= 18) return true;
  if (/[「」『』【】\[\]\(\)]/.test(s)) return true;
  if (/(?:オリジナル|3D|３D|モデル|アバター|for)/iu.test(s)) return true;
  return false;
}

function collectAvatarEntryLookupTokens(entry) {
  const tokens = [String(entry?.name || '').trim()];
  tokens.push(...normalizeAvatarAliasValues(entry?.alphabet));
  tokens.push(...normalizeAvatarAliasValues(entry?.hiragana));
  tokens.push(...normalizeAvatarAliasValues(entry?.katakana));
  tokens.push(...normalizeAvatarAliasValues(entry?.kanji));
  return mergeUniqueStrings(tokens).map((v) => normalizeAvatarLookupToken(v)).filter(Boolean);
}

function normalizeAvatarAliasValues(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  const s = String(value || '').trim();
  return s ? [s] : [];
}

function compactAvatarEntries(entries) {
  const rows = (Array.isArray(entries) ? entries : [])
    .map((e) => normalizeAvatarEntry(e))
    .filter(Boolean);
  if (rows.length <= 1) return rows;
  const titleRows = rows.filter((r) => isLikelyProductTitleName(r.name));
  if (!titleRows.length) return rows;

  const removed = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const src = rows[i];
    if (!src || isLikelyProductTitleName(src.name)) continue;
    const srcToken = normalizeAvatarLookupToken(src.name);
    if (!srcToken || srcToken.length < 2) continue;
    let target = null;
    for (const t of titleRows) {
      if (!t || t === src) continue;
      const tNameToken = normalizeAvatarLookupToken(t.name);
      const tLookup = new Set(collectAvatarEntryLookupTokens(t));
      if (tLookup.has(srcToken) || tNameToken.includes(srcToken)) {
        target = t;
        break;
      }
    }
    if (!target) continue;
    target.count = Math.max(Number(target.count || 0), Number(src.count || 0));
    const merged = mergeAliasRecord(target, src);
    target.alphabet = merged.alphabet;
    target.hiragana = merged.hiragana;
    target.katakana = merged.katakana;
    target.kanji = merged.kanji;
    removed.add(src);
  }
  return rows.filter((r) => !removed.has(r));
}

function addAliasToBucket(alias, value) {
  const name = normalizeNameToken(value);
  if (!name) return;
  if (name.length < 2 || name.length > 32) return;
  if (isTagLikelyAvatarNoise(name)) return;
  const bucket = classifyNameScript(name);
  if (bucket === 'latin') alias.alphabet.push(name);
  else if (bucket === 'hiragana') alias.hiragana.push(name);
  else if (bucket === 'katakana') alias.katakana.push(name);
  else if (bucket === 'kanji') alias.kanji.push(name);
}

function makeLearnedAvatarEntryFromItem(data, item) {
  const title = normalizeNameToken(data?.name || item?.itemName || '');
  if (!title || title.length < 2 || title.length > 120) return null;
  const cands = collectAvatarNameCandidatesFromItemJson(data);
  const alias = { alphabet: [], hiragana: [], katakana: [], kanji: [] };
  for (const c of cands) addAliasToBucket(alias, c);
  return normalizeAvatarEntry({
    name: title,
    count: 1,
    alphabet: alias.alphabet,
    hiragana: alias.hiragana,
    katakana: alias.katakana,
    kanji: alias.kanji,
  });
}

function enrichItemAvatarMetadata(item, data, categories, knownAvatarLookup = []) {
  const nextCategories = Array.isArray(categories) ? categories : [];
  const cat = data?.category || null;
  item.primaryCategory = getPrimaryCategory(nextCategories);
  item.isAvatarItem = isThreeDCharacterCategory(cat, nextCategories);
  if (!item.isAvatarItem && hasPurchasedAvatarBaseVariation(data)) {
    item.isAvatarItem = true;
  }
  item.nameVariants = mergeNameVariants(
    item.nameVariants || null,
    extractNameVariantsFromText(data?.name || item.itemName || '', { avatarLike: item.isAvatarItem }),
    item.itemName || data?.name || '',
  );
  item.tagNames = extractTagNamesFromItemJson(data);

  // カテゴリが汎用系（武器・ギミック・小道具）のアイテムは説明文のアバター言及が
  // 「対応例」に過ぎないため supportedAvatars を付けない
  // normalizeCategoryToken が NFKC を適用するため全角括弧は半角に変換される
  const UNIVERSAL_CATEGORY_TOKENS = new Set([
    '3dモデル(その他)',
    '3dツール・システム',
    '3d小道具',
  ]);
  const primaryCatToken = normalizeCategoryToken(item.primaryCategory?.text || '');
  const isUniversalCategory = !item.isAvatarItem && UNIVERSAL_CATEGORY_TOKENS.has(primaryCatToken);

  item.supportedAvatars = isUniversalCategory ? [] : [];

  let learned = null;
  if (item.isAvatarItem) {
    learned = makeLearnedAvatarEntryFromItem(data, item);
    if (learned) {
      item.supportedAvatars = mergeUniqueStrings(item.supportedAvatars, [learned.name]);
    }
  }

  return { learned };
}

// Merge learned avatar entries into avatars.json, creating the file if absent.
function learnAvatarsToFile(learnedEntries) {
  const entries = Array.isArray(learnedEntries) ? learnedEntries.filter(Boolean) : [];
  if (!entries.length) return;
  const avatarsPath = path.join(getDataRoot(), 'avatars.json');
  let knownAvatars = [];
  if (fs.existsSync(avatarsPath)) {
    try {
      const raw = parseAvatarRowsFromRawText(fs.readFileSync(avatarsPath, 'utf8'));
      knownAvatars = (Array.isArray(raw) ? raw : []).map((r) => normalizeAvatarEntry(r)).filter(Boolean);
    } catch {
      knownAvatars = [];
    }
  }
  // Key by display name (short canonical) so full-title variants collapse into one entry.
  const knownAvatarMap = new Map(knownAvatars.map((a) => [normalizeAvatarLookupToken(pickAvatarDisplayName(a)), a]));
  let changed = false;
  for (const learned of entries) {
    const key = normalizeAvatarLookupToken(pickAvatarDisplayName(learned));
    if (!key) continue;
    const prev = knownAvatarMap.get(key);
    if (prev) {
      const merged = mergeAliasRecord(prev, learned);
      prev.alphabet = merged.alphabet;
      prev.hiragana = merged.hiragana;
      prev.katakana = merged.katakana;
      prev.kanji = merged.kanji;
      prev.count = Math.max(Number(prev.count || 0), Number(learned.count || 0));
      changed = true;
    } else {
      const next = normalizeAvatarEntry(learned);
      if (!next) continue;
      knownAvatars.push(next);
      knownAvatarMap.set(key, next);
      changed = true;
    }
  }
  if (!changed) return;
  const serialized = compactAvatarEntries(knownAvatars)
    .map((e) => serializeAvatarEntryForFile(e))
    .filter(Boolean)
    .sort((a, b) => {
      const diff = Number(b?.count || 0) - Number(a?.count || 0);
      return diff !== 0 ? diff : String(a?.name || '').localeCompare(String(b?.name || ''), 'ja');
    });
  writeJsonFileAtomic(avatarsPath, serialized);
}

// For items with a 3D-character category but missing isAvatarItem/supportedAvatars,
// set those fields directly from stored data (no API call needed).
// Returns true if any item was changed.
function fixAvatarItemFields(metaItems) {
  const items = Array.isArray(metaItems) ? metaItems : [];
  // Load avatars.json canonical names for de-duplication.
  const avatarsPath = path.join(getDataRoot(), 'avatars.json');
  let knownLookup = [];
  try {
    if (fs.existsSync(avatarsPath)) {
      const raw = parseAvatarRowsFromRawText(fs.readFileSync(avatarsPath, 'utf8'));
      knownLookup = buildKnownAvatarLookupEntries((raw || []).map((r) => normalizeAvatarEntry(r)).filter(Boolean));
    }
  } catch { /* proceed without known lookup */ }

  let changed = false;
  for (const item of items) {
    if (!isThreeDCharacterCategory(null, item?.categories || [])) continue;
    if (!item.isAvatarItem) {
      item.isAvatarItem = true;
      changed = true;
    }
    // For 3D character (avatar base) items, supportedAvatars must be the item's OWN name only.
    // The inference engine may have wrongly assigned other avatar names from BOOTH tags — always override.
    const nv = item?.nameVariants || {};
    // When all nameVariant buckets are empty the stored primary/itemName is the raw product
    // title (e.g. "ニクス -Nix-』オリジナル3Dモデル"). Re-run extraction from nv.raw so
    // the current (improved) extractNameCandidates logic can produce a clean avatar name.
    const nvEmpty = !Array.isArray(nv.katakana) || !nv.katakana.length;
    let freshFromRaw = '';
    if (nvEmpty) {
      const rawTitle = String(nv.raw || '').trim();
      if (rawTitle) {
        const reX = extractNameVariantsFromText(rawTitle, { avatarLike: true });
        freshFromRaw = String(
          (Array.isArray(reX.katakana) && reX.katakana[0]) ||
          (Array.isArray(reX.hiragana) && reX.hiragana[0]) ||
          (Array.isArray(reX.latin) && reX.latin[0]) || ''
        ).trim();
      }
    }
    const rawName = String(
      freshFromRaw ||
      (Array.isArray(nv.katakana) && nv.katakana[0]) ||
      (Array.isArray(nv.hiragana) && nv.hiragana[0]) ||
      (Array.isArray(nv.latin) && nv.latin[0]) ||
      nv.primary || item?.itemName || ''
    ).trim();
    if (!rawName || rawName.length < 2) continue;
    const token = normalizeAvatarLookupToken(rawName);
    let known = knownLookup.find((e) => e.aliases.includes(token));
    let resolvedName = known ? known.name : rawName;
    // If resolved to Latin-only, try harder to recover a Japanese canonical name.
    // Priority 1: re-extract from nv.raw (e.g. "Rurune / ルルネ" stored before avatarLike split).
    // Priority 2: preserve existing supportedAvatarsInferred if it is Japanese — it was
    //   set by the analysis engine reading the actual BOOTH page tags for this item.
    //   (Safe: items with Japanese in nameVariants never reach this branch, so the
    //   Sio/"ショコラ"-style cross-contamination case is not affected.)
    if (/^[a-z0-9\-\s_.,'!?/]+$/i.test(resolvedName)) {
      const rawTitle = String(nv.raw || '').trim();
      if (/[\u3040-\u30FF]/.test(rawTitle)) {
        const reX = extractNameVariantsFromText(rawTitle, { avatarLike: true });
        const jaCandidate = (Array.isArray(reX.katakana) && reX.katakana[0]) ||
                            (Array.isArray(reX.hiragana) && reX.hiragana[0]);
        if (jaCandidate && jaCandidate.length >= 2) {
          const jaToken = normalizeAvatarLookupToken(jaCandidate);
          const jaKnown = knownLookup.find((e) => e.aliases.includes(jaToken));
          resolvedName = jaKnown ? jaKnown.name : jaCandidate;
        }
      }
    }
    if (/^[a-z0-9\-\s_.,'!?/]+$/i.test(resolvedName)) {
      const prevSi = Array.isArray(item.supportedAvatarsInferred) && item.supportedAvatarsInferred.length === 1
        ? String(item.supportedAvatarsInferred[0] || '').trim() : '';
      if (prevSi && /[\u3040-\u30FF\u4E00-\u9FFF]/.test(prevSi)) {
        const siToken = normalizeAvatarLookupToken(prevSi);
        const siKnown = knownLookup.find((e) => e.aliases.includes(siToken));
        resolvedName = siKnown ? siKnown.name : prevSi;
      }
    }
    const name = resolvedName;
    const correct = [name];
    // Overwrite supportedAvatars and supportedAvatarsInferred unconditionally so that
    // incorrectly inferred values (e.g. the avatar page mentioning other avatars in tags)
    // don't pollute the filter.
    const saOk = Array.isArray(item.supportedAvatars) && item.supportedAvatars.length === 1 && item.supportedAvatars[0] === name;
    const siOk = Array.isArray(item.supportedAvatarsInferred) && item.supportedAvatarsInferred.length === 1 && item.supportedAvatarsInferred[0] === name;
    if (!saOk) { item.supportedAvatars = correct; changed = true; }
    if (!siOk) { item.supportedAvatarsInferred = correct; changed = true; }
  }
  return changed;
}

// Scan meta items and add any isAvatarItem entries missing from avatars.json.
function syncAvatarItemsToFile(metaItems) {
  const items = Array.isArray(metaItems) ? metaItems : [];
  const learned = items
    .filter((it) => it?.isAvatarItem || isThreeDCharacterCategory(null, it?.categories || []))
    .map((it) => {
      const nv = it.nameVariants || {};
      // Prefer the canonical name already resolved by fixAvatarItemFields (stored in
      // supportedAvatars[0]) so avatars.json stays in sync with the corrected value.
      const name = String(
        (it.isAvatarItem && Array.isArray(it.supportedAvatars) && it.supportedAvatars[0]) ||
        (Array.isArray(nv.katakana) && nv.katakana[0]) ||
        (Array.isArray(nv.hiragana) && nv.hiragana[0]) ||
        (Array.isArray(nv.latin) && nv.latin[0]) ||
        nv.primary || it.itemName || ''
      ).trim();
      if (!name || name.length < 2) return null;
      // Extract Latin aliases from the raw product title (e.g. "-Chocolat-", "-Nix-", "Sio /").
      // nv.latin may be empty when the title was originally parsed without avatarLike extraction.
      const rawTitle = String(nv.raw || it.itemName || '').trim();
      const freshLatin = rawTitle
        ? (extractNameVariantsFromText(rawTitle, { avatarLike: true }).latin || [])
        : [];
      const combinedLatin = mergeUniqueStrings(nv.latin || [], freshLatin);
      return normalizeAvatarEntry({
        name,
        count: 1,
        alphabet: combinedLatin,
        hiragana: nv.hiragana || [],
        katakana: nv.katakana || [],
        kanji: nv.kanji || [],
      });
    })
    .filter(Boolean);
  learnAvatarsToFile(learned);
  pruneOrphanedAvatarEntries(items);
}

// Remove avatars.json entries that are no longer referenced by any item's supportedAvatars /
// supportedAvatarsInferred. Prevents stale Latin-name entries (e.g. "rurune") from lingering
// after fixAvatarItemFields has corrected them to the canonical Japanese name ("ルルネ").
function pruneOrphanedAvatarEntries(metaItems) {
  const avatarsPath = path.join(getDataRoot(), 'avatars.json');
  if (!fs.existsSync(avatarsPath)) return;
  // Build set of canonical tokens actually in use across all items.
  const usedTokens = new Set();
  for (const item of (Array.isArray(metaItems) ? metaItems : [])) {
    for (const n of (Array.isArray(item.supportedAvatars) ? item.supportedAvatars : [])) {
      const t = normalizeAvatarLookupToken(String(n || '').trim());
      if (t) usedTokens.add(t);
    }
    for (const n of (Array.isArray(item.supportedAvatarsInferred) ? item.supportedAvatarsInferred : [])) {
      const t = normalizeAvatarLookupToken(String(n || '').trim());
      if (t) usedTokens.add(t);
    }
  }
  if (!usedTokens.size) return;
  try {
    const raw = parseAvatarRowsFromRawText(fs.readFileSync(avatarsPath, 'utf8'));
    const rows = (Array.isArray(raw) ? raw : []).map((r) => normalizeAvatarEntry(r)).filter(Boolean);
    const pruned = rows.filter((r) => {
      const t = normalizeAvatarLookupToken(String(r?.name || '').trim());
      return t && usedTokens.has(t);
    });
    if (pruned.length === rows.length) return; // nothing to remove
    const serialized = compactAvatarEntries(pruned)
      .map((e) => serializeAvatarEntryForFile(e))
      .filter(Boolean)
      .sort((a, b) => {
        const diff = Number(b?.count || 0) - Number(a?.count || 0);
        return diff !== 0 ? diff : String(a?.name || '').localeCompare(String(b?.name || ''), 'ja');
      });
    writeJsonFileAtomic(avatarsPath, serialized);
  } catch { /* non-critical */ }
}

// Lightweight check: returns true when account library/gifts/free-downloads includes item IDs not present in local meta.
async function checkLibraryHasNewItems(existingItemIds) {
  const set = new Set((existingItemIds || []).map(String));
  const client = createBoothClientFromCookies();
  const ids = new Set();
  const targets = ['/library', '/library/gifts', '/library/free_downloads'];
  for (const target of targets) {
    let res;
    try {
      res = await client.get(target, { baseURL: 'https://accounts.booth.pm' });
    } catch {
      // gifts page may be unavailable for some accounts/sessions
      continue;
    }
    const $ = cheerio.load(res.data);
    $('.l-library-item-thumbnail').each((_, el) => {
      const src = $(el).attr('src') || '';
      const m = src.match(/\/i\/(\d+)\//);
      if (m) ids.add(m[1]);
    });
  }
  // If any online itemId does not exist in local set, there are new items.
  for (const id of ids) {
    if (!set.has(String(id))) return true;
  }
  return false;
}

// Download image file with byte progress callback.
async function downloadImage(url, filepath, onBytes) {
  const writer = fs.createWriteStream(filepath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });
  const totalLength = parseInt(response.headers['content-length'] || '0', 10);
  let received = 0;
  response.data.on('data', (chunk) => {
    received += chunk.length;
    if (onBytes) {
      onBytes({
        delta: chunk.length,
        received,
        total: totalLength
      });
    }
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

function normalizeOrderDateText(raw) {
  if (!raw) return null;

  // Remove known prefixes: "注文日時 " or leading ": "
  let s = raw.trim().replace(/^注文日時\s*/, '').replace(/^:\s*/, '');

  // Pattern 1: 2026/01/25 06:14:54
  if (/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    // -> "2026-01-25T06:14:54"
    return s.replace(/\//g, '-').replace(' ', 'T');
  }

  // Pattern 2: 20260125 061454
  if (/^\d{8} \d{6}$/.test(s)) {
    const y = s.slice(0, 4);
    const m = s.slice(4, 6);
    const d = s.slice(6, 8);
    const hh = s.slice(9, 11);
    const mm = s.slice(11, 13);
    const ss = s.slice(13, 15);
    // -> "2026-01-25T06:14:54"
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }

  // Fallback: return as-is (caller may parse with Date).
  return s;
}

function cloneDownloadLinks(downloadLinks) {
  return (downloadLinks || []).map((dl) => ({
    downloadableId: String(dl.downloadableId || ''),
    fileName: String(dl.fileName || ''),
  }));
}

function canonicalFileName(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function generateFilesHash(downloadLinks) {
  const normalized = cloneDownloadLinks(downloadLinks)
    .map((dl) => `${dl.downloadableId}:${dl.fileName}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function generateFilesStableHash(downloadLinks) {
  const normalized = cloneDownloadLinks(downloadLinks)
    .map((dl) => canonicalFileName(dl.fileName))
    .filter(Boolean)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

const NAME_VARIANT_BUCKETS = ['latin', 'katakana', 'hiragana', 'kanji', 'mixed'];
const JP_NAME_NOISE_RE = /(?:\u30aa\u30ea\u30b8\u30ca\u30eb|3D[ＤD]?|\u30e2\u30c7\u30eb|\u30a2\u30d0\u30bf\u30fc|\u5bfe\u5fdc|\u7121\u6599|VRChat|\u30ae\u30df\u30c3\u30af|\u642d\u8f09|\u8863\u88c5)/iu;

function createEmptyNameVariants(raw = '') {
  return {
    raw: String(raw || ''),
    primary: '',
    all: [],
    latin: [],
    katakana: [],
    hiragana: [],
    kanji: [],
    mixed: [],
  };
}

function normalizeNameToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasNameChars(value) {
  return /[A-Za-z\u3040-\u30FF\u3400-\u9FFF々]/u.test(String(value || ''));
}

function stripNameDecorators(value) {
  let s = normalizeNameToken(value);
  if (!s) return '';
  s = s.replace(/^[\[\(\u3010][^\]\)\u3011]{0,40}(?:\u30aa\u30ea\u30b8\u30ca\u30eb|3D[ＤD]?|VRChat)[^\]\)\u3011]{0,40}[\]\)\u3011]\s*/iu, '');
  s = s.replace(/^\s*(?:\u30aa\u30ea\u30b8\u30ca\u30eb\s*)?3D[ＤD]?\s*(?:\u30e2\u30c7\u30eb|\u30a2\u30d0\u30bf\u30fc)\s*/iu, '');
  s = s.replace(/\s*(?:for|\u5bfe\u5fdc)\s*VRChat.*$/iu, '');
  s = s.replace(/\s*ver\.?\s*\d+(?:\.\d+)*.*$/i, '');
  s = s.replace(/\s*[#＃][A-Za-z0-9_\-]+.*$/u, '');
  s = s.replace(/[💎⭐✨]+/gu, '');
  s = s.replace(/^[「『"'`]+|[」』"'`]+$/gu, '');
  s = s.replace(/^[:：\-ー‐–\s]+|[:：\-ー‐–\s]+$/gu, '');
  return s.trim();
}

function classifyNameScript(value) {
  const v = String(value || '');
  const hasLatin = /[A-Za-z]/.test(v);
  const hasHira = /[\u3041-\u3096]/u.test(v);
  const hasKata = /[\u30A1-\u30FA\u30FC\u31F0-\u31FF]/u.test(v);
  const hasHan = /[\u3400-\u9FFF々]/u.test(v);
  if (hasLatin && !hasHira && !hasKata && !hasHan) return 'latin';
  if (hasKata && !hasLatin && !hasHira && !hasHan) return 'katakana';
  if (hasHira && !hasLatin && !hasKata && !hasHan) return 'hiragana';
  if (hasHan && !hasLatin && !hasHira && !hasKata) return 'kanji';
  return 'mixed';
}

function kanaToHiragana(value) {
  return String(value || '').replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function kanaToKatakana(value) {
  return String(value || '').replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

function pushNameVariant(target, value) {
  const normalized = stripNameDecorators(value);
  if (!normalized) return;
  if (!hasNameChars(normalized)) return;
  if (normalized.length < 2 || normalized.length > 64) return;
  if (JP_NAME_NOISE_RE.test(normalized) && !/[\u3040-\u30FF\u3400-\u9FFF]/u.test(normalized) && !/[A-Za-z]{2,}/.test(normalized)) {
    return;
  }
  if (!target.all.includes(normalized)) target.all.push(normalized);
  const bucket = classifyNameScript(normalized);
  if (!target[bucket].includes(normalized)) target[bucket].push(normalized);
  if (bucket === 'katakana') {
    const hira = stripNameDecorators(kanaToHiragana(normalized));
    if (hira && hira !== normalized && !target.hiragana.includes(hira)) {
      target.hiragana.push(hira);
      if (!target.all.includes(hira)) target.all.push(hira);
    }
  } else if (bucket === 'hiragana') {
    const kata = stripNameDecorators(kanaToKatakana(normalized));
    if (kata && kata !== normalized && !target.katakana.includes(kata)) {
      target.katakana.push(kata);
      if (!target.all.includes(kata)) target.all.push(kata);
    }
  }
}

function extractNameCandidates(text, options = {}) {
  const avatarLike = Boolean(options.avatarLike);
  const t = normalizeNameToken(text);
  if (!t) return [];
  const cands = [];
  cands.push(t);

  const quoted = t.match(/[「『"'`][^「」『』"'`]{2,64}[」』"'`]/gu) || [];
  for (const q of quoted) cands.push(q.slice(1, -1));

  if (avatarLike) {
    const slashParts = t.split(/\s*\/\s*/);
    if (slashParts.length > 1) {
      for (const part of slashParts) cands.push(part);
    }
  }

  if (avatarLike) {
    const dashAlias = t.match(/^(.{1,40}?)\s*[-ー‐–]\s*([A-Za-z][A-Za-z0-9 ._’’-]{1,30})(?:\s*[-ー‐–]|$)/u);
    if (dashAlias) {
      cands.push(dashAlias[1]);
      cands.push(dashAlias[2]);
    }
  }

  // Extract kana alias surrounded by dashes: e.g. "「rurune」-ルルネ-" → "ルルネ"
  if (avatarLike) {
    const kanaAlias = t.match(/[-ー‐–]\s*([\u3040-\u30FF]{2,20})\s*(?:[-ー‐–]|$)/u);
    if (kanaAlias) cands.push(kanaAlias[1]);
  }

  return cands.map((v) => normalizeNameToken(v)).filter(Boolean);
}

function extractNameVariantsFromText(text, options = {}) {
  const out = createEmptyNameVariants(text);
  const candidates = extractNameCandidates(text, options);
  for (const cand of candidates) pushNameVariant(out, cand);
  if (!out.all.length) pushNameVariant(out, text);
  out.primary = out.all[0] || stripNameDecorators(text) || normalizeNameToken(text) || '';
  return out;
}

function normalizeCategoryToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

function decodeCategorySlug(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const noPrefix = s.replace(/^https?:\/\/booth\.pm\/[a-z]{2}\/browse\//i, '');
  try {
    return decodeURIComponent(noPrefix);
  } catch {
    return noPrefix;
  }
}

function isThreeDCharacterCategory(cat, categories = []) {
  const targetCharacter = '\u0033d\u30ad\u30e3\u30e9\u30af\u30bf\u30fc';
  const targetModel = '\u0033d\u30e2\u30c7\u30eb';
  const catName = normalizeCategoryToken(cat?.name || '');
  const parentName = normalizeCategoryToken(cat?.parent?.name || '');
  const slugTokens = (categories || [])
    .map((c) => normalizeCategoryToken(decodeCategorySlug(c?.slug || c?.href || '')))
    .filter(Boolean);
  if (catName === targetCharacter) return true;
  if (catName.includes('\u30ad\u30e3\u30e9') && parentName === targetModel) return true;
  if (slugTokens.some((s) => s.includes(targetCharacter))) return true;
  return false;
}

function mergeNameVariants(prev, next, rawFallback = '') {
  const raw = String(rawFallback || next?.raw || prev?.raw || '');
  const merged = createEmptyNameVariants(raw);
  const sources = [prev, next];
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    pushNameVariant(merged, src.primary);
    if (Array.isArray(src.all)) {
      for (const v of src.all) pushNameVariant(merged, v);
    }
    for (const bucket of NAME_VARIANT_BUCKETS) {
      if (!Array.isArray(src[bucket])) continue;
      for (const v of src[bucket]) pushNameVariant(merged, v);
    }
  }
  if (!merged.all.length) pushNameVariant(merged, raw);
  merged.primary = merged.all[0] || stripNameDecorators(raw) || normalizeNameToken(raw) || '';
  return merged;
}

function dedupeMetaItemsByItemId(items) {
  const map = new Map();
  for (const item of (items || [])) {
    const itemId = String(item?.itemId || '').trim();
    if (!itemId) continue;
    const prev = map.get(itemId);
    if (!prev) {
      map.set(itemId, {
        ...item,
        itemId,
        isGift: Boolean(item?.isGift),
        isFreeDownload: Boolean(item?.isFreeDownload),
        downloadLinks: cloneDownloadLinks(item?.downloadLinks || []),
        nameVariants: mergeNameVariants(null, item?.nameVariants || null, item?.itemName || ''),
      });
      continue;
    }
    const mergedLinks = new Map();
    for (const dl of cloneDownloadLinks(prev.downloadLinks || [])) {
      mergedLinks.set(`${dl.downloadableId}:${dl.fileName}`, dl);
    }
    for (const dl of cloneDownloadLinks(item?.downloadLinks || [])) {
      mergedLinks.set(`${dl.downloadableId}:${dl.fileName}`, dl);
    }
    map.set(itemId, {
      ...prev,
      ...item,
      itemId,
      // Keep existing rich fields unless missing on prev.
      categories: Array.isArray(prev.categories) && prev.categories.length ? prev.categories : item.categories,
      primaryCategory: prev.primaryCategory || item.primaryCategory,
      supportedAvatars: Array.isArray(prev.supportedAvatars) && prev.supportedAvatars.length ? prev.supportedAvatars : item.supportedAvatars,
      localAuthorIconPath: prev.localAuthorIconPath || item.localAuthorIconPath,
      localImagePath: prev.localImagePath || item.localImagePath,
      isGift: Boolean(prev?.isGift || item?.isGift),
      isFreeDownload: Boolean(prev?.isFreeDownload || item?.isFreeDownload),
      downloadLinks: Array.from(mergedLinks.values()),
      nameVariants: mergeNameVariants(prev?.nameVariants || null, item?.nameVariants || null, item?.itemName || prev?.itemName || ''),
    });
  }
  return Array.from(map.values());
}

function applyVersionTracking(existingMeta, latestMeta, detectedAt = new Date().toISOString()) {
  const normalizedExisting = dedupeMetaItemsByItemId(existingMeta || []);
  const normalizedLatest = dedupeMetaItemsByItemId(latestMeta || []);
  const existingById = new Map((normalizedExisting || []).map((item) => [String(item.itemId), item]));
  const updates = [];
  const mergedItems = (normalizedLatest || []).map((item) => {
    const itemId = String(item.itemId);
    const prev = existingById.get(itemId);
    const newHash = generateFilesHash(item.downloadLinks);
    const newStableHash = generateFilesStableHash(item.downloadLinks);

    if (!prev) {
      return {
        ...item,
        versionHistory: [{
          detectedAt,
          downloadLinks: cloneDownloadLinks(item.downloadLinks),
          filesHash: newHash,
          filesHashStable: newStableHash,
        }],
        latestVersion: {
          detectedAt,
          filesHash: newHash,
          filesHashStable: newStableHash,
        },
        hasUpdate: false,
        lastChecked: detectedAt,
      };
    }

    const oldHashFromLinks = generateFilesHash(prev.downloadLinks);
    const oldStableFromLinks = generateFilesStableHash(prev.downloadLinks);
    const oldHash = prev.latestVersion?.filesHash === oldHashFromLinks
      ? prev.latestVersion.filesHash
      : oldHashFromLinks;
    const oldStableHash = prev.latestVersion?.filesHashStable === oldStableFromLinks
      ? prev.latestVersion.filesHashStable
      : oldStableFromLinks;
    const versionHistory = Array.isArray(prev.versionHistory) ? [...prev.versionHistory] : [];
    if (!versionHistory.length) {
      versionHistory.push({
        detectedAt: prev.latestVersion?.detectedAt || prev.lastChecked || detectedAt,
        downloadLinks: cloneDownloadLinks(prev.downloadLinks),
        filesHash: oldHash,
        filesHashStable: oldStableHash,
      });
    }

    const changed = newStableHash !== oldStableHash;
    if (changed) {
      versionHistory.push({
        detectedAt,
        downloadLinks: cloneDownloadLinks(item.downloadLinks),
        filesHash: newHash,
        filesHashStable: newStableHash,
      });
      updates.push({
        itemId: item.itemId,
        itemName: item.itemName || '',
        oldHash: oldStableHash,
        newHash: newStableHash,
        detectedAt,
      });
    }

    const latestVersion = changed
      ? { detectedAt, filesHash: newHash, filesHashStable: newStableHash }
      : (prev.latestVersion?.filesHashStable === newStableHash
        ? prev.latestVersion
        : { detectedAt, filesHash: newHash, filesHashStable: newStableHash });

    const mergedCategories = Array.isArray(item?.categories) && item.categories.length > 0
      ? item.categories
      : (Array.isArray(prev?.categories) ? prev.categories : []);
    const mergedPrimaryCategory = item?.primaryCategory || prev?.primaryCategory || null;
    const mergedTagNames = Array.isArray(item?.tagNames) && item.tagNames.length > 0
      ? item.tagNames
      : (Array.isArray(prev?.tagNames) ? prev.tagNames : []);
    const mergedSupportedAvatars = Array.isArray(item?.supportedAvatars) && item.supportedAvatars.length > 0
      ? item.supportedAvatars
      : (Array.isArray(prev?.supportedAvatars) ? prev.supportedAvatars : []);
    const mergedNameVariants = (
      item?.nameVariants && Array.isArray(item.nameVariants?.all) && item.nameVariants.all.length > 0
    )
      ? item.nameVariants
      : (prev?.nameVariants || null);

    return {
      ...prev,
      ...item,
      categories: mergedCategories,
      primaryCategory: mergedPrimaryCategory,
      tagNames: mergedTagNames,
      supportedAvatars: mergedSupportedAvatars,
      localAuthorIconPath: item?.localAuthorIconPath || prev?.localAuthorIconPath || '',
      localImagePath: item?.localImagePath || prev?.localImagePath || '',
      nameVariants: mergedNameVariants,
      versionHistory,
      latestVersion,
      hasUpdate: changed ? true : Boolean(prev.hasUpdate),
      lastChecked: detectedAt,
    };
  });

  return { items: mergedItems, updates };
}

function detectVersionUpdates(existingMeta, latestMeta) {
  const { updates } = applyVersionTracking(existingMeta, latestMeta);
  return updates;
}

function parseLastPageNumber(lastPageHref) {
  const href = String(lastPageHref || '');
  if (!href) return 1;
  const m = href.match(/(?:\?|&)page=(\d+)/);
  const page = m ? Number.parseInt(m[1], 10) : 1;
  if (!Number.isFinite(page) || page <= 0) return 1;
  return page;
}

async function generateLibraryMeta(onLog, onProgress, options = {}) {
  const log = (msg) => onLog && onLog(msg);
  const progress = (payload) => onProgress && onProgress(payload);
  const lightweight = Boolean(options.lightweight);
  const persist = options.persist !== false;

  const client = createBoothClientFromCookies();
  const cacheDir = path.join(getDataRoot(), 'cache');
  const authorIconDir = path.join(getDataRoot(), 'author_icons');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(authorIconDir)) fs.mkdirSync(authorIconDir, { recursive: true });

  // --- Order history ---
  log('Fetching order history...\n');
  const orderHistoryFirstPage = await client.get('/orders', { baseURL: 'https://accounts.booth.pm' });
  const $orders = cheerio.load(orderHistoryFirstPage.data);
  const orderLastPageHref = $orders('.pager .last-page').attr('href');
  const orderTotalPages = parseLastPageNumber(orderLastPageHref);
  log(`Total order pages: ${orderTotalPages}\n`);
  const itemOrderMap = {};

  for (let page = 1; page <= orderTotalPages; page++) {
    log(`Fetching order page ${page}/${orderTotalPages}...\n`);
    progress({ phase: 'orders', page, totalPages: orderTotalPages });

    const url = page === 1 ? '/orders' : `/orders?page=${page}`;
    const res = await client.get(url, { baseURL: 'https://accounts.booth.pm' });
    const $ = cheerio.load(res.data);

    $('a.nav-reverse[href^="/orders"]').each((i, el) => {
      const $link = $(el);

      const imgSrc = $link.find('img').attr('src') || '';
      // Read order timestamp text from caption element.
      const rawText = $link.find('.u-tpg-caption2').text().trim();

      const orderDateTime = normalizeOrderDateText(rawText);

      // Extract itemId from image URL: /i/7494502/ -> 7494502
      let itemId = null;
      const m = imgSrc.match(/\/i\/(\d+)\//);
      if (m) itemId = m[1];

      if (itemId && orderDateTime) {
        if (!itemOrderMap[itemId] || orderDateTime > itemOrderMap[itemId]) {
          itemOrderMap[itemId] = orderDateTime;
        }
      }
    });

    if (page < orderTotalPages) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  log(`Found order dates for ${Object.keys(itemOrderMap).length} items\n`);

  const allItems = [];
  const authorIconCache = {};
  const sources = [
    { key: 'library', label: 'library', path: '/library' },
    { key: 'gifts', label: 'gift library', path: '/library/gifts' },
    { key: 'free_downloads', label: 'free download library', path: '/library/free_downloads' },
  ];

  for (const source of sources) {
    let firstPage;
    try {
      firstPage = await client.get(source.path, { baseURL: 'https://accounts.booth.pm' });
    } catch (error) {
      log(`Skip ${source.label}: ${error.message}\n`);
      continue;
    }
    const $first = cheerio.load(firstPage.data);
    const lastPageHref = $first('.pager .last-page').attr('href');
    const totalPages = parseLastPageNumber(lastPageHref);
    log(`Fetching ${source.label} pages... (${totalPages})\n`);

    for (let page = 1; page <= totalPages; page++) {
      log(`Fetching ${source.label} page ${page}/${totalPages}...\n`);
      progress({ phase: source.key, page, totalPages });
      const url = page === 1 ? source.path : `${source.path}?page=${page}`;
      const res = page === 1
        ? firstPage
        : await client.get(url, { baseURL: 'https://accounts.booth.pm' });
      const $ = cheerio.load(res.data);

      let itemBlocks = $('.mb-16.bg-white').toArray();
      if (!itemBlocks.length) {
        const fallbackBlocks = [];
        $('.l-library-item-thumbnail').each((_idx, thumb) => {
          const parents = $(thumb).parents().toArray();
          const isUniqueThumb = (node) => $(node).find('.l-library-item-thumbnail').length === 1;
          // Prefer the closest ancestor that actually contains this item's download
          // buttons; a link-only ancestor can sit between the thumbnail and that
          // block (BOOTH's redesigned library markup nests the thumbnail link inside
          // a header row separate from the download-button section below it).
          const candidate = parents.find((node) => isUniqueThumb(node) && $(node).find('div[data-test="downloadable"]').length > 0)
            || parents.find((node) => isUniqueThumb(node) && $(node).find('a[href*="/items/"], a[href*=".booth.pm/items/"]').length > 0)
            || parents.find(isUniqueThumb);
          if (candidate && !fallbackBlocks.includes(candidate)) fallbackBlocks.push(candidate);
        });
        itemBlocks = fallbackBlocks;
      }

      $(itemBlocks).each((i, itemBlock) => {
        const $item = $(itemBlock);
        const imageUrl = $item.find('.l-library-item-thumbnail').attr('src');
        const itemName = $item.find('.text-text-default.font-bold.text-16').text().trim();
        const authorLink = $item.find('a[href*=".booth.pm"]').last();
        const authorName = authorLink.find('.text-14.text-text-gray600').text().trim();
        const authorShopUrl = authorLink.attr('href');
        const authorIconUrl = authorLink.find('img').attr('src');

        let authorId = null;
        if (authorIconUrl) {
          const match = authorIconUrl.match(/users\/(\d+)\//);
          if (match) authorId = match[1];
        }

        let itemId = null;
        if (imageUrl) {
          const match = imageUrl.match(/\/i\/(\d+)\//);
          if (match) itemId = match[1];
        }

        const downloadLinks = [];
        $item.find('div[data-test="downloadable"]').each((j, dlEl) => {
          const downloadUrl = $(dlEl).attr('data-href');
          const fileNameDiv = $(dlEl).closest('.desktop.flex, .mt-16').find('.text-14').first();
          const fileName = fileNameDiv.text().trim();
          if (downloadUrl) {
            const match = downloadUrl.match(/\/downloadables\/(\d+)/);
            if (match) {
              downloadLinks.push({
                downloadableId: match[1],
                fileName: fileName || `file_${match[1]}`,
              });
            }
          }
        });

        if (imageUrl && itemId && (downloadLinks.length > 0 || source.key === 'free_downloads')) {
          allItems.push({
            itemId,
            itemName: itemName || itemId,
            // Initial pass is conservative; category-aware pass runs later.
            nameVariants: extractNameVariantsFromText(itemName, { avatarLike: false }),
            orderDateTime: itemOrderMap[itemId] || 'Unknown',
            isGift: source.key === 'gifts',
            isFreeDownload: source.key === 'free_downloads',
            authorId: authorId || 'unknown',
            authorName: authorName || 'Unknown',
            authorShopUrl: authorShopUrl || '',
            authorIconUrl: authorIconUrl || '',
            imageUrl,
            downloadLinks,
          });
          if (authorId && authorIconUrl) {
            authorIconCache[authorId] = authorIconUrl;
          }
        }
      });

      if (page < totalPages) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  const dedupedItems = dedupeMetaItemsByItemId(allItems);
  if (dedupedItems.length !== allItems.length) {
    log(`Deduped library items: ${allItems.length} -> ${dedupedItems.length}\n`);
  }
  allItems.length = 0;
  allItems.push(...dedupedItems);
  log(`Total items: ${allItems.length}\n`);

  // Load known avatars.
  const avatarsPath = path.join(getDataRoot(), 'avatars.json');
  let knownAvatars = [];
  if (fs.existsSync(avatarsPath)) {
    try {
      const raw = parseAvatarRowsFromRawText(fs.readFileSync(avatarsPath, 'utf8'));
      knownAvatars = (Array.isArray(raw) ? raw : [])
        .map((row) => normalizeAvatarEntry(row))
        .filter(Boolean);
    } catch {
      knownAvatars = [];
    }
  }
  const knownAvatarLookup = buildKnownAvatarLookupEntries(knownAvatars);
  const knownAvatarMap = new Map(knownAvatars.map((a) => [normalizeAvatarLookupToken(a.name), a]));
  const learnedAvatarMap = new Map();

  // Free-download items have no data-test="downloadable" button on the library
  // page, so their downloadLinks can only come from the item JSON. Run this even
  // in lightweight mode (skipping the heavier category/avatar pass below) so
  // free items don't end up permanently stuck with an empty downloadLinks list.
  for (const item of allItems) {
    if (!item.isFreeDownload || (Array.isArray(item.downloadLinks) && item.downloadLinks.length > 0)) continue;
    try {
      const res = await client.get(`/ja/items/${item.itemId}.json`);
      const freeLinks = extractFreeDownloadLinksFromItemJson(res.data);
      if (freeLinks.length > 0) item.downloadLinks = freeLinks;
    } catch {
      // will retry on next sync
    }
  }

  // --- Fetch category and avatar info from item JSON ---
  if (!lightweight) {
  log('Fetching categories/avatars for items...\n');
  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    try {
      progress({ phase: 'categories', index: i + 1, total: allItems.length });

      const res = await client.get(`/ja/items/${item.itemId}.json`);
      const data = res.data;
      if ((!item.itemName || item.itemName === String(item.itemId)) && data?.name) {
        item.itemName = String(data.name || '').trim() || item.itemName;
      }
      if (item.isFreeDownload && (!Array.isArray(item.downloadLinks) || item.downloadLinks.length === 0)) {
        const freeLinks = extractFreeDownloadLinksFromItemJson(data);
        if (freeLinks.length > 0) {
          item.downloadLinks = freeLinks;
        }
      }
      const cat = data.category;

      const categories = [];
      if (cat && cat.parent) {
        categories.push({
          href: cat.parent.url,
          text: cat.parent.name,
          slug: cat.parent.url.replace(/^https:\/\/booth\.pm\/ja\/browse\//, '')
        });
      }
      if (cat) {
        categories.push({
          href: cat.url,
          text: cat.name,
          slug: cat.url.replace(/^https:\/\/booth\.pm\/ja\/browse\//, '')
        });
      }

      item.categories = categories;
      const { learned } = enrichItemAvatarMetadata(item, data, categories, knownAvatarLookup);

      // Learn avatars as one record per 3D-character product title.
      if (learned) {
        const key = normalizeAvatarLookupToken(learned.name);
        const prev = learnedAvatarMap.get(key);
        if (!prev) {
          learnedAvatarMap.set(key, learned);
        } else {
          prev.count = Number(prev.count || 0) + 1;
          const merged = mergeAliasRecord(prev, learned);
          prev.alphabet = merged.alphabet;
          prev.hiragana = merged.hiragana;
          prev.katakana = merged.katakana;
          prev.kanji = merged.kanji;
        }
      }

      log(`${i + 1}/${allItems.length} Categories/avatars fetched for ${item.itemId}\n`);
      await new Promise(resolve => setTimeout(resolve, 150));
    } catch (error) {
      log(`${i + 1}/${allItems.length} Categories/avatars failed for ${item.itemId}: ${error.message}\n`);
      item.categories = [];
      item.primaryCategory = null;
      item.isAvatarItem = false;
      item.supportedAvatars = [];
      item.tagNames = [];
    }
  }

  // --- Update avatars.json ---
  const AUTO_AVATAR_THRESHOLD = 1; // Register when seen at least once.
  for (const learned of learnedAvatarMap.values()) {
    const normalizedName = normalizeAvatarLookupToken(learned.name);
    const count = Number(learned?.count || 0);
    if (!normalizedName || count < AUTO_AVATAR_THRESHOLD) continue;
    const prev = knownAvatarMap.get(normalizedName);
    if (prev) {
      prev.count = Math.max(Number(prev.count || 0), count);
      const merged = mergeAliasRecord(prev, learned);
      prev.alphabet = merged.alphabet;
      prev.hiragana = merged.hiragana;
      prev.katakana = merged.katakana;
      prev.kanji = merged.kanji;
      continue;
    }
    const next = normalizeAvatarEntry(learned);
    if (!next) continue;
    knownAvatars.push(next);
    knownAvatarMap.set(normalizedName, next);
  }
  const compactedKnownAvatars = compactAvatarEntries(knownAvatars);
  const serializedAvatars = compactedKnownAvatars
    .map((entry) => serializeAvatarEntryForFile(entry))
    .filter(Boolean)
    .sort((a, b) => {
      const diff = Number(b?.count || 0) - Number(a?.count || 0);
      if (diff !== 0) return diff;
      return String(a?.name || '').localeCompare(String(b?.name || ''), 'ja');
    });
  writeJsonFileAtomic(avatarsPath, serializedAvatars);
  log(`Updated avatars.json (${knownAvatars.length} avatars)\n`);
  }

  // --- Download size progress counters ---
  let totalBytesPlanned = 0;
  let totalBytesReceived = 0;
  const addPlannedBytes = (len) => {
    if (!isNaN(len) && len > 0) totalBytesPlanned += len;
  };
  const addReceivedDelta = (delta) => {
    if (!isNaN(delta) && delta > 0) totalBytesReceived += delta;
  };

  // --- Download author icons ---
  if (!lightweight) {
  log('Downloading author icons...\n');
  const authorIds = Object.keys(authorIconCache);
  for (let i = 0; i < authorIds.length; i++) {
    const authorId = authorIds[i];
    const iconUrl = authorIconCache[authorId];
    progress({
      phase: 'authorIcons',
      index: i + 1,
      total: authorIds.length,
    });
    try {
      const ext = path.extname(new URL(iconUrl).pathname) || '.jpg';
      const fileName = `${authorId}${ext}`;
      const filePath = path.join(authorIconDir, fileName);
      if (fs.existsSync(filePath)) {
        log(`${i + 1}/${authorIds.length} Author icon cached: ${fileName}\n`);
        continue;
      }

      let plannedAddedForThisFile = false;
      try {
        const headRes = await axios.head(iconUrl);
        const len = parseInt(headRes.headers['content-length'] || '0', 10);
        if (!isNaN(len) && len > 0) {
          addPlannedBytes(len);
          plannedAddedForThisFile = true;
        }
      } catch {
        // ignore
      }

      await downloadImage(iconUrl, filePath, ({ delta, total }) => {
        if (total && !plannedAddedForThisFile) {
          addPlannedBytes(total);
          plannedAddedForThisFile = true;
        }
        addReceivedDelta(delta);
        progress({
          phase: 'bytes',
          received: totalBytesReceived,
          totalBytes: totalBytesPlanned,
        });
      });

      log(`${i + 1}/${authorIds.length} Author icon downloaded: ${fileName}\n`);
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      log(`${i + 1}/${authorIds.length} Author icon failed: ${error.message}\n`);
    }
  }

  // Backfill local author icon path to each item.
  allItems.forEach(item => {
    if (item.authorId && item.authorId !== 'unknown') {
      const ext = item.authorIconUrl ? path.extname(new URL(item.authorIconUrl).pathname) : '.jpg';
      item.localAuthorIconPath = `./author_icons/${item.authorId}${ext}`;
    }
  });

  // --- Download item thumbnails ---
  log('Downloading item images...\n');
  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    progress({
      phase: 'thumbnails',
      index: i + 1,
      total: allItems.length,
    });

    try {
      const ext = path.extname(new URL(item.imageUrl).pathname) || '.jpg';
      const fileName = `${item.itemId}${ext}`;
      const filePath = path.join(cacheDir, fileName);

      if (fs.existsSync(filePath)) {
        log(`${i + 1}/${allItems.length} Image cached: ${fileName}\n`);
      } else {
        let plannedAddedForThisFile = false;
        try {
        const headRes = await axios.head(item.imageUrl);
          const len = parseInt(headRes.headers['content-length'] || '0', 10);
          if (!isNaN(len) && len > 0) {
            addPlannedBytes(len);
            plannedAddedForThisFile = true;
          }
        } catch {
          // ignore
        }

        await downloadImage(item.imageUrl, filePath, ({ delta, total }) => {
          if (total && !plannedAddedForThisFile) {
            addPlannedBytes(total);
            plannedAddedForThisFile = true;
          }
          addReceivedDelta(delta);
          progress({
            phase: 'bytes',
            received: totalBytesReceived,
            totalBytes: totalBytesPlanned,
          });
        });

        log(`${i + 1}/${allItems.length} Image downloaded: ${fileName}\n`);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      item.localImagePath = `./cache/${fileName}`;
    } catch (error) {
      log(`${i + 1}/${allItems.length} Image failed: ${error.message}\n`);
    }
  }

  }
  if (persist) {
    const dst = path.join(getDataRoot(), 'librarymeta.json');
    fs.writeFileSync(dst, JSON.stringify(allItems, null, 2), 'utf8');
    log(`Saved librarymeta.json (${allItems.length} items)\n`);
  }
  progress({ phase: 'done' });

  return allItems;
}

// CLI entry point
if (require.main === module) {
  generateLibraryMeta(
    (m) => process.stdout.write(m),
    (p) => process.stdout.write(JSON.stringify(p) + '\n')
  ).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

function isFreePriceText(rawText) {
  const compact = String(rawText || '').replace(/\s+/g, '');
  if (!compact) return false;
  return /^[\\¥￥]?0(?:\.0+)?(?:円)?$/i.test(compact);
}

function extractDownloadableIdFromHref(href) {
  const m = String(href || '').match(/\/downloadables\/(\d+)/);
  return m ? String(m[1]) : '';
}

function extractBoothItemId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const direct = raw.match(/^\d{4,}$/);
  if (direct) return direct[0];
  const fromUrl = raw.match(/booth\.pm\/(?:[a-z]{2}\/)?items\/(\d+)/i);
  if (fromUrl) return String(fromUrl[1] || '');
  const fromPath = raw.match(/\/items\/(\d+)/i);
  if (fromPath) return String(fromPath[1] || '');
  return '';
}

function extractFreeDownloadLinksFromItemJson(payload) {
  const rows = [];
  const variations = Array.isArray(payload?.variations) ? payload.variations : [];
  for (const v of variations) {
    const priceCandidates = [
      v?.price,
      v?.price_yen,
      v?.price_jpy,
      v?.display_price,
      v?.amount,
    ];
    let isFree = false;
    for (const p of priceCandidates) {
      if (typeof p === 'number' && p === 0) { isFree = true; break; }
      if (typeof p === 'string') {
        if (isFreePriceText(p)) { isFree = true; break; }
      }
    }
    if (!isFree) continue;

    const name = String(v?.name || v?.variation_name || '').trim();
    const downloadableIdCandidates = [
      v?.downloadable_id,
      v?.downloadableId,
      v?.downloadable?.id,
    ].map((x) => String(x || '').trim()).filter(Boolean);

    const urlCandidates = [
      v?.download_url,
      v?.downloadable_url,
      v?.downloadable?.url,
      v?.url,
    ].map((x) => String(x || '').trim()).filter(Boolean);

    for (const u of urlCandidates) {
      const id = extractDownloadableIdFromHref(u);
      if (id) downloadableIdCandidates.push(id);
    }

    // Actual per-file list for free variations: downloadable.musics / no_musics,
    // each with its own downloadables/{id} URL. Neither is covered by the
    // single-URL candidates above.
    const fileEntries = [
      ...(Array.isArray(v?.downloadable?.musics) ? v.downloadable.musics : []),
      ...(Array.isArray(v?.downloadable?.no_musics) ? v.downloadable.no_musics : []),
    ];
    const fileEntryIds = new Set(
      fileEntries
        .map((f) => extractDownloadableIdFromHref(String(f?.url || '')))
        .filter(Boolean),
    );

    const uniqueIds = [...new Set(downloadableIdCandidates)];
    for (const id of uniqueIds) {
      if (fileEntryIds.has(id)) continue;
      rows.push({
        downloadableId: id,
        fileName: name || `file_${id}`,
        variationName: name,
      });
    }

    for (const f of fileEntries) {
      const id = extractDownloadableIdFromHref(String(f?.url || ''));
      if (!id) continue;
      const fileName = String(f?.name || (f?.file_name ? `${f.file_name}${f.file_extension || ''}` : '') || '').trim();
      rows.push({
        downloadableId: id,
        fileName: fileName || name || `file_${id}`,
        variationName: name,
      });
    }
  }
  return dedupeDownloadLinks(rows);
}

async function fetchItemPricePublic(itemId) {
  try {
    const res = await axios.get(`https://booth.pm/ja/items/${String(itemId)}.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 10000,
    });
    const variations = Array.isArray(res.data?.variations) ? res.data.variations : [];
    const rows = variations
      .map((v, index) => {
        const p = v?.price ?? v?.price_yen ?? v?.price_jpy ?? v?.amount;
        if (typeof p !== 'number' || p <= 0) return null;
        const name = String(v?.name || v?.title || v?.label || v?.variation_name || '').trim();
        return {
          name: name || `Variation ${index + 1}`,
          price: p,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, 'ja'));
    if (!rows.length) return null;
    const prices = rows.map((row) => row.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return {
      price: min,
      priceMin: min,
      priceMax: max,
      priceVariationCount: rows.length,
      priceVariations: rows.slice(0, 30),
    };
  } catch {
    return null;
  }
}

module.exports = {
  generateLibraryMeta,
  checkLibraryHasNewItems,
  generateFilesHash,
  generateFilesStableHash,
  dedupeMetaItemsByItemId,
  detectVersionUpdates,
  applyVersionTracking,
  setDataRoot,
  isFreePriceText,
  extractDownloadableIdFromHref,
  extractBoothItemId,
  extractFreeDownloadLinksFromItemJson,
  fetchItemPricePublic,
  learnAvatarsToFile,
  syncAvatarItemsToFile,
  fixAvatarItemFields,
  enrichItemAvatarMetadata,
  // テスト用エクスポート (内部純粋関数)
  _test: {
    getPrimaryCategory,
    normalizeAvatarLookupToken,
    normalizeNameToken,
    classifyNameScript,
    isTagLikelyAvatarNoise,
    isLikelyAvatarNameFromTitle,
    inferSupportedAvatarsFromTags,
    extractSupportedAvatarsFromJson,
    extractSupportedAvatarsFromVariations,
    extractSupportedAvatarsFromFileNames,
    hasPurchasedAvatarBaseVariation,
    normalizeAvatarEntry,
    extractTagNamesFromItemJson,
    parseAvatarRowsFromRawText,
    enrichItemAvatarMetadata,
    normalizeOrderDateText,
    parseLastPageNumber,
    stripNameDecorators,
    kanaToHiragana,
    kanaToKatakana,
  },
};
