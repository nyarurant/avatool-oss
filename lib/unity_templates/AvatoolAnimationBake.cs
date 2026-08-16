using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;

public static class AvatoolAnimationBake
{
    [Serializable]
    private sealed class BakeRequest
    {
        public string packagePath;
        public string prefabPathContains;
        public string clipPathContains;
        public string outputJson;
        public int fps = 60;
    }

    [Serializable]
    private sealed class BonePose
    {
        public string path;
        public string humanBone;
        public Vector3 position;
        public Quaternion rotation;
    }

    [Serializable]
    private sealed class PoseFrame
    {
        public float time;
        public BonePose[] bones;
    }

    [Serializable]
    private sealed class BakeOutput
    {
        public string unityVersion;
        public string prefabPath;
        public string clipPath;
        public string clipName;
        public float length;
        public float sampleRate;
        public PoseFrame[] frames;
    }

    private sealed class TrackedBone
    {
        public Transform transform;
        public string path;
        public string humanBone;
        public Vector3 restPosition;
        public Quaternion restRotation;
    }

    public static void Run()
    {
        GameObject instance = null;
        bool animationMode = false;
        try
        {
            string requestPath = ReadArgument("-animationBakeRequest");
            if (string.IsNullOrEmpty(requestPath) || !File.Exists(requestPath))
                throw new InvalidOperationException("animation_bake_request_not_found");
            BakeRequest request = JsonUtility.FromJson<BakeRequest>(File.ReadAllText(requestPath));
            if (request == null || string.IsNullOrEmpty(request.outputJson))
                throw new InvalidOperationException("animation_bake_request_invalid");

            if (!string.IsNullOrEmpty(request.packagePath))
            {
                if (!File.Exists(request.packagePath)) throw new FileNotFoundException("package_not_found", request.packagePath);
                ImportPackageImmediately(request.packagePath);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            }

            string prefabPath = FindAssetPath("t:GameObject", request.prefabPathContains, ".prefab");
            string clipPath = FindAssetPath("t:AnimationClip", request.clipPathContains, ".anim");
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            AnimationClip clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(clipPath);
            if (prefab == null || clip == null)
                throw new InvalidOperationException($"animation_bake_asset_missing prefab={prefab != null} clip={clip != null}");

            instance = UnityEngine.Object.Instantiate(prefab);
            instance.name = "AvatoolAnimationBakeAvatar";
            Animator animator = instance.GetComponent<Animator>() ?? instance.GetComponentInChildren<Animator>(true);
            if (animator == null || animator.avatar == null || !animator.avatar.isHuman || !animator.avatar.isValid)
                throw new InvalidOperationException("animation_bake_humanoid_animator_missing");
            animator.applyRootMotion = false;
            animator.Rebind();
            animator.Update(0f);

            Transform sampleRoot = animator.transform;
            List<TrackedBone> bones = CollectHumanoidBones(animator, sampleRoot);
            if (bones.Count == 0) throw new InvalidOperationException("animation_bake_humanoid_bones_missing");

            float sampleRate = Mathf.Clamp(request.fps > 0 ? request.fps : Mathf.RoundToInt(clip.frameRate), 15, 60);
            int frameCount = Mathf.Max(2, Mathf.CeilToInt(clip.length * sampleRate) + 1);
            var frames = new PoseFrame[frameCount];
            AnimationMode.StartAnimationMode();
            animationMode = true;
            for (int frameIndex = 0; frameIndex < frameCount; frameIndex++)
            {
                float time = frameIndex == frameCount - 1 ? clip.length : Mathf.Min(clip.length, frameIndex / sampleRate);
                AnimationMode.BeginSampling();
                AnimationMode.SampleAnimationClip(sampleRoot.gameObject, clip, time);
                AnimationMode.EndSampling();
                _ = sampleRoot.localToWorldMatrix;
                var poses = new BonePose[bones.Count];
                for (int boneIndex = 0; boneIndex < bones.Count; boneIndex++)
                {
                    TrackedBone bone = bones[boneIndex];
                    poses[boneIndex] = new BonePose
                    {
                        path = bone.path,
                        humanBone = bone.humanBone,
                        position = bone.transform.localPosition - bone.restPosition,
                        rotation = Quaternion.Inverse(bone.restRotation) * bone.transform.localRotation,
                    };
                }
                frames[frameIndex] = new PoseFrame { time = time, bones = poses };
            }

            var output = new BakeOutput
            {
                unityVersion = Application.unityVersion,
                prefabPath = prefabPath,
                clipPath = clipPath,
                clipName = clip.name,
                length = clip.length,
                sampleRate = sampleRate,
                frames = frames,
            };
            Directory.CreateDirectory(Path.GetDirectoryName(request.outputJson));
            File.WriteAllText(request.outputJson, JsonUtility.ToJson(output));
            Debug.Log($"AVATOOL_ANIMATION_BAKE_OK {request.outputJson}");
            EditorApplication.Exit(0);
        }
        catch (Exception exception)
        {
            Debug.LogException(exception);
            EditorApplication.Exit(1);
        }
        finally
        {
            if (animationMode) AnimationMode.StopAnimationMode();
            if (instance != null) UnityEngine.Object.DestroyImmediate(instance);
        }
    }

