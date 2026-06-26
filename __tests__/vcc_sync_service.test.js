'use strict';

const path = require('path');
const { createVccSyncService } = require('../lib/vcc_sync_service');

// ---------------------------------------------------------------------------
// テスト用 deps ファクトリ
// ---------------------------------------------------------------------------

function makeDeps(overrides = {}) {
  return {
    fs: {
      existsSync: jest.fn().mockReturnValue(false),
      readFileSync: jest.fn(),
      watch: jest.fn().mockReturnValue({ on: jest.fn(), close: jest.fn() }),
      watchFile: jest.fn(),
      unwatchFile: jest.fn(),
    },
    path,
    VCC_SETTINGS_PATH: '/vcc/settings.json',
    getSettings: jest.fn().mockReturnValue({ unityProjects: [], unityEditorPath: '' }),
    normalizeUnityProjects: jest.fn().mockImplementation((p) => Array.isArray(p) ? p : []),
    normalizeProjectPath: jest.fn().mockImplementation((p) => String(p || '').toLowerCase()),
    dedupeProjects: jest.fn().mockImplementation((p) => p),
    saveSettings: jest.fn(),
    emitVccProjectsUpdated: jest.fn(),
    enqueueAutoBootstrap: jest.fn(),
    ensureFolderIconBootstrapForProjects: jest.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// readVccProjectsFile
// ---------------------------------------------------------------------------

describe('readVccProjectsFile', () => {
  test('設定ファイルが存在しなければ vcc_settings_not_found エラー', () => {
    const svc = createVccSyncService(makeDeps({ fs: { existsSync: jest.fn().mockReturnValue(false) } }));
    expect(svc.readVccProjectsFile().error).toBe('vcc_settings_not_found');
  });

  test('VCC_SETTINGS_PATH が空なら vcc_settings_not_found', () => {
    const svc = createVccSyncService(makeDeps({ VCC_SETTINGS_PATH: '' }));
    expect(svc.readVccProjectsFile().error).toBe('vcc_settings_not_found');
  });

  test('正常な JSON から projects と editorPath を返す', () => {
    const vccData = {
      userProjects: ['/projects/Avatar'],
      preferredUnityEditors: { '2022': 'C:/Unity/Editor.exe' },
    };
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockImplementation((p) => p === '/vcc/settings.json' || p === '/projects/Avatar'),
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(vccData)),
      },
    });
    const svc = createVccSyncService(deps);
    const result = svc.readVccProjectsFile();
    expect(result.ok).toBe(true);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe('Avatar');
    expect(result.editorPath).toBe('C:/Unity/Editor.exe');
  });

  test('存在しないプロジェクトパスはフィルタされる', () => {
    const vccData = { userProjects: ['/projects/Missing', '/projects/Exists'] };
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockImplementation((p) => p !== '/projects/Missing'),
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(vccData)),
      },
    });
    const svc = createVccSyncService(deps);
    const result = svc.readVccProjectsFile();
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe('Exists');
  });

  test('UTF-8 BOM 付きでも正しく読み込む', () => {
    const vccData = { userProjects: [] };
    const bom = '\uFEFF';
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(bom + JSON.stringify(vccData)),
      },
    });
    const svc = createVccSyncService(deps);
    const result = svc.readVccProjectsFile();
    expect(result.ok).toBe(true);
  });

  test('壊れた JSON はエラーを返す', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue('not-json'),
      },
    });
    const svc = createVccSyncService(deps);
    const result = svc.readVccProjectsFile();
    expect(result.error).toBeTruthy();
  });

  test('preferredUnityEditors がない場合 editorPath は空文字', () => {
    const vccData = { userProjects: [] };
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(vccData)),
      },
    });
    const svc = createVccSyncService(deps);
    const result = svc.readVccProjectsFile();
    expect(result.editorPath).toBe('');
  });
});

// ---------------------------------------------------------------------------
// syncToSettings
// ---------------------------------------------------------------------------

