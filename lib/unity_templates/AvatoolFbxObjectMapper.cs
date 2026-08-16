using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

public static class AvatoolFbxObjectMapper
{
    [Serializable] private class Request { public string outputPath; public ModelRequest[] models; }
    [Serializable] private class ModelRequest { public string guid; public string assetPath; }
    [Serializable] private class Result { public List<ModelResult> models = new List<ModelResult>(); }
    [Serializable] private class ModelResult { public string guid; public List<Entry> entries = new List<Entry>(); }
    [Serializable] private class Entry { public string gameObjectFileId; public string transformFileId; public string path; }

    public static void Run()
    {
        try
        {
            string requestPath = ArgumentValue("-avatoolFbxMapRequest");
            if (string.IsNullOrEmpty(requestPath) || !File.Exists(requestPath))
                throw new FileNotFoundException("Avatool FBX map request was not found.", requestPath);
            Request request = JsonUtility.FromJson<Request>(File.ReadAllText(requestPath));
            if (request == null || request.models == null || string.IsNullOrEmpty(request.outputPath))
                throw new InvalidDataException("Avatool FBX map request is invalid.");

            var result = new Result();
            foreach (ModelRequest model in request.models)
            {
                AssetDatabase.ImportAsset(model.assetPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
                GameObject root = AssetDatabase.LoadAssetAtPath<GameObject>(model.assetPath);
                if (root == null) continue;
                var mapped = new ModelResult { guid = model.guid };
                foreach (Transform transform in root.GetComponentsInChildren<Transform>(true))
                {
                    AssetDatabase.TryGetGUIDAndLocalFileIdentifier(transform.gameObject, out _, out long gameObjectFileId);
                    AssetDatabase.TryGetGUIDAndLocalFileIdentifier(transform, out _, out long transformFileId);
                    mapped.entries.Add(new Entry {
                        gameObjectFileId = gameObjectFileId.ToString(),
                        transformFileId = transformFileId.ToString(),
                        path = HierarchyPath(transform)
                    });
                }
                result.models.Add(mapped);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(request.outputPath));
            File.WriteAllText(request.outputPath, JsonUtility.ToJson(result));
        }
        catch (Exception exception)
        {
            Debug.LogException(exception);
            EditorApplication.Exit(1);
        }
    }

    private static string ArgumentValue(string name)
    {
        string[] args = Environment.GetCommandLineArgs();
        for (int i = 0; i + 1 < args.Length; i++) if (args[i] == name) return args[i + 1];
        return null;
    }

    private static string HierarchyPath(Transform transform)
    {
        var names = new List<string>();
        for (Transform current = transform; current != null; current = current.parent) names.Add(current.name);
        names.Reverse();
        return string.Join("/", names);
    }
}
