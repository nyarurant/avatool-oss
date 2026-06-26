'use strict';

const { createVpmManager } = require('../lib/vpm_manager');
const path = require('path');

// ─── テスト用 deps ファクトリ ──────────────────────────────────────────────────

function makeDeps(overrides = {}) {
  return {
    fs: {
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
      existsSync: jest.fn(() => false),
      readdirSync: jest.fn(() => []),
      mkdirSync: jest.fn(),
      mkdtempSync: jest.fn(() => '/tmp/test'),
      copyFileSync: jest.fn(),
      rmSync: jest.fn(),
    },
    path,
    axios: { get: jest.fn() },
    getSettings: jest.fn(() => ({ downloadPath: 'C:/test/downloads' })),
    dbgUpdate: jest.fn(),
    NADENA_VPM_REPO_URL: 'https://vpm.nadena.dev',
    LILTOON_VPM_REPO_URL: 'https://lilxyzw.github.io/vpm-repos/vpm.json',
    MODULAR_AVATAR_PACKAGE_NAME: 'nadena.dev.modular-avatar',
    NDMF_PACKAGE_NAME: 'nadena.dev.ndmf',
    LILTOON_PACKAGE_NAME: 'jp.lilxyzw.liltoon',
    extractZipSimple: jest.fn(),
    ...overrides,
  };
}

// ─── isVpmPackageDir ──────────────────────────────────────────────────────────

describe('isVpmPackageDir', () => {
  test('package.json が存在し name にドットを含む場合 true', () => {
    const deps = makeDeps();
    deps.fs.existsSync.mockReturnValue(true);
    deps.fs.readFileSync.mockReturnValue(JSON.stringify({ name: 'nadena.dev.modular-avatar' }));
    const vpm = createVpmManager(deps);
    expect(vpm.isVpmPackageDir('C:/some/dir')).toBe(true);
  });

  test('package.json が存在しない場合 false', () => {
    const deps = makeDeps();
    deps.fs.existsSync.mockReturnValue(false);
    const vpm = createVpmManager(deps);
    expect(vpm.isVpmPackageDir('C:/some/dir')).toBe(false);
  });

  test('name にドットがない場合 false', () => {
    const deps = makeDeps();
    deps.fs.existsSync.mockReturnValue(true);
    deps.fs.readFileSync.mockReturnValue(JSON.stringify({ name: 'my-package' }));
    const vpm = createVpmManager(deps);
    expect(vpm.isVpmPackageDir('C:/some/dir')).toBe(false);
  });

  test('package.json の name が空の場合 false', () => {
    const deps = makeDeps();
    deps.fs.existsSync.mockReturnValue(true);
    deps.fs.readFileSync.mockReturnValue(JSON.stringify({ name: '' }));
    const vpm = createVpmManager(deps);
    expect(vpm.isVpmPackageDir('C:/some/dir')).toBe(false);
  });

  test('package.json が壊れた JSON の場合 false', () => {
    const deps = makeDeps();
    deps.fs.existsSync.mockReturnValue(true);
    deps.fs.readFileSync.mockReturnValue('INVALID JSON {{{');
    const vpm = createVpmManager(deps);
    expect(vpm.isVpmPackageDir('C:/some/dir')).toBe(false);
  });
});

// ─── fetchLatestPackageMetaFromVpmRepo ────────────────────────────────────────

