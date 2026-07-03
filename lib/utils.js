'use strict';

const path = require('path');
const os = require('os');

/**
 * utils.js
 *
 * Shared utility functions used across main.js and lib/* modules.
 * Centralised here to eliminate duplication.
 */

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeHour(value, fallback) {
  const n = Math.trunc(toFiniteNumber(value, fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(23, n));
}

function normalizeRetryAttempts(value, fallback = 4) {
  const n = Math.trunc(toFiniteNumber(value, fallback));
  return Math.max(1, Math.min(12, n));
}

function normalizeRetryBaseDelayMs(value, fallback = 1200) {
  const n = Math.trunc(toFiniteNumber(value, fallback));
  return Math.max(200, Math.min(120000, n));
}

function normalizeZipMaxEntryBytes(value, fallback = 512 * 1024 * 1024) {
  const n = Math.trunc(toFiniteNumber(value, fallback));
  return Math.max(1 * 1024 * 1024, Math.min(8 * 1024 * 1024 * 1024, n));
}

function sanitizePathSegment(value, fallback = 'NO_NAME') {
  const s = String(value ?? '')
    .replace(/[\0-\x1F\x7F]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!s) return fallback;
  if (process.platform === 'win32' && /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) {
    return `_${s}`;
  }
  return s;
}

function safeResolveUnder(baseDir, relPath) {
  const normalizedRelPath = String(relPath || '').replace(/\\/g, '/');
  if (!normalizedRelPath) throw new Error('empty_path');
  if (/[\0-\x1F\x7F]/.test(normalizedRelPath)) throw new Error('control_char_in_path');
  if (/^(\/|\/\/|[A-Za-z]:\/)/.test(normalizedRelPath)) throw new Error('absolute_path_not_allowed');
  if (path.isAbsolute(normalizedRelPath)) throw new Error('absolute_path_not_allowed');

  const baseResolved = path.resolve(baseDir);
  const resolved = path.resolve(baseResolved, normalizedRelPath);
  const baseCmp = process.platform === 'win32' ? baseResolved.toLowerCase() : baseResolved;
  const resolvedCmp = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  if (resolvedCmp === baseCmp) throw new Error('path_resolves_to_base');
  if (!resolvedCmp.startsWith(baseCmp + path.sep)) throw new Error('path_outside_base');
  return resolved;
}

function dedupeDownloadLinks(links = []) {
  const map = new Map();
  for (const dl of (Array.isArray(links) ? links : [])) {
    const downloadableId = String(dl?.downloadableId || '').trim();
    if (!downloadableId) continue;
    const fileName = String(dl?.fileName || `file_${downloadableId}`).trim() || `file_${downloadableId}`;
    const key = `${downloadableId}:${fileName}`;
    const prev = map.get(key);
    map.set(key, {
      downloadableId,
      fileName,
      variationName: String(dl?.variationName || prev?.variationName || '').trim(),
    });
  }
  return Array.from(map.values());
}

function isWithinHourWindow(nowHour, startHour, endHour) {
  const s = normalizeHour(startHour, 0);
  const e = normalizeHour(endHour, 23);
  if (s === e) return true;
  if (s < e) return nowHour >= s && nowHour < e;
  return nowHour >= s || nowHour < e;
}

function getCpuCount() {
  try {
    const n = Number(os.cpus()?.length || 0);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

function resolveAppDataRoot({ app, legacyAppRoot }) {
  const fromEnv = String(process.env.AVATOOL_DATA_DIR || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  try {
    const userData = app.getPath('userData');
    if (userData) return path.join(userData, 'data');
  } catch {
    // ignore
  }
  return path.join(legacyAppRoot, '.data');
}

module.exports = {
  toFiniteNumber,
  normalizeHour,
  normalizeRetryAttempts,
  normalizeRetryBaseDelayMs,
  normalizeZipMaxEntryBytes,
  sanitizePathSegment,
  safeResolveUnder,
  dedupeDownloadLinks,
  isWithinHourWindow,
  getCpuCount,
  resolveAppDataRoot,
};
