(function attachRenderPrefsFormatUtils(global) {
  function createRenderPrefsFormatUtils(deps) {
    const getState = deps?.getState;
    const icons = deps?.icons || {};
    const parseSortableDateMs = (...args) => deps?.parseSortableDateMs(...args);

    let avatarDebugEnabledCache = null;

    function isAvatarDebugEnabled() {
      const state = getState();
      if (state.settings && Object.prototype.hasOwnProperty.call(state.settings, 'debugLogEnabled')) {
        return Boolean(state.settings.debugLogEnabled);
      }
      if (avatarDebugEnabledCache !== null) return avatarDebugEnabledCache;
      try {
        const raw = String(localStorage.getItem('AVATOOL_DEBUG_VERBOSE') || '').trim().toLowerCase();
        avatarDebugEnabledCache = raw === '1' || raw === 'true' || raw === 'on';
        return avatarDebugEnabledCache;
      } catch {
        avatarDebugEnabledCache = false;
        return false;
      }
    }

    function logAvatarDebug(message, payload = null) {
      if (!isAvatarDebugEnabled()) return;
      try {
        if (payload && typeof payload === 'object') {
          console.log(`[AVATAR-DEBUG] ${message}`, payload);
        } else {
          console.log(`[AVATAR-DEBUG] ${message}`);
        }
      } catch {
        // ignore logging failures
      }
    }

    function logShortcutDebug(message, payload = null) {
      if (!isAvatarDebugEnabled()) return;
      if (global.logger?.log) global.logger.log(message, payload);
      else console.log(message, payload);
    }

    function loadViewModePreference() {
      try {
        const raw = localStorage.getItem('assetViewMode');
        if (raw === 'list' || raw === 'grid') return raw;
      } catch {
        // ignore
      }
      return 'grid';
    }

    function loadSortModePreference() {
      const valid = ['date_desc', 'date_asc', 'name_asc', 'size_desc'];
      try {
        const raw = localStorage.getItem('assetSortMode');
        if (valid.includes(raw)) return raw;
      } catch {
        // ignore
      }
      return 'date_desc';
    }

    function persistSortModePreference(mode) {
      try {
        localStorage.setItem('assetSortMode', mode);
      } catch {
        // ignore
      }
    }

    function persistViewModePreference(mode) {
      try {
        localStorage.setItem('assetViewMode', mode === 'list' ? 'list' : 'grid');
      } catch {
        // ignore
      }
    }

    function getRenderModeSetting() {
      const state = getState();
      const fromSettings = String(state.settings?.renderMode || '').trim().toLowerCase();
      if (fromSettings === 'instant' || fromSettings === 'progressive') return fromSettings;
      try {
        const fromStorage = String(localStorage.getItem('assetRenderMode') || '').trim().toLowerCase();
        if (fromStorage === 'instant' || fromStorage === 'progressive') return fromStorage;
      } catch {
        // ignore
      }
      return 'progressive';
    }

    function persistRenderModeSetting(mode) {
      const next = String(mode || '').trim().toLowerCase() === 'instant' ? 'instant' : 'progressive';
      try {
        localStorage.setItem('assetRenderMode', next);
      } catch {
        // ignore
      }
    }

    function formatDate(raw) {
      if (!raw || raw === 'Unknown') return '不明';
      const ms = parseSortableDateMs(raw);
      if (ms === null) return raw;
      const d = new Date(ms);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${y}.${m}.${day} ${hh}:${mm}`;
    }

    function esc(text) {
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function getIconForFile(filename) {
      const ext = (filename.split('.').pop() || '').toLowerCase();
      if (['unitypackage', 'unity', 'prefab', 'mat'].includes(ext)) return icons.unity;
      if (['blend', 'blend1'].includes(ext)) return icons.blender;
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'tga', 'psd', 'bmp'].includes(ext)) return icons.image;
      if (['fbx', 'vrm', 'obj', 'glb', 'gltf'].includes(ext)) return icons.model;
      if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return icons.audio;
      if (['zip', 'rar', '7z', 'tar'].includes(ext)) return icons.archive;
      if (['txt', 'md', 'json', 'html', 'css', 'js', 'pdf'].includes(ext)) return icons.text;
      return icons.file;
    }

    function isImageFile(name) {
      const lower = (name || '').toLowerCase();
      return lower.match(/\.(png|jpg|jpeg|gif|webp|tga|bmp)$/);
    }

    function pathBasename(p) {
      const norm = String(p || '').replace(/\\/g, '/');
      if (!norm) return '';
      const parts = norm.split('/');
      return parts[parts.length - 1] || '';
    }

    return {
      isAvatarDebugEnabled,
      logAvatarDebug,
      logShortcutDebug,
      loadViewModePreference,
      loadSortModePreference,
      persistSortModePreference,
      persistViewModePreference,
      getRenderModeSetting,
      persistRenderModeSetting,
      formatDate,
      esc,
      getIconForFile,
      isImageFile,
      pathBasename,
    };
  }

  global.AvatoolRenderPrefsFormatUtils = {
    createRenderPrefsFormatUtils,
  };
})(window);
