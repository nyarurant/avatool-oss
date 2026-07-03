(function attachRenderMetaAvatarSyncUi(global) {
  function createRenderMetaAvatarSyncUi(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const esc = deps?.esc;
    const boothAPI = deps?.boothAPI || global.boothAPI;
    const runLibrarySync = deps?.runLibrarySync;
    const runAvatarCompatibilityAnalysis = deps?.runAvatarCompatibilityAnalysis;
    const updateAnalyzeAvatarCompatBtn = deps?.updateAnalyzeAvatarCompatBtn;
    const scheduleStorageUsageRefresh = deps?.scheduleStorageUsageRefresh;
    const showTransientMessage = (...args) => deps?.showTransientMessage(...args);
    const beginMetaProgressScope = (...args) => deps?.beginMetaProgressScope(...args);
    const endMetaProgressScope = (...args) => deps?.endMetaProgressScope(...args);

    async function markAssetUpdateSeen(asset) {
      if (!asset?.hasUpdate || !boothAPI?.markUpdateSeen) return;
      const key = String(asset.itemId || '');
      const expectedStableHash = state.expectedUpdateHashByItemId.get(key) || null;
      const res = await boothAPI.markUpdateSeen(asset.itemId, asset.files || [], expectedStableHash);
      if (!res?.error) {
        asset.hasUpdate = false;
        state.assetsRevision = Number(state.assetsRevision || 0) + 1;
        state.expectedUpdateHashByItemId.delete(key);
      } else {
        console.warn('markUpdateSeen failed:', res.error);
      }
    }

    async function autoLoadVccProjectsIfNeeded() {
      try {
        if (!boothAPI?.getSettings || !boothAPI?.loadVCCProjects || !boothAPI?.updateSettings) {
          return;
        }

        const current = await boothAPI.getSettings();
        state.settings = current || {};

        const hasProjects = Array.isArray(current?.unityProjects) && current.unityProjects.length > 0;
        const hasUnityPath = typeof current?.unityEditorPath === 'string' && current.unityEditorPath.trim().length > 0;
        if (hasProjects && hasUnityPath) return;

        const vcc = await boothAPI.loadVCCProjects();
        if (!vcc || vcc.error || !Array.isArray(vcc.projects) || vcc.projects.length === 0) {
          console.warn('[renderer] auto VCC load skipped:', vcc?.error || 'no projects');
          return;
        }

        const next = {
          ...current,
          unityProjects: vcc.projects,
          unityEditorPath: vcc.editorPath || current?.unityEditorPath || '',
        };
        const res = await boothAPI.updateSettings(next);
        if (res && !res.error) {
          state.settings = res.settings || next;
          console.log('[renderer] Unity projects auto-loaded from VCC');
        } else {
          console.warn('[renderer] failed to save auto-loaded VCC projects:', res?.error);
        }
      } catch (e) {
        console.warn('[renderer] autoLoadVccProjectsIfNeeded failed:', e);
      }
    }

    async function refreshMetaNewUI() {
      const btn = domRefs.syncLibraryBtn;
      const svg = btn?.querySelector('svg');
      let ok = false;
      if (btn) {
        btn.disabled = true;
        if (svg) svg.classList.add('animate-spin', 'text-blue-400');
      }

      try {
        beginMetaProgressScope('sync-library', 'メタデータ同期を開始中...');
        if (domRefs.grid) {
          domRefs.grid.innerHTML = `
            <div class="col-span-full text-[10px] text-gray-500 font-mono-custom">
              Updating meta...
            </div>
          `;
        }
        const syncRes = await runLibrarySync(false);
        scheduleStorageUsageRefresh(300);
        if (domRefs.grid) domRefs.grid.innerHTML = '';
        if (domRefs.lastUpdatedSpan) {
          const now = new Date();
          domRefs.lastUpdatedSpan.textContent = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        }
        const ms = Number(syncRes?.summary?.elapsedMs || 0);
        const sec = ms > 0 ? (ms / 1000).toFixed(1) : '0.0';
        const newItems = Number(syncRes?.summary?.newItemCount || 0);
        const totalItems = Number(syncRes?.summary?.totalItemCount ?? state.allAssets?.length ?? 0);
        state.libraryEmptyReason = String(syncRes?.summary?.emptyReason || '');
        state.boothLoggedIn = syncRes?.summary?.boothLoggedIn ?? null;
        const catBackfilled = Number(syncRes?.summary?.categoryBackfillCount || 0);
        const fallbackThumb = Number(syncRes?.summary?.fallbackPreviewCount || 0);
        const fallbackIcon = Number(syncRes?.summary?.fallbackAuthorIconCount || 0);
        if (totalItems <= 0) {
          const emptyMessage = state.libraryEmptyReason === 'not_logged_in'
            ? 'BOOTHにログインしていません'
            : state.libraryEmptyReason === 'no_purchases'
              ? '購入アイテムはありません'
              : '購入アイテムを確認できません';
          showTransientMessage(
            `同期完了 ${sec}s / ${emptyMessage}`,
            'info',
            6500,
          );
        } else {
          showTransientMessage(
            `同期完了 ${sec}s / 合計 ${totalItems} 件 / 新規 ${newItems} 件 / カテゴリ補完 ${catBackfilled} 件 / 画像フォールバック ${fallbackThumb} 件 / アイコンフォールバック ${fallbackIcon} 件`,
            'info',
            6500,
          );
        }
        ok = true;
      } catch (e) {
        console.error(e);
        if (domRefs.grid) {
          domRefs.grid.innerHTML = `
            <div class="col-span-full text-[10px] text-red-500 font-mono-custom">
              ${esc(e?.message || String(e))}
            </div>
          `;
        }
        showTransientMessage(`同期に失敗しました: ${e?.message || e}`, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          if (svg) svg.classList.remove('animate-spin', 'text-blue-400');
        }
        endMetaProgressScope('sync-library');
      }
      return ok;
    }

    async function refreshAvatarAnalysisUI(options = {}) {
      const btn = domRefs.analyzeAvatarCompatBtn;
      const svg = btn?.querySelector('svg');
      let ok = false;
      if (btn) {
        btn.disabled = true;
        if (svg) svg.classList.add('animate-spin', 'text-cyan-300');
      }

      try {
        beginMetaProgressScope('avatar-analysis', '対応衣装の詳細解析を開始中...');
        await runAvatarCompatibilityAnalysis(options);
        scheduleStorageUsageRefresh(300);
        showTransientMessage('対応衣装の詳細解析が完了しました。', 'info');
        ok = true;
      } catch (e) {
        console.error(e);
        showTransientMessage(`詳細解析に失敗しました: ${e?.message || e}`, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          if (svg) svg.classList.remove('animate-spin', 'text-cyan-300');
        }
        endMetaProgressScope('avatar-analysis');
      }
      updateAnalyzeAvatarCompatBtn();
      return ok;
    }

    return {
      markAssetUpdateSeen,
      autoLoadVccProjectsIfNeeded,
      refreshMetaNewUI,
      refreshAvatarAnalysisUI,
    };
  }

  global.AvatoolRenderMetaAvatarSyncUi = {
    createRenderMetaAvatarSyncUi,
  };
})(window);
