using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using VRC.Dynamics;
using VRC.SDK3.Dynamics.PhysBone;

[DefaultExecutionOrder(-32000)]
public sealed class AvatoolPhysBonePoseStreamer : MonoBehaviour
{
    [Serializable] private sealed class Request
    {
        public string outputJson;
        public string stopFile;
        public float fps = 30f;
        public bool pseudoWind = true;
        public float windStrength = 1f;
        public float windFrequency = 1f;
    }

    [Serializable] private sealed class BonePose
    {
        public string path;
        public Vector3 position;
        public Quaternion rotation;
    }

    [Serializable] private sealed class PoseFrame
    {
        public int sequence;
        public double timestamp;
        public BonePose[] bones;
    }

    private sealed class TrackedBone
    {
        public Transform transform;
        public string path;
        public Vector3 restPosition;
        public Quaternion restRotation;
    }

    public string requestPath;
    public Transform avatarRoot;

    private Request _request;
    private readonly List<TrackedBone> _bones = new List<TrackedBone>();
    private Vector3 _avatarRestPosition;
    private Quaternion _avatarRestRotation;
    private float _nextWrite;
    private int _sequence;

    private void Awake()
    {
        try
        {
            _request = JsonUtility.FromJson<Request>(File.ReadAllText(requestPath));
        }
        catch (Exception ex)
        {
            Debug.LogError("[AvatoolPhysBone] request read failed: " + ex);
            enabled = false;
            return;
        }

        EnsureManager();
        if (avatarRoot == null) avatarRoot = transform;
        QualitySettings.vSyncCount = 0;
        Application.targetFrameRate = Mathf.RoundToInt(Mathf.Clamp(_request.fps, 10f, 60f));
        _avatarRestPosition = avatarRoot.localPosition;
        _avatarRestRotation = avatarRoot.localRotation;
        BuildTrackedBones();
        Debug.Log("[AvatoolPhysBone] tracking bones=" + _bones.Count);
    }

    private static void EnsureManager()
    {
        PhysBoneManager manager = PhysBoneManager.Inst;
        if (manager == null)
        {
            GameObject managerObject = new GameObject("PhysBoneManager");
            DontDestroyOnLoad(managerObject);
            manager = managerObject.AddComponent<PhysBoneManager>();
        }
        manager.IsSDK = true;
        manager.Init();
    }

    private void BuildTrackedBones()
    {
        HashSet<Transform> found = new HashSet<Transform>();
        VRCPhysBoneBase[] physBones = avatarRoot.GetComponentsInChildren<VRCPhysBoneBase>(true);
        foreach (VRCPhysBoneBase physBone in physBones)
        {
            Transform root = physBone.rootTransform != null ? physBone.rootTransform : physBone.transform;
            if (root == null) continue;
            foreach (Transform child in root.GetComponentsInChildren<Transform>(true)) found.Add(child);
        }

        foreach (Transform bone in found)
        {
            _bones.Add(new TrackedBone
            {
                transform = bone,
                path = RelativePath(avatarRoot, bone),
                restPosition = bone.localPosition,
                restRotation = bone.localRotation,
            });
        }
        _bones.Sort((a, b) => string.CompareOrdinal(a.path, b.path));
    }

    private static string RelativePath(Transform root, Transform target)
    {
        if (target == root) return string.Empty;
        List<string> names = new List<string>();
        Transform current = target;
        while (current != null && current != root)
        {
            names.Add(current.name);
            current = current.parent;
        }
        names.Reverse();
        return string.Join("/", names.ToArray());
    }

    private void Update()
    {
        if (_request == null) return;
        if (!string.IsNullOrEmpty(_request.stopFile) && File.Exists(_request.stopFile))
        {
#if UNITY_EDITOR
            UnityEditor.EditorApplication.Exit(0);
#else
            Application.Quit();
#endif
            return;
        }

        if (_request.pseudoWind && avatarRoot != null)
        {
            float strength = Mathf.Clamp(_request.windStrength, 0f, 3f);
            float frequency = Mathf.Clamp(_request.windFrequency, 0.2f, 3f);
            float t = Time.realtimeSinceStartup * frequency;
            float gust = 0.72f + Mathf.Sin(t * 0.31f + 1.4f) * 0.28f;
            float sideways = Mathf.Sin(t * 1.17f) + Mathf.Sin(t * 2.73f + 0.8f) * 0.35f;
            avatarRoot.localPosition = _avatarRestPosition + new Vector3(
                sideways * 0.0025f * strength * gust,
                0f,
                Mathf.Sin(t * 0.79f + 1.1f) * 0.0012f * strength * gust
            );
            avatarRoot.localRotation = _avatarRestRotation * Quaternion.Euler(
                Mathf.Sin(t * 0.91f) * 0.35f * strength,
                Mathf.Sin(t * 0.57f + 0.6f) * 0.8f * strength,
                Mathf.Sin(t * 1.23f + 1.8f) * 0.55f * strength
            );
        }
    }

    private void LateUpdate()
    {
        if (_request == null || string.IsNullOrEmpty(_request.outputJson)) return;
        float interval = 1f / Mathf.Clamp(_request.fps, 10f, 60f);
        if (Time.realtimeSinceStartup < _nextWrite) return;
        _nextWrite = Time.realtimeSinceStartup + interval;

        BonePose[] poses = new BonePose[_bones.Count];
        for (int i = 0; i < _bones.Count; i++)
        {
            TrackedBone tracked = _bones[i];
            Quaternion deltaRotation = Quaternion.Inverse(tracked.restRotation) * tracked.transform.localRotation;
            poses[i] = new BonePose
            {
                path = tracked.path,
                position = tracked.transform.localPosition - tracked.restPosition,
                rotation = deltaRotation,
            };
        }

        PoseFrame frame = new PoseFrame
        {
            sequence = ++_sequence,
            timestamp = Time.realtimeSinceStartupAsDouble,
            bones = poses,
        };
        WriteAtomic(_request.outputJson, JsonUtility.ToJson(frame));
    }

    private static void WriteAtomic(string destination, string body)
    {
        try
        {
            string directory = Path.GetDirectoryName(destination);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            string temporary = destination + ".tmp";
            File.WriteAllText(temporary, body);
            if (File.Exists(destination)) File.Delete(destination);
            File.Move(temporary, destination);
        }
        catch (Exception ex)
        {
            Debug.LogWarning("[AvatoolPhysBone] frame write failed: " + ex.Message);
        }
    }
}
