'use strict';

function createHealthCheckService(deps) {
  const {
    fs,
    DEFAULT_SETTINGS,
    readBoothCookiesFromFile,
    validateBoothLogin,
    getStorageUsageSnapshot,
    META_PATH,
    VCC_SETTINGS_PATH,
    getSettings,
    appendOperationLog,
    getMainWindow,
  } = deps;

  async function runHealthCheck(trigger = 'manual') {
    const issues = [];
    const settings = getSettings();
    try {
      const cookiePath = String(DEFAULT_SETTINGS.cookieFile || '').trim();
      if (!cookiePath || !fs.existsSync(cookiePath)) {
        issues.push({ level: 'warn', code: 'cookie_missing', message: 'Cookieファイルが見つかりません。' });
      } else {
        const cookies = readBoothCookiesFromFile(cookiePath);
        if (!Array.isArray(cookies) || cookies.length === 0) {
          issues.push({ level: 'warn', code: 'cookie_empty', message: 'Cookieが空です。' });
        } else {
          const valid = await validateBoothLogin(cookies);
          if (!valid?.ok) {
            issues.push({
              level: 'warn',
              code: 'cookie_login_invalid',
              message: `ログインCookieが無効の可能性: ${String(valid?.reason || 'not_authenticated')}`,
            });
          }
        }
      }
      const configuredCookiePath = String(settings.cookieFile || '').trim();
      if (configuredCookiePath) {
        const storePath = require('path').resolve(String(DEFAULT_SETTINGS.cookieFile || '').trim());
        const configuredPath = require('path').resolve(configuredCookiePath);
        if (storePath !== configuredPath) {
          issues.push({
            level: 'warn',
            code: 'cookie_path_mismatch',
            message: '設定Cookieパスと実際のCookie保存先が一致しません。設定を再保存してください。',
          });
        }
      }
    } catch (e) {
      issues.push({ level: 'warn', code: 'cookie_check_failed', message: `Cookie検査失敗: ${e?.message || e}` });
    }

    try {
      const usage = getStorageUsageSnapshot();
      const freeBytes = Number(usage?.drive?.freeBytes || 0);
      const minBytes = Number(settings.minFreeSpaceGb || 0) * 1024 * 1024 * 1024;
      if (minBytes > 0 && freeBytes > 0 && freeBytes < minBytes) {
        issues.push({ level: 'error', code: 'disk_low', message: `空き容量不足: ${Math.floor(freeBytes / (1024 * 1024 * 1024))}GB` });
      }
    } catch (e) {
      issues.push({ level: 'warn', code: 'disk_check_failed', message: `容量検査失敗: ${e?.message || e}` });
    }

    try {
      const unityPath = String(settings.unityEditorPath || '').trim();
      if (unityPath) {
        if (!fs.existsSync(unityPath)) {
          issues.push({ level: 'warn', code: 'unity_editor_not_found', message: `Unity Editorが見つかりません: ${unityPath}` });
        }
      }
    } catch (e) {
      issues.push({ level: 'warn', code: 'unity_check_failed', message: `Unity検査失敗: ${e?.message || e}` });
    }

    try {
      const vccPath = String(VCC_SETTINGS_PATH || '').trim();
      if (!vccPath || !fs.existsSync(vccPath)) {
        issues.push({ level: 'warn', code: 'vcc_not_found', message: 'VRChat Creator Companion (VCC) が見つかりません。' });
      }
    } catch (e) {
      issues.push({ level: 'warn', code: 'vcc_check_failed', message: `VCC検査失敗: ${e?.message || e}` });
    }

    try {
      const raw = fs.existsSync(META_PATH) ? fs.readFileSync(META_PATH, 'utf8') : '[]';
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        issues.push({ level: 'error', code: 'meta_not_array', message: 'librarymeta.json の形式が不正です。' });
      } else {
        const idSet = new Set();
        let dup = 0;
        for (const item of parsed) {
          const id = String(item?.itemId || '').trim();
          if (!id) continue;
          if (idSet.has(id)) dup += 1;
          idSet.add(id);
        }
        if (dup > 0) issues.push({ level: 'warn', code: 'meta_duplicate_ids', message: `librarymeta.json に重複IDが ${dup} 件あります。` });
      }
    } catch (e) {
      issues.push({ level: 'error', code: 'meta_parse_failed', message: `librarymeta.json が壊れています: ${e?.message || e}` });
    }

    const report = {
      ok: issues.filter((i) => i.level === 'error').length === 0,
      trigger,
      at: new Date().toISOString(),
      issues,
    };
    appendOperationLog('health-check', `ヘルスチェック実行 (${trigger})`, { issues: issues.length });
    try {
      const sender = getMainWindow()?.webContents;
      if (sender && !sender.isDestroyed?.()) sender.send('health-check-report', report);
    } catch {
      // ignore
    }
    return report;
  }

  return { runHealthCheck };
}

module.exports = { createHealthCheckService };
