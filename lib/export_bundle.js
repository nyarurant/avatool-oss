function buildDefaultExportFileName(prefix = 'avatool-export') {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${prefix}-${y}${m}${day}-${hh}${mm}${ss}.json`;
}

function resolveExportBundlePath({ inputPath, fs, path, defaultPrefix = 'avatool-export' }) {
  const raw = String(inputPath || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/[\\/]+$/, '');
  const hasTrailingSep = /[\\/]$/.test(raw);
  if (hasTrailingSep) {
    return path.join(normalized || raw, buildDefaultExportFileName(defaultPrefix));
  }
  try {
    if (fs.existsSync(normalized)) {
      const st = fs.statSync(normalized);
      if (st?.isDirectory?.()) {
        return path.join(normalized, buildDefaultExportFileName(defaultPrefix));
      }
    }
  } catch {
    // fall through
  }
  return normalized;
}

module.exports = {
  resolveExportBundlePath,
};
