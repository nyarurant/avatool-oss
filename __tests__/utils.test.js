'use strict';

const {
  toFiniteNumber,
  normalizeHour,
  normalizeRetryAttempts,
  normalizeRetryBaseDelayMs,
  normalizeZipMaxEntryBytes,
  sanitizePathSegment,
  safeResolveUnder,
  dedupeDownloadLinks,
  isWithinHourWindow,
} = require('../lib/utils');

// ─── toFiniteNumber ───────────────────────────────────────────────────────────

describe('toFiniteNumber', () => {
  test('数値文字列を数値に変換する', () => {
    expect(toFiniteNumber('42', 0)).toBe(42);
    expect(toFiniteNumber('3.14', 0)).toBeCloseTo(3.14);
  });

  test('数値をそのまま返す', () => {
    expect(toFiniteNumber(10, 0)).toBe(10);
    expect(toFiniteNumber(0, 99)).toBe(0);
  });

  test('NaN の場合は fallback を返す', () => {
    expect(toFiniteNumber(NaN, 5)).toBe(5);
    expect(toFiniteNumber('not_a_number', 5)).toBe(5);
  });

  test('undefined の場合は fallback を返す', () => {
    // null → Number(null) = 0（有限数）なので 0 を返す（fallback ではない）
    expect(toFiniteNumber(null, 7)).toBe(0);
    expect(toFiniteNumber(undefined, 7)).toBe(7);
  });

  test('Infinity の場合は fallback を返す', () => {
    expect(toFiniteNumber(Infinity, 9)).toBe(9);
    expect(toFiniteNumber(-Infinity, 9)).toBe(9);
  });
});

// ─── normalizeHour ────────────────────────────────────────────────────────────

describe('normalizeHour', () => {
  test('0〜23 の整数はそのまま返す', () => {
    expect(normalizeHour(0, 12)).toBe(0);
    expect(normalizeHour(12, 0)).toBe(12);
    expect(normalizeHour(23, 0)).toBe(23);
  });

  test('負値は 0 にクランプする', () => {
    expect(normalizeHour(-1, 12)).toBe(0);
    expect(normalizeHour(-100, 12)).toBe(0);
  });

  test('24 以上は 23 にクランプする', () => {
    expect(normalizeHour(24, 0)).toBe(23);
    expect(normalizeHour(100, 0)).toBe(23);
  });

  test('小数は切り捨てる', () => {
    expect(normalizeHour(5.9, 0)).toBe(5);
    expect(normalizeHour(23.99, 0)).toBe(23);
  });

  test('非数値の場合は fallback を返す', () => {
    expect(normalizeHour('abc', 6)).toBe(6);
    // null → Number(null) = 0 → clamp(0, 0, 23) = 0
    expect(normalizeHour(null, 8)).toBe(0);
  });
});

// ─── normalizeRetryAttempts ───────────────────────────────────────────────────

describe('normalizeRetryAttempts', () => {
  test('1〜12 の値はそのまま返す', () => {
    expect(normalizeRetryAttempts(1)).toBe(1);
    expect(normalizeRetryAttempts(4)).toBe(4);
    expect(normalizeRetryAttempts(12)).toBe(12);
  });

  test('0 は 1 にクランプする', () => {
    expect(normalizeRetryAttempts(0)).toBe(1);
    expect(normalizeRetryAttempts(-5)).toBe(1);
  });

  test('13 以上は 12 にクランプする', () => {
    expect(normalizeRetryAttempts(13)).toBe(12);
    expect(normalizeRetryAttempts(100)).toBe(12);
  });

  test('小数は切り捨てる', () => {
    expect(normalizeRetryAttempts(3.9)).toBe(3);
  });

  test('デフォルト fallback は 4', () => {
    expect(normalizeRetryAttempts('abc')).toBe(4);
  });
});

// ─── normalizeRetryBaseDelayMs ────────────────────────────────────────────────

describe('normalizeRetryBaseDelayMs', () => {
  test('200〜120000 の値はそのまま返す', () => {
    expect(normalizeRetryBaseDelayMs(200)).toBe(200);
    expect(normalizeRetryBaseDelayMs(5000)).toBe(5000);
    expect(normalizeRetryBaseDelayMs(120000)).toBe(120000);
  });

  test('200 未満は 200 にクランプする', () => {
    expect(normalizeRetryBaseDelayMs(0)).toBe(200);
    expect(normalizeRetryBaseDelayMs(100)).toBe(200);
    expect(normalizeRetryBaseDelayMs(-1)).toBe(200);
  });

  test('120000 超は 120000 にクランプする', () => {
    expect(normalizeRetryBaseDelayMs(200000)).toBe(120000);
  });

  test('デフォルト fallback は 1200', () => {
    expect(normalizeRetryBaseDelayMs('abc')).toBe(1200);
  });
});

