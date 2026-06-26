const fs = require('fs');
const path = require('path');

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function removePath(targetPath, dryRun) {
  const st = safeStat(targetPath);
  if (!st) return { path: targetPath, status: 'missing' };
  if (dryRun) return { path: targetPath, status: st.isDirectory() ? 'would_remove_dir' : 'would_remove_file' };
  try {
    if (st.isDirectory()) fs.rmSync(targetPath, { recursive: true, force: true });
    else fs.rmSync(targetPath, { force: true });
    return { path: targetPath, status: st.isDirectory() ? 'removed_dir' : 'removed_file' };
  } catch (e) {
    return { path: targetPath, status: 'error', error: e?.message || String(e) };
  }
}

function removeChildrenExcept(targetDir, dryRun, preservedBaseNames) {
  const st = safeStat(targetDir);
  if (!st) return [{ path: targetDir, status: 'missing' }];
  if (!st.isDirectory()) return [removePath(targetDir, dryRun)];

  const rows = [];
  let entries = [];
  try {
    entries = fs.readdirSync(targetDir, { withFileTypes: true });
  } catch (e) {
    return [{ path: targetDir, status: 'error', error: e?.message || String(e) }];
  }

  for (const entry of entries) {
    const name = String(entry?.name || '');
    if (!name) continue;
    if (preservedBaseNames.has(name.toLowerCase())) {
      rows.push({ path: path.join(targetDir, name), status: dryRun ? 'would_keep' : 'kept' });
      continue;
    }
    rows.push(removePath(path.join(targetDir, name), dryRun));
  }
  if (!rows.length) {
    rows.push({ path: targetDir, status: 'empty_dir' });
  }
  return rows;
}

function uniqPaths(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    const s = String(p || '').trim();
    if (!s) continue;
    const key = process.platform === 'win32' ? s.toLowerCase() : s;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function parseEnvFlagOrUndefined(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return undefined;
}

function buildTargets(options = {}) {
  const keepCookie = Boolean(options.keepCookie);
  const cwd = process.cwd();
  const appData = process.env.APPDATA ? path.resolve(process.env.APPDATA) : '';
  const localAppData = process.env.LOCALAPPDATA ? path.resolve(process.env.LOCALAPPDATA) : '';
  const envDataDir = process.env.AVATOOL_DATA_DIR ? path.resolve(process.env.AVATOOL_DATA_DIR) : '';

  const roots = [
    path.join(cwd, '.data'),
    envDataDir,
    appData ? path.join(appData, 'avatool', 'data') : '',
    appData ? path.join(appData, 'Avatool', 'data') : '',
    localAppData ? path.join(localAppData, 'avatool', 'data') : '',
    localAppData ? path.join(localAppData, 'Avatool', 'data') : '',
  ].filter(Boolean);

  const legacyDirs = [
    path.join(cwd, 'downloads'),
    path.join(cwd, 'cache'),
    path.join(cwd, 'author_icons'),
    path.join(cwd, 'unity_logs'),
  ];

  const legacyFiles = [
    'librarymeta.json',
    'settings.json',
    'unity_import_history.json',
    'reconcile_log.jsonl',
    'auto_bootstrap_history.json',
    'avatars.json',
    'operation_logs.json',
    'settings_profiles.json',
  ].map((f) => path.join(cwd, f));
  if (!keepCookie) {
    legacyFiles.push(path.join(cwd, 'booth.pm.json'));
    legacyFiles.push(path.join(cwd, 'tempcookie.json'));
  }

  return {
    roots: uniqPaths(roots),
    others: uniqPaths([...legacyDirs, ...legacyFiles]),
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run') || args.has('-n');
  const envKeepCookie = [
    parseEnvFlagOrUndefined('AVATOOL_KEEP_COOKIE'),
    parseEnvFlagOrUndefined('npm_config_keep_cookie'),
    parseEnvFlagOrUndefined('npm_config_keep_cookies'),
  ].find((v) => typeof v === 'boolean');
  const keepCookie = (
    args.has('--keep-cookie')
    || args.has('--keep-cookies')
    || (!(args.has('--drop-cookie') || args.has('--drop-cookies')) && (envKeepCookie ?? true))
  );
  const keepSession = !(
    args.has('--drop-session')
    || args.has('--drop-sessions')
    || parseEnvFlagOrUndefined('AVATOOL_KEEP_SESSION') === false
  );
  const targets = buildTargets({ keepCookie });

  const rows = [];
  if (keepCookie) {
    const preserved = new Set(['booth.pm.json', 'tempcookie.json']);
    if (keepSession) preserved.add('session');
    for (const root of targets.roots) {
      rows.push(...removeChildrenExcept(root, dryRun, preserved));
    }
  } else {
    for (const root of targets.roots) {
      rows.push(removePath(root, dryRun));
    }
  }
  for (const p of targets.others) {
    rows.push(removePath(p, dryRun));
  }

  const summary = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    {}
  );

  console.log(
    '[debug-data-reset] mode=' + (dryRun ? 'dry-run' : 'delete')
    + ' keepCookie=' + (keepCookie ? 'true' : 'false')
    + ' keepSession=' + (keepSession ? 'true' : 'false')
  );
  for (const r of rows) {
    if (r.status === 'error') console.log(`  [${r.status}] ${r.path} :: ${r.error}`);
    else console.log(`  [${r.status}] ${r.path}`);
  }
  console.log('[debug-data-reset] summary=' + JSON.stringify(summary));
}

main();
