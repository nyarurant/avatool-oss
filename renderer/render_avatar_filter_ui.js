(function attachRenderAvatarFilterUi(global) {
  function createRenderAvatarFilterUi(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const esc = deps?.esc;
    const logAvatarDebug = deps?.logAvatarDebug;
    const getAssetAvatarPool = deps?.getAssetAvatarPool;
    const avatarComparableKeys = deps?.avatarComparableKeys;
    const normalizeAvatarFilterValue = deps?.normalizeAvatarFilterValue;
    const buildAvatarImageMap = deps?.buildAvatarImageMap;
    const hasAvatarDetailedAnalysisResult = deps?.hasAvatarDetailedAnalysisResult;
    const refreshAvatarAnalysisUI = deps?.refreshAvatarAnalysisUI;
    const showTransientMessage = (...args) => deps?.showTransientMessage(...args);
    const showAvatarFilterAnalysisPromptModal = (...args) => deps?.showAvatarFilterAnalysisPromptModal(...args);
    const renderGrid = (...args) => deps?.renderGrid(...args);
    const doc = deps?.document || global.document;

    let avatarDebugLastSignature = '';
    let avatarFilterGlobalDismissBound = false;

    function setAvatarFilterPanelOpen(open) {
      const panel = doc.getElementById('avatar-filter-panel');
      const button = doc.getElementById('avatar-filter-button');
      const chevron = doc.getElementById('avatar-filter-chevron');
      const next = Boolean(open);
      state.avatarFilterPanelOpen = next;
      if (panel) panel.classList.toggle('hidden', !next);
      if (button) button.setAttribute('aria-expanded', next ? 'true' : 'false');
      if (chevron) chevron.classList.toggle('rotate-180', next);
    }

    function getAvatarDisplayName(name) {
      const raw = String(name || '').trim();
      return String(state.avatarLabelMap?.get(raw) || raw).trim() || raw;
    }

    function syncAvatarFilterUI() {
      const label = doc.getElementById('avatar-filter-label');
      const img = doc.getElementById('avatar-filter-img');
      const panel = doc.getElementById('avatar-filter-panel');
      const button = doc.getElementById('avatar-filter-button');
      const filters = Array.isArray(state.avatarFilters) && state.avatarFilters.length ? state.avatarFilters : (state.avatarFilter ? [state.avatarFilter] : []);
      const filterLabel = filters.length > 1
        ? filters.map((name) => getAvatarDisplayName(name)).join('・')
        : (filters[0] ? getAvatarDisplayName(filters[0]) : 'アバターで絞り込み');
      if (label) label.textContent = filterLabel;
      if (img) {
        const imgSrc = filters.length ? (state.avatarImageMap?.get(filters[0]) || '') : '';
        if (imgSrc) {
          img.onerror = () => { img.classList.add('hidden'); };
          img.src = imgSrc;
          img.classList.remove('hidden');
        } else {
          img.removeAttribute('src');
          img.classList.add('hidden');
        }
      }
      if (panel) {
        panel.querySelectorAll('[data-value]').forEach((opt) => {
          const isSelected = opt.dataset.value === '' ? !filters.length : filters.includes(opt.dataset.value);
          if (opt.classList.contains('avatar-grid-item')) {
            opt.classList.toggle('bg-white/8', isSelected);
            const thumb = opt.querySelector('.avatar-grid-thumb');
            if (thumb) thumb.classList.toggle('ring-2', isSelected);
            if (thumb) thumb.classList.toggle('ring-blue-500', isSelected);
            if (thumb) thumb.classList.toggle('border-blue-500/50', isSelected);
            const check = opt.querySelector('.avatar-grid-check');
            if (check) check.classList.toggle('opacity-0', !isSelected);
            if (check) check.classList.toggle('opacity-100', isSelected);
            const itemLabel = opt.querySelector('.avatar-grid-label');
            if (itemLabel) itemLabel.classList.toggle('text-zinc-200', isSelected);
            if (itemLabel) itemLabel.classList.toggle('text-zinc-400', !isSelected);
          } else {
            opt.classList.toggle('bg-white/10', isSelected);
            opt.classList.toggle('text-zinc-200', isSelected);
          }
        });
      }
      if (button) {
        button.classList.toggle('border-blue-500/50', Boolean(filters.length));
      }
    }

    function ensureAvatarFilterSelect() {
      if (domRefs.avatarFilterSelect && doc.body.contains(domRefs.avatarFilterSelect)) {
        return domRefs.avatarFilterSelect;
      }
      if (!domRefs.searchInput) return null;

      const searchWrap = domRefs.searchInput.parentElement;
      if (searchWrap) {
        searchWrap.classList.add('flex', 'items-center', 'gap-2', 'w-full', 'max-w-[860px]');
        if (searchWrap.classList.contains('max-w-md')) searchWrap.classList.remove('max-w-md');
        domRefs.searchInput.classList.remove('w-full');
        domRefs.searchInput.classList.add('min-w-0', 'flex-1');
      }

      const wrap = doc.createElement('div');
      wrap.id = 'avatar-filter-wrap';
      wrap.className = 'relative min-w-[190px] max-w-[320px] shrink-0';

      const select = doc.createElement('select');
      select.id = 'avatar-filter-select';
      select.className = 'hidden';
      select.setAttribute('aria-hidden', 'true');
      select.setAttribute('tabindex', '-1');
      select.innerHTML = '<option value="">アバター絞り込み</option>';

      const button = doc.createElement('button');
      button.type = 'button';
      button.id = 'avatar-filter-button';
      button.className = 'h-10 w-full bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-[12px] text-zinc-200 outline-none transition-all flex items-center gap-2';
      button.setAttribute('title', '対応アバターで絞り込み');
      button.setAttribute('aria-haspopup', 'listbox');
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = `
        <img id="avatar-filter-img" class="hidden w-6 h-6 rounded-md object-cover shrink-0 border border-white/10" alt="">
        <span id="avatar-filter-label" class="flex-1 min-w-0 text-left truncate">アバター絞り込み</span>
        <svg id="avatar-filter-chevron" class="w-4 h-4 text-zinc-400 transition-transform" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M5 7.5L10 12.5L15 7.5" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `;

      const panel = doc.createElement('div');
      panel.id = 'avatar-filter-panel';
      panel.className = 'hidden absolute right-0 top-[calc(100%+8px)] z-[120] overflow-auto rounded-xl border border-white/10 bg-[#0b0c10] p-1.5 shadow-2xl';
      panel.style.cssText = 'width:400px;max-height:480px;';

      const anchor = domRefs.searchInput;
      const parent = anchor.parentElement;
      if (parent && parent.appendChild) {
        wrap.appendChild(select);
        wrap.appendChild(button);
        wrap.appendChild(panel);
        parent.appendChild(wrap);
      } else {
        wrap.appendChild(select);
        wrap.appendChild(button);
        wrap.appendChild(panel);
        anchor.insertAdjacentElement('afterend', wrap);
      }

      if (!avatarFilterGlobalDismissBound) {
        doc.addEventListener('click', (e) => {
          const currentWrap = doc.getElementById('avatar-filter-wrap');
          if (!currentWrap) return;
          const target = e.target;
          const inside = target instanceof Node && currentWrap.contains(target);
          if (!inside) setAvatarFilterPanelOpen(false);
        });
        avatarFilterGlobalDismissBound = true;
      }

      domRefs.avatarFilterSelect = select;
      domRefs.avatarFilterToggle = button;
      domRefs.avatarFilterPanel = panel;
      bindAvatarFilterFallbackEvents();
      syncAvatarFilterUI();
      return select;
    }

    function refreshAvatarFilterOptions(assets = []) {
      const select = ensureAvatarFilterSelect();
      if (!select) return;

      // Build a normalization map: for avatar items whose pool is Latin-only, map the
      // Latin name → Japanese nameVariant so both sides collapse to one filter entry.
      const avatarLatinToJaMap = new Map();
      for (const asset of (Array.isArray(assets) ? assets : [])) {
        if (!asset?.isAvatarItem) continue;
        const nv = asset.nameVariants || {};
        const jaName = String(
          (Array.isArray(nv.katakana) && nv.katakana[0]) ||
          (Array.isArray(nv.hiragana) && nv.hiragana[0]) || ''
        ).trim();
        if (!jaName) continue;
        for (const poolName of getAssetAvatarPool(asset)) {
          if (/^[a-z0-9\-\s_.,'!?/]+$/i.test(poolName) && poolName !== jaName) {
            avatarLatinToJaMap.set(poolName, jaName);
          }
        }
      }

      const allNames = [];
      for (const asset of (Array.isArray(assets) ? assets : [])) {
        for (const n of getAssetAvatarPool(asset)) {
          allNames.push(avatarLatinToJaMap.get(n) || n);
        }
      }
      const normalizedNames = Array.from(new Set(
        allNames.map((n) => String(n || '').trim()).filter(Boolean)
      ));
      const groupedNames = [];
      const keyToGroupIndex = new Map();
      for (const name of normalizedNames) {
        const keys = avatarComparableKeys(name);
        if (!keys.length) {
          groupedNames.push({ names: [name], keys: new Set() });
          continue;
        }
        const groupIndexes = Array.from(new Set(
          keys.map((key) => keyToGroupIndex.get(key)).filter((index) => Number.isInteger(index))
        ));
        if (!groupIndexes.length) {
          const nextIndex = groupedNames.length;
          groupedNames.push({ names: [name], keys: new Set(keys) });
          keys.forEach((key) => keyToGroupIndex.set(key, nextIndex));
          continue;
        }
        const targetIndex = groupIndexes[0];
        const target = groupedNames[targetIndex];
        if (!target.names.includes(name)) target.names.push(name);
        keys.forEach((key) => target.keys.add(key));
        for (let i = groupIndexes.length - 1; i >= 1; i -= 1) {
          const sourceIndex = groupIndexes[i];
          const source = groupedNames[sourceIndex];
          if (!source) continue;
          for (const sourceName of source.names) {
            if (!target.names.includes(sourceName)) target.names.push(sourceName);
          }
          for (const sourceKey of source.keys) target.keys.add(sourceKey);
          groupedNames.splice(sourceIndex, 1);
          for (const [key, index] of keyToGroupIndex.entries()) {
            if (index === sourceIndex) keyToGroupIndex.set(key, targetIndex);
            else if (index > sourceIndex) keyToGroupIndex.set(key, index - 1);
          }
        }
        target.keys.forEach((key) => keyToGroupIndex.set(key, targetIndex));
      }
      const rankAvatarFilterName = (name) => {
        const hasJapanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(name);
        const hasLatin = /[A-Za-z]/.test(name);
        if (hasJapanese && !hasLatin) return 0;
        if (hasJapanese) return 1;
        return 2;
      };
      const unique = groupedNames
        .map((group) => group.names.slice().sort((a, b) => {
          const rankDiff = rankAvatarFilterName(a) - rankAvatarFilterName(b);
          if (rankDiff !== 0) return rankDiff;
          const lengthDiff = a.length - b.length;
          if (lengthDiff !== 0) return lengthDiff;
          return a.localeCompare(b, 'ja');
        })[0])
        .sort((a, b) => a.localeCompare(b, 'ja'));
      const assetsCount = Array.isArray(assets) ? assets.length : 0;
      const withAvatar = (Array.isArray(assets) ? assets : []).filter((a) => getAssetAvatarPool(a).length > 0).length;
      const sig = `${assetsCount}:${withAvatar}:${unique.length}`;
      if (sig !== avatarDebugLastSignature) {
        avatarDebugLastSignature = sig;
        logAvatarDebug('refreshAvatarFilterOptions', {
          assetsCount,
          assetsWithAvatar: withAvatar,
          uniqueAvatarCount: unique.length,
          sample: unique.slice(0, 10),
        });
      }

      const prev = normalizeAvatarFilterValue(state.avatarFilter);
      const analyzed = hasAvatarDetailedAnalysisResult();
      state.avatarImageMap = buildAvatarImageMap(assets);
      const frag = doc.createDocumentFragment();
      const optAll = doc.createElement('option');
      optAll.value = '';
      state.avatarFilterAllLabel = unique.length > 0
        ? '絞り込みを解除'
        : (analyzed ? 'アバター未検出' : 'アバター絞り込み（要解析）');
      optAll.textContent = state.avatarFilterAllLabel;
      frag.appendChild(optAll);
      if (!unique.length && !analyzed) {
        const optAnalyze = doc.createElement('option');
        optAnalyze.value = '__ANALYZE_REQUIRED__';
        optAnalyze.textContent = '解析を実行...';
        frag.appendChild(optAnalyze);
      }
      for (const name of unique) {
        const opt = doc.createElement('option');
        opt.value = name;
        opt.textContent = getAvatarDisplayName(name);
        frag.appendChild(opt);
      }
      select.innerHTML = '';
      select.appendChild(frag);
      select.disabled = false;

      const panel = doc.getElementById('avatar-filter-panel');
      if (panel) {
        const header = [];
        header.push(`
          <button type="button" data-value="" class="w-full px-3 py-2 rounded-lg text-left text-[12px] text-zinc-400 hover:bg-white/15 hover:text-zinc-200 transition-colors flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            <span>${esc(state.avatarFilterAllLabel)}</span>
          </button>
        `);
        if (!unique.length && !analyzed) {
          header.push(`
          <button type="button" data-value="__ANALYZE_REQUIRED__" class="w-full px-3 py-2 rounded-lg text-left text-[12px] text-amber-300 hover:bg-amber-500/10 transition-colors flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>解析を実行...</span>
          </button>
        `);
        }
        const gridItems = unique.map((name) => {
          const image = state.avatarImageMap?.get(name) || '';
          const displayName = getAvatarDisplayName(name);
          return `
            <button type="button" data-value="${esc(name)}" class="avatar-grid-item flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-white/15 transition-colors text-center group">
              <div class="avatar-grid-thumb relative w-full aspect-square rounded-xl overflow-hidden border border-white/10 bg-white/5 shrink-0 transition-all group-hover:border-white/30 group-hover:scale-[1.04]">
                ${image
                  ? `<img src="${esc(image)}" class="w-full h-full object-cover" alt="">`
                  : `<div class="w-full h-full flex items-center justify-center text-zinc-600"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>`}
                <div class="avatar-grid-check absolute inset-0 bg-blue-500/30 flex items-center justify-center opacity-0 transition-opacity">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </div>
              <span class="avatar-grid-label text-[11px] text-zinc-400 group-hover:text-zinc-200 truncate w-full leading-tight transition-colors" title="${esc(displayName)}">${esc(displayName)}</span>
            </button>
          `;
        });
        panel.innerHTML = `
          <div class="mb-1">${header.join('')}</div>
          ${unique.length ? `<div class="h-px bg-white/5 mx-1 mb-2"></div><div class="grid grid-cols-3 gap-1">${gridItems.join('')}</div>` : ''}
        `;
        panel.querySelectorAll('[data-value=""], [data-value="__ANALYZE_REQUIRED__"]').forEach((btn) => {
          btn.addEventListener('mouseenter', () => { btn.style.backgroundColor = 'rgba(255,255,255,0.1)'; btn.style.color = '#e4e4e7'; });
          btn.addEventListener('mouseleave', () => { btn.style.backgroundColor = ''; btn.style.color = ''; });
        });
        panel.querySelectorAll('.avatar-grid-item').forEach((btn) => {
          btn.querySelectorAll('img').forEach((img) => {
            img.addEventListener('error', () => { img.style.display = 'none'; });
          });
          const thumb = btn.querySelector('.avatar-grid-thumb');
          const label = btn.querySelector('.avatar-grid-label');
          btn.addEventListener('mouseenter', () => {
            btn.style.backgroundColor = 'rgba(255,255,255,0.12)';
            if (thumb) thumb.style.transform = 'scale(1.05)';
            if (thumb) thumb.style.borderColor = 'rgba(255,255,255,0.3)';
            if (label) label.style.color = '#e4e4e7';
          });
          btn.addEventListener('mouseleave', () => {
            btn.style.backgroundColor = '';
            if (thumb) thumb.style.transform = '';
            if (thumb) thumb.style.borderColor = '';
            if (label) label.style.color = '';
          });
        });
      }

      const prevKeys = new Set(avatarComparableKeys(prev));
      const matchedPrev = prev && unique.length > 0
        ? unique.find((name) => avatarComparableKeys(name).some((key) => prevKeys.has(key)))
        : '';
      if (matchedPrev) {
        select.value = matchedPrev;
        state.avatarFilter = matchedPrev;
      } else {
        select.value = '';
        state.avatarFilter = '';
        state.avatarFilters = [];
      }
      syncAvatarFilterUI();
    }

    async function handleAnalyzeAvatarCompatButtonClick() {
      const downloadedAssets = (Array.isArray(state.allAssets) ? state.allAssets : [])
        .filter((asset) => asset.downloaded);
      if (downloadedAssets.length === 0) {
        showTransientMessage('ダウンロード済みのアイテムがありません。', 'info');
        return;
      }
      const unanalyzedIds = downloadedAssets
        .filter((asset) => !String(asset?.avatarAnalysisCheckedAt || '').trim())
        .map((asset) => asset.itemId);
      if (unanalyzedIds.length > 0) {
        await refreshAvatarAnalysisUI({ onlyItemIds: unanalyzedIds });
      } else {
        // All items already analyzed — re-analyze everything.
        const allIds = downloadedAssets.map((asset) => asset.itemId);
        await refreshAvatarAnalysisUI({ onlyItemIds: allIds });
      }
    }

    async function handleAvatarFilterSelectionChange(selectValue, { closePanelOnComplete = true } = {}) {
      const select = domRefs.avatarFilterSelect || doc.getElementById('avatar-filter-select');
      if (!select) return;
      const next = normalizeAvatarFilterValue(selectValue || '');
      const prev = normalizeAvatarFilterValue(state.avatarFilter || '');
      const needsAnalyze = next === '__ANALYZE_REQUIRED__' || (next && !hasAvatarDetailedAnalysisResult());
      if (needsAnalyze) {
        if (state.avatarFilterPromptBusy) return;
        state.avatarFilterPromptBusy = true;
        try {
          const analyzed = await showAvatarFilterAnalysisPromptModal();
          if (!analyzed) {
            if (select.value !== prev) select.value = prev;
            syncAvatarFilterUI();
            return;
          }
          select.value = '';
          state.avatarFilter = '';
          state.avatarFilters = [];
          setAvatarFilterPanelOpen(false);
          syncAvatarFilterUI();
          renderGrid();
          return;
        } finally {
          state.avatarFilterPromptBusy = false;
        }
      }
      if (select.value !== next) select.value = next;
      if (prev !== next) {
        state.avatarFilter = next;
        syncAvatarFilterUI();
        renderGrid();
      } else {
        syncAvatarFilterUI();
      }
      if (closePanelOnComplete) setAvatarFilterPanelOpen(false);
    }

    function bindAnalyzeAvatarCompatButtonFallback() {
      const button = domRefs.analyzeAvatarCompatBtn;
      if (!button || button.dataset.avatoolAnalyzeBound === '1') return;
      button.dataset.avatoolAnalyzeBound = '1';
      button.addEventListener('click', async () => {
        await handleAnalyzeAvatarCompatButtonClick();
      });
    }

    function bindAvatarFilterFallbackEvents() {
      const avatarSelect = domRefs.avatarFilterSelect || doc.getElementById('avatar-filter-select');
      const avatarPanel = domRefs.avatarFilterPanel || doc.getElementById('avatar-filter-panel');
      const avatarToggle = domRefs.avatarFilterToggle || doc.getElementById('avatar-filter-button');
      if (!avatarSelect || !avatarPanel || !avatarToggle) return;
      if (avatarToggle.dataset.avatoolAvatarFilterBound === '1') return;
      avatarToggle.dataset.avatoolAvatarFilterBound = '1';
      avatarPanel.dataset.avatoolAvatarFilterBound = '1';
      avatarSelect.dataset.avatoolAvatarFilterBound = '1';

      avatarToggle.addEventListener('click', async () => {
        const next = normalizeAvatarFilterValue(avatarSelect.value || '');
        if (next === '__ANALYZE_REQUIRED__' || (next && !hasAvatarDetailedAnalysisResult())) {
          await handleAvatarFilterSelectionChange(next, { closePanelOnComplete: true });
          return;
        }
        setAvatarFilterPanelOpen(!state.avatarFilterPanelOpen);
      });

      avatarPanel.addEventListener('click', async (event) => {
        const button = event.target?.closest?.('[data-value]');
        if (!button) return;
        const next = normalizeAvatarFilterValue(button.dataset.value || '');
        const needsAnalyze = next === '__ANALYZE_REQUIRED__' || (next && !hasAvatarDetailedAnalysisResult());
        if (needsAnalyze) {
          await handleAvatarFilterSelectionChange(next, { closePanelOnComplete: true });
          return;
        }
        if (next === '') {
          state.avatarFilters = [];
          state.avatarFilter = '';
          if (avatarSelect) avatarSelect.value = '';
          setAvatarFilterPanelOpen(false);
        } else {
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
        await handleAvatarFilterSelectionChange(event?.target?.value || '', { closePanelOnComplete: true });
      });
    }

    return {
      setAvatarFilterPanelOpen,
      getAvatarDisplayName,
      syncAvatarFilterUI,
      ensureAvatarFilterSelect,
      refreshAvatarFilterOptions,
      handleAnalyzeAvatarCompatButtonClick,
      handleAvatarFilterSelectionChange,
      bindAnalyzeAvatarCompatButtonFallback,
      bindAvatarFilterFallbackEvents,
    };
  }

  global.AvatoolRenderAvatarFilterUi = {
    createRenderAvatarFilterUi,
  };
})(window);
