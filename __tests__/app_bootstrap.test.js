'use strict';

const {
  ensureWindowsStartupRegistration,
  setupSingleInstanceLock,
} = require('../lib/app_bootstrap');

// ---------------------------------------------------------------------------
// ensureWindowsStartupRegistration
// ---------------------------------------------------------------------------

describe('ensureWindowsStartupRegistration', () => {
  function makeArgs(overrides = {}) {
    return {
      app: {
        isPackaged: true,
        setLoginItemSettings: jest.fn(),
        getLoginItemSettings: jest.fn().mockReturnValue({ openAtLogin: true }),
      },
      processObj: { platform: 'win32', execPath: '/app/avatool.exe' },
      logger: { warn: jest.fn() },
      ...overrides,
    };
  }

  test('win32 以外のプラットフォームでは何もしない', () => {
    const args = makeArgs({ processObj: { platform: 'linux', execPath: '/app' } });
    ensureWindowsStartupRegistration(args);
    expect(args.app.setLoginItemSettings).not.toHaveBeenCalled();
  });

  test('isPackaged=false では何もしない', () => {
    const args = makeArgs();
    args.app.isPackaged = false;
    ensureWindowsStartupRegistration(args);
    expect(args.app.setLoginItemSettings).not.toHaveBeenCalled();
  });

  test('enabled=true で自動起動を有効化する', () => {
    const args = makeArgs({ enabled: true });
    ensureWindowsStartupRegistration(args);
    expect(args.app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: '/app/avatool.exe',
      args: [],
    });
  });

  test('enabled=false で自動起動を無効化する', () => {
    const args = makeArgs({ enabled: false });
    args.app.getLoginItemSettings = jest.fn().mockReturnValue({ openAtLogin: false });
    ensureWindowsStartupRegistration(args);
    expect(args.app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      path: '/app/avatool.exe',
      args: [],
    });
  });

  test('getLoginItemSettings が openAtLogin=false を返すと warn を出す', () => {
    const args = makeArgs({ enabled: true });
    args.app.getLoginItemSettings = jest.fn().mockReturnValue({ openAtLogin: false });
    ensureWindowsStartupRegistration(args);
    expect(args.logger.warn).toHaveBeenCalledWith(expect.stringContaining('startup registration'));
  });

  test('setLoginItemSettings が例外を投げても warn を出すだけでクラッシュしない', () => {
    const args = makeArgs();
    args.app.setLoginItemSettings = jest.fn().mockImplementation(() => { throw new Error('access denied'); });
    expect(() => ensureWindowsStartupRegistration(args)).not.toThrow();
    expect(args.logger.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setupSingleInstanceLock
// ---------------------------------------------------------------------------

describe('setupSingleInstanceLock', () => {
  function makeArgs(overrides = {}) {
    const handlers = {};
    return {
      app: {
        isPackaged: true,
        requestSingleInstanceLock: jest.fn().mockReturnValue(true),
        quit: jest.fn(),
        on: jest.fn().mockImplementation((event, handler) => { handlers[event] = handler; }),
      },
      processObj: { platform: 'win32' },
      getMainWindow: jest.fn().mockReturnValue(null),
      _handlers: handlers,
      ...overrides,
    };
  }

  test('isPackaged=false では何もしない', () => {
    const args = makeArgs();
    args.app.isPackaged = false;
    setupSingleInstanceLock(args);
    expect(args.app.requestSingleInstanceLock).not.toHaveBeenCalled();
  });

  test('ロック取得に失敗すると app.quit() が呼ばれる', () => {
    const args = makeArgs();
    args.app.requestSingleInstanceLock = jest.fn().mockReturnValue(false);
    setupSingleInstanceLock(args);
    expect(args.app.quit).toHaveBeenCalled();
  });

  test('ロック取得成功時は second-instance イベントリスナーを登録する', () => {
    const args = makeArgs();
    setupSingleInstanceLock(args);
    expect(args.app.on).toHaveBeenCalledWith('second-instance', expect.any(Function));
  });

  test('second-instance イベントでウィンドウが null のとき何もしない', () => {
    const args = makeArgs({ getMainWindow: jest.fn().mockReturnValue(null) });
    setupSingleInstanceLock(args);
    expect(() => args._handlers['second-instance']()).not.toThrow();
  });

  test('second-instance イベントで最小化中のウィンドウを復元・フォーカスする', () => {
    const win = {
      isDestroyed: jest.fn().mockReturnValue(false),
      isMinimized: jest.fn().mockReturnValue(true),
      restore: jest.fn(),
      show: jest.fn(),
      focus: jest.fn(),
    };
    const args = makeArgs({ getMainWindow: jest.fn().mockReturnValue(win) });
    setupSingleInstanceLock(args);
    args._handlers['second-instance']();
    expect(win.restore).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  test('second-instance イベントで最小化していないウィンドウは restore なし', () => {
    const win = {
      isDestroyed: jest.fn().mockReturnValue(false),
      isMinimized: jest.fn().mockReturnValue(false),
      restore: jest.fn(),
      show: jest.fn(),
      focus: jest.fn(),
    };
    const args = makeArgs({ getMainWindow: jest.fn().mockReturnValue(win) });
    setupSingleInstanceLock(args);
    args._handlers['second-instance']();
    expect(win.restore).not.toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  test('second-instance イベントで破棄済みウィンドウは何もしない', () => {
    const win = {
      isDestroyed: jest.fn().mockReturnValue(true),
      isMinimized: jest.fn(),
      restore: jest.fn(),
      show: jest.fn(),
      focus: jest.fn(),
    };
    const args = makeArgs({ getMainWindow: jest.fn().mockReturnValue(win) });
    setupSingleInstanceLock(args);
    args._handlers['second-instance']();
    expect(win.focus).not.toHaveBeenCalled();
  });
});
