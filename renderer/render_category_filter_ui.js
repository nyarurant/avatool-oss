(function attachRenderCategoryFilterUi(global) {
  function createRenderCategoryFilterUi(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const esc = deps?.esc;
    const getAssetByItemId = deps?.getAssetByItemId;
    const showTransientMessage = deps?.showTransientMessage;
    const renderGrid = (...args) => deps?.renderGrid(...args);
    const giftCategoryKey = deps?.giftCategoryKey;
    const giftCategoryLabel = deps?.giftCategoryLabel;
    const freeDownloadCategoryKey = deps?.freeDownloadCategoryKey;
    const freeDownloadCategoryLabel = deps?.freeDownloadCategoryLabel;
    const doc = deps?.document || global.document;

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

    function matchesSearch(asset, query) {
      const raw = String(query || '').trim();
      if (!raw) return true;

      const avatarOnly = raw.match(/^(?:avatar|av|ava):\s*(.*)$/i);
      if (avatarOnly) {
        const aq = String(avatarOnly[1] || '').trim().toLowerCase();
        if (!aq) return true;
        const avatarPool = [
          ...(Array.isArray(asset.supportedAvatars) ? asset.supportedAvatars : []),
          ...(Array.isArray(asset.supportedAvatarsInferred) ? asset.supportedAvatarsInferred : []),
        ];
        return avatarPool.some((n) => String(n || '').toLowerCase().includes(aq));
      }

      const q = raw.toLowerCase();
      if ((asset.title || '').toLowerCase().includes(q)) return true;
      if ((asset.nameAliases || []).some((n) => String(n || '').toLowerCase().includes(q))) return true;
      if ((asset.supportedAvatars || []).some((n) => String(n || '').toLowerCase().includes(q))) return true;
      if ((asset.supportedAvatarsInferred || []).some((n) => String(n || '').toLowerCase().includes(q))) return true;
      if ((asset.author || '').toLowerCase().includes(q)) return true;
      if (getCategoryDisplayText(asset.primaryCategory, '').toLowerCase().includes(q)) return true;
      if ((asset.files || []).some((f) => (f.fileName || '').toLowerCase().includes(q))) return true;
      if ((asset.categories || []).some((c) => getCategoryDisplayText(c, '').toLowerCase().includes(q))) return true;
      if ((asset.userTags || []).some((t) => String(t || '').toLowerCase().includes(q))) return true;
      if ((asset.userNote || '').toLowerCase().includes(q)) return true;
      return false;
    }

    function applyCategoryFilter(slug) {
      state.currentCategory = slug || 'all';
      if (domRefs.categoryFilterSelect) {
        domRefs.categoryFilterSelect.value = state.currentCategory;
      }
      if (domRefs.categoryList) {
        domRefs.categoryList.querySelectorAll('.nav-item').forEach((el) => {
          el.classList.toggle('active', el.dataset.cat === state.currentCategory);
        });
      }
      renderGrid();
    }

    function buildCategoryOptions(assets) {
      const select = domRefs.categoryFilterSelect || domRefs.categoryFilter;
      const list = domRefs.categoryList;
      if (!select && !list) return;

      const allCats = new Map();
      const ensureCategory = (c) => {
        if (!c) return null;
        const key = c.slug || c.text || c.href;
        if (!key) return null;
        if (!allCats.has(key)) {
          allCats.set(key, {
            slug: c.slug || key,
            text: getCategoryDisplayText(c, decodeCategorySlugLabel(c.slug || key) || key),
            count: 0,
          });
        }
        return key;
      };
      assets.forEach((a) => {
        // Count each asset at most once per category (avoid primary/categories double count).
        const seenKeys = new Set();
        const primaryKey = ensureCategory(a.primaryCategory);
        if (primaryKey) seenKeys.add(primaryKey);
        (a.categories || []).forEach((c) => {
          const key = ensureCategory(c);
          if (key) seenKeys.add(key);
        });
        seenKeys.forEach((k) => {
          const row = allCats.get(k);
          if (row) row.count += 1;
        });
      });
      const giftCount = assets.filter((a) => Boolean(a?.isGift)).length;
      const freeDownloadCount = assets.filter((a) => Boolean(a?.isFreeDownload)).length;

      if (select) select.innerHTML = '';

      // "All" option
      if (select) {
        const optAll = doc.createElement('option');
        optAll.value = domRefs.categoryFilterSelect ? '__ALL__' : 'all';
        optAll.textContent = domRefs.categoryFilterSelect ? '全カテゴリ' : `すべて (${assets.length})`;
        select.appendChild(optAll);
      }

      // Category options
      const isGeneric3DModelCategory = (c) => {
        const t = String(c?.text || '').trim().toLowerCase();
        const s = String(c?.slug || '').trim().toLowerCase();
        return (
          t === '3dモデル' ||
          t === '3d model' ||
          s === '3d-model' ||
          s === '3dmodel' ||
          s === '3d_models' ||
          s === '3d-models'
        );
      };

      const sortedCats = Array.from(allCats.values())
        .filter((c) => !isGeneric3DModelCategory(c))
        .sort((a, b) => (a.text || '').localeCompare(b.text || '', 'ja'));
      sortedCats.forEach((c) => {
        if (select) {
          const opt = doc.createElement('option');
          opt.value = c.slug || c.text;
          opt.textContent = domRefs.categoryFilterSelect
            ? (c.text || c.slug)
            : `${c.text || c.slug} (${c.count})`;
          select.appendChild(opt);
        }
      });

      if (list) {
        list.innerHTML = '';
        const mkBtn = (value, label) => {
          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = 'nav-item w-full text-left';
          btn.dataset.cat = value;
          btn.textContent = label;
          btn.addEventListener('click', () => applyCategoryFilter(value));
          return btn;
        };
        list.appendChild(mkBtn('__ALL__', `すべてのアイテム (${assets.length})`));
        sortedCats.forEach((c) => {
          const value = c.slug || c.text;
          const label = `${c.text || c.slug} (${c.count})`;
          list.appendChild(mkBtn(value, label));
        });
        if (giftCount > 0) {
          list.appendChild(mkBtn(giftCategoryKey, `${giftCategoryLabel} (${giftCount})`));
        }
        if (freeDownloadCount > 0) {
          list.appendChild(mkBtn(freeDownloadCategoryKey, `${freeDownloadCategoryLabel} (${freeDownloadCount})`));
        }
      }

      if (giftCount > 0 && select) {
        const optGift = doc.createElement('option');
        optGift.value = giftCategoryKey;
        optGift.textContent = domRefs.categoryFilterSelect
          ? giftCategoryLabel
          : `${giftCategoryLabel} (${giftCount})`;
        select.appendChild(optGift);
      }
      if (freeDownloadCount > 0 && select) {
        const optFree = doc.createElement('option');
        optFree.value = freeDownloadCategoryKey;
        optFree.textContent = domRefs.categoryFilterSelect
          ? freeDownloadCategoryLabel
          : `${freeDownloadCategoryLabel} (${freeDownloadCount})`;
        select.appendChild(optFree);
      }
    }

    function applyViewFilter(view) {
      state.viewFilter = view || 'all';
      renderGrid();
    }

    function syncImportModeUI() {
      const active = Boolean(state.selectionMode);
      if (domRefs.btnToggleSelect) {
        domRefs.btnToggleSelect.classList.add('whitespace-nowrap', 'shrink-0');
        domRefs.btnToggleSelect.textContent = active ? '一括インポート終了' : '一括インポート';
        domRefs.btnToggleSelect.classList.remove('btn-primary');
        if (active) {
          domRefs.btnToggleSelect.classList.add('bg-amber-600', 'hover:bg-amber-500', 'text-white');
        } else {
          domRefs.btnToggleSelect.classList.remove('bg-amber-600', 'hover:bg-amber-500', 'text-white');
          domRefs.btnToggleSelect.classList.add('btn-primary');
        }
      }
      if (domRefs.importModeIndicator) {
        const text = active
          ? `インポートモード: ${state.selectedItems.size}件選択中`
          : '通常モード';
        const dotClass = active ? 'bg-amber-400' : 'bg-zinc-500';
        const textClass = active ? 'text-amber-300' : 'text-zinc-400';
        domRefs.importModeIndicator.className = 'text-[10px] font-mono-custom inline-flex items-center gap-1.5 select-none pointer-events-none whitespace-nowrap shrink-0';
        domRefs.importModeIndicator.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${dotClass}"></span><span class="${textClass}">${esc(text)}</span>`;
      }
    }

    function updateBatchUI() {
      if (domRefs.selectedCount) domRefs.selectedCount.textContent = `${state.selectedItems.size}`;
      if (domRefs.btnBatchImport) domRefs.btnBatchImport.disabled = state.selectedItems.size === 0;
      syncImportModeUI();
    }

    function clearSelectionMode() {
      state.selectionMode = false;
      state.selectedItems.clear();
      if (domRefs.batchControls) domRefs.batchControls.classList.add('hidden');
      if (domRefs.selectionBar) {
        domRefs.selectionBar.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
      }
      updateBatchUI();
    }

    function toggleSelection(itemId, checkboxEl) {
      const id = String(itemId);
      const asset = getAssetByItemId(id);
      if (!asset?.downloaded) {
        const now = Date.now();
        if ((now - Number(state.lastUndownloadedSelectWarnAt || 0)) > 1200) {
          state.lastUndownloadedSelectWarnAt = now;
          showTransientMessage('この項目は未ダウンロードです。先にダウンロードしてから選択してください。', 'error');
        }
        return false;
      }
      const mark = checkboxEl?.querySelector('.check-mark');
      if (state.selectedItems.has(id)) {
        state.selectedItems.delete(id);
        mark?.classList.add('hidden');
        checkboxEl?.classList.remove('border-blue-500', 'bg-blue-900/30');
      } else {
        state.selectedItems.add(id);
        mark?.classList.remove('hidden');
        checkboxEl?.classList.add('border-blue-500', 'bg-blue-900/30');
      }
      updateBatchUI();
      return true;
    }

    return {
      matchesSearch,
      decodeCategorySlugLabel,
      getCategoryDisplayText,
      buildCategoryOptions,
      applyCategoryFilter,
      applyViewFilter,
      updateBatchUI,
      syncImportModeUI,
      clearSelectionMode,
      toggleSelection,
    };
  }

  global.AvatoolRenderCategoryFilterUi = {
    createRenderCategoryFilterUi,
  };
})(window);
