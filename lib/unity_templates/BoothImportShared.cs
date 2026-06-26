using UnityEditor;
using UnityEngine;
using System;
using System.Collections.Generic;
using System.IO;

public static class BoothImportShared {
    [Serializable]
    public class RenameEntry {
        public string packagePath;
        public string sourceTopFolder;
        public string targetTopFolder;
    }

    internal static string NormalizePathKey(string p) {
        if (string.IsNullOrEmpty(p)) return "";
        try {
            return Path.GetFullPath(p).Replace("\\", "/").ToLowerInvariant();
        } catch {
            return p.Replace("\\", "/").ToLowerInvariant();
        }
    }

    internal static string BuildUniqueTopFolderAssetPath(string preferredName) {
        string baseName = (preferredName ?? "").Trim();
        if (string.IsNullOrEmpty(baseName)) baseName = "BoothAsset";
        string candidate = "Assets/" + baseName;
        int i = 2;
        while (AssetDatabase.IsValidFolder(candidate)) {
            candidate = "Assets/" + baseName + "_" + i;
            i += 1;
            if (i > 9999) break;
        }
        return candidate;
    }

    internal static string BuildTempBackupTopFolderName(string srcTopFolder) {
        string seed = (srcTopFolder ?? "").Trim();
        if (string.IsNullOrEmpty(seed)) seed = "BoothAsset";
        string stamp = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        return "__avatool_backup_" + seed + "_" + stamp;
    }

    internal static string ToProjectFsPath(string assetPath) {
        string projectRoot = Directory.GetParent(Application.dataPath).FullName;
        string rel = (assetPath ?? "").Replace("/", "\\").TrimStart('\\');
        return Path.Combine(projectRoot, rel);
    }

    internal static bool TryMergeTopFolderInto(string srcAssetPath, string dstAssetPath, string logTag) {
        try {
            if (!AssetDatabase.IsValidFolder(srcAssetPath) || !AssetDatabase.IsValidFolder(dstAssetPath)) return false;
            string srcFs = ToProjectFsPath(srcAssetPath);
            if (!Directory.Exists(srcFs)) return false;
            MergeFolderRecursive(srcAssetPath, dstAssetPath, logTag);
            if (AssetDatabase.IsValidFolder(srcAssetPath) && Directory.Exists(srcFs)) {
                if (!HasNonMetaFiles(srcFs)) {
                    AssetDatabase.DeleteAsset(srcAssetPath);
                }
            }
            return true;
        } catch (Exception ex) {
            Debug.LogWarning(logTag + " Merge failed: " + ex.Message);
            return false;
        }
    }

    internal static void PrepareTopFolderForPackage(
        string pkgPath,
        Dictionary<string, RenameEntry> renameByPackage,
        Dictionary<string, string> backedUpSourceByPackage,
        string logTag) {
        if (string.IsNullOrEmpty(pkgPath)) return;
        RenameEntry entry = null;
        string key = NormalizePathKey(pkgPath);
        if (!renameByPackage.TryGetValue(key, out entry) || entry == null) return;
        string src = (entry.sourceTopFolder ?? "").Trim();
        if (string.IsNullOrEmpty(src)) return;
        string srcAssetPath = "Assets/" + src;
        if (!AssetDatabase.IsValidFolder(srcAssetPath)) return;
        if (backedUpSourceByPackage.ContainsKey(key)) return;

        string backupAssetPath = BuildUniqueTopFolderAssetPath(BuildTempBackupTopFolderName(src));
        string err = AssetDatabase.MoveAsset(srcAssetPath, backupAssetPath);
        if (!string.IsNullOrEmpty(err)) {
            Debug.LogWarning(logTag + " Pre-import backup failed: " + srcAssetPath + " -> " + backupAssetPath + " / " + err);
            return;
        }
        backedUpSourceByPackage[key] = backupAssetPath;
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
        Debug.Log(logTag + " Pre-import backup done: " + srcAssetPath + " -> " + backupAssetPath);
    }

    private static void MergeFolderRecursive(string srcAssetPath, string dstAssetPath, string logTag) {
        string srcFs = ToProjectFsPath(srcAssetPath);
        if (!Directory.Exists(srcFs)) return;
        string[] entries = Directory.GetFileSystemEntries(srcFs);
        for (int i = 0; i < entries.Length; i++) {
            string name = Path.GetFileName(entries[i]);
            if (string.IsNullOrEmpty(name) || name.EndsWith(".meta", StringComparison.OrdinalIgnoreCase)) continue;
            string srcChild = srcAssetPath + "/" + name;
            string dstChild = dstAssetPath + "/" + name;
            if (AssetDatabase.IsValidFolder(srcChild)) {
                if (!AssetDatabase.IsValidFolder(dstChild)) {
                    string moveErr = AssetDatabase.MoveAsset(srcChild, dstChild);
                    if (!string.IsNullOrEmpty(moveErr)) {
                        Debug.LogWarning(logTag + " Merge move failed: " + srcChild + " -> " + dstChild + " / " + moveErr);
                    }
                } else {
                    MergeFolderRecursive(srcChild, dstChild, logTag);
                    string srcChildFs = ToProjectFsPath(srcChild);
                    if (Directory.Exists(srcChildFs) && !HasNonMetaFiles(srcChildFs)) {
                        AssetDatabase.DeleteAsset(srcChild);
                    }
                }
            } else {
                if (AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(dstChild) != null) {
                    Debug.LogWarning(logTag + " Merge skipped (already exists): " + dstChild);
                } else {
                    string moveErr = AssetDatabase.MoveAsset(srcChild, dstChild);
                    if (!string.IsNullOrEmpty(moveErr)) {
                        Debug.LogWarning(logTag + " Merge move failed: " + srcChild + " -> " + dstChild + " / " + moveErr);
                    }
                }
            }
        }
    }

    private static bool HasNonMetaFiles(string dirFs) {
        string[] entries = Directory.GetFileSystemEntries(dirFs);
        for (int i = 0; i < entries.Length; i++) {
            string n = Path.GetFileName(entries[i]);
            if (!string.IsNullOrEmpty(n) && !n.EndsWith(".meta", StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }
}
