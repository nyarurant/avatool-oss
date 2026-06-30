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

    function mapWishlistError(raw) {
      const msg = String(raw || '');
      if (msg.includes('invalid_item_id_or_url')) return 'URLまたはIDの形式が正しくありません。（例: https://booth.pm/ja/items/1234567 または 1234567）';
      if (msg.includes('item_json_fetch_failed')) return 'アイテム情報を取得できませんでした（URL/IDを確認してください）。';
      return msg || '不明なエラー';
    }

    function setWishlistAddStatus(message, tone = 'muted') {
      const el = domRefs.wishlistAddStatus;
      if (!el) return;
      const toneClasses = {
        muted: 'border-white/8 bg-black/20 text-zinc-500',
        loading: 'border-sky-400/20 bg-sky-400/10 text-sky-200',
        success: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
        error: 'border-red-400/25 bg-red-400/10 text-red-200',
      };
      Object.values(toneClasses).join(' ').split(' ').forEach((className) => el.classList.remove(className));
      toneClasses[tone]?.split(' ').forEach((className) => el.classList.add(className));
      el.textContent = message || '';
    }

    function openWishlistAddModal() {
      if (!domRefs.wishlistAddModal) return;
      setWishlistAddStatus('URLまたはIDを入力すると自動で内容を確認します。');
      if (domRefs.wishlistAddInput) domRefs.wishlistAddInput.value = '';
      domRefs.wishlistAddModal.classList.remove('hidden');
      domRefs.wishlistAddModal.classList.add('flex');
      setTimeout(() => domRefs.wishlistAddInput?.focus(), 50);
    }

    function closeWishlistAddModal() {
      domRefs.wishlistAddModal?.classList.add('hidden');
      domRefs.wishlistAddModal?.classList.remove('flex');
    }

    function resetWishlistPreview() {
      if (state.wishlistPreviewTimer) {
        clearTimeout(state.wishlistPreviewTimer);
        state.wishlistPreviewTimer = null;
      }
      state.wishlistDraft = null;
      if (domRefs.wishlistAddPreviewBox) domRefs.wishlistAddPreviewBox.classList.add('hidden');
      if (domRefs.wishlistAddPreviewId) domRefs.wishlistAddPreviewId.textContent = '';
      if (domRefs.wishlistAddPreviewTitle) domRefs.wishlistAddPreviewTitle.textContent = '';
      if (domRefs.wishlistAddPreviewAuthor) domRefs.wishlistAddPreviewAuthor.textContent = '';
      if (domRefs.wishlistAddPreviewImage) {
        domRefs.wishlistAddPreviewImage.removeAttribute('src');
        domRefs.wishlistAddPreviewImage.classList.add('hidden');
      }
      if (domRefs.wishlistAddSubmit) domRefs.wishlistAddSubmit.disabled = true;
    }

    async function previewWishlistAdd({ auto = false } = {}) {
      const input = String(domRefs.wishlistAddInput?.value || '').trim();
      if (!input) {
        setWishlistAddStatus('URLまたはIDを入力してください。', 'error');
        return;
      }
      if (!boothAPI.previewWishlistItem) {
        setWishlistAddStatus('previewWishlistItem API が利用できません。', 'error');
        return;
      }
      if (domRefs.wishlistAddPreview) domRefs.wishlistAddPreview.disabled = true;
      if (domRefs.wishlistAddSubmit) domRefs.wishlistAddSubmit.disabled = true;
      setWishlistAddStatus('BOOTH から商品情報を確認中...', 'loading');
      try {
        const res = await boothAPI.previewWishlistItem(input);
        if (res?.error) throw new Error(mapWishlistError(res.error));
        state.wishlistDraft = {
          itemIdOrUrl: input,
          itemId: String(res.itemId || ''),
          title: String(res.title || ''),
          author: String(res.author || ''),
          previewUrl: String(res.previewUrl || ''),
        };
        if (domRefs.wishlistAddPreviewId) domRefs.wishlistAddPreviewId.textContent = state.wishlistDraft.itemId;
        if (domRefs.wishlistAddPreviewTitle) domRefs.wishlistAddPreviewTitle.textContent = state.wishlistDraft.title || '-';
        if (domRefs.wishlistAddPreviewAuthor) domRefs.wishlistAddPreviewAuthor.textContent = state.wishlistDraft.author || '-';
        if (domRefs.wishlistAddPreviewImage) {
          const url = String(state.wishlistDraft.previewUrl || '').trim();
          if (url) {
            domRefs.wishlistAddPreviewImage.src = url;
            domRefs.wishlistAddPreviewImage.classList.remove('hidden');
          } else {
            domRefs.wishlistAddPreviewImage.removeAttribute('src');
            domRefs.wishlistAddPreviewImage.classList.add('hidden');
          }
        }
        if (domRefs.wishlistAddPreviewBox) domRefs.wishlistAddPreviewBox.classList.remove('hidden');
        setWishlistAddStatus(auto
          ? 'プレビューを更新しました。追加できます。'
          : '内容を確認しました。追加できます。', 'success');
        if (domRefs.wishlistAddSubmit) domRefs.wishlistAddSubmit.disabled = false;
      } catch (error) {
        resetWishlistPreview();
        setWishlistAddStatus(`確認失敗: ${String(error?.message || error)}`, 'error');
        if (!auto) {
          showTransientMessage(`ほしいリスト確認に失敗: ${String(error?.message || error)}`, 'error');
        }
      } finally {
        if (domRefs.wishlistAddPreview) domRefs.wishlistAddPreview.disabled = false;
      }
    }

    function scheduleWishlistPreview() {
      if (state.wishlistPreviewTimer) clearTimeout(state.wishlistPreviewTimer);
      const input = String(domRefs.wishlistAddInput?.value || '').trim();
      if (!input) return;
      state.wishlistPreviewTimer = setTimeout(() => {
        state.wishlistPreviewTimer = null;
        previewWishlistAdd({ auto: true }).catch(() => {});
      }, 450);
    }

    async function submitWishlistAdd() {
      const draft = state.wishlistDraft || null;
      if (!draft || !draft.itemId) {
        setWishlistAddStatus('先に確認を実行してください。', 'error');
        return;
      }
      if (!boothAPI.toggleWishlist) {
        setWishlistAddStatus('toggleWishlist API が利用できません。', 'error');
        return;
      }
      if (domRefs.wishlistAddSubmit) domRefs.wishlistAddSubmit.disabled = true;
      setWishlistAddStatus('ほしいリストに追加中...', 'loading');
      try {
        const res = await boothAPI.toggleWishlist(draft.itemId, draft.itemIdOrUrl);
        if (res?.error) throw new Error(mapWishlistError(res.error));
        await reloadAssetsMap();
        showTransientMessage(`ほしいリストに追加しました: ${draft.title || draft.itemId}`, 'info');
        resetWishlistPreview();
        closeWishlistAddModal();
      } catch (error) {
        const msg = String(error?.message || error);
        setWishlistAddStatus(`追加失敗: ${msg}`, 'error');
        showTransientMessage(`ほしいリスト追加に失敗: ${msg}`, 'error');
      } finally {
        if (domRefs.wishlistAddSubmit) domRefs.wishlistAddSubmit.disabled = false;
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

      domRefs.wishlistAddBtn?.addEventListener('click', () => {
        openWishlistAddModal();
        resetWishlistPreview();
      });
      domRefs.wishlistAddCancel?.addEventListener('click', () => {
        closeWishlistAddModal();
      });
      domRefs.wishlistAddClose?.addEventListener('click', () => {
        closeWishlistAddModal();
      });
      domRefs.wishlistAddSubmit?.addEventListener('click', async () => {
        await submitWishlistAdd();
      });
      domRefs.wishlistAddPreview?.addEventListener('click', async () => {
        await previewWishlistAdd();
      });
      if (domRefs.wishlistAddInput) {
        domRefs.wishlistAddInput.addEventListener('input', () => {
          resetWishlistPreview();
          const input = String(domRefs.wishlistAddInput?.value || '').trim();
          if (!input) {
            setWishlistAddStatus('URLまたはIDを入力すると自動で内容を確認します。');
            return;
          }
          setWishlistAddStatus('入力を確認中...', 'loading');
          scheduleWishlistPreview();
        });
        domRefs.wishlistAddInput.addEventListener('keydown', async (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          await previewWishlistAdd();
        });
      }

      domRefs.wishlistImportBoothBtn?.addEventListener('click', async () => {
        const btn = domRefs.wishlistImportBoothBtn;
        const progressEl = domRefs.wishlistImportProgress;
        if (btn.dataset.loading) return;
        btn.dataset.loading = '1';
        btn.disabled = true;
        btn.textContent = '取得中…';
        if (progressEl) { progressEl.classList.remove('hidden'); progressEl.textContent = 'BOOTHほしいリストを取得しています…'; }

        let unsubProgress = null;
        if (boothAPI.onWishlistImportProgress) {
          unsubProgress = boothAPI.onWishlistImportProgress(({ done, total, itemId }) => {
            if (progressEl) progressEl.textContent = `処理中 ${done + 1} / ${total} 件… (${itemId})`;
          });
        }

        try {
          const res = await boothAPI.importBoothWishlist();
          if (res?.error) {
            if (progressEl) progressEl.textContent = `エラー: ${res.error}`;
          } else if (res?.ok) {
            const msg = res.imported > 0
              ? `${res.imported} 件を追加しました（スキップ: ${res.skipped} 件）`
              : `追加対象なし（既に登録済み: ${res.skipped} 件）`;
            if (progressEl) progressEl.textContent = msg;
            setTimeout(() => { if (progressEl) progressEl.classList.add('hidden'); }, 5000);
          }
        } catch (e) {
          if (progressEl) progressEl.textContent = `エラー: ${e?.message || String(e)}`;
        } finally {
          unsubProgress?.();
          delete btn.dataset.loading;
          btn.disabled = false;
          btn.textContent = 'インポート';
        }
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
      openWishlistAddModal,
      closeWishlistAddModal,
      resetWishlistPreview,
      previewWishlistAdd,
      scheduleWishlistPreview,
      submitWishlistAdd,
      handleBatchImportSelection,
    };
  }

  global.AvatoolRenderLibraryActions = {
    createRenderLibraryActions,
  };
})(window);
