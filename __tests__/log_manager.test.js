'use strict';

const { createLogManager } = require('../lib/log_manager');

// ---------------------------------------------------------------------------
// テスト用 deps ファクトリ
// ---------------------------------------------------------------------------

function makeDeps(overrides = {}) {
  return {
    fs: {
      existsSync: jest.fn().mockReturnValue(false),
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
      appendFileSync: jest.fn(),
      mkdirSync: jest.fn(),
      statSync: jest.fn(),
      renameSync: jest.fn(),
      rmSync: jest.fn(),
    },
    OP_LOG_PATH: '/data/op.log',
    AVATAR_DEBUG_LOG_PATH: '/data/debug/avatar_analysis_debug.txt',
    RENDERER_LOG_MAX_CHARS: 200,
    DEBUG_VERBOSE: false,
    appendRuntimeLog: jest.fn(),
    getMainWindow: jest.fn().mockReturnValue(null),
    getSettings: jest.fn().mockReturnValue({ operationLogEnabled: false }),
    ensureAppDataRootExists: jest.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sanitizeRendererLogText
// ---------------------------------------------------------------------------

describe('sanitizeRendererLogText', () => {
  const { sanitizeRendererLogText } = createLogManager(makeDeps());

  test('通常のテキストはそのまま返す', () => {
    expect(sanitizeRendererLogText('hello world')).toBe('hello world');
  });

  test('改行は半角スペースに変換される', () => {
    expect(sanitizeRendererLogText('line1\nline2')).toBe('line1 line2');
    expect(sanitizeRendererLogText('line1\r\nline2')).toBe('line1 line2');
    expect(sanitizeRendererLogText('line1\rline2')).toBe('line1 line2');
  });

  test('制御文字（NUL, BEL 等）は除去される', () => {
    expect(sanitizeRendererLogText('a\x00b\x07c')).toBe('abc');
    expect(sanitizeRendererLogText('\x1Ftest')).toBe('test');
  });

  test('maxLen を超えると切り詰めて ...(truncated) を付与する', () => {
    const longText = 'a'.repeat(250);
    const result = sanitizeRendererLogText(longText, 200);
    expect(result).toHaveLength(200 + '...(truncated)'.length);
    expect(result.endsWith('...(truncated)')).toBe(true);
  });

  test('maxLen 以内はそのまま返す', () => {
    const text = 'a'.repeat(100);
    expect(sanitizeRendererLogText(text, 200)).toBe(text);
  });

  test('null / undefined は空文字として扱われる', () => {
    expect(sanitizeRendererLogText(null)).toBe('');
    expect(sanitizeRendererLogText(undefined)).toBe('');
  });

  test('先頭・末尾の空白は trim される', () => {
    expect(sanitizeRendererLogText('  hello  ')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// appendOperationLog
// ---------------------------------------------------------------------------

describe('appendOperationLog', () => {
  test('エントリが返され id・at・type・message を持つ', () => {
    const deps = makeDeps();
    const { appendOperationLog } = createLogManager(deps);
    const entry = appendOperationLog('info', 'テストメッセージ');
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('at');
    expect(entry.type).toBe('info');
    expect(entry.message).toBe('テストメッセージ');
  });

  test('meta が付与される', () => {
    const { appendOperationLog } = createLogManager(makeDeps());
    const entry = appendOperationLog('warn', 'msg', { extra: 1 });
    expect(entry.meta).toEqual({ extra: 1 });
  });

  test('meta なしは null になる', () => {
    const { appendOperationLog } = createLogManager(makeDeps());
    const entry = appendOperationLog('info', 'msg');
    expect(entry.meta).toBeNull();
  });

  test('appendRuntimeLog が呼ばれる', () => {
    const deps = makeDeps();
    const { appendOperationLog } = createLogManager(deps);
    appendOperationLog('error', 'boom');
    expect(deps.appendRuntimeLog).toHaveBeenCalledWith('log', 'operation', '[error]', 'boom', '');
  });

  test('operationLogEnabled=true なら saveOperationLogs が呼ばれる', () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ operationLogEnabled: true }),
    });
    const { appendOperationLog } = createLogManager(deps);
    appendOperationLog('info', 'save-me');
    expect(deps.fs.writeFileSync).toHaveBeenCalledWith('/data/op.log', expect.any(String), 'utf8');
  });

  test('operationLogEnabled=false なら writeFileSync は呼ばれない', () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ operationLogEnabled: false }),
    });
    const { appendOperationLog } = createLogManager(deps);
    appendOperationLog('info', 'no-save');
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('500件超でログがスライスされる', () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ operationLogEnabled: false }),
    });
    const { appendOperationLog, getOperationLogs } = createLogManager(deps);
    for (let i = 0; i < 510; i++) appendOperationLog('info', `msg${i}`);
    expect(getOperationLogs().length).toBeLessThanOrEqual(500);
  });

  test('getMainWindow が null でも例外が起きない', () => {
    const deps = makeDeps({ getMainWindow: jest.fn().mockReturnValue(null) });
    const { appendOperationLog } = createLogManager(deps);
    expect(() => appendOperationLog('info', 'ok')).not.toThrow();
  });

  test('sender.send が呼ばれる（ウィンドウが存在する場合）', () => {
    const mockSend = jest.fn();
    const deps = makeDeps({
      getMainWindow: jest.fn().mockReturnValue({
        webContents: { send: mockSend, isDestroyed: jest.fn().mockReturnValue(false) },
      }),
    });
    const { appendOperationLog } = createLogManager(deps);
    appendOperationLog('info', 'notify');
    expect(mockSend).toHaveBeenCalledWith('operation-log', expect.objectContaining({ message: 'notify' }));
  });
});

