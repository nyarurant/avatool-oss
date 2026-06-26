'use strict';

function createLogManager(deps) {
  const {
    fs,
    OP_LOG_PATH,
    UNITY_IMPORT_LOG_PATH,
    AVATAR_DEBUG_LOG_PATH,
    RENDERER_LOG_MAX_CHARS,
    DEBUG_VERBOSE,
    appendRuntimeLog,
    getMainWindow,
    getSettings,
    ensureAppDataRootExists,
  } = deps;

  let operationLogs = [];
  const AVATAR_DEBUG_LOG_MAX_BYTES = 5 * 1024 * 1024;

  function isDebugVerboseEnabled() {
    if (DEBUG_VERBOSE) return true;
    try {
      return Boolean(getSettings?.()?.debugLogEnabled);
    } catch {
      return false;
    }
  }

  // ---- sanitizeRendererLogText ----

  function sanitizeRendererLogText(value, maxLen = RENDERER_LOG_MAX_CHARS) {
    const raw = String(value ?? '');
    const normalized = raw
      .replace(/\r\n|\r|\n/g, ' ')
      .replace(/[\0-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim();
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, maxLen)}...(truncated)`;
  }

  // ---- operation logs ----

  function saveOperationLogs() {
    try {
      ensureAppDataRootExists();
      // Add UTF-8 BOM so Windows tools detect encoding reliably.
      const text = `${String.fromCharCode(0xFEFF)}${JSON.stringify(operationLogs.slice(-500), null, 2)}`;
      fs.writeFileSync(OP_LOG_PATH, text, 'utf8');
    } catch {
      // ignore
    }
  }

  function appendOperationLog(type, message, meta = null) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      type: String(type || 'info'),
      message: String(message || ''),
      meta: meta || null,
    };
    operationLogs.push(entry);
    appendRuntimeLog('log', 'operation', `[${entry.type}]`, entry.message, entry.meta || '');
    if (operationLogs.length > 500) operationLogs = operationLogs.slice(-500);
    const settings = getSettings();
    if (settings.operationLogEnabled !== false) saveOperationLogs();
    try {
      const sender = getMainWindow()?.webContents;
      if (sender && !sender.isDestroyed?.()) sender.send('operation-log', entry);
    } catch {
      // ignore
    }
    return entry;
  }

  function loadOperationLogs() {
    try {
      if (!fs.existsSync(OP_LOG_PATH)) {
        operationLogs = [];
        return;
      }
      const buf = fs.readFileSync(OP_LOG_PATH);
      const decodeCandidates = [
        buf.toString('utf8'),
        buf.toString('utf16le'),
        buf.toString('latin1'),
      ];
      let rows = [];
      for (const rawText of decodeCandidates) {
        try {
          const normalized = String(rawText || '').replace(/^\uFEFF/, '').trim();
          const parsed = JSON.parse(normalized);
          if (Array.isArray(parsed)) {
            rows = parsed;
            break;
          }
        } catch {
          // try next encoding
        }
      }
      operationLogs = Array.isArray(rows) ? rows.slice(-500) : [];
      const settings = getSettings();
      if (settings.operationLogEnabled !== false) saveOperationLogs();
    } catch {
      operationLogs = [];
    }
  }

  function getOperationLogs() {
    return operationLogs;
  }

  function clearOperationLogs() {
    operationLogs = [];
  }

  // ---- debug helpers ----

  function toDebugLogText(value) {
    if (value === null) return 'null';
    if (typeof value === 'undefined') return 'undefined';
    if (typeof value === 'string') return sanitizeRendererLogText(value, 2000);
    try {
      return sanitizeRendererLogText(JSON.stringify(value), 6000);
    } catch {
      return sanitizeRendererLogText(String(value), 2000);
    }
  }

  const UNITY_IMPORT_LOG_MAX_BYTES = 5 * 1024 * 1024;

  function appendUnityImportLog(message) {
    if (!UNITY_IMPORT_LOG_PATH) {
      console.error('[UnityImportLog] UNITY_IMPORT_LOG_PATH is not set');
      return;
    }
    try {
      ensureAppDataRootExists();
      if (fs.existsSync(UNITY_IMPORT_LOG_PATH)) {
        const st = fs.statSync(UNITY_IMPORT_LOG_PATH);
        if (Number(st?.size || 0) > UNITY_IMPORT_LOG_MAX_BYTES) {
          const rotatedPath = `${UNITY_IMPORT_LOG_PATH}.old`;
          try {
            if (fs.existsSync(rotatedPath)) fs.rmSync(rotatedPath, { force: true });
          } catch { /* ignore */ }
          fs.renameSync(UNITY_IMPORT_LOG_PATH, rotatedPath);
        }
      }
      const line = `${new Date().toISOString()} [IMPORT] ${String(message || '')}\n`;
      fs.appendFileSync(UNITY_IMPORT_LOG_PATH, line, 'utf8');
    } catch (e) {
      console.error('[UnityImportLog] write failed:', UNITY_IMPORT_LOG_PATH, e?.message || e);
    }
  }

  function appendUnityBatchLog(unityLogPath) {
    if (!UNITY_IMPORT_LOG_PATH || !unityLogPath) return;
    try {
      if (!fs.existsSync(unityLogPath)) return;
      const raw = fs.readFileSync(unityLogPath, 'utf8');
      const lines = raw.split(/\r?\n/);
      const keep = lines.filter((l) => {
        const u = l.toUpperCase();
        return l.includes('[BoothBatchImporter]') ||
          u.includes('ERROR') ||
          u.includes('EXCEPTION') ||
          u.includes('FAILED') ||
          u.includes('FATAL');
      });
      if (!keep.length) return;
      const ts = new Date().toISOString();
      const header = `${ts} [IMPORT] --- Unity ログ (${keep.length} 行) ---\n`;
      const body = keep.map((l) => `  ${l}`).join('\n') + '\n';
      const footer = `${ts} [IMPORT] --- Unity ログ 終了 ---\n`;
      fs.appendFileSync(UNITY_IMPORT_LOG_PATH, header + body + footer, 'utf8');
    } catch {
      // ignore
    }
  }

  function appendAvatarDebugLog(...args) {
    if (!isDebugVerboseEnabled()) return false;
    if (!AVATAR_DEBUG_LOG_PATH) return false;
    try {
      ensureAppDataRootExists();
      const debugDir = String(AVATAR_DEBUG_LOG_PATH).replace(/[\\/][^\\/]*$/, '');
      if (debugDir && debugDir !== AVATAR_DEBUG_LOG_PATH && typeof fs.mkdirSync === 'function') {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      if (fs.existsSync(AVATAR_DEBUG_LOG_PATH)) {
        const st = fs.statSync(AVATAR_DEBUG_LOG_PATH);
        if (Number(st?.size || 0) > AVATAR_DEBUG_LOG_MAX_BYTES) {
          const rotatedPath = `${AVATAR_DEBUG_LOG_PATH}.old`;
          try {
            if (fs.existsSync(rotatedPath)) fs.rmSync(rotatedPath, { force: true });
          } catch {
            // ignore rotation cleanup failures
          }
          fs.renameSync(AVATAR_DEBUG_LOG_PATH, rotatedPath);
        }
      }
      const line = `${new Date().toISOString()} [AVATAR-DEBUG] ${args.map(toDebugLogText).join(' ')}\n`;
      fs.appendFileSync(AVATAR_DEBUG_LOG_PATH, line, 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  function dbgUpdate(...args) {
    if (!isDebugVerboseEnabled()) return;
    console.log('[UPDATE-DEBUG]', ...args);
    try {
      const first = String(args?.[0] || '');
      if (first.startsWith('unity-import:')) {
        const msg = args.map((v) => String(v)).join(' ');
        appendOperationLog('unity-import-debug', msg);
      }
    } catch {
      // ignore operation-log forwarding failures
    }
  }

  function dbgAvatar(...args) {
    if (!isDebugVerboseEnabled()) return;
    console.log('[AVATAR-DEBUG]', ...args);
    appendAvatarDebugLog(...args);
  }

  return {
    loadOperationLogs,
    saveOperationLogs,
    appendOperationLog,
    getOperationLogs,
    clearOperationLogs,
    sanitizeRendererLogText,
    appendUnityImportLog,
    appendUnityBatchLog,
    appendAvatarDebugLog,
    dbgUpdate,
    dbgAvatar,
  };
}

module.exports = { createLogManager };
