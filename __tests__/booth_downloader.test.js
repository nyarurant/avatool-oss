'use strict';

const {
  downloadItemFiles,
  setDataRoot,
  _test: {
    crc32,
    isValidUtf8RoundTrip,
    hasUnicodePathExtraField,
    scoreDecodedName,
    hasUnsafeArchivePathSegments,
    sanitizeDownloadName,
    formatUpdateTimestamp,
    buildPartialDownloadPath,
  },
} = require('../lib/booth_downloader');
const axios = require('axios');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ''), 'utf8');
    const crc = crc32(dataBuf);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDir, end]);
}

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'avatool-downloader-test-'));
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function withFakeBoothServer(routes, fn) {
  let baseURL = '';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const handler = routes[url.pathname];
    if (!handler) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    handler(req, res, url, baseURL);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseURL, axios.create({ baseURL, timeout: 3000 }));
  } finally {
    await closeServer(server);
  }
}

// ---------------------------------------------------------------------------
// crc32
// ---------------------------------------------------------------------------

describe('crc32', () => {
  test('空バッファは 0 を返す', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  test('既知の CRC32 値と一致する', () => {
    // "123456789" の CRC32 = 0xCBF43926
    const buf = Buffer.from('123456789', 'ascii');
    expect(crc32(buf)).toBe(0xCBF43926);
  });

  test('同じバッファは常に同じ値を返す', () => {
    const buf = Buffer.from('hello world', 'utf8');
    expect(crc32(buf)).toBe(crc32(buf));
  });

  test('異なるバッファは異なる値を返す（ほぼ確実）', () => {
    const a = Buffer.from('aaa', 'utf8');
    const b = Buffer.from('bbb', 'utf8');
    expect(crc32(a)).not.toBe(crc32(b));
  });
});

// ---------------------------------------------------------------------------
// isValidUtf8RoundTrip
// ---------------------------------------------------------------------------

describe('isValidUtf8RoundTrip', () => {
  test('正常な UTF-8 バイト列は true', () => {
    expect(isValidUtf8RoundTrip(Buffer.from('hello.zip', 'utf8'))).toBe(true);
    expect(isValidUtf8RoundTrip(Buffer.from('ファイル.zip', 'utf8'))).toBe(true);
  });

  test('CP932 バイト列は通常 false（UTF-8 としてラウンドトリップしない）', () => {
    // CP932 で "テスト" をエンコードしたバイト列は UTF-8 として無効
    const cp932Buf = Buffer.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67]); // "テスト" in CP932
    expect(isValidUtf8RoundTrip(cp932Buf)).toBe(false);
  });

  test('UTF-8 の置換文字 U+FFFD が含まれると false', () => {
    const buf = Buffer.from('\uFFFD', 'utf8'); // EF BF BD
    // ラウンドトリップ自体は成立するが、\uFFFD が含まれているので false
    expect(isValidUtf8RoundTrip(buf)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasUnicodePathExtraField
// ---------------------------------------------------------------------------

describe('hasUnicodePathExtraField', () => {
  const ZIP_UNICODE_PATH_EXTRA_FIELD_ID = 0x7075;

  function makeExtraField(rawNameBuf, validCrc = true) {
    const crcVal = validCrc ? crc32(rawNameBuf) : 0xDEADBEEF;
    const data = Buffer.alloc(9);
    data.writeUInt8(1, 0); // version = 1
    data.writeUInt32LE(crcVal, 1); // CRC32
    // 残り4バイトはUnicode name (最小限)
    return [{ id: ZIP_UNICODE_PATH_EXTRA_FIELD_ID, data }];
  }

  test('正しい Unicode path extra field があれば true', () => {
    const rawNameBuf = Buffer.from('test.zip', 'utf8');
    const entry = { extraFields: makeExtraField(rawNameBuf) };
    expect(hasUnicodePathExtraField(entry, rawNameBuf)).toBe(true);
  });

  test('CRC が一致しなければ false', () => {
    const rawNameBuf = Buffer.from('test.zip', 'utf8');
    const entry = { extraFields: makeExtraField(rawNameBuf, false) };
    expect(hasUnicodePathExtraField(entry, rawNameBuf)).toBe(false);
  });

  test('extraFields が空なら false', () => {
    const rawNameBuf = Buffer.from('test.zip', 'utf8');
    expect(hasUnicodePathExtraField({ extraFields: [] }, rawNameBuf)).toBe(false);
  });

  test('extraFields がなければ false', () => {
    const rawNameBuf = Buffer.from('test.zip', 'utf8');
    expect(hasUnicodePathExtraField({}, rawNameBuf)).toBe(false);
  });

  test('data が短すぎる (< 6バイト) と false', () => {
    const rawNameBuf = Buffer.from('a.zip', 'utf8');
    const shortData = Buffer.alloc(4);
    const entry = { extraFields: [{ id: ZIP_UNICODE_PATH_EXTRA_FIELD_ID, data: shortData }] };
    expect(hasUnicodePathExtraField(entry, rawNameBuf)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scoreDecodedName
// ---------------------------------------------------------------------------

describe('scoreDecodedName', () => {
  test('純 ASCII ファイル名は高スコア', () => {
    expect(scoreDecodedName('hello_world.zip')).toBeGreaterThan(0);
  });

  test('日本語を含むファイル名もスコアを得る', () => {
    expect(scoreDecodedName('アバター衣装.zip')).toBeGreaterThan(-100);
  });

  test('置換文字 U+FFFD が多いと大幅マイナス', () => {
    const garbage = '\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD';
    expect(scoreDecodedName(garbage)).toBeLessThan(-100);
  });

  test('罫線文字が多いとマイナス', () => {
    const boxChars = '─━│┃┄'.repeat(5);
    expect(scoreDecodedName(boxChars)).toBeLessThan(0);
  });

  test('制御文字が含まれるとマイナス', () => {
    expect(scoreDecodedName('hello\x00world')).toBeLessThan(0);
  });

  test('ÃÂ などの文字化けパターンはマイナス', () => {
    const mojibake = 'Ã\u00a3\u00c3\u00a1.zip';
    const normal = 'normal.zip';
    expect(scoreDecodedName(normal)).toBeGreaterThan(scoreDecodedName(mojibake));
  });

  test('空文字は -1000 を返す', () => {
    expect(scoreDecodedName('')).toBe(-1000);
    expect(scoreDecodedName(null)).toBe(-1000);
  });
});

// ---------------------------------------------------------------------------
// hasUnsafeArchivePathSegments
// ---------------------------------------------------------------------------

describe('hasUnsafeArchivePathSegments', () => {
  test('正常なパスは false', () => {
    expect(hasUnsafeArchivePathSegments('files/readme.txt')).toBe(false);
    expect(hasUnsafeArchivePathSegments('a/b/c.zip')).toBe(false);
    expect(hasUnsafeArchivePathSegments('ファイル/テスト.txt')).toBe(false);
  });

  test('空セグメント (先頭スラッシュ) は true', () => {
    expect(hasUnsafeArchivePathSegments('/etc/passwd')).toBe(true);
  });

  test('.. は true', () => {
    expect(hasUnsafeArchivePathSegments('../etc/passwd')).toBe(true);
    expect(hasUnsafeArchivePathSegments('a/../../secret')).toBe(true);
  });

  test('. のみのセグメントは true', () => {
    expect(hasUnsafeArchivePathSegments('./file.txt')).toBe(true);
  });

  test('制御文字が含まれると true', () => {
    expect(hasUnsafeArchivePathSegments('a/b\x00c')).toBe(true);
    expect(hasUnsafeArchivePathSegments('a/b\x1Fc')).toBe(true);
  });

  test('コロンを含むセグメントは true (ADS / ドライブ対策)', () => {
    expect(hasUnsafeArchivePathSegments('C:/Windows/System32')).toBe(true);
    expect(hasUnsafeArchivePathSegments('a/file:stream')).toBe(true);
  });

  test('Windows 予約名は true', () => {
    expect(hasUnsafeArchivePathSegments('CON')).toBe(true);
    expect(hasUnsafeArchivePathSegments('NUL')).toBe(true);
    expect(hasUnsafeArchivePathSegments('COM1')).toBe(true);
    expect(hasUnsafeArchivePathSegments('LPT9')).toBe(true);
    expect(hasUnsafeArchivePathSegments('con.txt')).toBe(true); // 拡張子付きも
  });

  test('大文字小文字を区別しない', () => {
    expect(hasUnsafeArchivePathSegments('nul')).toBe(true);
    expect(hasUnsafeArchivePathSegments('Con')).toBe(true);
  });

  test('ドット・空白のみのセグメントは true', () => {
    // セグメント全体がドット/空白のみなら trimmed が空 → true
    expect(hasUnsafeArchivePathSegments('a/...')).toBe(true);
    expect(hasUnsafeArchivePathSegments('a/   ')).toBe(true);
  });

  test('通常の末尾ドット (b.) は false（trimmed = b として通過）', () => {
    expect(hasUnsafeArchivePathSegments('a/b.')).toBe(false);
  });

  test('空文字・null は true', () => {
    expect(hasUnsafeArchivePathSegments('')).toBe(true);
    expect(hasUnsafeArchivePathSegments(null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sanitizeDownloadName
// ---------------------------------------------------------------------------

describe('sanitizeDownloadName', () => {
  test('通常のファイル名はそのまま', () => {
    expect(sanitizeDownloadName('readme.txt', 0)).toBe('readme.txt');
    expect(sanitizeDownloadName('ここな衣装.zip', 0)).toBe('ここな衣装.zip');
  });

  test('パス区切り文字はベース名のみ取る', () => {
    expect(sanitizeDownloadName('dir/sub/file.zip', 0)).toBe('file.zip');
    expect(sanitizeDownloadName('C:\\Windows\\file.zip', 0)).toBe('file.zip');
  });

  test('Windows 禁止文字は _ に置換される', () => {
    const result = sanitizeDownloadName('file:name?.zip', 0);
    expect(result).not.toMatch(/[\\/:*?"<>|]/);
  });

  test('制御文字は _ に置換される', () => {
    const result = sanitizeDownloadName('file\x00name.zip', 0);
    expect(result).not.toMatch(/[\x00-\x1F]/);
  });

  test('末尾のドット・スペースは除去される', () => {
    expect(sanitizeDownloadName('file.', 0)).toBe('file');
    expect(sanitizeDownloadName('file   ', 0)).toBe('file');
  });

  test('空文字は fallback 名を返す', () => {
    expect(sanitizeDownloadName('', 3)).toBe('file_3');
    expect(sanitizeDownloadName('   ', 7)).toBe('file_7');
  });

  test('null は fallback 名を返す', () => {
    expect(sanitizeDownloadName(null, 0)).toBe('file_0');
  });
});

// ---------------------------------------------------------------------------
// formatUpdateTimestamp
// ---------------------------------------------------------------------------

describe('formatUpdateTimestamp', () => {
  test('YYYYMMdd_HHmmss 形式で返す', () => {
    const d = new Date(2026, 0, 25, 6, 14, 54); // 2026-01-25 06:14:54 local
    const result = formatUpdateTimestamp(d);
    expect(result).toMatch(/^\d{8}_\d{6}$/);
    expect(result.startsWith('20260125')).toBe(true);
  });

  test('月・日・時・分・秒は2桁ゼロ埋め', () => {
    const d = new Date(2026, 0, 5, 3, 7, 9); // 2026-01-05 03:07:09
    const result = formatUpdateTimestamp(d);
    expect(result).toBe('20260105_030709');
  });

  test('引数なし (デフォルト new Date()) でも動作する', () => {
    expect(formatUpdateTimestamp()).toMatch(/^\d{8}_\d{6}$/);
  });
});

describe('downloadItemFiles real downloader scenarios', () => {
  afterEach(() => {
    setDataRoot('');
  });

  test('empty file list fails before creating an item folder', async () => {
    const tempRoot = makeTempRoot();
    setDataRoot(tempRoot);
    const progress = [];

    await expect(downloadItemFiles({
      itemId: '900',
      title: 'Wishlist Only',
      files: [],
    }, axios.create(), [], (row) => progress.push(row))).rejects.toThrow('no_download_files');

    expect(fs.existsSync(path.join(tempRoot, 'downloads', '900_Wishlist Only'))).toBe(false);
    expect(progress.some((row) => row?.status === 'noFiles')).toBe(true);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('invalid file entries fail before creating an item folder', async () => {
    const tempRoot = makeTempRoot();
    setDataRoot(tempRoot);

    await expect(downloadItemFiles({
      itemId: '901',
      title: 'Invalid Files',
      files: [{ fileName: 'missing-id.zip' }],
    }, axios.create(), [], () => {})).rejects.toThrow('no_download_files');

    expect(fs.existsSync(path.join(tempRoot, 'downloads', '901_Invalid Files'))).toBe(false);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('successful fake HTTP download writes final zip, extracts it, and removes partial file', async () => {
    const tempRoot = makeTempRoot();
    setDataRoot(tempRoot);
    const zip = makeStoredZip([{ name: 'Assets/Probe/readme.txt', data: 'hello probe' }]);
    const progress = [];

    await withFakeBoothServer({
      '/downloadables/1': (_req, res, _url, baseURL) => {
        res.writeHead(302, { Location: `${baseURL}/files/probe.zip` });
        res.end();
      },
      '/files/probe.zip': (_req, res) => {
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': String(zip.length),
        });
        res.end(zip);
      },
    }, async (_baseURL, client) => {
      await downloadItemFiles({
        itemId: '100',
        title: 'Probe Item',
        files: [{ downloadableId: '1', fileName: 'probe.zip' }],
      }, client, [], (row) => progress.push(row));
    });

    const itemDir = path.join(tempRoot, 'downloads', '100_Probe Item');
    const zipPath = path.join(itemDir, 'probe.zip');
    expect(fs.existsSync(zipPath)).toBe(true);
    expect(fs.existsSync(buildPartialDownloadPath(zipPath))).toBe(false);
    expect(fs.existsSync(path.join(itemDir, '__extracted', '__extracted.flag'))).toBe(true);
    expect(fs.existsSync(path.join(itemDir, '__extracted', 'probe', 'Assets', 'Probe', 'readme.txt'))).toBe(true);
    expect(progress.some((row) => row?.phase === 'done')).toBe(true);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('interrupted fake HTTP download leaves no final or partial file after retries fail', async () => {
    const tempRoot = makeTempRoot();
    setDataRoot(tempRoot);

    await expect(withFakeBoothServer({
      '/downloadables/2': (_req, res, _url, baseURL) => {
        res.writeHead(302, { Location: `${baseURL}/files/interrupted.zip` });
        res.end();
      },
      '/files/interrupted.zip': (_req, res) => {
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': '1000',
        });
        res.write(Buffer.from('partial zip bytes'));
        res.destroy();
      },
    }, async (_baseURL, client) => {
      await downloadItemFiles({
        itemId: '200',
        title: 'Interrupted Item',
        files: [{ downloadableId: '2', fileName: 'interrupted.zip' }],
      }, client, [], () => {});
    })).rejects.toThrow();

    const zipPath = path.join(tempRoot, 'downloads', '200_Interrupted Item', 'interrupted.zip');
    expect(fs.existsSync(zipPath)).toBe(false);
    expect(fs.existsSync(buildPartialDownloadPath(zipPath))).toBe(false);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }, 15000);

  test('existing corrupt zip is not skipped and is redownloaded through the real path', async () => {
    const tempRoot = makeTempRoot();
    setDataRoot(tempRoot);
    const itemDir = path.join(tempRoot, 'downloads', '300_Corrupt Existing');
    fs.mkdirSync(itemDir, { recursive: true });
    const zipPath = path.join(itemDir, 'existing.zip');
    fs.writeFileSync(zipPath, 'not a zip', 'utf8');

    const zip = makeStoredZip([{ name: 'Assets/Probe/fixed.txt', data: 'fixed' }]);
    const progress = [];

    await withFakeBoothServer({
      '/downloadables/3': (_req, res, _url, baseURL) => {
        res.writeHead(302, { Location: `${baseURL}/files/existing.zip` });
        res.end();
      },
      '/files/existing.zip': (_req, res) => {
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': String(zip.length),
        });
        res.end(zip);
      },
    }, async (_baseURL, client) => {
      await downloadItemFiles({
        itemId: '300',
        title: 'Corrupt Existing',
        files: [{ downloadableId: '3', fileName: 'existing.zip' }],
      }, client, [], (row) => progress.push(row));
    });

    expect(fs.readFileSync(zipPath).equals(zip)).toBe(true);
    expect(progress.some((row) => row?.status === 'redownloadCorrupt')).toBe(true);
    expect(fs.existsSync(path.join(itemDir, '__extracted', '__extracted.flag'))).toBe(true);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
