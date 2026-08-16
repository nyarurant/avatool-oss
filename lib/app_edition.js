'use strict';

const STANDARD_EDITION = 'standard';
const OWNER_EDITION = 'owner';

function normalizeEdition(value) {
  return String(value || '').trim().toLowerCase() === OWNER_EDITION
    ? OWNER_EDITION
    : STANDARD_EDITION;
}

function detectAppEdition({ fs, path, env = process.env, resourcesPath = process.resourcesPath } = {}) {
  const fromEnv = String(env?.AVATOOL_EDITION || '').trim();
  if (fromEnv) return normalizeEdition(fromEnv);
  try {
    const manifestPath = path.join(resourcesPath, 'edition.json');
    if (!fs.existsSync(manifestPath)) return STANDARD_EDITION;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return normalizeEdition(manifest?.edition);
  } catch {
    return STANDARD_EDITION;
  }
}

module.exports = {
  STANDARD_EDITION,
  OWNER_EDITION,
  normalizeEdition,
  detectAppEdition,
};
