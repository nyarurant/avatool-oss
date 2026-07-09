'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { sanitizePathSegment, safeResolveUnder } = require('./utils');

const PREVIEWABLE_MESH_EXTS = new Set(['.fbx', '.obj']);
const PREVIEWABLE_AUX_EXTS = new Set(['.mtl', '.png', '.jpg', '.jpeg', '.tga']);
const PREVIEW_CACHE_DIRNAME = '__preview_cache';
const PREVIEW_CACHE_FLAG = '__preview_cache.flag';

function isPreviewableExt(ext) {
  return PREVIEWABLE_MESH_EXTS.has(ext) || PREVIEWABLE_AUX_EXTS.has(ext);
}

function walkForGuidFolders(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (e.isFile() && e.name === 'pathname') out.push(dir);
    }
  }
  return out;
}

function getPreviewCacheDir(itemDir, pkgFileName) {
  const safeName = sanitizePathSegment(pkgFileName, 'package');
  return path.join(itemDir, PREVIEW_CACHE_DIRNAME, safeName);
}

function isPreviewCacheFresh(cacheDir, pkgPath) {
  const flagFile = path.join(cacheDir, PREVIEW_CACHE_FLAG);
  if (!fs.existsSync(flagFile)) return false;
  try {
    const stat = fs.statSync(pkgPath);
    const flag = JSON.parse(fs.readFileSync(flagFile, 'utf8'));
    return flag?.sourceMtimeMs === stat.mtimeMs && flag?.sourceSize === stat.size;
  } catch {
    return false;
  }
}

function listCachedFiles(cacheDir) {
  const meshes = [];
  const textures = [];
  const stack = [cacheDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      const relPath = path.relative(cacheDir, full).replace(/\\/g, '/');
      if (PREVIEWABLE_MESH_EXTS.has(ext)) meshes.push({ relPath, ext });
      else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.tga') textures.push({ relPath, ext });
    }
  }
  return { meshes, textures };
}

/**
 * Extracts only mesh/texture-relevant assets from a .unitypackage into a persistent
 * cache dir, keyed by pathname (not the anonymous GUID/asset blob layout). Everything
 * else (scripts, animations, audio, prefabs, etc.) is skipped to bound extraction time
 * and disk use. Re-extraction is skipped when the cache is already fresh for this
 * source file's mtime/size.
 */
function extractRelevantAssetsFromPackage(pkgPath, itemDir) {
  if (!fs.existsSync(pkgPath)) {
    return { error: 'package_not_found' };
  }

  const pkgFileName = path.basename(pkgPath);
  const cacheDir = getPreviewCacheDir(itemDir, pkgFileName);

  if (isPreviewCacheFresh(cacheDir, pkgPath)) {
    const { meshes, textures } = listCachedFiles(cacheDir);
    if (meshes.length > 0) return { ok: true, cacheDir, meshes, textures };
    // Fresh cache but no mesh found previously — fall through to re-extract in case
    // the allow-list changes in a future version, but for now just report empty.
    return { ok: true, cacheDir, meshes: [], textures: [], noMeshFound: true };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkgpreview-'));
  try {
    const localPkgPath = path.join(tmpDir, 'pkg.unitypackage');
    fs.copyFileSync(pkgPath, localPkgPath);

    const tarCandidates = [
      process.env.SYSTEMROOT ? path.join(process.env.SYSTEMROOT, 'System32', 'tar.exe') : '',
      'tar',
    ].filter(Boolean);

    let extracted = false;
    let lastErr = '';
    for (const cmd of tarCandidates) {
      const res = spawnSync(cmd, ['-xf', localPkgPath, '-C', tmpDir], { encoding: 'utf8' });
      if (res.status === 0) {
        extracted = true;
        break;
      }
      const msg = [res.error?.message || '', res.stderr || '', res.stdout || '']
        .filter(Boolean)
        .join(' ')
        .trim();
      lastErr = msg || `status=${res.status}`;
    }

    if (!extracted) {
      return { error: `tar_failed: ${lastErr}` };
    }

    const guidFolders = walkForGuidFolders(tmpDir);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });

    const meshes = [];
    const textures = [];
    for (const guidFolder of guidFolders) {
      const pathnameFile = path.join(guidFolder, 'pathname');
      const assetFile = path.join(guidFolder, 'asset');
      if (!fs.existsSync(assetFile)) continue;

      let relAssetPath;
      try {
        relAssetPath = fs.readFileSync(pathnameFile, 'utf8').replace(/\\/g, '/').trim();
      } catch {
        continue;
      }
      if (!relAssetPath || !relAssetPath.startsWith('Assets/')) continue;

      const ext = path.extname(relAssetPath).toLowerCase();
      if (!isPreviewableExt(ext)) continue;

      const destRelPath = relAssetPath.slice('Assets/'.length);
      let destPath;
      try {
        // pathname comes from inside the (third-party) .unitypackage — treat it as
        // untrusted and reject any entry that would escape cacheDir (zip-slip style).
        destPath = safeResolveUnder(cacheDir, destRelPath);
      } catch {
        continue;
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(assetFile, destPath);

      const normalizedRelPath = destRelPath.replace(/\\/g, '/');
      if (PREVIEWABLE_MESH_EXTS.has(ext)) meshes.push({ relPath: normalizedRelPath, ext });
      else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.tga') textures.push({ relPath: normalizedRelPath, ext });
    }

    const stat = fs.statSync(pkgPath);
    fs.writeFileSync(
      path.join(cacheDir, PREVIEW_CACHE_FLAG),
      JSON.stringify({ sourceMtimeMs: stat.mtimeMs, sourceSize: stat.size, extractedAt: new Date().toISOString() })
    );

    if (!meshes.length) return { ok: true, cacheDir, meshes: [], textures: [], noMeshFound: true };
    return { ok: true, cacheDir, meshes, textures };
  } catch (e) {
    return { error: e?.message || String(e) };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = {
  extractRelevantAssetsFromPackage,
  getPreviewCacheDir,
  isPreviewCacheFresh,
  listCachedFiles,
  PREVIEWABLE_MESH_EXTS,
  PREVIEWABLE_AUX_EXTS,
};
