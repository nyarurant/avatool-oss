function ensureWindowsStartupRegistration({ app, processObj, logger = console }) {
  if (processObj.platform !== 'win32') return;
  if (!app.isPackaged) return;
  try {
    const loginItem = {
      openAtLogin: true,
      path: processObj.execPath,
      args: [],
    };
    app.setLoginItemSettings(loginItem);
    const current = app.getLoginItemSettings({
      path: processObj.execPath,
      args: [],
    });
    if (!current?.openAtLogin) {
      logger.warn('Failed to enable startup registration for this app.');
    }
  } catch (e) {
    logger.warn('Failed to configure startup registration:', e?.message || e);
  }
}

function setupSingleInstanceLock({ app, processObj, getMainWindow }) {
  if (!app.isPackaged) return;
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    try {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed?.()) return;
      if (mainWindow.isMinimized?.()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } catch {
      // ignore focus/restore failures
    }
  });
}

async function runBoothSmokeTest({
  app,
  appDataRoot,
  path,
  axios,
  readBoothCookiesFromFile,
}) {
  let exitCode = 0;
  const results = [];
  function check(name, ok, detail) {
    const mark = ok ? 'OK' : 'FAIL';
    results.push(`  ${name} ... ${mark}${detail ? ': ' + detail : ''}`);
    if (!ok) exitCode = 1;
  }
  try {
    let cookies = null;
    try {
      cookies = readBoothCookiesFromFile(path.join(appDataRoot, 'booth.pm.json'));
      check('Cookie file decrypt', Array.isArray(cookies) && cookies.length > 0, `${(cookies || []).length} cookies`);
    } catch (e) {
      check('Cookie file decrypt', false, e?.message || String(e));
    }
    if (cookies && cookies.length > 0) {
      try {
        const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        const client = axios.create({
          baseURL: 'https://booth.pm',
          headers: { Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000,
        });
        const res = await client.get('/library', { responseType: 'text' });
        const loggedIn = res.status === 200 && !String(res.data || '').includes('accounts.booth.pm/login');
        check('Booth library API', loggedIn, `status ${res.status}${loggedIn ? '' : ' (not logged in?)'}`);
      } catch (e) {
        check('Booth library API', false, e?.message || String(e));
      }
    } else {
      check('Booth library API', false, 'skipped (no cookies)');
      exitCode = 1;
    }
  } catch (e) {
    results.push(`  unexpected error: ${e?.message || String(e)}`);
    exitCode = 1;
  }
  console.log('\n=== smoke-test (Booth) ===');
  for (const r of results) console.log(r);
  console.log('=========================\n');
  app.exit(exitCode);
}

module.exports = {
  ensureWindowsStartupRegistration,
  setupSingleInstanceLock,
  runBoothSmokeTest,
};
