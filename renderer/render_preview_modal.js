(function attachRenderPreviewModal(global) {
  function createRenderPreviewModal(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const boothAPI = deps?.boothAPI;
    const esc = deps?.esc;
    const enableKeyboardActivation = deps?.enableKeyboardActivation;
    const renderImportHistoryInModal = deps?.renderImportHistoryInModal;
    const getIconForFile = deps?.getIconForFile;
    const isImageFile = deps?.isImageFile;
    const openImportModal = deps?.openImportModal;
    const closeImportModal = deps?.closeImportModal;
    const closePackageSelectionModal = deps?.closePackageSelectionModal;
    const markAssetUpdateSeen = deps?.markAssetUpdateSeen;
    const setAssetsFromMap = deps?.setAssetsFromMap;
    const renderGrid = deps?.renderGrid;
    const showTransientMessage = deps?.showTransientMessage;
    const setImportAcknowledgeMode = deps?.setImportAcknowledgeMode;
    const setImportActionButtonsBusy = deps?.setImportActionButtonsBusy;
    const setImportCloseDisabled = deps?.setImportCloseDisabled;
    const resetImportProgress = deps?.resetImportProgress;
    const setAvatarFilterPanelOpen = deps?.setAvatarFilterPanelOpen;
    const openModelPreview = deps?.openModelPreview;
    const closeModelPreview = deps?.closeModelPreview;
    const icons = deps?.icons || {};
    const logger = deps?.logger || global.console;
    const updateUserMeta = deps?.updateUserMeta;
    const reloadAssetsMap = deps?.reloadAssetsMap;

    if (
      !state || !boothAPI || typeof esc !== 'function' || typeof enableKeyboardActivation !== 'function'
      || typeof getIconForFile !== 'function' || typeof isImageFile !== 'function'
    ) {
      throw new Error('createRenderPreviewModal requires renderer modal dependencies.');
    }

    const imageFileExts = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.heic', '.heif', '.ico',
    ]);

    function getFileExt(fileName) {
      const normalized = String(fileName || '').trim().toLowerCase();
      const idx = normalized.lastIndexOf('.');
      return idx < 0 ? '' : normalized.slice(idx);
    }

    function isImageFileName(fileName) {
      return imageFileExts.has(getFileExt(fileName));
    }

    function shouldAutoOpenFolderForImageOnly(files) {
      const rows = (files || []).filter((file) => file && file.kind === 'file' && getFileExt(file.name) !== '.zip');
      return rows.length > 0 && rows.every((file) => isImageFileName(file.name));
    }

    function buildFolderTree(files) {
      const dirs = { '': { name: '(root)', path: '', children: [] } };
      const byPath = {};
      for (const file of files) {
        byPath[file.relPath] = file;
        const segments = String(file.relPath || '').split('/');
        if (segments.length <= 1) continue;
        let current = '';
        for (let i = 0; i < segments.length - 1; i += 1) {
          const segment = segments[i];
          const next = current ? `${current}/${segment}` : segment;
          if (!dirs[next]) dirs[next] = { name: segment, path: next, children: [] };
          current = next;
        }
      }
      Object.values(dirs).forEach((dir) => { dir.children = []; });
      for (const file of files) {
        const parent = String(file.relPath || '').includes('/')
          ? String(file.relPath).slice(0, String(file.relPath).lastIndexOf('/'))
          : '';
        (dirs[parent] || dirs['']).children.push(file);
      }
      return { tree: dirs, byPath };
    }

    function updateBackButtonState() {
      if (!domRefs.modalBackBtn) return;
      domRefs.modalBackBtn.disabled = state.modal.history.length === 0;
    }

    function getReviewQueueItemIds() {
      const base = Array.isArray(state.filteredAssets) && state.filteredAssets.length > 0
        ? state.filteredAssets
        : (Array.isArray(state.allAssets) ? state.allAssets : []);
      return base
        .filter((asset) => String(asset?.supportedAvatarAnalysis?.status || '') === 'review')
        .map((asset) => String(asset?.itemId || '').trim())
        .filter(Boolean);
    }

    function syncReviewQueueStateForAsset(asset) {
      const itemId = String(asset?.itemId || '').trim();
      const queueItemIds = getReviewQueueItemIds();
      const index = queueItemIds.indexOf(itemId);
      state.modal.reviewQueueItemIds = index >= 0 ? queueItemIds : [];
      state.modal.reviewQueueIndex = index;
    }

    function renderReviewQueueControls() {
      if (!domRefs.modalReviewControls) return;
      const itemIds = Array.isArray(state.modal.reviewQueueItemIds) ? state.modal.reviewQueueItemIds : [];
      const index = Number(state.modal.reviewQueueIndex || -1);
      const active = index >= 0 && itemIds.length > 0;
      domRefs.modalReviewControls.classList.toggle('hidden', !active);
      if (!active) {
        if (domRefs.modalReviewLabel) domRefs.modalReviewLabel.textContent = '-';
        if (domRefs.modalReviewPrevBtn) domRefs.modalReviewPrevBtn.disabled = true;
        if (domRefs.modalReviewNextBtn) domRefs.modalReviewNextBtn.disabled = true;
        return;
      }
      if (domRefs.modalReviewLabel) domRefs.modalReviewLabel.textContent = `${index + 1} / ${itemIds.length}`;
      if (domRefs.modalReviewPrevBtn) domRefs.modalReviewPrevBtn.disabled = index <= 0;
      if (domRefs.modalReviewNextBtn) domRefs.modalReviewNextBtn.disabled = index >= (itemIds.length - 1);
    }

    function resetPreviewInspector() {
      if (domRefs.modalPreviewBox) {
        domRefs.modalPreviewBox.innerHTML = '';
        const previewUrl = state.modal.selectedAsset?.preview?.[0] || '';
        if (previewUrl) {
          const img = document.createElement('img');
          img.src = previewUrl;
          img.className = 'booth-image-contain';
          img.style.objectFit = 'contain';
          img.alt = '';
          domRefs.modalPreviewBox.appendChild(img);
        } else {
          domRefs.modalPreviewBox.innerHTML = '<div class="text-zinc-700 text-[10px]">ファイルを選択</div>';
        }
      }
      if (domRefs.modalPreviewFilename) { domRefs.modalPreviewFilename.textContent = ''; domRefs.modalPreviewFilename.title = ''; }
      if (domRefs.modalPreviewInfo) domRefs.modalPreviewInfo.textContent = '';
      if (domRefs.modalOpenEntryBtn) {
        domRefs.modalOpenEntryBtn.disabled = true;
        domRefs.modalOpenEntryBtn.onclick = null;
      }
      if (domRefs.importStatusBox) {
        domRefs.importStatusBox.classList.add('hidden');
        domRefs.importStatusBox.textContent = '';
      }
      setImportAcknowledgeMode?.(false);
      setImportActionButtonsBusy?.(false);
      setImportCloseDisabled?.(false);
      resetImportProgress?.();
      if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.disabled = true;
      if (domRefs.assetAvatarAnalysis) domRefs.assetAvatarAnalysis.textContent = '衣装解析の結果はここに表示されます。';
      if (domRefs.assetImportHistory) domRefs.assetImportHistory.textContent = 'Unity インポート履歴はここに表示されます。';
      renderReviewQueueControls();
    }

    function updateTreeSelection(path) {
      const nodes = domRefs.modalTree?.querySelectorAll('.tree-item');
      if (!nodes) return;
      nodes.forEach((node) => {
        node.classList.toggle('bg-white/5', node.dataset.path === path);
      });
    }

    async function advanceReviewQueueAfterResolve(resolvedItemId) {
      const prevQueue = Array.isArray(state.modal.reviewQueueItemIds) ? [...state.modal.reviewQueueItemIds] : [];
      const prevIndex = Number(state.modal.reviewQueueIndex || -1);
      if (!prevQueue.length || prevIndex < 0) {
        renderReviewQueueControls();
        return;
      }
      const remaining = prevQueue
        .filter((itemId) => String(itemId || '').trim() !== String(resolvedItemId || '').trim())
        .filter((itemId) => String(state.assetByItemId?.get(String(itemId || ''))?.supportedAvatarAnalysis?.status || '') === 'review');
      if (!remaining.length) {
        state.modal.reviewQueueItemIds = [];
        state.modal.reviewQueueIndex = -1;
        renderReviewQueueControls();
        closePreviewModal();
        showTransientMessage?.('確認待ちのレビューが完了しました。', 'info');
        return;
      }
      const nextIndex = Math.min(prevIndex, remaining.length - 1);
      state.modal.reviewQueueItemIds = remaining;
      state.modal.reviewQueueIndex = nextIndex;
      const nextAsset = state.assetByItemId?.get(String(remaining[nextIndex] || '')) || null;
      if (nextAsset) await openPreviewModal(nextAsset);
    }

    function renderAvatarAnalysisPanel(asset) {
      if (!domRefs.assetAvatarAnalysis) return;
      const analysis = asset?.supportedAvatarAnalysis && typeof asset.supportedAvatarAnalysis === 'object'
        ? asset.supportedAvatarAnalysis
        : null;
      const candidates = Array.isArray(analysis?.candidates)
        ? analysis.candidates.filter((row) => String(row?.name || '').trim())
        : [];
      const status = String(analysis?.status || 'unclassified');
      const primary = String(analysis?.primaryAvatar || '').trim();
      const reasonSummary = Array.isArray(analysis?.reasonSummary) ? analysis.reasonSummary.filter(Boolean) : [];
      const statusLabel = status === 'confirmed'
        ? '自動確定'
        : status === 'review'
          ? '確認待ち'
          : '未判定';
      const toneClass = status === 'confirmed'
        ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-100'
        : status === 'review'
          ? 'border-amber-500/20 bg-amber-500/8 text-amber-100'
          : 'border-white/10 bg-black/20 text-zinc-200';
      const helperTitle = status === 'review'
        ? 'ここで確定'
        : status === 'confirmed'
          ? '自動で確定済み'
          : '候補を確認';
      const helperText = status === 'review'
        ? 'このアイテムはまだ確定していません。下の候補ボタンを押すと対応アバターとして確定します。'
        : status === 'confirmed'
          ? 'このアイテムは高信頼で自動確定されています。違和感がある場合は下のボタンから未判定に戻せます。'
          : '候補が弱いため自動確定していません。候補が見えている場合はここで確定できます。';
      const candidateButtons = candidates.length > 0
        ? candidates.map((row) => `
            <button type="button" class="avatar-analysis-confirm rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-[11px] font-bold text-cyan-100 transition hover:bg-cyan-400/18 hover:border-cyan-300/35" data-avatar-name="${esc(row.name)}">
              ${esc(row.name)} で確定
            </button>
          `).join('')
        : '';
      domRefs.assetAvatarAnalysis.innerHTML = `
        <div class="rounded-xl border ${toneClass} p-4 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-[10px] font-black uppercase tracking-[0.18em] text-white/70">Avatar Analysis</div>
              <div class="mt-1 text-[16px] font-bold text-white">${esc(helperTitle)}</div>
            </div>
            <span class="rounded-full border border-current/20 px-2.5 py-1 text-[10px] font-bold tracking-[0.08em]">${esc(statusLabel)}</span>
          </div>
          <div class="rounded-xl border border-white/8 bg-black/20 px-3 py-3">
            <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">現在の候補</div>
            <div class="mt-1 text-[13px] font-semibold text-zinc-100">${esc(primary || '候補なし')}</div>
            <div class="mt-1 text-[10px] leading-relaxed text-zinc-400">${esc(helperText)}</div>
          </div>
          <div class="rounded-xl border border-white/8 bg-black/20 px-3 py-3">
            <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">判断の手がかり</div>
            <div class="mt-1 text-[10px] leading-relaxed text-zinc-300">${esc(reasonSummary.join(' / ') || 'まだ十分な根拠が見つかっていません。')}</div>
          </div>
          ${candidateButtons ? `
            <div class="space-y-2">
              <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-200">候補ボタンを押すとここで確定します</div>
              <div class="flex flex-wrap gap-2">${candidateButtons}</div>
            </div>
          ` : `
            <div class="rounded-xl border border-dashed border-white/10 px-3 py-3 text-[10px] text-zinc-500">
              まだ確定候補がありません。必要なら未判定のまま保持できます。
            </div>
          `}
          <div class="flex flex-wrap gap-2">
            <button type="button" id="avatar-analysis-reset" class="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-bold text-zinc-200 transition hover:bg-white/[0.08]">未判定に戻す</button>
          </div>
        </div>
      `;
      domRefs.assetAvatarAnalysis.querySelectorAll('.avatar-analysis-confirm').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const avatarName = String(btn.getAttribute('data-avatar-name') || '').trim();
          if (!avatarName || !asset?.itemId || !boothAPI.confirmAvatarCompatibility) return;
          const res = await boothAPI.confirmAvatarCompatibility(asset.itemId, avatarName);
          if (res?.error) {
            showTransientMessage?.(`対応アバターの確定に失敗しました: ${res.error}`, 'error');
            return;
          }
          if (res?.assets && typeof setAssetsFromMap === 'function') {
            setAssetsFromMap(res.assets, { preserveRuntimeDownloaded: true });
          }
          const nextAsset = res?.assets?.[String(asset.itemId)] || asset;
          state.modal.selectedAsset = nextAsset;
          renderAvatarAnalysisPanel(nextAsset);
          renderGrid?.();
          showTransientMessage?.(`${avatarName} で確定しました。`, 'info');
          await advanceReviewQueueAfterResolve(asset.itemId);
        });
      });
      domRefs.assetAvatarAnalysis.querySelector('#avatar-analysis-reset')?.addEventListener('click', async () => {
        if (!asset?.itemId || !boothAPI.confirmAvatarCompatibility) return;
        const res = await boothAPI.confirmAvatarCompatibility(asset.itemId, '', { reset: true });
        if (res?.error) {
          showTransientMessage?.(`未判定への戻しに失敗しました: ${res.error}`, 'error');
          return;
        }
        if (res?.assets && typeof setAssetsFromMap === 'function') {
          setAssetsFromMap(res.assets, { preserveRuntimeDownloaded: true });
        }
        const nextAsset = res?.assets?.[String(asset.itemId)] || asset;
        state.modal.selectedAsset = nextAsset;
        renderAvatarAnalysisPanel(nextAsset);
        renderGrid?.();
        showTransientMessage?.('未判定に戻しました。必要なら候補を見直してください。', 'info');
        await advanceReviewQueueAfterResolve(asset.itemId);
      });
    }

    function renderFolderContents(byPath, folderPath) {
      if (!domRefs.modalFileGrid) return;
      domRefs.modalFileGrid.innerHTML = '';
      const entries = Object.values(byPath).filter((file) => {
        const parent = String(file.relPath || '').includes('/')
          ? String(file.relPath).slice(0, String(file.relPath).lastIndexOf('/'))
          : '';
        return parent === folderPath;
      });
      if (!entries.length) {
        domRefs.modalFileGrid.innerHTML = '<div class="text-[9px] text-gray-600 font-mono-custom">空です</div>';
        return;
      }
      entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return String(a.relPath || '').localeCompare(String(b.relPath || ''));
      });
      entries.forEach((entry) => {
        const tile = document.createElement('div');
        tile.className = 'icon-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70';
        tile.tabIndex = 0;
        tile.setAttribute('role', 'button');
        const entryName = entry.name || String(entry.relPath || '').split('/').pop();
        tile.setAttribute('aria-label', `${entryName} を${entry.kind === 'dir' ? '開く' : '表示'}`);
        const ext = getFileExt(entry.name).slice(1);
        const isImgEntry = entry.kind !== 'dir' && isImageFileName(entry.name);
        const isUnity = entry.kind !== 'dir' && ext === 'unitypackage';

        // サムネイルエリア（固定高さ）
        const thumb = document.createElement('div');
        thumb.className = 'w-full h-32 flex items-center justify-center rounded-md overflow-hidden mb-2 shrink-0';
        thumb.style.background = 'transparent';
        if (entry.kind === 'dir') {
          thumb.innerHTML = `<span class="text-amber-500/80">${String(icons.folder || '').replace(/width="24"/g, 'width="40"').replace(/height="24"/g, 'height="40"')}</span>`;
        } else if (isImgEntry && entry.fullPath) {
          const img = document.createElement('img');
          img.src = `file://${entry.fullPath}`;
          img.className = 'booth-image-contain';
          img.style.objectFit = 'contain';
          img.loading = 'lazy';
          img.onerror = () => { thumb.innerHTML = `<span class="text-gray-600">${getIconForFile(entry.name)}</span>`; };
          thumb.appendChild(img);
        } else if (isUnity) {
          thumb.innerHTML = `<div class="flex flex-col items-center gap-1"><span class="text-blue-400">${String(icons.unity || getIconForFile(entry.name)).replace(/width="24"/g, 'width="32"').replace(/height="24"/g, 'height="32"')}</span><span class="text-[8px] text-blue-300/60 font-mono-custom">.unitypackage</span></div>`;
        } else {
          let colorClass = 'text-gray-500';
          if (ext === 'blend') colorClass = 'text-orange-400';
          thumb.innerHTML = `<div class="flex flex-col items-center gap-1"><span class="${colorClass}">${String(getIconForFile(entry.name)).replace(/width="24"/g, 'width="30"').replace(/height="24"/g, 'height="30"')}</span>${ext ? `<span class="text-[8px] text-zinc-600 font-mono-custom uppercase">.${ext}</span>` : ''}</div>`;
        }

        const label = document.createElement('div');
        label.className = 'text-[10px] text-zinc-300 leading-tight line-clamp-2 w-full text-center px-1';
        label.textContent = entryName;
        label.title = entryName;

        tile.appendChild(thumb);
        tile.appendChild(label);
        tile.onclick = () => {
          document.querySelectorAll('.icon-tile').forEach((node) => node.classList.remove('selected'));
          tile.classList.add('selected');
          state.modal.selectedEntry = entry;
          updateInspector(entry);
          if (entry.kind !== 'dir') return;
          if (state.modal.currentPath !== entry.relPath) state.modal.history.push(state.modal.currentPath);
          state.modal.currentPath = entry.relPath;
          updateBackButtonState();
          if (domRefs.currentFolderLabel) domRefs.currentFolderLabel.textContent = state.modal.currentPath || 'ルート';
          if (state.modal.treeRoot) renderFolderContents(state.modal.treeRoot.byPath, state.modal.currentPath);
          updateTreeSelection(entry.relPath);
        };
        enableKeyboardActivation(tile, () => tile.click());
        domRefs.modalFileGrid.appendChild(tile);
      });
    }

    function onTreeClick(path) {
      if (path !== state.modal.currentPath && state.modal.currentPath !== '') state.modal.history.push(state.modal.currentPath);
      state.modal.currentPath = path;
      updateBackButtonState();
      if (domRefs.currentFolderLabel) domRefs.currentFolderLabel.textContent = path || 'ルート';
      updateTreeSelection(path);
      if (state.modal.treeRoot) renderFolderContents(state.modal.treeRoot.byPath, path);
    }

    function renderTreeView(tree) {
      if (!domRefs.modalTree) return;
      domRefs.modalTree.innerHTML = '';
      const container = document.createElement('div');
      const rootItem = document.createElement('div');
      rootItem.className = 'tree-item bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70';
      rootItem.dataset.path = '';
      rootItem.tabIndex = 0;
      rootItem.setAttribute('role', 'button');
      rootItem.setAttribute('aria-label', 'ルートフォルダへ移動');
      rootItem.innerHTML = `
        <span class="w-4 h-4 flex items-center justify-center opacity-70">
          ${String(icons.folder || '').replace(/width="24"/g, 'width="14"').replace(/height="24"/g, 'height="14"')}
        </span>
        <span class="truncate">(root)</span>
      `;
      rootItem.onclick = () => onTreeClick('');
      enableKeyboardActivation(rootItem, () => onTreeClick(''));
      container.appendChild(rootItem);
      const dirPaths = new Set();
      Object.values(tree).forEach((node) => {
        node.children.forEach((child) => {
          if (child.kind === 'dir') dirPaths.add(child.relPath);
        });
      });
      Array.from(dirPaths).sort((a, b) => a.localeCompare(b)).forEach((path) => {
        const depth = path.split('/').length;
        const name = path.split('/').pop();
        const el = document.createElement('div');
        el.className = 'tree-item focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70';
        el.style.paddingLeft = `${depth * 12 + 8}px`;
        el.dataset.path = path;
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', `${name} フォルダへ移動`);
        el.innerHTML = `
          <span class="w-4 h-4 flex items-center justify-center opacity-70">
            ${String(icons.folder || '').replace(/width="24"/g, 'width="14"').replace(/height="24"/g, 'height="14"')}
          </span>
          <span class="truncate">${esc(name)}</span>
        `;
        el.onclick = () => onTreeClick(path);
        enableKeyboardActivation(el, () => onTreeClick(path));
        container.appendChild(el);
      });
      domRefs.modalTree.appendChild(container);
    }

    function updateInspector(entry) {
      const name = entry.name || String(entry.relPath || '').split('/').pop();
      const isDir = entry.kind === 'dir';
      const isUnityPackage = !isDir && String(entry.name || '').toLowerCase().endsWith('.unitypackage');
      const selectedAsset = state.modal.selectedAsset;
      const ext = getFileExt(entry.name).slice(1);

      // ファイル名・種別（BOOTH プレビューは触らない）
      if (domRefs.modalPreviewFilename) {
        domRefs.modalPreviewFilename.textContent = name;
        domRefs.modalPreviewFilename.title = name;
      }
      if (domRefs.modalPreviewInfo) {
        domRefs.modalPreviewInfo.textContent = isDir ? 'フォルダ' : ext ? `.${ext} ファイル` : 'ファイル';
      }

      // ファイル操作エリア
      const actionsEl = document.getElementById('modal-file-actions');
      if (actionsEl) actionsEl.innerHTML = '';

      if (domRefs.modalOpenEntryBtn) {
        domRefs.modalOpenEntryBtn.disabled = isDir;
        domRefs.modalOpenEntryBtn.onclick = null;
      }

      if (isUnityPackage && actionsEl) {
        const btn = document.createElement('button');
        btn.id = 'btn-open-import-modal';
        btn.className = 'w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium rounded-lg transition';
        btn.textContent = 'Import into Unity';
        btn.addEventListener('click', () => {
          openImportModal(entry.fullPath, {
            singlePackage: {
              itemId: String(selectedAsset?.itemId || ''),
              title: String(selectedAsset?.title || ''),
              packagePath: String(entry.fullPath || ''),
              previewUrl: String(selectedAsset?.preview?.[0] || ''),
              meta: { topFolders: [], tokens: [] },
            },
          }).catch((error) => logger?.error?.(error));
        });
        actionsEl.appendChild(btn);
      }

      const isMeshCandidate = !isDir && (isUnityPackage || ext === 'fbx' || ext === 'obj');
      if (isMeshCandidate && actionsEl && openModelPreview && state.settings?.experimentalModelPreview) {
        const btn = document.createElement('button');
        btn.id = 'btn-open-model-preview';
        btn.className = 'w-full mt-2 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-zinc-100 text-[11px] font-medium rounded-lg transition flex items-center justify-center gap-1.5';
        btn.innerHTML = '<span>3Dプレビュー</span><span class="rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">beta</span>';
        btn.addEventListener('click', () => {
          openModelPreview(selectedAsset, entry).catch((error) => logger?.error?.(error));
        });
        actionsEl.appendChild(btn);
      }

      if (domRefs.modalOpenEntryBtn && boothAPI.openExtractedEntry && selectedAsset && !isDir) {
        domRefs.modalOpenEntryBtn.onclick = async () => {
          const res = await boothAPI.openExtractedEntry(selectedAsset.itemId, selectedAsset.title || '', entry.relPath);
          if (res?.error) logger?.error?.('openExtractedEntry failed:', res.error, entry.relPath);
        };
      }
    }

    async function openPreviewModal(asset) {
      if (!domRefs.previewOverlay) return;
      setAvatarFilterPanelOpen?.(false);
      closeImportModal?.();
      closePackageSelectionModal?.();
      if (asset?.hasUpdate) {
        await markAssetUpdateSeen?.(asset);
        renderGrid?.();
      }
      state.modal.selectedAsset = asset;
      state.modal.currentPath = '';
      state.modal.selectedEntry = null;
      state.modal.treeRoot = null;
      state.modal.history = [];
      syncReviewQueueStateForAsset(asset);
      updateBackButtonState();
      renderReviewQueueControls();
      if (domRefs.modalTitle) domRefs.modalTitle.textContent = asset.title || 'アセットプレビュー';
      if (domRefs.modalPath) domRefs.modalPath.textContent = `__extracted / ${asset.itemId}_${(asset.title || 'NO_NAME').replace(/[\\/:*?"<>|]/g, '_')}`;
      if (domRefs.currentFolderLabel) domRefs.currentFolderLabel.textContent = 'ルート';
      resetPreviewInspector();
      renderAssetMetaSection(asset);
      renderAvatarAnalysisPanel(asset);
      const currentItemId = String(asset?.itemId || '');
      if (boothAPI.getImportHistory && currentItemId) {
        boothAPI.getImportHistory(currentItemId)
          .then((historyResult) => {
            if (String(state.modal.selectedAsset?.itemId || '') === currentItemId) {
              renderImportHistoryInModal?.(historyResult?.history || []);
            }
          })
          .catch((error) => logger?.warn?.('import history load failed', error));
      }
      if (domRefs.modalFileGrid) domRefs.modalFileGrid.innerHTML = '';
      if (domRefs.modalTree) domRefs.modalTree.innerHTML = '';

      const isWishlistOnly = Boolean(asset.isWishlisted) && !asset.downloaded;
      setWishlistOnlyLayout(isWishlistOnly);
      if (isWishlistOnly) {
        domRefs.previewOverlay.classList.remove('hidden');
        domRefs.previewOverlay.classList.add('flex');
        return;
      }

      const res = await boothAPI.listItemFiles(asset.itemId, asset.title || '');
      if (res?.error) {
        if (domRefs.modalFileGrid) {
          const errorMsg = res.error === '__extracted_not_found'
            ? '展開フォルダがありません。先にダウンロードと展開を完了してください。'
            : String(res.error || '不明なエラー');
          domRefs.modalFileGrid.innerHTML = `<div class="text-[9px] text-red-500 font-mono-custom">${esc(errorMsg)}</div>`;
        }
        return;
      }
      const files = res.files || [];
      if (shouldAutoOpenFolderForImageOnly(files)) {
        await boothAPI.openItemFolder(asset.itemId, asset.title || '');
        showTransientMessage?.('画像ファイルのみのためフォルダを開きました。', 'info');
        return;
      }
      const { tree, byPath } = buildFolderTree(files);
      state.modal.treeRoot = { tree, byPath };
      renderTreeView(tree);
      renderFolderContents(byPath, '');
      if (domRefs.modalOpenFolderBtn) {
        domRefs.modalOpenFolderBtn.onclick = async () => {
          await boothAPI.openItemFolder(asset.itemId, asset.title || '');
        };
      }
      domRefs.previewOverlay.classList.remove('hidden');
      domRefs.previewOverlay.classList.add('flex');
    }

    function setWishlistOnlyLayout(on) {
      const treePanel = document.getElementById('modal-tree-panel');
      const filePanel = document.getElementById('modal-file-panel');
      const inspector = document.getElementById('modal-inspector-panel');
      const folderBtn = document.getElementById('modal-open-folder');
      const entryBtn = document.getElementById('modal-open-entry');
      const backBtn = document.getElementById('modal-back');
      const pathEl = document.getElementById('modal-path');
      const pathSep = document.getElementById('modal-path-sep');
      const previewBox = document.getElementById('modal-preview-box');
      const fileMeta = document.getElementById('modal-inspector-filemeta');
      const fileActions = document.getElementById('modal-file-actions');
      const metaArea = document.getElementById('modal-inspector-meta');
      const avatarAnalysis = domRefs.assetAvatarAnalysis;
      const importHistory = domRefs.assetImportHistory;
      if (!inspector) return;
      if (on) {
        if (treePanel) treePanel.style.display = 'none';
        if (filePanel) filePanel.style.display = 'none';
        if (folderBtn) folderBtn.style.display = 'none';
        if (entryBtn) entryBtn.style.display = 'none';
        if (backBtn) backBtn.style.display = 'none';
        if (pathEl) pathEl.style.display = 'none';
        if (pathSep) pathSep.style.display = 'none';
        if (fileMeta) fileMeta.style.display = 'none';
        if (fileActions) fileActions.style.display = 'none';
        if (avatarAnalysis) avatarAnalysis.style.display = 'none';
        if (importHistory) importHistory.style.display = 'none';
        inspector.classList.remove('w-64');
        inspector.classList.add('flex-1', 'border-l-0', 'wishlist-preview-mode');
        inspector.style.flexDirection = 'row';
        if (previewBox) {
          previewBox.style.width = '380px';
          previewBox.style.height = '380px';
          previewBox.style.aspectRatio = '1 / 1';
          previewBox.style.flexShrink = '0';
          previewBox.style.borderBottom = 'none';
          previewBox.style.borderRight = '1px solid rgba(148,163,184,0.08)';
          previewBox.style.padding = '18px';
        }
        if (metaArea) {
          metaArea.style.flex = '1';
          metaArea.style.overflowY = 'auto';
        }
      } else {
        if (treePanel) treePanel.style.display = '';
        if (filePanel) filePanel.style.display = '';
        if (folderBtn) folderBtn.style.display = '';
        if (entryBtn) entryBtn.style.display = '';
        if (backBtn) backBtn.style.display = '';
        if (pathEl) pathEl.style.display = '';
        if (pathSep) pathSep.style.display = '';
        if (fileMeta) fileMeta.style.display = '';
        if (fileActions) fileActions.style.display = '';
        if (avatarAnalysis) avatarAnalysis.style.display = '';
        if (importHistory) importHistory.style.display = '';
        inspector.classList.add('w-64');
        inspector.classList.remove('flex-1', 'border-l-0', 'wishlist-preview-mode');
        inspector.style.flexDirection = '';
        if (previewBox) {
          previewBox.style.width = '';
          previewBox.style.height = '';
          previewBox.style.aspectRatio = '';
          previewBox.style.flexShrink = '';
          previewBox.style.borderBottom = '';
          previewBox.style.borderRight = '';
          previewBox.style.padding = '';
        }
        if (metaArea) {
          metaArea.style.flex = '';
          metaArea.style.overflowY = '';
        }
      }
    }

    function closePreviewModal() {
      closeModelPreview?.();
      setWishlistOnlyLayout(false);
      domRefs.previewOverlay?.classList.add('hidden');
      domRefs.previewOverlay?.classList.remove('flex');
      state.modal.reviewQueueItemIds = [];
      state.modal.reviewQueueIndex = -1;
      renderReviewQueueControls();
    }

    let _noteDebounceTimer = null;

    function renderTagChip(tag, tags, asset) {
      const chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/20';
      chip.textContent = tag;
      const del = document.createElement('button');
      del.className = 'ml-0.5 text-indigo-400 hover:text-red-400 transition-colors leading-none';
      del.textContent = '×';
      del.title = 'タグを削除';
      del.addEventListener('click', async () => {
        const next = tags.filter((t) => t !== tag);
        await saveUserTags(asset, next);
      });
      chip.appendChild(del);
      return chip;
    }

    function renderTagsList(tags, asset) {
      if (!domRefs.modalUserTagsList) return;
      domRefs.modalUserTagsList.innerHTML = '';
      for (const tag of (tags || [])) {
        domRefs.modalUserTagsList.appendChild(renderTagChip(tag, tags, asset));
      }
    }

    async function saveUserTags(asset, tags) {
      if (!updateUserMeta || !asset?.itemId) return;
      const res = await updateUserMeta(asset.itemId, { userTags: tags });
      if (res?.ok && state.modal.selectedAsset?.itemId === asset.itemId) {
        state.modal.selectedAsset = { ...state.modal.selectedAsset, userTags: tags };
        renderTagsList(tags, state.modal.selectedAsset);
      }
    }

    function formatWishlistDate(value) {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '-';
      return date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }

    function formatYen(value) {
      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? `¥${Math.round(value).toLocaleString('ja-JP')}`
        : '';
    }

    function formatWishlistPrice(asset) {
      const min = Number(asset?.priceMin ?? asset?.price);
      const max = Number(asset?.priceMax ?? asset?.price);
      if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > min) {
        return `${formatYen(min)}〜${formatYen(max)}`;
      }
      const price = Number(asset?.price);
      return Number.isFinite(price) && price > 0
        ? formatYen(price)
        : '価格未取得';
    }

    function getWishlistPriceLabel(asset) {
      const min = Number(asset?.priceMin ?? asset?.price);
      const max = Number(asset?.priceMax ?? asset?.price);
      return Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > min
        ? 'Price Range'
        : 'Price';
    }

    function renderWishlistPriceBreakdown(asset) {
      const rows = Array.isArray(asset?.priceVariations)
        ? asset.priceVariations
          .filter((row) => String(row?.name || '').trim() && Number.isFinite(Number(row?.price)) && Number(row.price) > 0)
          .slice(0, 30)
        : [];
      if (rows.length <= 1) return '';
      return `
        <div class="wishlist-price-breakdown">
          ${rows.map((row) => `
            <div class="wishlist-price-row">
              <div class="wishlist-price-name" title="${esc(row.name)}">${esc(row.name)}</div>
              <div class="wishlist-price-value">${esc(formatYen(Number(row.price)))}</div>
              <button class="wishlist-variation-cart-btn" data-cart-btn="1" data-variation-name="${esc(row.name)}" style="flex-shrink:0;font-size:10px;font-weight:700;font-family:inherit;padding:2px 7px;border-radius:5px;border:1px solid rgba(99,102,241,0.5);background:rgba(99,102,241,0.12);color:#a5b4fc;cursor:pointer;white-space:nowrap">カートへ</button>
              <button class="wishlist-variation-cart-btn" data-buy-btn="1" data-variation-name="${esc(row.name)}" style="flex-shrink:0;font-size:10px;font-weight:700;font-family:inherit;padding:2px 7px;border-radius:5px;border:1px solid rgba(52,211,153,0.4);background:rgba(52,211,153,0.08);color:#6ee7b7;cursor:pointer;white-space:nowrap">購入する</button>
            </div>
          `).join('')}
        </div>
      `;
    }

    function renderWishlistSummary(asset, enabled) {
      const summary = document.getElementById('modal-wishlist-summary');
      if (!summary) return;
      summary.classList.toggle('hidden', !enabled);
      if (!enabled || !asset) {
        summary.innerHTML = '';
        return;
      }
      const itemId = String(asset.itemId || '-');
      summary.innerHTML = `
        <div class="wishlist-summary-top">
          <span class="wishlist-pill">ほしいリスト</span>
          <span class="text-[10px] text-zinc-500 truncate">未購入アイテム</span>
        </div>
        <div class="wishlist-summary-grid">
          <div class="wishlist-summary-cell">
            <div class="wishlist-summary-label">Item ID</div>
            <div class="wishlist-summary-value" title="${esc(itemId)}">${esc(itemId)}</div>
          </div>
          <div class="wishlist-summary-cell">
            <div class="wishlist-summary-label">${esc(getWishlistPriceLabel(asset))}</div>
            <div class="wishlist-summary-value">${esc(formatWishlistPrice(asset))}</div>
          </div>
          <div class="wishlist-summary-cell">
            <div class="wishlist-summary-label">Added</div>
            <div class="wishlist-summary-value">${esc(formatWishlistDate(asset.wishlistAddedAt))}</div>
          </div>
        </div>
        ${renderWishlistPriceBreakdown(asset)}
      `;
    }

    function applyWishlistMetaPresentation(asset, enabled) {
      renderWishlistSummary(asset, enabled);
      domRefs.modalAssetTitleText?.classList.toggle('wishlist-title-text', enabled);
      domRefs.modalAssetAuthorText?.classList.toggle('wishlist-author-text', enabled);
      domRefs.modalCopyTitle?.classList.toggle('hidden', enabled);
      domRefs.modalCopyAuthor?.classList.toggle('hidden', enabled);
      domRefs.modalWishlistCartBtn?.classList.toggle('hidden', !enabled);
      domRefs.modalWishlistRemoveBtn?.classList.toggle('wishlist-remove-danger', enabled);
      if (domRefs.modalUserNote) {
        domRefs.modalUserNote.rows = enabled ? 6 : 3;
        domRefs.modalUserNote.placeholder = enabled ? '購入前に確認したいこと、対応アバター、セール待ちなどをメモ...' : 'メモ...';
      }
    }

    function renderAssetMetaSection(asset) {
      if (domRefs.assetUserMeta) domRefs.assetUserMeta.style.display = asset ? '' : 'none';
      if (!asset) {
        applyWishlistMetaPresentation(null, false);
        return;
      }
      const showRemove = Boolean(asset.isWishlisted) && !asset.downloaded;
      applyWishlistMetaPresentation(asset, showRemove);
      if (domRefs.modalAssetTitleText) domRefs.modalAssetTitleText.textContent = asset.title || '';
      if (domRefs.modalAssetAuthorText) domRefs.modalAssetAuthorText.textContent = asset.author || '';
      renderTagsList(asset.userTags || [], asset);
      if (domRefs.modalUserTagInput) domRefs.modalUserTagInput.value = '';
      if (domRefs.modalUserNote) domRefs.modalUserNote.value = asset.userNote || '';
      if (domRefs.modalUserNoteStatus) domRefs.modalUserNoteStatus.textContent = '';
      if (domRefs.modalWishlistRemoveBtn) {
        domRefs.modalWishlistRemoveBtn.classList.toggle('hidden', !showRemove);
        domRefs.modalWishlistRemoveBtn.disabled = false;
        domRefs.modalWishlistRemoveBtn.textContent = 'ほしいリストから外す';
      }
      if (domRefs.modalWishlistCartWrap) {
        // Hide single cart/buy buttons when per-variation buttons are shown in breakdown
        const hasMultiVariation = showRemove && Array.isArray(asset?.priceVariations) &&
          asset.priceVariations.filter((r) => String(r?.name || '').trim() && Number(r?.price) > 0).length > 1;
        domRefs.modalWishlistCartWrap.classList.toggle('hidden', !showRemove || hasMultiVariation);
        if (domRefs.modalWishlistCartBtn) { domRefs.modalWishlistCartBtn.disabled = false; domRefs.modalWishlistCartBtn.textContent = 'カートへ'; }
        if (domRefs.modalWishlistBuyBtn) { domRefs.modalWishlistBuyBtn.disabled = false; domRefs.modalWishlistBuyBtn.textContent = '購入する'; }
      }
    }

    function mapCartError(raw) {
      const msg = String(raw || '');
      if (msg.includes('invalid_item_id_or_url')) return 'BOOTH item ID を確認できませんでした。';
      if (msg.includes('item_page_fetch_failed')) return 'BOOTHの商品ページを取得できませんでした。';
      if (msg.includes('cart_authenticity_token_not_found')) return 'カート追加用の認証トークンを取得できませんでした。';
      if (msg.includes('cart_variation_ambiguous')) return '複数のバリエーションがあります。誤追加防止のためBOOTH上で選択してください。';
      if (msg.includes('cart_variation_not_found')) return '購入バリエーションを取得できませんでした。';
      if (msg.includes('cart_action_not_found')) return 'カート追加フォームを取得できませんでした。';
      if (msg.includes('cart_add_failed')) return 'BOOTHカートへの追加に失敗しました。';
      return msg || 'BOOTHカートへの追加に失敗しました。';
    }

    function bindUserMetaEvents() {
      domRefs.modalCopyTitle?.addEventListener('click', () => {
        const text = state.modal.selectedAsset?.title || '';
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          if (domRefs.modalCopyTitle) {
            domRefs.modalCopyTitle.textContent = '✓';
            setTimeout(() => { if (domRefs.modalCopyTitle) domRefs.modalCopyTitle.textContent = 'コピー'; }, 1200);
          }
        }).catch(() => {});
      });

      domRefs.modalCopyAuthor?.addEventListener('click', () => {
        const text = state.modal.selectedAsset?.author || '';
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          if (domRefs.modalCopyAuthor) {
            domRefs.modalCopyAuthor.textContent = '✓';
            setTimeout(() => { if (domRefs.modalCopyAuthor) domRefs.modalCopyAuthor.textContent = 'コピー'; }, 1200);
          }
        }).catch(() => {});
      });

      const addTag = async () => {
        const input = domRefs.modalUserTagInput;
        if (!input) return;
        const tag = String(input.value || '').trim();
        if (!tag || !state.modal.selectedAsset) return;
        const existing = state.modal.selectedAsset.userTags || [];
        if (existing.includes(tag)) { input.value = ''; return; }
        const next = [...existing, tag];
        input.value = '';
        await saveUserTags(state.modal.selectedAsset, next);
      };

      domRefs.modalUserTagAdd?.addEventListener('click', addTag);
      domRefs.modalUserTagInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addTag(); }
      });

      domRefs.modalUserNote?.addEventListener('input', () => {
        if (_noteDebounceTimer) clearTimeout(_noteDebounceTimer);
        if (domRefs.modalUserNoteStatus) domRefs.modalUserNoteStatus.textContent = '…';
        _noteDebounceTimer = setTimeout(async () => {
          const asset = state.modal.selectedAsset;
          if (!asset?.itemId || !updateUserMeta) return;
          const note = String(domRefs.modalUserNote?.value || '');
          const res = await updateUserMeta(asset.itemId, { userNote: note });
          if (domRefs.modalUserNoteStatus) {
            domRefs.modalUserNoteStatus.textContent = res?.ok ? '保存済み' : '保存失敗';
            setTimeout(() => { if (domRefs.modalUserNoteStatus) domRefs.modalUserNoteStatus.textContent = ''; }, 1500);
          }
          if (res?.ok && state.modal.selectedAsset?.itemId === asset.itemId) {
            state.modal.selectedAsset = { ...state.modal.selectedAsset, userNote: note };
          }
        }, 800);
      });

      const handleSingleCartClick = async (openCheckout) => {
        const asset = state.modal.selectedAsset;
        if (!asset?.itemId || !boothAPI?.addWishlistItemToCart) return;
        const cartBtn = domRefs.modalWishlistCartBtn;
        const buyBtn = domRefs.modalWishlistBuyBtn;
        const activeBtn = openCheckout ? buyBtn : cartBtn;
        if (cartBtn) { cartBtn.disabled = true; cartBtn.textContent = '追加中...'; }
        if (buyBtn) { buyBtn.disabled = true; buyBtn.textContent = '追加中...'; }
        try {
          const res = await boothAPI.addWishlistItemToCart(String(asset.itemId));
          if (res?.ok) {
            if (cartBtn) { cartBtn.textContent = '✓ 追加済み'; }
            if (buyBtn) { buyBtn.disabled = false; buyBtn.textContent = '購入する'; }
            showTransientMessage?.('BOOTHカートに追加しました。', 'info');
            if (openCheckout && res.checkoutUrl) boothAPI.openExternalUrl(res.checkoutUrl);
          } else if (String(res?.error || '').includes('cart_variation_ambiguous')) {
            boothAPI.openExternalUrl(`https://booth.pm/ja/items/${asset.itemId}`);
            showTransientMessage?.('バリエーションを選択してください（BOOTHで開きました）。', 'info');
            if (cartBtn) { cartBtn.disabled = false; cartBtn.textContent = 'カートへ'; }
            if (buyBtn) { buyBtn.disabled = false; buyBtn.textContent = '購入する'; }
          } else {
            throw new Error(mapCartError(res?.error));
          }
        } catch (error) {
          if (cartBtn) { cartBtn.disabled = false; cartBtn.textContent = 'カートへ'; }
          if (buyBtn) { buyBtn.disabled = false; buyBtn.textContent = '購入する'; }
          showTransientMessage?.(String(error?.message || error), 'error');
        }
      };
      domRefs.modalWishlistCartBtn?.addEventListener('click', () => handleSingleCartClick(false));
      domRefs.modalWishlistBuyBtn?.addEventListener('click', () => handleSingleCartClick(true));

      // Per-variation cart/buy buttons (event delegation on summary container)
      document.getElementById('modal-wishlist-summary')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-cart-btn="1"],[data-buy-btn="1"]');
        if (!btn || btn.dataset.loading) return;
        const openCheckout = !!btn.dataset.buyBtn;
        const origLabel = openCheckout ? '購入する' : 'カートへ';
        const asset = state.modal.selectedAsset;
        if (!asset?.itemId || !boothAPI?.addWishlistItemToCart) return;
        const variationName = btn.dataset.variationName || undefined;
        btn.dataset.loading = '1';
        btn.disabled = true;
        btn.textContent = '追加中…';
        try {
          const res = await boothAPI.addWishlistItemToCart(String(asset.itemId), variationName);
          if (res?.ok) {
            btn.textContent = '✓ 完了';
            btn.style.color = '#86efac';
            btn.style.borderColor = 'rgba(134,239,172,0.5)';
            btn.style.background = 'rgba(134,239,172,0.08)';
            if (openCheckout && res.checkoutUrl) boothAPI.openExternalUrl(res.checkoutUrl);
          } else if (String(res?.error || '').includes('cart_variation_ambiguous')) {
            boothAPI.openExternalUrl(`https://booth.pm/ja/items/${asset.itemId}`);
            showTransientMessage?.('バリエーションを選択してください（BOOTHで開きました）。', 'info');
            delete btn.dataset.loading;
            btn.disabled = false;
            btn.textContent = origLabel;
          } else {
            throw new Error(mapCartError(res?.error));
          }
        } catch (error) {
          delete btn.dataset.loading;
          btn.disabled = false;
          btn.textContent = origLabel;
          btn.style.color = '';
          btn.style.borderColor = '';
          btn.style.background = '';
          showTransientMessage?.(String(error?.message || error), 'error');
        }
      });

      domRefs.modalWishlistRemoveBtn?.addEventListener('click', async () => {
        const asset = state.modal.selectedAsset;
        if (!asset?.itemId || !boothAPI?.toggleWishlist) return;
        const btn = domRefs.modalWishlistRemoveBtn;
        btn.disabled = true;
        btn.textContent = '処理中…';
        const res = await boothAPI.toggleWishlist(String(asset.itemId));
        if (res?.ok) {
          closePreviewModal?.();
          await reloadAssetsMap?.();
        } else {
          btn.disabled = false;
          btn.textContent = 'ほしいリストから外す';
          showTransientMessage?.('操作に失敗しました。', 'error');
        }
      });
    }

    function goBack() {
      if (!state.modal.history.length) return;
      state.modal.currentPath = state.modal.history.pop();
      updateBackButtonState();
      if (state.modal.treeRoot) renderFolderContents(state.modal.treeRoot.byPath, state.modal.currentPath);
      if (domRefs.currentFolderLabel) domRefs.currentFolderLabel.textContent = state.modal.currentPath || 'ルート';
      updateTreeSelection(state.modal.currentPath);
    }

    function bindUiEvents() {
      domRefs.modalCloseBtn?.addEventListener('click', () => {
        closePreviewModal();
      });
      domRefs.modalBackBtn?.addEventListener('click', () => {
        goBack();
      });
      bindUserMetaEvents();
    }

    domRefs.modalReviewPrevBtn?.addEventListener('click', async () => {
      const current = Number(state.modal.reviewQueueIndex || -1);
      if (current <= 0) return;
      const nextAsset = state.assetByItemId?.get(String(state.modal.reviewQueueItemIds[current - 1] || '')) || null;
      if (nextAsset) await openPreviewModal(nextAsset);
    });

    domRefs.modalReviewNextBtn?.addEventListener('click', async () => {
      const current = Number(state.modal.reviewQueueIndex || -1);
      const itemIds = Array.isArray(state.modal.reviewQueueItemIds) ? state.modal.reviewQueueItemIds : [];
      if (current < 0 || current >= (itemIds.length - 1)) return;
      const nextAsset = state.assetByItemId?.get(String(itemIds[current + 1] || '')) || null;
      if (nextAsset) await openPreviewModal(nextAsset);
    });

    return {
      bindUiEvents,
      openPreviewModal,
      closePreviewModal,
      goBack,
    };
  }

  global.AvatoolRenderPreviewModal = {
    createRenderPreviewModal,
  };
})(window);
