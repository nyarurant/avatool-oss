const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { scanUnityPackage } = require('../lib/unity_package_scanner');

const ROOT = path.resolve(__dirname, '..');
const IMPORT_LOG_PATH = path.join(ROOT, 'unity_import_history.json');

const IMPORTER_CS_CONTENT = `
using UnityEditor;
using System;
using System.IO;
using System.Reflection;
using UnityEngine;

public class BoothBatchImporter {
    [System.Serializable]
    public class ImportList {
        public string[] files;
    }

    private static string ResolveImportListPath() {
        string[] args = Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length - 1; i++) {
            if (args[i] == "-boothImportList") {
                return args[i + 1];
            }
        }
        return Path.Combine(Directory.GetCurrentDirectory(), "booth_import_list.json");
    }

    private static void ImportPackageStable(string pkgPath) {
        MethodInfo m = typeof(AssetDatabase).GetMethod(
            "ImportPackageImmediately",
            BindingFlags.NonPublic | BindingFlags.Static
        );
        if (m != null) {
            m.Invoke(null, new object[] { pkgPath });
            return;
        }
        AssetDatabase.ImportPackage(pkgPath, false);
    }

    public static void ImportFromList() {
        string listPath = ResolveImportListPath();
        if (!File.Exists(listPath)) {
            Debug.LogError("[BoothBatchImporter] List file not found: " + listPath);
            EditorApplication.Exit(1);
            return;
        }

        try {
            string json = File.ReadAllText(listPath);
            ImportList data = JsonUtility.FromJson<ImportList>(json);
            if (data == null || data.files == null || data.files.Length == 0) {
                Debug.LogError("[BoothBatchImporter] Import list is empty.");
                EditorApplication.Exit(1);
                return;
            }

            foreach (string pkgPath in data.files) {
                if (!File.Exists(pkgPath)) continue;
                Debug.Log("[BoothBatchImporter] Importing: " + pkgPath);
                ImportPackageStable(pkgPath);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            }
        } catch (Exception e) {
            Debug.LogError("[BoothBatchImporter] Error: " + e);
            EditorApplication.Exit(1);
            return;
        }

        Debug.Log("[BoothBatchImporter] Done.");
    }
}
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (!v.startsWith('--')) {
      out._.push(v);
      continue;
    }
    const key = v.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    if (out[key] === undefined) out[key] = next;
    else if (Array.isArray(out[key])) out[key].push(next);
    else out[key] = [out[key], next];
    i++;
  }
  return out;
}

function arr(v) {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadImportHistory() {
  try {
    if (!fs.existsSync(IMPORT_LOG_PATH)) return {};
    return readJson(IMPORT_LOG_PATH) || {};
  } catch {
    return {};
  }
}

function saveImportHistory(history) {
  fs.writeFileSync(IMPORT_LOG_PATH, JSON.stringify(history, null, 2), 'utf8');
}

function appendImportHistory(projectPath, packages) {
  const history = loadImportHistory();
  const projectName = path.basename(projectPath || '');
  const importedAt = new Date().toISOString();
  for (const p of packages) {
    const key = String(p.itemId || '').trim();
    if (!key) continue;
    if (!Array.isArray(history[key])) history[key] = [];
    history[key].push({
      projectPath,
      projectName,
      importedAt,
      packagePath: p.packagePath,
      topFolders: p.meta?.topFolders || [],
      tokens: p.meta?.tokens || [],
    });
  }
  saveImportHistory(history);
}

function isUnityProjectLocked(projectPath) {
  try {
    return fs.existsSync(path.join(projectPath, 'Temp', 'UnityLockfile'));
  } catch {
    return false;
  }
}

function ensureImporter(projectPath) {
  const editorDir = path.join(projectPath, 'Assets', 'Editor');
  fs.mkdirSync(editorDir, { recursive: true });
  const scriptPath = path.join(editorDir, 'BoothBatchImporter.cs');
  fs.writeFileSync(scriptPath, IMPORTER_CS_CONTENT.trim(), 'utf8');
  return scriptPath;
}

function runUnityBatchImport(unityPath, projectPath, packagePaths) {
  const listPath = path.join(projectPath, 'booth_import_list.json');
  fs.writeFileSync(listPath, JSON.stringify({ files: packagePaths }, null, 2), 'utf8');

  const logDir = path.join(ROOT, 'unity_logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `batch_import_${Date.now()}.log`);

  const args = [
    '-quit',
    '-batchmode',
    '-projectPath', projectPath,
    '-executeMethod', 'BoothBatchImporter.ImportFromList',
    '-boothImportList', listPath,
    '-logFile', logPath,
  ];

  return new Promise((resolve) => {
    const proc = spawn(unityPath, args, { windowsHide: true });
    proc.on('close', (code) => {
      if (code === 0) resolve({ ok: true, logPath });
      else resolve({ error: `unity_exit_code_${code}`, logPath });
    });
    proc.on('error', (err) => resolve({ error: err.message }));
  });
}

async function cmdScan(args) {
  const pkgPath = String(args.pkg || '').trim();
  if (!pkgPath) throw new Error('--pkg is required');
  const tokens = String(args.tokens || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const res = scanUnityPackage(pkgPath, tokens);
  console.log(JSON.stringify(res, null, 2));
}

function cmdHistory(args) {
  const history = loadImportHistory();
  const itemId = String(args.itemId || '').trim();
  if (!itemId) {
    console.log(JSON.stringify(history, null, 2));
    return;
  }
  console.log(JSON.stringify({ [itemId]: history[itemId] || [] }, null, 2));
}

function reconcilePackageToProject(projectPath, pkg) {
  const packagePath = String(pkg.packagePath || '').trim();
  const meta = pkg.meta && Array.isArray(pkg.meta.assetPaths)
    ? pkg.meta
    : scanUnityPackage(packagePath, []);
  const assetPaths = Array.isArray(meta.assetPaths) ? meta.assetPaths : [];
  const topFolders = Array.isArray(meta.topFolders) ? meta.topFolders : [];
  const existingAssetPaths = [];
  for (const rel of assetPaths) {
    const fsPath = path.join(projectPath, rel.replace(/\//g, path.sep));
    if (fs.existsSync(fsPath)) existingAssetPaths.push(rel);
  }
  const existingTopFolders = [];
  for (const tf of topFolders) {
    const folderPath = path.join(projectPath, 'Assets', String(tf.name || ''));
    if (fs.existsSync(folderPath)) existingTopFolders.push(tf);
  }
  const totalAssetCount = assetPaths.length;
  const matchedAssetCount = existingAssetPaths.length;
  const matchedTopFolderCount = existingTopFolders.length;
  return {
    itemId: String(pkg.itemId || ''),
    title: String(pkg.title || ''),
    packagePath,
    matched: matchedAssetCount > 0 || matchedTopFolderCount > 0,
    score: totalAssetCount > 0 ? matchedAssetCount / totalAssetCount : 0,
    matchedAssetCount,
    totalAssetCount,
    matchedTopFolderCount,
    existingTopFolders,
    sampleExistingPaths: existingAssetPaths.slice(0, 20),
    meta: {
      topFolders,
      tokens: Array.isArray(meta.tokens) ? meta.tokens : [],
      assetPaths,
    },
  };
}

function cmdReconcile(args) {
  const projectPath = String(args.project || '').trim();
  if (!projectPath) throw new Error('--project is required');
  if (!fs.existsSync(projectPath)) throw new Error('project_not_found');
  const packages = buildPackages(args);
  const results = packages.map((p) => reconcilePackageToProject(projectPath, p));
  const matched = results.filter((r) => r.matched);
  console.log(JSON.stringify({
    ok: true,
    projectPath,
    total: packages.length,
    matched: matched.length,
    results,
  }, null, 2));
}

function buildPackages(args) {
  if (args.manifest) {
    const manifestPath = path.resolve(String(args.manifest));
    const payload = readJson(manifestPath);
    if (!Array.isArray(payload)) throw new Error('manifest must be an array');
    return payload;
  }

  const itemId = String(args.itemId || '').trim();
  const title = String(args.title || '').trim();
  const pkgs = arr(args.pkg).map((p) => String(p || '').trim()).filter(Boolean);
  if (!pkgs.length) throw new Error('at least one --pkg is required');
  return pkgs.map((pkgPath) => {
    const candidates = [title].filter(Boolean);
    const meta = scanUnityPackage(pkgPath, candidates);
    return {
      itemId,
      title,
      packagePath: pkgPath,
      meta: {
        topFolders: meta.topFolders,
        tokens: meta.tokens,
      },
    };
  });
}

async function cmdImport(args) {
  const unityPath = String(args.unity || '').trim();
  const projectPath = String(args.project || '').trim();
  if (!unityPath) throw new Error('--unity is required');
  if (!projectPath) throw new Error('--project is required');
  if (!fs.existsSync(unityPath)) throw new Error('unity_not_found');
  if (!fs.existsSync(projectPath)) throw new Error('project_not_found');
  if (isUnityProjectLocked(projectPath)) throw new Error('project_already_open');

  const packages = buildPackages(args);
  const valid = packages.filter((p) => fs.existsSync(String(p.packagePath || '')));
  if (!valid.length) throw new Error('no_valid_packages');

  const scriptPath = ensureImporter(projectPath);
  console.log(`[debug-import] importer script: ${scriptPath}`);
  const result = await runUnityBatchImport(unityPath, projectPath, valid.map((p) => p.packagePath));
  console.log(JSON.stringify(result, null, 2));

  if (result.ok) {
    appendImportHistory(projectPath, valid);
    console.log(`[debug-import] history updated: ${IMPORT_LOG_PATH}`);
  }
}

function help() {
  console.log(`Usage:
  node scripts/debug-import.js scan --pkg <path> [--tokens token1,token2]
  node scripts/debug-import.js history [--itemId <id>]
  node scripts/debug-import.js reconcile --project <projectPath> --manifest <packages.json>
  node scripts/debug-import.js reconcile --project <projectPath> --itemId <id> --title <title> --pkg <path> [--pkg <path2>]
  node scripts/debug-import.js import --unity <unity.exe> --project <projectPath> --manifest <packages.json>
  node scripts/debug-import.js import --unity <unity.exe> --project <projectPath> --itemId <id> --title <title> --pkg <path> [--pkg <path2>]

Manifest format (array):
[
  {
    "itemId": "5957830",
    "title": "rurune",
    "packagePath": "C:/.../rurune.unitypackage",
    "meta": { "topFolders": [{"name":"IKUSIA","count":1766}], "tokens": ["ikusia","rurune"] }
  }
]`);
}

(async () => {
  try {
    const args = parseArgs(process.argv.slice(2));
    const cmd = args._[0];
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
      help();
      return;
    }

    if (cmd === 'scan') {
      await cmdScan(args);
      return;
    }
    if (cmd === 'history') {
      cmdHistory(args);
      return;
    }
    if (cmd === 'reconcile') {
      cmdReconcile(args);
      return;
    }
    if (cmd === 'import') {
      await cmdImport(args);
      return;
    }

    throw new Error(`unknown_command: ${cmd}`);
  } catch (e) {
    console.error('[debug-import] failed:', e.message || e);
    process.exit(1);
  }
})();

