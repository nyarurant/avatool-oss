'use strict';

const {
  generateFilesHash,
  generateFilesStableHash,
  dedupeMetaItemsByItemId,
  applyVersionTracking,
  detectVersionUpdates,
  isFreePriceText,
  extractDownloadableIdFromHref,
  extractBoothItemId,
  extractFreeDownloadLinksFromItemJson,
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
} = require('../lib/booth_meta_fetcher');

// ---------------------------------------------------------------------------
// checkLibraryHasNewItems
// ---------------------------------------------------------------------------
describe('checkLibraryHasNewItems', () => {
  test('detects new items from free download history', async () => {
    const htmlByPath = {
      '/library': '<html><body></body></html>',
      '/library/gifts': '<html><body></body></html>',
      '/library/free_downloads': '<img class="l-library-item-thumbnail" src="https://booth.pximg.net/c/300x300_a2_g5/i/1234567/sample.jpg">',
    };
    const get = jest.fn(async (targetPath) => ({ data: htmlByPath[targetPath] || '' }));
    jest.resetModules();
    jest.doMock('axios', () => ({ create: jest.fn(() => ({ get })) }));
    jest.doMock('../lib/booth_cookie_store', () => ({
      readBoothCookiesFromFile: jest.fn(() => [{ name: 'session', value: 'test' }]),
    }));

    let checkLibraryHasNewItems;
    jest.isolateModules(() => {
      ({ checkLibraryHasNewItems } = require('../lib/booth_meta_fetcher'));
    });

    await expect(checkLibraryHasNewItems([])).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith('/library/free_downloads', { baseURL: 'https://accounts.booth.pm' });

    jest.dontMock('axios');
    jest.dontMock('../lib/booth_cookie_store');
    jest.resetModules();
  });
});

