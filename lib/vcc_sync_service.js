function createVccSyncService(deps) {
  let vccWatchHandle = null;
  let vccWatchFileEnabled = false;
  let vccWatchDebounceTimer = null;
  let vccWatchRestartTimer = null;

  function readVccProjectsFile() {
    try {
      const settingsPath = String(deps.VCC_SETTINGS_PATH || '').trim();
      if (!settingsPath || !deps.fs.existsSync(settingsPath)) {
        return { error: 'vcc_settings_not_found' };
      }
      let raw = deps.fs.readFileSync(settingsPath, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      raw = raw.trim();
      const data = JSON.parse(raw);

      const projects = (data.userProjects || [])
        .map((p) => {
          const projectPath = String(p || '').trim();
          return {
            name: deps.path.basename(projectPath || 'Project'),
            path: projectPath,
          };
        })
        .filter((p) => p.path && deps.fs.existsSync(p.path));

      let editorPath = '';
      if (data.preferredUnityEditors && typeof data.preferredUnityEditors === 'object') {
        editorPath = data.preferredUnityEditors['2022'] || Object.values(data.preferredUnityEditors)[0] || '';
      }
      return { ok: true, projects, editorPath: String(editorPath || '') };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  }

  function syncToSettings(source = 'watch') {
    const vcc = readVccProjectsFile();
    if (!vcc?.ok) return vcc;

    const settings = deps.getSettings();
    const current = deps.normalizeUnityProjects(settings.unityProjects);
    const nextProjects = deps.dedupeProjects(deps.normalizeUnityProjects(vcc.projects));
    const currentSet = new Set(current.map((p) => deps.normalizeProjectPath(p.path)));
    const nextSet = new Set(nextProjects.map((p) => deps.normalizeProjectPath(p.path)));
    const addedProjects = nextProjects.filter((p) => !currentSet.has(deps.normalizeProjectPath(p.path)));
    const removedProjects = current.filter((p) => !nextSet.has(deps.normalizeProjectPath(p.path)));
    const changedProjects = addedProjects.length > 0 || removedProjects.length > 0;
    const nextEditorPath = vcc.editorPath || settings.unityEditorPath || '';
    const changedEditor = String(settings.unityEditorPath || '') !== String(nextEditorPath || '');

    if (!changedProjects && !changedEditor) {
      deps.ensureFolderIconBootstrapForProjects(nextProjects, `vcc-sync-${source}`);
      return {
        ok: true,
        changed: false,
        added: 0,
        removed: 0,
        projects: nextProjects,
        editorPath: nextEditorPath,
      };
    }

    settings.unityProjects = nextProjects;
    settings.unityEditorPath = nextEditorPath;
    deps.saveSettings();

    const added = addedProjects.length;
    const removed = removedProjects.length;
    deps.emitVccProjectsUpdated({
      source,
      added,
      removed,
      total: nextProjects.length,
      unityEditorPath: nextEditorPath,
      unityProjects: nextProjects,
      addedProjects,
      removedProjects,
    });
    if (addedProjects.length > 0 && source !== 'startup') {
      for (const p of addedProjects) {
        deps.enqueueAutoBootstrap(p.path, source);
      }
    }
    deps.ensureFolderIconBootstrapForProjects(nextProjects, `vcc-sync-${source}`);
    return {
      ok: true,
      changed: true,
      added,
      removed,
      projects: nextProjects,
      editorPath: nextEditorPath,
    };
  }

  function stopWatcher() {
    if (vccWatchRestartTimer) {
      clearTimeout(vccWatchRestartTimer);
      vccWatchRestartTimer = null;
    }
    if (vccWatchDebounceTimer) {
      clearTimeout(vccWatchDebounceTimer);
      vccWatchDebounceTimer = null;
    }
    if (vccWatchHandle) {
      try {
        vccWatchHandle.close();
      } catch {
        // ignore
      }
      vccWatchHandle = null;
    }
    const settingsPath = String(deps.VCC_SETTINGS_PATH || '').trim();
    if (vccWatchFileEnabled && settingsPath) {
      deps.fs.unwatchFile(settingsPath);
      vccWatchFileEnabled = false;
    }
  }

  function startWatcher() {
    stopWatcher();
    const settingsPath = String(deps.VCC_SETTINGS_PATH || '').trim();
    if (!settingsPath || !deps.fs.existsSync(settingsPath)) return;

    const scheduleSync = (source) => {
      if (vccWatchDebounceTimer) clearTimeout(vccWatchDebounceTimer);
      vccWatchDebounceTimer = setTimeout(() => {
        syncToSettings(source);
      }, 400);
    };

    try {
      vccWatchHandle = deps.fs.watch(settingsPath, { persistent: false }, () => scheduleSync('watch'));
      vccWatchHandle.on('error', (err) => {
        console.warn('[main] VCC watcher error:', err?.message || err);
        stopWatcher();
        vccWatchRestartTimer = setTimeout(() => {
          vccWatchRestartTimer = null;
          startWatcher();
        }, 1500);
      });
    } catch (e) {
      console.warn('[main] fs.watch unavailable for VCC settings:', e?.message || e);
    }

    deps.fs.watchFile(settingsPath, { interval: 2000 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) scheduleSync('watchFile');
    });
    vccWatchFileEnabled = true;
  }

  return {
    readVccProjectsFile,
    syncToSettings,
    startWatcher,
    stopWatcher,
  };
}

module.exports = {
  createVccSyncService,
};
