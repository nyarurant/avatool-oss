'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CDN_BASE = 'https://cdn.necco.xyz/file/avatool';

function log(msg) { process.stdout.write(`${msg}\n`); }
function fail(msg) { process.stderr.write(`[diff] ERROR: ${msg}\n`); process.exit(1); }

function printUsage() {
  process.stdout.write([
    'Usage:',
    '  node scripts/diff.js <versionA> <versionB>           # バージョン間の差分',
    '  node scripts/diff.js <versionA> <versionB> <file>    # 特定ファイルの差分',
    '',
    'Examples:',
    '  node scripts/diff.js 1.0.374 1.0.377',
    '  node scripts/diff.js 1.0.374 1.0.377 lib/meta_manager.js',
  ].join('\n') + '\n');
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const req = https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.rmSync(destPath, { force: true });
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.rmSync(destPath, { force: true });
        return reject(new Error(`HTTP ${res.statusCode} for ${url}\n（そのバージョンのソースアーカイブが存在しない可能性があります）`));
      }
      let downloaded = 0;
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        process.stdout.write(`\r  Downloading... ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); process.stdout.write('\n'); resolve(); });
    });
    req.on('error', (e) => { file.close(); fs.rmSync(destPath, { force: true }); reject(e); });
  });
}

function extractZip(zipPath, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const ps1 = `${zipPath}_extract.ps1`;
  fs.writeFileSync(ps1, `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force\r\n`, 'utf8');
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, { stdio: 'pipe' });
  } finally {
    try { fs.rmSync(ps1); } catch { /* ignore */ }
  }
}

function findExtractedRoot(extractDir) {
  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(extractDir, entries[0].name);
  }
  return extractDir;
}

function walkFiles(dir, base = dir, skip = new Set()) {
  const out = new Set();
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      for (const f of walkFiles(full, base, new Set())) out.add(f);
    } else {
      out.add(rel);
    }
  }
  return out;
}

const SKIP = new Set(['node_modules', 'release', '.git']);
const TEXT_EXTS = new Set(['.js', '.json', '.md', '.html', '.css', '.ts', '.yml', '.yaml', '.txt', '.ps1', '.sh']);

function isTextFile(filePath) {
  return TEXT_EXTS.has(path.extname(filePath).toLowerCase());
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function lineDiff(textA, textB) {
  const linesA = textA.split('\n');
  const linesB = textB.split('\n');
  const out = [];
  const maxLen = Math.max(linesA.length, linesB.length);
  // Simple line-by-line diff (unified style, no context limit)
  let i = 0, j = 0;
  while (i < linesA.length || j < linesB.length) {
    const a = linesA[i];
    const b = linesB[j];
    if (i >= linesA.length) {
      out.push(`+ ${b}`); j++;
    } else if (j >= linesB.length) {
      out.push(`- ${a}`); i++;
    } else if (a === b) {
      out.push(`  ${a}`); i++; j++;
    } else {
      out.push(`- ${a}`); i++;
      out.push(`+ ${b}`); j++;
    }
  }
  return out;
}

function compactDiff(lines, contextLines = 3) {
  // Show only changed lines + context
  const changed = new Set();
  lines.forEach((l, i) => { if (l.startsWith('+ ') || l.startsWith('- ')) changed.add(i); });
  if (!changed.size) return [];
  const shown = new Set();
  for (const idx of changed) {
    for (let k = Math.max(0, idx - contextLines); k <= Math.min(lines.length - 1, idx + contextLines); k++) {
      shown.add(k);
    }
  }
  const out = [];
  let prev = -1;
  for (const idx of [...shown].sort((a, b) => a - b)) {
    if (prev >= 0 && idx > prev + 1) out.push('...');
    out.push(lines[idx]);
    prev = idx;
  }
  return out;
}

async function fetchAndExtract(version, tmpBase) {
  const zipUrl = `${CDN_BASE}/source-${version}.zip`;
  const zipPath = path.join(tmpBase, `source-${version}.zip`);
  const extractDir = path.join(tmpBase, `src-${version}`);
  log(`  Downloading v${version}...`);
  await downloadFile(zipUrl, zipPath);
  log(`  Extracting v${version}...`);
  extractZip(zipPath, extractDir);
  fs.rmSync(zipPath, { force: true });
  return findExtractedRoot(extractDir);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args[0] === '--help') { printUsage(); process.exit(0); }

  const [vA, vB, targetFile] = args;
  if (!/^\d+\.\d+\.\d+$/.test(vA)) fail(`Invalid version: ${vA}`);
  if (!/^\d+\.\d+\.\d+$/.test(vB)) fail(`Invalid version: ${vB}`);

  const tmpBase = path.join(ROOT, 'release', `_diff_tmp_${vA}_${vB}`);
  fs.mkdirSync(tmpBase, { recursive: true });

  try {
    const [rootA, rootB] = await Promise.all([
      fetchAndExtract(vA, tmpBase),
      fetchAndExtract(vB, tmpBase),
    ]);

    if (targetFile) {
      // 特定ファイルの diff
      const relPath = targetFile.replace(/\\/g, '/');
      const pathA = path.join(rootA, relPath);
      const pathB = path.join(rootB, relPath);
      const existsA = fs.existsSync(pathA);
      const existsB = fs.existsSync(pathB);

      log('');
      log(`diff ${relPath}  (v${vA} → v${vB})`);
      log('─'.repeat(60));

      if (!existsA && !existsB) { log('両バージョンに存在しません'); return; }
      if (!existsA) { log('+ (新規ファイル)'); return; }
      if (!existsB) { log('- (削除済み)'); return; }

      if (!isTextFile(relPath)) { log('(バイナリファイル)'); return; }

      const textA = readFileSafe(pathA) || '';
      const textB = readFileSafe(pathB) || '';
      if (textA === textB) { log('変更なし'); return; }

      const diffLines = lineDiff(textA, textB);
      const compact = compactDiff(diffLines);
      compact.forEach((l) => log(l));
    } else {
      // ファイル一覧の diff
      const filesA = walkFiles(rootA, rootA, SKIP);
      const filesB = walkFiles(rootB, rootB, SKIP);
      const allFiles = new Set([...filesA, ...filesB]);

      const added = [], removed = [], modified = [], unchanged = [];

      for (const f of [...allFiles].sort()) {
        const inA = filesA.has(f);
        const inB = filesB.has(f);
        if (!inA) { added.push(f); continue; }
        if (!inB) { removed.push(f); continue; }
        if (isTextFile(f)) {
          const tA = readFileSafe(path.join(rootA, f));
          const tB = readFileSafe(path.join(rootB, f));
          if (tA !== tB) modified.push(f);
          else unchanged.push(f);
        } else {
          unchanged.push(f);
        }
      }

      log('');
      log(`diff v${vA} → v${vB}`);
      log('─'.repeat(60));
      log(`追加: ${added.length}  削除: ${removed.length}  変更: ${modified.length}  変更なし: ${unchanged.length}`);

      if (added.length) { log('\n追加されたファイル:'); added.forEach((f) => log(`  + ${f}`)); }
      if (removed.length) { log('\n削除されたファイル:'); removed.forEach((f) => log(`  - ${f}`)); }
      if (modified.length) {
        log('\n変更されたファイル:');
        for (const f of modified) {
          log(`\n  ~ ${f}`);
          const tA = readFileSafe(path.join(rootA, f)) || '';
          const tB = readFileSafe(path.join(rootB, f)) || '';
          const compact = compactDiff(lineDiff(tA, tB));
          compact.forEach((l) => log(`    ${l}`));
        }
      }
    }
  } finally {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((e) => fail(e?.message || String(e)));
