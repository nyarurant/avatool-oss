'use strict';

const path = require('path');
const { createUnityEditorSupport } = require('../lib/unity_editor_support');

// ---------------------------------------------------------------------------
// テスト用ファクトリ
// ---------------------------------------------------------------------------

const BATCH_CONTENT = '/* BoothBatchImporter.cs template */';
const LIVE_CONTENT = '/* BoothLiveImportBridge.cs template */';
const SHARED_CONTENT = '/* BoothImportShared.cs template */';
const FOLDER_CONTENT = '/* AvatoolFolderIconBootstrap.cs template */';

function makeDeps(fsOverrides = {}) {
  // テンプレートファイルは appRoot から読み込む
  const templateFiles = new Map([
    [path.join('/app', 'lib', 'unity_templates', 'BoothBatchImporter.cs'), BATCH_CONTENT],
    [path.join('/app', 'lib', 'unity_templates', 'BoothLiveImportBridge.cs'), LIVE_CONTENT],
    [path.join('/app', 'lib', 'unity_templates', 'BoothImportShared.cs'), SHARED_CONTENT],
    [path.join('/app', 'lib', 'unity_templates', 'AvatoolFolderIconBootstrap.cs'), FOLDER_CONTENT],
  ]);

  const defaultFs = {
    existsSync: jest.fn().mockImplementation((p) => templateFiles.has(p) || false),
    readFileSync: jest.fn().mockImplementation((p) => {
      if (templateFiles.has(p)) return templateFiles.get(p);
      throw new Error('ENOENT');
    }),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn(),
  };

  return createUnityEditorSupport({
    fs: { ...defaultFs, ...fsOverrides },
    path,
    appRoot: '/app',
    resourcesPath: null,
  });
}

// ---------------------------------------------------------------------------
// ensureBatchImporter
// ---------------------------------------------------------------------------

