(function attachShortcutUtils(global) {
  function sanitizeShortcutSpec(value, fallback) {
    const raw = String(value || '').trim();
    if (!raw) return fallback || '';
    return raw.slice(0, 40);
  }

  function isModifierOnlyKey(keyNorm) {
    return keyNorm === 'control' || keyNorm === 'shift' || keyNorm === 'alt' || keyNorm === 'meta';
  }

  function getEventKeyNormalized(e) {
    const k = String(e?.key || '');
    if (!k) return '';
    if (k === ' ') return ' ';
    return k.toLowerCase();
  }

  function formatShortcutFromEvent(e) {
    const keyNorm = getEventKeyNormalized(e);
    if (!keyNorm || isModifierOnlyKey(keyNorm)) return '';
    const raw = String(e?.key || '');
    const hasCtrlMeta = Boolean(e?.ctrlKey || e?.metaKey);
    const mods = [];
    if (hasCtrlMeta) mods.push('Ctrl');
    if (e?.altKey) mods.push('Alt');
    if (e?.shiftKey) mods.push('Shift');
    let base = '';
    if (raw === ' ') {
      base = 'Space';
    } else if (raw.length === 1) {
      base = /[a-z]/i.test(raw) ? raw.toUpperCase() : raw;
    } else {
      const special = {
        escape: 'Escape',
        enter: 'Enter',
        tab: 'Tab',
        backspace: 'Backspace',
        delete: 'Delete',
        arrowup: 'ArrowUp',
        arrowdown: 'ArrowDown',
        arrowleft: 'ArrowLeft',
        arrowright: 'ArrowRight',
      };
      base = special[keyNorm] || raw;
    }
    return sanitizeShortcutSpec([...mods, base].join('+'));
  }

  function parseShortcutSpec(spec) {
    const s = String(spec || '').trim();
    if (!s) return null;
    const parts = s.split('+').map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return null;
    let wantsCtrlMeta = false;
    let wantsAlt = false;
    let wantsShift = false;
    const keyParts = [];
    for (const p of parts) {
      const n = p.toLowerCase();
      if (n === 'ctrl' || n === 'cmd' || n === 'meta' || n === 'mod') {
        wantsCtrlMeta = true;
        continue;
      }
      if (n === 'alt' || n === 'option') {
        wantsAlt = true;
        continue;
      }
      if (n === 'shift') {
        wantsShift = true;
        continue;
      }
      keyParts.push(p);
    }
    if (!keyParts.length) return null;
    let key = keyParts.join('+');
    if (key.toLowerCase() === 'space') key = ' ';
    else key = key.toLowerCase();
    return {
      key,
      wantsCtrlMeta,
      wantsAlt,
      wantsShift,
    };
  }

  function eventMatchesShortcut(e, spec) {
    const parsed = parseShortcutSpec(spec);
    if (!parsed) return false;
    const eventKey = getEventKeyNormalized(e);
    if (!eventKey || eventKey !== parsed.key) return false;
    const hasCtrlMeta = Boolean(e?.ctrlKey || e?.metaKey);
    if (parsed.wantsCtrlMeta !== hasCtrlMeta) return false;
    if (parsed.wantsAlt !== Boolean(e?.altKey)) return false;
    if (parsed.wantsShift !== Boolean(e?.shiftKey)) return false;
    return true;
  }

  function canonicalizeShortcutSpec(spec) {
    const parsed = parseShortcutSpec(spec);
    if (!parsed) return '';
    const mods = [];
    if (parsed.wantsCtrlMeta) mods.push('ctrl');
    if (parsed.wantsAlt) mods.push('alt');
    if (parsed.wantsShift) mods.push('shift');
    return `${mods.join('+')}|${parsed.key}`;
  }

  function formatShortcutDisplay(spec) {
    const parsed = parseShortcutSpec(spec);
    if (!parsed) return '';
    const mods = [];
    if (parsed.wantsCtrlMeta) mods.push('Ctrl');
    if (parsed.wantsAlt) mods.push('Alt');
    if (parsed.wantsShift) mods.push('Shift');
    let key = parsed.key;
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    else key = key === 'comma' ? ',' : `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    return [...mods, key].join('+');
  }

  function validateShortcutMap(shortcuts, fieldDefs, reservedShortcuts) {
    const byCanonical = new Map();
    const duplicates = [];
    const reservedHits = [];
    for (const def of fieldDefs || []) {
      const key = def.key;
      const spec = String(shortcuts?.[key] || '').trim();
      const canonical = canonicalizeShortcutSpec(spec);
      if (!canonical) continue;
      if (!byCanonical.has(canonical)) byCanonical.set(canonical, []);
      byCanonical.get(canonical).push(key);
    }
    for (const keys of byCanonical.values()) {
      if (keys.length > 1) duplicates.push(keys);
    }
    for (const def of fieldDefs || []) {
      const key = def.key;
      const spec = String(shortcuts?.[key] || '').trim();
      const canonical = canonicalizeShortcutSpec(spec);
      if (!canonical) continue;
      const matched = (reservedShortcuts || []).find((row) => canonicalizeShortcutSpec(row.spec) === canonical);
      if (matched) reservedHits.push({ key, spec, reason: matched.reason });
    }
    return { duplicates, reservedHits };
  }

  global.AvatoolRenderShortcuts = {
    sanitizeShortcutSpec,
    isModifierOnlyKey,
    getEventKeyNormalized,
    formatShortcutFromEvent,
    parseShortcutSpec,
    eventMatchesShortcut,
    canonicalizeShortcutSpec,
    formatShortcutDisplay,
    validateShortcutMap,
  };
})(window);
