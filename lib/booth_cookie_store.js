const fs = require('fs');
const path = require('path');

const COOKIE_FILE_FORMAT = 'booth-cookies-v1';

function getSafeStorage() {
  try {
    const electron = require('electron');
    return electron?.safeStorage || null;
  } catch {
    return null;
  }
}

function canEncryptWithSafeStorage() {
  const safeStorage = getSafeStorage();
  return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
}

function parseCookieFileRaw(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawText || ''));
  } catch {
    const err = new Error('invalid_cookie_file');
    err.code = 'invalid_cookie_file';
    throw err;
  }
  if (Array.isArray(parsed)) {
    return { cookies: parsed, encrypted: false };
  }
  if (parsed && parsed.__format === COOKIE_FILE_FORMAT && parsed.enc === 'safeStorage' && typeof parsed.data === 'string') {
    const safeStorage = getSafeStorage();
    if (!safeStorage || typeof safeStorage.decryptString !== 'function') {
      const err = new Error('safe_storage_unavailable');
      err.code = 'safe_storage_unavailable';
      throw err;
    }
    let plainText = '';
    try {
      plainText = safeStorage.decryptString(Buffer.from(parsed.data, 'base64'));
    } catch {
      const err = new Error('cookie_decrypt_failed');
      err.code = 'cookie_decrypt_failed';
      throw err;
    }
    let cookies;
    try {
      cookies = JSON.parse(plainText);
    } catch {
      const err = new Error('invalid_cookie_payload');
      err.code = 'invalid_cookie_payload';
      throw err;
    }
    if (!Array.isArray(cookies)) {
      const err = new Error('invalid_cookie_payload');
      err.code = 'invalid_cookie_payload';
      throw err;
    }
    return { cookies, encrypted: true };
  }
  const err = new Error('unsupported_cookie_file_format');
  err.code = 'unsupported_cookie_file_format';
  throw err;
}

function readBoothCookiesFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return parseCookieFileRaw(raw).cookies;
}

function writeBoothCookiesToFile(filePath, cookies) {
  const rows = Array.isArray(cookies) ? cookies : [];
  const dir = path.dirname(String(filePath || ''));
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (canEncryptWithSafeStorage()) {
    const safeStorage = getSafeStorage();
    const plainText = JSON.stringify(rows);
    const encrypted = safeStorage.encryptString(plainText);
    const payload = {
      __format: COOKIE_FILE_FORMAT,
      enc: 'safeStorage',
      data: encrypted.toString('base64'),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { encrypted: true };
  }
  const err = new Error('safe_storage_unavailable');
  err.code = 'safe_storage_unavailable';
  throw err;
}

module.exports = {
  readBoothCookiesFromFile,
  writeBoothCookiesToFile,
};
