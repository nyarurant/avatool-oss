using System;
using System.Reflection;
using UnityEditor;
using UnityEditor.Callbacks;
using UnityEngine;

[InitializeOnLoad]
internal static class AvatoolFolderIconBootstrap {
    private static bool sWarningShown = false;
    private static bool sMissingTypeLogged = false;
    private static bool sRefreshPending = false;

    static AvatoolFolderIconBootstrap() {
        QueueRefresh("startup");
        EditorApplication.projectChanged += OnProjectChanged;
    }

    [DidReloadScripts]
    private static void OnDidReloadScripts() {
        QueueRefresh("scripts-reloaded");
    }

    private static void OnProjectChanged() {
        QueueRefresh("project-changed");
    }

    private static void QueueRefresh(string reason) {
        if (sRefreshPending) return;
        sRefreshPending = true;
        EditorApplication.delayCall += () => {
            sRefreshPending = false;
            TryRefreshFolderIcons(reason);
        };
    }

    private static void TryRefreshFolderIcons(string reason) {
        try {
            Type creatorType = FindType("SimpleFolderIcon.Editor.IconDictionaryCreator");
            if (creatorType == null) {
                if (!sMissingTypeLogged) {
                    sMissingTypeLogged = true;
                    Debug.Log("[AvatoolFolderIconBootstrap] Skip refresh: SimpleFolderIcon not loaded yet.");
                }
                return;
            }
            sMissingTypeLogged = false;
            MethodInfo buildMethod = creatorType.GetMethod("BuildDictionary", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
            if (buildMethod == null) {
                Debug.LogWarning("[AvatoolFolderIconBootstrap] Skip refresh: BuildDictionary not found.");
                return;
            }
            buildMethod.Invoke(null, null);
            EditorApplication.RepaintProjectWindow();
            Debug.Log("[AvatoolFolderIconBootstrap] Folder icons refreshed. reason=" + (reason ?? "unknown"));
        } catch (Exception ex) {
            if (sWarningShown) return;
            sWarningShown = true;
            Debug.LogWarning("[AvatoolFolderIconBootstrap] Refresh failed: " + ex.Message);
        }
    }

    private static Type FindType(string fullName) {
        if (string.IsNullOrEmpty(fullName)) return null;
        Type t = Type.GetType(fullName + ", SimpleFolderIcon.Editor");
        if (t != null) return t;
        Assembly[] assemblies = AppDomain.CurrentDomain.GetAssemblies();
        for (int i = 0; i < assemblies.Length; i++) {
            try {
                t = assemblies[i].GetType(fullName, false);
                if (t != null) return t;
            } catch {
                // ignore reflection failures for unrelated assemblies
            }
        }
        return null;
    }
}
