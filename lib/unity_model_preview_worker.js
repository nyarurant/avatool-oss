'use strict';

/**
 * Worker thread entry for unitypackage preview extraction.
 * Keeps Electron main process free so the UI does not show "応答なし".
 */
const { parentPort, workerData } = require('worker_threads');

try {
  const {
    extractRelevantAssetsFromPackageSync,
    refreshCachedVrcComponentsSync,
  } = require('./unity_model_preview');
  const pkgPath = workerData?.pkgPath;
  const itemDir = workerData?.itemDir;
  if (workerData?.action === 'refresh-vrc' && workerData?.cacheDir) {
    parentPort.postMessage(refreshCachedVrcComponentsSync(workerData.cacheDir));
  } else if (!pkgPath || !itemDir) {
    parentPort.postMessage({ error: 'invalid_worker_data' });
  } else {
    const result = extractRelevantAssetsFromPackageSync(pkgPath, itemDir);
    parentPort.postMessage(result);
  }
} catch (e) {
  parentPort.postMessage({ error: e?.message || String(e) });
}