// ─── normalizeZipMaxEntryBytes ────────────────────────────────────────────────

describe('normalizeZipMaxEntryBytes', () => {
  const MB = 1024 * 1024;
  const GB = 1024 * MB;

  test('1MB〜8GB の値はそのまま返す', () => {
    expect(normalizeZipMaxEntryBytes(1 * MB)).toBe(1 * MB);
    expect(normalizeZipMaxEntryBytes(512 * MB)).toBe(512 * MB);
    expect(normalizeZipMaxEntryBytes(8 * GB)).toBe(8 * GB);
  });

  test('1MB 未満は 1MB にクランプする', () => {
    expect(normalizeZipMaxEntryBytes(0)).toBe(1 * MB);
    expect(normalizeZipMaxEntryBytes(1000)).toBe(1 * MB);
  });

  test('8GB 超は 8GB にクランプする', () => {
    expect(normalizeZipMaxEntryBytes(9 * GB)).toBe(8 * GB);
  });

  test('デフォルト fallback は 512MB', () => {
    expect(normalizeZipMaxEntryBytes('abc')).toBe(512 * MB);
  });
});

// ─── sanitizePathSegment ──────────────────────────────────────────────────────

describe('sanitizePathSegment', () => {
  test('通常の文字列はそのまま返す', () => {
    expect(sanitizePathSegment('hello')).toBe('hello');
    expect(sanitizePathSegment('my-asset_v2')).toBe('my-asset_v2');
  });

  test('禁止文字を _ に置換する', () => {
    expect(sanitizePathSegment('file\\name')).toBe('file_name');
    expect(sanitizePathSegment('file/name')).toBe('file_name');
    expect(sanitizePathSegment('file:name')).toBe('file_name');
    expect(sanitizePathSegment('file*name')).toBe('file_name');
    expect(sanitizePathSegment('file?name')).toBe('file_name');
    expect(sanitizePathSegment('file"name')).toBe('file_name');
    expect(sanitizePathSegment('file<name')).toBe('file_name');
    expect(sanitizePathSegment('file>name')).toBe('file_name');
    expect(sanitizePathSegment('file|name')).toBe('file_name');
  });

  test('制御文字（0x00-0x1F, 0x7F）を除去する', () => {
    expect(sanitizePathSegment('file\x00name')).toBe('filename');
    expect(sanitizePathSegment('file\x1fname')).toBe('filename');
    expect(sanitizePathSegment('file\x7fname')).toBe('filename');
  });

  test('末尾のスペースとピリオドを除去する', () => {
    expect(sanitizePathSegment('file  ')).toBe('file');
    expect(sanitizePathSegment('file...')).toBe('file');
    // [. ]+ で末尾の . と スペースをまとめて除去する
    expect(sanitizePathSegment('file. . ')).toBe('file');
  });

  test('空文字列は fallback を返す', () => {
    expect(sanitizePathSegment('')).toBe('NO_NAME');
    expect(sanitizePathSegment('   ')).toBe('NO_NAME');
    expect(sanitizePathSegment(null)).toBe('NO_NAME');
    expect(sanitizePathSegment(undefined)).toBe('NO_NAME');
  });

  test('カスタム fallback を使う', () => {
    expect(sanitizePathSegment('', 'DEFAULT')).toBe('DEFAULT');
  });

  test('Windows 予約名に _ プレフィックスを付ける（Win32 のみ）', () => {
    if (process.platform !== 'win32') return;
    expect(sanitizePathSegment('CON')).toBe('_CON');
    expect(sanitizePathSegment('con')).toBe('_con');
    expect(sanitizePathSegment('NUL')).toBe('_NUL');
    expect(sanitizePathSegment('COM1')).toBe('_COM1');
    expect(sanitizePathSegment('LPT9')).toBe('_LPT9');
    expect(sanitizePathSegment('aux.txt')).toBe('_aux.txt');
  });

  test('通常の名前は Win32 予約名扱いしない', () => {
    expect(sanitizePathSegment('console')).toBe('console');
    expect(sanitizePathSegment('CONNECT')).toBe('CONNECT');
  });
});

// ─── safeResolveUnder ─────────────────────────────────────────────────────────

