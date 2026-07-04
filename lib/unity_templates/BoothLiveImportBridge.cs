using UnityEditor;
using UnityEngine;
using System;
using System.IO;
using System.Collections.Generic;

[InitializeOnLoad]
public static class BoothLiveImportBridge {
    [Serializable]
    public class LiveImportList {
        public string[] files;
        public BoothImportShared.RenameEntry[] renames;
    }

    [Serializable]
    public class BackupEntry {
        public string key;
        public string assetPath;
    }

    [Serializable]
    public class LiveImportState {
        public string currentPackagePath;
        public BoothImportShared.RenameEntry[] renames;
        public BackupEntry[] backups;
    }

    private const string QueueFileName = "booth_live_import_queue.json";
    private const string StateFileName = "booth_live_import_state.json";
    private const string ResultLogFileName = "booth_live_import_result.log";
    private static readonly Queue<string> Pending = new Queue<string>();
    private static readonly Dictionary<string, BoothImportShared.RenameEntry> RenameByPackage = new Dictionary<string, BoothImportShared.RenameEntry>();
    private static readonly Dictionary<string, string> BackedUpSourceByPackage = new Dictionary<string, string>();
    private static bool sImporting = false;
    private static double sNextPollAt = 0;
    private static string sCurrentPackagePath = "";

    static BoothLiveImportBridge() {
        EditorApplication.update += OnUpdate;
    }

    private static string QueuePath {
        get {
            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            return Path.Combine(projectRoot, QueueFileName);
        }
    }

    private static string ResultLogPath {
        get {
            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            return Path.Combine(projectRoot, ResultLogFileName);
        }
    }

    private static string StatePath {
        get {
            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            return Path.Combine(projectRoot, StateFileName);
        }
    }

    private static void AppendResultLog(string status, string packageName, string detail) {
        try {
            string ts = DateTime.UtcNow.ToString("o");
            string msg = string.IsNullOrEmpty(detail)
                ? ts + " " + status + " " + packageName
                : ts + " " + status + " " + packageName + ": " + detail;
            File.AppendAllText(ResultLogPath, msg + "\n", System.Text.Encoding.UTF8);
        } catch { }
    }

    private static void SaveActiveImportState(string pkgPath) {
        try {
            List<BoothImportShared.RenameEntry> renames = new List<BoothImportShared.RenameEntry>();
            foreach (KeyValuePair<string, BoothImportShared.RenameEntry> kv in RenameByPackage) {
                if (kv.Value != null) renames.Add(kv.Value);
            }
            List<BackupEntry> backups = new List<BackupEntry>();
            foreach (KeyValuePair<string, string> kv in BackedUpSourceByPackage) {
                backups.Add(new BackupEntry { key = kv.Key, assetPath = kv.Value });
            }
            LiveImportState state = new LiveImportState {
                currentPackagePath = pkgPath,
                renames = renames.ToArray(),
                backups = backups.ToArray()
            };
            File.WriteAllText(StatePath, JsonUtility.ToJson(state, true), System.Text.Encoding.UTF8);
        } catch (Exception ex) {
            Debug.LogWarning("[BoothLiveImportBridge] State save failed: " + ex.Message);
        }
    }

    private static void ClearActiveImportState() {
        try {
            string statePath = StatePath;
            if (File.Exists(statePath)) File.Delete(statePath);
        } catch { }
    }

