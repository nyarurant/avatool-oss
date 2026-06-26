using UnityEditor;
using UnityEngine;
using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Net.Sockets;
using System.Text;
using System.Collections.Generic;

public class BoothBatchImporter {
    [System.Serializable]
    public class ImportList {
        public string[] files;
    }

    [System.Serializable]
    public class RenamePlan {
        public BoothImportShared.RenameEntry[] entries;
    }

    private static bool sTrackAssetProgress = false;
    private static int sPackageIndex = 0;
    private static int sPackageTotal = 0;
    private static int sPackageImportedAssets = 0;
    private static int sPackageEstimatedAssets = 1;
    private static string sIpcHost = "127.0.0.1";
    private static int sIpcPort = 0;
    private static Dictionary<string, BoothImportShared.RenameEntry> sRenameByPackage = new Dictionary<string, BoothImportShared.RenameEntry>();
    private static Dictionary<string, string> sBackedUpSourceByPackage = new Dictionary<string, string>();

    public static bool IsTrackingAssetProgress {
        get { return sTrackAssetProgress; }
    }

    private static string ResolveArgValue(string[] args, string key, string fallback) {
        for (int i = 0; i < args.Length - 1; i++) {
            if (args[i] == key) return args[i + 1];
        }
        return fallback;
    }

    private static int ParseIntSafe(string raw, int fallback) {
        int v;
        if (int.TryParse(raw, out v)) return v;
        return fallback;
    }

