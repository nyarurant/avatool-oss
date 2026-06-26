'use strict';

/**
 * createLoginWindow
 * BOOTHログインウィンドウのライフサイクルと Cookie 同期を管理する。
 *
 * @param {object} deps
 * @returns {{ openLoginWindowFlow: Function, getLoginWindow: Function, setLoginWindow: Function }}
 */
function createLoginWindow(deps) {
  const {
    BrowserWindow,
    shell,
    session,
    BOOTH_LOGIN_PARTITION,
    LOGIN_ALLOWED_HOST_SUFFIXES,
    LOGIN_ALLOWED_PROTOCOLS,
    getAppIconPath,
    setBoothClient,
    setBoothCookies,
    normalizeBoothCookies,
    persistTempBoothCookies,
    persistBoothCookies,
    validateBoothLogin,
    refreshMetaAfterLoginDedup,
    getMainWindow,
    createClientAndCookies,
  } = deps;

  let loginWindow = null;
  let loginFlowPromise = null;

  async function syncBoothCookies(rows) {
    const normalized = normalizeBoothCookies(rows);
    if (!normalized.length) return null;
    persistTempBoothCookies(normalized);
    persistBoothCookies(normalized);
    const next = await createClientAndCookies(normalized);
    setBoothClient(next?.client || null);
    setBoothCookies(Array.isArray(next?.cookies) ? next.cookies : normalized);
    return normalized;
  }

  function isAllowedLoginUrl(url) {
    try {
      const parsed = new URL(String(url || ''));
      if (!LOGIN_ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;
      const host = String(parsed.hostname || '').toLowerCase();
      return LOGIN_ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    } catch {
      return false;
    }
  }

  async function openLoginWindowFlow() {
    if (loginFlowPromise) return loginFlowPromise;

    // 前回セッションの残存 booth.pm Cookie をクリアしてフレッシュなログイン状態にする
    const partition = session.fromPartition(BOOTH_LOGIN_PARTITION);
    try {
      const oldCookies = await partition.cookies.get({ domain: 'booth.pm' });
      for (const c of oldCookies) {
        const url = `https://${String(c.domain || '').replace(/^\./, '')}${c.path || '/'}`;
        await partition.cookies.remove(url, c.name).catch(() => {});
      }
    } catch (e) {
      console.warn('[login] partition cookie clear failed:', e?.message);
    }

    loginFlowPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        try {
          if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
        } catch {
          // ignore close errors
        }
        loginWindow = null;
        loginFlowPromise = null;
        resolve(result);
      };

      const appIcon = getAppIconPath();

      loginWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        autoHideMenuBar: true,
        ...(appIcon ? { icon: appIcon } : {}),
        webPreferences: {
          partition: BOOTH_LOGIN_PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });

      const syncCookiesFromPartition = async () => {
        try {
          const rows = await partition.cookies.get({ domain: 'booth.pm' });
          return await syncBoothCookies(rows);
        } catch (e) {
          console.warn('[login] syncCookiesFromPartition failed:', e?.message);
          return null;
        }
      };

      const tryComplete = async () => {
        const syncedCookies = await syncCookiesFromPartition();
        if (!syncedCookies?.length) return;
        const valid = await validateBoothLogin(syncedCookies);
        if (!valid?.ok) return;
        await refreshMetaAfterLoginDedup(getMainWindow()?.webContents || null).catch((e) => console.warn('[login] meta refresh failed:', e?.message));
        finish({ ok: true });
      };

      const injectLoginCompleteOverlay = () => {
        if (!loginWindow || loginWindow.isDestroyed?.()) return;
        const js = `
(() => {
  try {
    const id = 'avatool-login-complete-overlay';
    if (document.getElementById(id)) return true;
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.style.position = 'fixed';
    wrap.style.right = '16px';
    wrap.style.bottom = '16px';
    wrap.style.zIndex = '2147483647';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'ログイン完了';
    btn.style.background = '#16a34a';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.borderRadius = '9999px';
    btn.style.padding = '10px 14px';
    btn.style.font = '600 13px system-ui, -apple-system, Segoe UI, sans-serif';
    btn.style.cursor = 'pointer';
    btn.style.boxShadow = '0 8px 18px rgba(0,0,0,.35)';
    btn.addEventListener('click', () => {
      const marker = 'avatool-login-complete-' + Date.now();
      try {
        const baseTitle = document.title || 'BOOTH Login';
        document.title = baseTitle + ' [' + marker + ']';
      } catch {}
      try {
        window.location.hash = marker;
      } catch {}
      btn.textContent = '確認中...';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = 'ログイン完了';
        btn.disabled = false;
      }, 2000);
    });
    wrap.appendChild(btn);
    (document.body || document.documentElement).appendChild(wrap);
    return true;
  } catch (_) {
    return false;
  }
})()
        `;
        loginWindow.webContents.executeJavaScript(js, true).catch(() => {});
      };

      loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedLoginUrl(url)) {
          shell.openExternal(url).catch(() => {});
        }
        return { action: 'deny' };
      });
      loginWindow.webContents.on('will-navigate', (event, url) => {
        if (!isAllowedLoginUrl(url)) event.preventDefault();
      });
      loginWindow.webContents.on('did-finish-load', () => {
        injectLoginCompleteOverlay();
        tryComplete().catch(() => {});
      });
      loginWindow.webContents.on('did-navigate', (_event, url) => {
        injectLoginCompleteOverlay();
        if (String(url || '').includes('#avatool-login-complete-')) {
          tryComplete().catch(() => {});
          return;
        }
        tryComplete().catch(() => {});
      });
      loginWindow.webContents.on('did-navigate-in-page', (_event, url) => {
        injectLoginCompleteOverlay();
        if (String(url || '').includes('#avatool-login-complete-')) {
          tryComplete().catch(() => {});
          return;
        }
        tryComplete().catch(() => {});
      });
      loginWindow.webContents.on('page-title-updated', (_event, title) => {
        if (String(title || '').includes('avatool-login-complete-')) {
          tryComplete().catch(() => {});
        }
      });
      loginWindow.on('closed', () => {
        if (!settled) finish({ ok: false, error: 'login_cancelled' });
      });

      loginWindow.loadURL('https://accounts.booth.pm/orders').catch(() => {
        finish({ ok: false, error: 'login_window_load_failed' });
      });
    });
    return await loginFlowPromise;
  }

  return {
    openLoginWindowFlow,
    getLoginWindow: () => loginWindow,
    setLoginWindow: (v) => { loginWindow = v; },
    _test: {
      syncCookiesFromRows: syncBoothCookies,
    },
  };
}

module.exports = { createLoginWindow };
