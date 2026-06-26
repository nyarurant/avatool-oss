'use strict';

const fs = require('fs');
const path = require('path');

function resolveDataDir() {
  const envDir = String(process.env.AVATOOL_DATA_DIR || '').trim();
  if (envDir) return path.resolve(envDir);
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'avatool', 'data');
  throw new Error('APPDATA or AVATOOL_DATA_DIR is required');
}

function parseArgs(argv) {
  const out = {
    init: false,
    force: false,
    limit: 100,
    file: '',
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = String(argv[i] || '').trim();
    if (!arg) continue;
    if (arg === '--init') out.init = true;
    else if (arg === '--force') out.force = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--file') out.file = String(argv[i + 1] || '').trim();
    else if (arg.startsWith('--file=')) out.file = arg.slice('--file='.length).trim();
    else if (arg === '--limit') out.limit = Math.max(1, Number(argv[i + 1] || 100));
    else if (arg.startsWith('--limit=')) out.limit = Math.max(1, Number(arg.slice('--limit='.length) || 100));
  }
  return out;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function loadLibraryMeta(dataDir) {
  const metaPath = path.join(dataDir, 'librarymeta.json');
  const raw = loadJson(metaPath);
  return Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : Object.values(raw || {}));
}

function writeJsonWithBom(filePath, value) {
  const body = JSON.stringify(value, null, 2);
  fs.writeFileSync(filePath, `\uFEFF${body}\n`, 'utf8');
}

function getPrediction(item) {
  const analysis = item?.supportedAvatarAnalysis && typeof item.supportedAvatarAnalysis === 'object'
    ? item.supportedAvatarAnalysis
    : null;
  const inferred = Array.isArray(item?.supportedAvatarsInferred)
    ? item.supportedAvatarsInferred.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  const confirmed = Array.isArray(item?.supportedAvatars)
    ? item.supportedAvatars.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  if (analysis) {
    const candidates = Array.isArray(analysis.candidates)
      ? analysis.candidates.map((row) => String(row?.name || '').trim()).filter(Boolean)
      : [];
    return {
      primaryAvatar: String(analysis.primaryAvatar || candidates[0] || inferred[0] || confirmed[0] || ''),
      status: String(analysis.status || (candidates.length > 0 ? 'review' : (inferred.length > 0 ? 'legacy-inferred' : 'unclassified'))),
      source: String(analysis.source || (inferred.length > 0 ? 'legacy-inferred' : '')),
      candidates: candidates.length > 0 ? candidates : (inferred.length > 0 ? inferred : confirmed),
    };
  }
  return {
    primaryAvatar: String(inferred[0] || confirmed[0] || ''),
    status: inferred.length > 0 ? 'legacy-inferred' : (confirmed.length > 0 ? 'confirmed-only' : 'unclassified'),
    source: inferred.length > 0 ? 'legacy-inferred' : (confirmed.length > 0 ? 'confirmed-only' : ''),
    candidates: inferred.length > 0 ? inferred : confirmed,
  };
}

function toEvalRow(item) {
  const prediction = getPrediction(item);
  const boothUrl = item?.itemId ? `https://booth.pm/ja/items/${item.itemId}` : '';
  const category = String(item?.primaryCategory?.text || item?.categories?.[0]?.text || '').trim();
  return {
    itemId: String(item?.itemId || ''),
    title: String(item?.itemName || ''),
    shopName: String(item?.authorName || ''),
    boothUrl,
    category,
    predictedAvatar: prediction.primaryAvatar,
    predictedStatus: prediction.status,
    predictedSource: prediction.source,
    candidates: prediction.candidates.slice(0, 5),
    expectedAvatar: '',
    expectedAvatars: [],
    note: '',
  };
}

function writeTemplate(evalPath, items, limit) {
  const rows = items
    .filter((item) => Boolean(item?.supportedAvatarAnalysis || item?.supportedAvatars?.length || item?.supportedAvatarsInferred?.length))
    .sort((a, b) => String(a?.itemName || '').localeCompare(String(b?.itemName || ''), 'ja'))
    .slice(0, limit)
    .map(toEvalRow);
  writeJsonWithBom(evalPath, rows);
  return rows.length;
}

