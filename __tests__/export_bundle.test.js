'use strict';

const path = require('path');
const { resolveExportBundlePath } = require('../lib/export_bundle');

// ---------------------------------------------------------------------------
// resolveExportBundlePath
// ---------------------------------------------------------------------------

describe('resolveExportBundlePath', () => {
  function makeFsStub({ exists = false, isDir = false } = {}) {
    return {
      existsSync: jest.fn().mockReturnValue(exists),
      statSync: jest.fn().mockReturnValue({
        isDirectory: jest.fn().mockReturnValue(isDir),
      }),
    };
  }

  test('inputPath が空なら空文字を返す', () => {
    const fs = makeFsStub();
    expect(resolveExportBundlePath({ inputPath: '', fs, path })).toBe('');
    expect(resolveExportBundlePath({ inputPath: null, fs, path })).toBe('');
    expect(resolveExportBundlePath({ inputPath: '   ', fs, path })).toBe('');
  });

  test('末尾スラッシュがあればディレクトリ扱いしてデフォルトファイル名を付与', () => {
    const fs = makeFsStub({ exists: false });
    const result = resolveExportBundlePath({ inputPath: '/some/dir/', fs, path });
    expect(result).toMatch(/avatool-export-\d{8}-\d{6}\.json$/);
    // path.join の OS 依存を避け、ファイル名部分のみ検証
    expect(path.basename(result)).toMatch(/^avatool-export-\d{8}-\d{6}\.json$/);
  });

  test('末尾バックスラッシュでもディレクトリ扱い', () => {
    const fs = makeFsStub({ exists: false });
    const result = resolveExportBundlePath({ inputPath: 'C:\\exports\\', fs, path });
    expect(result).toMatch(/avatool-export-\d{8}-\d{6}\.json$/);
  });

  test('存在するディレクトリならデフォルトファイル名を付与', () => {
    const fs = makeFsStub({ exists: true, isDir: true });
    const result = resolveExportBundlePath({ inputPath: '/some/dir', fs, path });
    expect(result).toMatch(/avatool-export-\d{8}-\d{6}\.json$/);
    expect(path.basename(result)).toMatch(/^avatool-export-\d{8}-\d{6}\.json$/);
  });

  test('存在するファイルパスはそのまま返す', () => {
    const fs = makeFsStub({ exists: true, isDir: false });
    const result = resolveExportBundlePath({ inputPath: '/some/export.json', fs, path });
    expect(result).toBe('/some/export.json');
  });

  test('存在しないパスで末尾区切りなしならそのまま返す', () => {
    const fs = makeFsStub({ exists: false });
    const result = resolveExportBundlePath({ inputPath: '/path/to/output.json', fs, path });
    expect(result).toBe('/path/to/output.json');
  });

  test('defaultPrefix が反映される', () => {
    const fs = makeFsStub({ exists: false });
    const result = resolveExportBundlePath({
      inputPath: '/out/',
      fs,
      path,
      defaultPrefix: 'custom-prefix',
    });
    expect(result).toMatch(/custom-prefix-\d{8}-\d{6}\.json$/);
  });

  test('デフォルトファイル名は YYYYMMdd-HHmmss 形式', () => {
    const fs = makeFsStub({ exists: false });
    const result = resolveExportBundlePath({ inputPath: '/out/', fs, path });
    expect(result).toMatch(/avatool-export-\d{4}\d{2}\d{2}-\d{2}\d{2}\d{2}\.json$/);
  });

  test('fs.statSync が例外を投げても normalized パスを返す', () => {
    const fs = {
      existsSync: jest.fn().mockReturnValue(true),
      statSync: jest.fn().mockImplementation(() => { throw new Error('perm'); }),
    };
    const result = resolveExportBundlePath({ inputPath: '/some/path', fs, path });
    expect(result).toBe('/some/path');
  });
});
