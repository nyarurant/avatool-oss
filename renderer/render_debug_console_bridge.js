(function attachRenderDebugConsoleBridge(global) {
  function createRenderDebugConsoleBridge(deps) {
    const state = deps?.state;
    const getAssetByItemId = deps?.getAssetByItemId;
    const openPreviewModal = deps?.openPreviewModal;
    const getCategoryDisplayText = deps?.getCategoryDisplayText;
    const win = deps?.window || global;

    function setupDebugConsoleBridge() {
      let allowDebug = Boolean(state.settings?.debugLogEnabled);
      try {
        const q = new URLSearchParams(win.location.search || '');
        allowDebug = allowDebug || q.get('debug') === '1' || localStorage.getItem('avatool_debug_console') === '1';
      } catch {
        allowDebug = Boolean(state.settings?.debugLogEnabled);
      }
      if (!allowDebug) {
        try {
          if (win.__boothDebug) {
            delete win.__boothDebug;
            delete win.__boothDebugVersion;
          }
        } catch {
          // ignore cleanup failures
        }
        return;
      }

      const sanitizeAvatarAnalysisAsset = (asset) => {
        const analysis = asset?.supportedAvatarAnalysis && typeof asset.supportedAvatarAnalysis === 'object'
          ? asset.supportedAvatarAnalysis
          : null;
        const candidates = Array.isArray(analysis?.candidates)
          ? analysis.candidates.map((row) => ({
            name: String(row?.name || ''),
            score: Number(row?.score || 0),
            reasons: Array.isArray(row?.reasons) ? row.reasons.map((r) => String(r || '')).filter(Boolean) : [],
          }))
          : [];
        return {
          itemId: String(asset?.itemId || ''),
          title: String(asset?.title || ''),
          isAvatarItem: Boolean(asset?.isAvatarItem),
          downloaded: Boolean(asset?.downloaded),
          primaryCategory: getCategoryDisplayText(asset?.primaryCategory, ''),
          supportedAvatars: Array.isArray(asset?.supportedAvatars) ? asset.supportedAvatars.filter(Boolean) : [],
          supportedAvatarsInferred: Array.isArray(asset?.supportedAvatarsInferred) ? asset.supportedAvatarsInferred.filter(Boolean) : [],
          avatarAnalysisCheckedAt: asset?.avatarAnalysisCheckedAt || null,
          analysis: analysis ? {
            status: String(analysis.status || ''),
            primaryAvatar: String(analysis.primaryAvatar || ''),
            candidateCount: candidates.length,
            candidates,
          } : null,
        };
      };

      const api = win.boothAPI || {};
      const debugApi = {
        help() {
          return [
            '__boothDebug.help()',
            '__boothDebug.state()',
            '__boothDebug.avatarAnalysis(itemId?)',
            '__boothDebug.avatarLogs(limit?)',
            '__boothDebug.scanPackage(pkgPath, candidateTokens?)',
            '__boothDebug.getImportHistory(itemId)',
            '__boothDebug.getProjectItems(projectPath)',
            '__boothDebug.importWithMeta(projectPath, packages)',
            '__boothDebug.importPaths(projectPath, packagePaths)',
            '__boothDebug.openAsset(itemId)',
          ];
        },
        state() {
          return {
            assets: state.allAssets.length,
            selectedItems: Array.from(state.selectedItems),
            currentCategory: state.currentCategory,
            viewFilter: state.viewFilter,
            queue: state.queue,
            modal: {
              selectedAssetId: state.modal?.selectedAsset?.itemId || null,
              currentPath: state.modal?.currentPath || '',
            },
          };
        },
        avatarAnalysis(itemId = '') {
          const key = String(itemId || '').trim();
          if (key) {
            const asset = getAssetByItemId(key);
            if (!asset) throw new Error('asset_not_found');
            return sanitizeAvatarAnalysisAsset(asset);
          }
          return (Array.isArray(state.allAssets) ? state.allAssets : [])
            .filter((asset) => (
              asset?.supportedAvatarAnalysis
              || (Array.isArray(asset?.supportedAvatarsInferred) && asset.supportedAvatarsInferred.length)
              || String(asset?.avatarAnalysisCheckedAt || '').trim()
            ))
            .map(sanitizeAvatarAnalysisAsset);
        },
        async avatarLogs(limit = 80) {
          if (!api.getRuntimeLogs) throw new Error('getRuntimeLogs API unavailable');
          const res = await api.getRuntimeLogs();
          if (!res?.ok) throw new Error(res?.error || 'get_runtime_logs_failed');
          const rows = Array.isArray(res.logs) ? res.logs : [];
          const filtered = rows.filter((row) => {
            const msg = String(row?.message || '');
            return msg.includes('[AVATAR-DEBUG]') || msg.includes('avatar-analysis') || msg.includes('avatar-score-breakdown');
          });
          return filtered.slice(-Math.max(1, Math.min(500, Number(limit) || 80)));
        },
        async scanPackage(pkgPath, candidateTokens = []) {
          if (!api.scanUnityPackage) throw new Error('scanUnityPackage API unavailable');
          return await api.scanUnityPackage(pkgPath, candidateTokens);
        },
        async getImportHistory(itemId) {
          if (!api.getImportHistory) throw new Error('getImportHistory API unavailable');
          return await api.getImportHistory(itemId);
        },
        async getProjectItems(projectPath) {
          if (!api.getProjectItems) throw new Error('getProjectItems API unavailable');
          return await api.getProjectItems(projectPath);
        },
        async reconcileImports(projectPath, packages, persistMatched = true, threshold = 0.6) {
          if (!api.reconcileImports) throw new Error('reconcileImports API unavailable');
          return await api.reconcileImports(projectPath, packages, persistMatched, threshold);
        },
        async importWithMeta(projectPath, packages) {
          if (!api.importMultipleToUnityWithMeta) throw new Error('importMultipleToUnityWithMeta API unavailable');
          return await api.importMultipleToUnityWithMeta(projectPath, packages);
        },
        async importPaths(projectPath, packagePaths) {
          if (!api.importMultipleToUnity) throw new Error('importMultipleToUnity API unavailable');
          return await api.importMultipleToUnity(projectPath, packagePaths);
        },
        async openAsset(itemId) {
          const found = getAssetByItemId(itemId);
          if (!found) throw new Error('asset_not_found');
          await openPreviewModal(found);
          return { ok: true, itemId: found.itemId, title: found.title };
        },
      };

      win.__boothDebug = debugApi;
      win.__boothDebugVersion = '1.1.0';
      console.info('[booth-debug] ready:', debugApi.help());
    }

    win.setupDebugConsoleBridge = setupDebugConsoleBridge;

    return {
      setupDebugConsoleBridge,
    };
  }

  global.AvatoolRenderDebugConsoleBridge = {
    createRenderDebugConsoleBridge,
  };
})(window);
