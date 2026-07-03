(function attachRenderShortcutEditorUi(global) {
  function createRenderShortcutEditorUi(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const sanitizeShortcutSpec = deps?.sanitizeShortcutSpec;
    const defaultShortcuts = deps?.defaultShortcuts;
    const shortcutFieldDefs = deps?.shortcutFieldDefs;
    const reservedShortcuts = deps?.reservedShortcuts;
    const validateShortcutMapWithDefs = deps?.validateShortcutMapWithDefs;
    const doc = deps?.document || global.document;
    const win = deps?.window || global;

    function isKeyboardActivationEvent(e) {
      return e.key === 'Enter' || e.key === ' ';
    }

    function enableKeyboardActivation(el, onActivate) {
      if (!el || typeof onActivate !== 'function') return;
      el.addEventListener('keydown', (e) => {
        if (!isKeyboardActivationEvent(e)) return;
        e.preventDefault();
        onActivate(e);
      });
    }

    function isElementShown(el) {
      if (!el || !el.isConnected) return false;
      if (el.classList?.contains('hidden')) return false;
      const style = win.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function isTypingTarget(target) {
      const el = target instanceof Element ? target : null;
      if (!el) return false;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return true;
      const active = doc.activeElement;
      if (!(active instanceof Element)) return false;
      return Boolean(active.closest('input, textarea, select, [contenteditable="true"]'));
    }

    function getShortcutMap() {
      const out = { ...defaultShortcuts };
      const incoming = state.settings?.keyboardShortcuts;
      if (incoming && typeof incoming === 'object') {
        for (const key of Object.keys(defaultShortcuts)) {
          if (Object.prototype.hasOwnProperty.call(incoming, key)) {
            out[key] = sanitizeShortcutSpec(incoming[key], defaultShortcuts[key]);
          }
        }
      }
      return out;
    }

    function renderShortcutEditor(shortcuts) {
      if (!domRefs.settingShortcutsEditor) return;
      const values = shortcuts || getShortcutMap();
      domRefs.settingShortcutsEditor.innerHTML = '';
      state.shortcutCaptureKey = '';
      state.shortcutCaptureButton = null;
      shortcutFieldDefs.forEach((def) => {
        const row = doc.createElement('div');
        row.className = 'shortcut-row';
        const label = doc.createElement('div');
        label.className = 'text-[10px] text-zinc-300';
        label.textContent = def.hint ? `${def.label} (${def.hint})` : def.label;
        const input = doc.createElement('input');
        input.type = 'text';
        input.className = 'panel-input font-mono-custom text-[11px]';
        input.placeholder = defaultShortcuts[def.key] || '';
        input.value = sanitizeShortcutSpec(values[def.key], defaultShortcuts[def.key]);
        input.dataset.shortcutKey = def.key;
        input.readOnly = true;
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-action !px-3';
        btn.textContent = 'Change';
        btn.dataset.shortcutAssignKey = def.key;
        btn.addEventListener('click', () => {
          beginShortcutCapture(def.key, btn);
        });
        row.appendChild(label);
        row.appendChild(input);
        row.appendChild(btn);
        domRefs.settingShortcutsEditor.appendChild(row);
      });
      refreshShortcutValidationUi();
    }

    function readShortcutEditorValue() {
      const out = {};
      for (const key of Object.keys(defaultShortcuts)) {
        out[key] = defaultShortcuts[key];
      }
      const container = domRefs.settingShortcutsEditor;
      if (!container) return out;
      container.querySelectorAll('input[data-shortcut-key]').forEach((el) => {
        const key = String(el.dataset.shortcutKey || '');
        if (!Object.prototype.hasOwnProperty.call(defaultShortcuts, key)) return;
        out[key] = sanitizeShortcutSpec(el.value, defaultShortcuts[key]);
      });
      return out;
    }

    function stopShortcutCapture() {
      const btn = state.shortcutCaptureButton;
      if (btn && btn.isConnected) {
        btn.textContent = 'Change';
        btn.classList.remove('bg-amber-600', 'hover:bg-amber-500', 'text-white');
      }
      state.shortcutCaptureKey = '';
      state.shortcutCaptureButton = null;
    }

    function beginShortcutCapture(shortcutKey, buttonEl) {
      stopShortcutCapture();
      state.shortcutCaptureKey = String(shortcutKey || '');
      state.shortcutCaptureButton = buttonEl || null;
      if (buttonEl) {
        buttonEl.textContent = 'キー待機中...';
        buttonEl.classList.add('bg-amber-600', 'hover:bg-amber-500', 'text-white');
      }
    }

    function validateShortcutMap(shortcuts) {
      return validateShortcutMapWithDefs(shortcuts, shortcutFieldDefs, reservedShortcuts);
    }

    function applyShortcutValidationUi(result) {
      state.shortcutValidation = result || { duplicates: [], reservedHits: [] };
      const container = domRefs.settingShortcutsEditor;
      if (container) {
        container.querySelectorAll('.shortcut-row').forEach((row) => {
          row.classList.remove('border', 'border-red-500/60', 'rounded-lg', 'bg-red-900/10');
        });
        const markKey = (k) => {
          const row = container.querySelector(`input[data-shortcut-key="${k}"]`)?.closest('.shortcut-row');
          if (!row) return;
          row.classList.add('border', 'border-red-500/60', 'rounded-lg', 'bg-red-900/10');
        };
        (result?.duplicates || []).forEach((group) => group.forEach((k) => markKey(k)));
        (result?.reservedHits || []).forEach((r) => markKey(r.key));
      }
      if (!domRefs.settingShortcutsWarning) return;
      const msgs = [];
      if (result?.duplicates?.length) {
        msgs.push(`重複: ${result.duplicates.length} 件`);
      }
      if (result?.reservedHits?.length) {
        msgs.push(`予約キー: ${result.reservedHits.length} 件`);
      }
      if (!msgs.length) {
        domRefs.settingShortcutsWarning.textContent = '重複・予約キーの問題はありません。';
        domRefs.settingShortcutsWarning.className = 'text-[10px] text-emerald-300 min-h-[16px]';
        return;
      }
      domRefs.settingShortcutsWarning.textContent = msgs.join(' / ');
      domRefs.settingShortcutsWarning.className = 'text-[10px] text-amber-300 min-h-[16px]';
    }

    function refreshShortcutValidationUi() {
      applyShortcutValidationUi(validateShortcutMap(readShortcutEditorValue()));
    }

    return {
      isKeyboardActivationEvent,
      enableKeyboardActivation,
      isElementShown,
      isTypingTarget,
      getShortcutMap,
      renderShortcutEditor,
      readShortcutEditorValue,
      stopShortcutCapture,
      beginShortcutCapture,
      validateShortcutMap,
      applyShortcutValidationUi,
      refreshShortcutValidationUi,
    };
  }

  global.AvatoolRenderShortcutEditorUi = {
    createRenderShortcutEditorUi,
  };
})(window);