    private static List<TrackedBone> CollectHumanoidBones(Animator animator, Transform root)
    {
        var tracked = new Dictionary<Transform, HumanBodyBones>();
        for (int index = 0; index < (int)HumanBodyBones.LastBone; index++)
        {
            HumanBodyBones humanBone = (HumanBodyBones)index;
            Transform bone = animator.GetBoneTransform(humanBone);
            if (bone != null && !tracked.ContainsKey(bone)) tracked.Add(bone, humanBone);
        }
        return tracked.Select(row => new TrackedBone
        {
            transform = row.Key,
            path = RelativePath(root, row.Key),
            humanBone = row.Value.ToString(),
            restPosition = row.Key.localPosition,
            restRotation = row.Key.localRotation,
        }).OrderBy(row => row.path, StringComparer.Ordinal).ToList();
    }

    private static string RelativePath(Transform root, Transform target)
    {
        if (target == root) return string.Empty;
        var names = new List<string>();
        Transform current = target;
        while (current != null && current != root)
        {
            names.Add(current.name);
            current = current.parent;
        }
        names.Reverse();
        return string.Join("/", names.ToArray());
    }

    private static string FindAssetPath(string filter, string requested, string extension)
    {
        string wanted = Normalize(requested);
        string leaf = Path.GetFileName(wanted);
        var paths = AssetDatabase.FindAssets(filter)
            .Select(AssetDatabase.GUIDToAssetPath)
            .Where(path => path.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        string exact = paths.FirstOrDefault(path => Normalize(path).EndsWith(wanted, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrEmpty(exact)) return exact;
        string byLeaf = paths.FirstOrDefault(path => string.Equals(Path.GetFileName(path), leaf, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrEmpty(byLeaf)) return byLeaf;
        throw new InvalidOperationException($"animation_bake_asset_path_not_found {requested}");
    }

    private static void ImportPackageImmediately(string packagePath)
    {
        MethodInfo method = typeof(AssetDatabase).GetMethod(
            "ImportPackageImmediately",
            BindingFlags.NonPublic | BindingFlags.Static
        );
        if (method != null)
        {
            method.Invoke(null, new object[] { packagePath });
            return;
        }
        AssetDatabase.ImportPackage(packagePath, false);
    }

    private static string Normalize(string value)
    {
        return (value ?? string.Empty).Replace('\\', '/').Trim('/');
    }

    private static string ReadArgument(string name)
    {
        string[] args = Environment.GetCommandLineArgs();
        for (int index = 0; index < args.Length - 1; index++)
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
        return string.Empty;
    }
}
