'use strict';

/**
 * `AVATOOL_UI_PROBE`環境変数が設定されているとき、起動後のレンダラーを合成イベントで
 * 一通り操作してスクリーンショット・DOM状態をダンプするデバッグ専用機能。
 * main.js から切り出し。mainWindow はレンダラー再起動等で差し替わるため、
 * モジュールロード時に一度だけ束縛せず getMainWindow() で都度取得する。
 */
function createUiProbeService({ getMainWindow, fs, path, app, appDataRoot }) {
  let uiProbeStarted = false;

  function isUiProbeEnabled() {
    return String(process.env.AVATOOL_UI_PROBE || '').trim().length > 0;
  }

  function getUiProbeOutputDir() {
    const raw = String(process.env.AVATOOL_UI_PROBE || '').trim();
    return raw ? path.resolve(raw) : '';
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function captureUiProbeStep(rows, step, note = '') {
    const outDir = getUiProbeOutputDir();
    const win = getMainWindow();
    if (!outDir || !win || win.isDestroyed()) return;
    fs.mkdirSync(outDir, { recursive: true });
    const webContents = win.webContents;
    const safeStep = String(step || 'step').replace(/[^A-Za-z0-9_.-]+/g, '_');
    const screenshotPath = path.join(outDir, `${String(rows.length + 1).padStart(2, '0')}_${safeStep}.png`);
    const statePath = path.join(outDir, `${String(rows.length + 1).padStart(2, '0')}_${safeStep}.json`);
    const image = await webContents.capturePage();
    fs.writeFileSync(screenshotPath, image.toPNG());
    const state = await webContents.executeJavaScript(`(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const textOf = (sel) => String(document.querySelector(sel)?.textContent || '').trim();
      const overflows = Array.from(document.querySelectorAll('button, input, select, .dl-btn, .nav-item, .status-mini-btn, .queue-pill'))
        .filter(isVisible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName,
            id: el.id || '',
            className: String(el.className || '').slice(0, 120),
            text: String(el.textContent || el.value || '').trim().slice(0, 120),
            clientWidth: Math.round(el.clientWidth || rect.width || 0),
            scrollWidth: Math.round(el.scrollWidth || 0),
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          };
        })
        .filter((row) => row.scrollWidth > row.clientWidth + 2)
        .slice(0, 50);
      const visibleModals = Array.from(document.querySelectorAll('[id$="-modal"], #preview-overlay, #queue-failed-details'))
        .filter(isVisible)
        .map((el) => el.id || el.className || el.tagName);
      const downloadButtons = Array.from(document.querySelectorAll('.dl-btn')).slice(0, 20).map((button) => ({
        text: String(button.textContent || '').trim(),
        disabled: Boolean(button.disabled),
        itemId: String(button.closest('[data-item-id]')?.dataset?.itemId || ''),
      }));
      const assetCards = Array.from(document.querySelectorAll('[data-item-id]')).slice(0, 20).map((card) => ({
        itemId: String(card?.dataset?.itemId || ''),
        text: String(card?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
        avatarNames: Array.from(card.querySelectorAll('[data-avatar-name]')).map((el) => String(el.dataset.avatarName || '')),
      }));
      let probeAsset = null;
      let probeFilteredAsset = null;
      try {
        probeAsset = state?.assetByItemId?.get?.('9001') || null;
        probeFilteredAsset = (Array.isArray(state?.filteredAssets) ? state.filteredAssets : [])
          .find((asset) => String(asset?.itemId || '') === '9001') || null;
      } catch {}
      return {
        timestamp: new Date().toISOString(),
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        title: document.title,
        ownerBadgeVisible: isVisible(document.querySelector('#owner-edition-badge')),
        ownerVaultTabVisible: isVisible(document.querySelector('#owner-vault-tab')),
        ownerVaultPanelVisible: isVisible(document.querySelector('#owner-vault-panel')),
        assetChildren: document.querySelectorAll('#asset-grid > *').length,
        assetCards: document.querySelectorAll('.asset-card, [data-item-id]').length,
        queue: {
          state: textOf('#queue-state'),
          queued: textOf('#queue-queued'),
          running: textOf('#queue-running'),
          done: textOf('#queue-done'),
          failed: textOf('#queue-failed'),
          statusText: textOf('#queue-status-text'),
        },
        searchValue: String(document.querySelector('#search-input')?.value || ''),
        settingsOpen: isVisible(document.querySelector('#settings-modal')),
        visibleModals,
        downloadButtons,
        assetCards,
        probeAsset9001: probeAsset ? {
          downloaded: Boolean(probeAsset.downloaded),
          supportedAvatars: probeAsset.supportedAvatars || null,
          supportedAvatarsInferred: probeAsset.supportedAvatarsInferred || null,
          supportedAvatarAnalysis: probeAsset.supportedAvatarAnalysis || null,
          avatarAnalysisCheckedAt: probeAsset.avatarAnalysisCheckedAt || null,
        } : null,
        probeFilteredAsset9001: probeFilteredAsset ? {
          downloaded: Boolean(probeFilteredAsset.downloaded),
          supportedAvatars: probeFilteredAsset.supportedAvatars || null,
          supportedAvatarsInferred: probeFilteredAsset.supportedAvatarsInferred || null,
          supportedAvatarAnalysis: probeFilteredAsset.supportedAvatarAnalysis || null,
        } : null,
        textOverflowCount: overflows.length,
        textOverflows: overflows,
        bodyTextSample: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1000),
      };
    })()`, true);
    const row = {
      step,
      note,
      screenshotPath,
      statePath,
      state,
    };
    rows.push(row);
    fs.writeFileSync(statePath, JSON.stringify(row, null, 2), 'utf8');
  }

  async function runUiProbe() {
    if (uiProbeStarted || !isUiProbeEnabled()) return;
    uiProbeStarted = true;
    const outDir = getUiProbeOutputDir();
    const rows = [];
    let exitCode = 0;
    try {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('main_window_not_available');
      mainWindow.setSize(1400, 900);
      mainWindow.show();
      await delay(700);
      await mainWindow.webContents.executeJavaScript(`(() => {
        try { localStorage.setItem('assetViewMode', 'grid'); } catch {}
        try {
          state.viewMode = 'grid';
          renderGrid();
        } catch {
          document.querySelector('#view-grid-btn')?.click();
        }
      })()`, true);
      await delay(350);

      await captureUiProbeStep(rows, 'ready', 'Initial renderer-ready state');

      await mainWindow.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('#search-input');
        if (input) {
          input.focus();
          input.value = 'Probe';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`, true);
      await delay(650);
      await captureUiProbeStep(rows, 'search_probe', 'Search input pseudo-click/input');

      await mainWindow.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('#search-input');
        if (input) {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`, true);
      await delay(350);

      await mainWindow.webContents.executeJavaScript(`document.querySelector('#settings-btn')?.click()`, true);
      await delay(700);
      await captureUiProbeStep(rows, 'settings_modal', 'Settings button pseudo-click');

      if (String(process.env.AVATOOL_EDITION || '').trim().toLowerCase() === 'owner') {
        await mainWindow.webContents.executeJavaScript(`document.querySelector('#owner-vault-tab')?.click()`, true);
        await delay(350);
        await captureUiProbeStep(rows, 'owner_vault_panel', 'Owner Vault tab pseudo-click');
      }

      await mainWindow.webContents.executeJavaScript(`document.querySelector('#settings-close')?.click()`, true);
      await delay(350);

      mainWindow.webContents.send('download-queue', {
        status: 'running',
        queued: 0,
        running: [{ itemId: '9001', title: 'Probe Outfit' }],
        done: 0,
        failed: [],
        paused: false,
        concurrency: 2,
      });
      mainWindow.webContents.send('download-progress', {
        itemId: '9001',
        phase: 'downloading',
        status: 'progress',
        fileName: 'probe-outfit.zip',
        fileIndex: 1,
        fileTotal: 1,
        receivedBytes: 48,
        totalBytes: 100,
      });
      await delay(400);
      await captureUiProbeStep(rows, 'download_progress', 'Synthetic download-progress event');

      mainWindow.webContents.send('download-progress', {
        itemId: '9001',
        phase: 'extracting',
        status: 'entry',
        zipIndex: 1,
        zipTotal: 1,
        entryIndex: 5,
        entryTotal: 20,
        currentEntry: 'Assets/Probe/Prefab.prefab',
      });
      await delay(400);
      await captureUiProbeStep(rows, 'extracting', 'Synthetic extracting event');

      mainWindow.webContents.send('download-progress', {
        itemId: '9001',
        phase: 'done',
        fileIndex: 1,
        fileTotal: 1,
        receivedBytes: 100,
        totalBytes: 100,
      });
      mainWindow.webContents.send('download-queue', {
        status: 'idle',
        queued: 0,
        running: [],
        done: 1,
        failed: [],
        paused: false,
        concurrency: 2,
      });
      await delay(600);
      await captureUiProbeStep(rows, 'download_done', 'Synthetic done event');

      const refreshedAssets = await mainWindow.webContents.executeJavaScript(`window.boothAPI?.loadAssets?.()`, true);
      if (refreshedAssets?.['9001']) {
        refreshedAssets['9001'].downloaded = false;
        refreshedAssets['9001'].supportedAvatars = ['Probe Avatar'];
        refreshedAssets['9001'].supportedAvatarsInferred = ['Probe Avatar'];
        refreshedAssets['9001'].supportedAvatarAnalysis = {
          status: 'confirmed',
          primaryAvatar: 'Probe Avatar',
          candidates: [{ name: 'Probe Avatar', score: 98, reasons: ['ui-probe'] }],
        };
        refreshedAssets['9001'].avatarAnalysisCheckedAt = new Date().toISOString();
      }
      mainWindow.webContents.send('assets-refreshed', refreshedAssets);
      await delay(1200);
      await captureUiProbeStep(rows, 'avatar_refreshed', 'Synthetic assets-refreshed after queue settle');

      mainWindow.webContents.send('download-progress', {
        itemId: '9003',
        phase: 'failed',
        reason: 'probe_failure',
      });
      mainWindow.webContents.send('download-queue', {
        status: 'idle',
        queued: 0,
        running: [],
        done: 1,
        failed: [{ itemId: '9003', title: 'Probe Broken Archive', reason: 'probe_failure', step: 'download' }],
        paused: false,
        concurrency: 2,
      });
      await delay(500);
      await captureUiProbeStep(rows, 'download_failed', 'Synthetic failed event');
    } catch (e) {
      exitCode = 1;
      rows.push({
        step: 'error',
        error: e?.stack || e?.message || String(e),
        timestamp: new Date().toISOString(),
      });
    } finally {
      try {
        if (outDir) {
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(path.join(outDir, 'ui_probe_report.json'), JSON.stringify({
            ok: exitCode === 0,
            appDataRoot,
            outputDir: outDir,
            steps: rows,
          }, null, 2), 'utf8');
        }
      } catch { /* デバッグ用レポート書き込みの失敗は無視 */ }
      setTimeout(() => {
        try { app.exit(exitCode); } catch { /* 終了処理失敗は無視 */ }
      }, 200);
    }
  }

  return {
    isUiProbeEnabled,
    runUiProbe,
  };
}

module.exports = { createUiProbeService };
