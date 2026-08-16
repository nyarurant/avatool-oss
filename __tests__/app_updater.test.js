'use strict';

const { createAppUpdater } = require('../lib/app_updater');

function makeUpdater(overrides = {}) {
  const deps = {
    electronAutoUpdater: null,
    axios: { get: jest.fn() },
    fs: { existsSync: jest.fn(), createReadStream: jest.fn(), createWriteStream: jest.fn() },
    crypto: require('crypto'),
    app: { isPackaged: false, getVersion: jest.fn().mockReturnValue('1.0.0'), getPath: jest.fn().mockReturnValue('/tmp') },
    shell: { openPath: jest.fn() },
    getMainWindow: jest.fn().mockReturnValue(null),
    ...overrides,
  };
  return createAppUpdater(deps);
}

describe('setupAppUpdater', () => {
  test('自動確認時に更新ファイルを勝手にダウンロードしない', () => {
    const electronAutoUpdater = {
      on: jest.fn(),
      autoDownload: true,
      autoInstallOnAppQuit: true,
      disableDifferentialDownload: false,
    };
    const updater = makeUpdater({ electronAutoUpdater });
    updater.setupAppUpdater();
    expect(electronAutoUpdater.autoDownload).toBe(false);
    expect(electronAutoUpdater.autoInstallOnAppQuit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseSemverInfo (_test)
// ---------------------------------------------------------------------------

describe('parseSemverInfo', () => {
  const { _test: { parseSemverInfo } } = makeUpdater();

  test('通常バージョンを解析する', () => {
    const r = parseSemverInfo('1.2.3');
    expect(r).toEqual({ major: 1, minor: 2, patch: 3, prerelease: '', isPrerelease: false });
  });

  test('v プレフィックスを許容する', () => {
    const r = parseSemverInfo('v2.0.1');
    expect(r.major).toBe(2);
    expect(r.minor).toBe(0);
    expect(r.patch).toBe(1);
  });

  test('プレリリース付きを解析する', () => {
    const r = parseSemverInfo('1.0.0-beta.1');
    expect(r.isPrerelease).toBe(true);
    expect(r.prerelease).toBe('beta.1');
  });

  test('不正な文字列は null を返す', () => {
    expect(parseSemverInfo('')).toBeNull();
    expect(parseSemverInfo('1.2')).toBeNull();
    expect(parseSemverInfo('abc')).toBeNull();
    expect(parseSemverInfo(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// compareSemverAscSimple (_test)
// ---------------------------------------------------------------------------

describe('compareSemverAscSimple', () => {
  const { _test: { compareSemverAscSimple } } = makeUpdater();

  test('同一バージョンは 0', () => {
    expect(compareSemverAscSimple('1.0.0', '1.0.0')).toBe(0);
  });

  test('メジャーバージョンが大きければ正数', () => {
    expect(compareSemverAscSimple('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  test('マイナー・パッチ比較', () => {
    expect(compareSemverAscSimple('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareSemverAscSimple('1.3.0', '1.2.9')).toBeGreaterThan(0);
  });

  test('プレリリースは安定版より低い', () => {
    expect(compareSemverAscSimple('1.0.0-beta', '1.0.0')).toBeLessThan(0);
    expect(compareSemverAscSimple('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
  });

  test('不正バージョンとの比較', () => {
    expect(compareSemverAscSimple('bad', '1.0.0')).toBeLessThan(0);
    expect(compareSemverAscSimple('1.0.0', 'bad')).toBeGreaterThan(0);
    expect(compareSemverAscSimple('bad', 'bad')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeReleaseNotesValue (_test)
// ---------------------------------------------------------------------------

describe('normalizeReleaseNotesValue', () => {
  const { _test: { normalizeReleaseNotesValue } } = makeUpdater();

  test('文字列はそのまま trim して返す', () => {
    expect(normalizeReleaseNotesValue('  Hello  ')).toBe('Hello');
  });

  test('null / 空は空文字を返す', () => {
    expect(normalizeReleaseNotesValue(null)).toBe('');
    expect(normalizeReleaseNotesValue('')).toBe('');
  });

  test('配列の文字列要素は改行で連結', () => {
    const result = normalizeReleaseNotesValue(['line1', 'line2']);
    expect(result).toBe('line1\nline2');
  });

  test('配列内オブジェクトは version: note 形式', () => {
    const result = normalizeReleaseNotesValue([{ version: '1.0.0', note: 'Fixed bug' }]);
    expect(result).toContain('1.0.0: Fixed bug');
  });

  test('配列内の空要素はスキップ', () => {
    const result = normalizeReleaseNotesValue(['a', '', null, 'b']);
    expect(result).toBe('a\nb');
  });

  test('オブジェクトは note または text を返す', () => {
    expect(normalizeReleaseNotesValue({ note: 'Note text' })).toBe('Note text');
    expect(normalizeReleaseNotesValue({ text: 'Text value' })).toBe('Text value');
  });
});

// ---------------------------------------------------------------------------
// trimWrappedQuotes (_test)
// ---------------------------------------------------------------------------

describe('trimWrappedQuotes', () => {
  const { _test: { trimWrappedQuotes } } = makeUpdater();

  test('シングルクォートで囲まれた値を除去する', () => {
    expect(trimWrappedQuotes("'hello'")).toBe('hello');
  });

  test('ダブルクォートで囲まれた値を除去する', () => {
    expect(trimWrappedQuotes('"world"')).toBe('world');
  });

  test('クォートがなければそのまま', () => {
    expect(trimWrappedQuotes('plain')).toBe('plain');
  });

  test('片方だけクォートはそのまま', () => {
    expect(trimWrappedQuotes('"only-left')).toBe('"only-left');
  });

  test('null / 空文字は空文字を返す', () => {
    expect(trimWrappedQuotes(null)).toBe('');
    expect(trimWrappedQuotes('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseEmergencyLatestBackupYml (_test)
// ---------------------------------------------------------------------------

describe('parseEmergencyLatestBackupYml', () => {
  const {
    _test: {
      parseEmergencyLatestBackupYml,
      isSafeEmergencyArtifactPath,
      isValidSha512Base64,
      sha512Matches,
    },
  } = makeUpdater();
  const validSha512 = Buffer.alloc(64, 0x5a).toString('base64');

  test('基本的な YAML フィールドを解析する', () => {
    const yaml = [
      'version: 1.0.341',
      'path: Avatool Setup 1.0.341.exe',
      `sha512: ${validSha512}`,
      'releaseDate: 2026-01-01',
    ].join('\n');
    const result = parseEmergencyLatestBackupYml(yaml);
    expect(result.version).toBe('1.0.341');
    expect(result.path).toBe('Avatool Setup 1.0.341.exe');
    expect(result.sha512).toBe(validSha512);
    expect(result.releaseDate).toBe('2026-01-01');
  });

  test('path があれば url を自動生成する', () => {
    const yaml = 'version: 1.0.0\npath: Avatool Setup 1.0.0.exe\n';
    const result = parseEmergencyLatestBackupYml(yaml);
    expect(result.url).toContain('Avatool');
  });

  test('manifest 内の url は無視して固定CDNのURLを使う', () => {
    const yaml = 'version: 1.0.0\npath: foo.exe\nurl: https://example.com/foo.exe\n';
    const result = parseEmergencyLatestBackupYml(yaml);
    expect(result.url).toBe('https://cdn.necco.xyz/file/avatool/foo.exe');
  });

  test('危険な成果物パスでは URL を生成しない', () => {
    const result = parseEmergencyLatestBackupYml('version: 1.0.0\npath: ../foo.exe\n');
    expect(result.url).toBe('');
  });

  test('安全な成果物名だけを受け付ける', () => {
    expect(isSafeEmergencyArtifactPath('Avatool Setup 1.0.426.exe')).toBe(true);
    expect(isSafeEmergencyArtifactPath('../setup.exe')).toBe(false);
    expect(isSafeEmergencyArtifactPath('https://example.com/setup.exe')).toBe(false);
    expect(isSafeEmergencyArtifactPath('setup.msi')).toBe(false);
  });

  test('sha512 は完全な base64 SHA-512 ダイジェストを必須にする', () => {
    expect(isValidSha512Base64(validSha512)).toBe(true);
    expect(isValidSha512Base64('abc123')).toBe(false);
    expect(isValidSha512Base64('')).toBe(false);
    expect(sha512Matches(validSha512, validSha512)).toBe(true);
    expect(sha512Matches(validSha512, Buffer.alloc(64, 0x5b).toString('base64'))).toBe(false);
  });

  test('releaseNotes のブロックスタイル (|-) を解析する', () => {
    const yaml = [
      'version: 1.0.0',
      'releaseNotes: |-',
      '  Line 1',
      '  Line 2',
      'path: foo.exe',
    ].join('\n');
    const result = parseEmergencyLatestBackupYml(yaml);
    expect(result.releaseNotes).toContain('Line 1');
    expect(result.releaseNotes).toContain('Line 2');
  });

  test('空文字は空のオブジェクトを返す', () => {
    const result = parseEmergencyLatestBackupYml('');
    expect(result.version).toBe('');
    expect(result.url).toBe('');
  });
});

describe('緊急更新メタデータの完全性', () => {
  test('sha512 がないフォールバックを更新候補として受理しない', async () => {
    const axios = {
      get: jest.fn().mockResolvedValue({
        status: 200,
        data: 'version: 1.0.1\npath: Avatool Setup 1.0.1.exe\n',
      }),
    };
    const electronAutoUpdater = {
      checkForUpdates: jest.fn().mockRejectedValue(new Error('latest.yml: cannot parse update info')),
    };
    const updater = makeUpdater({
      axios,
      electronAutoUpdater,
      app: {
        isPackaged: true,
        getVersion: jest.fn().mockReturnValue('1.0.0'),
        getPath: jest.fn().mockReturnValue('/tmp'),
      },
    });

    const result = await updater.checkForAppUpdate();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('sha512');
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get.mock.calls[0][0]).toContain('latest-backup.yml');
  });
});

// ---------------------------------------------------------------------------
// isLikelyLatestYmlParseError (_test)
// ---------------------------------------------------------------------------

describe('isLikelyLatestYmlParseError', () => {
  const { _test: { isLikelyLatestYmlParseError } } = makeUpdater();

  test('latest.yml + cannot parse update info は true', () => {
    expect(isLikelyLatestYmlParseError(new Error('latest.yml: cannot parse update info from latest.yml'))).toBe(true);
  });

  test('latest.yml + yamlexception は true', () => {
    expect(isLikelyLatestYmlParseError(new Error('latest.yml: YAMLException'))).toBe(true);
  });

  test('関係のないエラーは false', () => {
    expect(isLikelyLatestYmlParseError(new Error('network timeout'))).toBe(false);
  });

  test('null は false', () => {
    expect(isLikelyLatestYmlParseError(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkForAppUpdate — early exits
// ---------------------------------------------------------------------------

describe('checkForAppUpdate — early exits', () => {
  test('electronAutoUpdater がなければ auto_updater_unavailable', async () => {
    const updater = makeUpdater({ electronAutoUpdater: null });
    const result = await updater.checkForAppUpdate();
    expect(result.error).toBe('auto_updater_unavailable');
  });

  test('isPackaged=false なら not_packaged', async () => {
    const mockAutoUpdater = { checkForUpdates: jest.fn(), on: jest.fn(), autoDownload: true, autoInstallOnAppQuit: false, disableDifferentialDownload: false };
    const updater = makeUpdater({
      electronAutoUpdater: mockAutoUpdater,
      app: { isPackaged: false, getVersion: jest.fn().mockReturnValue('1.0.0'), getPath: jest.fn() },
    });
    const result = await updater.checkForAppUpdate();
    expect(result.error).toBe('not_packaged');
  });
});

// ---------------------------------------------------------------------------
// getAppUpdateAvailableInfo — 初期値
// ---------------------------------------------------------------------------

describe('getAppUpdateAvailableInfo', () => {
  test('初期値は null', () => {
    const updater = makeUpdater();
    expect(updater.getAppUpdateAvailableInfo()).toBeNull();
  });
});