    private static bool RecoverActiveImportState() {
        try {
            string statePath = StatePath;
            if (!File.Exists(statePath)) return false;
            string json = File.ReadAllText(statePath);
            if (string.IsNullOrEmpty(json)) {
                File.Delete(statePath);
                return false;
            }
            LiveImportState state = JsonUtility.FromJson<LiveImportState>(json);
            File.Delete(statePath);
            if (state == null || string.IsNullOrEmpty(state.currentPackagePath)) return false;

            if (state.renames != null) {
                for (int i = 0; i < state.renames.Length; i++) {
                    BoothImportShared.RenameEntry e = state.renames[i];
                    if (e == null || string.IsNullOrEmpty(e.packagePath)) continue;
                    RenameByPackage[BoothImportShared.NormalizePathKey(e.packagePath)] = e;
                }
            }
            if (state.backups != null) {
                for (int i = 0; i < state.backups.Length; i++) {
                    BackupEntry b = state.backups[i];
                    if (b == null || string.IsNullOrEmpty(b.key) || string.IsNullOrEmpty(b.assetPath)) continue;
                    BackedUpSourceByPackage[b.key] = b.assetPath;
                }
            }

            TryRenameForPackage(state.currentPackagePath);
            string packageName = Path.GetFileNameWithoutExtension(state.currentPackagePath);
            AppendResultLog("COMPLETED", packageName, "recovered-after-domain-reload");
            Debug.Log("[BoothLiveImportBridge] Recovered active import after domain reload: " + state.currentPackagePath);
            return true;
        } catch (Exception ex) {
            Debug.LogWarning("[BoothLiveImportBridge] State recovery failed: " + ex.Message);
            return false;
        }
    }

    private static void TryRenameForPackage(string pkgPath) {
        if (string.IsNullOrEmpty(pkgPath)) return;
        BoothImportShared.RenameEntry entry = null;
        string key = BoothImportShared.NormalizePathKey(pkgPath);
        if (!RenameByPackage.TryGetValue(key, out entry) || entry == null) return;
        string src = (entry.sourceTopFolder ?? "").Trim();
        string dst = (entry.targetTopFolder ?? "").Trim();
        if (string.IsNullOrEmpty(src) || string.IsNullOrEmpty(dst)) return;
        if (string.Equals(src, dst, StringComparison.OrdinalIgnoreCase)) return;
        string srcAssetPath = "Assets/" + src;
        string dstAssetPath = "Assets/" + dst;
        string finalAssetPath = dstAssetPath;
        string backupAssetPath = "";
        if (BackedUpSourceByPackage.ContainsKey(key)) {
            backupAssetPath = BackedUpSourceByPackage[key];
        }

        if (!AssetDatabase.IsValidFolder(srcAssetPath)) {
            if (!string.IsNullOrEmpty(backupAssetPath) && AssetDatabase.IsValidFolder(backupAssetPath)) {
                if (AssetDatabase.IsValidFolder(dstAssetPath)) {
                    bool merged = BoothImportShared.TryMergeTopFolderInto(backupAssetPath, dstAssetPath, "[BoothLiveImportBridge]");
                    if (merged) {
                        Debug.Log("[BoothLiveImportBridge] Source missing; merged backup into target: " + backupAssetPath + " -> " + dstAssetPath);
                    } else {
                        Debug.LogWarning("[BoothLiveImportBridge] Source missing; backup merge failed and was kept: " + backupAssetPath + " -> " + dstAssetPath);
                        return;
                    }
                } else {
                    string renameBackupErr = AssetDatabase.MoveAsset(backupAssetPath, dstAssetPath);
                    if (!string.IsNullOrEmpty(renameBackupErr)) {
                        Debug.LogWarning("[BoothLiveImportBridge] Source missing; backup rename failed: " + backupAssetPath + " -> " + dstAssetPath + " / " + renameBackupErr);
                        return;
                    }
                    Debug.Log("[BoothLiveImportBridge] Source missing; renamed backup to target: " + backupAssetPath + " -> " + dstAssetPath);
                }
                BackedUpSourceByPackage.Remove(key);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                return;
            }
            BackedUpSourceByPackage.Remove(key);
            return;
        }

        if (AssetDatabase.IsValidFolder(dstAssetPath)) {
            bool merged = BoothImportShared.TryMergeTopFolderInto(srcAssetPath, dstAssetPath, "[BoothLiveImportBridge]");
            if (merged) {
                Debug.Log("[BoothLiveImportBridge] Merged top folder into existing target: " + srcAssetPath + " -> " + dstAssetPath);
            } else {
                string desiredName = (dst ?? "").Trim();
                if (string.IsNullOrEmpty(desiredName)) desiredName = src;
                string fallbackDst = BoothImportShared.BuildUniqueTopFolderAssetPath(desiredName);
                Debug.LogWarning("[BoothLiveImportBridge] Rename target exists. fallback target: " + dstAssetPath + " -> " + fallbackDst);
                string fallbackErr = AssetDatabase.MoveAsset(srcAssetPath, fallbackDst);
                if (!string.IsNullOrEmpty(fallbackErr)) {
                    Debug.LogWarning("[BoothLiveImportBridge] Rename failed: " + srcAssetPath + " -> " + fallbackDst + " / " + fallbackErr);
                    BackedUpSourceByPackage.Remove(key);
                    return;
                }
                finalAssetPath = fallbackDst;
                Debug.Log("[BoothLiveImportBridge] Renamed top folder: " + srcAssetPath + " -> " + fallbackDst);
            }
        } else {
            string err = AssetDatabase.MoveAsset(srcAssetPath, dstAssetPath);
            if (!string.IsNullOrEmpty(err)) {
                Debug.LogWarning("[BoothLiveImportBridge] Rename failed: " + srcAssetPath + " -> " + dstAssetPath + " / " + err);
                BackedUpSourceByPackage.Remove(key);
                return;
            }
            Debug.Log("[BoothLiveImportBridge] Renamed top folder: " + srcAssetPath + " -> " + dstAssetPath);
        }

        if (!string.IsNullOrEmpty(backupAssetPath) && AssetDatabase.IsValidFolder(backupAssetPath)) {
            bool backupMerged = BoothImportShared.TryMergeTopFolderInto(backupAssetPath, finalAssetPath, "[BoothLiveImportBridge]");
            if (!backupMerged && AssetDatabase.IsValidFolder(backupAssetPath)) {
                AssetDatabase.DeleteAsset(backupAssetPath);
                Debug.LogWarning("[BoothLiveImportBridge] Backup merge failed, deleted: " + backupAssetPath);
            }
        }
        BackedUpSourceByPackage.Remove(key);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
    }

