(function attachRenderAssetList(global) {
  function createRenderAssetList(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const esc = deps?.esc || ((value) => String(value || ''));
    const formatDate = deps?.formatDate || ((value) => String(value || ''));
    const matchesSearch = deps?.matchesSearch;
    const matchesAvatarFilter = deps?.matchesAvatarFilter;
    const getRenderModeSetting = deps?.getRenderModeSetting || (() => 'instant');
    const giftCategoryKey = String(deps?.giftCategoryKey || '');
    const freeDownloadCategoryKey = String(deps?.freeDownloadCategoryKey || '');
    const renderProgressiveChunkSize = Math.max(1, Number(deps?.renderProgressiveChunkSize || 60));
    const enableKeyboardActivation = deps?.enableKeyboardActivation;
    const toggleSelection = deps?.toggleSelection;
    const openPreviewModalAction = deps?.openPreviewModalAction;
    const getAssetByItemId = deps?.getAssetByItemId;
    const shouldTreatAsDownloaded = deps?.shouldTreatAsDownloaded;
    const getAssetAvatarAnalysisSummary = deps?.getAssetAvatarAnalysisSummary || (() => null);
    const openImportForAssetAction = deps?.openImportForAssetAction;
    const handleDownloadAction = deps?.handleDownloadAction;
    const openItemFolderAction = deps?.openItemFolderAction;
    const persistViewModePreference = deps?.persistViewModePreference;
    const clearSelectionMode = deps?.clearSelectionMode;
    const updateBatchUI = deps?.updateBatchUI;
    const applyCategoryFilter = deps?.applyCategoryFilter;
    const setAvatarFilterPanelOpen = deps?.setAvatarFilterPanelOpen;
    const syncAvatarFilterUI = deps?.syncAvatarFilterUI;
    const normalizeAvatarFilterValue = deps?.normalizeAvatarFilterValue;
    const hasAvatarDetailedAnalysisResult = deps?.hasAvatarDetailedAnalysisResult;
    const showAvatarFilterAnalysisPromptModal = deps?.showAvatarFilterAnalysisPromptModal;
    const applyViewFilter = deps?.applyViewFilter;
    const openManualAddModalAction = deps?.openManualAddModalAction;
    const syncLibraryAction = deps?.syncLibraryAction;
    const openBoothLoginAction = deps?.openBoothLoginAction;
    let avatarAnalyzePromptBusy = false;
    let searchDebounceTimer = null;

    const vs = {
      enabled: false,
      mode: null,
      tileHeight: 300,
      gapSize: 20,
      bufferRows: 3,
      firstIndex: 0,
      lastIndex: 0,
      colCount: 2,
      scrollContainer: null,
      listBody: null,
      listBodyOffset: -1,
      _scrollListener: null,
      _resizeObserver: null,
      _raf: null,
    };

    // フィルター結果のメモ化キャッシュ
    let filteredCache = null;
    let filteredCacheKey = null;

    function buildFilterCacheKey() {
      return JSON.stringify([
        state.currentCategory,
        state.viewFilter,
        state.avatarFilter,
        Array.isArray(state.avatarFilters) ? state.avatarFilters.join(',') : '',
        state.searchQuery,
        state.sortMode,
        Number(state.assetsRevision || 0),
        state.allAssets.length,
        state.allAssets[0]?.itemId,
        state.allAssets[state.allAssets.length - 1]?.itemId,
      ]);
    }

    function invalidateFilterCache() {
      filteredCache = null;
      filteredCacheKey = null;
    }

    function formatWishlistCardPrice(asset) {
      const min = Number(asset?.priceMin ?? asset?.price);
      const max = Number(asset?.priceMax ?? asset?.price);
      if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > min) {
        return `¥${Math.round(min).toLocaleString('ja-JP')}〜`;
      }
      const price = Number(asset?.price);
      return Number.isFinite(price) && price > 0
        ? `¥${Math.round(price).toLocaleString('ja-JP')}`
        : '';
    }

    function createWishlistPriceChip(asset, compact = false) {
      const text = formatWishlistCardPrice(asset);
      if (!text) return null;
      const chip = document.createElement('span');
      chip.className = compact
        ? 'text-[9px] px-1.5 py-0.5 rounded border border-pink-400/20 bg-pink-400/10 text-pink-200 font-mono-custom whitespace-nowrap'
        : 'text-[10px] px-2 py-1 rounded-md border border-pink-400/20 bg-pink-400/10 text-pink-100 font-mono-custom self-start';
      chip.textContent = text;
      chip.title = `価格: ${text}`;
      return chip;
    }

    if (
      !state ||
      typeof matchesSearch !== 'function' ||
      typeof matchesAvatarFilter !== 'function' ||
      typeof enableKeyboardActivation !== 'function' ||
      typeof toggleSelection !== 'function' ||
      typeof openPreviewModalAction !== 'function' ||
      typeof getAssetByItemId !== 'function' ||
      typeof shouldTreatAsDownloaded !== 'function' ||
      typeof openImportForAssetAction !== 'function' ||
      typeof handleDownloadAction !== 'function' ||
      typeof openItemFolderAction !== 'function' ||
      typeof persistViewModePreference !== 'function' ||
      typeof clearSelectionMode !== 'function' ||
      typeof updateBatchUI !== 'function' ||
      typeof applyCategoryFilter !== 'function' ||
      typeof setAvatarFilterPanelOpen !== 'function' ||
      typeof syncAvatarFilterUI !== 'function' ||
      typeof normalizeAvatarFilterValue !== 'function' ||
      typeof hasAvatarDetailedAnalysisResult !== 'function' ||
      typeof showAvatarFilterAnalysisPromptModal !== 'function' ||
      typeof applyViewFilter !== 'function'
    ) {
      throw new Error('createRenderAssetList requires state, filter helpers, and asset actions.');
    }

    function toItemIdKey(itemId) {
      return String(itemId || '');
    }

    function decodeCategorySlugLabel(raw) {
      const value = String(raw || '').trim();
      if (!value) return '';
      const noPrefix = value.replace(/^https?:\/\/booth\.pm\/[a-z]{2}\/browse\//i, '');
      try {
        return decodeURIComponent(noPrefix).trim();
      } catch {
        return noPrefix.trim();
      }
    }

    function getCategoryDisplayText(category, fallback = 'その他') {
      if (!category || typeof category !== 'object') return fallback;
      const text = String(category.text || '').trim();
      if (text) return text;
      const slugText = decodeCategorySlugLabel(category.slug);
      if (slugText) return slugText;
      const hrefText = decodeCategorySlugLabel(category.href);
      if (hrefText) return hrefText;
      return fallback;
    }

    const parseDateCache = new Map();
    const PARSE_DATE_CACHE_MAX = 2000;
    function parseSortableDateMs(raw) {
      if (raw == null) return null;
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      const cacheKey = String(raw);
      if (parseDateCache.has(cacheKey)) return parseDateCache.get(cacheKey);
      if (parseDateCache.size >= PARSE_DATE_CACHE_MAX) parseDateCache.clear();
      if (raw instanceof Date) {
        const ms = raw.getTime();
        return Number.isNaN(ms) ? null : ms;
      }
      const text = String(raw || '').trim();
      if (!text || text === 'Unknown') { parseDateCache.set(cacheKey, null); return null; }

      const match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
      if (match) {
        const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
        const ms = new Date(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
          Number(second),
        ).getTime();
        const result = Number.isNaN(ms) ? null : ms;
        parseDateCache.set(cacheKey, result);
        return result;
      }

      const ms = new Date(text).getTime();
      const result = Number.isNaN(ms) ? null : ms;
      parseDateCache.set(cacheKey, result);
      return result;
    }

    function compareAssetsByAddedDateDesc(a, b) {
      const dateA = parseSortableDateMs(a?.orderDate);
      const dateB = parseSortableDateMs(b?.orderDate);
      if (dateA !== null && dateB !== null) return dateB - dateA;
      if (dateA !== null) return -1;
      if (dateB !== null) return 1;
      return 0;
    }

    function getListGridTemplateColumns() {
      return state.selectionMode
        ? '28px 44px minmax(200px,2fr) minmax(120px,1fr) minmax(100px,1fr) 110px 70px 160px'
        : '44px minmax(200px,2fr) minmax(120px,1fr) minmax(100px,1fr) 110px 70px 160px';
    }

    function updateSelectionCheckboxVisual(checkbox, itemId) {
      if (!checkbox) return;
      const selected = state.selectedItems.has(String(itemId));
      checkbox.setAttribute('aria-checked', selected ? 'true' : 'false');
      checkbox.querySelector('.check-mark')?.classList.toggle('hidden', !selected);
      checkbox.classList.toggle('border-blue-500', selected);
      checkbox.classList.toggle('bg-blue-900/30', selected);
    }

    function createSelectionCheckbox(asset, hiddenWhenDisabled) {
      const checkbox = document.createElement('div');
      checkbox.className = [
        'w-4 h-4 rounded border border-gray-500 bg-black/50 cursor-pointer selection-checkbox',
        hiddenWhenDisabled && !state.selectionMode ? 'hidden' : '',
      ].filter(Boolean).join(' ');
      checkbox.tabIndex = 0;
      checkbox.setAttribute('role', 'checkbox');
      checkbox.setAttribute('aria-label', `${asset.title || 'アイテム'} を選択`);
      if (!asset.downloaded) {
        checkbox.classList.add('opacity-40', 'cursor-not-allowed');
        checkbox.setAttribute('aria-disabled', 'true');
      } else {
        checkbox.setAttribute('aria-disabled', 'false');
      }
      checkbox.innerHTML = '<div class="w-2.5 h-2.5 bg-blue-500 rounded-sm hidden m-[3px] pointer-events-none check-mark"></div>';
      updateSelectionCheckboxVisual(checkbox, asset.itemId);
      checkbox.addEventListener('click', (event) => {
        event.stopPropagation();
        const changed = toggleSelection(String(asset.itemId), checkbox);
        if (changed) updateSelectionCheckboxVisual(checkbox, asset.itemId);
      });
      enableKeyboardActivation(checkbox, (event) => {
        event.stopPropagation();
        const changed = toggleSelection(String(asset.itemId), checkbox);
        if (changed) updateSelectionCheckboxVisual(checkbox, asset.itemId);
      });
      return checkbox;
    }

    function applyDownloadButtonState(button, downloaded) {
      if (!button) return;
      button.textContent = downloaded ? 'インポート' : 'ダウンロード';
      if (downloaded) {
        button.classList.remove('border-gray-700', 'hover:bg-white', 'hover:text-black');
        button.classList.add('border-blue-600', 'text-blue-300', 'hover:bg-blue-600/20');
      } else {
        button.classList.remove('border-blue-600', 'text-blue-300', 'hover:bg-blue-600/20');
        button.classList.add('border-gray-700', 'hover:bg-white', 'hover:text-black');
      }
    }

    function createProgressUi() {
      const progressWrapper = document.createElement('div');
      progressWrapper.className = 'progress-wrapper opacity-0 transition-opacity duration-150';
      progressWrapper.style.minHeight = '4px';
      const progressBarContainer = document.createElement('div');
      progressBarContainer.className = 'h-1 w-full bg-black rounded-full overflow-hidden';
      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar h-full bg-blue-500 transition-all duration-300';
      progressBar.style.width = '0%';
      progressBarContainer.appendChild(progressBar);
      progressWrapper.appendChild(progressBarContainer);
      return { progressWrapper, progressBar };
    }

    function registerTileEntry(asset, entry) {
      state.tileMap.set(toItemIdKey(asset.itemId), {
        ...entry,
        progWrapper: entry.progressWrapper,
        bytesBar: entry.progressBar,
        filesBar: null,
        filesLabel: null,
        downloadBtn: entry.dlBtn,
      });
    }

    function bindPrimaryOpen(target, asset, checkbox) {
      target.addEventListener('click', () => {
        if (state.selectionMode && checkbox) {
          toggleSelection(String(asset.itemId), checkbox);
          updateSelectionCheckboxVisual(checkbox, asset.itemId);
          return;
        }
        openPreviewModalAction(asset);
      });
      enableKeyboardActivation(target, () => {
        if (state.selectionMode && checkbox) {
          const changed = toggleSelection(String(asset.itemId), checkbox);
          if (changed) updateSelectionCheckboxVisual(checkbox, asset.itemId);
          return;
        }
        openPreviewModalAction(asset);
      });
    }

    function bindDownloadActions(asset, target, dlBtn, openBtn) {
      dlBtn?.addEventListener('click', async (event) => {
        event.stopPropagation();
        const latestAsset = getAssetByItemId(asset.itemId) || asset;
        const uiShowsImport = String(event.currentTarget?.textContent || '').trim().includes('インポート');
        if (uiShowsImport || shouldTreatAsDownloaded(asset.itemId, latestAsset)) {
          await openImportForAssetAction({ ...latestAsset, downloaded: true });
        } else {
          await handleDownloadAction(latestAsset, target);
        }
      });

      openBtn?.addEventListener('click', async (event) => {
        event.stopPropagation();
        await openItemFolderAction(asset.itemId, asset.title || '');
      });
    }

    function createAssetTile(asset) {
      const tile = document.createElement('div');
      tile.className = 'asset-tile p-3 group cursor-pointer bg-[#181b20] hover:bg-[#23272f] border border-gray-800 hover:border-blue-500/50 rounded-lg transition-all flex flex-col gap-2 shadow-sm hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70';
      tile.dataset.itemId = asset.itemId;
      tile.tabIndex = 0;
      tile.setAttribute('role', 'button');
      tile.setAttribute('aria-label', `${asset.title || 'アイテム'} を開く`);

      const previewSrc = asset.preview?.[0] || '';
      const authorIcon = asset.authorIcon || '';
      const author = asset.author || '不明';
      const categoryText = getCategoryDisplayText(asset.primaryCategory, 'その他');

      const thumbWrapper = document.createElement('div');
      thumbWrapper.className = 'relative w-full pb-[100%] bg-[#111] overflow-hidden rounded-md mb-1';
      if (previewSrc) {
        const img = document.createElement('img');
        img.src = previewSrc;
        img.className = 'absolute inset-0 booth-image-contain transition-transform group-hover:scale-105';
        img.loading = 'lazy';
        thumbWrapper.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'absolute inset-0 flex items-center justify-center text-gray-700 text-[10px]';
        placeholder.textContent = '[画像なし]';
        thumbWrapper.appendChild(placeholder);
      }
      if (asset.hasUpdate) {
        const updateBadge = document.createElement('div');
        updateBadge.className = 'absolute top-2 right-2 px-2 py-0.5 bg-amber-400 text-black text-[8px] font-bold rounded-sm shadow z-10';
        updateBadge.textContent = '更新あり';
        thumbWrapper.appendChild(updateBadge);
      }

      const checkbox = createSelectionCheckbox(asset, true);
      checkbox.classList.add('absolute', 'top-2', 'left-2', 'z-20');
      thumbWrapper.appendChild(checkbox);

      const infoContainer = document.createElement('div');
      infoContainer.className = 'flex flex-col gap-1.5 flex-1';

      if (categoryText && categoryText !== 'その他') {
        const catBadge = document.createElement('span');
        catBadge.className = 'text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 self-start truncate max-w-full';
        catBadge.textContent = categoryText;
        infoContainer.appendChild(catBadge);
      }

      const title = document.createElement('h3');
      title.className = 'text-[13px] font-bold text-gray-100 leading-snug line-clamp-2 group-hover:text-blue-400 h-[2.6em] transition-colors';
      title.textContent = asset.title || 'アイテム';
      title.title = asset.title || 'アイテム';
      infoContainer.appendChild(title);

      const isWishlistOnly = Boolean(asset.isWishlisted) && !asset.downloaded && !(asset.files && asset.files.length);
      if (isWishlistOnly) {
        const priceChip = createWishlistPriceChip(asset);
        if (priceChip) infoContainer.appendChild(priceChip);
      }

      const sa = Array.isArray(asset.supportedAvatars) ? asset.supportedAvatars.filter(Boolean) : [];
      if (sa.length) {
        const badgeRow = document.createElement('div');
        badgeRow.className = 'flex flex-wrap gap-1 mt-1';
        const avatarImageMap = state?.avatarImageMap;
        for (const name of sa.slice(0, 5)) {
          const imgUrl = avatarImageMap?.get(name) || '';
          const displayName = state.avatarLabelMap?.get(name) || name;
          const badge = document.createElement('span');
          badge.dataset.avatarName = name;
          badge.title = displayName;
          badge.setAttribute('aria-label', `対応アバター: ${displayName}`);
          if (imgUrl) {
            badge.className = 'inline-block w-4 h-4 rounded-full overflow-hidden border border-white/15 flex-shrink-0';
            const imgEl = document.createElement('img');
            imgEl.src = imgUrl;
            imgEl.className = 'booth-image-contain';
            imgEl.alt = name;
            badge.appendChild(imgEl);
          } else {
            badge.className = 'inline-flex items-center max-w-full rounded border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 text-[8px] font-bold leading-none text-cyan-200 truncate';
            badge.textContent = displayName;
          }
          badgeRow.appendChild(badge);
        }
        if (sa.length > 5) {
          const more = document.createElement('span');
          more.className = 'inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-800/60 text-zinc-400 border border-zinc-700/40 text-[7px] leading-none flex-shrink-0';
          more.textContent = `+${sa.length - 5}`;
          badgeRow.appendChild(more);
        }
        if (badgeRow.childNodes.length) infoContainer.appendChild(badgeRow);
      }

      const footerRow = document.createElement('div');
      footerRow.className = 'flex items-center justify-between mt-auto pt-1 border-t border-gray-800/50';
      const authorBox = document.createElement('div');
      authorBox.className = 'flex items-center gap-1.5 min-w-0';
      if (authorIcon) {
        const iconImg = document.createElement('img');
        iconImg.src = authorIcon;
        iconImg.className = 'w-4 h-4 rounded-full object-cover flex-shrink-0';
        authorBox.appendChild(iconImg);
      }
      const authorName = document.createElement('span');
      authorName.className = 'text-[10px] text-gray-400 truncate';
      authorName.textContent = author;
      authorBox.appendChild(authorName);

      const dateText = document.createElement('span');
      dateText.className = 'text-[9px] text-gray-600 font-mono flex-shrink-0';
      const orderDateMs = parseSortableDateMs(asset.orderDate);
      if (orderDateMs !== null) {
        const orderDate = new Date(orderDateMs);
        dateText.textContent = `${orderDate.getFullYear()}.${String(orderDate.getMonth() + 1).padStart(2, '0')}.${String(orderDate.getDate()).padStart(2, '0')}`;
      }

      footerRow.appendChild(authorBox);
      footerRow.appendChild(dateText);
      infoContainer.appendChild(footerRow);

      const downloadContainer = document.createElement('div');
      downloadContainer.className = 'download-container mt-auto pt-2 border-t border-gray-800/50';
      const buttonRow = document.createElement('div');
      buttonRow.className = 'flex items-center justify-between gap-2';

      let dlBtn = null;
      let openBtn = null;
      if (!isWishlistOnly) {
        dlBtn = document.createElement('button');
        dlBtn.className = 'dl-btn text-[9px] px-2 py-1 border transition';
        applyDownloadButtonState(dlBtn, Boolean(asset.downloaded));
        buttonRow.appendChild(dlBtn);

        openBtn = document.createElement('button');
        openBtn.className = 'open-btn text-[9px] px-2 py-1 text-gray-500 hover:text-white transition';
        openBtn.textContent = 'フォルダ';
        buttonRow.appendChild(openBtn);
      }

      const progressUi = createProgressUi();
      progressUi.progressWrapper.classList.add('mt-2');
      downloadContainer.appendChild(buttonRow);
      downloadContainer.appendChild(progressUi.progressWrapper);

      bindPrimaryOpen(tile, asset, checkbox);
      bindDownloadActions(asset, tile, dlBtn, openBtn);

      tile.appendChild(thumbWrapper);
      tile.appendChild(infoContainer);
      tile.appendChild(downloadContainer);

      registerTileEntry(asset, {
        tile,
        progressBar: progressUi.progressBar,
        progressWrapper: progressUi.progressWrapper,
        dlBtn,
        statusEl: null,
      });

      return tile;
    }

    function createAssetListHeaderRow() {
      const row = document.createElement('div');
      row.className = 'bg-[#0f1013] border border-gray-800 rounded px-3 py-2 text-[10px] text-gray-400 font-mono-custom';
      row.style.display = 'grid';
      row.style.gridTemplateColumns = getListGridTemplateColumns();
      row.style.alignItems = 'center';
      row.style.gap = '10px';

      const cols = state.selectionMode
        ? ['', '', '名前', 'カテゴリ', '作者', '購入日', 'ファイル', '状態']
        : ['', '名前', 'カテゴリ', '作者', '購入日', 'ファイル', '状態'];

      cols.forEach((text) => {
        const cell = document.createElement('div');
        cell.textContent = text;
        row.appendChild(cell);
      });
      return row;
    }

    function createAssetListRow(asset) {
      const row = document.createElement('div');
      row.className = 'border border-gray-800 rounded px-3 py-2 bg-[#121419] hover:bg-[#1a1f28] hover:border-blue-500/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70';
      row.dataset.itemId = asset.itemId;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `${asset.title || 'アイテム'} を開く`);
      row.style.display = 'grid';
      row.style.gridTemplateColumns = getListGridTemplateColumns();
      row.style.alignItems = 'center';
      row.style.gap = '10px';

      let checkbox = null;
      if (state.selectionMode) {
        checkbox = createSelectionCheckbox(asset, false);
        row.appendChild(checkbox);
      }

      const thumbCell = document.createElement('div');
      thumbCell.className = 'w-10 h-10 rounded bg-[#0b0d12] border border-gray-800 overflow-hidden';
      if (asset.preview?.[0]) {
        const img = document.createElement('img');
        img.src = asset.preview[0];
        img.className = 'booth-image-contain';
        img.loading = 'lazy';
        thumbCell.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'w-full h-full flex items-center justify-center text-[8px] text-gray-600';
        placeholder.textContent = 'NO IMG';
        thumbCell.appendChild(placeholder);
      }
      row.appendChild(thumbCell);

      const nameCell = document.createElement('div');
      nameCell.className = 'min-w-0';
      nameCell.innerHTML = `
        <div class="text-[11px] text-gray-100 truncate">${esc(asset.title || 'アイテム')}</div>
        <div class="text-[9px] text-gray-500 font-mono-custom truncate">#${esc(String(asset.itemId || ''))}</div>
      `;
      row.appendChild(nameCell);

      const catCell = document.createElement('div');
      catCell.className = 'text-[10px] text-blue-300 truncate';
      catCell.textContent = getCategoryDisplayText(asset.primaryCategory, 'その他');
      row.appendChild(catCell);

      const authorCell = document.createElement('div');
      authorCell.className = 'text-[10px] text-gray-300 truncate';
      authorCell.textContent = asset.author || 'Unknown';
      row.appendChild(authorCell);

      const dateCell = document.createElement('div');
      dateCell.className = 'text-[10px] text-gray-400 font-mono-custom';
      dateCell.textContent = formatDate(asset.orderDate);
      row.appendChild(dateCell);

      const filesCell = document.createElement('div');
      filesCell.className = 'text-[10px] text-gray-400 font-mono-custom';
      filesCell.textContent = String((asset.files || []).length);
      row.appendChild(filesCell);

      const actionsCell = document.createElement('div');
      actionsCell.className = 'flex flex-col gap-1';
      const actionTop = document.createElement('div');
      actionTop.className = 'flex items-center gap-1';

      const isWishlistOnlyRow = Boolean(asset.isWishlisted) && !asset.downloaded && !(asset.files && asset.files.length);

      let dlBtn = null;
      let openBtn = null;
      const statusEl = document.createElement('span');
      if (!isWishlistOnlyRow) {
        dlBtn = document.createElement('button');
        dlBtn.className = 'dl-btn text-[9px] px-2 py-1 border transition rounded';
        applyDownloadButtonState(dlBtn, Boolean(asset.downloaded));
        actionTop.appendChild(dlBtn);

        openBtn = document.createElement('button');
        openBtn.className = 'open-btn text-[9px] px-2 py-1 text-gray-400 hover:text-white border border-gray-800 rounded';
        openBtn.textContent = 'Folder';
        statusEl.className = `text-[9px] ml-1 ${asset.hasUpdate ? 'text-amber-300' : (asset.downloaded ? 'text-emerald-300' : 'text-gray-500')}`;
        statusEl.textContent = asset.hasUpdate ? '更新あり' : (asset.downloaded ? 'DL済み' : '未DL');
        actionTop.appendChild(openBtn);
        actionTop.appendChild(statusEl);
      } else {
        const priceChip = createWishlistPriceChip(asset, true);
        if (priceChip) actionTop.appendChild(priceChip);
      }

      const progressUi = createProgressUi();
      actionsCell.appendChild(actionTop);
      actionsCell.appendChild(progressUi.progressWrapper);
      row.appendChild(actionsCell);

      bindPrimaryOpen(row, asset, checkbox);
      bindDownloadActions(asset, row, dlBtn, openBtn);

      registerTileEntry(asset, {
        tile: row,
        progressBar: progressUi.progressBar,
        progressWrapper: progressUi.progressWrapper,
        dlBtn,
        statusEl,
      });

      return row;
    }

    function updateViewToggleButtons() {
      if (domRefs.viewGridBtn && domRefs.viewListBtn) {
        if (state.viewMode === 'list') {
          domRefs.viewListBtn.classList.remove('text-zinc-600');
          domRefs.viewListBtn.classList.add('text-blue-500');
          domRefs.viewGridBtn.classList.remove('text-blue-500');
          domRefs.viewGridBtn.classList.add('text-zinc-600');
        } else {
          domRefs.viewGridBtn.classList.remove('text-zinc-600');
          domRefs.viewGridBtn.classList.add('text-blue-500');
          domRefs.viewListBtn.classList.remove('text-blue-500');
          domRefs.viewListBtn.classList.add('text-zinc-600');
        }
      }
      if (domRefs.filterBtns) {
        const validViews = ['updated', 'review', 'wishlist', 'removed'];
        const all = Array.isArray(state.allAssets) ? state.allAssets : [];
        const filterCounts = {
          all: all.filter((a) => !a.isRemoved && (!a.isWishlisted || a.downloaded)).length,
          updated: all.filter((a) => !a.isRemoved && (!a.isWishlisted || a.downloaded) && a.hasUpdate).length,
          wishlist: all.filter((a) => !a.isRemoved && a.isWishlisted).length,
          removed: all.filter((a) => Boolean(a.isRemoved)).length,
        };
        domRefs.filterBtns.forEach((btn) => {
          const raw = btn.dataset.filter || 'all';
          const view = validViews.includes(raw) ? raw : 'all';
          btn.classList.toggle('active', view === state.viewFilter);
          const countEl = btn.querySelector('.filter-count');
          if (countEl) {
            const n = filterCounts[raw] ?? filterCounts.all;
            countEl.textContent = n > 0 ? String(n) : '';
          }
        });
      }
    }

    function getFilteredAssets() {
      const cacheKey = buildFilterCacheKey();
      if (filteredCache !== null && filteredCacheKey === cacheKey) return filteredCache;

      let filtered = state.currentCategory === 'all' || state.currentCategory === '__ALL__'
        ? [...state.allAssets]
        : state.allAssets.filter((asset) => {
            if (state.currentCategory === giftCategoryKey) {
              return Boolean(asset?.isGift);
            }
            if (freeDownloadCategoryKey && state.currentCategory === freeDownloadCategoryKey) {
              return Boolean(asset?.isFreeDownload);
            }
            if (asset.primaryCategory) {
              const category = asset.primaryCategory;
              if (category.slug === state.currentCategory || category.text === state.currentCategory) return true;
            }
            const categories = asset.categories || [];
            return categories.some((category) => category.slug === state.currentCategory || category.text === state.currentCategory);
          });

      // isRemoved items are hidden by default unless explicitly filtering for them
      if (state.viewFilter !== 'removed') {
        filtered = filtered.filter((asset) => !asset.isRemoved);
      } else {
        filtered = filtered.filter((asset) => Boolean(asset.isRemoved));
      }

      if (state.viewFilter === 'wishlist') {
        filtered = filtered.filter((asset) => Boolean(asset.isWishlisted));
      } else {
        // wishlist-only items (未購入) are hidden from all other views
        filtered = filtered.filter((asset) => !asset.isWishlisted || asset.downloaded);
        if (state.viewFilter === 'updated') {
          filtered = filtered.filter((asset) => Boolean(asset.hasUpdate));
        } else if (state.viewFilter === 'review') {
          filtered = filtered.filter((asset) => String(asset?.supportedAvatarAnalysis?.status || '') === 'review');
        }
      }
      const activeAvatarFilters = Array.isArray(state.avatarFilters) && state.avatarFilters.length
        ? state.avatarFilters
        : (state.avatarFilter ? [state.avatarFilter] : []);
      if (activeAvatarFilters.length) {
        filtered = filtered.filter((asset) => matchesAvatarFilter(asset, activeAvatarFilters));
      }
      if (state.searchQuery) {
        filtered = filtered.filter((asset) => matchesSearch(asset, state.searchQuery));
      }

      if (state.sortMode === 'name_asc') {
        filtered.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ja'));
      } else if (state.sortMode === 'size_desc') {
        filtered.sort((a, b) => {
          const sizeA = Number(a?.sizeBytes || 0) || Number(Array.isArray(a?.files) ? a.files.length : 0);
          const sizeB = Number(b?.sizeBytes || 0) || Number(Array.isArray(b?.files) ? b.files.length : 0);
          return sizeB - sizeA;
        });
      } else {
        filtered.sort(compareAssetsByAddedDateDesc);
      }

      filteredCache = filtered;
      filteredCacheKey = cacheKey;
      return filtered;
    }

    function vsGetColCount() {
      const w = window.innerWidth;
      if (w >= 1536) return 6;
      if (w >= 1280) return 5;
      if (w >= 1024) return 4;
      if (w >= 640) return 3;
      return 2;
    }

    function vsUpdateSpacers(firstRow, lastRow, totalRows, rowHeight) {
      const topH = firstRow * rowHeight;
      const bottomRows = Math.max(0, totalRows - lastRow - 1);
      const bottomH = bottomRows * rowHeight;
      domRefs.grid.style.paddingTop = topH > 0 ? `${topH}px` : '';
      domRefs.grid.style.paddingBottom = bottomH > 0 ? `${bottomH}px` : '';
    }

    function vsMeasureAndUpdateSpacers() {
      if (vs.tileHeight !== 300) return;
      if (!state.filteredAssets || state.filteredAssets.length === 0) return;
      const tile = domRefs.grid.querySelector('.asset-tile:not([data-append-tile])');
      if (!tile) return;
      const h = tile.getBoundingClientRect().height;
      if (h <= 10) return;
      vs.tileHeight = h;
      const total = state.filteredAssets.length;
      const rowHeight = vs.tileHeight + vs.gapSize;
      const colCount = vs.colCount;
      const totalRows = Math.ceil(total / colCount);
      const firstRow = Math.floor(vs.firstIndex / colCount);
      const lastRow = Math.max(0, Math.ceil(vs.lastIndex / colCount) - 1);
      vsUpdateSpacers(firstRow, lastRow, totalRows, rowHeight);
    }

    function vsCreateAppendTile() {
      const el = document.createElement('div');
      el.className = 'asset-tile p-4 border-dashed border-gray-800 bg-transparent flex items-center justify-center cursor-pointer hover:border-gray-600 transition-colors group';
      el.dataset.appendTile = '1';
      el.innerHTML = `
        <div class="text-center">
          <div class="text-xl font-light text-gray-800 group-hover:text-gray-500">+</div>
          <div class="text-[9px] font-bold text-gray-800 group-hover:text-gray-500 mt-2">
            無料アセット追加
          </div>
        </div>
      `;
      return el;
    }

    function getEmptyStateCopy() {
      const total = Array.isArray(state.allAssets) ? state.allAssets.length : 0;
      const hasSearch = Boolean(String(state.searchQuery || '').trim());
      const hasAvatarFilter = Boolean(state.avatarFilter || (Array.isArray(state.avatarFilters) && state.avatarFilters.length));
      const filteredView = state.viewFilter === 'updated' || state.currentCategory !== 'all' || hasSearch || hasAvatarFilter;
      if (total <= 0) {
        const reason = String(state.libraryEmptyReason || '');
        if (reason === 'not_logged_in') {
          return {
            title: 'BOOTHにログインしていません',
            body: '購入履歴を同期するには BOOTH ログインが必要です。ログイン後にもう一度同期してください。',
            primary: 'Login',
            secondary: '再同期',
            tertiary: '無料アセット追加',
          };
        }
        if (reason === 'no_purchases') {
          return {
            title: '購入アイテムはありません',
            body: 'BOOTH ログインは確認できましたが、購入履歴に同期できるアイテムがありません。無料アセットはURL/IDから追加できます。',
            primary: '無料アセット追加',
            secondary: '再同期',
            tertiary: '',
          };
        }
        return {
          title: '購入アイテムを確認できません',
          body: 'BOOTH のログイン状態または購入履歴を確認できませんでした。ログイン後に再同期してください。',
          primary: '無料アセット追加',
          secondary: '再同期',
          tertiary: 'Login',
        };
      }
      if (filteredView) {
        return {
          title: '条件に合うアイテムがありません',
          body: '検索、カテゴリ、アバター、更新ありフィルターの条件を変えると表示される可能性があります。',
          primary: '全て表示',
          secondary: '',
          tertiary: '',
        };
      }
      return {
        title: '表示できるアイテムがありません',
        body: 'ライブラリ同期または手動追加でアイテムを追加できます。',
        primary: '無料アセット追加',
        secondary: '再同期',
        tertiary: '',
      };
    }

    function createEmptyState() {
      const copy = getEmptyStateCopy();
      const el = document.createElement('div');
      el.className = state.viewMode === 'grid'
        ? 'col-span-full min-h-[320px] flex items-center justify-center'
        : 'min-h-[320px] flex items-center justify-center';
      el.innerHTML = `
        <div class="w-full max-w-md rounded-lg border border-white/10 bg-zinc-950/55 px-5 py-5 text-center shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
          <div class="text-[11px] font-bold text-zinc-100">${esc(copy.title)}</div>
          <div class="mt-2 text-[10px] leading-relaxed text-zinc-500">${esc(copy.body)}</div>
          <div class="mt-4 flex flex-wrap items-center justify-center gap-2">
            ${copy.primary ? `<button type="button" data-empty-action="primary" class="btn-action btn-primary !px-3 !py-2">${esc(copy.primary)}</button>` : ''}
            ${copy.secondary ? `<button type="button" data-empty-action="secondary" class="btn-action !px-3 !py-2">${esc(copy.secondary)}</button>` : ''}
            ${copy.tertiary ? `<button type="button" data-empty-action="tertiary" class="btn-action !px-3 !py-2">${esc(copy.tertiary)}</button>` : ''}
          </div>
        </div>
      `;
      el.querySelector('[data-empty-action="primary"]')?.addEventListener('click', () => {
        if (String(state.libraryEmptyReason || '') === 'not_logged_in') {
          if (typeof openBoothLoginAction === 'function') openBoothLoginAction();
          return;
        }
        if ((Array.isArray(state.allAssets) ? state.allAssets.length : 0) <= 0) {
          if (typeof openManualAddModalAction === 'function') openManualAddModalAction();
          return;
        }
        state.currentCategory = 'all';
        state.viewFilter = 'all';
        state.searchQuery = '';
        state.avatarFilter = '';
        state.avatarFilters = [];
        if (domRefs.searchInput) domRefs.searchInput.value = '';
        syncAvatarFilterUI();
        applyCategoryFilter('all');
      });
      el.querySelector('[data-empty-action="secondary"]')?.addEventListener('click', () => {
        if (typeof syncLibraryAction === 'function') syncLibraryAction();
        else domRefs.syncLibraryBtn?.click?.();
      });
      el.querySelector('[data-empty-action="tertiary"]')?.addEventListener('click', () => {
        if (String(state.libraryEmptyReason || '') === 'not_logged_in') {
          if (typeof openManualAddModalAction === 'function') openManualAddModalAction();
          return;
        }
        if (typeof openBoothLoginAction === 'function') openBoothLoginAction();
      });
      return el;
    }

    function vsCleanup() {
      if (vs._scrollListener && vs.scrollContainer) {
        vs.scrollContainer.removeEventListener('scroll', vs._scrollListener);
        vs._scrollListener = null;
      }
      if (vs._resizeObserver) {
        vs._resizeObserver.disconnect();
        vs._resizeObserver = null;
      }
      if (vs._raf) {
        cancelAnimationFrame(vs._raf);
        vs._raf = null;
      }
      if (domRefs.grid) {
        domRefs.grid.style.paddingTop = '';
        domRefs.grid.style.paddingBottom = '';
      }
      vs.listBody = null;
      vs.listBodyOffset = -1;
      vs.mode = null;
      vs.enabled = false;
    }

    function vsMeasureListBodyOffset() {
      if (vs.listBodyOffset >= 0) return;
      if (!vs.scrollContainer || !vs.listBody) return;
      const scTop = vs.scrollContainer.getBoundingClientRect().top;
      const lbTop = vs.listBody.getBoundingClientRect().top;
      vs.listBodyOffset = lbTop - scTop + vs.scrollContainer.scrollTop;
    }

    function vsUpdateListSpacers(firstRow, lastRow, totalRows, rowHeight) {
      if (!vs.listBody) return;
      const topH = firstRow * rowHeight;
      const bottomRows = Math.max(0, totalRows - lastRow - 1);
      const bottomH = bottomRows * rowHeight;
      vs.listBody.style.paddingTop = topH > 0 ? `${topH}px` : '';
      vs.listBody.style.paddingBottom = bottomH > 0 ? `${bottomH}px` : '';
    }

    function vsMeasureListRowHeight() {
      if (vs.tileHeight !== 52) return;
      const row = vs.listBody && vs.listBody.querySelector('.border');
      if (!row) return;
      const h = row.getBoundingClientRect().height;
      if (h <= 10) return;
      vs.tileHeight = h;
      const total = state.filteredAssets ? state.filteredAssets.length : 0;
      const rowHeight = vs.tileHeight + vs.gapSize;
      const totalRows = Math.ceil(total / vs.colCount);
      const firstRow = vs.firstIndex;
      const lastRow = Math.max(0, vs.lastIndex - 1);
      vsUpdateListSpacers(firstRow, lastRow, totalRows, rowHeight);
    }

    function vsListRender() {
      if (!vs.enabled || vs.mode !== 'list' || !vs.listBody || !vs.scrollContainer) return;

      const filtered = state.filteredAssets;
      const total = filtered ? filtered.length : 0;
      const rowHeight = vs.tileHeight + vs.gapSize;
      const totalRows = total;

      vsMeasureListBodyOffset();
      const scrollTop = vs.scrollContainer.scrollTop;
      const viewportH = vs.scrollContainer.clientHeight || 600;
      const scrollInBody = Math.max(0, scrollTop - vs.listBodyOffset);

      const firstVisRow = Math.floor(scrollInBody / rowHeight);
      const lastVisRow = Math.ceil((scrollInBody + viewportH) / rowHeight);

      const firstRow = Math.max(0, firstVisRow - vs.bufferRows);
      const lastRow = Math.min(totalRows > 0 ? totalRows - 1 : 0, lastVisRow + vs.bufferRows);

      const newFirst = firstRow;
      const newLast = total === 0 ? 0 : Math.min(lastRow + 1, total);

      const prevFirst = vs.firstIndex;
      const prevLast = vs.lastIndex;

      if (newFirst === prevFirst && newLast === prevLast) {
        vsUpdateListSpacers(firstRow, lastRow, totalRows, rowHeight);
        return;
      }

      vs.firstIndex = newFirst;
      vs.lastIndex = newLast;

      const noOverlap = prevFirst === prevLast || newLast <= prevFirst || newFirst >= prevLast;

      if (noOverlap) {
        const toDelete = [];
        for (const el of vs.listBody.children) {
          const idx = parseInt(el.dataset.vsIdx ?? '-1');
          if (idx >= 0 && idx < total) toDelete.push(idx);
        }
        vs.listBody.innerHTML = '';
        for (const idx of toDelete) {
          state.tileMap.delete(toItemIdKey(filtered[idx].itemId));
        }
        if (total > 0) {
          const frag = document.createDocumentFragment();
          for (let i = newFirst; i < newLast; i++) {
            const row = createAssetListRow(filtered[i]);
            row.dataset.vsIdx = String(i);
            frag.appendChild(row);
          }
          vs.listBody.appendChild(frag);
        }
      } else {
        const toRemove = [];
        for (const el of vs.listBody.children) {
          const idx = parseInt(el.dataset.vsIdx ?? '-1');
          if (idx < newFirst || idx >= newLast) toRemove.push({ el, idx });
        }
        for (const { el, idx } of toRemove) {
          el.remove();
          if (idx >= 0 && idx < total) {
            state.tileMap.delete(toItemIdKey(filtered[idx].itemId));
          }
        }

        if (newFirst < prevFirst) {
          const frag = document.createDocumentFragment();
          for (let i = newFirst; i < Math.min(prevFirst, newLast); i++) {
            const row = createAssetListRow(filtered[i]);
            row.dataset.vsIdx = String(i);
            frag.appendChild(row);
          }
          vs.listBody.insertBefore(frag, vs.listBody.firstChild);
        }

        if (newLast > prevLast) {
          const frag = document.createDocumentFragment();
          for (let i = Math.max(prevLast, newFirst); i < newLast; i++) {
            const row = createAssetListRow(filtered[i]);
            row.dataset.vsIdx = String(i);
            frag.appendChild(row);
          }
          vs.listBody.appendChild(frag);
        }
      }

      vsUpdateListSpacers(firstRow, lastRow, totalRows, rowHeight);
      vsMeasureListRowHeight();
    }

    function vsListInit() {
      vsCleanup();
      domRefs.grid.className = 'space-y-1';
      domRefs.grid.innerHTML = '';
      domRefs.grid.appendChild(createAssetListHeaderRow());

      const listBody = document.createElement('div');
      listBody.className = 'space-y-1';
      domRefs.grid.appendChild(listBody);
      vs.listBody = listBody;

      vs.scrollContainer = domRefs.grid.parentElement;
      if (vs.scrollContainer) vs.scrollContainer.scrollTop = 0;
      vs.firstIndex = 0;
      vs.lastIndex = 0;
      vs.tileHeight = 52;
      vs.gapSize = 4;
      vs.colCount = 1;
      vs.listBodyOffset = -1;
      vs.mode = 'list';
      vs.enabled = true;

      vs._scrollListener = () => {
        if (vs._raf) return;
        vs._raf = requestAnimationFrame(() => {
          vs._raf = null;
          vsListRender();
        });
      };
      if (vs.scrollContainer) {
        vs.scrollContainer.addEventListener('scroll', vs._scrollListener, { passive: true });
      }
    }

    function vsInit() {
      vsCleanup();
      vs.scrollContainer = domRefs.grid.parentElement;
      if (vs.scrollContainer) vs.scrollContainer.scrollTop = 0;
      vs.firstIndex = 0;
      vs.lastIndex = 0;
      vs.tileHeight = 300;
      vs.colCount = vsGetColCount();
      vs.enabled = true;

      vs._scrollListener = () => {
        if (vs._raf) return;
        vs._raf = requestAnimationFrame(() => {
          vs._raf = null;
          vsRender();
        });
      };
      if (vs.scrollContainer) {
        vs.scrollContainer.addEventListener('scroll', vs._scrollListener, { passive: true });
      }

      vs._resizeObserver = new ResizeObserver(() => {
        if (!vs.enabled) return;
        const newCol = vsGetColCount();
        if (newCol !== vs.colCount) {
          vs.colCount = newCol;
          vs.firstIndex = 0;
          vs.lastIndex = 0;
          domRefs.grid.innerHTML = '';
          state.tileMap.clear();
          domRefs.grid.style.paddingTop = '';
          domRefs.grid.style.paddingBottom = '';
          vs.tileHeight = 300;
          vsRender();
        }
      });
      vs._resizeObserver.observe(domRefs.grid);
    }

    function vsRender() {
      if (!vs.enabled || !domRefs.grid || !vs.scrollContainer) return;

      const filtered = state.filteredAssets;
      const total = filtered.length;
      const colCount = vsGetColCount();
      vs.colCount = colCount;
      const rowHeight = vs.tileHeight + vs.gapSize;
      const totalRows = Math.ceil(total / colCount);

      const scrollTop = vs.scrollContainer.scrollTop;
      const viewportH = vs.scrollContainer.clientHeight || 600;

      const firstVisRow = Math.floor(scrollTop / rowHeight);
      const lastVisRow = Math.ceil((scrollTop + viewportH) / rowHeight);

      const firstRow = Math.max(0, firstVisRow - vs.bufferRows);
      const lastRow = Math.min(totalRows > 0 ? totalRows - 1 : 0, lastVisRow + vs.bufferRows);

      const newFirst = firstRow * colCount;
      const newLast = total === 0 ? 0 : Math.min((lastRow + 1) * colCount, total);

      const prevFirst = vs.firstIndex;
      const prevLast = vs.lastIndex;

      if (newFirst === prevFirst && newLast === prevLast) {
        vsUpdateSpacers(firstRow, lastRow, totalRows, rowHeight);
        return;
      }

      vs.firstIndex = newFirst;
      vs.lastIndex = newLast;

      const noOverlap = prevFirst === prevLast || newLast <= prevFirst || newFirst >= prevLast;

      if (noOverlap) {
        domRefs.grid.innerHTML = '';
        state.tileMap.clear();
        if (total > 0) {
          const frag = document.createDocumentFragment();
          for (let i = newFirst; i < newLast; i++) {
            const tile = createAssetTile(filtered[i]);
            tile.dataset.vsIdx = String(i);
            frag.appendChild(tile);
          }
          if (newLast >= total) frag.appendChild(vsCreateAppendTile());
          domRefs.grid.appendChild(frag);
        }
      } else {
        const toRemove = [];
        for (const el of domRefs.grid.children) {
          if (el.dataset.appendTile) continue;
          const idx = parseInt(el.dataset.vsIdx ?? '-1');
          if (idx < newFirst || idx >= newLast) toRemove.push({ el, idx });
        }
        for (const { el, idx } of toRemove) {
          el.remove();
          if (idx >= 0 && idx < total) {
            state.tileMap.delete(toItemIdKey(filtered[idx].itemId));
          }
        }

        const existingAppend = domRefs.grid.querySelector('[data-append-tile]');
        if (existingAppend) existingAppend.remove();

        if (newFirst < prevFirst) {
          const frag = document.createDocumentFragment();
          for (let i = newFirst; i < Math.min(prevFirst, newLast); i++) {
            const tile = createAssetTile(filtered[i]);
            tile.dataset.vsIdx = String(i);
            frag.appendChild(tile);
          }
          domRefs.grid.insertBefore(frag, domRefs.grid.firstChild);
        }

        if (newLast > prevLast) {
          const frag = document.createDocumentFragment();
          for (let i = Math.max(prevLast, newFirst); i < newLast; i++) {
            const tile = createAssetTile(filtered[i]);
            tile.dataset.vsIdx = String(i);
            frag.appendChild(tile);
          }
          domRefs.grid.appendChild(frag);
        }

        if (newLast >= total) domRefs.grid.appendChild(vsCreateAppendTile());
      }

      vsUpdateSpacers(firstRow, lastRow, totalRows, rowHeight);
      vsMeasureAndUpdateSpacers();
    }

    function renderGrid() {
      if (!domRefs.grid) return;
      state.tileMap.clear();

      const filtered = getFilteredAssets();
      state.filteredAssets = filtered;

      if (domRefs.updateBadge) {
        const updateCount = Number(state.updateAssetCount || 0);
        domRefs.updateBadge.textContent = updateCount;
        domRefs.updateBadge.classList.toggle('hidden', updateCount <= 0);
      }

      ++state.renderJobToken;

      if (state.viewMode === 'grid') {
        domRefs.grid.className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-5';
        domRefs.grid.innerHTML = '';
        if (filtered.length === 0) {
          vsCleanup();
          domRefs.grid.appendChild(createEmptyState());
        } else {
          vsInit();
          vsRender();
        }
      } else {
        if (filtered.length === 0) {
          vsCleanup();
          domRefs.grid.className = 'space-y-1';
          domRefs.grid.innerHTML = '';
          domRefs.grid.appendChild(createAssetListHeaderRow());
          domRefs.grid.appendChild(createEmptyState());
        } else {
          vsListInit();
          vsListRender();
        }
      }

      updateViewToggleButtons();
    }

    function getTileEntryByItemId(itemId) {
      return state.tileMap.get(toItemIdKey(itemId)) || null;
    }

    function refreshVisibleTileActionStates() {
      for (const [itemId, entry] of state.tileMap.entries()) {
        if (!entry) continue;
        const asset = getAssetByItemId(itemId);
        if (entry.progWrapper) {
          entry.progWrapper.classList.remove('opacity-100');
          entry.progWrapper.classList.add('opacity-0');
        }
        if (entry.bytesBar) {
          entry.bytesBar.classList.remove('indeterminate');
          entry.bytesBar.style.width = '0%';
        }
        if (entry.filesBar) entry.filesBar.style.width = '0%';
        if (entry.filesLabel) entry.filesLabel.textContent = '';
        if (entry.statusEl) {
          entry.statusEl.textContent = asset?.hasUpdate ? '更新あり' : (asset?.downloaded ? 'DL済み' : '未DL');
        }
        if (entry.downloadBtn) {
          entry.downloadBtn.disabled = false;
          entry.downloadBtn.classList.remove('opacity-60');
          applyDownloadButtonState(entry.downloadBtn, Boolean(asset?.downloaded));
        }
      }
    }

    function bindUiEvents() {
      if (domRefs.filterBtns) {
        domRefs.filterBtns.forEach((button) => {
          button.addEventListener('click', () => {
            domRefs.filterBtns.forEach((row) => row.classList.remove('active'));
            button.classList.add('active');
            const raw = button.dataset.filter || 'all';
            const validViews = ['updated', 'review', 'wishlist', 'removed'];
            const view = validViews.includes(raw) ? raw : 'all';
            applyViewFilter(view);
          });
        });
      }
      domRefs.searchInput?.addEventListener('input', (event) => {
        const next = (event.target.value || '').trim();
        if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          searchDebounceTimer = null;
          if (state.searchQuery === next) return;
          state.searchQuery = next;
          invalidateFilterCache();
          renderGrid();
        }, 180);
      });
      const avatarSelect = domRefs.avatarFilterSelect || document.getElementById('avatar-filter-select');
      const avatarPanel = domRefs.avatarFilterPanel || document.getElementById('avatar-filter-panel');
      const avatarToggle = domRefs.avatarFilterToggle || document.getElementById('avatar-filter-button');
      if (avatarToggle && avatarSelect && avatarPanel && avatarToggle.dataset.avatoolAvatarFilterBound !== '1') {
        avatarToggle.dataset.avatoolAvatarFilterBound = '1';
        avatarToggle.addEventListener('click', async () => {
          const next = normalizeAvatarFilterValue(avatarSelect.value || '');
          if (next === '__ANALYZE_REQUIRED__' || (next && !hasAvatarDetailedAnalysisResult())) {
            if (avatarAnalyzePromptBusy) return;
            avatarAnalyzePromptBusy = true;
            try {
              const analyzed = await showAvatarFilterAnalysisPromptModal();
              if (analyzed) {
                avatarSelect.value = '';
                state.avatarFilter = '';
                setAvatarFilterPanelOpen(false);
                syncAvatarFilterUI();
                renderGrid();
              }
            } finally {
              avatarAnalyzePromptBusy = false;
            }
            return;
          }
          setAvatarFilterPanelOpen(!state.avatarFilterPanelOpen);
        });
        avatarPanel.addEventListener('click', async (event) => {
          const button = event.target?.closest?.('[data-value]');
          if (!button) return;
          const next = normalizeAvatarFilterValue(button.dataset.value || '');
          const prev = normalizeAvatarFilterValue(state.avatarFilter || '');
          const needsAnalyze = next === '__ANALYZE_REQUIRED__' || (next && !hasAvatarDetailedAnalysisResult());
          if (needsAnalyze) {
            if (avatarAnalyzePromptBusy) return;
            avatarAnalyzePromptBusy = true;
            try {
              const analyzed = await showAvatarFilterAnalysisPromptModal();
              if (!analyzed) {
                syncAvatarFilterUI();
                return;
              }
              avatarSelect.value = '';
              state.avatarFilter = '';
              setAvatarFilterPanelOpen(false);
              syncAvatarFilterUI();
              renderGrid();
              return;
            } finally {
              avatarAnalyzePromptBusy = false;
            }
          }
          if (next === '') {
            // "すべて" → clear all
            state.avatarFilters = [];
            state.avatarFilter = '';
            if (avatarSelect) avatarSelect.value = '';
            setAvatarFilterPanelOpen(false);
          } else {
            // Toggle avatar in multi-select, keep panel open
            const cur = Array.isArray(state.avatarFilters) ? state.avatarFilters : [];
            const idx = cur.indexOf(next);
            state.avatarFilters = idx >= 0 ? cur.filter((f) => f !== next) : [...cur, next];
            state.avatarFilter = state.avatarFilters[0] || '';
            if (avatarSelect) avatarSelect.value = state.avatarFilter;
          }
          syncAvatarFilterUI();
          renderGrid();
        });
        avatarSelect.addEventListener('change', async (event) => {
          const next = normalizeAvatarFilterValue(event?.target?.value || '');
          const prev = normalizeAvatarFilterValue(state.avatarFilter || '');
          const needsAnalyze = next === '__ANALYZE_REQUIRED__' || (next && !hasAvatarDetailedAnalysisResult());
          if (needsAnalyze) {
            const analyzed = await showAvatarFilterAnalysisPromptModal();
            if (!analyzed) {
              if (avatarSelect.value !== prev) avatarSelect.value = prev;
              syncAvatarFilterUI();
              return;
            }
            avatarSelect.value = '';
            state.avatarFilter = '';
            setAvatarFilterPanelOpen(false);
            syncAvatarFilterUI();
            renderGrid();
            return;
          }
          state.avatarFilter = next;
          syncAvatarFilterUI();
          setAvatarFilterPanelOpen(false);
          renderGrid();
        });
      }
      const categorySelect = domRefs.categoryFilterSelect || domRefs.categoryFilter;
      categorySelect?.addEventListener('change', (event) => {
        applyCategoryFilter(event.target.value);
      });
      domRefs.viewGridBtn?.addEventListener('click', () => {
        state.viewMode = 'grid';
        persistViewModePreference(state.viewMode);
        domRefs.viewGridBtn?.classList.remove('text-zinc-600');
        domRefs.viewGridBtn?.classList.add('text-blue-500');
        domRefs.viewListBtn?.classList.remove('text-blue-500');
        domRefs.viewListBtn?.classList.add('text-zinc-600');
        renderGrid();
      });
      domRefs.viewListBtn?.addEventListener('click', () => {
        state.viewMode = 'list';
        persistViewModePreference(state.viewMode);
        domRefs.viewListBtn?.classList.remove('text-zinc-600');
        domRefs.viewListBtn?.classList.add('text-blue-500');
        domRefs.viewGridBtn?.classList.remove('text-blue-500');
        domRefs.viewGridBtn?.classList.add('text-zinc-600');
        renderGrid();
      });
      if (domRefs.sortSelect) {
        domRefs.sortSelect.value = state.sortMode;
        domRefs.sortSelect.addEventListener('change', (event) => {
          state.sortMode = String(event.target.value || 'date_desc');
          try { localStorage.setItem('assetSortMode', state.sortMode); } catch { /* ignore */ }
          renderGrid();
        });
      }
      domRefs.btnToggleSelect?.addEventListener('click', () => {
        state.selectionMode = !state.selectionMode;
        if (state.selectionMode) {
          domRefs.batchControls?.classList.remove('hidden');
          domRefs.selectionBar?.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
        } else {
          clearSelectionMode();
        }
        renderGrid();
        updateBatchUI();
      });
      domRefs.btnCancelSelect?.addEventListener('click', () => {
        clearSelectionMode();
        renderGrid();
      });
    }

    return {
      bindUiEvents,
      renderGrid,
      getTileEntryByItemId,
      refreshVisibleTileActionStates,
    };
  }

  global.AvatoolRenderAssetList = {
    createRenderAssetList,
  };
})(window);
