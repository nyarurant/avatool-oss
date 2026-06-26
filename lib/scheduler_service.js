'use strict';

const { isWithinHourWindow } = require('./utils');

function createSchedulerService(deps) {
  const {
    getSettings,
    getMainWindow,
    normalizeConcurrency,
    normalizeSchedulerProfile,
    loadOrGenerateMeta,
    generateLibraryMeta,
    applyVersionTrackingKeepingManual,
    writeMetaFile,
    setMetaCache,
    showDesktopNotification,
    appendOperationLog,
    processQueue,
    dedupeMetaItemsByItemId,
    queueMgr,
    checkForAppUpdate,
    getElectronAutoUpdater,
    APP_UPDATE_AUTO_CHECK_INTERVAL_MIN,
  } = deps;

  let autoCheckTimer = null;
  let schedulerTimer = null;
  let appUpdateAutoCheckTimer = null;

  function applySchedulerProfileToConcurrency() {
    const settings = getSettings();
    const profile = normalizeSchedulerProfile(settings.downloadSchedulerProfile);
    const profileConcurrency = profile === 'light' ? 1 : profile === 'fast' ? 4 : 2;
    queueMgr.getQueueState().concurrency = normalizeConcurrency(profileConcurrency);
  }

  async function enqueueUndownloadedFromMeta(limit = 40) {
    const mw = getMainWindow();
    let meta = [];
    try {
      meta = dedupeMetaItemsByItemId(await loadOrGenerateMeta({ sender: mw?.webContents }, 'scheduler'));
    } catch {
      meta = [];
    }
    const targets = meta
      .filter((a) => !a?.downloaded && Array.isArray(a?.files) && a.files.length > 0)
      .slice(0, Math.max(1, Math.min(200, Number(limit || 40))));
    if (!targets.length) return { ok: true, queued: 0 };
    const settings = getSettings();
    let added = 0;
    for (const asset of targets) {
      const id = String(asset?.itemId || '');
      if (!id) continue;
      const qs = queueMgr.getQueueState();
      const alreadyQueued = qs.queued.some((q) => String(q.itemId) === id);
      const runningNow = qs.running.has(id);
      if (alreadyQueued || runningNow) continue;
      qs.queued.push({
        itemId: asset.itemId,
        title: asset.title || '',
        asset: { ...asset, files: Array.isArray(asset.files) ? asset.files : [] },
        attempt: 0,
        nextRunAt: 0,
        source: 'scheduler',
      });
      added += 1;
    }
    if (added > 0) {
      appendOperationLog('scheduler', `スケジューラが ${added} 件をキュー追加しました`, {
        profile: settings.downloadSchedulerProfile,
        startHour: settings.downloadSchedulerStartHour,
        endHour: settings.downloadSchedulerEndHour,
      });
      processQueue(getMainWindow()?.webContents);
    }
    return { ok: true, queued: added };
  }

  async function maybeRunScheduledDownloads() {
    const settings = getSettings();
    if (!settings.downloadSchedulerEnabled) return;
    const now = new Date();
    const hour = now.getHours();
    if (!isWithinHourWindow(hour, settings.downloadSchedulerStartHour, settings.downloadSchedulerEndHour)) return;
    if (queueMgr.getQueueState().paused) return;
    applySchedulerProfileToConcurrency();
    await enqueueUndownloadedFromMeta(40);
  }

  function startAutoCheckTimer() {
    if (autoCheckTimer) clearInterval(autoCheckTimer);
    const settings = getSettings();
    const intervalMin = Number(settings.autoCheckInterval || 0);
    if (!intervalMin || intervalMin <= 0) return;

    let autoCheckRunning = false;
    autoCheckTimer = setInterval(async () => {
      if (autoCheckRunning) return;
      const mw = getMainWindow();
      if (!mw || mw.isDestroyed()) return;
      autoCheckRunning = true;
      try {
        const pseudoEvent = { sender: mw.webContents };
        const existing = await loadOrGenerateMeta(pseudoEvent, 'auto-check');
        const latest = await generateLibraryMeta(() => {}, () => {}, {
          lightweight: true,
          persist: false,
        });
        const { items, updates } = applyVersionTrackingKeepingManual(existing, latest, new Date().toISOString());
        writeMetaFile(items);
        setMetaCache(items);
        if (updates.length > 0) {
          showDesktopNotification('更新を検出', `${updates.length}件の更新を検出しました。`);
          mw.webContents.send('update-notification', {
            updates,
            totalUpdates: updates.length,
          });
        }
      } catch (e) {
        console.error('Auto check failed:', e?.message || e);
      } finally {
        autoCheckRunning = false;
      }
    }, intervalMin * 60 * 1000);
  }

  function startDownloadScheduler() {
    if (schedulerTimer) clearInterval(schedulerTimer);
    const settings = getSettings();
    if (!settings.downloadSchedulerEnabled) return;
    schedulerTimer = setInterval(() => {
      maybeRunScheduledDownloads().catch(() => {});
    }, 60 * 1000);
    maybeRunScheduledDownloads().catch(() => {});
  }

  function startAppUpdateAutoCheckTimer() {
    if (appUpdateAutoCheckTimer) {
      clearInterval(appUpdateAutoCheckTimer);
      appUpdateAutoCheckTimer = null;
    }
    if (!getElectronAutoUpdater()) return;
    const intervalMs = APP_UPDATE_AUTO_CHECK_INTERVAL_MIN * 60 * 1000;
    appUpdateAutoCheckTimer = setInterval(() => {
      checkForAppUpdate(false).catch(() => {});
    }, intervalMs);
  }

  function stopAll() {
    if (autoCheckTimer) { clearInterval(autoCheckTimer); autoCheckTimer = null; }
    if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
    if (appUpdateAutoCheckTimer) { clearInterval(appUpdateAutoCheckTimer); appUpdateAutoCheckTimer = null; }
  }

  return {
    startAutoCheckTimer,
    startDownloadScheduler,
    startAppUpdateAutoCheckTimer,
    maybeRunScheduledDownloads,
    applySchedulerProfileToConcurrency,
    enqueueUndownloadedFromMeta,
    stopAll,
  };
}

module.exports = { createSchedulerService };
