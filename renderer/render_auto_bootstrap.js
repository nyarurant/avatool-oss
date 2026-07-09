(function attachRenderAutoBootstrap(global) {
  function createRenderAutoBootstrap(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const boothAPI = deps?.boothAPI;
    const esc = deps?.esc || ((value) => String(value || ''));
    const showTransientMessage = deps?.showTransientMessage;
    const pathBasename = deps?.pathBasename || ((value) => String(value || ''));
    const syncDownloadStateFromLatestMapNoRerender = deps?.syncDownloadStateFromLatestMapNoRerender;
    let ipcEventsBound = false;

    if (!state || !boothAPI || typeof showTransientMessage !== 'function') {
      throw new Error('createRenderAutoBootstrap requires state, boothAPI, and UI helpers.');
    }

    function closeAutoBootstrapModal() {
      closeRuleItemPickerModal();
      domRefs.autoBootstrapModal?.classList.add('hidden');
      domRefs.autoBootstrapModal?.classList.remove('flex');
    }

    function syncAutoBootstrapScriptDependencyUi() {
      const avatoolEnabled = Boolean(domRefs.autoBootstrapIncludeAvatoolScripts?.checked);
      const simpleFolderIcon = domRefs.autoBootstrapIncludeSimpleFolderIcon;
      if (!simpleFolderIcon) return;
      if (!avatoolEnabled) {
        simpleFolderIcon.checked = false;
      }
      simpleFolderIcon.disabled = !avatoolEnabled;
      simpleFolderIcon.title = avatoolEnabled
        ? ''
        : 'Avatool 独自Scriptを導入 が OFF の場合は選択できません。';
      const row = simpleFolderIcon.closest('.setting-row');
      if (row) row.classList.toggle('opacity-50', !avatoolEnabled);
    }

    function closeRuleItemPickerModal() {
      const modal = document.getElementById('rule-item-picker-modal');
      modal?.classList.add('hidden');
      modal?.classList.remove('flex');
    }

    function openRuleItemPickerModal({ items = [], selectedKeys = [], onApply } = {}) {
      const modal = document.getElementById('rule-item-picker-modal');
      const grid = document.getElementById('rule-item-picker-grid');
      const searchInput = document.getElementById('rule-item-picker-search');
      const sortSelect = document.getElementById('rule-item-picker-sort');
      const countEl = document.getElementById('rule-item-picker-count');
      const applyBtn = document.getElementById('rule-item-picker-apply');
      const cancelBtn = document.getElementById('rule-item-picker-cancel');
      if (!modal || !grid) return;
      if (searchInput) searchInput.value = '';
      if (sortSelect) sortSelect.value = 'selected';
      const selectedSet = new Set((Array.isArray(selectedKeys) ? selectedKeys : []).map((key) => String(key || '').trim()).filter(Boolean));

      const getItemName = (item) => String(item?.itemTitle || item?.label || item?.key || '');
      const getItemIdNumber = (item) => {
        const n = Number(String(item?.itemId || '').replace(/[^\d.-]/g, ''));
        return Number.isFinite(n) ? n : 0;
      };
      const updateCount = () => {
        if (countEl) countEl.textContent = `${selectedSet.size}件選択中`;
        if (applyBtn) applyBtn.disabled = selectedSet.size === 0;
      };
      const renderItems = () => {
        const query = String(searchInput?.value || '').trim().toLowerCase();
        const sortMode = String(sortSelect?.value || 'selected');
        let rows = [...items];
        if (query) {
          rows = rows.filter((item) => {
            const haystack = [
              getItemName(item),
              item?.label,
              item?.key,
              item?.itemId,
            ].map((value) => String(value || '').toLowerCase()).join(' ');
            return haystack.includes(query);
          });
        }
        rows.sort((a, b) => {
          const aSelected = selectedSet.has(String(a?.key || '').trim());
          const bSelected = selectedSet.has(String(b?.key || '').trim());
          if (sortMode === 'selected' && aSelected !== bSelected) return aSelected ? -1 : 1;
          if (sortMode === 'newest') return getItemIdNumber(b) - getItemIdNumber(a);
          if (sortMode === 'oldest') return getItemIdNumber(a) - getItemIdNumber(b);
          return getItemName(a).localeCompare(getItemName(b), 'ja');
        });
        grid.innerHTML = '';
        if (!rows.length) {
          const empty = document.createElement('div');
          empty.className = 'rule-picker-empty';
          empty.textContent = query ? '一致するアイテムがありません' : 'アイテムなし';
          grid.appendChild(empty);
          return;
        }
        for (const item of rows) {
          const opt = document.createElement('button');
          opt.type = 'button';
          const key = String(item.key || '').trim();
          opt.className = 'rule-item-opt' + (selectedSet.has(key) ? ' selected' : '');
          const thumb = document.createElement('div');
          thumb.className = 'rule-item-opt-thumb';
          if (item.previewUrl) {
            const img = document.createElement('img');
            img.src = String(item.previewUrl);
            thumb.appendChild(img);
          } else {
            thumb.textContent = '?';
          }
          const name = document.createElement('span');
          name.className = 'rule-item-opt-name';
          name.textContent = getItemName(item);
          opt.appendChild(thumb);
          opt.appendChild(name);
          opt.addEventListener('click', () => {
            if (!key) return;
            if (selectedSet.has(key)) selectedSet.delete(key);
            else selectedSet.add(key);
            opt.classList.toggle('selected', selectedSet.has(key));
            updateCount();
          });
          grid.appendChild(opt);
        }
        updateCount();
      };
      if (searchInput) searchInput.oninput = renderItems;
      if (sortSelect) sortSelect.onchange = renderItems;
      if (applyBtn) {
        applyBtn.onclick = () => {
          const nextKeys = Array.from(selectedSet);
          const selectedItems = items.filter((item) => nextKeys.includes(String(item?.key || '').trim()));
          if (typeof onApply === 'function') onApply(selectedItems, nextKeys);
          closeRuleItemPickerModal();
        };
      }
      if (cancelBtn) cancelBtn.onclick = closeRuleItemPickerModal;
      renderItems();
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      setTimeout(() => searchInput?.focus(), 0);
    }

    function createProjectImportRuleRow(rule = {}) {
      const wrap = document.createElement('div');
      wrap.className = 'rule-card';
      const pattern = String(rule?.projectPattern || '').trim();
      const initialChoiceKeys = Array.from(new Set(
        (Array.isArray(rule?.choiceKeys) ? rule.choiceKeys : [rule?.choiceKey])
          .map((key) => String(key || '').trim())
          .filter(Boolean)
      ));
      const choiceKey = String(initialChoiceKeys[0] || '').trim();
      wrap.dataset.ruleChoiceKeys = JSON.stringify(initialChoiceKeys);
      wrap.dataset.ruleProjectPattern = pattern;
      const choices = Array.isArray(state.autoBootstrapRuleChoices) ? state.autoBootstrapRuleChoices : [];
      const items = choices.filter((choice) => String(choice?.type || '') === 'item');
      const files = choices.filter((choice) => String(choice?.type || '') === 'file');
      const fileMap = new Map();
      for (const file of files) {
        const id = String(file?.itemId || '').trim();
        if (!id) continue;
        if (!fileMap.has(id)) fileMap.set(id, []);
        fileMap.get(id).push(file);
      }
      const parseChoice = (value) => {
        const s = String(value || '').trim();
        if (s.startsWith('file:')) {
          const rest = s.slice(5);
          const idx = rest.indexOf(':');
          if (idx > 0) return { type: 'file', itemId: rest.slice(0, idx).trim(), key: s };
        }
        if (s.startsWith('item:')) return { type: 'item', itemId: s.slice(5).trim(), key: s };
        return { type: '', itemId: '', key: '' };
      };
      const trimToExtractedRelative = (pathValue) => {
        const norm = String(pathValue || '').replace(/\\/g, '/');
        const lower = norm.toLowerCase();
        const marker = '__extracted/';
        const idx = lower.indexOf(marker);
        if (idx >= 0) return norm.slice(idx + marker.length);
        return norm;
      };
      const parsed = parseChoice(choiceKey);
      const hasParsedItemInChoices = parsed.itemId
        ? items.some((item) => String(item?.itemId || '').trim() === parsed.itemId)
        : false;
      const itemsForSelect = hasParsedItemInChoices || !parsed.itemId
        ? items
        : [
            ...items,
            {
              key: `item:${parsed.itemId}`,
              type: 'item',
              itemId: parsed.itemId,
              itemTitle: `未検出アイテム (#${parsed.itemId})`,
              previewUrl: '',
              label: `[Item] 未検出アイテム (#${parsed.itemId})`,
            },
          ];
      const selectedItemIds = new Set(initialChoiceKeys.map((key) => parseChoice(key).itemId).filter(Boolean));
      const selectedItemId = parsed.itemId || String(items[0]?.itemId || '').trim();
      const itemOptionsHtml = itemsForSelect.map((item) => {
        const key = String(item.key || '');
        const label = String(item.itemTitle || item.label || item.key || '');
        const selected = selectedItemIds.has(String(item.itemId || '')) ? 'selected' : '';
        return `<option value="${esc(key)}" ${selected}>${esc(label)}</option>`;
      }).join('');

      // Build picker option elements (no inline handlers)
      const initItem = itemsForSelect.find((i) => String(i.itemId || '').trim() === selectedItemId);
      const initTitle = initialChoiceKeys.length > 1
        ? `${initialChoiceKeys.length} items selected`
        : String(initItem?.itemTitle || initItem?.label || '選択してください');
      const initPreview = String(initItem?.previewUrl || '').trim();

      wrap.innerHTML = `
        <div class="rule-card-header">
          <span class="rule-condition-label">Project contains</span>
          <input type="text" data-role="pattern" class="rule-pattern-input" placeholder="例: rurune" value="${esc(pattern)}" />
          <span class="rule-condition-label">then import</span>
          <button data-role="remove" class="rule-remove-btn" title="Remove rule" aria-label="Remove rule">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
        <div class="rule-card-body">
          <div>
            <div class="panel-label">アイテム</div>
            <div class="rule-picker" data-role="item-picker">
              <button class="rule-picker-btn" data-role="picker-trigger" type="button">
                <div class="rule-picker-thumb" data-role="picker-thumb">${initPreview ? `<img src="${esc(initPreview)}" />` : '?'}</div>
                <span class="rule-picker-text" data-role="picker-label">${esc(initTitle)}</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:#71717a"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            </div>
            <select data-role="item-choice" class="hidden">${itemOptionsHtml || '<option value="">アイテムなし</option>'}</select>
            <div data-role="selected-items" class="rule-selected-items"></div>
          </div>
          <div>
            <div class="panel-label">ファイル (任意)</div>
            <select data-role="file-choice" class="panel-input">
              <option value="__auto__">自動選択</option>
            </select>
            <div data-role="file-overrides" class="rule-file-overrides hidden"></div>
          </div>
          <div data-role="detail" class="rule-card-detail text-[10px] text-zinc-500"></div>
        </div>
      `;

      const itemSel = wrap.querySelector('select[data-role="item-choice"]');
      const fileSel = wrap.querySelector('select[data-role="file-choice"]');
      const fileOverrides = wrap.querySelector('[data-role="file-overrides"]');
      const detail = wrap.querySelector('[data-role="detail"]');
      const pickerTrigger = wrap.querySelector('[data-role="picker-trigger"]');
      const pickerThumb = wrap.querySelector('[data-role="picker-thumb"]');
      const pickerLabel = wrap.querySelector('[data-role="picker-label"]');
      const selectedItemsWrap = wrap.querySelector('[data-role="selected-items"]');
      let initialFileKey = parsed.type === 'file' ? parsed.key : '';
      let selectedChoiceKeys = initialChoiceKeys.length ? [...initialChoiceKeys] : (itemsForSelect[0]?.key ? [String(itemsForSelect[0].key)] : []);

      const getItemForChoiceKey = (key) => {
        const parsedKey = parseChoice(key);
        return itemsForSelect.find((item) => String(item.itemId || '').trim() === parsedKey.itemId) || null;
      };
      const updateSelectedItemsUi = () => {
        const selectedItems = selectedChoiceKeys.map(getItemForChoiceKey).filter(Boolean);
        wrap.dataset.ruleChoiceKeys = JSON.stringify(selectedChoiceKeys);
        if (itemSel) {
          itemSel.innerHTML = selectedChoiceKeys.map((key) => {
            const item = getItemForChoiceKey(key);
            const label = String(item?.itemTitle || item?.label || key);
            return `<option value="${esc(key)}" selected>${esc(label)}</option>`;
          }).join('');
        }
        if (pickerLabel) {
          pickerLabel.textContent = selectedItems.length > 1
            ? `${selectedItems.length} items selected`
            : String(selectedItems[0]?.itemTitle || selectedItems[0]?.label || '選択してください');
        }
        if (pickerThumb) {
          const preview = String(selectedItems[0]?.previewUrl || '').trim();
          pickerThumb.innerHTML = preview ? `<img src="${esc(preview)}" />` : String(selectedItems.length || '?');
        }
        if (selectedItemsWrap) {
          selectedItemsWrap.innerHTML = '';
          for (const item of selectedItems.slice(0, 6)) {
            const chip = document.createElement('span');
            chip.className = 'rule-selected-chip';
            const preview = String(item?.previewUrl || '').trim();
            if (preview) {
              const img = document.createElement('img');
              img.src = preview;
              chip.appendChild(img);
            }
            const label = document.createElement('span');
            label.textContent = String(item?.itemTitle || item?.label || item?.key || '');
            chip.appendChild(label);
            selectedItemsWrap.appendChild(chip);
          }
          if (selectedItems.length > 6) {
            const more = document.createElement('span');
            more.className = 'rule-selected-chip';
            more.textContent = `+${selectedItems.length - 6}`;
            selectedItemsWrap.appendChild(more);
          }
        }
      };

      // Picker open/close
      pickerTrigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        const modalSelectedKeys = selectedChoiceKeys.map((key) => {
          const parsedKey = parseChoice(key);
          return parsedKey.itemId ? `item:${parsedKey.itemId}` : key;
        });
        openRuleItemPickerModal({
          items: itemsForSelect,
          selectedKeys: modalSelectedKeys,
          onApply: (_selectedItems, nextKeys) => {
            selectedChoiceKeys = Array.from(new Set((nextKeys || []).map((key) => String(key || '').trim()).filter(Boolean)));
            updateSelectedItemsUi();
            initialFileKey = '';
            renderFileChoices();
          },
        });
      });

      const renderFileChoices = () => {
        if (!itemSel || !fileSel) return;
        if (fileOverrides) fileOverrides.innerHTML = '';
        fileSel.classList.toggle('hidden', selectedChoiceKeys.length > 1);
        fileOverrides?.classList.toggle('hidden', selectedChoiceKeys.length <= 1);
        if (selectedChoiceKeys.length > 1) {
          selectedChoiceKeys.forEach((choiceKey, index) => {
            const parsedChoice = parseChoice(choiceKey);
            const itemId = String(parsedChoice.itemId || '').trim();
            const item = getItemForChoiceKey(choiceKey) || itemsForSelect.find((candidate) => String(candidate?.itemId || '').trim() === itemId);
            const row = document.createElement('div');
            row.className = 'rule-file-override-row';
            const name = document.createElement('div');
            name.className = 'rule-file-override-name';
            name.title = String(item?.itemTitle || item?.label || itemId || '');
            name.textContent = String(item?.itemTitle || item?.label || itemId || 'Item');
            const sel = document.createElement('select');
            sel.className = 'panel-input';
            const auto = document.createElement('option');
            auto.value = `item:${itemId}`;
            auto.textContent = '自動選択';
            sel.appendChild(auto);
            const rows = fileMap.get(itemId) || [];
            for (const file of rows) {
              const key = String(file.key || '');
              const label = String(file.label || file.relPath || key);
              const opt = document.createElement('option');
              opt.value = key;
              const relDisplay = trimToExtractedRelative(String(file.relPath || '').trim());
              opt.textContent = relDisplay || label.replace(/^\[File\]\s*/i, '');
              sel.appendChild(opt);
            }
            sel.value = parsedChoice.type === 'file' ? choiceKey : `item:${itemId}`;
            sel.addEventListener('change', () => {
              selectedChoiceKeys[index] = String(sel.value || '').trim();
              updateSelectedItemsUi();
              renderFileChoices();
            });
            row.appendChild(name);
            row.appendChild(sel);
            fileOverrides?.appendChild(row);
          });
          if (detail) {
            detail.textContent = `${selectedChoiceKeys.length} 件のアイテムをインポートします。各アイテムごとに自動選択または個別ファイルを指定できます。`;
          }
          return;
        }
        const firstChoiceKey = selectedChoiceKeys[0] || String(itemSel.value || '');
        const itemParsed = parseChoice(firstChoiceKey);
        const itemId = String(itemParsed.itemId || '').trim();
        const rows = fileMap.get(itemId) || [];
        fileSel.innerHTML = '<option value="__auto__">自動選択</option>';
        for (const file of rows) {
          const key = String(file.key || '');
          const label = String(file.label || file.relPath || key);
          const opt = document.createElement('option');
          opt.value = key;
          const relDisplay = trimToExtractedRelative(String(file.relPath || '').trim());
          opt.textContent = relDisplay || label.replace(/^\[File\]\s*/i, '');
          fileSel.appendChild(opt);
        }
        if (initialFileKey && !Array.from(fileSel.options).some((option) => option.value === initialFileKey)) {
          const synthetic = document.createElement('option');
          synthetic.value = initialFileKey;
          const raw = String(initialFileKey).replace(/^file:[^:]+:/, '');
          let decoded = raw;
          try { decoded = decodeURIComponent(raw); } catch { /* デコード失敗時は生の文字列のまま表示 */ }
          synthetic.textContent = `${trimToExtractedRelative(decoded)} (未検出)`;
          fileSel.appendChild(synthetic);
        }
        if (initialFileKey && Array.from(fileSel.options).some((option) => option.value === initialFileKey)) {
          fileSel.value = initialFileKey;
          initialFileKey = '';
        } else {
          fileSel.value = '__auto__';
        }
        if (detail) {
          detail.textContent = selectedChoiceKeys.length > 1
            ? `${selectedChoiceKeys.length} 件のアイテムを自動選択でインポートします。`
            : rows.length
            ? `このアイテムには ${rows.length} 件のunitypackage候補があります。必要なら個別指定してください。`
            : 'このアイテムには個別候補がないため、自動選択で進みます。';
        }
      };

      fileSel?.addEventListener('change', () => {});
      updateSelectedItemsUi();
      renderFileChoices();
      wrap.querySelector('[data-role="remove"]')?.addEventListener('click', () => {
        wrap.remove();
        if (!domRefs.autoBootstrapProjectRulesList?.children?.length) {
          renderProjectImportRulesEditor([]);
        }
      });
      return wrap;
    }

    function renderProjectImportRulesEditor(rules = []) {
      if (!domRefs.autoBootstrapProjectRulesList) return;
      domRefs.autoBootstrapProjectRulesList.innerHTML = '';
      const rows = Array.isArray(rules) ? rules : [];
      if (!rows.length) {
        const hint = document.createElement('div');
        hint.className = 'text-[9px] text-gray-500';
        hint.textContent = 'ルール未設定（グローバル設定を使用）';
        domRefs.autoBootstrapProjectRulesList.appendChild(hint);
        return;
      }
      const grouped = [];
      const byPattern = new Map();
      for (const rule of rows) {
        const projectPattern = String(rule?.projectPattern || '').trim();
        const choiceKey = String(rule?.choiceKey || '').trim();
        if (!projectPattern || !choiceKey) continue;
        const groupKey = projectPattern.toLowerCase();
        if (!byPattern.has(groupKey)) {
          const group = { projectPattern, choiceKeys: [] };
          byPattern.set(groupKey, group);
          grouped.push(group);
        }
        byPattern.get(groupKey).choiceKeys.push(choiceKey);
      }
      for (const rule of grouped) {
        rule.choiceKeys = Array.from(new Set(rule.choiceKeys));
        domRefs.autoBootstrapProjectRulesList.appendChild(createProjectImportRuleRow(rule));
      }
    }

    function collectProjectImportRulesFromEditor() {
      const out = [];
      const list = domRefs.autoBootstrapProjectRulesList;
      if (!list) return out;
      const children = Array.from(list.children || []);
      for (const row of children) {
        const patternEl = row.querySelector?.('input[data-role="pattern"]');
        const itemEl = row.querySelector?.('select[data-role="item-choice"]');
        const fileEl = row.querySelector?.('select[data-role="file-choice"]');
        if (!patternEl || !itemEl) continue;
        const projectPattern = String(patternEl.value || '').trim();
        let choiceKeys = [];
        try {
          choiceKeys = JSON.parse(String(row.dataset?.ruleChoiceKeys || '[]'));
        } catch {
          choiceKeys = [];
        }
        const fileVal = String(fileEl?.value || '').trim();
        if (fileVal && fileVal !== '__auto__' && choiceKeys.length <= 1) choiceKeys = [fileVal];
        if (!choiceKeys.length) {
          choiceKeys = Array.from(itemEl.options || [])
            .map((option) => String(option.value || '').trim())
            .filter(Boolean);
        }
        if (!projectPattern || !choiceKeys.length) continue;
        for (const choiceKey of Array.from(new Set(choiceKeys.map((key) => String(key || '').trim()).filter(Boolean)))) {
          out.push({ projectPattern, choiceKey });
        }
      }
      return out;
    }

    async function openAutoBootstrapModal() {
      if (!domRefs.autoBootstrapModal || !boothAPI.getSettings) return;
      const settings = await boothAPI.getSettings();
      state.settings = settings || {};

      if (domRefs.autoBootstrapEnabled) {
        domRefs.autoBootstrapEnabled.checked = state.settings.autoBootstrapEnabled !== false;
      }
      if (domRefs.autoBootstrapIncludeMA) {
        domRefs.autoBootstrapIncludeMA.checked = state.settings.autoBootstrapIncludeMA !== false;
      }
      if (domRefs.autoBootstrapIncludeLiltoon) {
        domRefs.autoBootstrapIncludeLiltoon.checked = state.settings.autoBootstrapIncludeLiltoon !== false;
      }
      if (domRefs.autoBootstrapIncludeFaceEmo) {
        domRefs.autoBootstrapIncludeFaceEmo.checked = state.settings.autoBootstrapIncludeFaceEmo !== false;
      }
      if (domRefs.autoBootstrapIncludeAvatoolScripts) {
        domRefs.autoBootstrapIncludeAvatoolScripts.checked = state.settings.autoBootstrapIncludeAvatoolScripts !== false;
      }
      if (domRefs.autoBootstrapIncludeSimpleFolderIcon) {
        domRefs.autoBootstrapIncludeSimpleFolderIcon.checked = state.settings.autoBootstrapIncludeSimpleFolderIcon !== false;
      }
      syncAutoBootstrapScriptDependencyUi();
      const ruleChoicesRes = await boothAPI.listAutoBootstrapRuleChoices?.();
      state.autoBootstrapRuleChoices = Array.isArray(ruleChoicesRes?.choices) ? ruleChoicesRes.choices : [];
      renderProjectImportRulesEditor(
        Array.isArray(state.settings.autoBootstrapProjectImportRules)
          ? state.settings.autoBootstrapProjectImportRules
          : []
      );

      domRefs.autoBootstrapModal.classList.remove('hidden');
      domRefs.autoBootstrapModal.classList.add('flex');
    }

    async function saveAutoBootstrapFromModal() {
      if (!boothAPI.updateSettings) return;

      const saveButton = document.getElementById('auto-bootstrap-save');
      const originalText = saveButton ? saveButton.innerText : '保存';
      if (saveButton) {
        saveButton.innerText = '保存中...';
        saveButton.style.opacity = '0.5';
        saveButton.disabled = true;
      }

      try {
        const list = domRefs.autoBootstrapProjectRulesList;
        if (list) {
          const rows = Array.from(list.children || []).filter((row) => row.querySelector?.('input[data-role="pattern"]'));
          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];
            const patternEl = row.querySelector?.('input[data-role="pattern"]');
            const itemEl = row.querySelector?.('select[data-role="item-choice"]');
            const fileEl = row.querySelector?.('select[data-role="file-choice"]');
            if (!patternEl || !itemEl) continue;
            const projectPattern = String(patternEl.value || '').trim();
            let choiceKeys = [];
            const fileVal = String(fileEl?.value || '').trim();
            try {
              choiceKeys = JSON.parse(String(row.dataset?.ruleChoiceKeys || '[]'));
            } catch {
              choiceKeys = [];
            }
            if (fileVal && fileVal !== '__auto__' && choiceKeys.length <= 1) choiceKeys = [fileVal];
            if (!choiceKeys.length) {
              choiceKeys = Array.from(itemEl.options || [])
                .map((option) => String(option.value || '').trim())
                .filter(Boolean);
            }
            if (!projectPattern) {
              showTransientMessage(`ルール${i + 1}: 条件（プロジェクト名に含む文字列）を入力してください。`, 'error');
              patternEl.focus();
              return;
            }
            if (!choiceKeys.length) {
              showTransientMessage(`ルール${i + 1}: インポート対象のアイテムを選択してください。`, 'error');
              itemEl.focus();
              return;
            }
          }
        }
        const parsedRules = collectProjectImportRulesFromEditor();

        const avatoolScriptsEnabled = Boolean(domRefs.autoBootstrapIncludeAvatoolScripts?.checked);
        const next = {
          ...(state.settings || {}),
          autoBootstrapEnabled: Boolean(domRefs.autoBootstrapEnabled?.checked),
          autoBootstrapIncludeMA: Boolean(domRefs.autoBootstrapIncludeMA?.checked),
          autoBootstrapIncludeLiltoon: Boolean(domRefs.autoBootstrapIncludeLiltoon?.checked),
          autoBootstrapIncludeFaceEmo: Boolean(domRefs.autoBootstrapIncludeFaceEmo?.checked),
          autoBootstrapIncludeAvatoolScripts: avatoolScriptsEnabled,
          autoBootstrapIncludeSimpleFolderIcon: avatoolScriptsEnabled && Boolean(domRefs.autoBootstrapIncludeSimpleFolderIcon?.checked),
          autoBootstrapProjectImportRules: parsedRules,
        };

        const res = await boothAPI.updateSettings(next);
        if (res?.ok) {
          state.settings = res.settings || next;
          showTransientMessage('自動インポート設定を保存しました。', 'info');
          if (saveButton) saveButton.innerText = '完了';
          setTimeout(() => {
            closeAutoBootstrapModal();
          }, 500);
        } else {
          showTransientMessage(`保存に失敗: ${res?.error || 'unknown'}`, 'error');
          if (saveButton) saveButton.innerText = '失敗';
        }
      } catch (error) {
        showTransientMessage(`保存に失敗: ${error?.message || '不明なエラー'}`, 'error');
        if (saveButton) saveButton.innerText = '失敗';
      } finally {
        setTimeout(() => {
          if (saveButton) {
            saveButton.innerText = originalText;
            saveButton.style.opacity = '1';
            saveButton.disabled = false;
          }
        }, 1500);
      }
    }

    function bindUiEvents() {
      domRefs.autoBootstrapBtn?.addEventListener('click', async () => {
        await openAutoBootstrapModal();
      });
      domRefs.autoBootstrapClose?.addEventListener('click', () => {
        closeAutoBootstrapModal();
      });
      document.getElementById('rule-item-picker-close')?.addEventListener('click', () => {
        closeRuleItemPickerModal();
      });
      document.getElementById('rule-item-picker-modal')?.addEventListener('click', (event) => {
        if (event.target?.id === 'rule-item-picker-modal') closeRuleItemPickerModal();
      });
      domRefs.autoBootstrapSave?.addEventListener('click', async () => {
        await saveAutoBootstrapFromModal();
      });
      domRefs.autoBootstrapIncludeAvatoolScripts?.addEventListener('change', () => {
        syncAutoBootstrapScriptDependencyUi();
      });
      domRefs.autoBootstrapProjectRulesAdd?.addEventListener('click', () => {
        if (!domRefs.autoBootstrapProjectRulesList) return;
        if (
          domRefs.autoBootstrapProjectRulesList.children.length === 1
          && !domRefs.autoBootstrapProjectRulesList.querySelector('input[data-role="pattern"]')
        ) {
          domRefs.autoBootstrapProjectRulesList.innerHTML = '';
        }
        domRefs.autoBootstrapProjectRulesList.appendChild(createProjectImportRuleRow({}));
      });
    }

    function bindIpcEvents() {
      if (ipcEventsBound) return;
      ipcEventsBound = true;
      boothAPI.onAutoBootstrapStatus?.((payload) => {
        try {
          const phase = String(payload?.phase || '');
          const source = String(payload?.source || '');
          const isStartup = source === 'startup';
          const projectName = pathBasename(String(payload?.projectPath || '')) || 'Project';
          const msg = String(payload?.message || '').trim();
          console.log('[AUTO-BOOTSTRAP][renderer]', JSON.stringify({ phase, projectName, message: msg, payload }));
          if (phase === 'started') {
            if (isStartup) {
              showTransientMessage(msg || '起動時の自動ダウンロードを開始しました。', 'info');
            } else {
              showTransientMessage(msg || `${projectName}: 自動インポートが作動中です。初回はUnityの初期ビルドも同時進行するため時間がかかる場合があります。処理完了までこのプロジェクトを開かないでください。`, 'error');
            }
            return;
          }
          if (phase === 'downloading' || phase === 'importing') {
            if (isStartup) {
              showTransientMessage(msg || '起動時の自動ダウンロードを実行中...', 'info');
            } else {
              showTransientMessage(msg || `${projectName}: 自動インポートを実行中...`, 'info');
            }
            return;
          }
          if (phase === 'done') {
            if (isStartup) {
              showTransientMessage(msg || '起動時の自動ダウンロードが完了しました。', 'info');
              syncDownloadStateFromLatestMapNoRerender?.().catch((error) => console.warn('syncDownloadStateFromLatestMapNoRerender(startup done) failed:', error));
            } else {
              showTransientMessage(msg || `${projectName}: 自動インポートが完了しました。`, 'info');
              syncDownloadStateFromLatestMapNoRerender?.().catch((error) => console.warn('syncDownloadStateFromLatestMapNoRerender(autoboot done) failed:', error));
            }
            return;
          }
          if (phase === 'skipped') {
            if (isStartup) {
              showTransientMessage(msg || '起動時の自動ダウンロードはスキップされました。', 'info');
            } else {
              showTransientMessage(msg || `${projectName}: 自動インポートはスキップされました。`, 'info');
            }
            return;
          }
          if (phase === 'error') {
            if (isStartup) {
              showTransientMessage(msg || '起動時の自動ダウンロードに失敗しました。', 'error');
            } else {
              showTransientMessage(msg || `${projectName}: 自動インポートに失敗しました。`, 'error');
            }
          }
        } catch (error) {
          console.warn('[renderer] onAutoBootstrapStatus failed:', error);
        }
      });
    }

    return {
      bindUiEvents,
      bindIpcEvents,
      openAutoBootstrapModal,
      closeAutoBootstrapModal,
      syncAutoBootstrapScriptDependencyUi,
      createProjectImportRuleRow,
      renderProjectImportRulesEditor,
      collectProjectImportRulesFromEditor,
      saveAutoBootstrapFromModal,
    };
  }

  global.AvatoolRenderAutoBootstrap = {
    createRenderAutoBootstrap,
  };
})(window);