describe('safeResolveUnder', () => {
  const base = 'C:/safe/base';

  test('正常な相対パスを解決する', () => {
    const result = safeResolveUnder(base, 'sub/file.txt');
    expect(result).toBeTruthy();
    const normalizedBase = require('path').resolve(base).toLowerCase();
    expect(result.toLowerCase().startsWith(normalizedBase)).toBe(true);
  });

  test('空文字列は empty_path エラーを投げる', () => {
    expect(() => safeResolveUnder(base, '')).toThrow('empty_path');
    expect(() => safeResolveUnder(base, null)).toThrow('empty_path');
  });

  test('制御文字を含むパスは control_char_in_path エラーを投げる', () => {
    expect(() => safeResolveUnder(base, 'sub/\x00file')).toThrow('control_char_in_path');
  });

  test('絶対パスは absolute_path_not_allowed エラーを投げる', () => {
    expect(() => safeResolveUnder(base, '/absolute/path')).toThrow('absolute_path_not_allowed');
    expect(() => safeResolveUnder(base, 'C:/absolute')).toThrow('absolute_path_not_allowed');
  });

  test('../ によるベース外参照は path_outside_base エラーを投げる', () => {
    expect(() => safeResolveUnder(base, '../escape')).toThrow('path_outside_base');
    expect(() => safeResolveUnder(base, 'sub/../../escape')).toThrow('path_outside_base');
  });
});

// ─── dedupeDownloadLinks ──────────────────────────────────────────────────────

describe('dedupeDownloadLinks', () => {
  test('重複なしの場合はそのまま返す', () => {
    const links = [
      { downloadableId: '1', fileName: 'a.zip' },
      { downloadableId: '2', fileName: 'b.zip' },
    ];
    expect(dedupeDownloadLinks(links)).toHaveLength(2);
  });

  test('同一 downloadableId + fileName の重複を除去する', () => {
    const links = [
      { downloadableId: '1', fileName: 'a.zip', variationName: 'v1' },
      { downloadableId: '1', fileName: 'a.zip', variationName: 'v2' },
    ];
    const result = dedupeDownloadLinks(links);
    expect(result).toHaveLength(1);
  });

  test('variationName は後のエントリを優先する', () => {
    const links = [
      { downloadableId: '1', fileName: 'a.zip', variationName: 'first' },
      { downloadableId: '1', fileName: 'a.zip', variationName: 'second' },
    ];
    const result = dedupeDownloadLinks(links);
    expect(result[0].variationName).toBe('second');
  });

  test('downloadableId が空のエントリはスキップする', () => {
    const links = [
      { downloadableId: '', fileName: 'a.zip' },
      { fileName: 'b.zip' },
      { downloadableId: '  ', fileName: 'c.zip' },
    ];
    expect(dedupeDownloadLinks(links)).toHaveLength(0);
  });

  test('fileName がない場合は file_<id> を使う', () => {
    const links = [{ downloadableId: '42' }];
    const result = dedupeDownloadLinks(links);
    expect(result[0].fileName).toBe('file_42');
  });

  test('非配列入力は空配列を返す', () => {
    expect(dedupeDownloadLinks(null)).toEqual([]);
    expect(dedupeDownloadLinks(undefined)).toEqual([]);
    expect(dedupeDownloadLinks('string')).toEqual([]);
  });

  test('空配列は空配列を返す', () => {
    expect(dedupeDownloadLinks([])).toEqual([]);
  });

  test('downloadableId が異なれば別エントリとして保持する', () => {
    const links = [
      { downloadableId: '1', fileName: 'a.zip' },
      { downloadableId: '2', fileName: 'a.zip' },
    ];
    expect(dedupeDownloadLinks(links)).toHaveLength(2);
  });
});

// ─── isWithinHourWindow ───────────────────────────────────────────────────────

describe('isWithinHourWindow', () => {
  describe('通常範囲（s < e）', () => {
    test('範囲内の時刻は true', () => {
      expect(isWithinHourWindow(9, 9, 17)).toBe(true);
      expect(isWithinHourWindow(12, 9, 17)).toBe(true);
      expect(isWithinHourWindow(16, 9, 17)).toBe(true);
    });

    test('範囲外の時刻は false', () => {
      expect(isWithinHourWindow(8, 9, 17)).toBe(false);
      expect(isWithinHourWindow(17, 9, 17)).toBe(false);
      expect(isWithinHourWindow(20, 9, 17)).toBe(false);
    });
  });

  describe('日またぎ範囲（s > e）', () => {
    test('折り返し範囲内の時刻は true', () => {
      expect(isWithinHourWindow(22, 22, 6)).toBe(true);
      expect(isWithinHourWindow(0, 22, 6)).toBe(true);
      expect(isWithinHourWindow(5, 22, 6)).toBe(true);
    });

    test('折り返し範囲外の時刻は false', () => {
      expect(isWithinHourWindow(6, 22, 6)).toBe(false);
      expect(isWithinHourWindow(12, 22, 6)).toBe(false);
      expect(isWithinHourWindow(21, 22, 6)).toBe(false);
    });
  });

  test('s === e の場合は常に true（常時許可）', () => {
    expect(isWithinHourWindow(0, 9, 9)).toBe(true);
    expect(isWithinHourWindow(15, 9, 9)).toBe(true);
    expect(isWithinHourWindow(23, 9, 9)).toBe(true);
  });
});
