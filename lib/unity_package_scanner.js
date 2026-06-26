const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function walkForPathnameFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name === 'pathname') out.push(full);
    }
  }
  return out;
}

function scanUnityPackage(pkgPath, candidateTokens = []) {
  if (!fs.existsSync(pkgPath)) {
    throw new Error('package_not_found');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkgscan-'));
  try {
    // Copy to ASCII temp path first to avoid Windows tar path/encoding issues.
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
      throw new Error(`tar_failed: ${lastErr} (source=${pkgPath})`);
    }

    const pathnameFiles = walkForPathnameFiles(tmpDir);
    const rawPaths = pathnameFiles.map((p) =>
      fs.readFileSync(p, 'utf8').replace(/\\/g, '/').trim()
    );

    const assetPaths = rawPaths.filter((p) => p.startsWith('Assets/'));

    const topFoldersMap = {};
    for (const p of assetPaths) {
      const segs = p.split('/');
      if (segs.length >= 2 && segs[1]) {
        const top = segs[1];
        topFoldersMap[top] = (topFoldersMap[top] || 0) + 1;
      }
    }

    const topFolders = Object.entries(topFoldersMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const joined = assetPaths.join(' ').toLowerCase();
    const tokensSet = new Set();
    for (const cand of candidateTokens || []) {
      const key = String(cand || '').toLowerCase().trim();
      if (!key) continue;
      if (joined.includes(key)) tokensSet.add(key);
    }

    return {
      topFolders,
      tokens: Array.from(tokensSet),
      assetPaths,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { scanUnityPackage };