function evaluate(items, labels) {
  const itemMap = new Map(items.map((item) => [String(item?.itemId || ''), item]));
  const labeled = (Array.isArray(labels) ? labels : []).filter((row) => {
    const expectedAvatar = String(row?.expectedAvatar || '').trim();
    const expectedAvatars = Array.isArray(row?.expectedAvatars)
      ? row.expectedAvatars.map((name) => String(name || '').trim()).filter(Boolean)
      : [];
    return Boolean(expectedAvatar) || expectedAvatars.length > 0;
  });
  const stats = {
    labeled: labeled.length,
    exactPrimary: 0,
    inCandidates: 0,
    missingItems: 0,
    mismatches: [],
  };
  for (const row of labeled) {
    const itemId = String(row?.itemId || '').trim();
    const expectedAvatar = String(row?.expectedAvatar || '').trim();
    const expectedAvatars = Array.isArray(row?.expectedAvatars)
      ? row.expectedAvatars.map((name) => String(name || '').trim()).filter(Boolean)
      : [];
    const expectedNames = expectedAvatars.length > 0
      ? expectedAvatars
      : (expectedAvatar ? [expectedAvatar] : []);
    const item = itemMap.get(itemId);
    if (!item) {
      stats.missingItems += 1;
      continue;
    }
    const prediction = getPrediction(item);
    const primary = String(prediction.primaryAvatar || '').trim();
    const candidates = Array.isArray(prediction.candidates) ? prediction.candidates.map((c) => String(c || '').trim()) : [];
    const expectedKeys = expectedNames.map((name) => normalizeName(name)).filter(Boolean);
    if (expectedKeys.includes(normalizeName(primary))) {
      stats.exactPrimary += 1;
    }
    if (candidates.some((name) => expectedKeys.includes(normalizeName(name)))) {
      stats.inCandidates += 1;
    }
    if (!expectedKeys.includes(normalizeName(primary))) {
      stats.mismatches.push({
        itemId,
        title: String(item?.itemName || ''),
        expectedAvatar,
        expectedAvatars: expectedNames,
        predictedAvatar: primary,
        predictedStatus: String(prediction.status || 'unclassified'),
        candidates,
      });
    }
  }
  return stats;
}

function printHelp() {
  console.log([
    'Usage:',
    '  node scripts/eval_avatar_analysis.js --init [--limit 100] [--file path]',
    '  node scripts/eval_avatar_analysis.js [--file path]',
    '',
    'Default eval file:',
    '  %APPDATA%/avatool/data/avatar_analysis_eval.json',
  ].join('\n'));
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const dataDir = resolveDataDir();
  const evalPath = args.file ? path.resolve(args.file) : path.join(dataDir, 'avatar_analysis_eval.json');
  const items = loadLibraryMeta(dataDir);

  if (args.init) {
    if (fs.existsSync(evalPath) && !args.force) {
      throw new Error(`eval file already exists: ${evalPath} (use --force to overwrite)`);
    }
    const count = writeTemplate(evalPath, items, args.limit);
    console.log(`Wrote eval template: ${evalPath}`);
    console.log(`Rows: ${count}`);
    console.log('Fill expectedAvatar for real items, then run this script again without --init.');
    return;
  }

  if (!fs.existsSync(evalPath)) {
    throw new Error(`eval file not found: ${evalPath} (run with --init first)`);
  }

  const labels = loadJson(evalPath);
  const stats = evaluate(items, labels);
  const exactPct = stats.labeled > 0 ? ((stats.exactPrimary / stats.labeled) * 100).toFixed(1) : '0.0';
  const candidatePct = stats.labeled > 0 ? ((stats.inCandidates / stats.labeled) * 100).toFixed(1) : '0.0';

  console.log(`Data dir        : ${dataDir}`);
  console.log(`Eval file       : ${evalPath}`);
  console.log(`Labeled rows    : ${stats.labeled}`);
  console.log(`Exact primary   : ${stats.exactPrimary} (${exactPct}%)`);
  console.log(`In candidates   : ${stats.inCandidates} (${candidatePct}%)`);
  console.log(`Missing items   : ${stats.missingItems}`);

  if (stats.mismatches.length > 0) {
    console.log('\nMismatches:');
    for (const row of stats.mismatches.slice(0, 30)) {
      console.log(`- ${row.itemId} ${row.title}`);
      console.log(`  expected: ${row.expectedAvatars?.join(', ') || row.expectedAvatar}`);
      console.log(`  predicted: ${row.predictedAvatar || '-'} (${row.predictedStatus})`);
      console.log(`  candidates: ${row.candidates.join(', ') || '-'}`);
    }
    if (stats.mismatches.length > 30) {
      console.log(`... and ${stats.mismatches.length - 30} more`);
    }
  }
}

main();
