function createUnityEditorSupport({ fs, path, appRoot, resourcesPath }) {
  const UNITY_TEMPLATE_DIRNAME = path.join('lib', 'unity_templates');

  const TEMPLATE_FILES = {
    batch:      'BoothBatchImporter.cs',
    live:       'BoothLiveImportBridge.cs',
    shared:     'BoothImportShared.cs',
    folderIcon: 'AvatoolFolderIconBootstrap.cs',
  };

  function getTemplateCandidates(fileName) {
    const candidates = [path.join(appRoot, UNITY_TEMPLATE_DIRNAME, fileName)];
    if (resourcesPath) {
      candidates.push(path.join(resourcesPath, UNITY_TEMPLATE_DIRNAME, fileName));
      candidates.push(path.join(resourcesPath, 'app.asar.unpacked', UNITY_TEMPLATE_DIRNAME, fileName));
    }
    return candidates;
  }

  function readUnityTemplateContent(fileName) {
    const name = String(fileName || '').trim();
    if (!name) return '';
    for (const p of getTemplateCandidates(name)) {
      try {
        if (!p || !fs.existsSync(p)) continue;
        return String(fs.readFileSync(p, 'utf8') || '');
      } catch {
        // continue fallback candidates
      }
    }
    return '';
  }

  const templates = {};
  for (const [key, fileName] of Object.entries(TEMPLATE_FILES)) {
    templates[key] = readUnityTemplateContent(fileName);
  }

  if (typeof fs.watch === 'function') {
    for (const [key, fileName] of Object.entries(TEMPLATE_FILES)) {
      for (const p of getTemplateCandidates(fileName)) {
        try {
          if (!fs.existsSync(p)) continue;
          fs.watch(p, { persistent: false }, () => {
            try {
              const content = String(fs.readFileSync(p, 'utf8') || '');
              if (content) templates[key] = content;
            } catch {
              // ignore read errors on change
            }
          });
          break;
        } catch {
          // fs.watch may fail on asar paths or unsupported environments
        }
      }
    }
  }

  function ensureEditorDir(projectPath) {
    const targetProject = String(projectPath || '').trim();
    if (!targetProject || !fs.existsSync(targetProject)) return { ok: false, error: 'project_not_found' };
    const editorDir = path.join(targetProject, 'Assets', 'Editor');
    if (!fs.existsSync(editorDir)) fs.mkdirSync(editorDir, { recursive: true });
    return { ok: true, targetProject, editorDir };
  }

  function ensureTemplateScript(projectPath, fileName, templateKey, missingErrorCode) {
    const dirRes = ensureEditorDir(projectPath);
    if (!dirRes.ok) return { ok: false, error: dirRes.error };
    const content = String(templates[templateKey] || '').trim();
    if (!content) return { ok: false, error: String(missingErrorCode || 'template_missing') };
    const scriptPath = path.join(dirRes.editorDir, fileName);
    fs.writeFileSync(scriptPath, content, 'utf8');
    return { ok: true, scriptPath };
  }

  function ensureSharedImporter(projectPath) {
    return ensureTemplateScript(projectPath, TEMPLATE_FILES.shared, 'shared', 'shared_importer_template_missing');
  }

  function ensureBatchImporter(projectPath) {
    const sharedRes = ensureSharedImporter(projectPath);
    if (!sharedRes.ok) return sharedRes;
    return ensureTemplateScript(projectPath, TEMPLATE_FILES.batch, 'batch', 'batch_importer_template_missing');
  }

  function ensureLiveImporter(projectPath) {
    const sharedRes = ensureSharedImporter(projectPath);
    if (!sharedRes.ok) return sharedRes;
    return ensureTemplateScript(projectPath, TEMPLATE_FILES.live, 'live', 'live_importer_template_missing');
  }

  function ensureFolderIconBootstrap(projectPath) {
    const dirRes = ensureEditorDir(projectPath);
    if (!dirRes.ok) return { ok: false, error: dirRes.error };
    const content = String(templates.folderIcon || '').trim();
    if (!content) return { ok: false, error: 'folder_icon_bootstrap_template_missing' };
    const scriptPath = path.join(dirRes.editorDir, 'AvatoolFolderIconBootstrap.cs');
    if (!fs.existsSync(scriptPath)) {
      fs.writeFileSync(scriptPath, content, 'utf8');
      return { ok: true, scriptPath, status: 'created' };
    }
    let current = '';
    try {
      current = fs.readFileSync(scriptPath, 'utf8').trim();
    } catch {
      current = '';
    }
    if (current !== content) {
      fs.writeFileSync(scriptPath, content, 'utf8');
      return { ok: true, scriptPath, status: 'updated' };
    }
    return { ok: true, scriptPath, status: 'unchanged' };
  }

  function cleanupAutoBootstrapSupportScripts(projectPath) {
    try {
      const targetProject = String(projectPath || '').trim();
      if (!targetProject || !fs.existsSync(targetProject)) return { ok: false, removed: 0, error: 'project_not_found' };
      const editorDir = path.join(targetProject, 'Assets', 'Editor');
      const targets = [
        path.join(editorDir, 'BoothBatchImporter.cs'),
        path.join(editorDir, 'BoothBatchImporter.cs.meta'),
        path.join(editorDir, 'BoothImportShared.cs'),
        path.join(editorDir, 'BoothImportShared.cs.meta'),
        path.join(editorDir, 'BoothLiveImportBridge.cs'),
        path.join(editorDir, 'BoothLiveImportBridge.cs.meta'),
      ];
      let removed = 0;
      for (const p of targets) {
        try {
          if (!fs.existsSync(p)) continue;
          fs.unlinkSync(p);
          removed += 1;
        } catch {
          // ignore per-file cleanup errors
        }
      }
      return { ok: true, removed };
    } catch (e) {
      return { ok: false, removed: 0, error: e?.message || String(e) };
    }
  }

  return {
    ensureBatchImporter,
    ensureLiveImporter,
    ensureFolderIconBootstrap,
    cleanupAutoBootstrapSupportScripts,
  };
}

module.exports = {
  createUnityEditorSupport,
};
