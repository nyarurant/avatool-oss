(function attachRenderStorageUsageUi(global) {
  function createRenderStorageUsageUi(deps) {
    const domRefs = deps?.domRefs || {};
    const boothAPI = deps?.boothAPI || global.boothAPI;

    let storageRefreshTimer = null;
    let storageRefreshInFlight = false;

    function formatBytes(bytes) {
      const n = Number(bytes || 0);
      if (!Number.isFinite(n) || n <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      const idx = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
      const v = n / Math.pow(1024, idx);
      return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[idx]}`;
    }

    async function refreshStorageUsageUI() {
      if (!boothAPI?.getStorageUsage) return;
      if (storageRefreshInFlight) return;
      storageRefreshInFlight = true;
      try {
        const res = await boothAPI.getStorageUsage();
        if (!res || res.error) return;
        const appBytes = Number(res.appBytes || res.totalBytes || 0);
        const driveTotal = Number(res.drive?.totalBytes || 0);
        const driveUsed = Number(res.drive?.usedBytes || 0);
        const otherUsed = Math.max(0, driveUsed - appBytes);
        if (domRefs.storageUsageText) {
          if (driveTotal > 0) {
            domRefs.storageUsageText.textContent = `${formatBytes(appBytes)} / ${formatBytes(driveTotal)}`;
            domRefs.storageUsageText.title = `アプリ ${appBytes.toLocaleString()} バイト / ドライブ ${driveTotal.toLocaleString()} バイト`;
          } else {
            domRefs.storageUsageText.textContent = formatBytes(appBytes);
            domRefs.storageUsageText.title = `${appBytes.toLocaleString()} バイト`;
          }
        }
        if (driveTotal > 0) {
          const appPct = Math.max(0, Math.min(100, (appBytes / driveTotal) * 100));
          const otherPct = Math.max(0, Math.min(100, (otherUsed / driveTotal) * 100));
          if (domRefs.storageOtherBar) {
            domRefs.storageOtherBar.style.width = `${otherPct}%`;
            domRefs.storageOtherBar.title = `その他使用量: ${formatBytes(otherUsed)} (${otherPct.toFixed(2)}%)`;
          }
          if (domRefs.storageAppBar) {
            domRefs.storageAppBar.style.left = `${otherPct}%`;
            domRefs.storageAppBar.style.width = `${appPct}%`;
            domRefs.storageAppBar.title = `アプリ使用量: ${formatBytes(appBytes)} (${appPct.toFixed(2)}%)`;
          }
          if (domRefs.storageBreakdown) {
            domRefs.storageBreakdown.textContent = `アプリ ${appPct.toFixed(2)}% / その他 ${otherPct.toFixed(2)}%`;
          }
        } else {
          if (domRefs.storageOtherBar) domRefs.storageOtherBar.style.width = '0%';
          if (domRefs.storageAppBar) {
            domRefs.storageAppBar.style.left = '0%';
            domRefs.storageAppBar.style.width = '0%';
          }
          if (domRefs.storageBreakdown) {
            domRefs.storageBreakdown.textContent = `アプリ ${formatBytes(appBytes)}`;
          }
        }
      } catch (e) {
        console.warn('storage usage refresh failed', e);
      } finally {
        storageRefreshInFlight = false;
      }
    }

    function scheduleStorageUsageRefresh(delay = 800) {
      if (storageRefreshTimer) clearTimeout(storageRefreshTimer);
      storageRefreshTimer = setTimeout(() => {
        storageRefreshTimer = null;
        refreshStorageUsageUI().catch(() => {});
      }, delay);
    }

    return {
      formatBytes,
      refreshStorageUsageUI,
      scheduleStorageUsageRefresh,
    };
  }

  global.AvatoolRenderStorageUsageUi = {
    createRenderStorageUsageUi,
  };
})(window);