// ---------------------------------------------------------------------------
// getPrimaryCategory
// ---------------------------------------------------------------------------
describe('getPrimaryCategory', () => {
  test('returns the last category in the list', () => {
    expect(getPrimaryCategory(['3D Character', 'Outfit'])).toBe('Outfit');
    expect(getPrimaryCategory(['Gadget'])).toBe('Gadget');
  });

  test('returns null for an empty list', () => {
    expect(getPrimaryCategory([])).toBeNull();
  });

  test('returns null for null / undefined', () => {
    expect(getPrimaryCategory(null)).toBeNull();
    expect(getPrimaryCategory(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeAvatarLookupToken
// ---------------------------------------------------------------------------
describe('normalizeAvatarLookupToken', () => {
  test('normalizes NFKC text and collapses spaces', () => {
    expect(normalizeAvatarLookupToken('Ａ Ｂ Ｃ')).toBe('abc');
    expect(normalizeAvatarLookupToken('ここな')).toBe('ここな');
    expect(normalizeAvatarLookupToken('Ko Ko Na')).toBe('kokona');
  });

  test('converts full-width digits to ascii digits', () => {
    expect(normalizeAvatarLookupToken('１２３')).toBe('123');
  });

  test('returns empty string for null / undefined / empty string', () => {
    expect(normalizeAvatarLookupToken(null)).toBe('');
    expect(normalizeAvatarLookupToken(undefined)).toBe('');
    expect(normalizeAvatarLookupToken('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// normalizeNameToken
// ---------------------------------------------------------------------------
describe('normalizeNameToken', () => {
  test('normalizes NFKC text and trims whitespace', () => {
    expect(normalizeNameToken('  ここな  ')).toBe('ここな');
    expect(normalizeNameToken('Ａｂｃ')).toBe('Abc');
  });

  test('collapses repeated spaces to a single space', () => {
    expect(normalizeNameToken('A  B   C')).toBe('A B C');
  });

  test('returns empty string for null / undefined', () => {
    expect(normalizeNameToken(null)).toBe('');
    expect(normalizeNameToken(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// classifyNameScript
// ---------------------------------------------------------------------------
describe('classifyNameScript', () => {
  test('latin-only names are classified as latin', () => {
    expect(classifyNameScript('Kokona')).toBe('latin');
    expect(classifyNameScript('Alice')).toBe('latin');
  });

  test('katakana-only names are classified as katakana', () => {
    expect(classifyNameScript('ココナ')).toBe('katakana');
    expect(classifyNameScript('アリス')).toBe('katakana');
  });

  test('hiragana-only names are classified as hiragana', () => {
    expect(classifyNameScript('ここな')).toBe('hiragana');
  });

  test('kanji-only names are classified as kanji', () => {
    expect(classifyNameScript('桜')).toBe('kanji');
  });

  test('mixed-script names are classified as mixed', () => {
    expect(classifyNameScript('ここなKokona')).toBe('mixed');
    expect(classifyNameScript('桜花コナ')).toBe('mixed');
  });
});

// ---------------------------------------------------------------------------
// kanaToHiragana / kanaToKatakana
// ---------------------------------------------------------------------------
describe('kanaToHiragana', () => {
  test('converts katakana to hiragana', () => {
    expect(kanaToHiragana('ここナ')).toBe('ここな');
    expect(kanaToHiragana('アリス')).toBe('ありす');
  });

  test('keeps hiragana unchanged', () => {
    expect(kanaToHiragana('ここな')).toBe('ここな');
  });
});

describe('kanaToKatakana', () => {
  test('ひらがな → カタカナ', () => {
    expect(kanaToKatakana('ここな')).toBe('ココナ');
    expect(kanaToKatakana('ありす')).toBe('アリス');
  });

  test('keeps katakana unchanged', () => {
    expect(kanaToKatakana('ココナ')).toBe('ココナ');
  });
});

// ---------------------------------------------------------------------------
// stripNameDecorators
// ---------------------------------------------------------------------------
describe('stripNameDecorators', () => {
  test('removes VRChat support suffixes', () => {
    expect(stripNameDecorators('ここな for VRChat')).toBe('ここな');
    expect(stripNameDecorators('ここな対応VRChat ver.1.0')).toBe('ここな');
  });

  test('removes ver.x.x suffixes', () => {
    expect(stripNameDecorators('ここな ver.2.3.1')).toBe('ここな');
    expect(stripNameDecorators('Alice ver2')).toBe('Alice');
  });

  test('removes surrounding quotes', () => {
    expect(stripNameDecorators('「ここな」')).toBe('ここな');
  });

  test('returns empty string for empty / null input', () => {
    expect(stripNameDecorators('')).toBe('');
    expect(stripNameDecorators(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// isTagLikelyAvatarNoise
// ---------------------------------------------------------------------------
describe('isTagLikelyAvatarNoise', () => {
  test.each([
    'vrchat', 'VRChat', 'vrc', '3D', '3dモデル', '衣装', 'アバター', 'unity', 'avatar',
  ])('"%s" is treated as noise', (tag) => {
    expect(isTagLikelyAvatarNoise(tag)).toBe(true);
  });

  test('"対応" tags are also treated as noise', () => {
    expect(isTagLikelyAvatarNoise('ここな対応')).toBe(true);
    expect(isTagLikelyAvatarNoise('複数アバター対応')).toBe(true);
  });

  test('アバター名はノイズではない', () => {
    expect(isTagLikelyAvatarNoise('ここな')).toBe(false);
    expect(isTagLikelyAvatarNoise('アリシア')).toBe(false);
    expect(isTagLikelyAvatarNoise('Kokona')).toBe(false);
  });

  test('empty string is noise', () => {
    expect(isTagLikelyAvatarNoise('')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isLikelyAvatarNameFromTitle
// ---------------------------------------------------------------------------
describe('isLikelyAvatarNameFromTitle', () => {
  test('common avatar-like names return true', () => {
    expect(isLikelyAvatarNameFromTitle('ここな')).toBe(true);
    expect(isLikelyAvatarNameFromTitle('Kokona')).toBe(true);
    expect(isLikelyAvatarNameFromTitle('アリス')).toBe(true);
  });

  test('noise words return false', () => {
    expect(isLikelyAvatarNameFromTitle('オリジナルアバター')).toBe(false);
    expect(isLikelyAvatarNameFromTitle('3Dモデル')).toBe(false);
    expect(isLikelyAvatarNameFromTitle('VRChat対応')).toBe(false);
  });

  test('single-character names return false', () => {
    expect(isLikelyAvatarNameFromTitle('a')).toBe(false);
    expect(isLikelyAvatarNameFromTitle('い')).toBe(false);
  });

  test('names longer than 32 characters return false', () => {
    expect(isLikelyAvatarNameFromTitle('a'.repeat(33))).toBe(false);
  });

  test('numeric-only names return false', () => {
    expect(isLikelyAvatarNameFromTitle('12345')).toBe(false);
  });

  test('null / empty input returns false', () => {
    expect(isLikelyAvatarNameFromTitle('')).toBe(false);
    expect(isLikelyAvatarNameFromTitle(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractTagNamesFromItemJson
// ---------------------------------------------------------------------------
describe('extractTagNamesFromItemJson', () => {
  test('extracts names from tags', () => {
    const data = {
      tags: [{ name: 'ここな' }, { name: 'VRChat' }, { name: '衣装' }],
    };
    expect(extractTagNamesFromItemJson(data)).toEqual(['ここな', 'VRChat', '衣装']);
  });

  test('includes names from tag_banners', () => {
    const data = {
      tags: [{ name: 'ここな' }],
      tag_banners: [{ name: 'アリス' }],
    };
    const result = extractTagNamesFromItemJson(data);
    expect(result).toContain('ここな');
    expect(result).toContain('アリス');
  });

  test('returns an empty list when tags are missing', () => {
    expect(extractTagNamesFromItemJson({})).toEqual([]);
    expect(extractTagNamesFromItemJson(null)).toEqual([]);
  });

  test('deduplicates tag names', () => {
    const data = {
      tags: [{ name: 'ここな' }, { name: 'ここな' }],
    };
    expect(extractTagNamesFromItemJson(data)).toEqual(['ここな']);
  });
});

// ---------------------------------------------------------------------------
// inferSupportedAvatarsFromTags
// ---------------------------------------------------------------------------
describe('inferSupportedAvatarsFromTags', () => {
  const knownLookup = [
    { name: 'ここな', aliases: ['ここな', 'ここな', 'kokona'] },
    { name: 'アリシア', aliases: ['アリシア', 'ありしあ', 'alicia'] },
  ];

  test('matches supported avatars from known tags', () => {
    const result = inferSupportedAvatarsFromTags(['ここな', 'VRChat'], knownLookup);
    expect(result).toContain('ここな');
    expect(result).not.toContain('アリシア');
  });

  test('matches multiple avatars', () => {
    const result = inferSupportedAvatarsFromTags(['ここな', 'アリシア'], knownLookup);
    expect(result).toContain('ここな');
    expect(result).toContain('アリシア');
  });

  test('ignores noise-only tags', () => {
    const result = inferSupportedAvatarsFromTags(['VRChat', '衣装', '3D'], knownLookup);
    expect(result).toEqual([]);
  });

  test('matches alias tag tokens', () => {
    // The "kokona" alias should match the "ここな" avatar.
    const result = inferSupportedAvatarsFromTags(['kokona'], knownLookup);
    expect(result).toContain('ここな');
  });

  test('returns empty when no known avatar list is provided', () => {
    expect(inferSupportedAvatarsFromTags(['ここな'], [])).toEqual([]);
  });

  test('returns empty when tagNames is missing', () => {
    expect(inferSupportedAvatarsFromTags(null, knownLookup)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractSupportedAvatarsFromJson
// ---------------------------------------------------------------------------
describe('extractSupportedAvatarsFromJson', () => {
  const knownLookup = [
    { name: 'ここな', aliases: ['ここな', 'ここな', 'kokona'] },
    { name: 'アリシア', aliases: ['アリシア', 'ありしあ', 'alicia'] },
  ];

  test('extracts avatars from description text', () => {
    const data = { description: 'ここな対応衣装です。' };
    expect(extractSupportedAvatarsFromJson(data, knownLookup)).toContain('ここな');
  });

  test('extracts avatars from tag names', () => {
    const data = {
      description: '',
      tags: [{ name: 'ここな' }, { name: 'アリシア' }],
    };
    const result = extractSupportedAvatarsFromJson(data, knownLookup);
    expect(result).toContain('ここな');
    expect(result).toContain('アリシア');
  });

  test('returns empty when no avatar is detected', () => {
    const data = { description: 'VRChat用汎用衣装' };
    expect(extractSupportedAvatarsFromJson(data, knownLookup)).toEqual([]);
  });

  test('deduplicates repeated avatar hits', () => {
    const data = {
      description: 'ここな対応',
      tags: [{ name: 'ここな' }],
    };
    const result = extractSupportedAvatarsFromJson(data, knownLookup);
    expect(result.filter((n) => n === 'ここな')).toHaveLength(1);
  });
});

describe('enrichItemAvatarMetadata local-first supported avatars', () => {
  const knownLookup = [
    { name: 'ここな', aliases: ['ここな', 'kokona'] },
    { name: 'アリシア', aliases: ['アリシア', 'alicia'] },
  ];

  test('description and tags alone do not populate supportedAvatars', () => {
    const item = {
      itemName: '複数アバター対応衣装',
      downloadLinks: [{ fileName: 'costume.zip' }],
      supportedAvatars: [],
    };
    enrichItemAvatarMetadata(item, {
      name: '複数アバター対応衣装',
      description: 'ここな、アリシア対応です。',
      tags: [{ name: 'ここな' }, { name: 'アリシア' }],
      category: { name: '衣装' },
    }, [{ slug: 'costume', text: '衣装' }], knownLookup);

    expect(item.supportedAvatars).toEqual([]);
    expect(item.tagNames).toEqual(['ここな', 'アリシア']);
  });

  test('variation names alone do not populate supportedAvatars', () => {
    const item = {
      itemName: '【DarkAlice】15Avatar対応',
      downloadLinks: [],
      supportedAvatars: [],
    };
    enrichItemAvatarMetadata(item, {
      name: '【DarkAlice】15Avatar対応',
      description: '',
      tags: [],
      variations: [
        { name: '【Shinano】D.A', price: 1600 },
        { name: 'しなの-SHINANO-', price: 1600 },
        { name: '【Kokona】D.A', price: 1600 },
      ],
      category: { name: '衣装' },
    }, [{ slug: 'costume', text: '衣装' }], [
      ...knownLookup,
      { name: 'しなの', aliases: ['しなの', 'shinano'] },
    ]);

    expect(item.supportedAvatars).toEqual([]);
  });

  test('download link file names alone do not populate supportedAvatars during sync', () => {
    const item = {
      itemName: '対応衣装',
      downloadLinks: [{ fileName: 'kokona_costume.zip' }],
      supportedAvatars: [],
    };
    enrichItemAvatarMetadata(item, {
      name: '対応衣装',
      description: '説明文には書かない',
      tags: [],
      category: { name: '衣装' },
    }, [{ slug: 'costume', text: '衣装' }], knownLookup);

    expect(item.supportedAvatars).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeAvatarEntry
// ---------------------------------------------------------------------------
describe('normalizeAvatarEntry', () => {
  test('normalizes a valid avatar row', () => {
    const result = normalizeAvatarEntry({ name: 'ここな', count: 5 });
    expect(result).not.toBeNull();
    expect(result.name).toBe('ここな');
    expect(result.count).toBe(5);
  });

  test('defaults count to 1 when omitted', () => {
    const result = normalizeAvatarEntry({ name: 'アリス' });
    expect(result.count).toBe(1);
  });

  test('falls back to 1 when count is invalid', () => {
    expect(normalizeAvatarEntry({ name: 'アリス', count: -1 }).count).toBe(1);
    expect(normalizeAvatarEntry({ name: 'アリス', count: 'abc' }).count).toBe(1);
  });

  test('returns null when name is missing', () => {
    expect(normalizeAvatarEntry({ name: '' })).toBeNull();
    expect(normalizeAvatarEntry({})).toBeNull();
    expect(normalizeAvatarEntry(null)).toBeNull();
  });

  test('normalizes alias fields into arrays', () => {
    const result = normalizeAvatarEntry({
      name: 'ここな',
      alphabet: 'Kokona',
      katakana: ['ここナ'],
    });
    expect(result.alphabet).toContain('Kokona');
    expect(result.katakana).toContain('ここナ');
  });
});

// ---------------------------------------------------------------------------
// parseAvatarRowsFromRawText
// ---------------------------------------------------------------------------
describe('parseAvatarRowsFromRawText', () => {
  test('parses valid JSON rows', () => {
    const rows = parseAvatarRowsFromRawText(JSON.stringify([{ name: 'ここな' }]));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('ここな');
  });

  test('returns an empty list for empty text', () => {
    expect(parseAvatarRowsFromRawText('')).toEqual([]);
    expect(parseAvatarRowsFromRawText(null)).toEqual([]);
  });

  test('salvages names from malformed JSON-like text', () => {
    const malformed = '{"name":"ここな"},{"name":"アリス"';
    const rows = parseAvatarRowsFromRawText(malformed);
    const names = rows.map((r) => r.name);
    expect(names).toContain('ここな');
    expect(names).toContain('アリス');
  });

  test('returns empty for non-array JSON payloads', () => {
    expect(parseAvatarRowsFromRawText('"ここな"')).toEqual([]);
    expect(parseAvatarRowsFromRawText('42')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeOrderDateText
// ---------------------------------------------------------------------------
describe('normalizeOrderDateText', () => {
  test('normalizes slash-separated timestamps', () => {
    expect(normalizeOrderDateText('2026/01/25 06:14:54')).toBe('2026-01-25T06:14:54');
  });

  test('strips the 注文日時 prefix', () => {
    expect(normalizeOrderDateText('注文日時 2026/01/25 06:14:54')).toBe('2026-01-25T06:14:54');
  });

  test('normalizes compact timestamps like 20260125 061454', () => {
    expect(normalizeOrderDateText('20260125 061454')).toBe('2026-01-25T06:14:54');
  });

  test('keeps unsupported formats as-is', () => {
    expect(normalizeOrderDateText('2026-01-25')).toBe('2026-01-25');
  });

  test('returns null for null / empty input', () => {
    expect(normalizeOrderDateText(null)).toBeNull();
    expect(normalizeOrderDateText('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseLastPageNumber
// ---------------------------------------------------------------------------
describe('parseLastPageNumber', () => {
  test('parses the page query parameter', () => {
    expect(parseLastPageNumber('?page=5')).toBe(5);
    expect(parseLastPageNumber('/orders?page=12&foo=bar')).toBe(12);
  });

  test('returns 1 when no page parameter exists', () => {
    expect(parseLastPageNumber('/orders')).toBe(1);
    expect(parseLastPageNumber('')).toBe(1);
    expect(parseLastPageNumber(null)).toBe(1);
  });

  test('treats page=0 as page 1', () => {
    expect(parseLastPageNumber('?page=0')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// isFreePriceText
// ---------------------------------------------------------------------------
describe('isFreePriceText', () => {
  test.each(['0', '¥0', '￥0', '0円', '\\0', '0.00'])('"%s" is treated as free', (text) => {
    expect(isFreePriceText(text)).toBe(true);
  });

  test.each(['100', 'ﾂ･500', '500円', '1'])('"%s" is treated as paid', (text) => {
    expect(isFreePriceText(text)).toBe(false);
  });

  test('null / empty input returns false', () => {
    expect(isFreePriceText(null)).toBe(false);
    expect(isFreePriceText('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractDownloadableIdFromHref
// ---------------------------------------------------------------------------
describe('extractDownloadableIdFromHref', () => {
  test('extracts downloadable ID from a URL', () => {
    expect(extractDownloadableIdFromHref('/downloadables/123456')).toBe('123456');
    expect(extractDownloadableIdFromHref('https://booth.pm/downloadables/9999')).toBe('9999');
  });

  test('returns empty string for non-matching input', () => {
    expect(extractDownloadableIdFromHref('/items/123')).toBe('');
    expect(extractDownloadableIdFromHref('')).toBe('');
    expect(extractDownloadableIdFromHref(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extractBoothItemId
// ---------------------------------------------------------------------------
describe('extractBoothItemId', () => {
  test('returns a plain numeric item ID as-is', () => {
    expect(extractBoothItemId('7494502')).toBe('7494502');
  });

  test.each([
    ['https://booth.pm/items/7494502', '7494502'],
    ['https://booth.pm/ja/items/7494502', '7494502'],
    ['https://xxx.booth.pm/items/7494502', '7494502'],
  ])('extracts item ID from URL "%s"', (url, expected) => {
    expect(extractBoothItemId(url)).toBe(expected);
  });

  test('does not treat short numeric strings as valid item URLs', () => {
    expect(extractBoothItemId('123')).toBe('');
  });

  test('returns empty string for empty / null input', () => {
    expect(extractBoothItemId('')).toBe('');
    expect(extractBoothItemId(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// generateFilesHash / generateFilesStableHash
// ---------------------------------------------------------------------------
describe('generateFilesHash', () => {
  const links = [
    { downloadableId: '111', fileName: 'a.zip' },
    { downloadableId: '222', fileName: 'b.zip' },
  ];

  test('returns the same hash for the same link set', () => {
    expect(generateFilesHash(links)).toBe(generateFilesHash(links));
  });

  test('changes the hash when a filename changes', () => {
    const updated = [
      { downloadableId: '111', fileName: 'a_v2.zip' },
      { downloadableId: '222', fileName: 'b.zip' },
    ];
    expect(generateFilesHash(links)).not.toBe(generateFilesHash(updated));
  });

  test('is order-independent for the same links', () => {
    const reversed = [...links].reverse();
    expect(generateFilesHash(links)).toBe(generateFilesHash(reversed));
  });

  test('returns a stable hash for empty arrays', () => {
    expect(generateFilesHash([])).toBe(generateFilesHash([]));
  });
});

describe('generateFilesStableHash', () => {
  test('ignores downloadableId differences when filenames match', () => {
    const a = [{ downloadableId: '111', fileName: 'a.zip' }];
    const b = [{ downloadableId: '999', fileName: 'a.zip' }];
    expect(generateFilesStableHash(a)).toBe(generateFilesStableHash(b));
  });

  test('changes the stable hash when a filename changes', () => {
    const a = [{ downloadableId: '111', fileName: 'a.zip' }];
    const b = [{ downloadableId: '111', fileName: 'a_v2.zip' }];
    expect(generateFilesStableHash(a)).not.toBe(generateFilesStableHash(b));
  });

  test('normalizes filename case before comparison', () => {
    const a = [{ downloadableId: '1', fileName: 'File.ZIP' }];
    const b = [{ downloadableId: '1', fileName: 'file.zip' }];
    expect(generateFilesStableHash(a)).toBe(generateFilesStableHash(b));
  });
});

// ---------------------------------------------------------------------------
// dedupeMetaItemsByItemId
// ---------------------------------------------------------------------------
describe('dedupeMetaItemsByItemId', () => {
  test('collapses duplicate itemId rows into one entry', () => {
    const items = [
      { itemId: '100', itemName: 'A' },
      { itemId: '100', itemName: 'A updated' },
    ];
    const result = dedupeMetaItemsByItemId(items);
    expect(result).toHaveLength(1);
    expect(result[0].itemId).toBe('100');
  });

  test('keeps different itemIds as separate entries', () => {
    const items = [
      { itemId: '100', itemName: 'A' },
      { itemId: '200', itemName: 'B' },
    ];
    expect(dedupeMetaItemsByItemId(items)).toHaveLength(2);
  });

  test('merges downloadLinks without duplicates', () => {
    const items = [
      { itemId: '100', downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }] },
      { itemId: '100', downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }, { downloadableId: '2', fileName: 'b.zip' }] },
    ];
    const result = dedupeMetaItemsByItemId(items);
    expect(result[0].downloadLinks).toHaveLength(2);
  });

  test('preserves isGift=true when any duplicate row has it', () => {
    const items = [
      { itemId: '100', isGift: false },
      { itemId: '100', isGift: true },
    ];
    expect(dedupeMetaItemsByItemId(items)[0].isGift).toBe(true);
  });

  test('skips rows without a valid itemId', () => {
    const items = [
      { itemId: '', itemName: 'no id' },
      { itemId: '100', itemName: 'A' },
    ];
    expect(dedupeMetaItemsByItemId(items)).toHaveLength(1);
  });

  test('returns an empty array for empty input', () => {
    expect(dedupeMetaItemsByItemId([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyVersionTracking / detectVersionUpdates
// ---------------------------------------------------------------------------
describe('applyVersionTracking', () => {
  const makeItem = (itemId, fileNames) => ({
    itemId,
    itemName: `Item ${itemId}`,
    downloadLinks: fileNames.map((f, i) => ({ downloadableId: String(i + 1), fileName: f })),
  });

  const AT = '2026-01-01T00:00:00.000Z';
  const AT2 = '2026-02-01T00:00:00.000Z';

  test('new items get one versionHistory entry and hasUpdate=false', () => {
    const { items, updates } = applyVersionTracking([], [makeItem('100', ['a.zip'])], AT);
    expect(items).toHaveLength(1);
    expect(items[0].hasUpdate).toBe(false);
    expect(items[0].versionHistory).toHaveLength(1);
    expect(updates).toHaveLength(0);
  });

  test('unchanged files keep hasUpdate=false', () => {
    const existing = [makeItem('100', ['a.zip'])];
    const { items } = applyVersionTracking(
      applyVersionTracking([], existing, AT).items,
      [makeItem('100', ['a.zip'])],
      AT2,
    );
    expect(items[0].hasUpdate).toBe(false);
  });

  test('changed files set hasUpdate=true and append an update entry', () => {
    const v1 = applyVersionTracking([], [makeItem('100', ['a.zip'])], AT).items;
    const { items, updates } = applyVersionTracking(v1, [makeItem('100', ['a_v2.zip'])], AT2);
    expect(items[0].hasUpdate).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].itemId).toBe('100');
  });

  test('unaffected items stay unchanged when another item updates', () => {
    const v1 = applyVersionTracking([], [makeItem('100', ['a.zip']), makeItem('200', ['b.zip'])], AT).items;
    const { items, updates } = applyVersionTracking(v1, [makeItem('100', ['a_v2.zip']), makeItem('200', ['b.zip'])], AT2);
    const item200 = items.find((i) => i.itemId === '200');
    expect(item200.hasUpdate).toBe(false);
    expect(updates.find((u) => u.itemId === '200')).toBeUndefined();
  });

  test('changing only downloadableId does not count as an update', () => {
    const v1 = applyVersionTracking([], [makeItem('100', ['a.zip'])], AT).items;
    // Change only the ID while keeping the filename identical.
    const updated = [{ itemId: '100', itemName: 'Item 100', downloadLinks: [{ downloadableId: '999', fileName: 'a.zip' }] }];
    const { items, updates } = applyVersionTracking(v1, updated, AT2);
    expect(items[0].hasUpdate).toBe(false);
    expect(updates).toHaveLength(0);
  });
  test('lightweight sync keeps existing categories and rich metadata', () => {
    const existing = applyVersionTracking([], [{
      itemId: '100',
      itemName: 'Item 100',
      downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }],
      categories: [
        { slug: '3d-model', text: '3Dモデル' },
        { slug: 'avatar', text: 'アバター' },
      ],
      primaryCategory: { slug: 'avatar', text: 'アバター' },
      supportedAvatars: ['Rurune'],
      tagNames: ['衣装'],
      localAuthorIconPath: './author_icons/100.png',
      localImagePath: './cache/100.png',
      nameVariants: { primary: 'Item 100', all: ['Item 100'], alphabet: [], hiragana: [], katakana: [], kanji: [] },
    }], AT).items;
    const latest = [{
      itemId: '100',
      itemName: 'Item 100',
      downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }],
    }];

    const { items } = applyVersionTracking(existing, latest, AT2);

    expect(items[0].categories).toHaveLength(2);
    expect(items[0].primaryCategory?.text).toBe('アバター');
    expect(items[0].supportedAvatars).toEqual(['Rurune']);
    expect(items[0].tagNames).toEqual(['衣装']);
    expect(items[0].localAuthorIconPath).toBe('./author_icons/100.png');
    expect(items[0].localImagePath).toBe('./cache/100.png');
    expect(items[0].nameVariants?.all).toEqual(['Item 100']);
  });

});

describe('detectVersionUpdates', () => {
  test('returns the same updates shape as applyVersionTracking', () => {
    const AT = '2026-01-01T00:00:00.000Z';
    const AT2 = '2026-02-01T00:00:00.000Z';
    const v1 = applyVersionTracking([], [{ itemId: '1', itemName: 'A', downloadLinks: [{ downloadableId: '1', fileName: 'a.zip' }] }], AT).items;
    const updates = detectVersionUpdates(v1, [{ itemId: '1', itemName: 'A', downloadLinks: [{ downloadableId: '1', fileName: 'b.zip' }] }]);
    expect(updates).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// extractFreeDownloadLinksFromItemJson
// ---------------------------------------------------------------------------
describe('extractFreeDownloadLinksFromItemJson', () => {
  test('extracts downloadable_id from free variations', () => {
    const payload = {
      variations: [
        { price: 0, downloadable_id: '555', name: 'free.zip' },
      ],
    };
    const result = extractFreeDownloadLinksFromItemJson(payload);
    expect(result.some((r) => r.downloadableId === '555')).toBe(true);
  });

  test('skips paid variations', () => {
    const payload = {
      variations: [
        { price: 500, downloadable_id: '111', name: 'paid.zip' },
      ],
    };
    expect(extractFreeDownloadLinksFromItemJson(payload)).toHaveLength(0);
  });

  test('extracts ID from download_url when present', () => {
    const payload = {
      variations: [
        { price: 0, download_url: '/downloadables/777', name: 'free.zip' },
      ],
    };
    const result = extractFreeDownloadLinksFromItemJson(payload);
    expect(result.some((r) => r.downloadableId === '777')).toBe(true);
  });

  test('returns an empty list when variations are missing', () => {
    expect(extractFreeDownloadLinksFromItemJson({})).toEqual([]);
    expect(extractFreeDownloadLinksFromItemJson(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractSupportedAvatarsFromVariations
// ---------------------------------------------------------------------------
describe('extractSupportedAvatarsFromVariations', () => {
  const knownLookup = [
    { name: 'ルルネ', aliases: ['ルルネ', 'るるね', 'rurune'] },
    { name: '桔梗', aliases: ['桔梗', 'ききょう', 'kikyo'] },
  ];

  test('detects avatar name in variation name like "ルルネ対応"', () => {
    const data = {
      variations: [{ name: 'ルルネ対応セット', price: 500 }],
    };
    expect(extractSupportedAvatarsFromVariations(data, knownLookup)).toContain('ルルネ');
  });

  test('detects multiple avatars across variation names', () => {
    const data = {
      variations: [
        { name: 'ルルネ 桔梗 セット', price: 800 },
      ],
    };
    const result = extractSupportedAvatarsFromVariations(data, knownLookup);
    expect(result).toContain('ルルネ');
    expect(result).toContain('桔梗');
  });

  test('returns empty when no known avatar matches', () => {
    const data = {
      variations: [{ name: 'VRChat汎用衣装', price: 500 }],
    };
    expect(extractSupportedAvatarsFromVariations(data, knownLookup)).toEqual([]);
  });

  test('returns empty when variations are absent', () => {
    expect(extractSupportedAvatarsFromVariations({}, knownLookup)).toEqual([]);
    expect(extractSupportedAvatarsFromVariations(null, knownLookup)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hasPurchasedAvatarBaseVariation
// ---------------------------------------------------------------------------
describe('hasPurchasedAvatarBaseVariation', () => {
  // NOTE: BOOTH API always returns variations[].downloadable as null.
  //       Purchase status is indicated by data.order being non-null.

  test('returns true for purchased item with variation named "アバター本体"', () => {
    const data = {
      order: { purchased_at: '2026年1月1日', url: 'https://accounts.booth.pm/orders/123' },
      variations: [{ name: 'アバター本体', price: 3000, downloadable: null }],
    };
    expect(hasPurchasedAvatarBaseVariation(data)).toBe(true);
  });

  test('returns false when order is null (not purchased)', () => {
    const data = {
      order: null,
      variations: [{ name: 'アバター本体', price: 3000, downloadable: null }],
    };
    expect(hasPurchasedAvatarBaseVariation(data)).toBe(false);
  });

  test('returns false when variation name does not match keywords', () => {
    const data = {
      order: { purchased_at: '2026年1月1日', url: 'https://accounts.booth.pm/orders/123' },
      variations: [{ name: '色違いカラーセット', price: 500, downloadable: null }],
    };
    expect(hasPurchasedAvatarBaseVariation(data)).toBe(false);
  });

  test('returns false when variations are absent', () => {
    expect(hasPurchasedAvatarBaseVariation({})).toBe(false);
    expect(hasPurchasedAvatarBaseVariation({ order: { purchased_at: '2026年1月1日' } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractSupportedAvatarsFromFileNames
// ---------------------------------------------------------------------------
describe('extractSupportedAvatarsFromFileNames', () => {
  const knownLookup = [
    { name: 'シオ',   aliases: ['シオ', 'しお', 'sio'] },
    { name: 'ルルネ', aliases: ['ルルネ', 'るるね', 'rurune'] },
  ];

  test('detects avatar name from filename like "Tech_Wear_Cat_Sio.zip"', () => {
    const item = { downloadLinks: [{ fileName: 'Tech_Wear_Cat_Sio.zip' }] };
    expect(extractSupportedAvatarsFromFileNames(item, knownLookup)).toContain('シオ');
  });

  test('detects multiple avatars across filenames', () => {
    const item = {
      downloadLinks: [
        { fileName: 'Astel_Sio.zip' },
        { fileName: 'Astel_Rurune.zip' },
      ],
    };
    const result = extractSupportedAvatarsFromFileNames(item, knownLookup);
    expect(result).toContain('シオ');
    expect(result).toContain('ルルネ');
  });

  test('strips file extension before matching', () => {
    const item = { downloadLinks: [{ fileName: 'BOO_Sio.2.zip' }] };
    expect(extractSupportedAvatarsFromFileNames(item, knownLookup)).toContain('シオ');
  });

  test('returns empty when no known avatar matches', () => {
    const item = { downloadLinks: [{ fileName: 'PSD_material.zip' }] };
    expect(extractSupportedAvatarsFromFileNames(item, knownLookup)).toEqual([]);
  });

  test('returns empty when downloadLinks is absent', () => {
    expect(extractSupportedAvatarsFromFileNames({}, knownLookup)).toEqual([]);
    expect(extractSupportedAvatarsFromFileNames(null, knownLookup)).toEqual([]);
  });
});

