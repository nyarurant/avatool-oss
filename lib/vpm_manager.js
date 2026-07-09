'use strict';

const crypto = require('crypto');
const { sanitizePathSegment, safeResolveUnder } = require('./utils');

function createVpmManager(deps) {
  const {
    fs,
    path,
    axios,
    getSettings,
    dbgUpdate,
    NADENA_VPM_REPO_URL,
    LILTOON_VPM_REPO_URL,
    MODULAR_AVATAR_PACKAGE_NAME,
    NDMF_PACKAGE_NAME,
    LILTOON_PACKAGE_NAME,
    extractZipSimple,
  } = deps;

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function readJsonSafe(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  function parseSemverInfo(ver) {
    const s = String(ver || '').trim();
    const m = s.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!m) return null;
    return {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      prerelease: String(m[4] || ''),
      isPrerelease: Boolean(m[4]),
    };
  }

  function compareSemverIdentifierAsc(a, b) {
    const as = String(a || '');
    const bs = String(b || '');
    const aNum = /^\d+$/.test(as);
    const bNum = /^\d+$/.test(bs);
    if (aNum && bNum) return Number(as) - Number(bs);
    if (aNum && !bNum) return -1;
    if (!aNum && bNum) return 1;
    return as.localeCompare(bs);
  }

  function comparePrereleaseAsc(a, b) {
    const aIds = String(a || '').split('.').filter((x) => x.length > 0);
    const bIds = String(b || '').split('.').filter((x) => x.length > 0);
    const len = Math.max(aIds.length, bIds.length);
    for (let i = 0; i < len; i += 1) {
      const av = aIds[i];
      const bv = bIds[i];
      if (typeof av === 'undefined') return -1;
      if (typeof bv === 'undefined') return 1;
      const cmp = compareSemverIdentifierAsc(av, bv);
      if (cmp !== 0) return cmp;
    }
    return 0;
  }

  function compareSemverDesc(a, b) {
    const av = parseSemverInfo(a);
    const bv = parseSemverInfo(b);
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    if (av.major !== bv.major) return bv.major - av.major;
    if (av.minor !== bv.minor) return bv.minor - av.minor;
    if (av.patch !== bv.patch) return bv.patch - av.patch;
    if (av.isPrerelease !== bv.isPrerelease) return av.isPrerelease ? 1 : -1; // stable first
    if (!av.isPrerelease) return 0;
    return comparePrereleaseAsc(bv.prerelease, av.prerelease);
  }

  function isSafePackageName(value) {
    const s = String(value || '').trim();
    if (!s) return false;
    if (s.includes('..')) return false;
    if (s.startsWith('/') || s.endsWith('/')) return false;
    const pkgRe = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/;
    return pkgRe.test(s);
  }

  function resolvePackageTargetDir(packagesDir, packageName) {
    const normalized = String(packageName || '').trim();
    if (!isSafePackageName(normalized)) throw new Error('invalid_vpm_package_name');
    return safeResolveUnder(packagesDir, normalized.replace(/\//g, path.sep));
  }

  function copyDirMerge(srcDir, dstDir) {
    if (!fs.existsSync(srcDir)) return;
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const ent of entries) {
      const src = path.join(srcDir, ent.name);
      const dst = path.join(dstDir, ent.name);
      if (ent.isDirectory()) {
        copyDirMerge(src, dst);
      } else if (ent.isFile()) {
        fs.copyFileSync(src, dst);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public functions
  // ---------------------------------------------------------------------------

  function isVpmPackageDir(dirPath) {
    const pkgJsonPath = path.join(String(dirPath || ''), 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return false;
    const pkg = readJsonSafe(pkgJsonPath);
    const name = String(pkg?.name || '').trim();
    if (!name) return false;
    // Typical VPM/UPM package names: domain-like, e.g. nadena.dev.modular-avatar
    return name.includes('.');
  }

  function listVpmPackageRootsInDir(itemDir) {
    const out = [];
    const extractedRoot = path.join(String(itemDir || ''), '__extracted');
    if (!extractedRoot || !fs.existsSync(extractedRoot)) return out;
    const stack = [extractedRoot];
    while (stack.length) {
      const cur = stack.pop();
      if (isVpmPackageDir(cur)) out.push(cur);
      let entries = [];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (ent.isDirectory()) stack.push(path.join(cur, ent.name));
      }
    }
    return Array.from(new Set(out));
  }

  async function fetchLatestVersionFromVpmRepo(repoUrl, packageName) {
    const meta = await fetchLatestPackageMetaFromVpmRepo(repoUrl, packageName);
    return meta ? String(meta.version || '') : null;
  }

  async function fetchLatestPackageMetaFromVpmRepo(repoUrl, packageName) {
    try {
      const res = await axios.get(String(repoUrl || ''), { timeout: 15000, responseType: 'json' });
      const body = res?.data || {};
      const pkg = body?.packages?.[packageName];
      const versionsObj = pkg?.versions && typeof pkg.versions === 'object' ? pkg.versions : null;
      if (!versionsObj) return null;
      const vers = Object.keys(versionsObj).filter(Boolean);
      if (!vers.length) return null;
      vers.sort(compareSemverDesc);
      const stable = vers.find((v) => {
        const info = parseSemverInfo(v);
        return Boolean(info) && !info.isPrerelease;
      });
      const chosen = String(stable || vers[0] || '');
      const row = versionsObj[chosen] || {};
      const url = String(row?.url || '').trim();
      if (!url) return null;
      return {
        packageName: String(packageName || ''),
        version: chosen,
        url,
        zipSHA256: String(row?.zipSHA256 || '').trim(),
      };
    } catch {
      return null;
    }
  }

  function findPackageRootByName(rootDir, packageName) {
    if (!rootDir || !fs.existsSync(rootDir)) return '';
    const stack = [rootDir];
    while (stack.length) {
      const cur = stack.pop();
      const pkgJsonPath = path.join(cur, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        const pkg = readJsonSafe(pkgJsonPath);
        if (String(pkg?.name || '').trim() === String(packageName || '').trim()) return cur;
      }
      let entries = [];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (ent.isDirectory()) stack.push(path.join(cur, ent.name));
      }
    }
    return '';
  }

  async function installLocalVpmPackageFromRepo(projectPath, repoUrl, packageName) {
    if (!isSafePackageName(packageName)) return { error: 'invalid_vpm_package_name' };
    const meta = await fetchLatestPackageMetaFromVpmRepo(repoUrl, packageName);
    if (!meta?.url || !meta?.version) return { error: 'vpm_meta_not_found', packageName };
    dbgUpdate('autoboot:vpm:repo:meta', `package=${packageName}`, `version=${meta.version}`);
    const settings = getSettings();
    const cacheRoot = path.join(settings.downloadPath, '__vpm_cache');
    if (!fs.existsSync(cacheRoot)) fs.mkdirSync(cacheRoot, { recursive: true });
    const key = `${sanitizePathSegment(packageName, 'pkg')}_${sanitizePathSegment(meta.version, 'ver')}`;
    const workDir = path.join(cacheRoot, key);
    const zipPath = path.join(workDir, `${sanitizePathSegment(packageName, 'pkg')}.zip`);
    const extractDir = path.join(workDir, '__extract');
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
    const res = await axios.get(meta.url, { responseType: 'arraybuffer', timeout: 60000 });
    const zipBuf = Buffer.from(res.data);
    if (meta.zipSHA256) {
      const got = crypto.createHash('sha256').update(zipBuf).digest('hex');
      if (got.toLowerCase() !== meta.zipSHA256.toLowerCase()) {
        return { error: 'vpm_zip_hash_mismatch', packageName, version: meta.version };
      }
    }
    fs.writeFileSync(zipPath, zipBuf);
    dbgUpdate('autoboot:vpm:repo:downloaded', `package=${packageName}`, `version=${meta.version}`, `bytes=${zipBuf.length}`);
    try {
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    } catch (rmErr) {
      // 削除失敗時は旧展開物が残ったまま新規展開される可能性があるため記録
      dbgUpdate('autoboot:vpm:repo:extractdir-cleanup-failed', `package=${packageName}`, `error=${rmErr?.message || rmErr}`);
    }
    fs.mkdirSync(extractDir, { recursive: true });
    await extractZipSimple(zipPath, extractDir);
    const pkgRoot = findPackageRootByName(extractDir, packageName);
    if (!pkgRoot) return { error: 'vpm_pkg_root_not_found', packageName, version: meta.version };
    const packagesDir = path.join(projectPath, 'Packages');
    if (!fs.existsSync(packagesDir)) fs.mkdirSync(packagesDir, { recursive: true });
    let targetDir;
    try {
      targetDir = resolvePackageTargetDir(packagesDir, packageName);
    } catch {
      return { error: 'invalid_vpm_package_name', packageName };
    }
    try {
      if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (rmErr) {
      // 削除失敗時は旧バージョンのファイルが新バージョンと混在する可能性があるため記録
      dbgUpdate('autoboot:vpm:repo:targetdir-cleanup-failed', `package=${packageName}`, `error=${rmErr?.message || rmErr}`);
    }
    copyDirMerge(pkgRoot, targetDir);
    dbgUpdate('autoboot:vpm:repo:installed', `package=${packageName}`, `version=${meta.version}`, `target=${targetDir}`);
    return { ok: true, packageName, version: meta.version, targetDir };
  }

  function ensureNadenaScopedRegistry(manifest) {
    if (!Array.isArray(manifest.scopedRegistries)) manifest.scopedRegistries = [];
    const existingIdx = manifest.scopedRegistries.findIndex((r) => String(r?.url || '').includes('vpm.nadena.dev'));
    const reg = {
      name: 'Nadena VPM',
      url: 'https://vpm.nadena.dev',
      scopes: ['nadena.dev'],
    };
    if (existingIdx >= 0) {
      const prev = manifest.scopedRegistries[existingIdx] || {};
      const prevScopes = Array.isArray(prev.scopes)
        ? prev.scopes.map((s) => String(s || '').trim()).filter(Boolean)
        : [];
      reg.scopes = Array.from(new Set([...prevScopes, 'nadena.dev']));
      manifest.scopedRegistries[existingIdx] = { ...prev, ...reg };
    } else {
      manifest.scopedRegistries.push(reg);
    }
  }

  function ensureLilxyzwScopedRegistry(manifest) {
    if (!Array.isArray(manifest.scopedRegistries)) manifest.scopedRegistries = [];
    const existingIdx = manifest.scopedRegistries.findIndex((r) => String(r?.url || '').includes('lilxyzw.github.io/vpm-repos'));
    const reg = {
      name: 'lilxyzw VPM',
      url: 'https://lilxyzw.github.io/vpm-repos/vpm.json',
      scopes: ['jp.lilxyzw'],
    };
    if (existingIdx >= 0) {
      const prev = manifest.scopedRegistries[existingIdx] || {};
      const prevScopes = Array.isArray(prev.scopes)
        ? prev.scopes.map((s) => String(s || '').trim()).filter(Boolean)
        : [];
      reg.scopes = Array.from(new Set([...prevScopes, 'jp.lilxyzw']));
      manifest.scopedRegistries[existingIdx] = { ...prev, ...reg };
    } else {
      manifest.scopedRegistries.push(reg);
    }
  }

  function cleanupLegacyVpmEntries(packagesDir) {
    const vpmManifestPath = path.join(packagesDir, 'vpm-manifest.json');
    const vpmManifest = readJsonSafe(vpmManifestPath);
    if (!vpmManifest || typeof vpmManifest !== 'object') return { changed: false };
    let changed = false;
    const targets = new Set([MODULAR_AVATAR_PACKAGE_NAME, NDMF_PACKAGE_NAME]);

    if (vpmManifest.dependencies && typeof vpmManifest.dependencies === 'object') {
      for (const key of Object.keys(vpmManifest.dependencies)) {
        if (!targets.has(String(key || '').trim())) continue;
        delete vpmManifest.dependencies[key];
        changed = true;
      }
    }

    if (vpmManifest.locked && typeof vpmManifest.locked === 'object') {
      for (const key of Object.keys(vpmManifest.locked)) {
        if (!targets.has(String(key || '').trim())) continue;
        delete vpmManifest.locked[key];
        changed = true;
      }
    }

    if (Array.isArray(vpmManifest.repositories)) {
      const before = vpmManifest.repositories.length;
      vpmManifest.repositories = vpmManifest.repositories.filter((r) => {
        const url = String(r || '').trim().toLowerCase();
        return url !== NADENA_VPM_REPO_URL.toLowerCase();
      });
      if (vpmManifest.repositories.length !== before) changed = true;
    }

    if (changed) {
      fs.writeFileSync(vpmManifestPath, JSON.stringify(vpmManifest, null, 2), 'utf8');
    }
    return { changed };
  }

  async function ensureModularAvatarDependency(projectPath) {
    const packagesDir = path.join(projectPath, 'Packages');
    if (!fs.existsSync(packagesDir)) fs.mkdirSync(packagesDir, { recursive: true });
    const manifestPath = path.join(packagesDir, 'manifest.json');
    const manifest = readJsonSafe(manifestPath) || {};
    if (!manifest.dependencies || typeof manifest.dependencies !== 'object') manifest.dependencies = {};
    ensureNadenaScopedRegistry(manifest);
    const maInstall = await installLocalVpmPackageFromRepo(projectPath, NADENA_VPM_REPO_URL, MODULAR_AVATAR_PACKAGE_NAME);
    if (!maInstall?.ok) return { error: maInstall?.error || 'ma_install_failed' };
    const ndmfInstall = await installLocalVpmPackageFromRepo(projectPath, NADENA_VPM_REPO_URL, NDMF_PACKAGE_NAME);
    if (!ndmfInstall?.ok) return { error: ndmfInstall?.error || 'ndmf_install_failed' };
    manifest.dependencies[MODULAR_AVATAR_PACKAGE_NAME] = `file:${MODULAR_AVATAR_PACKAGE_NAME}`;
    manifest.dependencies[NDMF_PACKAGE_NAME] = `file:${NDMF_PACKAGE_NAME}`;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    const cleaned = cleanupLegacyVpmEntries(packagesDir);
    dbgUpdate('autoboot:vpm:cleanup', `changed=${Boolean(cleaned?.changed)}`);
    return { ok: true, version: maInstall.version, source: 'vpm-latest-zip-file' };
  }

  async function ensureLiltoonDependency(projectPath) {
    const packagesDir = path.join(projectPath, 'Packages');
    if (!fs.existsSync(packagesDir)) fs.mkdirSync(packagesDir, { recursive: true });
    const manifestPath = path.join(packagesDir, 'manifest.json');
    const manifest = readJsonSafe(manifestPath) || {};
    if (!manifest.dependencies || typeof manifest.dependencies !== 'object') manifest.dependencies = {};
    ensureLilxyzwScopedRegistry(manifest);
    const liltoonInstall = await installLocalVpmPackageFromRepo(projectPath, LILTOON_VPM_REPO_URL, LILTOON_PACKAGE_NAME);
    if (!liltoonInstall?.ok) return { error: liltoonInstall?.error || 'liltoon_install_failed' };
    manifest.dependencies[LILTOON_PACKAGE_NAME] = `file:${LILTOON_PACKAGE_NAME}`;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { ok: true, version: liltoonInstall.version, source: 'vpm-latest-zip-file' };
  }

  async function installVpmPackageToProject(projectPath, vpmRoot) {
    const pkgJsonPath = path.join(String(vpmRoot || ''), 'package.json');
    const pkg = readJsonSafe(pkgJsonPath);
    const packageName = String(pkg?.name || '').trim();
    if (!packageName || !isSafePackageName(packageName)) return { error: 'invalid_vpm_package' };

    const packagesDir = path.join(projectPath, 'Packages');
    if (!fs.existsSync(packagesDir)) fs.mkdirSync(packagesDir, { recursive: true });
    let targetDir;
    try {
      targetDir = resolvePackageTargetDir(packagesDir, packageName);
    } catch {
      return { error: 'invalid_vpm_package' };
    }
    try {
      if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (rmErr) {
      // 削除失敗時は旧バージョンのファイルが新バージョンと混在する可能性があるため記録
      dbgUpdate('autoboot:vpm:local:targetdir-cleanup-failed', `package=${packageName}`, `error=${rmErr?.message || rmErr}`);
    }
    copyDirMerge(vpmRoot, targetDir);

    const manifestPath = path.join(packagesDir, 'manifest.json');
    let manifest = readJsonSafe(manifestPath) || {};
    if (!manifest.dependencies || typeof manifest.dependencies !== 'object') {
      manifest.dependencies = {};
    }
    let depValue = `file:${packageName}`;
    manifest.dependencies[packageName] = depValue;
    if (packageName === MODULAR_AVATAR_PACKAGE_NAME) ensureNadenaScopedRegistry(manifest);

    const vpmDeps = (pkg && typeof pkg.vpmDependencies === 'object' && pkg.vpmDependencies)
      ? pkg.vpmDependencies
      : {};
    for (const [k, v] of Object.entries(vpmDeps)) {
      if (!k || typeof v === 'undefined' || v === null) continue;
      manifest.dependencies[String(k)] = String(v);
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { ok: true, packageName, targetDir, depValue };
  }

  async function applyVpmPackagesToProject(projectPath, vpmRows) {
    let applied = 0;
    for (const row of (Array.isArray(vpmRows) ? vpmRows : [])) {
      const vpmRoot = String(row?.vpmRoot || '').trim();
      if (!vpmRoot || !fs.existsSync(vpmRoot)) continue;
      const res = await installVpmPackageToProject(projectPath, vpmRoot);
      if (res?.ok) applied += 1;
    }
    return { ok: true, applied };
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------

  return {
    isVpmPackageDir,
    listVpmPackageRootsInDir,
    fetchLatestVersionFromVpmRepo,
    fetchLatestPackageMetaFromVpmRepo,
    findPackageRootByName,
    installLocalVpmPackageFromRepo,
    installVpmPackageToProject,
    applyVpmPackagesToProject,
    ensureModularAvatarDependency,
    ensureLiltoonDependency,
    ensureNadenaScopedRegistry,
    ensureLilxyzwScopedRegistry,
    cleanupLegacyVpmEntries,
  };
}

module.exports = { createVpmManager };
