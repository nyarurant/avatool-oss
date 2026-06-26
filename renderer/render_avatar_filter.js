(function attachAvatarFilterUtils(global) {
  function normalizeAvatarFilterValue(value) {
    return String(value || '').trim();
  }

  function normalizeAvatarMatchKey(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\-_\/|・･()（）[\]【】「」『』"'`.,:：、。]+/g, '')
      .trim();
  }

  function kanaToHiragana(value) {
    return String(value || '').replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }

  function kanaToKatakana(value) {
    return String(value || '').replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  }

  function splitAvatarNameParts(value) {
    return String(value || '')
      .split(/[\s\/|・･()（）[\]【】「」『』"'`.,:：、。]+|(?<=.)-(?=.)/g)
      .map((part) => String(part || '').trim())
      .filter((part) => part.length >= 2);
  }

  function avatarComparableKeys(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];
    const set = new Set();
    const variants = [raw, kanaToHiragana(raw), kanaToKatakana(raw)];
    for (const variant of variants) {
      const key = normalizeAvatarMatchKey(variant);
      if (key) set.add(key);
      for (const part of splitAvatarNameParts(variant)) {
        const partKey = normalizeAvatarMatchKey(part);
        if (partKey) set.add(partKey);
      }
    }
    return Array.from(set);
  }

  function isCompatFilterNoise(value) {
    const s = String(value || '').trim().toLowerCase();
    if (!s) return true;
    const exact = new Set(['vrchat', 'vrc', '3d', 'avatar']);
    return exact.has(s);
  }

  function getAssetAvatarPool(asset) {
    // Avatar base items: only use supportedAvatars (their own name).
    // supportedAvatarsInferred may contain names from bundled content inside the package
    // (e.g. a Chocolat-branded folder inside a Sio avatar package) which are not meaningful
    // for avatar filtering.
    const rows = asset?.isAvatarItem
      ? (Array.isArray(asset?.supportedAvatars) ? asset.supportedAvatars : [])
      : [
          ...(Array.isArray(asset?.supportedAvatars) ? asset.supportedAvatars : []),
          ...(Array.isArray(asset?.supportedAvatarsInferred) ? asset.supportedAvatarsInferred : []),
        ];
    const out = [];
    const seen = new Set();
    for (const row of rows) {
      const name = String(row || '').trim();
      if (!name) continue;
      if (name.length < 2 || name.length > 64) continue;
      if (isCompatFilterNoise(name)) continue;
      const keys = avatarComparableKeys(name);
      if (!keys.length) continue;
      if (keys.some((key) => seen.has(key))) continue;
      keys.forEach((key) => seen.add(key));
      out.push(name);
    }
    return out;
  }

  // Returns Japanese nameVariant (katakana then hiragana) for an avatar item if
  // its pool is entirely Latin — used to bridge the Latin↔kana gap in filter matching.
  function getAvatarItemJaAlias(asset) {
    if (!asset?.isAvatarItem) return '';
    const pool = getAssetAvatarPool(asset);
    if (!pool.length || !pool.every((n) => /^[a-z0-9\-\s_.,'!?/]+$/i.test(n))) return '';
    const nv = asset.nameVariants || {};
    return String(
      (Array.isArray(nv.katakana) && nv.katakana[0]) ||
      (Array.isArray(nv.hiragana) && nv.hiragana[0]) || ''
    ).trim();
  }

  function matchesAvatarFilter(asset, selectedAvatar) {
    // Multi-select: if array, match ANY selected avatar (OR logic)
    if (Array.isArray(selectedAvatar)) {
      if (!selectedAvatar.length) return true;
      return selectedAvatar.some((av) => matchesAvatarFilter(asset, av));
    }
    const pickKeys = new Set(avatarComparableKeys(selectedAvatar));
    if (!pickKeys.size) return true;
    let pool = getAssetAvatarPool(asset);
    // For avatar items whose pool is Latin-only, also test the Japanese nameVariant
    // so that e.g. selecting "ルルネ" matches an item with supportedAvatars: ["rurune"].
    const jaAlias = getAvatarItemJaAlias(asset);
    if (jaAlias) pool = [...pool, jaAlias];
    return pool.some((name) => {
      const keys = avatarComparableKeys(name);
      return keys.some((key) => pickKeys.has(key));
    });
  }

  function buildAvatarImageMap(assets) {
    const map = new Map();
    for (const asset of (Array.isArray(assets) ? assets : [])) {
      if (!asset?.isAvatarItem || !asset?.preview?.[0]) continue;
      for (const name of getAssetAvatarPool(asset)) {
        if (name && !map.has(name)) map.set(name, asset.preview[0]);
      }
      // Also map the Japanese nameVariant so the preview shows for e.g. "ルルネ"
      // even when the stored pool name is the Latin "rurune".
      const jaAlias = getAvatarItemJaAlias(asset);
      if (jaAlias && !map.has(jaAlias)) map.set(jaAlias, asset.preview[0]);
    }
    return map;
  }

  function normalizeAvatarAliasValues(value) {
    const rows = Array.isArray(value) ? value : (value ? [value] : []);
    return rows
      .flatMap((row) => String(row || '').split(/[\/|]/g))
      .map((row) => String(row || '').trim())
      .filter(Boolean);
  }

  function classifyAvatarAliasValue(value) {
    const s = String(value || '').trim();
    if (!s) return 'other';
    const hasHira = /[\p{Script=Hiragana}]/u.test(s);
    const hasKata = /[\p{Script=Katakana}]/u.test(s);
    const hasHan = /[\p{Script=Han}]/u.test(s);
    const hasLatin = /[A-Za-z]/.test(s);
    if (hasHan && !hasHira && !hasKata && !hasLatin) return 'kanji';
    if (hasHira && !hasKata && !hasHan && !hasLatin) return 'hiragana';
    if (hasKata && !hasHira && !hasHan && !hasLatin) return 'katakana';
    if (hasLatin && !hasHira && !hasKata && !hasHan) return 'alphabet';
    return 'other';
  }

  function appendUniqueAlias(out, seen, value) {
    const s = String(value || '').trim();
    if (!s) return;
    const key = normalizeAvatarMatchKey(s);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(s);
  }

  function collectAvatarAliasParts(row) {
    const out = [];
    const seen = new Set();
    appendUniqueAlias(out, seen, row?.name || row?.primaryAvatar || '');
    for (const value of normalizeAvatarAliasValues(row?.supportedAvatars)) appendUniqueAlias(out, seen, value);
    for (const value of normalizeAvatarAliasValues(row?.supportedAvatarsInferred)) appendUniqueAlias(out, seen, value);
    for (const key of ['hiragana', 'katakana', 'kanji', 'alphabet']) {
      for (const value of normalizeAvatarAliasValues(row?.[key])) appendUniqueAlias(out, seen, value);
    }
    const nv = row?.nameVariants || {};
    for (const key of ['hiragana', 'katakana', 'kanji', 'latin']) {
      for (const value of normalizeAvatarAliasValues(nv?.[key])) appendUniqueAlias(out, seen, value);
    }
    for (const value of normalizeAvatarAliasValues(nv?.all)) {
      const bucket = classifyAvatarAliasValue(value);
      if (bucket === 'hiragana' || bucket === 'katakana' || bucket === 'kanji' || bucket === 'alphabet') {
        appendUniqueAlias(out, seen, value);
      }
    }
    return out;
  }

  function collectAvatarOfficialSourceText(row) {
    const nv = row?.nameVariants || {};
    return [
      row?.title,
      row?.itemName,
      row?.name,
      nv?.raw,
      nv?.primary,
      ...(Array.isArray(nv?.all) ? nv.all : []),
    ].map((value) => String(value || '').trim()).filter(Boolean).join('\n');
  }

  function collectAvatarBioSourceText(row) {
    return [
      row?.boothDescription,
      row?.description,
    ].map((value) => String(value || '').trim()).filter(Boolean).join('\n');
  }

  function chooseAvatarDisplayName(aliases, sourceText = '') {
    const parts = [];
    const seen = new Set();
    for (const value of (Array.isArray(aliases) ? aliases : [])) appendUniqueAlias(parts, seen, value);
    if (!parts.length) return '';

    const source = String(sourceText || '').normalize('NFKC');
    const scoreAlias = (value, index) => {
      const s = String(value || '').trim();
      const bucket = classifyAvatarAliasValue(s);
      const foundAt = source ? source.indexOf(s.normalize('NFKC')) : -1;
      const found = foundAt >= 0;
      const scriptRank = {
        kanji: 0,
        hiragana: 8,
        katakana: 16,
        other: 40,
        alphabet: 80,
      }[bucket] ?? 40;
      let score = index * 2 + scriptRank;
      if (found) score -= 160;
      else if (index === 0) score -= 35;
      if (/[【】[\]()（）]/.test(s) || /\s/.test(s)) score += 30;
      if (s.length > 18) score += 30;
      if (found) score += Math.min(foundAt, 80) / 20;
      return score;
    };

    return parts
      .map((value, index) => ({ value, score: scoreAlias(value, index) }))
      .sort((a, b) => a.score - b.score || a.value.localeCompare(b.value, 'ja'))[0]?.value || parts[0];
  }

  function buildAvatarTooltipLabel(name, aliasParts, preferredName = '') {
    return String(preferredName || name || '').trim();
  }

  function buildAvatarLabelMap(assets, avatarRows = []) {
    const keyToParts = new Map();
    const keyToOfficialPreferred = new Map();
    const keyToFallbackPreferred = new Map();
    const keyToBioSourceTexts = new Map();
    const addAliases = (aliases, sourceText = '', options = {}) => {
      const parts = (Array.isArray(aliases) ? aliases : []).map((v) => String(v || '').trim()).filter(Boolean);
      if (!parts.length) return;
      const keys = new Set(parts.flatMap((part) => avatarComparableKeys(part)));
      const preferred = chooseAvatarDisplayName(parts, sourceText);
      for (const key of keys) {
        const current = keyToParts.get(key) || [];
        const seen = new Set(current.map((v) => normalizeAvatarMatchKey(v)).filter(Boolean));
        for (const part of parts) appendUniqueAlias(current, seen, part);
        keyToParts.set(key, current);
        if (options.official) {
          const currentPreferred = keyToOfficialPreferred.get(key) || '';
          if (!currentPreferred || sourceText) keyToOfficialPreferred.set(key, preferred);
        } else {
          const currentPreferred = keyToFallbackPreferred.get(key) || '';
          if (!currentPreferred || sourceText) keyToFallbackPreferred.set(key, preferred);
        }
      }
    };
    const addBioSourceForAliases = (aliases, sourceText = '') => {
      const text = String(sourceText || '').trim();
      if (!text) return;
      const keys = new Set((Array.isArray(aliases) ? aliases : []).flatMap((part) => avatarComparableKeys(part)));
      for (const key of keys) {
        const rows = keyToBioSourceTexts.get(key) || [];
        rows.push(text);
        keyToBioSourceTexts.set(key, rows);
      }
    };

    for (const row of (Array.isArray(avatarRows) ? avatarRows : [])) {
      addAliases(collectAvatarAliasParts(row), collectAvatarOfficialSourceText(row));
    }
    for (const asset of (Array.isArray(assets) ? assets : [])) {
      if (asset?.isAvatarItem) {
        addAliases(collectAvatarAliasParts(asset), collectAvatarOfficialSourceText(asset), { official: true });
      }
    }
    for (const asset of (Array.isArray(assets) ? assets : [])) {
      const sourceText = collectAvatarBioSourceText(asset);
      for (const name of getAssetAvatarPool(asset)) {
        const aliases = [];
        const seen = new Set();
        appendUniqueAlias(aliases, seen, name);
        for (const key of avatarComparableKeys(name)) {
          for (const value of (keyToParts.get(key) || [])) appendUniqueAlias(aliases, seen, value);
        }
        addBioSourceForAliases(aliases, sourceText);
      }
    }

    const map = new Map();
    for (const asset of (Array.isArray(assets) ? assets : [])) {
      for (const name of getAssetAvatarPool(asset)) {
        const aliases = [];
        const seen = new Set();
        for (const key of avatarComparableKeys(name)) {
          for (const value of (keyToParts.get(key) || [])) appendUniqueAlias(aliases, seen, value);
        }
        const bioSourceText = avatarComparableKeys(name)
          .flatMap((key) => keyToBioSourceTexts.get(key) || [])
          .join('\n');
        const officialPreferred = avatarComparableKeys(name).map((key) => keyToOfficialPreferred.get(key)).find(Boolean) || '';
        const fallbackPreferred = avatarComparableKeys(name).map((key) => keyToFallbackPreferred.get(key)).find(Boolean) || '';
        const bioPreferred = bioSourceText ? chooseAvatarDisplayName(aliases, bioSourceText) : '';
        const preferred = officialPreferred || bioPreferred || fallbackPreferred;
        map.set(name, buildAvatarTooltipLabel(name, aliases, preferred));
      }
    }
    for (const row of (Array.isArray(avatarRows) ? avatarRows : [])) {
      const aliases = collectAvatarAliasParts(row);
      const preferred = chooseAvatarDisplayName(aliases, collectAvatarOfficialSourceText(row));
      for (const name of aliases) {
        if (!map.has(name)) map.set(name, buildAvatarTooltipLabel(name, aliases, preferred));
      }
    }
    return map;
  }

  global.AvatoolRenderAvatarFilter = {
    normalizeAvatarFilterValue,
    normalizeAvatarMatchKey,
    kanaToHiragana,
    kanaToKatakana,
    splitAvatarNameParts,
    avatarComparableKeys,
    isCompatFilterNoise,
    getAssetAvatarPool,
    matchesAvatarFilter,
    buildAvatarImageMap,
    buildAvatarLabelMap,
  };
})(window);
