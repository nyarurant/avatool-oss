'use strict';

const { createBoothSessionManager } = require('../lib/booth_session_manager');

// ---------------------------------------------------------------------------
// テスト用 deps ファクトリ
// ---------------------------------------------------------------------------

function makeDeps(overrides = {}) {
  return {
    axios: { get: jest.fn() },
    writeBoothCookiesToFile: jest.fn().mockReturnValue({ encrypted: true }),
    defaultCookieFilePath: '/test/booth.pm.json',
    tempCookiePath: '/test/tempcookie.json',
    getBoothClient: jest.fn().mockReturnValue(null),
    setBoothClient: jest.fn(),
    getBoothCookies: jest.fn().mockReturnValue(null),
    setBoothCookies: jest.fn(),
    ...overrides,
  };
}

const VALID_COOKIE = {
  name: '_session_id',
  value: 'abc123',
  domain: 'accounts.booth.pm',
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'None',
  expirationDate: 9999999999,
};

const VALID_COOKIE_PM = { ...VALID_COOKIE, domain: 'booth.pm' };

// ---------------------------------------------------------------------------
// normalizeBoothCookies
// ---------------------------------------------------------------------------

describe('normalizeBoothCookies', () => {
  const { normalizeBoothCookies } = createBoothSessionManager(makeDeps());

  test('booth.pm ドメインの Cookie のみ残る', () => {
    const cookies = [
      VALID_COOKIE,
      { name: 'other', value: 'x', domain: 'google.com' },
    ];
    expect(normalizeBoothCookies(cookies)).toHaveLength(1);
  });

  test('サブドメイン (accounts.booth.pm) も通過する', () => {
    expect(normalizeBoothCookies([VALID_COOKIE])).toHaveLength(1);
  });

  test('.booth.pm ドット付きドメインも通過する', () => {
    const cookie = { ...VALID_COOKIE, domain: '.booth.pm' };
    expect(normalizeBoothCookies([cookie])).toHaveLength(1);
  });

  test('name または value が空の Cookie は除外される', () => {
    const noName = { ...VALID_COOKIE, name: '' };
    const noValue = { ...VALID_COOKIE, value: '' };
    expect(normalizeBoothCookies([noName])).toHaveLength(0);
    expect(normalizeBoothCookies([noValue])).toHaveLength(0);
  });

  test('出力フィールドが正規化される', () => {
    const [result] = normalizeBoothCookies([VALID_COOKIE]);
    expect(result.name).toBe('_session_id');
    expect(result.value).toBe('abc123');
    expect(result.secure).toBe(true);
    expect(result.httpOnly).toBe(true);
    expect(result.path).toBe('/');
    expect(typeof result.domain).toBe('string');
  });

  test('expirationDate が有限数でなければ undefined になる', () => {
    const cookie = { ...VALID_COOKIE, expirationDate: 'bad' };
    const [result] = normalizeBoothCookies([cookie]);
    expect(result.expirationDate).toBeUndefined();
  });

  test('空配列は空配列を返す', () => {
    expect(normalizeBoothCookies([])).toEqual([]);
  });

  test('null / 非配列は空配列を返す', () => {
    expect(normalizeBoothCookies(null)).toEqual([]);
    expect(normalizeBoothCookies('string')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isBoothDomain
// ---------------------------------------------------------------------------

describe('isBoothDomain', () => {
  const { isBoothDomain } = createBoothSessionManager(makeDeps());

  test.each([
    'booth.pm',
    '.booth.pm',
    'accounts.booth.pm',
    '.accounts.booth.pm',
  ])('"%s" は booth ドメイン', (domain) => {
    expect(isBoothDomain(domain)).toBe(true);
  });

  test.each([
    'google.com',
    'fakebooth.pm',
    'booth.pm.evil.com',
    '',
  ])('"%s" は booth ドメインではない', (domain) => {
    expect(isBoothDomain(domain)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cookieUrlFromRecord
// ---------------------------------------------------------------------------

describe('cookieUrlFromRecord', () => {
  const { cookieUrlFromRecord } = createBoothSessionManager(makeDeps());

  test('secure=true なら https:// を返す', () => {
    const url = cookieUrlFromRecord({ domain: 'booth.pm', path: '/', secure: true });
    expect(url).toBe('https://booth.pm/');
  });

  test('secure=false なら http:// を返す', () => {
    const url = cookieUrlFromRecord({ domain: 'booth.pm', path: '/', secure: false });
    expect(url).toBe('http://booth.pm/');
  });

  test('ドメイン先頭のドットを除去する', () => {
    const url = cookieUrlFromRecord({ domain: '.booth.pm', path: '/', secure: true });
    expect(url).toBe('https://booth.pm/');
  });

  test('path が / で始まらない場合も補完される', () => {
    const url = cookieUrlFromRecord({ domain: 'booth.pm', path: 'foo', secure: true });
    expect(url).toBe('https://booth.pm/foo');
  });

  test('domain が空なら null を返す', () => {
    expect(cookieUrlFromRecord({ domain: '', path: '/' })).toBeNull();
    expect(cookieUrlFromRecord(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildCookieHeader
// ---------------------------------------------------------------------------

describe('buildCookieHeader', () => {
  const { buildCookieHeader } = createBoothSessionManager(makeDeps());

  test('name=value 形式の文字列を返す', () => {
    const header = buildCookieHeader([VALID_COOKIE_PM]);
    expect(header).toBe('_session_id=abc123');
  });

  test('複数 Cookie はセミコロンで連結される', () => {
    const c2 = { ...VALID_COOKIE_PM, name: 'token', value: 'xyz' };
    const header = buildCookieHeader([VALID_COOKIE_PM, c2]);
    expect(header).toContain('_session_id=abc123');
    expect(header).toContain('token=xyz');
    expect(header).toContain('; ');
  });

  test('booth.pm 以外の Cookie は除外される', () => {
    const foreign = { name: 'x', value: 'y', domain: 'google.com' };
    const header = buildCookieHeader([VALID_COOKIE_PM, foreign]);
    expect(header).not.toContain('x=y');
  });

  test('空配列は空文字を返す', () => {
    expect(buildCookieHeader([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// persistBoothCookies
// ---------------------------------------------------------------------------

describe('persistBoothCookies', () => {
  test('有効な Cookie があれば writeBoothCookiesToFile が呼ばれる', () => {
    const deps = makeDeps();
    const { persistBoothCookies } = createBoothSessionManager(deps);

    const result = persistBoothCookies([VALID_COOKIE_PM]);
    expect(deps.writeBoothCookiesToFile).toHaveBeenCalledWith(
      '/test/booth.pm.json',
      expect.any(Array),
    );
    expect(result.ok).toBe(true);
    expect(result.cookieCount).toBe(1);
  });

  test('booth.pm Cookie がなければ error を返す', () => {
    const deps = makeDeps();
    const { persistBoothCookies } = createBoothSessionManager(deps);

    const result = persistBoothCookies([{ name: 'x', value: 'y', domain: 'google.com' }]);
    expect(result.error).toBe('no_booth_cookies');
    expect(deps.writeBoothCookiesToFile).not.toHaveBeenCalled();
  });

  test('書き込みが成功したら setBoothClient(null) / setBoothCookies(null) を呼ぶ', () => {
    const deps = makeDeps();
    const { persistBoothCookies } = createBoothSessionManager(deps);

    persistBoothCookies([VALID_COOKIE_PM]);
    expect(deps.setBoothClient).toHaveBeenCalledWith(null);
    expect(deps.setBoothCookies).toHaveBeenCalledWith(null);
  });

  test('writeBoothCookiesToFile が例外を投げた場合 error を返す', () => {
    const deps = makeDeps({
      writeBoothCookiesToFile: jest.fn().mockImplementation(() => { throw new Error('disk full'); }),
    });
    const { persistBoothCookies } = createBoothSessionManager(deps);

    const result = persistBoothCookies([VALID_COOKIE_PM]);
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// persistTempBoothCookies
// ---------------------------------------------------------------------------

describe('persistTempBoothCookies', () => {
  test('tempCookiePath に書き込む', () => {
    const deps = makeDeps();
    const { persistTempBoothCookies } = createBoothSessionManager(deps);

    const result = persistTempBoothCookies([VALID_COOKIE_PM]);
    expect(deps.writeBoothCookiesToFile).toHaveBeenCalledWith(
      '/test/tempcookie.json',
      expect.any(Array),
    );
    expect(result.ok).toBe(true);
    expect(result.path).toBe('/test/tempcookie.json');
  });

  test('booth.pm Cookie がなければ error を返す', () => {
    const deps = makeDeps();
    const { persistTempBoothCookies } = createBoothSessionManager(deps);

    const result = persistTempBoothCookies([]);
    expect(result.error).toBe('no_booth_cookies');
  });
});

// ---------------------------------------------------------------------------
// validateBoothLogin (axios mock)
// ---------------------------------------------------------------------------

describe('validateBoothLogin', () => {
  test('200 OK なら { ok: true } を返す', async () => {
    const deps = makeDeps({
      axios: { get: jest.fn().mockResolvedValue({ status: 200, headers: {} }) },
    });
    const { validateBoothLogin } = createBoothSessionManager(deps);

    const result = await validateBoothLogin([VALID_COOKIE_PM]);
    expect(result.ok).toBe(true);
  });

  test('302 でログインページへのリダイレクトなら { ok: false, reason: "redirect_to_login" }', async () => {
    const deps = makeDeps({
      axios: { get: jest.fn().mockResolvedValue({ status: 302, headers: { location: '/sessions/new' } }) },
    });
    const { validateBoothLogin } = createBoothSessionManager(deps);

    const result = await validateBoothLogin([VALID_COOKIE_PM]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('redirect_to_login');
  });

  test('302 でログイン以外のリダイレクトなら redirect_302', async () => {
    const deps = makeDeps({
      axios: { get: jest.fn().mockResolvedValue({ status: 302, headers: { location: '/somewhere' } }) },
    });
    const { validateBoothLogin } = createBoothSessionManager(deps);

    const result = await validateBoothLogin([VALID_COOKIE_PM]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('redirect_302');
  });

  test('axios が例外を投げた場合 { ok: false } を返す', async () => {
    const deps = makeDeps({
      axios: { get: jest.fn().mockRejectedValue(new Error('network error')) },
    });
    const { validateBoothLogin } = createBoothSessionManager(deps);

    const result = await validateBoothLogin([VALID_COOKIE_PM]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('network error');
  });

  test('Cookie がなければ no_booth_cookies を返す', async () => {
    const deps = makeDeps();
    const { validateBoothLogin } = createBoothSessionManager(deps);

    const result = await validateBoothLogin([]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_booth_cookies');
  });
});
