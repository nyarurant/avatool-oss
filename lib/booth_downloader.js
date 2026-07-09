const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const axios = require('axios');
const yauzl = require('yauzl');
const iconv = require('iconv-lite');
const { readBoothCookiesFromFile } = require('./booth_cookie_store');
const { normalizeZipMaxEntryBytes, safeResolveUnder } = require('../lib/utils');

const { path7za } = require('7zip-bin');
const ARCHIVE_EXTS_7Z = new Set(['.rar', '.7z', '.tar', '.tar.gz', '.tgz', '.tar.bz2', '.gz', '.bz2']);

function extractWith7Zip(sevenZipExe, archivePath, targetDir, password = null) {
  const args = ['x', archivePath, `-o${targetDir}`, '-y'];
  if (password) args.push(`-p${password}`);
  return new Promise((resolve, reject) => {
    execFile(sevenZipExe, args, { timeout: 300000 }, (err, _stdout, stderr) => {
      if (err) {
        const detail = [stderr?.trim(), err.message].filter(Boolean).join(' | ');
        const e = new Error(detail || 'unknown_7zip_error');
        if (detail.toLowerCase().includes('wrong password') || detail.toLowerCase().includes('enter password')) {
          e.code = 'PASSWORD_REQUIRED';
          e.archivePath = archivePath;
        }
        reject(e);
      } else resolve();
    });
  });
}
const RETRY_DELAYS_MS = [500, 1500, 3000];
const HTTP_TIMEOUT_MS = 120000;
let dataRootOverride = '';
const DEFAULT_MAX_ZIP_ENTRY_BYTES = 512 * 1024 * 1024; // 512 MiB
let maxZipEntryBytes = DEFAULT_MAX_ZIP_ENTRY_BYTES;
let zipOversizeHook = null;

function setDataRoot(dataRoot) {
  const next = String(dataRoot || '').trim();
  dataRootOverride = next || '';
}

function setZipSafetyConfig(config = {}) {
  const next = config && Object.prototype.hasOwnProperty.call(config, 'maxZipEntryBytes')
    ? config.maxZipEntryBytes
    : undefined;
  if (next === undefined) return;
  maxZipEntryBytes = normalizeZipMaxEntryBytes(next);
}

let archivePasswordHook = null;

function setZipSafetyHooks(hooks = {}) {
  zipOversizeHook = typeof hooks?.onOversizeEntry === 'function' ? hooks.onOversizeEntry : null;
  archivePasswordHook = typeof hooks?.onArchivePassword === 'function' ? hooks.onArchivePassword : null;
}

function getDataRoot() {
  if (dataRootOverride) return dataRootOverride;
  const fromEnv = String(process.env.AVATOOL_DATA_DIR || '').trim();
  if (fromEnv) return fromEnv;
  return __dirname;
}

async function createClientAndCookies(cookieRows = null) {
  const cookies = Array.isArray(cookieRows)
    ? cookieRows
    : readBoothCookiesFromFile(path.join(getDataRoot(), 'booth.pm.json'));
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  const client = axios.create({
    baseURL: 'https://booth.pm',
    timeout: HTTP_TIMEOUT_MS,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://accounts.booth.pm/library',
      'Origin': 'https://booth.pm',
      'Cookie': cookieHeader,
    },
  });

  return { client, cookies };
}

const WINDOWS_RESERVED_BASENAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const ZIP_UTF8_FLAG = 0x800;
const ZIP_UNICODE_PATH_EXTRA_FIELD_ID = 0x7075;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC32_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function normalizeZipEntryName(rawName) {
  if (Buffer.isBuffer(rawName)) return rawName;
  return Buffer.from(String(rawName || ''), 'binary');
}

function hasUnicodePathExtraField(entry, rawNameBuf) {
  const fields = Array.isArray(entry?.extraFields) ? entry.extraFields : [];
  for (const f of fields) {
    if (!f || Number(f.id) !== ZIP_UNICODE_PATH_EXTRA_FIELD_ID) continue;
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.alloc(0);
    if (data.length < 6) continue;
    if (data.readUInt8(0) !== 1) continue;
    const oldNameCrc32 = data.readUInt32LE(1) >>> 0;
    if (oldNameCrc32 !== crc32(rawNameBuf)) continue;
    return true;
  }
  return false;
}

