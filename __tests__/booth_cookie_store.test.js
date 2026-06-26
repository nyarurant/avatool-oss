'use strict';

// booth_cookie_store.js は fs と electron を直接 require するため
// jest.mock でモジュールを差し替える

jest.mock('electron', () => ({
  safeStorage: null, // Electron 環境なしを模倣
}));

// fs は spyOn でメソッド単位にモックする
const fs = require('fs');
const { readBoothCookiesFromFile } = require('../lib/booth_cookie_store');

// ---------------------------------------------------------------------------
// 非暗号化形式（プレーン配列 JSON）の読み込みテスト
// ---------------------------------------------------------------------------

describe('readBoothCookiesFromFile — 非暗号化形式', () => {
  afterEach(() => jest.restoreAllMocks());

  test('プレーン配列 JSON を正常に読み込む', () => {
    const cookies = [
      { name: '_session_id', value: 'abc123', domain: 'booth.pm' },
    ];
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(cookies));
    const result = readBoothCookiesFromFile('/data/booth.pm.json');
    expect(result).toEqual(cookies);
  });

  test('空配列も正常に返す', () => {
    jest.spyOn(fs, 'readFileSync').mockReturnValue('[]');
    const result = readBoothCookiesFromFile('/data/booth.pm.json');
    expect(result).toEqual([]);
  });

  test('壊れた JSON は invalid_cookie_file エラーを投げる', () => {
    jest.spyOn(fs, 'readFileSync').mockReturnValue('not-json');
    expect(() => readBoothCookiesFromFile('/data/booth.pm.json')).toThrow(
      expect.objectContaining({ code: 'invalid_cookie_file' })
    );
  });

  test('オブジェクト形式でサポート外フォーマットなら unsupported_cookie_file_format', () => {
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ __format: 'unknown', enc: 'none' }));
    expect(() => readBoothCookiesFromFile('/data/booth.pm.json')).toThrow(
      expect.objectContaining({ code: 'unsupported_cookie_file_format' })
    );
  });

  test('safeStorage 形式で safeStorage がない場合は safe_storage_unavailable', () => {
    const payload = {
      __format: 'booth-cookies-v1',
      enc: 'safeStorage',
      data: Buffer.from('dummydata').toString('base64'),
    };
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(payload));
    expect(() => readBoothCookiesFromFile('/data/booth.pm.json')).toThrow(
      expect.objectContaining({ code: 'safe_storage_unavailable' })
    );
  });

  test('null / 空文字は invalid_cookie_file エラー', () => {
    jest.spyOn(fs, 'readFileSync').mockReturnValue('null');
    // JSON.parse('null') = null → not array, not valid format object → unsupported
    expect(() => readBoothCookiesFromFile('/data/booth.pm.json')).toThrow();
  });
});
