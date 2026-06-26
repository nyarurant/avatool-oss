'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    keep: false,
    dataDir: '',
    outDir: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    if (arg === '--keep') out.keep = true;
    else if (arg === '--data-dir') out.dataDir = String(argv[++i] || '');
    else if (arg.startsWith('--data-dir=')) out.dataDir = arg.slice('--data-dir='.length);
    else if (arg === '--out') out.outDir = String(argv[++i] || '');
    else if (arg.startsWith('--out=')) out.outDir = arg.slice('--out='.length);
  }
  return out;
}

function safeName(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim() || 'NO_NAME';
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function makeItemDir(downloadRoot, itemId, title) {
  const dir = path.join(downloadRoot, `${itemId}_${safeName(title)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createProbeData(dataDir) {
  const downloadRoot = path.join(dataDir, 'downloads');
  fs.mkdirSync(downloadRoot, { recursive: true });

  const now = new Date().toISOString();
  const items = [
    {
      itemId: '9001',
      itemName: 'Probe Outfit',
      authorName: 'Probe Shop',
      orderDateTime: '2026-06-01T10:00:00.000Z',
      imageUrl: '',
      localImagePath: '',
      categories: [{ name: '衣装', slug: 'probe-outfit' }],
      primaryCategory: { name: '衣装', slug: 'probe-outfit' },
      tagNames: ['probe', 'outfit'],
      downloadLinks: [{ downloadableId: '99001', fileName: 'probe-outfit.zip' }],
      versionHistory: [],
      latestVersion: { detectedAt: now, filesHash: 'probe-hash-9001', filesHashStable: 'probe-stable-9001' },
      hasUpdate: false,
      lastChecked: now,
    },
    {
      itemId: '9002',
      itemName: 'Probe Downloaded Avatar',
      authorName: 'Probe Shop',
      orderDateTime: '2026-06-02T10:00:00.000Z',
      imageUrl: '',
      localImagePath: '',
      categories: [{ name: 'アバター', slug: 'probe-avatar' }],
      primaryCategory: { name: 'アバター', slug: 'probe-avatar' },
      tagNames: ['probe', 'avatar'],
      downloadLinks: [{ downloadableId: '99002', fileName: 'probe-avatar.unitypackage' }],
      versionHistory: [],
      latestVersion: { detectedAt: now, filesHash: 'probe-hash-9002', filesHashStable: 'probe-stable-9002' },
      hasUpdate: false,
      lastChecked: now,
    },
    {
      itemId: '9003',
      itemName: 'Probe Broken Archive',
      authorName: 'Probe Shop',
      orderDateTime: '2026-06-03T10:00:00.000Z',
      imageUrl: '',
      localImagePath: '',
      categories: [{ name: '小物', slug: 'probe-prop' }],
      primaryCategory: { name: '小物', slug: 'probe-prop' },
      tagNames: ['probe', 'error'],
      downloadLinks: [{ downloadableId: '99003', fileName: 'probe-broken.zip' }],
      versionHistory: [],
      latestVersion: { detectedAt: now, filesHash: 'probe-hash-9003', filesHashStable: 'probe-stable-9003' },
      hasUpdate: true,
      lastChecked: now,
    },
  ];

  const downloadedDir = makeItemDir(downloadRoot, '9002', 'Probe Downloaded Avatar');
  fs.writeFileSync(path.join(downloadedDir, 'probe-avatar.unitypackage'), 'probe unitypackage placeholder\n', 'utf8');
  const extractedRoot = path.join(downloadedDir, '__extracted');
  fs.mkdirSync(path.join(extractedRoot, 'ProbeAvatar'), { recursive: true });
  fs.writeFileSync(path.join(extractedRoot, 'ProbeAvatar', 'README.txt'), 'probe extracted placeholder\n', 'utf8');
  fs.writeFileSync(path.join(extractedRoot, '__extracted.flag'), 'ok', 'utf8');

  writeJson(path.join(dataDir, 'librarymeta.json'), items);
  writeJson(path.join(dataDir, 'avatars.json'), []);
  writeJson(path.join(dataDir, 'operation_logs.json'), []);
  writeJson(path.join(dataDir, 'settings.json'), {
    downloadPath: downloadRoot,
    concurrency: 2,
    autoExtract: true,
    extractZipOnly: false,
    autoCheckInterval: 0,
    minFreeSpaceGb: 0,
    autoBootstrapEnabled: false,
    autoBootstrapIncludeMA: false,
    autoBootstrapIncludeLiltoon: false,
    autoBootstrapIncludeFaceEmo: false,
    autoBootstrapIncludeAvatoolScripts: false,
    autoBootstrapIncludeFolderIconBootstrap: false,
    autoBootstrapIncludeSimpleFolderIcon: false,
    autoBootstrapProjectImportRules: [],
    autoBootstrapVariantMode: 'select',
    autoBootstrapVariantSelections: [],
    projectImportPresets: {},
    cookieFile: path.join(dataDir, 'booth.pm.json'),
    unityEditorPath: '',
    unityProjects: [],
    safeMode: true,
    healthCheckOnStartup: false,
    downloadSchedulerEnabled: false,
    downloadSchedulerStartHour: 1,
    downloadSchedulerEndHour: 6,
    downloadSchedulerProfile: 'balanced',
    downloadRetryMaxAttempts: 2,
    downloadRetryBaseDelayMs: 200,
    operationLogEnabled: true,
    zipMaxEntryBytes: 512 * 1024 * 1024,
    keyboardShortcutsEnabled: false,
    renderMode: 'instant',
    keyboardShortcuts: {},
  });
}

function summarizeReport(reportPath) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const rows = Array.isArray(report.steps) ? report.steps : [];
  const issues = [];
  for (const row of rows) {
    if (row.error) issues.push(`${row.step}: ${row.error}`);
    const state = row.state || {};
    if (Number(state.textOverflowCount || 0) > 0) {
      issues.push(`${row.step}: text overflow ${state.textOverflowCount}`);
    }
    if (row.step === 'ready' && Number(state.assetChildren || 0) < 3) {
      issues.push(`${row.step}: expected at least 3 asset rows, got ${state.assetChildren || 0}`);
    }
    if (row.step === 'settings_modal' && !state.settingsOpen) {
      issues.push(`${row.step}: settings modal did not open`);
    }
    if (row.step === 'download_progress' && !String(state.queue?.state || '').trim()) {
      issues.push(`${row.step}: queue state empty`);
    }
    if (row.step === 'download_done') {
      const buttons = Array.isArray(state.downloadButtons) ? state.downloadButtons : [];
      const targetButton = buttons.find((button) => String(button.itemId || '') === '9001');
      if (!targetButton) {
        issues.push(`${row.step}: target download button for item 9001 was not found`);
      } else if (!/インポート|Import/i.test(String(targetButton.text || ''))) {
        issues.push(`${row.step}: target download button did not switch to import (${targetButton.text})`);
      }
    }
    if (row.step === 'avatar_refreshed') {
      const buttons = Array.isArray(state.downloadButtons) ? state.downloadButtons : [];
      const targetButton = buttons.find((button) => String(button.itemId || '') === '9001');
      if (!targetButton || !/繧､繝ｳ繝昴・繝・|インポート|Import/i.test(String(targetButton.text || ''))) {
        issues.push(`${row.step}: target download button did not stay import (${targetButton?.text || 'missing'})`);
      }
      const cards = Array.isArray(state.assetCards) ? state.assetCards : [];
      const targetCard = cards.find((card) => String(card.itemId || '') === '9001');
      const avatarNames = Array.isArray(targetCard?.avatarNames) ? targetCard.avatarNames : [];
      if (!targetCard || (!/Probe Avatar/i.test(String(targetCard.text || '')) && !avatarNames.includes('Probe Avatar'))) {
        issues.push(`${row.step}: supported avatar badge did not render on item 9001`);
      }
    }
    if (row.step === 'download_failed' && String(state.queue?.failed || '0') === '0') {
      issues.push(`${row.step}: failed count did not render`);
    }
  }
  return { ok: Boolean(report.ok) && issues.length === 0, issues, report };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(os.tmpdir(), `avatool_ui_probe_${stamp}`);
  const dataDir = path.resolve(args.dataDir || path.join(base, 'data'));
  const outDir = path.resolve(args.outDir || path.join(base, 'out'));

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  createProbeData(dataDir);

  const electronCmd = require('electron');

  const child = spawn(electronCmd, ['.'], {
    cwd: ROOT,
    env: {
      ...process.env,
      AVATOOL_DATA_DIR: dataDir,
      AVATOOL_UI_PROBE: outDir,
      AVATOOL_KEEP_SESSION: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (buf) => { stdout += buf.toString(); });
  child.stderr.on('data', (buf) => { stderr += buf.toString(); });

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(Number(code || 0)));
    child.on('error', () => resolve(1));
  });

  fs.writeFileSync(path.join(outDir, 'electron_stdout.log'), stdout, 'utf8');
  fs.writeFileSync(path.join(outDir, 'electron_stderr.log'), stderr, 'utf8');

  const reportPath = path.join(outDir, 'ui_probe_report.json');
  if (!fs.existsSync(reportPath)) {
    console.error('UI probe report was not written.');
    console.error(`outDir: ${outDir}`);
    if (stderr.trim()) console.error(stderr.trim());
    process.exit(1);
  }

  const summary = summarizeReport(reportPath);
  fs.writeFileSync(path.join(outDir, 'ui_probe_summary.json'), JSON.stringify({
    ok: summary.ok,
    exitCode,
    issues: summary.issues,
    dataDir,
    outDir,
    reportPath,
    screenshots: summary.report.steps
      .map((row) => row.screenshotPath)
      .filter(Boolean),
  }, null, 2), 'utf8');

  console.log(`UI_PROBE_OUT=${outDir}`);
  console.log(`UI_PROBE_REPORT=${reportPath}`);
  console.log(`UI_PROBE_OK=${summary.ok ? 'true' : 'false'}`);
  if (summary.issues.length) {
    console.log('UI_PROBE_ISSUES=' + JSON.stringify(summary.issues));
  }

  if (!args.keep) {
    // Keep screenshots even when --keep is omitted; only remove the generated app data.
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  } else {
    console.log(`UI_PROBE_DATA=${dataDir}`);
  }

  process.exit(summary.ok && exitCode === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