describe('appendAvatarDebugLog', () => {
  test('debugLogEnabled=true なら txt に追記する', () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ operationLogEnabled: false, debugLogEnabled: true }),
    });
    const { appendAvatarDebugLog } = createLogManager(deps);
    const ok = appendAvatarDebugLog('avatar-score-breakdown', { itemId: '300', score: 7 });
    expect(ok).toBe(true);
    expect(deps.ensureAppDataRootExists).toHaveBeenCalled();
    expect(deps.fs.appendFileSync).toHaveBeenCalledWith(
      '/data/debug/avatar_analysis_debug.txt',
      expect.stringContaining('[AVATAR-DEBUG] avatar-score-breakdown'),
      'utf8'
    );
  });

  test('debugLogEnabled=false なら txt に追記しない', () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ operationLogEnabled: false, debugLogEnabled: false }),
    });
    const { appendAvatarDebugLog } = createLogManager(deps);
    const ok = appendAvatarDebugLog('avatar-score-breakdown', { itemId: '300' });
    expect(ok).toBe(false);
    expect(deps.fs.appendFileSync).not.toHaveBeenCalled();
  });

  test('5MB 超なら old にローテートしてから追記する', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn((p) => p === '/data/debug/avatar_analysis_debug.txt'),
        readFileSync: jest.fn(),
        writeFileSync: jest.fn(),
        appendFileSync: jest.fn(),
        mkdirSync: jest.fn(),
        statSync: jest.fn().mockReturnValue({ size: 6 * 1024 * 1024 }),
        renameSync: jest.fn(),
        rmSync: jest.fn(),
      },
      getSettings: jest.fn().mockReturnValue({ operationLogEnabled: false, debugLogEnabled: true }),
    });
    const { appendAvatarDebugLog } = createLogManager(deps);
    appendAvatarDebugLog('avatar-score-breakdown', { itemId: '300' });
    expect(deps.fs.renameSync).toHaveBeenCalledWith(
      '/data/debug/avatar_analysis_debug.txt',
      '/data/debug/avatar_analysis_debug.txt.old'
    );
    expect(deps.fs.appendFileSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getOperationLogs / clearOperationLogs
// ---------------------------------------------------------------------------

describe('getOperationLogs / clearOperationLogs', () => {
  test('初期状態は空配列', () => {
    const { getOperationLogs } = createLogManager(makeDeps());
    expect(getOperationLogs()).toEqual([]);
  });

  test('clearOperationLogs でリセットされる', () => {
    const deps = makeDeps();
    const { appendOperationLog, getOperationLogs, clearOperationLogs } = createLogManager(deps);
    appendOperationLog('info', 'a');
    appendOperationLog('info', 'b');
    clearOperationLogs();
    expect(getOperationLogs()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadOperationLogs
// ---------------------------------------------------------------------------

describe('loadOperationLogs', () => {
  test('ファイルが存在しなければ空配列になる', () => {
    const deps = makeDeps({ fs: { existsSync: jest.fn().mockReturnValue(false), readFileSync: jest.fn(), writeFileSync: jest.fn() } });
    const { loadOperationLogs, getOperationLogs } = createLogManager(deps);
    loadOperationLogs();
    expect(getOperationLogs()).toEqual([]);
  });

  test('UTF-8 JSON ファイルから読み込む', () => {
    const data = [{ id: '1', at: 'now', type: 'info', message: 'hello', meta: null }];
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(Buffer.from(JSON.stringify(data), 'utf8')),
        writeFileSync: jest.fn(),
      },
      getSettings: jest.fn().mockReturnValue({ operationLogEnabled: false }),
    });
    const { loadOperationLogs, getOperationLogs } = createLogManager(deps);
    loadOperationLogs();
    expect(getOperationLogs()).toHaveLength(1);
    expect(getOperationLogs()[0].message).toBe('hello');
  });

  test('UTF-8 BOM 付きでも正しく読み込む', () => {
    const data = [{ id: '1', at: 'now', type: 'info', message: 'bom', meta: null }];
    const bom = '\uFEFF';
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(Buffer.from(bom + JSON.stringify(data), 'utf8')),
        writeFileSync: jest.fn(),
      },
      getSettings: jest.fn().mockReturnValue({ operationLogEnabled: false }),
    });
    const { loadOperationLogs, getOperationLogs } = createLogManager(deps);
    loadOperationLogs();
    expect(getOperationLogs()[0].message).toBe('bom');
  });

  test('壊れた JSON は空配列にフォールバック', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(Buffer.from('not-json', 'utf8')),
        writeFileSync: jest.fn(),
      },
      getSettings: jest.fn().mockReturnValue({ operationLogEnabled: false }),
    });
    const { loadOperationLogs, getOperationLogs } = createLogManager(deps);
    loadOperationLogs();
    expect(getOperationLogs()).toEqual([]);
  });

  test('readFileSync が例外を投げると空配列にフォールバック', () => {
    const deps = makeDeps({
      fs: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockImplementation(() => { throw new Error('perm'); }),
        writeFileSync: jest.fn(),
      },
    });
    const { loadOperationLogs, getOperationLogs } = createLogManager(deps);
    loadOperationLogs();
    expect(getOperationLogs()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// dbgUpdate
// ---------------------------------------------------------------------------

describe('dbgUpdate', () => {
  test('DEBUG_VERBOSE=false なら console.log が呼ばれない', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { dbgUpdate } = createLogManager(makeDeps({ DEBUG_VERBOSE: false }));
    dbgUpdate('test message');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('DEBUG_VERBOSE=true なら console.log が呼ばれる', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const deps = makeDeps({ DEBUG_VERBOSE: true, getSettings: jest.fn().mockReturnValue({ operationLogEnabled: false }) });
    const { dbgUpdate } = createLogManager(deps);
    dbgUpdate('hello');
    expect(spy).toHaveBeenCalledWith('[UPDATE-DEBUG]', 'hello');
    spy.mockRestore();
  });
});
