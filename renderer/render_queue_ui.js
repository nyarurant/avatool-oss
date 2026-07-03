(function attachRenderQueueUi(global) {
  function createRenderQueueUI(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const boothAPI = deps?.boothAPI;
    const getAssetByItemId = deps?.getAssetByItemId;
    const getTileEntryByItemId = deps?.getTileEntryByItemId;
    const refreshVisibleTileActionStates = deps?.refreshVisibleTileActionStates;
    const syncDownloadStateFromLatestMapNoRerender = deps?.syncDownloadStateFromLatestMapNoRerender;
    const markAssetUpdateSeen = deps?.markAssetUpdateSeen;
    const scheduleStorageUsageRefresh = deps?.scheduleStorageUsageRefresh;
    const getUndownloadedAssets = deps?.getUndownloadedAssets;
    const getDownloadableAssets = deps?.getDownloadableAssets;
    const enqueueAssets = deps?.enqueueAssets;
    const showTransientMessage = deps?.showTransientMessage;
    const showDownloadScopeModal = deps?.showDownloadScopeModal;
    const showConfirmModal = deps?.showConfirmModal;
    const downloadProgressFlushMs = Number(deps?.downloadProgressFlushMs || 66);
    const queueStatusFlushMs = Number(deps?.queueStatusFlushMs || 180);
    const logger = deps?.logger || global.console;

    if (!state || !boothAPI || typeof getAssetByItemId !== 'function' || typeof getTileEntryByItemId !== 'function') {
      throw new Error('createRenderQueueUI requires state, boothAPI, and asset/tile accessors.');
    }

    const pendingDownloadProgressByItem = new Map();
    let downloadProgressFlushTimer = null;
    let pendingQueueStatus = null;
    let queueStatusFlushTimer = null;
    let queueStatusLastRenderedAt = 0;
    let queueFailedSignatureCache = '';
    let wasQueueActive = false;
    let queueSettledReloadInFlight = false;
    let lastQueueSettledAt = 0;
    let eventsBound = false;

    function normalizeRunningList(runningValue) {
      return Array.isArray(runningValue)
        ? runningValue
        : (runningValue ? [runningValue] : []);
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function renderQueueStatus(status) {
      state.queue = {
        ...state.queue,
        ...(status || {}),
      };

      const queued = Number(state.queue.queued || 0);
      const done = Number(state.queue.done || 0);
      const failed = Array.isArray(state.queue.failed) ? state.queue.failed : [];
      const running = normalizeRunningList(state.queue.running);
      const runningText = running.length > 0
        ? `${running.map((r) => `${r.itemId}:${(r.title || '').trim()}`).join(', ').slice(0, 80)}${running.length > 1 ? '...' : ''}`
        : '-';
      const statusText = state.queue.paused ? 'paused' : (state.queue.status || 'idle');
      const statusLabel = statusText === 'running'
        ? '実行中'
        : statusText === 'processing'
          ? '処理中'
          : statusText === 'paused'
            ? '一時停止'
            : '待機';
      const safeRunningText = runningText || '-';

      const hasStructuredQueueStatus = Boolean(
        domRefs.queueState &&
        domRefs.queueQueued &&
        domRefs.queueRunning &&
        domRefs.queueDone &&
        domRefs.queueFailed
      );

      if (hasStructuredQueueStatus) {
        domRefs.queueState.textContent = statusLabel;
        domRefs.queueState.classList.remove('status-idle', 'status-running', 'status-paused');
        if (statusText === 'running' || statusText === 'processing') domRefs.queueState.classList.add('status-pill', 'status-running');
        else if (statusText === 'paused') domRefs.queueState.classList.add('status-pill', 'status-paused');
        else domRefs.queueState.classList.add('status-pill', 'status-idle');
        domRefs.queueQueued.textContent = String(queued);
        domRefs.queueRunning.textContent = safeRunningText;
        domRefs.queueDone.textContent = String(done);
        domRefs.queueFailed.textContent = String(failed.length);
        // 構造化表示（キュー/完了などの個別スパン）が既に同じ数値を並べて表示しているため、
        // ここで重複する要約テキストは出さない。
        if (domRefs.queueStatusText) {
          domRefs.queueStatusText.textContent = '';
        }
      } else if (domRefs.queueStatusText) {
        domRefs.queueStatusText.textContent = `ダウンロード状況: ${statusLabel} / 待機 ${queued} / 実行 ${safeRunningText} / 完了 ${done} / 失敗 ${failed.length}`;
      }

      if (domRefs.queueToggleBtn) {
        domRefs.queueToggleBtn.textContent = state.queue.paused ? 'キュー再開' : 'キュー停止';
      }
      if (domRefs.retryFailedBtn) {
        domRefs.retryFailedBtn.disabled = failed.length === 0;
      }
      if (domRefs.queueFailedList) {
        if (!failed.length) {
          if (queueFailedSignatureCache !== 'none') {
            domRefs.queueFailedList.innerHTML = '';
            queueFailedSignatureCache = 'none';
          }
          if (domRefs.queueFailedDetails) domRefs.queueFailedDetails.classList.add('hidden');
        } else {
          if (domRefs.queueFailedDetails) domRefs.queueFailedDetails.classList.remove('hidden');
          const signature = failed
            .map((f) => `${f.itemId}|${f.title}|${f.reason}|${f.step || ''}|${f.statusCode || ''}`)
            .join('\n');
          if (queueFailedSignatureCache !== signature) {
            queueFailedSignatureCache = signature;
            domRefs.queueFailedList.innerHTML = failed
              .map((f) => `
                <div class="border border-red-900 bg-red-950/20 p-2 text-[9px]">
                  <div class="text-red-300">${escapeHtml(f.itemId)} - ${escapeHtml(f.title)}</div>
                  <div class="text-red-400 font-mono-custom mt-1">
                    ${escapeHtml(f.reason)}
                    ${f.step ? ` [${escapeHtml(f.step)}]` : ''}
                    ${f.statusCode ? ` (HTTP ${escapeHtml(f.statusCode)})` : ''}
                  </div>
                </div>
              `)
              .join('');
          }
        }
      }

      const queueActiveByStatus = statusText === 'running' || statusText === 'processing';
      const isQueueActive = queueActiveByStatus || queued > 0 || running.length > 0;
      if (!isQueueActive && wasQueueActive) {
        lastQueueSettledAt = Date.now();
        if (typeof refreshVisibleTileActionStates === 'function') {
          refreshVisibleTileActionStates();
        }
        if (!queueSettledReloadInFlight && typeof syncDownloadStateFromLatestMapNoRerender === 'function') {
          queueSettledReloadInFlight = true;
          syncDownloadStateFromLatestMapNoRerender()
            .catch((error) => logger?.warn?.('syncDownloadStateFromLatestMapNoRerender failed:', error))
            .then(() => {
              if (typeof refreshVisibleTileActionStates === 'function') {
                refreshVisibleTileActionStates();
              }
            })
            .finally(() => {
              queueSettledReloadInFlight = false;
            });
        }
      }
      wasQueueActive = isQueueActive;

      if (typeof scheduleStorageUsageRefresh === 'function') {
        scheduleStorageUsageRefresh(1200);
      }
    }

    function isQueueLikelyActiveNow() {
      const queued = Number(state.queue?.queued || 0);
      const running = normalizeRunningList(state.queue?.running);
      const statusText = state.queue?.paused ? 'paused' : String(state.queue?.status || 'idle');
      return statusText === 'running' || statusText === 'processing' || queued > 0 || running.length > 0;
    }

    function applyDownloadProgress(progress) {
      const entry = getTileEntryByItemId(progress.itemId);
      const { statusEl, progWrapper, bytesBar, filesBar, filesLabel, downloadBtn } = entry || {};

      if (progWrapper) {
        progWrapper.classList.remove('opacity-0');
        progWrapper.classList.add('opacity-100');
      }

      if (progress.phase === 'downloading') {
        if (downloadBtn && !downloadBtn.disabled) {
          downloadBtn.disabled = true;
          downloadBtn.classList.add('opacity-60');
        }
        if (bytesBar && bytesBar.classList.contains('indeterminate')) {
          bytesBar.classList.remove('indeterminate');
          bytesBar.style.width = '0%';
        }

        if (bytesBar && progress.totalBytes > 0) {
          const percentBytes = Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100));
          bytesBar.style.width = `${percentBytes}%`;
        }

        if (progress.fileTotal > 0) {
          const idx = Math.min(progress.fileIndex || 0, progress.fileTotal);
          const percentFiles = Math.min(100, Math.round((idx / progress.fileTotal) * 100));
          if (filesBar) filesBar.style.width = `${percentFiles}%`;
          if (filesLabel) filesLabel.textContent = `${idx}/${progress.fileTotal}`;
          if (statusEl) statusEl.textContent = `ダウンロード中... (${idx}/${progress.fileTotal})`;
        } else if (statusEl) {
          statusEl.textContent = 'ダウンロード中...';
        }
      } else if (progress.phase === 'extracting') {
        if (downloadBtn && !downloadBtn.disabled) {
          downloadBtn.disabled = true;
          downloadBtn.classList.add('opacity-60');
        }
        if (progress.status === 'entry' && progress.entryTotal > 0 && progress.zipTotal > 0) {
          const pct = Math.min(99, Math.round(
            ((progress.zipIndex - 1) / progress.zipTotal + (progress.entryIndex / progress.entryTotal) / progress.zipTotal) * 100
          ));
          if (bytesBar) bytesBar.style.width = `${pct}%`;
          if (statusEl) statusEl.textContent = `展開中... ${progress.entryIndex}/${progress.entryTotal}`;
        } else {
          if (progress.status === 'done' || progress.status === 'skipped' || progress.status === 'fileDone') {
            if (bytesBar) bytesBar.style.width = '100%';
          }
          if (statusEl) {
            statusEl.textContent = progress.currentEntry
              ? `展開中... ${progress.currentEntry}`
              : '展開中...';
          }
        }
      } else if (progress.phase === 'done') {
        const asset = getAssetByItemId(progress.itemId);
        let switchedToDownloaded = false;
        if (asset && !asset.downloaded) {
          asset.downloaded = true;
          state.assetsRevision = Number(state.assetsRevision || 0) + 1;
          state.downloadedAssets.push(asset);
          switchedToDownloaded = true;
        }
        if (asset?.hasUpdate && typeof markAssetUpdateSeen === 'function') {
          markAssetUpdateSeen(asset)
            .then(() => {
              state.updateAssetCount = Math.max(0, Number(state.updateAssetCount || 0) - 1);
              const badge = entry?.tile?.querySelector('.absolute.top-2.right-2');
              if (badge) badge.remove();
            })
            .catch((error) => logger?.warn?.('mark update seen failed', error));
        }
        if (bytesBar) bytesBar.style.width = '100%';
        if (filesBar) filesBar.style.width = '100%';
        if (statusEl) statusEl.textContent = '完了';
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.classList.remove('opacity-60');
          downloadBtn.textContent = 'インポート';
          downloadBtn.classList.remove('border-gray-700', 'hover:bg-white', 'hover:text-black');
          downloadBtn.classList.add('border-blue-600', 'text-blue-300', 'hover:bg-blue-600/20');
        }
        if (progWrapper) {
          setTimeout(() => {
            progWrapper.classList.remove('opacity-100');
            progWrapper.classList.add('opacity-0');
          }, 800);
        }
        if (!entry && switchedToDownloaded) {
          state.downloadedAssets = state.allAssets.filter((assetRow) => Boolean(assetRow?.downloaded));
        }
      } else if (progress.phase === 'failed') {
        const asset = getAssetByItemId(progress.itemId);
        if (statusEl) {
          statusEl.textContent = asset?.downloaded ? 'DL済み' : '未DL';
        }
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.classList.remove('opacity-60');
        }
        if (progWrapper) {
          progWrapper.classList.remove('opacity-100');
          progWrapper.classList.add('opacity-0');
        }
      }
    }

    function flushPendingDownloadProgress() {
      downloadProgressFlushTimer = null;
      const rows = Array.from(pendingDownloadProgressByItem.values());
      pendingDownloadProgressByItem.clear();
      for (const progress of rows) {
        applyDownloadProgress(progress);
      }
    }

    function handleDownloadProgress(progress) {
      if (!progress || !progress.itemId) return;
      pendingDownloadProgressByItem.set(String(progress.itemId), progress);
      if (downloadProgressFlushTimer) return;
      downloadProgressFlushTimer = setTimeout(flushPendingDownloadProgress, downloadProgressFlushMs);
    }

    function handleQueueStatus(status) {
      pendingQueueStatus = status;
      const now = Date.now();
      const elapsed = now - queueStatusLastRenderedAt;
      const run = () => {
        queueStatusFlushTimer = null;
        queueStatusLastRenderedAt = Date.now();
        const next = pendingQueueStatus;
        pendingQueueStatus = null;
        if (next) renderQueueStatus(next);
      };
      if (elapsed >= queueStatusFlushMs && !queueStatusFlushTimer) {
        run();
        return;
      }
      if (!queueStatusFlushTimer) {
        const wait = Math.max(20, queueStatusFlushMs - elapsed);
        queueStatusFlushTimer = setTimeout(run, wait);
      }
    }

    function bindBoothApiEvents() {
      if (eventsBound) return;
      eventsBound = true;
      boothAPI.onDownloadProgress(handleDownloadProgress);
      boothAPI.onQueueStatus(handleQueueStatus);
    }

    function bindUiEvents() {
      domRefs.downloadUndownloadedBtn?.addEventListener('click', async () => {
        const targets = getUndownloadedAssets?.() || [];
        await enqueueAssets?.(targets);
      });
      domRefs.downloadAllBtn?.addEventListener('click', async () => {
        const allTargets = getDownloadableAssets?.() || [];
        if (!allTargets.length) {
          showTransientMessage?.('ダウンロード対象がありません。', 'error');
          return;
        }
        const undownloadedTargets = getUndownloadedAssets?.() || [];
        const mode = await showDownloadScopeModal?.({
          allCount: allTargets.length,
          undownloadedCount: undownloadedTargets.length,
        });
        if (!mode) return;
        const targets = mode === 'all' ? allTargets : undownloadedTargets;
        const modeLabel = mode === 'all' ? '全アイテム' : '未ダウンロードのみ';
        if (!targets.length) {
          showTransientMessage?.(`${modeLabel} の対象がありません。`, 'info');
          return;
        }
        const ok = await showConfirmModal?.({
          title: 'ダウンロード確認',
          message: `${modeLabel} ${targets.length}件をキューに追加します。続行しますか？${state.settings?.safeMode ? '\n(Safe Mode 有効中)' : ''}`,
          confirmText: '追加する',
          cancelText: 'やめる',
        });
        if (!ok) return;
        await enqueueAssets?.(targets);
        showTransientMessage?.(`${modeLabel} ${targets.length}件をダウンロードキューに追加しました。`, 'info');
      });
      domRefs.retryFailedBtn?.addEventListener('click', async () => {
        const res = await boothAPI.retryFailed();
        if (res?.queue) renderQueueStatus(res.queue);
      });
      domRefs.queueToggleBtn?.addEventListener('click', async () => {
        if (state.queue.paused) {
          const res = await boothAPI.resumeQueue();
          if (res?.queue) renderQueueStatus(res.queue);
        } else {
          const res = await boothAPI.stopQueue();
          if (res?.queue) renderQueueStatus(res.queue);
        }
      });
    }

    function getLastQueueSettledAt() {
      return lastQueueSettledAt;
    }

    return {
      bindBoothApiEvents,
      bindUiEvents,
      renderQueueStatus,
      isQueueLikelyActiveNow,
      getLastQueueSettledAt,
    };
  }

  global.AvatoolRenderQueueUI = {
    createRenderQueueUI,
  };
})(window);