    private static void RestoreOnlyForPackage(string pkgPath) {
        if (string.IsNullOrEmpty(pkgPath)) return;
        string key = BoothImportShared.NormalizePathKey(pkgPath);
        string backupAssetPath = "";
        if (!BackedUpSourceByPackage.TryGetValue(key, out backupAssetPath)) return;
        BoothImportShared.RenameEntry entry = null;
        if (!RenameByPackage.TryGetValue(key, out entry) || entry == null) {
            BackedUpSourceByPackage.Remove(key);
            return;
        }
        string src = (entry.sourceTopFolder ?? "").Trim();
        if (string.IsNullOrEmpty(src)) {
            BackedUpSourceByPackage.Remove(key);
            return;
        }
        string srcAssetPath = "Assets/" + src;
        if (!AssetDatabase.IsValidFolder(backupAssetPath)) {
            BackedUpSourceByPackage.Remove(key);
            return;
        }
        if (AssetDatabase.IsValidFolder(srcAssetPath)) {
            Debug.LogWarning("[BoothLiveImportBridge] Restore skipped (source already exists): " + srcAssetPath + " / backup=" + backupAssetPath);
            BackedUpSourceByPackage.Remove(key);
            return;
        }
        string err = AssetDatabase.MoveAsset(backupAssetPath, srcAssetPath);
        if (!string.IsNullOrEmpty(err)) {
            Debug.LogWarning("[BoothLiveImportBridge] Restore failed: " + backupAssetPath + " -> " + srcAssetPath + " / " + err);
            return;
        }
        BackedUpSourceByPackage.Remove(key);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        Debug.Log("[BoothLiveImportBridge] Restore done: " + backupAssetPath + " -> " + srcAssetPath);
    }

