function createBoothSessionManager(deps = {}) {
  const {
    axios,
    writeBoothCookiesToFile,
    defaultCookieFilePath,
    tempCookiePath,
    getBoothClient,
    setBoothClient,
    getBoothCookies,
    setBoothCookies,
  } = deps;

  function normalizeBoothCookies(cookies) {
    return (Array.isArray(cookies) ? cookies : [])
      .filter((c) => c && c.name && c.value && String(c.domain || '').includes('booth.pm'))
      .map((c) => ({
        name: String(c.name),
        value: String(c.value),
        domain: String(c.domain || ''),
        path: String(c.path || '/'),
        secure: Boolean(c.secure),
        httpOnly: Boolean(c.httpOnly),
        sameSite: c.sameSite || 'unspecified',
        expirationDate: Number.isFinite(Number(c.expirationDate)) ? Number(c.expirationDate) : undefined,
      }));
  }

  function persistBoothCookies(cookies) {
    const rows = normalizeBoothCookies(cookies);
    if (!rows.length) {
      return { error: 'no_booth_cookies' };
    }
    let saved;
    try {
      saved = writeBoothCookiesToFile(defaultCookieFilePath, rows);
    } catch (e) {
      return { error: e?.code || e?.message || String(e) };
    }
    setBoothClient?.(null);
    setBoothCookies?.(null);
    return { ok: true, cookieCount: rows.length, encrypted: Boolean(saved?.encrypted) };
  }

  function persistTempBoothCookies(cookies) {
    const rows = normalizeBoothCookies(cookies);
    if (!rows.length) return { error: 'no_booth_cookies' };
    let saved;
    try {
      saved = writeBoothCookiesToFile(tempCookiePath, rows);
    } catch (e) {
      return { error: e?.code || e?.message || String(e) };
    }
    return { ok: true, cookieCount: rows.length, path: tempCookiePath, encrypted: Boolean(saved?.encrypted) };
  }

  function cookieUrlFromRecord(cookie) {
    const secure = Boolean(cookie?.secure);
    const scheme = secure ? 'https://' : 'http://';
    const domain = String(cookie?.domain || '').replace(/^\./, '');
    const pathPart = String(cookie?.path || '/').startsWith('/') ? String(cookie?.path || '/') : `/${String(cookie?.path || '')}`;
    if (!domain) return null;
    return `${scheme}${domain}${pathPart}`;
  }

  function buildCookieHeader(cookies) {
    return normalizeBoothCookies(cookies)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  function isBoothDomain(domain) {
    const d = String(domain || '').replace(/^\./, '').toLowerCase();
    return d === 'booth.pm' || d.endsWith('.booth.pm');
  }

  async function validateBoothLogin(cookies) {
    const cookieHeader = buildCookieHeader(cookies);
    if (!cookieHeader) return { ok: false, reason: 'no_booth_cookies' };
    try {
      const res = await axios.get('https://accounts.booth.pm/library', {
        maxRedirects: 0,
        timeout: 15000,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Referer: 'https://accounts.booth.pm/library',
          Origin: 'https://booth.pm',
          Cookie: cookieHeader,
        },
      });
      if (res.status >= 300) {
        const loc = String(res.headers?.location || '');
        if (/sessions\/new/i.test(loc)) return { ok: false, reason: 'redirect_to_login' };
        return { ok: false, reason: `redirect_${res.status}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e?.message || 'probe_failed' };
    }
  }

  async function probeBoothLibrary(cookies) {
    const cookieHeader = buildCookieHeader(cookies);
    if (!cookieHeader) return { ok: false, reason: 'no_booth_cookies' };
    try {
      const res = await axios.get('https://accounts.booth.pm/library', {
        timeout: 15000,
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Referer: 'https://accounts.booth.pm/library',
          Origin: 'https://booth.pm',
          Cookie: cookieHeader,
        },
      });
      if (res.status >= 300) {
        const loc = String(res.headers?.location || '');
        if (/sessions\/new/i.test(loc)) return { ok: false, reason: 'redirect_to_login' };
        return { ok: false, reason: `redirect_${res.status}` };
      }
      const html = String(res.data || '');
      const itemCount = (html.match(/l-library-item-thumbnail/g) || []).length;
      return { ok: true, itemCount };
    } catch (e) {
      return { ok: false, reason: e?.message || 'library_probe_failed' };
    }
  }

  return {
    normalizeBoothCookies,
    persistBoothCookies,
    persistTempBoothCookies,
    cookieUrlFromRecord,
    buildCookieHeader,
    isBoothDomain,
    validateBoothLogin,
    probeBoothLibrary,
    getBoothClient,
    getBoothCookies,
  };
}

module.exports = { createBoothSessionManager };