describe('syncToSettings', () => {
  test('readVccProjectsFile がエラーを返したらそのまま返す', () => {
    const svc = createVccSyncService(makeDeps({ fs: { existsSync: jest.fn().mockReturnValue(false) } }));
    const result = svc.syncToSettings();
    expect(result.error).toBeTruthy();
  });

  test('変更がなければ changed=false を返す', () => {
    const project = { name: 'MyProject', path: '/projects/MyProject' };
    const vccData = { userProjects: ['/projects/MyProject'] };
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(vccData)),
      },
      getSettings: jest.fn().mockReturnValue({ unityProjects: [project], unityEditorPath: '' }),
      normalizeUnityProjects: jest.fn().mockImplementation((p) => Array.isArray(p) ? p : []),
      dedupeProjects: jest.fn().mockImplementation((p) => p),
    });
    const svc = createVccSyncService(deps);
    const result = svc.syncToSettings();
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(deps.saveSettings).not.toHaveBeenCalled();
  });

  test('プロジェクトが追加されたら changed=true で saveSettings を呼ぶ', () => {
    const newProject = { name: 'NewProject', path: '/projects/NewProject' };
    const vccData = { userProjects: ['/projects/NewProject'] };
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(vccData)),
      },
      getSettings: jest.fn().mockReturnValue({ unityProjects: [], unityEditorPath: '' }),
      normalizeUnityProjects: jest.fn().mockImplementation((p) => Array.isArray(p) ? p : []),
      dedupeProjects: jest.fn().mockImplementation((p) => p),
    });
    const svc = createVccSyncService(deps);
    const result = svc.syncToSettings('manual');
    expect(result.changed).toBe(true);
    expect(result.added).toBe(1);
    expect(deps.saveSettings).toHaveBeenCalled();
    expect(deps.emitVccProjectsUpdated).toHaveBeenCalled();
  });

  test('startup ソースでは enqueueAutoBootstrap が呼ばれない', () => {
    const vccData = { userProjects: ['/projects/New'] };
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(vccData)),
      },
      getSettings: jest.fn().mockReturnValue({ unityProjects: [], unityEditorPath: '' }),
      normalizeUnityProjects: jest.fn().mockImplementation((p) => Array.isArray(p) ? p : []),
      dedupeProjects: jest.fn().mockImplementation((p) => p),
    });
    const svc = createVccSyncService(deps);
    svc.syncToSettings('startup');
    expect(deps.enqueueAutoBootstrap).not.toHaveBeenCalled();
  });

  test('startup 以外のソースでは追加されたプロジェクトが enqueueAutoBootstrap される', () => {
    const vccData = { userProjects: ['/projects/New'] };
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(JSON.stringify(vccData)),
      },
      getSettings: jest.fn().mockReturnValue({ unityProjects: [], unityEditorPath: '' }),
      normalizeUnityProjects: jest.fn().mockImplementation((p) => Array.isArray(p) ? p : []),
      dedupeProjects: jest.fn().mockImplementation((p) => p),
    });
    const svc = createVccSyncService(deps);
    svc.syncToSettings('watch');
    expect(deps.enqueueAutoBootstrap).toHaveBeenCalledWith('/projects/New', 'watch');
  });
});

// ---------------------------------------------------------------------------
// stopWatcher
// ---------------------------------------------------------------------------

describe('stopWatcher', () => {
  test('ウォッチャーなしでも例外が起きない', () => {
    const svc = createVccSyncService(makeDeps());
    expect(() => svc.stopWatcher()).not.toThrow();
  });

  test('startWatcher 後に stopWatcher で close が呼ばれる', () => {
    const closeMock = jest.fn();
    const watchHandle = { on: jest.fn(), close: closeMock };
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        watch: jest.fn().mockReturnValue(watchHandle),
        watchFile: jest.fn(),
        unwatchFile: jest.fn(),
      },
    });
    const svc = createVccSyncService(deps);
    svc.startWatcher();
    svc.stopWatcher();
    expect(closeMock).toHaveBeenCalled();
  });

  test('watcher.close が例外を投げてもクラッシュしない', () => {
    const watchHandle = {
      on: jest.fn(),
      close: jest.fn().mockImplementation(() => { throw new Error('already closed'); }),
    };
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        watch: jest.fn().mockReturnValue(watchHandle),
        watchFile: jest.fn(),
        unwatchFile: jest.fn(),
      },
    });
    const svc = createVccSyncService(deps);
    svc.startWatcher();
    expect(() => svc.stopWatcher()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// startWatcher
// ---------------------------------------------------------------------------

describe('startWatcher', () => {
  test('設定ファイルが存在しない場合は watch を呼ばない', () => {
    const deps = makeDeps({ fs: { existsSync: jest.fn().mockReturnValue(false) } });
    const svc = createVccSyncService(deps);
    svc.startWatcher();
    expect(deps.fs.existsSync).toHaveBeenCalled();
  });

  test('設定ファイルが存在すれば fs.watch と fs.watchFile が呼ばれる', () => {
    const watchHandle = { on: jest.fn(), close: jest.fn() };
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        watch: jest.fn().mockReturnValue(watchHandle),
        watchFile: jest.fn(),
        unwatchFile: jest.fn(),
      },
    });
    const svc = createVccSyncService(deps);
    svc.startWatcher();
    expect(deps.fs.watch).toHaveBeenCalledWith('/vcc/settings.json', expect.any(Object), expect.any(Function));
    expect(deps.fs.watchFile).toHaveBeenCalledWith('/vcc/settings.json', expect.any(Object), expect.any(Function));
    svc.stopWatcher(); // cleanup
  });
});
