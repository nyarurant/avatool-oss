(function attachRenderDownloadActions(global) {
  function createRenderDownloadActions(deps) {
    const state = deps?.state;
    const boothAPI = deps?.boothAPI || global.boothAPI;
    const showTransientMessage = (...args) => deps?.showTransientMessage(...args);
    const openPackageSelectionModal = (...args) => deps?.openPackageSelectionModal(...args);
    const formatBytes = deps?.formatBytes;
    const renderQueueStatus = (...args) => deps?.renderQueueStatus(...args);
    const setAssetsFromMap = deps?.setAssetsFromMap;
    const applyCategoryFilter = deps?.applyCategoryFilter;
    const getUndownloadedAssets = deps?.getUndownloadedAssets;

    async function openImportForAsset(asset) {
      if (!asset || !asset.downloaded) {
        showTransientMessage('未ダウンロードのためインポートできません。', 'error');
        return;
      }
      if (!boothAPI?.listItemFiles) {
        showTransientMessage('listItemFiles API が利用できません。', 'error');
        return;
      }
      const res = await boothAPI.listItemFiles(asset.itemId, asset.title || '');
      if (res?.error || !Array.isArray(res?.files)) {
        showTransientMessage(`パッケージ一覧の取得に失敗: ${res?.error || 'unknown'}`, 'error');
        return;
      }
      const pkgs = res.files
        .filter((f) => f.kind === 'file' && String(f.name || '').toLowerCase().endsWith('.unitypackage'))
        .map((f) => ({ ...f, mtimeDate: new Date(f.mtime || 0) }))
        .sort((a, b) => Number(b.mtime || 0) - Number(a.mtime || 0));
      if (!pkgs.length) {
        showTransientMessage('このアイテムにUnityパッケージが見つかりません。', 'error');
        return;
      }
      openPackageSelectionModal([{ asset, packages: pkgs }]);
    }

    function formatEnqueueError(res) {
      if (!res?.error) return '';
      if (res.error === 'insufficient_disk_space') {
        const free = formatBytes(res.freeBytes || 0);
        const need = formatBytes(res.minFreeBytes || 0);
        return `空き容量不足: 現在 ${free} / 必要最小 ${need}`;
      }
      return String(res.error || 'enqueue_failed');
    }

    async function enqueueAssets(assets, options = {}) {
      if (!assets || !assets.length) return { ok: true, skipped: true };
      const forceRedownload = Boolean(options?.forceRedownload);
      const payload = assets.map((a) => {
        const itemId = String(a.itemId || '');
        const shouldAnalyzeAfterDownload = !forceRedownload && !a?.downloaded;
        return {
          itemId: a.itemId,
          title: a.title || '',
          files: a.files || [],
          forceRedownload,
          analyzeAfterDownload: shouldAnalyzeAfterDownload,
          expectedStableHash: state.expectedUpdateHashByItemId.get(itemId) || null,
        };
      });
      const res = await boothAPI.enqueueDownloads(payload);
      if (res?.queue) renderQueueStatus(res.queue);
      if (res?.error) showTransientMessage(formatEnqueueError(res), 'error');
      if (res?.capped) showTransientMessage(`一括ダウンロードは ${res.batchLimit} 件までです。残り ${res.skippedCount} 件はこのバッチ完了後に再実行してください。`, 'warning');
      return res;
    }

    async function runLibrarySync(autoDownloadUndownloaded = false) {
      const syncRes = await boothAPI.syncLibrary({
        refreshMetaIfNew: true,
        autoDownloadUndownloaded,
      });
      if (syncRes?.error) throw new Error(syncRes.error);

      const map = await boothAPI.loadAssets();
      if (map?.error) throw new Error(map.error);
      setAssetsFromMap(map);
      applyCategoryFilter(state.currentCategory || 'all');

      if (autoDownloadUndownloaded) {
        const undownloaded = getUndownloadedAssets();
        await enqueueAssets(undownloaded);
      }
      return syncRes;
    }

    async function runAvatarCompatibilityAnalysis(options = {}) {
      if (!boothAPI?.analyzeAvatarCompatibility) {
        throw new Error('analyze_avatar_compatibility_unavailable');
      }
      const res = await boothAPI.analyzeAvatarCompatibility({ scope: 'avatar-analysis', ...options });
      if (res?.error) throw new Error(res.error);
      const next = res?.assets && typeof res.assets === 'object'
        ? res.assets
        : await boothAPI.loadAssets();
      if (next?.error) throw new Error(next.error);
      setAssetsFromMap(next, { preserveRuntimeDownloaded: true });
      applyCategoryFilter(state.currentCategory || 'all');
    }

    async function handleDownload(asset, tileEl) {
      const ui = state.tileMap.get(asset.itemId);
      if (!ui) return;

      ui.dlBtn.disabled = true;
      ui.dlBtn.classList.add('opacity-60');
      ui.progressWrapper.classList.remove('opacity-0');
      ui.progressWrapper.classList.add('opacity-100');
      ui.progressBar.style.width = '0%';

      try {
        const res = await enqueueAssets([asset]);
        if (res.error) throw new Error(formatEnqueueError(res));
        // Progress and completion UI are updated by the download progress IPC listener.
      } catch (err) {
        console.error(err);
        if (ui.statusEl) {
          ui.statusEl.textContent = 'error';
          ui.statusEl.title = String(err);
          ui.statusEl.classList.add('text-red-400');
        }
        ui.dlBtn.disabled = false;
        ui.dlBtn.classList.remove('opacity-60');
        ui.progressWrapper.classList.remove('opacity-100');
        ui.progressWrapper.classList.add('opacity-0');
      }
    }

    // Force-redownloads the new version for an item flagged hasUpdate. Unlike
    // handleDownload(), this must set forceRedownload so the queue actually fetches
    // the updated files instead of treating the item as already-downloaded and
    // silently no-op'ing (see DevNote-2026-07-03-update-notification-resurface-fix).
    async function handleUpdateDownload(asset, tileEl) {
      const ui = state.tileMap.get(asset.itemId);
      if (!ui) return;

      if (ui.updateBtn) {
        ui.updateBtn.disabled = true;
        ui.updateBtn.classList.add('opacity-60');
      }
      ui.progressWrapper.classList.remove('opacity-0');
      ui.progressWrapper.classList.add('opacity-100');
      ui.progressBar.style.width = '0%';

      try {
        const res = await enqueueAssets([asset], { forceRedownload: true });
        if (res.error) throw new Error(formatEnqueueError(res));
        // Progress and completion UI are updated by the download progress IPC listener.
      } catch (err) {
        console.error(err);
        if (ui.statusEl) {
          ui.statusEl.textContent = 'error';
          ui.statusEl.title = String(err);
          ui.statusEl.classList.add('text-red-400');
        }
        if (ui.updateBtn) {
          ui.updateBtn.disabled = false;
          ui.updateBtn.classList.remove('opacity-60');
        }
        ui.progressWrapper.classList.remove('opacity-100');
        ui.progressWrapper.classList.add('opacity-0');
      }
    }

    return {
      openImportForAsset,
      formatEnqueueError,
      enqueueAssets,
      runLibrarySync,
      runAvatarCompatibilityAnalysis,
      handleDownload,
      handleUpdateDownload,
    };
  }

  global.AvatoolRenderDownloadActions = {
    createRenderDownloadActions,
  };
})(window);
