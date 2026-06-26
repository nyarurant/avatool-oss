'use strict';

function createAppUpdater(deps) {
  const {
    electronAutoUpdater,
    axios,
    fs,
    crypto,
    app,
    shell,
    getMainWindow,
  } = deps;

  let appUpdateCheckPromise = null;
  let appUpdateDownloadPromise = null;
  let appUpdaterInitialized = false;
  let appUpdateAvailableInfo = null;
  let emergencyUpdateInfo = null;

  // ---- status emitter ----

  function emitAppUpdateStatus(payload = {}) {
    try {
      const sender = getMainWindow()?.webContents;
      if (sender && !sender.isDestroyed?.()) sender.send('app-update-status', payload);
    } catch {
      // ignore
    }
  }

  // ---- semver helpers ----

  function parseSemverInfo(ver) {
    const s = String(ver || '').trim();
    const m = s.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!m) return null;
    return {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      prerelease: String(m[4] || ''),
      isPrerelease: Boolean(m[4]),
    };
  }

  function compareSemverAscSimple(a, b) {
    const av = parseSemverInfo(a);
    const bv = parseSemverInfo(b);
    if (!av && !bv) return 0;
    if (!av) return -1;
    if (!bv) return 1;
    if (av.major !== bv.major) return av.major - bv.major;
    if (av.minor !== bv.minor) return av.minor - bv.minor;
    if (av.patch !== bv.patch) return av.patch - bv.patch;
    if (av.isPrerelease !== bv.isPrerelease) return av.isPrerelease ? -1 : 1;
    if (!av.isPrerelease) return 0;
    return av.prerelease.localeCompare(bv.prerelease);
  }

  // ---- release notes normalization ----

  function normalizeReleaseNotesValue(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
      const out = value
        .map((v) => {
          if (!v) return '';
          if (typeof v === 'string') return v.trim();
          if (typeof v === 'object') {
            const note = String(v.note || v.text || '').trim();
            const version = String(v.version || '').trim();
            if (version && note) return `${version}: ${note}`;
            return note;
          }
          return String(v || '').trim();
        })
        .filter(Boolean);
      return out.join('\n');
    }
    if (typeof value === 'object') {
      const note = String(value.note || value.text || '').trim();
      if (note) return note;
    }
    return String(value || '').trim();
  }

  // ---- emergency update helpers ----

  function getAppUpdateBaseUrl() {
    const raw = String(process.env.AVATOOL_UPDATE_BASE_URL || 'https://cdn.necco.xyz/file/avatool').trim();
    return raw.replace(/\/+$/, '');
  }

  function trimWrappedQuotes(value) {
    const s = String(value || '').trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
      return s.slice(1, -1);
    }
    return s;
  }

  function parseEmergencyLatestBackupYml(raw) {
    const text = String(raw || '').replace(/\r/g, '');
    const lines = text.split('\n');
    const out = {
      version: '',
      path: '',
      url: '',
      sha512: '',
      releaseDate: '',
      releaseNotes: '',
    };
    for (let i = 0; i < lines.length; i += 1) {
      const line = String(lines[i] || '');
      const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const val = String(m[2] || '');
      if (key === 'releaseNotes' && (val === '|-' || val === '|')) {
        const block = [];
        let j = i + 1;
        while (j < lines.length) {
          const next = String(lines[j] || '');
          if (/^\s/.test(next)) {
            block.push(next.replace(/^\s{2}/, ''));
            j += 1;
            continue;
          }
          if (!next.trim()) {
            block.push('');
            j += 1;
            continue;
          }
          break;
        }
        out.releaseNotes = block.join('\n').trim();
        i = j - 1;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        out[key] = trimWrappedQuotes(val);
      }
    }
    if (!out.url && out.path) {
      out.url = `${getAppUpdateBaseUrl()}/${encodeURI(String(out.path).replace(/\\/g, '/'))}`;
    }
    return out;
  }

  function isLikelyLatestYmlParseError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('latest.yml') && (msg.includes('cannot parse update info') || msg.includes('yamlexception'));
  }

  async function fetchEmergencyUpdateInfo() {
    const url = `${getAppUpdateBaseUrl()}/latest-backup.yml?noCache=${Date.now().toString(36)}`;
    const res = await axios.get(url, { timeout: 15000, responseType: 'text', validateStatus: () => true });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`latest-backup.yml fetch failed (${res.status})`);
    }
    const parsed = parseEmergencyLatestBackupYml(res.data);
    if (!parsed.version || !parsed.url) {
      throw new Error('latest-backup.yml is missing required fields (version/url)');
    }
    return parsed;
  }

  async function computeFileSha512Base64(filePath) {
    return await new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha512');
      const rs = fs.createReadStream(filePath);
      rs.on('error', reject);
      rs.on('data', (chunk) => hash.update(chunk));
      rs.on('end', () => resolve(hash.digest('base64')));
    });
  }

  async function downloadFileWithProgress(url, outPath, onProgress) {
    const res = await axios.get(url, { timeout: 10 * 60 * 1000, responseType: 'stream', validateStatus: () => true });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`download failed (${res.status})`);
    }
    const total = Number(res.headers?.['content-length'] || 0);
    const ws = fs.createWriteStream(outPath);
    let loaded = 0;
    await new Promise((resolve, reject) => {
      res.data.on('data', (chunk) => {
        loaded += Number(chunk?.length || 0);
        if (typeof onProgress === 'function') onProgress(loaded, total);
      });
      res.data.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      res.data.pipe(ws);
    });
  }

  async function tryEmergencyUpdateCheckFromBackup() {
    const parsed = await fetchEmergencyUpdateInfo();
    const current = String(app.getVersion() || '').trim();
    if (compareSemverAscSimple(parsed.version, current) <= 0) {
      appUpdateAvailableInfo = null;
      emergencyUpdateInfo = null;
      emitAppUpdateStatus({ phase: 'not-available', version: parsed.version, message: '現在のバージョンは最新です。' });
      return { ok: true, fallback: true, available: false };
    }
    emergencyUpdateInfo = {
      ...parsed,
      downloadedPath: '',
      source: 'latest-backup.yml',
    };
    appUpdateAvailableInfo = {
      version: parsed.version,
      releaseNotes: parsed.releaseNotes,
      releaseDate: parsed.releaseDate,
      emergency: true,
    };
    emitAppUpdateStatus({
      phase: 'available',
      version: parsed.version,
      releaseDate: parsed.releaseDate,
      releaseNotes: parsed.releaseNotes,
      message: `緊急アップデート ${parsed.version} を検出しました。ダウンロードを開始できます。`,
    });
    return { ok: true, fallback: true, available: true, version: parsed.version };
  }

  async function startEmergencyUpdateDownload() {
    if (!emergencyUpdateInfo?.url || !emergencyUpdateInfo?.version) {
      await tryEmergencyUpdateCheckFromBackup();
    }
    if (!emergencyUpdateInfo?.url || !emergencyUpdateInfo?.version) {
      return { ok: false, error: 'emergency_update_unavailable' };
    }
    const info = emergencyUpdateInfo;
    const tempDir = require('path').join(app.getPath('temp'), 'avatool-emergency-update');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const fileNameFromPath = require('path').basename(String(info.path || ''));
    const fallbackName = `Avatool Setup ${String(info.version || '').trim()}.exe`;
    const installerName = String(fileNameFromPath || fallbackName).trim();
    const outPath = require('path').join(tempDir, installerName);
    emitAppUpdateStatus({
      phase: 'download-progress',
      percent: 0,
      message: `緊急アップデート ${info.version} のダウンロードを開始します...`,
    });
    await downloadFileWithProgress(info.url, outPath, (loaded, total) => {
      const percent = total > 0 ? Math.max(0, Math.min(100, (loaded / total) * 100)) : 0;
      emitAppUpdateStatus({
        phase: 'download-progress',
        percent,
        message: `緊急アップデートをダウンロード中 ${Math.round(percent)}%`,
      });
    });
    if (info.sha512) {
      const got = await computeFileSha512Base64(outPath);
      if (String(got || '').trim() !== String(info.sha512 || '').trim()) {
        try { fs.unlinkSync(outPath); } catch {}
        throw new Error('緊急アップデート検証失敗: sha512 mismatch');
      }
    }
    emergencyUpdateInfo = { ...info, downloadedPath: outPath };
    appUpdateAvailableInfo = {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
      emergency: true,
    };
    emitAppUpdateStatus({
      phase: 'downloaded',
      version: info.version,
      releaseNotes: info.releaseNotes,
      message: '緊急アップデートのダウンロードが完了しました。更新を実行してください。',
    });
    return { ok: true, emergency: true, path: outPath, version: info.version };
  }

  // ---- main updater setup ----

  function setupAppUpdater() {
    if (appUpdaterInitialized) return;
    appUpdaterInitialized = true;
    if (!electronAutoUpdater) {
      emitAppUpdateStatus({ phase: 'unavailable', message: 'electron-updater が利用できません。' });
      return;
    }
    electronAutoUpdater.autoDownload = true;
    electronAutoUpdater.autoInstallOnAppQuit = false;
    electronAutoUpdater.disableDifferentialDownload = true;

    electronAutoUpdater.on('checking-for-update', () => {
      emitAppUpdateStatus({ phase: 'checking', message: 'アプリ更新をチェック中...' });
    });
    electronAutoUpdater.on('update-available', (info) => {
      appUpdateAvailableInfo = info || null;
      emergencyUpdateInfo = null;
      const releaseNotes = normalizeReleaseNotesValue(info?.releaseNotes);
      emitAppUpdateStatus({
        phase: 'available',
        version: String(info?.version || ''),
        releaseDate: String(info?.releaseDate || ''),
        releaseNotes,
        message: `新しいバージョン ${String(info?.version || '')} が見つかりました。`,
      });
    });
    electronAutoUpdater.on('update-not-available', (info) => {
      appUpdateAvailableInfo = null;
      emergencyUpdateInfo = null;
      emitAppUpdateStatus({
        phase: 'not-available',
        version: String(info?.version || ''),
        message: '現在のバージョンは最新です。',
      });
    });
    electronAutoUpdater.on('error', (err) => {
      emitAppUpdateStatus({
        phase: 'error',
        message: `更新チェック失敗: ${err?.message || String(err)}`,
      });
    });
    electronAutoUpdater.on('download-progress', (progress) => {
      emitAppUpdateStatus({
        phase: 'download-progress',
        percent: Number(progress?.percent || 0),
        message: `更新ダウンロード中 ${Math.round(Number(progress?.percent || 0))}%`,
      });
    });
    electronAutoUpdater.on('update-downloaded', (info) => {
      const releaseNotes = normalizeReleaseNotesValue(info?.releaseNotes || appUpdateAvailableInfo?.releaseNotes);
      emitAppUpdateStatus({
        phase: 'downloaded',
        version: String(info?.version || ''),
        releaseNotes,
        message: '更新のダウンロードが完了しました。再起動で適用されます。',
      });
    });
  }

  async function checkForAppUpdate(manual = false) {
    if (!electronAutoUpdater) {
      return { ok: false, error: 'auto_updater_unavailable' };
    }
    if (!app.isPackaged) {
      if (manual) {
        emitAppUpdateStatus({ phase: 'skipped-dev', message: '開発モードでは更新チェックをスキップします。' });
      }
      return { ok: false, error: 'not_packaged' };
    }
    if (appUpdateCheckPromise) {
      if (manual) emitAppUpdateStatus({ phase: 'checking', message: '更新チェック実行中です。' });
      return await appUpdateCheckPromise;
    }
    appUpdateCheckPromise = (async () => {
      try {
        await electronAutoUpdater.checkForUpdates();
        return { ok: true };
      } catch (e) {
        const msg = e?.message || String(e);
        if (isLikelyLatestYmlParseError(e)) {
          try {
            emitAppUpdateStatus({ phase: 'checking', message: '通常更新情報の解析に失敗したため、緊急更新情報を確認中...' });
            const fallbackRes = await tryEmergencyUpdateCheckFromBackup();
            if (fallbackRes?.ok) return fallbackRes;
          } catch (fallbackErr) {
            const fmsg = fallbackErr?.message || String(fallbackErr);
            emitAppUpdateStatus({ phase: 'error', message: `更新チェック失敗: ${msg} / 緊急更新確認失敗: ${fmsg}` });
            return { ok: false, error: `${msg} / ${fmsg}` };
          }
        }
        emitAppUpdateStatus({ phase: 'error', message: `更新チェック失敗: ${msg}` });
        return { ok: false, error: msg };
      } finally {
        appUpdateCheckPromise = null;
      }
    })();
    return await appUpdateCheckPromise;
  }

  async function startAppUpdateDownload() {
    if (!electronAutoUpdater) {
      return { ok: false, error: 'auto_updater_unavailable' };
    }
    if (!app.isPackaged) {
      emitAppUpdateStatus({ phase: 'skipped-dev', message: '開発モードではアップデートを開始できません。' });
      return { ok: false, error: 'not_packaged' };
    }
    if (appUpdateDownloadPromise) {
      emitAppUpdateStatus({ phase: 'download-progress', message: 'アップデートをダウンロード中です。' });
      return await appUpdateDownloadPromise;
    }
    appUpdateDownloadPromise = (async () => {
      try {
        if (appUpdateCheckPromise) {
          await appUpdateCheckPromise;
        }
        if (!appUpdateAvailableInfo) {
          emitAppUpdateStatus({ phase: 'checking', message: 'アップデート情報を確認中...' });
          await checkForAppUpdate(false);
        }
        if (!appUpdateAvailableInfo?.version) {
          emitAppUpdateStatus({ phase: 'not-available', message: '現在のバージョンは最新です。' });
          return { ok: false, error: 'not_available' };
        }
        if (appUpdateAvailableInfo?.emergency) {
          return await startEmergencyUpdateDownload();
        }
        emitAppUpdateStatus({
          phase: 'download-progress',
          percent: 0,
          message: `アップデート ${String(appUpdateAvailableInfo.version)} のダウンロードを開始します...`,
        });
        await electronAutoUpdater.downloadUpdate();
        return { ok: true };
      } catch (e) {
        const msg = e?.message || String(e);
        if (isLikelyLatestYmlParseError(e)) {
          try {
            emitAppUpdateStatus({ phase: 'checking', message: '通常更新ダウンロードに失敗したため、緊急更新へ切り替え中...' });
            await tryEmergencyUpdateCheckFromBackup();
            return await startEmergencyUpdateDownload();
          } catch (fallbackErr) {
            const fmsg = fallbackErr?.message || String(fallbackErr);
            emitAppUpdateStatus({ phase: 'error', message: `アップデート開始失敗: ${msg} / 緊急更新失敗: ${fmsg}` });
            return { ok: false, error: `${msg} / ${fmsg}` };
          }
        }
        emitAppUpdateStatus({ phase: 'error', message: `アップデート開始失敗: ${msg}` });
        return { ok: false, error: msg };
      } finally {
        appUpdateDownloadPromise = null;
      }
    })();
    return await appUpdateDownloadPromise;
  }

  async function installAppUpdateNow() {
    if (emergencyUpdateInfo?.downloadedPath && fs.existsSync(emergencyUpdateInfo.downloadedPath)) {
      try {
        const openErr = await shell.openPath(emergencyUpdateInfo.downloadedPath);
        if (openErr) return { ok: false, error: openErr };
        setTimeout(() => {
          try { app.quit(); } catch {}
        }, 300);
        return { ok: true, emergency: true };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    }
    if (!electronAutoUpdater) return { ok: false, error: 'auto_updater_unavailable' };
    if (!app.isPackaged) return { ok: false, error: 'not_packaged' };
    try {
      setImmediate(() => {
        try {
          electronAutoUpdater.quitAndInstall(false, true);
        } catch {
          // ignore
        }
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  function getAppUpdateAvailableInfo() {
    return appUpdateAvailableInfo;
  }

  return {
    setupAppUpdater,
    checkForAppUpdate,
    startAppUpdateDownload,
    installAppUpdateNow,
    emitAppUpdateStatus,
    getAppUpdateAvailableInfo,
    _test: {
      parseSemverInfo,
      compareSemverAscSimple,
      normalizeReleaseNotesValue,
      parseEmergencyLatestBackupYml,
      trimWrappedQuotes,
      isLikelyLatestYmlParseError,
    },
  };
}

module.exports = { createAppUpdater };