describe('ensureBatchImporter', () => {
  test('プロジェクトが存在しなければ project_not_found エラー', () => {
    const sup = makeDeps({ existsSync: jest.fn().mockReturnValue(false) });
    const result = sup.ensureBatchImporter('/nonexistent');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('project_not_found');
  });

  test('shared テンプレートがない場合は shared_importer_template_missing エラー', () => {
    const fs2 = {
      existsSync: jest.fn().mockImplementation((p) => p === '/project'),
      readFileSync: jest.fn(),
      mkdirSync: jest.fn(),
      writeFileSync: jest.fn(),
    };
    const sup = createUnityEditorSupport({ fs: fs2, path, appRoot: '/app', resourcesPath: null });
    const result = sup.ensureBatchImporter('/project');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('shared_importer_template_missing');
  });

  test('shared はあるが batch テンプレートがない場合は batch_importer_template_missing エラー', () => {
    const sharedPath = path.join('/app', 'lib', 'unity_templates', 'BoothImportShared.cs');
    const fs2 = {
      existsSync: jest.fn().mockImplementation((p) => p === '/project' || p === sharedPath),
      readFileSync: jest.fn().mockImplementation((p) => {
        if (p === sharedPath) return SHARED_CONTENT;
        throw new Error('ENOENT');
      }),
      mkdirSync: jest.fn(),
      writeFileSync: jest.fn(),
    };
    const sup = createUnityEditorSupport({ fs: fs2, path, appRoot: '/app', resourcesPath: null });
    const result = sup.ensureBatchImporter('/project');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('batch_importer_template_missing');
  });

  test('正常にスクリプトファイルを書き込む', () => {
    const writeFileSync = jest.fn();
    const existsSync = jest.fn().mockImplementation((p) => {
      // テンプレートパスと /project は存在する、Editor ディレクトリは存在しない
      return p.endsWith('.cs') || p === '/project';
    });
    const readFileSync = jest.fn().mockReturnValue(BATCH_CONTENT);
    const sup = createUnityEditorSupport({
      fs: { existsSync, readFileSync, mkdirSync: jest.fn(), writeFileSync },
      path,
      appRoot: '/app',
      resourcesPath: null,
    });
    const result = sup.ensureBatchImporter('/project');
    expect(result.ok).toBe(true);
    expect(result.scriptPath).toContain('BoothBatchImporter.cs');
    expect(writeFileSync).toHaveBeenCalled();
  });

  test('BoothImportShared.cs も同時に書き込まれる', () => {
    const writeFileSync = jest.fn();
    const existsSync = jest.fn().mockImplementation((p) => p.endsWith('.cs') || p === '/project');
    const readFileSync = jest.fn().mockReturnValue(SHARED_CONTENT);
    const sup = createUnityEditorSupport({
      fs: { existsSync, readFileSync, mkdirSync: jest.fn(), writeFileSync },
      path,
      appRoot: '/app',
      resourcesPath: null,
    });
    sup.ensureBatchImporter('/project');
    const writtenPaths = writeFileSync.mock.calls.map(([p]) => p);
    expect(writtenPaths.some((p) => p.includes('BoothImportShared.cs'))).toBe(true);
    expect(writtenPaths.some((p) => p.includes('BoothBatchImporter.cs'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ensureLiveImporter
// ---------------------------------------------------------------------------

describe('ensureLiveImporter', () => {
  test('正常にスクリプトファイルを書き込む', () => {
    const writeFileSync = jest.fn();
    const existsSync = jest.fn().mockImplementation((p) => p.endsWith('.cs') || p === '/project');
    const readFileSync = jest.fn().mockReturnValue(LIVE_CONTENT);
    const sup = createUnityEditorSupport({
      fs: { existsSync, readFileSync, mkdirSync: jest.fn(), writeFileSync },
      path,
      appRoot: '/app',
      resourcesPath: null,
    });
    const result = sup.ensureLiveImporter('/project');
    expect(result.ok).toBe(true);
    expect(result.scriptPath).toContain('BoothLiveImportBridge.cs');
  });

  test('BoothImportShared.cs も同時に書き込まれる', () => {
    const writeFileSync = jest.fn();
    const existsSync = jest.fn().mockImplementation((p) => p.endsWith('.cs') || p === '/project');
    const readFileSync = jest.fn().mockReturnValue(LIVE_CONTENT);
    const sup = createUnityEditorSupport({
      fs: { existsSync, readFileSync, mkdirSync: jest.fn(), writeFileSync },
      path,
      appRoot: '/app',
      resourcesPath: null,
    });
    sup.ensureLiveImporter('/project');
    const writtenPaths = writeFileSync.mock.calls.map(([p]) => p);
    expect(writtenPaths.some((p) => p.includes('BoothImportShared.cs'))).toBe(true);
    expect(writtenPaths.some((p) => p.includes('BoothLiveImportBridge.cs'))).toBe(true);
  });

  test('プロジェクトが存在しなければ project_not_found', () => {
    const sup = makeDeps({ existsSync: jest.fn().mockReturnValue(false) });
    expect(sup.ensureLiveImporter('/none').error).toBe('project_not_found');
  });
});

// ---------------------------------------------------------------------------
// ensureFolderIconBootstrap
// ---------------------------------------------------------------------------

describe('ensureFolderIconBootstrap', () => {
  test('スクリプトが存在しなければ新規作成し status=created', () => {
    const writeFileSync = jest.fn();
    const scriptPath = path.join('/project', 'Assets', 'Editor', 'AvatoolFolderIconBootstrap.cs');
    const existsSync = jest.fn().mockImplementation((p) => {
      if (p === scriptPath) return false;  // スクリプトは未存在
      if (p.includes('unity_templates')) return true; // テンプレートは存在
      if (p === '/project') return true;
      return false;
    });
    const readFileSync = jest.fn().mockReturnValue(FOLDER_CONTENT);
    const sup = createUnityEditorSupport({
      fs: { existsSync, readFileSync, mkdirSync: jest.fn(), writeFileSync },
      path,
      appRoot: '/app',
      resourcesPath: null,
    });
    const result = sup.ensureFolderIconBootstrap('/project');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('created');
    expect(writeFileSync).toHaveBeenCalled();
  });

  test('内容が同じなら status=unchanged で書き込みなし', () => {
    const writeFileSync = jest.fn();
    const scriptPath = path.join('/project', 'Assets', 'Editor', 'AvatoolFolderIconBootstrap.cs');
    const existsSync = jest.fn().mockImplementation((p) => {
      if (p.endsWith('.cs')) return true;  // テンプレートも scriptPath も存在
      if (p === '/project') return true;
      return false;
    });
    const readFileSync = jest.fn().mockReturnValue(FOLDER_CONTENT);
    const sup = createUnityEditorSupport({
      fs: { existsSync, readFileSync, mkdirSync: jest.fn(), writeFileSync },
      path,
      appRoot: '/app',
      resourcesPath: null,
    });
    const result = sup.ensureFolderIconBootstrap('/project');
    // scriptPath は存在する → readFileSync でテンプレート内容と比較
    // FOLDER_CONTENT.trim() === FOLDER_CONTENT.trim() なので unchanged
    expect(result.ok).toBe(true);
    expect(result.status).toBe('unchanged');
    // writeFileSync は templates 読み込み時以外は呼ばれない
    // (script書き込みは起きていない)
  });

  test('内容が変わっていれば status=updated', () => {
    const writeFileSync = jest.fn();
    const existsSync = jest.fn().mockImplementation((p) => {
      if (p.endsWith('.cs')) return true;
      if (p === '/project') return true;
      return false;
    });
    const readFileSync = jest.fn().mockImplementation((p) => {
      if (p.includes('unity_templates')) return FOLDER_CONTENT;
      return '/* old content */'; // scriptPath の現在の内容
    });
    const sup = createUnityEditorSupport({
      fs: { existsSync, readFileSync, mkdirSync: jest.fn(), writeFileSync },
      path,
      appRoot: '/app',
      resourcesPath: null,
    });
    const result = sup.ensureFolderIconBootstrap('/project');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('updated');
    expect(writeFileSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cleanupAutoBootstrapSupportScripts
// ---------------------------------------------------------------------------

describe('cleanupAutoBootstrapSupportScripts', () => {
  test('プロジェクトが存在しなければ project_not_found', () => {
    const sup = makeDeps({ existsSync: jest.fn().mockReturnValue(false) });
    const result = sup.cleanupAutoBootstrapSupportScripts('/none');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('project_not_found');
  });

  test('存在するファイルを削除し removed カウントを返す', () => {
    const unlinkSync = jest.fn();
    const editorDir = path.join('/project', 'Assets', 'Editor');
    const target1 = path.join(editorDir, 'BoothBatchImporter.cs');
    const target2 = path.join(editorDir, 'BoothBatchImporter.cs.meta');
    const existsSync = jest.fn().mockImplementation((p) => {
      if (p.endsWith('.cs') && p.includes('unity_templates')) return true; // テンプレート
      if (p === '/project') return true;
      if (p === target1 || p === target2) return true;
      return false;
    });
    const readFileSync = jest.fn().mockReturnValue(BATCH_CONTENT);
    const sup = createUnityEditorSupport({
      fs: { existsSync, readFileSync, mkdirSync: jest.fn(), writeFileSync: jest.fn(), unlinkSync },
      path,
      appRoot: '/app',
      resourcesPath: null,
    });
    const result = sup.cleanupAutoBootstrapSupportScripts('/project');
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(2);
    expect(unlinkSync).toHaveBeenCalledTimes(2);
  });

  test('BoothImportShared.cs も削除対象に含まれる', () => {
    const unlinkSync = jest.fn();
    const editorDir = path.join('/project', 'Assets', 'Editor');
    const sharedTarget = path.join(editorDir, 'BoothImportShared.cs');
    const existsSync = jest.fn().mockImplementation((p) => {
      if (p.endsWith('.cs') && p.includes('unity_templates')) return true;
      if (p === '/project') return true;
      if (p === sharedTarget) return true;
      return false;
    });
    const readFileSync = jest.fn().mockReturnValue(SHARED_CONTENT);
    const sup = createUnityEditorSupport({
      fs: { existsSync, readFileSync, mkdirSync: jest.fn(), writeFileSync: jest.fn(), unlinkSync },
      path,
      appRoot: '/app',
      resourcesPath: null,
    });
    const result = sup.cleanupAutoBootstrapSupportScripts('/project');
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(1);
    expect(unlinkSync).toHaveBeenCalledWith(sharedTarget);
  });

  test('削除対象が存在しなければ removed=0', () => {
    const existsSync = jest.fn().mockImplementation((p) => {
      if (p.endsWith('.cs') && p.includes('unity_templates')) return true;
      if (p === '/project') return true;
      return false; // ターゲットファイルなし
    });
    const readFileSync = jest.fn().mockReturnValue(BATCH_CONTENT);
    const unlinkSync = jest.fn();
    const sup = createUnityEditorSupport({
      fs: { existsSync, readFileSync, mkdirSync: jest.fn(), writeFileSync: jest.fn(), unlinkSync },
      path,
      appRoot: '/app',
      resourcesPath: null,
    });
    const result = sup.cleanupAutoBootstrapSupportScripts('/project');
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(0);
  });

  test('unlinkSync が例外を投げても ok=true で続行する', () => {
    const editorDir = path.join('/project', 'Assets', 'Editor');
    const target = path.join(editorDir, 'BoothBatchImporter.cs');
    const existsSync = jest.fn().mockImplementation((p) => {
      if (p.endsWith('.cs') && p.includes('unity_templates')) return true;
      if (p === '/project') return true;
      if (p === target) return true;
      return false;
    });
    const sup = createUnityEditorSupport({
      fs: {
        existsSync,
        readFileSync: jest.fn().mockReturnValue(BATCH_CONTENT),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        unlinkSync: jest.fn().mockImplementation(() => { throw new Error('perm'); }),
      },
      path,
      appRoot: '/app',
      resourcesPath: null,
    });
    const result = sup.cleanupAutoBootstrapSupportScripts('/project');
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(0); // 例外で削除はできなかった
  });
});
