(function attachRenderLibraryActions(global) {
  function createRenderLibraryActions(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const boothAPI = deps?.boothAPI;
    const showTransientMessage = deps?.showTransientMessage;
    const setAssetsFromMap = deps?.setAssetsFromMap;
    const applyCategoryFilter = deps?.applyCategoryFilter;
    const getAssetByItemId = deps?.getAssetByItemId;
    const reloadAssetsMap = deps?.reloadAssetsMap;
    const enqueueAssets = deps?.enqueueAssets;
    const openPackageSelectionModal = deps?.openPackageSelectionModal;

    if (
      !state ||
      !boothAPI ||
      typeof showTransientMessage !== 'function' ||
      typeof setAssetsFromMap !== 'function' ||
      typeof applyCategoryFilter !== 'function' ||
      typeof getAssetByItemId !== 'function' ||
      typeof reloadAssetsMap !== 'function' ||
      typeof enqueueAssets !== 'function' ||
      typeof openPackageSelectionModal !== 'function'
    ) {
      throw new Error('createRenderLibraryActions requires state, boothAPI, and library action helpers.');
    }

    function openManualAddModal() {
      if (!domRefs.manualAddModal) return;
      if (domRefs.manualAddStatus) domRefs.manualAddStatus.textContent = '';
      if (domRefs.manualAddInput) domRefs.manualAddInput.value = '';
      domRefs.manualAddModal.classList.remove('hidden');
      domRefs.manualAddModal.classList.add('flex');
      setTimeout(() => {
        domRefs.manualAddInput?.focus();
      }, 0);
    }

    function closeManualAddModal() {
      domRefs.manualAddModal?.classList.add('hidden');
      domRefs.manualAddModal?.classList.remove('flex');
    }

    function mapManualAddError(raw) {
      const msg = String(raw || '');
      if (msg.includes('invalid_item_id_or_url')) return 'URLまたはIDの形式が正しくありません。（例: https://booth.pm/ja/items/1234567 または 1234567）';
      if (msg.includes('item_json_fetch_failed')) return 'アイテム情報を取得できませんでした（URL/IDを確認してください）。';
      if (msg.includes('free_download_links_not_found')) return '無料配布ファイルが見つかりませんでした。';
      return msg || '不明なエラー';
    }

    function resetManualAddPreview() {
      if (state.manualAddPreviewTimer) {
        clearTimeout(state.manualAddPreviewTimer);
        state.manualAddPreviewTimer = null;
      }
      state.manualAddDraft = null;
      if (domRefs.manualAddPreviewBox) domRefs.manualAddPreviewBox.classList.add('hidden');
      if (domRefs.manualAddPreviewId) domRefs.manualAddPreviewId.textContent = '';
      if (domRefs.manualAddPreviewTitle) domRefs.manualAddPreviewTitle.textContent = '';
      if (domRefs.manualAddPreviewAuthor) domRefs.manualAddPreviewAuthor.textContent = '';
      if (domRefs.manualAddPreviewFiles) domRefs.manualAddPreviewFiles.textContent = '';
      if (domRefs.manualAddPreviewImage) {
        domRefs.manualAddPreviewImage.removeAttribute('src');
        domRefs.manualAddPreviewImage.classList.add('hidden');
      }
      if (domRefs.manualAddSubmit) domRefs.manualAddSubmit.disabled = true;
    }

    async function previewManualAdd(options = {}) {
      const auto = Boolean(options?.auto);
      const input = String(domRefs.manualAddInput?.value || '').trim();
      if (!input) {
        if (domRefs.manualAddStatus) domRefs.manualAddStatus.textContent = 'URLまたはIDを入力してください。';
        return;
      }
      if (!boothAPI.previewManualFreeAsset) {
        if (domRefs.manualAddStatus) domRefs.manualAddStatus.textContent = 'previewManualFreeAsset API が利用できません。';
        return;
      }
      if (domRefs.manualAddPreview) domRefs.manualAddPreview.disabled = true;
      if (domRefs.manualAddSubmit) domRefs.manualAddSubmit.disabled = true;
      if (domRefs.manualAddStatus) domRefs.manualAddStatus.textContent = '確認中...';
      try {
        const res = await boothAPI.previewManualFreeAsset(input);
        if (res?.error) throw new Error(mapManualAddError(res.error));
        state.manualAddDraft = {
          itemIdOrUrl: input,
          itemId: String(res.itemId || ''),
          title: String(res.title || ''),
          author: String(res.author || ''),
          files: Number(res.files || 0),
          previewUrl: String(res.previewUrl || ''),
        };
        if (domRefs.manualAddPreviewId) domRefs.manualAddPreviewId.textContent = state.manualAddDraft.itemId;
        if (domRefs.manualAddPreviewTitle) domRefs.manualAddPreviewTitle.textContent = state.manualAddDraft.title || '-';
        if (domRefs.manualAddPreviewAuthor) domRefs.manualAddPreviewAuthor.textContent = state.manualAddDraft.author || '-';
        if (domRefs.manualAddPreviewFiles) domRefs.manualAddPreviewFiles.textContent = `${state.manualAddDraft.files} 件`;
        if (domRefs.manualAddPreviewImage) {
          const url = String(state.manualAddDraft.previewUrl || '').trim();
          if (url) {
            domRefs.manualAddPreviewImage.src = url;
            domRefs.manualAddPreviewImage.classList.remove('hidden');
          } else {
            domRefs.manualAddPreviewImage.removeAttribute('src');
            domRefs.manualAddPreviewImage.classList.add('hidden');
          }
        }
        if (domRefs.manualAddPreviewBox) domRefs.manualAddPreviewBox.classList.remove('hidden');
        if (domRefs.manualAddStatus) {
          domRefs.manualAddStatus.textContent = auto
            ? 'プレビューを更新しました。追加できます。'
            : '内容を確認しました。追加できます。';
        }
        if (domRefs.manualAddSubmit) domRefs.manualAddSubmit.disabled = false;
      } catch (error) {
        resetManualAddPreview();
        if (domRefs.manualAddStatus) domRefs.manualAddStatus.textContent = `確認失敗: ${String(error?.message || error)}`;
        if (!auto) {
          showTransientMessage(`手動追加の確認に失敗: ${String(error?.message || error)}`, 'error');
        }
      } finally {
        if (domRefs.manualAddPreview) domRefs.manualAddPreview.disabled = false;
      }
    }

    function scheduleManualAddPreview() {
      if (state.manualAddPreviewTimer) clearTimeout(state.manualAddPreviewTimer);
      const input = String(domRefs.manualAddInput?.value || '').trim();
      if (!input) return;
      state.manualAddPreviewTimer = setTimeout(() => {
        state.manualAddPreviewTimer = null;
        previewManualAdd({ auto: true }).catch(() => {});
      }, 450);
    }

    async function submitManualAdd() {
      const draft = state.manualAddDraft || null;
      if (!draft || !draft.itemIdOrUrl) {
        if (domRefs.manualAddStatus) domRefs.manualAddStatus.textContent = '先に確認を実行してください。';
        return;
      }
      if (!boothAPI.addManualFreeAsset) {
        if (domRefs.manualAddStatus) domRefs.manualAddStatus.textContent = 'addManualFreeAsset API が利用できません。';
        return;
      }
      if (domRefs.manualAddSubmit) domRefs.manualAddSubmit.disabled = true;
      if (domRefs.manualAddStatus) domRefs.manualAddStatus.textContent = '追加中...';
      try {
        const res = await boothAPI.addManualFreeAsset(draft.itemIdOrUrl);
        if (res?.error) throw new Error(mapManualAddError(res.error));
        let addedAsset = null;
        if (res?.assets) {
          setAssetsFromMap(res.assets);
          applyCategoryFilter(state.currentCategory || 'all');
          const addedId = String(res?.itemId || draft.itemId || '').trim();
          if (addedId) addedAsset = getAssetByItemId(addedId);
        } else {
          await reloadAssetsMap();
          const addedId = String(res?.itemId || draft.itemId || '').trim();
          if (addedId) addedAsset = getAssetByItemId(addedId);
        }
        if (addedAsset) {
          await enqueueAssets([addedAsset]);
        }
        showTransientMessage(`追加しました: ${res?.title || res?.itemId || draft.itemIdOrUrl}`, 'info');
        resetManualAddPreview();
        closeManualAddModal();
      } catch (error) {
        const msg = String(error?.message || error);
        if (domRefs.manualAddStatus) domRefs.manualAddStatus.textContent = `追加失敗: ${msg}`;
        showTransientMessage(`手動追加に失敗: ${msg}`, 'error');
      } finally {
        if (domRefs.manualAddSubmit) domRefs.manualAddSubmit.disabled = false;
      }
    }

    async function handleBatchImportSelection() {
      if (state.selectedItems.size === 0) return;
      const originalText = domRefs.btnBatchImport?.textContent || '';
      if (domRefs.btnBatchImport) {
        domRefs.btnBatchImport.textContent = 'スキャン中...';
        domRefs.btnBatchImport.disabled = true;
      }
      try {
        const scanPromises = Array.from(state.selectedItems).map(async (id) => {
          const asset = getAssetByItemId(id);
          if (!asset || !asset.downloaded) return null;
          const res = await boothAPI.listItemFiles(asset.itemId, asset.title || '');
          if (res?.error || !Array.isArray(res?.files)) return null;
          const pkgs = res.files
            .filter((file) => file.kind === 'file' && String(file.name || '').toLowerCase().endsWith('.unitypackage'))
            .map((file) => ({ ...file, mtimeDate: new Date(file.mtime || 0) }))
            .sort((a, b) => Number(b.mtime || 0) - Number(a.mtime || 0));
          if (!pkgs.length) return null;
          return { asset, packages: pkgs };
        });
        const settled = await Promise.allSettled(scanPromises);
        const scanResults = settled
          .filter((row) => row.status === 'fulfilled' && row.value)
          .map((row) => row.value);
        if (!scanResults.length) {
          showTransientMessage('選択内にUnityパッケージが見つかりません。', 'error');
          return;
        }
        openPackageSelectionModal(scanResults);
      } catch (error) {
        showTransientMessage(`スキャン失敗: ${error?.message || error}`, 'error');
      } finally {
        if (domRefs.btnBatchImport) {
          domRefs.btnBatchImport.textContent = originalText;
          domRefs.btnBatchImport.disabled = state.selectedItems.size === 0;
        }
      }
    }

    function bindUiEvents() {
      domRefs.manualAddBtn?.addEventListener('click', () => {
        openManualAddModal();
        resetManualAddPreview();
      });
      domRefs.manualAddCancel?.addEventListener('click', () => {
        closeManualAddModal();
      });
      domRefs.manualAddClose?.addEventListener('click', () => {
        closeManualAddModal();
      });
      domRefs.manualAddSubmit?.addEventListener('click', async () => {
        await submitManualAdd();
      });
      domRefs.manualAddPreview?.addEventListener('click', async () => {
        await previewManualAdd();
      });
      if (domRefs.manualAddInput) {
        domRefs.manualAddInput.addEventListener('input', () => {
          resetManualAddPreview();
          if (domRefs.manualAddStatus) domRefs.manualAddStatus.textContent = '入力を確認中...';
          scheduleManualAddPreview();
        });
        domRefs.manualAddInput.addEventListener('keydown', async (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          await previewManualAdd();
        });
      }
      domRefs.btnBatchImport?.addEventListener('click', async () => {
        await handleBatchImportSelection();
      });
    }

    return {
      bindUiEvents,
      openManualAddModal,
      closeManualAddModal,
      resetManualAddPreview,
      previewManualAdd,
      scheduleManualAddPreview,
      submitManualAdd,
      handleBatchImportSelection,
    };
  }

  global.AvatoolRenderLibraryActions = {
    createRenderLibraryActions,
  };
})(window);
