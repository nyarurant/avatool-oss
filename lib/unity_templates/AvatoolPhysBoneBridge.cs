using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using VRC.Dynamics;
using VRC.SDK3.Dynamics.PhysBone;

[InitializeOnLoad]
public static class AvatoolPhysBoneBridge
{
    [Serializable] private sealed class Request
    {
        public string packagePath;
        public string prefabPathContains;
        public string prefabName;
        public string outputJson;
        public string stopFile;
        public float fps = 30f;
        public bool pseudoWind = true;
        public float windStrength = 1f;
        public float windFrequency = 1f;
    }

    private static Request _request;
    private static string _requestPath;
    private static bool _importing;
    private static string ResumeMarkerPath
    {
        get { return Path.Combine(Directory.GetParent(Application.dataPath).FullName, "Library", "AvatoolPhysBoneRequest.txt"); }
    }

    static AvatoolPhysBoneBridge()
    {
        if (File.Exists(ResumeMarkerPath)) EditorApplication.delayCall += ResumePendingImport;
    }

    private static string Argument(string key)
    {
        string[] args = Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length - 1; i++) if (args[i] == key) return args[i + 1];
        return string.Empty;
    }

    public static void Run()
    {
        try
        {
            _requestPath = Argument("-physBoneRequest");
            if (string.IsNullOrEmpty(_requestPath) || !File.Exists(_requestPath))
                throw new InvalidOperationException("missing -physBoneRequest");
            _request = JsonUtility.FromJson<Request>(File.ReadAllText(_requestPath));
            if (_request == null || string.IsNullOrEmpty(_request.outputJson))
                throw new InvalidOperationException("invalid request");

            if (!string.IsNullOrEmpty(_request.packagePath) && File.Exists(_request.packagePath))
            {
                _importing = true;
                File.WriteAllText(ResumeMarkerPath, _requestPath);
                AssetDatabase.importPackageCompleted += Imported;
                AssetDatabase.importPackageFailed += ImportFailed;
                AssetDatabase.importPackageCancelled += ImportCancelled;
                Debug.Log("[AvatoolPhysBone] importing " + _request.packagePath);
                AssetDatabase.ImportPackage(_request.packagePath, false);
                return;
            }
            SetupScene();
        }
        catch (Exception ex)
        {
            Debug.LogError("[AvatoolPhysBone] startup failed: " + ex);
            EditorApplication.Exit(2);
        }
    }

    private static void UnhookImport()
    {
        AssetDatabase.importPackageCompleted -= Imported;
        AssetDatabase.importPackageFailed -= ImportFailed;
        AssetDatabase.importPackageCancelled -= ImportCancelled;
        _importing = false;
    }

    private static void ResumePendingImport()
    {
        if (EditorApplication.isCompiling || EditorApplication.isUpdating)
        {
            EditorApplication.delayCall += ResumePendingImport;
            return;
        }
        try
        {
            if (!File.Exists(ResumeMarkerPath)) return;
            _requestPath = File.ReadAllText(ResumeMarkerPath).Trim();
            File.Delete(ResumeMarkerPath);
            if (string.IsNullOrEmpty(_requestPath) || !File.Exists(_requestPath))
                throw new InvalidOperationException("resume request missing");
            _request = JsonUtility.FromJson<Request>(File.ReadAllText(_requestPath));
            if (_request == null) throw new InvalidOperationException("resume request invalid");
            Debug.Log("[AvatoolPhysBone] resumed after package import reload");
            SetupScene();
        }
        catch (Exception ex)
        {
            Debug.LogError("[AvatoolPhysBone] resume failed: " + ex);
            EditorApplication.Exit(6);
        }
    }

    private static void Imported(string packageName)
    {
        UnhookImport();
        if (File.Exists(ResumeMarkerPath)) File.Delete(ResumeMarkerPath);
        Debug.Log("[AvatoolPhysBone] import completed: " + packageName);
        AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
        SetupScene();
    }

    private static void ImportFailed(string packageName, string message)
    {
        UnhookImport();
        if (File.Exists(ResumeMarkerPath)) File.Delete(ResumeMarkerPath);
        Debug.LogError("[AvatoolPhysBone] import failed: " + packageName + " " + message);
        EditorApplication.Exit(3);
    }

    private static void ImportCancelled(string packageName)
    {
        UnhookImport();
        if (File.Exists(ResumeMarkerPath)) File.Delete(ResumeMarkerPath);
        Debug.LogError("[AvatoolPhysBone] import cancelled: " + packageName);
        EditorApplication.Exit(4);
    }

    private static void SetupScene()
    {
        try
        {
            string prefabPath = FindPrefab(_request.prefabPathContains, _request.prefabName);
            if (string.IsNullOrEmpty(prefabPath)) throw new InvalidOperationException("prefab not found");
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            if (prefab == null) throw new InvalidOperationException("prefab load failed");

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            GameObject managerObject = new GameObject("PhysBoneManager");
            PhysBoneManager manager = managerObject.AddComponent<PhysBoneManager>();
            manager.IsSDK = true;
            manager.Init();

            GameObject avatar = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            avatar.name = "AvatoolAvatar";
            avatar.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);

            GameObject bridgeObject = new GameObject("AvatoolPhysBoneBridge");
            AvatoolPhysBonePoseStreamer streamer = bridgeObject.AddComponent<AvatoolPhysBonePoseStreamer>();
            streamer.requestPath = _requestPath;
            streamer.avatarRoot = avatar.transform;

            string scenePath = "Assets/Avatool/AvatoolPhysBonePreview.unity";
            Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(Application.dataPath, "Avatool/AvatoolPhysBonePreview.unity")));
            EditorSceneManager.SaveScene(scene, scenePath);
            Debug.Log("[AvatoolPhysBone] prefab=" + prefabPath + " entering play mode");
            EditorApplication.isPlaying = true;
        }
        catch (Exception ex)
        {
            Debug.LogError("[AvatoolPhysBone] scene setup failed: " + ex);
            EditorApplication.Exit(5);
        }
    }

    private static string FindPrefab(string pathContains, string prefabName)
    {
        string contains = (pathContains ?? string.Empty).Trim().Replace("\\", "/").ToLowerInvariant();
        string wanted = (prefabName ?? string.Empty).Trim().ToLowerInvariant();
        if (wanted.EndsWith(".prefab")) wanted = wanted.Substring(0, wanted.Length - 7);
        string tail = contains;
        int slash = tail.LastIndexOf('/');
        if (slash >= 0) tail = tail.Substring(slash + 1);
        if (tail.EndsWith(".prefab")) tail = tail.Substring(0, tail.Length - 7);

        string best = null;
        int bestScore = -1;
        foreach (string guid in AssetDatabase.FindAssets("t:Prefab"))
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            if (string.IsNullOrEmpty(path) || !path.StartsWith("Assets", StringComparison.OrdinalIgnoreCase)) continue;
            string normalized = path.Replace("\\", "/");
            string file = Path.GetFileNameWithoutExtension(normalized).ToLowerInvariant();
            string lower = normalized.ToLowerInvariant();
            int score = 0;
            if (!string.IsNullOrEmpty(wanted) && file == wanted) score += 100;
            if (!string.IsNullOrEmpty(tail) && file == tail) score += 80;
            if (!string.IsNullOrEmpty(contains) && lower.Contains(contains)) score += 30;
            if (!string.IsNullOrEmpty(wanted) && file.Contains(wanted)) score += 20;
            if (score > bestScore) { bestScore = score; best = path; }
        }
        return bestScore > 0 ? best : null;
    }
}
