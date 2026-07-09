(function attachRenderAssetState(global) {
  function createRenderAssetState(deps) {
    const state = deps?.state;
    const boothAPI = deps?.boothAPI || global.boothAPI;
    const doc = deps?.document || global.document;
    const compareAssetsByAddedDateDesc = deps?.compareAssetsByAddedDateDesc;
    const getTileEntryByItemId = (...args) => deps?.getTileEntryByItemId(...args);
    const getAssetAvatarPool = deps?.getAssetAvatarPool;
    const logAvatarDebug = deps?.logAvatarDebug;
    const buildAvatarLabelMap = deps?.buildAvatarLabelMap;
    const refreshAvatarFilterOptions = (...args) => deps?.refreshAvatarFilterOptions(...args);
    const buildCategoryOptions = deps?.buildCategoryOptions;
    const applyCategoryFilter = deps?.applyCategoryFilter;
    const renderGrid = (...args) => deps?.renderGrid(...args);
    const scheduleStorageUsageRefresh = deps?.scheduleStorageUsageRefresh;

    function normalizeAssetsFromMap(data) {
      return Object.values(data || {}).sort(compareAssetsByAddedDateDesc);
    }

    function toItemIdKey(itemId) {
      return String(itemId || '');
    }

    function getAssetByItemId(itemId) {
      return state.assetByItemId.get(toItemIdKey(itemId)) || null;
    }

    function shouldTreatAsDownloaded(itemId, fallbackAsset) {
      const latestAsset = getAssetByItemId(itemId) || fallbackAsset || null;
      if (latestAsset?.downloaded) return true;
      const entry = getTileEntryByItemId(itemId);
      const btnText = String(entry?.downloadBtn?.textContent || '').trim();
      const statusText = String(entry?.statusEl?.textContent || '').trim();
      if (btnText.includes('インポート')) return true;
      if (statusText.includes('DL済み') || statusText.includes('完了')) return true;
      return false;
    }

    function countUnanalyzedDownloaded() {
      const rows = Array.isArray(state.allAssets) ? state.allAssets : [];
      return rows.filter((a) => a.downloaded && !String(a?.avatarAnalysisCheckedAt || '').trim()).length;
    }

    function updateAnalyzeAvatarCompatBtn() {
      const count = countUnanalyzedDownloaded();
      const badge = doc.getElementById('analyze-avatar-compat-badge');
      if (!badge) return;
      if (count > 0) {
        badge.textContent = count;
        badge.classList.remove('hidden');
      } else {
        const downloadedCount = (Array.isArray(state.allAssets) ? state.allAssets : [])
          .filter((a) => a.downloaded).length;
        if (downloadedCount > 0) {
          badge.textContent = '再';
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }
    }

    function setAssetsFromMap(data, options = {}) {
      const preserveRuntimeDownloaded = Boolean(options?.preserveRuntimeDownloaded);
      const previousByItemId = preserveRuntimeDownloaded
        ? new Map((state.allAssets || []).map((asset) => [toItemIdKey(asset?.itemId), asset]))
        : null;
      const nextAssets = normalizeAssetsFromMap(data);
      if (preserveRuntimeDownloaded && previousByItemId) {
        for (const asset of nextAssets) {
          const key = toItemIdKey(asset?.itemId);
          const previous = previousByItemId.get(key);
          const entry = state.tileMap instanceof Map ? state.tileMap.get(key) : null;
          const buttonText = String(entry?.downloadBtn?.textContent || '');
          const uiShowsImport = /Import|インポート|繧､繝ｳ繝昴・繝・/i.test(buttonText);
          if (!asset.downloaded && (previous?.downloaded || uiShowsImport)) {
            asset.downloaded = true;
          }
        }
      }
      state.allAssets = nextAssets;
      state.assetsRevision = Number(state.assetsRevision || 0) + 1;
      state.assetByItemId = new Map(state.allAssets.map((asset) => [toItemIdKey(asset?.itemId), asset]));
      if (Array.isArray(state.filteredAssets) && state.filteredAssets.length) {
        state.filteredAssets = state.filteredAssets.map((asset) => {
          const latest = state.assetByItemId.get(toItemIdKey(asset?.itemId));
          return latest || asset;
        });
      }
      state.downloadedAssets = state.allAssets.filter((a) => Boolean(a?.downloaded));
      state.updateAssetCount = state.allAssets.reduce((acc, a) => acc + (a?.hasUpdate ? 1 : 0), 0);
      if (state.allAssets.length > 0) {
        state.libraryEmptyReason = '';
      }
      const total = Array.isArray(state.allAssets) ? state.allAssets.length : 0;
      const withAvatar = (state.allAssets || []).filter((a) => getAssetAvatarPool(a).length > 0).length;
      logAvatarDebug('setAssetsFromMap', { totalAssets: total, assetsWithAvatar: withAvatar });
      state.avatarLabelMap = buildAvatarLabelMap(state.allAssets || [], []);
      refreshAvatarFilterOptions(state.allAssets);
      refreshAvatarAliasLabels({ rerender: true }).catch((e) => {
        console.warn('[renderer] refreshAvatarAliasLabels failed:', e);
      });
      buildCategoryOptions(state.allAssets.filter((a) => {
        if (a.isRemoved) return false;
        const hasRealContent = Boolean(a.downloaded) || Boolean(a.files && a.files.length);
        return hasRealContent || (!a.isWishlisted && !a.wishlistAddedAt);
      }));
      updateAnalyzeAvatarCompatBtn();
      if (state.boothClient?.onAssetsLoaded) {
        try { state.boothClient.onAssetsLoaded(state.allAssets); } catch { /* 任意フックの失敗は本処理に影響しないため無視 */ }
      }
    }

    async function refreshAvatarAliasLabels(options = {}) {
      const rerender = Boolean(options?.rerender);
      let avatarRows = [];
      try {
        if (boothAPI?.loadAvatarAliases) {
          const res = await boothAPI.loadAvatarAliases();
          if (Array.isArray(res?.avatars)) avatarRows = res.avatars;
        }
      } catch {
        avatarRows = [];
      }
      state.avatarLabelMap = buildAvatarLabelMap(state.allAssets || [], avatarRows);
      if (rerender) {
        refreshAvatarFilterOptions(state.allAssets || []);
        renderGrid();
      }
    }

    async function reloadAssetsMap(options = {}) {
      if (!boothAPI?.loadAssets) return;
      const preserveScroll = Boolean(options?.preserveScroll);
      const scroller = doc.scrollingElement || doc.documentElement;
      const prevScrollTop = preserveScroll ? Number(scroller?.scrollTop || 0) : 0;
      const assetsMap = await boothAPI.loadAssets();
      if (!assetsMap || assetsMap.error) return;
      setAssetsFromMap(assetsMap);
      applyCategoryFilter(state.currentCategory || 'all');
      if (preserveScroll && scroller) {
        requestAnimationFrame(() => {
          scroller.scrollTop = prevScrollTop;
        });
      }
      scheduleStorageUsageRefresh(120);
    }

    async function syncDownloadStateFromLatestMapNoRerender() {
      if (!boothAPI?.loadAssets) return false;
      const assetsMap = await boothAPI.loadAssets();
      if (!assetsMap || assetsMap.error) return false;
      let changed = false;
      for (const asset of (state.allAssets || [])) {
        const key = toItemIdKey(asset?.itemId);
        const latest = assetsMap?.[key];
        if (!latest) continue;
        const nextDownloaded = Boolean(latest?.downloaded);
        const nextHasUpdate = Boolean(latest?.hasUpdate);
        if (Boolean(asset.downloaded) !== nextDownloaded) {
          asset.downloaded = nextDownloaded;
          changed = true;
        }
        if (Boolean(asset.hasUpdate) !== nextHasUpdate) {
          asset.hasUpdate = nextHasUpdate;
          changed = true;
        }
      }
      if (changed) {
        state.assetsRevision = Number(state.assetsRevision || 0) + 1;
        state.assetByItemId = new Map(state.allAssets.map((asset) => [toItemIdKey(asset?.itemId), asset]));
        state.downloadedAssets = state.allAssets.filter((a) => Boolean(a?.downloaded));
        state.updateAssetCount = state.allAssets.reduce((acc, a) => acc + (a?.hasUpdate ? 1 : 0), 0);
      }
      return changed;
    }

    function getUndownloadedAssets() {
      return (state.allAssets || []).filter((a) => !a.downloaded && (a.files || []).length > 0);
    }

    function getDownloadableAssets() {
      return (state.allAssets || []).filter((a) => Array.isArray(a.files) && a.files.length > 0);
    }

    function getAssetAvatarAnalysisSummary(asset) {
      const analysis = asset?.supportedAvatarAnalysis && typeof asset.supportedAvatarAnalysis === 'object'
        ? asset.supportedAvatarAnalysis
        : null;
      if (!analysis) return null;
      const status = String(analysis.status || '').trim().toLowerCase();
      const primary = String(analysis.primaryAvatar || '').trim();
      const candidates = Array.isArray(analysis.candidates)
        ? analysis.candidates.filter((row) => String(row?.name || '').trim())
        : [];
      if (status === 'confirmed' && primary) {
        return {
          status,
          label: primary,
          tone: 'emerald',
          title: `対応アバター: ${primary}`,
        };
      }
      if (status === 'review' && candidates.length) {
        const label = candidates.length === 1
          ? String(candidates[0]?.name || '').trim()
          : `候補 ${candidates.length}`;
        return {
          status,
          label,
          tone: 'amber',
          title: candidates.map((row) => String(row?.name || '').trim()).filter(Boolean).join(', '),
        };
      }
      if (status === 'unclassified') {
        return {
          status,
          label: '未判定',
          tone: 'zinc',
          title: '対応アバターを特定できませんでした',
        };
      }
      return null;
    }

    function hasAvatarDetailedAnalysisResult() {
      const rows = Array.isArray(state.allAssets) ? state.allAssets : [];
      return rows.some((a) => Array.isArray(a?.supportedAvatarsInferred) && a.supportedAvatarsInferred.length > 0);
    }

    return {
      normalizeAssetsFromMap,
      toItemIdKey,
      getAssetByItemId,
      shouldTreatAsDownloaded,
      countUnanalyzedDownloaded,
      updateAnalyzeAvatarCompatBtn,
      setAssetsFromMap,
      refreshAvatarAliasLabels,
      reloadAssetsMap,
      syncDownloadStateFromLatestMapNoRerender,
      getUndownloadedAssets,
      getDownloadableAssets,
      getAssetAvatarAnalysisSummary,
      hasAvatarDetailedAnalysisResult,
    };
  }

  global.AvatoolRenderAssetState = {
    createRenderAssetState,
  };
})(window);