describe('fetchLatestPackageMetaFromVpmRepo', () => {
  function makeRepoResponse(packageName, versions) {
    const versionsObj = {};
    for (const [ver, extra] of Object.entries(versions)) {
      versionsObj[ver] = { url: `https://example.com/${ver}.zip`, ...extra };
    }
    return {
      data: {
        packages: {
          [packageName]: { versions: versionsObj },
        },
      },
    };
  }

  test('stable バージョンを最新順で選択する', async () => {
    const deps = makeDeps();
    deps.axios.get.mockResolvedValue(
      makeRepoResponse('test.pkg', {
        '1.0.0': {},
        '1.1.0': {},
        '1.2.0': {},
      })
    );
    const vpm = createVpmManager(deps);
    const meta = await vpm.fetchLatestPackageMetaFromVpmRepo('https://example.com/vpm.json', 'test.pkg');
    expect(meta).not.toBeNull();
    expect(meta.version).toBe('1.2.0');
  });

  test('stable が prerelease より優先される', async () => {
    const deps = makeDeps();
    deps.axios.get.mockResolvedValue(
      makeRepoResponse('test.pkg', {
        '1.2.0': {},
        '1.3.0-beta.1': {},
      })
    );
    const vpm = createVpmManager(deps);
    const meta = await vpm.fetchLatestPackageMetaFromVpmRepo('https://example.com/vpm.json', 'test.pkg');
    expect(meta.version).toBe('1.2.0');
  });

  test('stable がない場合は最新の prerelease を選択する', async () => {
    const deps = makeDeps();
    deps.axios.get.mockResolvedValue(
      makeRepoResponse('test.pkg', {
        '1.0.0-alpha': {},
        '1.0.0-beta': {},
      })
    );
    const vpm = createVpmManager(deps);
    const meta = await vpm.fetchLatestPackageMetaFromVpmRepo('https://example.com/vpm.json', 'test.pkg');
    expect(meta).not.toBeNull();
  });

  test('パッケージが存在しない場合 null を返す', async () => {
    const deps = makeDeps();
    deps.axios.get.mockResolvedValue({ data: { packages: {} } });
    const vpm = createVpmManager(deps);
    const meta = await vpm.fetchLatestPackageMetaFromVpmRepo('https://example.com/vpm.json', 'no.such.pkg');
    expect(meta).toBeNull();
  });

  test('axios エラーの場合 null を返す', async () => {
    const deps = makeDeps();
    deps.axios.get.mockRejectedValue(new Error('network error'));
    const vpm = createVpmManager(deps);
    const meta = await vpm.fetchLatestPackageMetaFromVpmRepo('https://example.com/vpm.json', 'test.pkg');
    expect(meta).toBeNull();
  });

  test('versions が空の場合 null を返す', async () => {
    const deps = makeDeps();
    deps.axios.get.mockResolvedValue({
      data: { packages: { 'test.pkg': { versions: {} } } },
    });
    const vpm = createVpmManager(deps);
    const meta = await vpm.fetchLatestPackageMetaFromVpmRepo('https://example.com/vpm.json', 'test.pkg');
    expect(meta).toBeNull();
  });

  test('url が空の場合 null を返す', async () => {
    const deps = makeDeps();
    deps.axios.get.mockResolvedValue({
      data: { packages: { 'test.pkg': { versions: { '1.0.0': { url: '' } } } } },
    });
    const vpm = createVpmManager(deps);
    const meta = await vpm.fetchLatestPackageMetaFromVpmRepo('https://example.com/vpm.json', 'test.pkg');
    expect(meta).toBeNull();
  });
});

// ─── installLocalVpmPackageFromRepo ───────────────────────────────────────────

describe('installLocalVpmPackageFromRepo', () => {
  test('不正なパッケージ名は invalid_vpm_package_name エラーを返す', async () => {
    const deps = makeDeps();
    const vpm = createVpmManager(deps);
    const result = await vpm.installLocalVpmPackageFromRepo('/project', 'https://example.com', '');
    expect(result).toMatchObject({ error: 'invalid_vpm_package_name' });
  });

  test('.. を含むパッケージ名は invalid_vpm_package_name エラーを返す', async () => {
    const deps = makeDeps();
    const vpm = createVpmManager(deps);
    const result = await vpm.installLocalVpmPackageFromRepo('/project', 'https://example.com', '../evil');
    expect(result).toMatchObject({ error: 'invalid_vpm_package_name' });
  });

  test('メタ取得失敗は vpm_meta_not_found エラーを返す', async () => {
    const deps = makeDeps();
    deps.axios.get.mockRejectedValue(new Error('network error'));
    const vpm = createVpmManager(deps);
    const result = await vpm.installLocalVpmPackageFromRepo('/project', 'https://example.com', 'test.pkg');
    expect(result).toMatchObject({ error: 'vpm_meta_not_found' });
  });
});

// ─── ensureNadenaScopedRegistry ───────────────────────────────────────────────

