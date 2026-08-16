'use strict';

const { EventEmitter } = require('events');
const path = require('path');
const { createUnityManager } = require('../lib/unity_manager');

function makeDeps(overrides = {}) {
  const workerPayloads = [];
  class MockWorker extends EventEmitter {
    constructor(_workerPath, options) {
      super();
      workerPayloads.push(options.workerData.payload);
      const pkgPath = options.workerData.payload.pkgPath;
      process.nextTick(() => this.emit('message', {
        ok: true,
        assetPaths: pkgPath.includes('modular')
          ? ['Assets/ModularAvatar/Example.prefab']
          : ['Assets/lilToon/Example.mat'],
      }));
    }

    terminate() { return Promise.resolve(0); }
  }

  const packagePaths = new Set([
    'C:/fixtures/modular-avatar.unitypackage',
    'C:/fixtures/liltoon.unitypackage',
  ]);
  const fs = {
    existsSync: jest.fn((target) => packagePaths.has(String(target).replace(/\\\\/g, '/'))),
    readFileSync: jest.fn(),
    statSync: jest.fn(),
    readdirSync: jest.fn(() => []),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    rmSync: jest.fn(),
    renameSync: jest.fn(),
    accessSync: jest.fn(),
    constants: { R_OK: 4 },
  };

  return {
    workerPayloads,
    fs,
    path,
    spawn: jest.fn(),
    Worker: MockWorker,
    getSettings: jest.fn(() => ({})),
    saveSettings: jest.fn(),
    normalizeProjectPath: jest.fn((value) => value),
    normalizeUnityProjects: jest.fn(() => []),
    dedupeProjects: jest.fn((value) => value),
    IMPORT_LOG_PATH: 'C:/test/import-log.json',
    RECONCILE_LOG_PATH: 'C:/test/reconcile-log.json',
    UNITY_LOG_DIR: 'C:/test/logs',
    APP_DATA_ROOT: 'C:/test/app-data',
    LEGACY_APP_ROOT: 'C:/test/legacy',
    INSTALL_SCRIPTS_DIR: 'C:/test/scripts',
    backgroundImportRunningProjects: new Set(),
    SIMPLE_FOLDER_ICON_PACKAGE_NAME: 'SimpleFolderIcon',
    SIMPLE_FOLDER_ICON_PACKAGE_ID: 'simple-folder-icon',
    buildItemDir: jest.fn(),
    isVpmPackageDir: jest.fn(() => false),
    listVpmPackageRootsInDir: jest.fn(() => []),
    applyVpmPackagesToProject: jest.fn(),
    ensureModularAvatarDependency: jest.fn(),
    ensureLiltoonDependency: jest.fn(),
    VCC_SETTINGS_PATH: 'C:/test/vcc.json',
    enqueueAutoBootstrap: jest.fn(),
    runWithBoothCookieLoginFallback: jest.fn(),
    getBoothClient: jest.fn(),
    emitVccProjectsUpdated: jest.fn(),
    dbgUpdate: jest.fn(),
    appendOperationLog: jest.fn(),
    appendRuntimeLog: jest.fn(),
    ...overrides,
  };
}

describe('analyzeImportToolDependencies', () => {
  test('scans every supplied unitypackage when metadata is absent', async () => {
    const deps = makeDeps();
    const unity = createUnityManager(deps);
    const packages = [
      { packagePath: 'C:/fixtures/modular-avatar.unitypackage' },
      { packagePath: 'C:/fixtures/liltoon.unitypackage' },
    ];

    const result = await unity.analyzeImportToolDependencies('C:/fixtures/project', packages);

    expect(result).toMatchObject({
      ok: true,
      scannedPackages: packages.length,
    });
    expect(result.required).toEqual(expect.arrayContaining(['ma', 'liltoon']));
    expect(deps.workerPayloads).toHaveLength(packages.length);
    expect(deps.workerPayloads.map((payload) => payload.pkgPath)).toEqual(packages.map((pkg) => pkg.packagePath));
  });
});