function isValidUtf8RoundTrip(rawNameBuf) {
  const decoded = rawNameBuf.toString('utf8');
  if (decoded.includes('\uFFFD')) return false;
  return Buffer.from(decoded, 'utf8').equals(rawNameBuf);
}

function scoreDecodedName(name) {
  const s = String(name || '');
  if (!s) return -1000;
  let score = 0;
  if (/^[\x20-\x7E]+$/.test(s)) score += 30;
  const jpCount = (s.match(/[\u3040-\u30FF\u4E00-\u9FFF]/g) || []).length;
  const asciiCount = (s.match(/[A-Za-z0-9 _.\-()[\]{}]/g) || []).length;
  const boxCount = (s.match(/[\u2500-\u259F]/g) || []).length;
  const replacementCount = (s.match(/\uFFFD/g) || []).length;
  score += Math.min(jpCount, 24) * 2;
  score += Math.min(asciiCount, 40);
  score -= boxCount * 6;
  score -= replacementCount * 200;
  if (/[\0-\x1F\x7F]/.test(s)) score -= 200;
  if (/[ÃÂâãï]/.test(s)) score -= 20;
  return score;
}

function decodeZipEntryName(entry) {
  const rawNameBuf = normalizeZipEntryName(entry?.fileNameRaw || entry?.fileName);
  const generalPurposeBitFlag = Number(entry?.generalPurposeBitFlag || 0);
  const hasUtf8Flag = (generalPurposeBitFlag & ZIP_UTF8_FLAG) !== 0;
  const hasUnicodeExtra = hasUnicodePathExtraField(entry, rawNameBuf);
  const validUtf8 = isValidUtf8RoundTrip(rawNameBuf);
  const cp932Name = iconv.decode(rawNameBuf, 'cp932');
  const utf8Name = rawNameBuf.toString('utf8');

  // Spec-compliant decoding (UTF-8 flag / Unicode path extra / CP437).
  let specName = '';
  try {
    specName = yauzl.getFileNameLowLevel(
      generalPurposeBitFlag,
      rawNameBuf,
      Array.isArray(entry?.extraFields) ? entry.extraFields : [],
      false,
    );
  } catch {
    specName = utf8Name;
  }

  const candidates = [];
  const addCandidate = (label, value, baseScore) => {
    if (!value) return;
    candidates.push({
      label,
      value,
      score: baseScore + scoreDecodedName(value),
    });
  };

  addCandidate('spec', specName, hasUtf8Flag || hasUnicodeExtra ? 500 : 40);
  addCandidate('cp932', cp932Name, hasUtf8Flag || hasUnicodeExtra ? -20 : 45);
  if (validUtf8) addCandidate('utf8', utf8Name, hasUtf8Flag ? 300 : 80);

  if (!candidates.length) return utf8Name || cp932Name || '';
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].value;
}

function hasUnsafeArchivePathSegments(relPath) {
  const segs = String(relPath || '').split('/');
  for (const raw of segs) {
    if (!raw || raw === '.' || raw === '..') return true;
    if (/[\0-\x1F\x7F]/.test(raw)) return true;
    if (raw.includes(':')) return true; // block ADS and drive-like segments
    const trimmed = raw.replace(/[. ]+$/g, '');
    if (!trimmed) return true;
    if (WINDOWS_RESERVED_BASENAME_RE.test(trimmed)) return true;
  }
  return false;
}

function sanitizeDownloadName(name, fallbackIndex) {
  let fileName = path.basename(String(name || ''));
  fileName = fileName
    .replace(/[\0-\x1F\x7F]/g, '_')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!fileName) fileName = `file_${fallbackIndex}`;
  return fileName;
}

function formatUpdateTimestamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}_${hh}${mm}${ss}`;
}

function moveDirWithParents(srcDir, dstDir) {
  const src = String(srcDir || '').trim();
  const dst = String(dstDir || '').trim();
  if (!src || !dst) throw new Error('invalid_move_dir_path');
  const parent = path.dirname(dst);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  fs.renameSync(src, dst);
}

function renameBackupZipFiles(backupDir, itemId, title, timestamp) {
  if (!backupDir || !fs.existsSync(backupDir)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(backupDir, { withFileTypes: true });
  } catch {
    return;
  }
  const itemPrefix = sanitizeDownloadName(`${itemId}_${title}`, 0).replace(/\.zip$/i, '');
  for (const ent of entries) {
    if (!ent?.isFile?.()) continue;
    const srcName = String(ent.name || '');
    if (!srcName.toLowerCase().endsWith('.zip')) continue;
    const srcPath = path.join(backupDir, srcName);
    const base = path.basename(srcName, '.zip');
    let nextName = sanitizeDownloadName(`${itemPrefix}_${base}_preupdate_${timestamp}.zip`, 0);
    if (!nextName.toLowerCase().endsWith('.zip')) nextName += '.zip';
    let n = 1;
    while (fs.existsSync(path.join(backupDir, nextName))) {
      nextName = sanitizeDownloadName(`${itemPrefix}_${base}_preupdate_${timestamp}_${n}.zip`, 0);
      if (!nextName.toLowerCase().endsWith('.zip')) nextName += '.zip';
      n += 1;
    }
    try {
      fs.renameSync(srcPath, path.join(backupDir, nextName));
    } catch {
      // keep original name when rename fails
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function removeFileQuietly(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  } catch {
    // ignore cleanup failures
  }
}

function buildPartialDownloadPath(filepath) {
  const dir = path.dirname(filepath);
  const base = path.basename(filepath);
  return path.join(dir, `.${base}.part`);
}

function isReadableZipFile(zipPath) {
  return new Promise((resolve) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) {
        resolve(false);
        return;
      }
      zipFile.on('error', () => resolve(false));
      zipFile.close();
      resolve(true);
    });
  });
}

async function isExistingDownloadReusable(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const lower = String(filePath || '').toLowerCase();
  if (!lower.endsWith('.zip')) return true;
  return await isReadableZipFile(filePath);
}

async function withRetry(task, onRetry) {
  let attempt = 0;
  while (true) {
    try {
      return await task(attempt + 1);
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
      const delay = RETRY_DELAYS_MS[attempt];
      attempt += 1;
      onRetry?.({
        retryIndex: attempt,
        nextAttempt: attempt + 1,
        delay,
        error,
      });
      await sleep(delay);
    }
  }
}

// Low-level download helper.
// extra: { onFileTotal(len), onProgressItem(delta), ... }
async function downloadFile(url, filepath, cookies, onChunk, extra) {
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const partialPath = buildPartialDownloadPath(filepath);

  return withRetry(async () => {
    removeFileQuietly(partialPath);

    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://accounts.booth.pm/library',
        'Cookie': cookieHeader,
      },
    });

    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('text/html')) {
      const err = new Error(`download_not_file_response: ${contentType}`);
      err.step = 'downloadFile';
      throw err;
    }

    const totalLength = parseInt(response.headers['content-length'] || '0', 10);
    let received = 0;

    if (extra && typeof extra.onFileTotal === 'function' && totalLength > 0) {
      extra.onFileTotal(totalLength);
    }

    const writer = fs.createWriteStream(partialPath);

    response.data.on('data', (chunk) => {
      const len = chunk.length;
      received += len;

      if (onChunk) {
        onChunk({ delta: len, received, total: totalLength });
      }

      if (extra && typeof extra.onProgressItem === 'function') {
        extra.onProgressItem(len);
      }
    });

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      response.data.on('error', reject);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    if (fs.existsSync(filepath)) fs.rmSync(filepath, { force: true });
    fs.renameSync(partialPath, filepath);
  }, (retryInfo) => {
    removeFileQuietly(partialPath);
    extra?.onRetry?.(retryInfo);
  }).catch((error) => {
    removeFileQuietly(partialPath);
    throw error;
  });
}

async function getDownloadUrl(downloadableId, client, options = {}) {
  return withRetry(async () => {
    try {
      const res = await client.get(`/downloadables/${downloadableId}`, {
        maxRedirects: 0,
        validateStatus: (status) => status === 302,
      });
      return res.headers.location;
    } catch (error) {
      if (error.response && error.response.status === 302) {
        return error.response.headers.location;
      }
      throw error;
    }
  }, (retryInfo) => {
    options.onRetry?.(retryInfo);
  });
}

async function extractArchivesInItemDir(itemDir, asset, onProgress) {
  if (!fs.existsSync(itemDir)) return;

  const entries = fs.readdirSync(itemDir, { withFileTypes: true });
  const archives = entries
    .filter(e => {
      if (!e.isFile()) return false;
      const lower = e.name.toLowerCase();
      if (lower.endsWith('.zip')) return true;
      for (const ext of ARCHIVE_EXTS_7Z) {
        if (lower.endsWith(ext)) return true;
      }
      return false;
    })
    .map(e => path.join(itemDir, e.name));

  const zips = archives.filter(p => p.toLowerCase().endsWith('.zip'));
  const others = archives.filter(p => !p.toLowerCase().endsWith('.zip'));

  if (archives.length === 0) return;

  const sevenZipPath = others.length > 0 ? path7za : null;

  const extractRoot = path.join(itemDir, '__extracted');
  const flagFile = path.join(extractRoot, '__extracted.flag');
  const forceReextract = Boolean(asset?.forceRedownload);

  if (fs.existsSync(flagFile)) {
    if (forceReextract) {
      try { fs.rmSync(extractRoot, { recursive: true, force: true }); } catch { /* 再展開で上書きされるため失敗は無視 */ }
    } else {
      const currentNames = archives.map(p => path.basename(p));
      let alreadyExtracted = false;
      try {
        const stored = JSON.parse(fs.readFileSync(flagFile, 'utf8'));
        alreadyExtracted = Array.isArray(stored) && currentNames.every(n => stored.includes(n));
      } catch {
        // 旧フォーマット ('ok') またはパース失敗 → 再展開
      }
      if (alreadyExtracted) {
        onProgress?.({ itemId: asset.itemId, phase: 'extracting', status: 'skipped', index: archives.length, total: archives.length });
        return;
      }
    }
  }

  if (!fs.existsSync(extractRoot)) fs.mkdirSync(extractRoot);

  onProgress?.({ itemId: asset.itemId, phase: 'extracting', status: 'start', index: 0, total: archives.length });

  let failedCount = 0;

  for (let i = 0; i < archives.length; i++) {
    const archivePath = archives[i];
    const baseName = path.basename(archivePath);
    const isZip = archivePath.toLowerCase().endsWith('.zip');
    const targetDir = path.join(extractRoot, baseName.replace(/\.[^.]+$/, ''));

    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    try {
      if (isZip) {
        try {
          await extractZipWithEncoding(archivePath, targetDir, ({ processed, total, entryName }) => {
            onProgress?.({
              itemId: asset.itemId, phase: 'extracting', status: 'entry',
              zipIndex: i + 1, zipTotal: archives.length,
              entryIndex: processed, entryTotal: total, currentEntry: entryName,
            });
          });
        } catch (zipErr) {
          if (zipErr.code === 'PASSWORD_REQUIRED' && typeof archivePasswordHook === 'function') {
            onProgress?.({ itemId: asset.itemId, phase: 'extracting', status: 'passwordRequired', index: i + 1, total: archives.length, currentEntry: baseName });
            const password = await archivePasswordHook(archivePath);
            if (!password) throw new Error('パスワードが入力されませんでした。');
            await extractWith7Zip(path7za, archivePath, targetDir, password);
          } else {
            throw zipErr;
          }
        }
      } else {
        onProgress?.({ itemId: asset.itemId, phase: 'extracting', status: 'entry', zipIndex: i + 1, zipTotal: archives.length, currentEntry: baseName });
        try {
          await extractWith7Zip(path7za, archivePath, targetDir);
        } catch (sevenZipErr) {
          if (sevenZipErr.code === 'PASSWORD_REQUIRED' && typeof archivePasswordHook === 'function') {
            onProgress?.({ itemId: asset.itemId, phase: 'extracting', status: 'passwordRequired', index: i + 1, total: archives.length, currentEntry: baseName });
            const password = await archivePasswordHook(archivePath);
            if (!password) throw new Error('パスワードが入力されませんでした。');
            await extractWith7Zip(path7za, archivePath, targetDir, password);
          } else {
            throw sevenZipErr;
          }
        }
      }

      onProgress?.({ itemId: asset.itemId, phase: 'extracting', status: 'fileDone', index: i + 1, total: archives.length, currentEntry: baseName });
    } catch (err) {
      failedCount += 1;
      onProgress?.({ itemId: asset.itemId, phase: 'extracting', status: 'fileError', index: i + 1, total: archives.length, currentEntry: baseName, error: err.message });
    }
  }

  if (failedCount === 0) fs.writeFileSync(flagFile, JSON.stringify(archives.map(p => path.basename(p))));

  onProgress?.({ itemId: asset.itemId, phase: 'extracting', status: failedCount === 0 ? 'done' : 'doneWithErrors', index: archives.length, total: archives.length, failedCount });
}

async function downloadItemFiles(asset, client, cookies, onProgress) {
  const files = Array.isArray(asset?.files)
    ? asset.files.filter((f) => f && String(f.downloadableId || '').trim())
    : [];
  if (!files.length) {
    onProgress?.({
      itemId: asset?.itemId,
      phase: 'downloading',
      status: 'noFiles',
      fileIndex: 0,
      fileTotal: 0,
    });
    throw new Error('no_download_files');
  }

  const downloadRoot = path.join(getDataRoot(), 'downloads');
  if (!fs.existsSync(downloadRoot)) fs.mkdirSync(downloadRoot, { recursive: true });

  const safeName = (asset.title || 'NO_NAME').replace(/[\\/:*?"<>|]/g, '_');
  const itemDir = path.join(downloadRoot, `${asset.itemId}_${safeName}`);
  const forceRedownload = Boolean(asset?.forceRedownload);
  const updateStamp = formatUpdateTimestamp(new Date());

  let workingDir = itemDir;
  let backupDir = '';
  let stageDir = '';
  const hadExistingItemDir = fs.existsSync(itemDir);

  if (forceRedownload && hadExistingItemDir) {
    backupDir = path.join(downloadRoot, '_backup', String(asset.itemId || 'NO_ID'), updateStamp);
    moveDirWithParents(itemDir, backupDir);
    renameBackupZipFiles(backupDir, String(asset.itemId || 'NO_ID'), safeName, updateStamp);
    onProgress?.({
      itemId: asset.itemId,
      phase: 'downloading',
      status: 'backupDone',
      backupDir,
    });
  }

  if (forceRedownload) {
    stageDir = path.join(downloadRoot, '_staging', `${asset.itemId}_${safeName}_${Date.now()}`);
    if (!fs.existsSync(stageDir)) fs.mkdirSync(stageDir, { recursive: true });
    workingDir = stageDir;
    onProgress?.({
      itemId: asset.itemId,
      phase: 'downloading',
      status: 'stagingReady',
      stageDir,
    });
  } else if (!fs.existsSync(workingDir)) {
    fs.mkdirSync(workingDir, { recursive: true });
  }

  const fileTotal = files.length;
  let receivedBytes = 0;
  let totalBytes = 0;
  let fileIndex = 0;

  try {
    for (const f of files) {
      fileIndex += 1;

      const downloadName = sanitizeDownloadName(f.fileName, fileIndex);
      const filePath = path.join(workingDir, downloadName);
      if (fs.existsSync(filePath)) {
        if (forceRedownload) {
          try {
            fs.rmSync(filePath, { force: true });
          } catch { /* 再ダウンロードで上書きされるため失敗は無視 */ }
        } else if (await isExistingDownloadReusable(filePath)) {
          onProgress?.({
            itemId: asset.itemId,
            phase: 'downloading',
            status: 'skip',
            fileName: f.fileName,
            fileIndex,
            fileTotal,
            receivedBytes,
            totalBytes,
          });
          continue;
        } else {
          removeFileQuietly(filePath);
          removeFileQuietly(buildPartialDownloadPath(filePath));
          onProgress?.({
            itemId: asset.itemId,
            phase: 'downloading',
            status: 'redownloadCorrupt',
            fileName: f.fileName,
            fileIndex,
            fileTotal,
            receivedBytes,
            totalBytes,
          });
        }
      }

      const url = await getDownloadUrl(f.downloadableId, client, {
        onRetry: (retryInfo) => {
          onProgress?.({
            itemId: asset.itemId,
            phase: 'downloading',
            status: 'retrying',
            step: 'resolveUrl',
            fileName: f.fileName,
            fileIndex,
            fileTotal,
            retryIndex: retryInfo.retryIndex,
            delay: retryInfo.delay,
            error: retryInfo.error?.message || String(retryInfo.error),
            receivedBytes,
            totalBytes,
          });
        },
      });

      await downloadFile(
        url,
        filePath,
        cookies,
        null,
        {
          itemId: asset.itemId,
          fileIndex,
          fileTotal,
          onFileTotal: (len) => {
            if (len > 0) {
              totalBytes += len;
            }
          },
          onProgressItem: (delta) => {
            receivedBytes += delta;
            onProgress?.({
              itemId: asset.itemId,
              phase: 'downloading',
              status: 'progress',
              fileName: f.fileName,
              fileIndex,
              fileTotal,
              receivedBytes,
              totalBytes,
            });
          },
          onRetry: (retryInfo) => {
            onProgress?.({
              itemId: asset.itemId,
              phase: 'downloading',
              status: 'retrying',
              step: 'downloadFile',
              fileName: f.fileName,
              fileIndex,
              fileTotal,
              retryIndex: retryInfo.retryIndex,
              delay: retryInfo.delay,
              error: retryInfo.error?.message || String(retryInfo.error),
              receivedBytes,
              totalBytes,
            });
          },
        },
      );

      onProgress?.({
        itemId: asset.itemId,
        phase: 'downloading',
        status: 'fileDone',
        fileName: f.fileName,
        fileIndex,
        fileTotal,
        receivedBytes,
        totalBytes,
      });
    }

    await extractArchivesInItemDir(workingDir, asset, onProgress);

    if (forceRedownload) {
      if (fs.existsSync(itemDir)) {
        fs.rmSync(itemDir, { recursive: true, force: true });
      }
      moveDirWithParents(workingDir, itemDir);
      workingDir = itemDir;
      onProgress?.({
        itemId: asset.itemId,
        phase: 'downloading',
        status: 'swapDone',
        itemDir,
      });
    }

    onProgress?.({
      itemId: asset.itemId,
      phase: 'done',
      fileIndex: fileTotal,
      fileTotal,
      receivedBytes,
      totalBytes,
    });
  } catch (e) {
    if (forceRedownload) {
      try {
        if (stageDir && fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
      } catch { /* 一時ステージングディレクトリの削除失敗は無視 */ }
      try {
        if (backupDir && fs.existsSync(backupDir) && !fs.existsSync(itemDir)) {
          moveDirWithParents(backupDir, itemDir);
          onProgress?.({
            itemId: asset.itemId,
            phase: 'downloading',
            status: 'rollbackDone',
            itemDir,
          });
        }
      } catch (rollbackErr) {
        // ロールバック復元に失敗するとitemDirが失われた状態になり得るため警告を残す
        console.warn(`[download] rollback restore failed for ${asset.itemId}:`, rollbackErr?.message || rollbackErr);
      }
    }
    throw e;
  } finally {
    if (forceRedownload) {
      try {
        if (stageDir && fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
      } catch { /* 一時ステージングディレクトリの削除失敗は無視 */ }
    }
  }
}

function extractZipWithEncoding(zipPath, destDir, onEntryProgress) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, {
      lazyEntries: true,
      decodeStrings: false,
    }, (err, zipFile) => {
      if (err) return reject(err);

      zipFile.readEntry();
      let allowOversizeEntriesInThisZip = false;
      let zipClosed = false;
      let processedEntries = 0;
      const totalEntries = zipFile.entryCount;

      const tickEntry = (entryName) => {
        processedEntries += 1;
        onEntryProgress?.({ processed: processedEntries, total: totalEntries, entryName });
      };

      zipFile.on('entry', (entry) => {
        if (entry.generalPurposeBitFlag & 1) {
          zipClosed = true;
          zipFile.close();
          const err = new Error('パスワードで保護された ZIP ファイルです。');
          err.code = 'PASSWORD_REQUIRED';
          err.archivePath = zipPath;
          return reject(err);
        }
        const decodedName = decodeZipEntryName(entry);
        const relPath = decodedName.replace(/\\/g, '/').replace(/^\.\/+/, '');
        const entrySize = Number(entry.uncompressedSize || 0);

        const proceedEntry = () => {
          const mode = (Number(entry.externalFileAttributes || 0) >>> 16) & 0o170000;
          if (mode === 0o120000) {
            tickEntry(relPath);
            zipFile.readEntry();
            return;
          }
          if (hasUnsafeArchivePathSegments(relPath.replace(/\/+$/, ''))) {
            tickEntry(relPath);
            zipFile.readEntry();
            return;
          }
          let targetPath;
          try {
            targetPath = safeResolveUnder(destDir, relPath);
          } catch (pathErr) {
            console.warn(`[zip] skip unsafe path: ${relPath} (${pathErr.message})`);
            tickEntry(relPath);
            zipFile.readEntry();
            return;
          }

          if (/\/$/.test(relPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
            tickEntry(relPath);
            zipFile.readEntry();
            return;
          }

          const dirName = path.dirname(targetPath);
          if (!fs.existsSync(dirName)) fs.mkdirSync(dirName, { recursive: true });

          zipFile.openReadStream(entry, (err2, readStream) => {
            if (err2) {
              zipClosed = true;
              zipFile.close();
              return reject(err2);
            }

            const writeStream = fs.createWriteStream(targetPath);
            let entrySettled = false;

            readStream.on('error', (e) => {
              if (entrySettled) return;
              entrySettled = true;
              zipClosed = true;
              writeStream.destroy();
              zipFile.close();
              reject(e);
            });

            writeStream.on('error', (e) => {
              if (entrySettled) return;
              entrySettled = true;
              zipClosed = true;
              readStream.destroy();
              zipFile.close();
              reject(e);
            });

            writeStream.on('finish', () => {
              if (entrySettled || zipClosed) return;
              tickEntry(relPath);
              zipFile.readEntry();
            });

            readStream.pipe(writeStream);
          });
        };

        if (entrySize <= maxZipEntryBytes || allowOversizeEntriesInThisZip) {
          proceedEntry();
          return;
        }

        if (typeof zipOversizeHook !== 'function') {
          console.warn(`[zip] oversize entry skipped: ${relPath} (${entrySize} > ${maxZipEntryBytes})`);
          tickEntry(relPath);
          zipFile.readEntry();
          return;
        }

        Promise.resolve(zipOversizeHook({
          zipPath,
          entryPath: relPath,
          entryBytes: entrySize,
          maxEntryBytes: maxZipEntryBytes,
        })).then((allow) => {
          if (zipClosed) return;
          if (allow) {
            allowOversizeEntriesInThisZip = true;
            proceedEntry();
            return;
          }
          console.warn(`[zip] oversize entry skipped by user choice: ${relPath}`);
          tickEntry(relPath);
          zipFile.readEntry();
        }).catch((hookErr) => {
          if (zipClosed) return;
          console.warn('[zip] oversize hook failed, skip entry:', hookErr?.message || hookErr);
          tickEntry(relPath);
          zipFile.readEntry();
        });
      });

      zipFile.on('end', () => {
        zipClosed = true;
        zipFile.close();
        resolve();
      });

      zipFile.on('error', (e) => {
        zipClosed = true;
        zipFile.close();
        reject(e);
      });
    });
  });
}

module.exports = {
  createClientAndCookies,
  downloadItemFiles,
  extractArchivesInItemDir,
  extractZipWithEncoding,
  setDataRoot,
  setZipSafetyConfig,
  setZipSafetyHooks,
  // テスト用エクスポート (内部純粋関数)
  _test: {
    crc32,
    isValidUtf8RoundTrip,
    hasUnicodePathExtraField,
    scoreDecodedName,
    hasUnsafeArchivePathSegments,
    sanitizeDownloadName,
    formatUpdateTimestamp,
    buildPartialDownloadPath,
    isExistingDownloadReusable,
  },
};