describe('ensureNadenaScopedRegistry', () => {
  test('scopedRegistries が未定義の場合、Nadena レジストリを追加する', () => {
    const deps = makeDeps();
    const vpm = createVpmManager(deps);
    const manifest = {};
    vpm.ensureNadenaScopedRegistry(manifest);
    expect(Array.isArray(manifest.scopedRegistries)).toBe(true);
    const reg = manifest.scopedRegistries.find((r) => r.url.includes('nadena.dev'));
    expect(reg).toBeDefined();
    expect(reg.scopes).toContain('nadena.dev');
  });

  test('既存の Nadena レジストリがある場合はスコープをマージする', () => {
    const deps = makeDeps();
    const vpm = createVpmManager(deps);
    const manifest = {
      scopedRegistries: [
        { name: 'Existing', url: 'https://vpm.nadena.dev', scopes: ['existing.scope'] },
      ],
    };
    vpm.ensureNadenaScopedRegistry(manifest);
    expect(manifest.scopedRegistries).toHaveLength(1);
    const reg = manifest.scopedRegistries[0];
    expect(reg.scopes).toContain('nadena.dev');
    expect(reg.scopes).toContain('existing.scope');
  });

  test('Nadena レジストリが既に正しい場合は重複追加しない', () => {
    const deps = makeDeps();
    const vpm = createVpmManager(deps);
    const manifest = {
      scopedRegistries: [
        { name: 'Nadena VPM', url: 'https://vpm.nadena.dev', scopes: ['nadena.dev'] },
      ],
    };
    vpm.ensureNadenaScopedRegistry(manifest);
    expect(manifest.scopedRegistries).toHaveLength(1);
  });
});

// ─── ensureLilxyzwScopedRegistry ─────────────────────────────────────────────

describe('ensureLilxyzwScopedRegistry', () => {
  test('scopedRegistries が未定義の場合、lilxyzw レジストリを追加する', () => {
    const deps = makeDeps();
    const vpm = createVpmManager(deps);
    const manifest = {};
    vpm.ensureLilxyzwScopedRegistry(manifest);
    expect(Array.isArray(manifest.scopedRegistries)).toBe(true);
    const reg = manifest.scopedRegistries.find((r) => r.url.includes('lilxyzw'));
    expect(reg).toBeDefined();
    expect(reg.scopes).toContain('jp.lilxyzw');
  });

  test('既存の lilxyzw レジストリがある場合は重複追加しない', () => {
    const deps = makeDeps();
    const vpm = createVpmManager(deps);
    const manifest = {
      scopedRegistries: [
        { url: 'https://lilxyzw.github.io/vpm-repos/vpm.json', scopes: ['jp.lilxyzw'] },
      ],
    };
    vpm.ensureLilxyzwScopedRegistry(manifest);
    expect(manifest.scopedRegistries).toHaveLength(1);
  });
});

// ─── cleanupLegacyVpmEntries ──────────────────────────────────────────────────

describe('cleanupLegacyVpmEntries', () => {
  test('vpm-manifest.json が存在しない場合 changed: false を返す', () => {
    const deps = makeDeps();
    deps.fs.existsSync.mockReturnValue(false);
    deps.fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const vpm = createVpmManager(deps);
    const result = vpm.cleanupLegacyVpmEntries('C:/project/Packages');
    expect(result).toMatchObject({ changed: false });
  });

  test('MA/NDMF エントリを依存から削除する', () => {
    const deps = makeDeps();
    const manifest = {
      dependencies: {
        'nadena.dev.modular-avatar': '1.0.0',
        'nadena.dev.ndmf': '1.0.0',
        'other.package': '2.0.0',
      },
    };
    deps.fs.readFileSync.mockReturnValue(JSON.stringify(manifest));
    const vpm = createVpmManager(deps);
    const result = vpm.cleanupLegacyVpmEntries('C:/project/Packages');
    expect(result).toMatchObject({ changed: true });
    // writeFileSync が呼ばれていること
    expect(deps.fs.writeFileSync).toHaveBeenCalled();
    const written = JSON.parse(deps.fs.writeFileSync.mock.calls[0][1]);
    // Jest の toHaveProperty はドットをネスト記法として解釈するため配列記法を使う
    expect(written.dependencies).not.toHaveProperty(['nadena.dev.modular-avatar']);
    expect(written.dependencies).not.toHaveProperty(['nadena.dev.ndmf']);
    expect(written.dependencies).toHaveProperty(['other.package']);
  });

  test('削除対象がない場合 changed: false を返す', () => {
    const deps = makeDeps();
    const manifest = {
      dependencies: {
        'other.package': '2.0.0',
      },
    };
    deps.fs.readFileSync.mockReturnValue(JSON.stringify(manifest));
    const vpm = createVpmManager(deps);
    const result = vpm.cleanupLegacyVpmEntries('C:/project/Packages');
    expect(result).toMatchObject({ changed: false });
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled();
  });
});
