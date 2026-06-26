'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const CDN_BASE = 'https://cdn.necco.xyz/file/avatool';

function log(msg) { process.stdout.write(`[rollback] ${msg}\n`); }
function fail(msg) { process.stderr.write(`[rollback] ERROR: ${msg}\n`); process.exit(1); }

function printUsage() {
  process.stdout.write([
    'Usage:',
    '  node scripts/rollback.js <version>                    # 全体ロールバック',
    '  node scripts/rollback.js <version> <file> [file...]   # 特定ファイルだけ戻す',
    '',
    'Examples:',
    '  node scripts/rollback.js 1.0.375',
    '  node scripts/rollback.js 1.0.375 lib/meta_manager.js',
    '  node scripts/rollback.js 1.0.375 lib/meta_manager.js lib/unity_manager.js',
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
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let downloaded = 0;
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        process.stdout.write(`\r[rollback] Downloading... ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); process.stdout.write('\n'); resolve(); });
    });
    req.on('error', (e) => { file.close(); fs.rmSync(destPath, { force: true }); reject(e); });
  });
}

function extractZip(zipPath, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const ps1 = path.join(path.dirname(zipPath), '_rollback_extract.ps1');
  fs.writeFileSync(ps1, `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force\r\n`, 'utf8');
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, { stdio: 'inherit' });
  } finally {
    try { fs.rmSync(ps1); } catch { /* ignore */ }
  }
}

function findExtractedRoot(extractDir) {
  // zip展開後にサブフォルダが1つだけある場合はそこを root とする
  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(extractDir, entries[0].name);
  }
  return extractDir;
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim().toLowerCase()); });
  });
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

const SKIP_ON_FULL_RESTORE = new Set(['node_modules', 'release', '.git']);

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const version = args[0];
  const targetFiles = args.slice(1).map((f) => f.replace(/\\/g, '/'));
  const isFullRollback = targetFiles.length === 0;

  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Invalid version: ${version}`);

  const zipUrl = `${CDN_BASE}/source-${version}.zip`;
  const tmpDir = path.join(ROOT, 'release', `_rollback_tmp_${version}`);
  const zipPath = path.join(ROOT, 'release', `_rollback_source_${version}.zip`);

  try {
    log(`Target version: ${version}`);
    log(`Downloading ${zipUrl}...`);
    await downloadFile(zipUrl, zipPath);

    log('Extracting...');
    extractZip(zipPath, tmpDir);
    const srcRoot = findExtractedRoot(tmpDir);
    log(`Extracted to: ${srcRoot}`);

    if (isFullRollback) {
      log('');
      log('Full rollback: すべてのファイルを置き換えます（node_modules, release は除外）');
      const ans = await confirm(`v${version} に全体ロールバックしますか？ [y/N]: `);
      if (ans !== 'y' && ans !== 'yes') { log('キャンセルしました。'); return; }

      const files = walkFiles(srcRoot).filter((f) => {
        const top = f.split(/[/\\]/)[0];
        return !SKIP_ON_FULL_RESTORE.has(top);
      });
      let count = 0;
      for (const rel of files) {
        copyFile(path.join(srcRoot, rel), path.join(ROOT, rel));
        count += 1;
      }
      log(`完了: ${count} ファイルを復元しました。`);
    } else {
      log(`Files to restore: ${targetFiles.join(', ')}`);
      for (const rel of targetFiles) {
        const src = path.join(srcRoot, rel);
        const dst = path.join(ROOT, rel);
        if (!fs.existsSync(src)) {
          log(`  SKIP (not found in archive): ${rel}`);
          continue;
        }
        copyFile(src, dst);
        log(`  OK: ${rel}`);
      }
      log('完了');
    }
  } finally {
    try { fs.rmSync(zipPath, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((e) => fail(e?.message || String(e)));