    private static void LoadRenamePlan(string planPath) {
        sRenameByPackage.Clear();
        if (string.IsNullOrEmpty(planPath)) return;
        try {
            if (!File.Exists(planPath)) return;
            string raw = File.ReadAllText(planPath);
            if (string.IsNullOrEmpty(raw)) return;
            RenamePlan plan = JsonUtility.FromJson<RenamePlan>(raw);
            if (plan == null || plan.entries == null) return;
            for (int i = 0; i < plan.entries.Length; i++) {
                BoothImportShared.RenameEntry e = plan.entries[i];
                if (e == null) continue;
                string key = BoothImportShared.NormalizePathKey(e.packagePath);
                string src = (e.sourceTopFolder ?? "").Trim();
                string dst = (e.targetTopFolder ?? "").Trim();
                if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(src) || string.IsNullOrEmpty(dst)) continue;
                if (string.Equals(src, dst, StringComparison.OrdinalIgnoreCase)) continue;
                sRenameByPackage[key] = e;
            }
        } catch (Exception ex) {
            Debug.LogWarning("[BoothBatchImporter] Rename plan load failed: " + ex.Message);
        }
    }

    private static void ApplyTopFolderRenameForPackage(string pkgPath) {
        if (string.IsNullOrEmpty(pkgPath)) return;
        BoothImportShared.RenameEntry entry = null;
        string key = BoothImportShared.NormalizePathKey(pkgPath);
        if (!sRenameByPackage.TryGetValue(key, out entry) || entry == null) return;
        string src = (entry.sourceTopFolder ?? "").Trim();
        string dst = (entry.targetTopFolder ?? "").Trim();
        if (string.IsNullOrEmpty(src) || string.IsNullOrEmpty(dst)) return;
        if (string.Equals(src, dst, StringComparison.OrdinalIgnoreCase)) return;

        string srcAssetPath = "Assets/" + src;
        string dstAssetPath = "Assets/" + dst;
        string finalAssetPath = dstAssetPath;
        string backupAssetPath = "";
        if (sBackedUpSourceByPackage.ContainsKey(key)) {
            backupAssetPath = sBackedUpSourceByPackage[key];
        }

        if (!AssetDatabase.IsValidFolder(srcAssetPath)) {
            if (!string.IsNullOrEmpty(backupAssetPath) && AssetDatabase.IsValidFolder(backupAssetPath)) {
                if (AssetDatabase.IsValidFolder(dstAssetPath)) {
                    bool merged = BoothImportShared.TryMergeTopFolderInto(backupAssetPath, dstAssetPath, "[BoothBatchImporter]");
                    if (merged) {
                        Debug.Log("[BoothBatchImporter] Source missing; merged backup into target: " + backupAssetPath + " -> " + dstAssetPath);
                    } else {
                        Debug.LogWarning("[BoothBatchImporter] Source missing; backup merge failed and was kept: " + backupAssetPath + " -> " + dstAssetPath);
                        return;
                    }
                } else {
                    string renameBackupErr = AssetDatabase.MoveAsset(backupAssetPath, dstAssetPath);
                    if (!string.IsNullOrEmpty(renameBackupErr)) {
                        Debug.LogWarning("[BoothBatchImporter] Source missing; backup rename failed: " + backupAssetPath + " -> " + dstAssetPath + " / " + renameBackupErr);
                        return;
                    }
                    Debug.Log("[BoothBatchImporter] Source missing; renamed backup to target: " + backupAssetPath + " -> " + dstAssetPath);
                }
                sBackedUpSourceByPackage.Remove(key);
                return;
            }
            sBackedUpSourceByPackage.Remove(key);
            return;
        }

        if (AssetDatabase.IsValidFolder(dstAssetPath)) {
            bool merged = BoothImportShared.TryMergeTopFolderInto(srcAssetPath, dstAssetPath, "[BoothBatchImporter]");
            if (merged) {
                Debug.Log("[BoothBatchImporter] Merged top folder into existing target: " + srcAssetPath + " -> " + dstAssetPath);
            } else {
                string desiredName = (dst ?? "").Trim();
                if (string.IsNullOrEmpty(desiredName)) desiredName = src;
                string fallbackDst = BoothImportShared.BuildUniqueTopFolderAssetPath(desiredName);
                Debug.LogWarning("[BoothBatchImporter] Rename target exists. fallback target: " + dstAssetPath + " -> " + fallbackDst);
                string fallbackErr = AssetDatabase.MoveAsset(srcAssetPath, fallbackDst);
                if (!string.IsNullOrEmpty(fallbackErr)) {
                    Debug.LogWarning("[BoothBatchImporter] Rename failed: " + srcAssetPath + " -> " + fallbackDst + " / " + fallbackErr);
                    sBackedUpSourceByPackage.Remove(key);
                    return;
                }
                finalAssetPath = fallbackDst;
                Debug.Log("[BoothBatchImporter] Renamed top folder: " + srcAssetPath + " -> " + fallbackDst);
            }
        } else {
            string err = AssetDatabase.MoveAsset(srcAssetPath, dstAssetPath);
            if (!string.IsNullOrEmpty(err)) {
                Debug.LogWarning("[BoothBatchImporter] Rename failed: " + srcAssetPath + " -> " + dstAssetPath + " / " + err);
                sBackedUpSourceByPackage.Remove(key);
                return;
            }
            Debug.Log("[BoothBatchImporter] Renamed top folder: " + srcAssetPath + " -> " + dstAssetPath);
        }

        if (!string.IsNullOrEmpty(backupAssetPath) && AssetDatabase.IsValidFolder(backupAssetPath)) {
            bool backupMerged = BoothImportShared.TryMergeTopFolderInto(backupAssetPath, finalAssetPath, "[BoothBatchImporter]");
            if (!backupMerged && AssetDatabase.IsValidFolder(backupAssetPath)) {
                AssetDatabase.DeleteAsset(backupAssetPath);
                Debug.LogWarning("[BoothBatchImporter] Backup merge failed, deleted: " + backupAssetPath);
            }
        }
        sBackedUpSourceByPackage.Remove(key);
    }

    private static string JsonEscape(string s) {
        if (string.IsNullOrEmpty(s)) return "";
        return s
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\r", "")
            .Replace("\n", "\\n")
            .Replace("\t", "\\t")
            .Replace("\b", "\\b")
            .Replace("\f", "\\f");
    }

    private static void SendIpc(string type, string extraJson) {
        if (sIpcPort <= 0) return;
        try {
            using (TcpClient client = new TcpClient()) {
                if (!client.ConnectAsync(sIpcHost, sIpcPort).Wait(3000)) return;
                using (NetworkStream stream = client.GetStream()) {
                    stream.WriteTimeout = 3000;
                    using (StreamWriter writer = new StreamWriter(stream, new UTF8Encoding(false))) {
                        writer.AutoFlush = true;
                        writer.Write("{\"type\":\"" + JsonEscape(type) + "\"");
                        if (!string.IsNullOrEmpty(extraJson)) writer.Write("," + extraJson);
                        writer.Write("}\n");
                    }
                }
            }
        } catch {
            // ignore IPC send failures
        }
    }

    public static void NotifyImportedAssets(int delta) {
        if (!sTrackAssetProgress) return;
        if (delta <= 0) return;
        sPackageImportedAssets += delta;
        if (sPackageImportedAssets < 0) sPackageImportedAssets = 0;
        int shown = sPackageImportedAssets;
        int estimated = Math.Max(1, sPackageEstimatedAssets);
        if (shown > estimated) shown = estimated;
        Debug.Log("[BoothBatchImporter] AssetProgress: imported=" + shown + "/" + estimated + " package=" + sPackageIndex + "/" + sPackageTotal);
        SendIpc("asset", "\"packageIndex\":" + sPackageIndex + ",\"packageTotal\":" + sPackageTotal + ",\"importedAssets\":" + shown + ",\"estimatedAssets\":" + estimated);
    }

    private static string ResolveImportListPath(string[] args) {
        for (int i = 0; i < args.Length - 1; i++) {
            if (args[i] == "-boothImportList") return args[i + 1];
        }
        return Path.Combine(Directory.GetCurrentDirectory(), "booth_import_list.json");
    }

    private static int CountAssetsFiles(string assetsRoot) {
        if (!Directory.Exists(assetsRoot)) return 0;
        return Directory.GetFiles(assetsRoot, "*", SearchOption.AllDirectories).Length;
    }

    private static bool IsAllZero(byte[] buf, int len) {
        for (int i = 0; i < len; i++) {
            if (buf[i] != 0) return false;
        }
        return true;
    }

    private static int ParseOctal(byte[] buf, int offset, int length) {
        int value = 0;
        int end = offset + length;
        int i = offset;
        while (i < end && (buf[i] == 0 || buf[i] == 32)) i++;
        for (; i < end; i++) {
            byte c = buf[i];
            if (c < 48 || c > 55) break;
            value = (value * 8) + (c - 48);
        }
        return value;
    }

    private static string ParseName(byte[] buf, int offset, int length) {
        int end = offset;
        int max = offset + length;
        while (end < max && buf[end] != 0) end++;
        return System.Text.Encoding.UTF8.GetString(buf, offset, end - offset);
    }

    private static int EstimatePackageAssetEntries(string pkgPath) {
        int count = 0;
        try {
            using (FileStream fs = File.OpenRead(pkgPath))
            using (GZipStream gz = new GZipStream(fs, CompressionMode.Decompress))
            {
                byte[] header = new byte[512];
                byte[] skipBuf = new byte[4096];
                while (true) {
                    int read = 0;
                    while (read < 512) {
                        int n = gz.Read(header, read, 512 - read);
                        if (n <= 0) return Math.Max(1, count);
                        read += n;
                    }

                    if (IsAllZero(header, 512)) break;

                    string name = ParseName(header, 0, 100);
                    int size = ParseOctal(header, 124, 12);
                    if (!string.IsNullOrEmpty(name) && name.EndsWith("/pathname")) {
                        count += 1;
                    }

                    int skip = ((size + 511) / 512) * 512;
                    while (skip > 0) {
                        int chunk = Math.Min(skip, skipBuf.Length);
                        int n = gz.Read(skipBuf, 0, chunk);
                        if (n <= 0) break;
                        skip -= n;
                    }
                }
            }
        } catch (Exception e) {
            Debug.LogWarning("[BoothBatchImporter] Estimate failed: " + e.Message);
        }
        return Math.Max(1, count);
    }

    private static void ImportPackageStable(string pkgPath) {
        MethodInfo m = typeof(AssetDatabase).GetMethod(
            "ImportPackageImmediately",
            BindingFlags.NonPublic | BindingFlags.Static
        );
        if (m != null) {
            Debug.Log("[BoothBatchImporter] Using ImportPackageImmediately");
            m.Invoke(null, new object[] { pkgPath });
            return;
        }
        Debug.LogWarning("[BoothBatchImporter] ImportPackageImmediately not found; fallback to ImportPackage");
        AssetDatabase.ImportPackage(pkgPath, false);
    }

    public static void ImportFromList() {
        string[] cmdArgs = Environment.GetCommandLineArgs();
        string cwd = Directory.GetCurrentDirectory();
        string listPath = ResolveImportListPath(cmdArgs);
        string renamePlanPath = ResolveArgValue(cmdArgs, "-boothRenamePlan", "");
        string assetsRoot = Path.Combine(cwd, "Assets");
        sIpcHost = ResolveArgValue(cmdArgs, "-boothIpcHost", "127.0.0.1");
        sIpcPort = ParseIntSafe(ResolveArgValue(cmdArgs, "-boothIpcPort", "0"), 0);
        LoadRenamePlan(renamePlanPath);
        Debug.Log("[BoothBatchImporter] CWD: " + cwd);
        Debug.Log("[BoothBatchImporter] Import list path: " + listPath);

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

            int totalBefore = CountAssetsFiles(assetsRoot);
            int importedCount = 0;
            sPackageTotal = data.files.Length;

            for (int i = 0; i < data.files.Length; i++) {
                string pkgPath = data.files[i];
                sPackageIndex = i + 1;
                sPackageImportedAssets = 0;
                sPackageEstimatedAssets = 1;

                if (!File.Exists(pkgPath)) {
                    Debug.LogWarning("[BoothBatchImporter] Package not found: " + pkgPath);
                    SendIpc("package-skip", "\"packageIndex\":" + sPackageIndex + ",\"packageTotal\":" + sPackageTotal + ",\"reason\":\"package_not_found\",\"packagePath\":\"" + JsonEscape(pkgPath) + "\"");
                    continue;
                }

                sPackageEstimatedAssets = EstimatePackageAssetEntries(pkgPath);
                Debug.Log("[BoothBatchImporter] PackageBegin: package=" + sPackageIndex + "/" + sPackageTotal + " estimatedAssets=" + sPackageEstimatedAssets + " path=" + pkgPath);
                SendIpc("package-begin", "\"packageIndex\":" + sPackageIndex + ",\"packageTotal\":" + sPackageTotal + ",\"estimatedAssets\":" + sPackageEstimatedAssets + ",\"packagePath\":\"" + JsonEscape(pkgPath) + "\"");

                int before = CountAssetsFiles(assetsRoot);
                Debug.Log("[BoothBatchImporter] Importing: " + pkgPath);
                BoothImportShared.PrepareTopFolderForPackage(pkgPath, sRenameByPackage, sBackedUpSourceByPackage, "[BoothBatchImporter]");
                sTrackAssetProgress = true;
                try {
                    ImportPackageStable(pkgPath);
                } finally {
                    sTrackAssetProgress = false;
                }
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
                ApplyTopFolderRenameForPackage(pkgPath);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
                int after = CountAssetsFiles(assetsRoot);
                Debug.Log("[BoothBatchImporter] Delta files: " + (after - before) + " (" + before + " -> " + after + ")");
                importedCount += 1;
                SendIpc("package-done", "\"packageIndex\":" + sPackageIndex + ",\"packageTotal\":" + sPackageTotal + ",\"importedPackages\":" + importedCount);
            }

            int totalAfter = CountAssetsFiles(assetsRoot);
            Debug.Log("[BoothBatchImporter] Imported packages: " + importedCount + "/" + data.files.Length);
            Debug.Log("[BoothBatchImporter] Total delta files: " + (totalAfter - totalBefore) + " (" + totalBefore + " -> " + totalAfter + ")");
            SendIpc("done", "\"importedPackages\":" + importedCount + ",\"totalPackages\":" + data.files.Length);

            if (importedCount == 0) {
                Debug.LogError("[BoothBatchImporter] No package was imported.");
                SendIpc("error", "\"message\":\"No package was imported.\"");
                EditorApplication.Exit(1);
                return;
            }
        } catch (Exception e) {
            Debug.LogError("[BoothBatchImporter] Error: " + e);
            SendIpc("error", "\"message\":\"" + JsonEscape(e.ToString()) + "\"");
            EditorApplication.Exit(1);
            return;
        }

        Debug.Log("[BoothBatchImporter] Done.");
    }
}

public class BoothBatchImportProgressPostprocessor : AssetPostprocessor {
    static void OnPostprocessAllAssets(
        string[] importedAssets,
        string[] deletedAssets,
        string[] movedAssets,
        string[] movedFromAssetPaths
    ) {
        if (!BoothBatchImporter.IsTrackingAssetProgress) return;
        int count = importedAssets != null ? importedAssets.Length : 0;
        if (count > 0) {
            BoothBatchImporter.NotifyImportedAssets(count);
        }
    }
}