    private static void OnUpdate() {
        if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
        if (sImporting) return;
        if (RecoverActiveImportState()) return;
        if (Pending.Count == 0) {
            if (EditorApplication.timeSinceStartup < sNextPollAt) return;
            sNextPollAt = EditorApplication.timeSinceStartup + 0.8;
            LoadQueue();
            if (Pending.Count == 0) return;
        }

        string pkgPath = Pending.Dequeue();
        if (string.IsNullOrEmpty(pkgPath) || !File.Exists(pkgPath)) {
            Debug.LogWarning("[BoothLiveImportBridge] Package missing: " + pkgPath);
            return;
        }

        sImporting = true;
        sCurrentPackagePath = pkgPath;
        try {
            BoothImportShared.PrepareTopFolderForPackage(pkgPath, RenameByPackage, BackedUpSourceByPackage, "[BoothLiveImportBridge]");
            SaveActiveImportState(pkgPath);
            AssetDatabase.importPackageCompleted += OnImportCompleted;
            AssetDatabase.importPackageCancelled += OnImportCancelled;
            AssetDatabase.importPackageFailed += OnImportFailed;
            Debug.Log("[BoothLiveImportBridge] Importing: " + pkgPath);
            AssetDatabase.ImportPackage(pkgPath, false);
        } catch (Exception ex) {
            RestoreOnlyForPackage(sCurrentPackagePath);
            ClearActiveImportState();
            ClearImportHooks();
            sImporting = false;
            sCurrentPackagePath = "";
            Debug.LogError("[BoothLiveImportBridge] ImportPackage threw: " + ex.Message);
        }
    }

    private static void LoadQueue() {
        try {
            string queuePath = QueuePath;
            if (!File.Exists(queuePath)) return;
            string json = File.ReadAllText(queuePath);
            if (string.IsNullOrEmpty(json)) {
                File.Delete(queuePath);
                return;
            }
            LiveImportList data = JsonUtility.FromJson<LiveImportList>(json);
            File.Delete(queuePath);
            if (data == null || data.files == null || data.files.Length == 0) return;
            for (int i = 0; i < data.files.Length; i++) {
                string p = data.files[i];
                if (string.IsNullOrEmpty(p)) continue;
                Pending.Enqueue(p);
            }
            if (data.renames != null) {
                for (int i = 0; i < data.renames.Length; i++) {
                    BoothImportShared.RenameEntry e = data.renames[i];
                    if (e == null) continue;
                    string key = BoothImportShared.NormalizePathKey(e.packagePath);
                    string src = (e.sourceTopFolder ?? "").Trim();
                    string dst = (e.targetTopFolder ?? "").Trim();
                    if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(src) || string.IsNullOrEmpty(dst)) continue;
                    RenameByPackage[key] = e;
                }
            }
            Debug.Log("[BoothLiveImportBridge] queued " + Pending.Count + " package(s).");
        } catch (Exception e) {
            Debug.LogWarning("[BoothLiveImportBridge] queue load failed: " + e.Message);
        }
    }

    private static void ClearImportHooks() {
        AssetDatabase.importPackageCompleted -= OnImportCompleted;
        AssetDatabase.importPackageCancelled -= OnImportCancelled;
        AssetDatabase.importPackageFailed -= OnImportFailed;
    }

    private static void OnImportCompleted(string packageName) {
        TryRenameForPackage(sCurrentPackagePath);
        ClearActiveImportState();
        ClearImportHooks();
        sImporting = false;
        sCurrentPackagePath = "";
        Debug.Log("[BoothLiveImportBridge] Completed: " + packageName);
        AppendResultLog("COMPLETED", packageName, null);
    }

    private static void OnImportCancelled(string packageName) {
        RestoreOnlyForPackage(sCurrentPackagePath);
        ClearActiveImportState();
        ClearImportHooks();
        sImporting = false;
        sCurrentPackagePath = "";
        Debug.LogWarning("[BoothLiveImportBridge] Cancelled: " + packageName);
        AppendResultLog("CANCELLED", packageName, null);
    }

    private static void OnImportFailed(string packageName, string errorMessage) {
        RestoreOnlyForPackage(sCurrentPackagePath);
        ClearActiveImportState();
        ClearImportHooks();
        sImporting = false;
        sCurrentPackagePath = "";
        Debug.LogError("[BoothLiveImportBridge] Failed: " + packageName + " / " + errorMessage);
        AppendResultLog("FAILED", packageName, errorMessage);
    }
}
