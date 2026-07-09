(function attachRenderAppState(global) {
  function createRenderAppState(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const boothAPI = deps?.boothAPI;
    const isElementShown = deps?.isElementShown;
    const showShortcutsTutorialOverlay = deps?.showShortcutsTutorialOverlay;
    const shortcutsTutorialSeenKey = String(deps?.shortcutsTutorialSeenKey || 'shortcutsTutorialSeenV1');
    const showTransientMessage = deps?.showTransientMessage;
    const showUpdateNotification = deps?.showUpdateNotification;
    const setAssetsFromMap = deps?.setAssetsFromMap;
    const applyCategoryFilter = deps?.applyCategoryFilter;
    const setAppUpdateStatusUI = deps?.setAppUpdateStatusUI;
    const setAppUpdateProgressUI = deps?.setAppUpdateProgressUI;
    const isQueueLikelyActiveNow = deps?.isQueueLikelyActiveNow;
    const getLastQueueSettledAt = deps?.getLastQueueSettledAt;
    const refreshVisibleTileActionStates = deps?.refreshVisibleTileActionStates;
    const scheduleStorageUsageRefresh = deps?.scheduleStorageUsageRefresh;
    const showAppUpdateDownloadedModal = deps?.showAppUpdateDownloadedModal;
    const isAppUpdateReminderActive = deps?.isAppUpdateReminderActive;
    let ipcEventsBound = false;
    let assetsRefreshedRerenderTimer = null;

    if (
      !state ||
      !boothAPI ||
      typeof isElementShown !== 'function' ||
      typeof showShortcutsTutorialOverlay !== 'function' ||
      typeof showTransientMessage !== 'function' ||
      typeof showUpdateNotification !== 'function' ||
      typeof setAssetsFromMap !== 'function' ||
      typeof applyCategoryFilter !== 'function' ||
      typeof setAppUpdateStatusUI !== 'function' ||
      typeof setAppUpdateProgressUI !== 'function' ||
      typeof isQueueLikelyActiveNow !== 'function' ||
      typeof getLastQueueSettledAt !== 'function' ||
      typeof refreshVisibleTileActionStates !== 'function' ||
      typeof scheduleStorageUsageRefresh !== 'function' ||
      typeof showAppUpdateDownloadedModal !== 'function' ||
      typeof isAppUpdateReminderActive !== 'function'
    ) {
      throw new Error('createRenderAppState requires state, boothAPI, and renderer orchestration helpers.');
    }

    function maybeShowShortcutsTutorialOnStartup() {
      try {
        if (localStorage.getItem(shortcutsTutorialSeenKey) === '1') return;
      } catch { /* localStorage利用不可時はチュートリアルを表示する側にフォールバック */ }
      setTimeout(() => {
        if (isElementShown(domRefs.settingsModal)) return;
        if (document.querySelector('#shortcuts-tutorial-overlay')) return;
        showShortcutsTutorialOverlay();
      }, 900);
    }

    function buildCandidateTokens(asset) {
      const out = [];
      const pushIf = (value) => {
        const s = String(value || '').trim();
        if (s) out.push(s);
      };
      pushIf(asset?.title);
      pushIf(asset?.author);
      pushIf(asset?.authorName);
      pushIf(asset?.shopName);
      pushIf(asset?.primaryCategory?.text);
      (asset?.categories || []).forEach((category) => pushIf(category?.text));
      return Array.from(new Set(out));
    }

    function getPhaseLocalProgress(progress) {
      if (progress.phase === 'prepare') {
        const ratio = Number(progress.ratio);
        if (Number.isFinite(ratio)) return Math.max(0, Math.min(1, ratio));
        return 0;
      }
      if (progress.phase === 'orders' || progress.phase === 'library' || progress.phase === 'gifts') {
        const cur = progress.page || progress.index || 0;
        const total = progress.totalPages || progress.total || 1;
        return total ? cur / total : 0;
      }
      if (progress.phase === 'categories') {
        const cur = progress.index || 0;
        const total = progress.total || 1;
        return total ? cur / total : 0;
      }
      if (progress.phase === 'thumbnails' || progress.phase === 'authorIcons') {
        const cur = progress.index || 0;
        const total = progress.total || 1;
        return total ? cur / total : 0;
      }
      if (progress.phase === 'bytes') {
        if (progress.totalBytes && progress.totalBytes > 0) {
          return Math.min(1, progress.received / progress.totalBytes);
        }
        return 0;
      }
      if (progress.phase === 'avatar-enrich') {
        const cur = progress.index || 0;
        const total = progress.total || 1;
        return total ? cur / total : 0;
      }
      if (progress.phase === 'done') return 1;
      return 0;
    }

    function getGlobalMetaProgress(progress) {
      if (progress.phase === 'done') return 1;
      const phase = String(progress?.phase || '');
      const local = Math.max(0, Math.min(1, getPhaseLocalProgress(progress)));
      let start = 0;
      let end = 0;
      if (phase === 'prepare') [start, end] = [0.0, 0.03];
      else if (phase === 'orders') [start, end] = [0.03, 0.15];
      else if (phase === 'library') [start, end] = [0.15, 0.3];
      else if (phase === 'gifts') [start, end] = [0.15, 0.3];
      else if (phase === 'categories') [start, end] = [0.3, 0.55];
      else if (phase === 'authorIcons') [start, end] = [0.55, 0.65];
      else if (phase === 'thumbnails') [start, end] = [0.65, 0.85];
      else if (phase === 'bytes') [start, end] = [0.65, 0.99];
      else if (phase === 'avatar-enrich') [start, end] = [0.85, 0.99];
      return start + ((end - start) * local);
    }

    function resetMetaProgressState() {
      state.metaProgress.globalMax = 0;
      state.metaProgress.lastRenderAt = 0;
      state.metaProgress.lastLabel = '';
      state.metaProgress.lastCountText = '';
      state.metaProgress.lastLocalPercent = 0;
    }

    function beginMetaProgressScope(scope, label = '処理中...', countText = '') {
      const nextScope = String(scope || '').trim();
      if (!nextScope) return;
      state.metaProgress.activeScope = nextScope;
      resetMetaProgressState();
      if (domRefs.metaProgressWrapper) domRefs.metaProgressWrapper.classList.remove('hidden');
      if (domRefs.progressBarTop) domRefs.progressBarTop.style.width = '0%';
      if (domRefs.progressBarBottom) domRefs.progressBarBottom.style.width = '0%';
      if (domRefs.progressPercent) domRefs.progressPercent.textContent = '0%';
      if (domRefs.progressLabel) domRefs.progressLabel.textContent = label;
      if (domRefs.progressCountLabel) domRefs.progressCountLabel.textContent = countText;
    }

    function endMetaProgressScope(scope) {
      const ended = String(scope || '').trim();
      if (!ended || state.metaProgress.activeScope !== ended) return;
      state.metaProgress.activeScope = '';
      if (domRefs.metaProgressWrapper) domRefs.metaProgressWrapper.classList.add('hidden');
    }

    function setUpdateCheckUi(running) {
      const btn = domRefs.checkUpdatesBtn;
      const svg = btn?.querySelector('svg');
      if (btn) {
        btn.disabled = Boolean(running);
        btn.classList.toggle('opacity-70', Boolean(running));
      }
      if (svg) svg.classList.toggle('animate-spin', Boolean(running));
      if (running) {
        beginMetaProgressScope('check-updates', '更新をチェック中...', 'ライブラリを照合しています');
      } else {
        endMetaProgressScope('check-updates');
      }
    }

    function setUpdateActionUi(running) {
      const btn = domRefs.checkUpdatesBtn;
      const svg = btn?.querySelector('svg');
      if (btn) {
        btn.disabled = Boolean(running);
        btn.classList.toggle('opacity-70', Boolean(running));
      }
      if (svg) svg.classList.toggle('animate-spin', Boolean(running));
    }

    function scheduleAssetsRefreshedRerender(delayMs = 120) {
      if (assetsRefreshedRerenderTimer) {
        clearTimeout(assetsRefreshedRerenderTimer);
      }
      assetsRefreshedRerenderTimer = setTimeout(() => {
        assetsRefreshedRerenderTimer = null;
        applyCategoryFilter(state.currentCategory || 'all');
        refreshVisibleTileActionStates();
      }, Math.max(0, Number(delayMs) || 0));
    }

    function isSuppressedNotificationType(type) {
      const t = String(type || '').trim().toLowerCase();
      return t === 'app-update' || t === 'library-updates';
    }

    function isSuppressedNotificationMessage(message) {
      const text = String(message || '').trim();
      if (!text) return false;
      return /起動時の自動ダウンロード[:：]/i.test(text)
        || /起動時の自動ダウンロードを開始しました/i.test(text)
        || /起動時の自動ダウンロードを実行中/i.test(text)
        || /起動時の自動ダウンロードが完了しました/i.test(text)
        || /^ヘルスチェック[：:]/i.test(text)
        || /アップデート開始を要求しました。進捗を確認してください。/i.test(text)
        || /更新のダウンロードが完了しました。再起動で適用されます。/i.test(text)
        || /アプリ更新/i.test(text);
    }

    function isImportantTransientNotification(message, tone = 'info') {
      const level = String(tone || '').trim().toLowerCase();
      if (level === 'error' || level === 'warn') return true;
      const text = String(message || '').trim();
      if (!text) return false;
      return /失敗|エラー|警告|できません|見つかりません|error|failed?|warn(ing)?/i.test(text);
    }

    function isImportantNotificationItem(item) {
      if (!item || typeof item !== 'object') return false;
      const type = String(item.type || '').trim().toLowerCase();
      if (type !== 'transient') return true;
      const tone = String(item?.payload?.tone || 'info');
      return isImportantTransientNotification(item.message, tone);
    }

    function sanitizeNotificationCenterState() {
      const list = Array.isArray(state.notifications) ? state.notifications : [];
      const filtered = list.filter((item) => (
        !isSuppressedNotificationType(item?.type)
        && !isSuppressedNotificationMessage(item?.message)
        && isImportantNotificationItem(item)
      ));
      if (filtered.length !== list.length) {
        state.notifications = filtered;
      }
    }

    function setAutoUpdateNotifyButton() {
      const btn = domRefs.autoUpdateNotifyBtn;
      const countEl = domRefs.autoUpdateNotifyCount;
      if (!btn || !countEl) return;
      sanitizeNotificationCenterState();
      const count = (state.notifications || []).filter((item) => item && item.unread).length;
      countEl.textContent = `${count}`;
      countEl.classList.toggle('hidden', count <= 0);
      btn.classList.toggle('bg-amber-500/10', count > 0);
    }

    function upsertPendingAutoUpdates(updates) {
      const rows = Array.isArray(updates) ? updates : [];
      if (!rows.length) return;
      const map = new Map();
      for (const update of (state.pendingAutoUpdates || [])) {
        const key = String(update?.itemId || '').trim();
        if (!key) continue;
        map.set(key, update);
      }
      for (const update of rows) {
        const key = String(update?.itemId || '').trim();
        if (!key) continue;
        map.set(key, update);
      }
      state.pendingAutoUpdates = Array.from(map.values());
      setAutoUpdateNotifyButton();
    }

    function upsertNotificationItem(item) {
      const next = item || {};
      const id = String(next.id || '').trim();
      if (!id) return;
      if (isSuppressedNotificationType(next.type) || isSuppressedNotificationMessage(next.message)) return;
      if (!isImportantNotificationItem(next)) return;
      const list = Array.isArray(state.notifications) ? [...state.notifications] : [];
      const idx = list.findIndex((row) => String(row?.id || '') === id);
      const merged = {
        id,
        type: String(next.type || 'info'),
        title: String(next.title || '通知'),
        message: String(next.message || ''),
        createdAt: String(next.createdAt || new Date().toISOString()),
        payload: next.payload || null,
        unread: next.unread !== false,
      };
      if (idx >= 0) list[idx] = { ...list[idx], ...merged };
      else list.unshift(merged);
      state.notifications = list.slice(0, 50);
      setAutoUpdateNotifyButton();
    }

    function markNotificationAsRead(notificationId) {
      const target = String(notificationId || '').trim();
      if (!target) return;
      state.notifications = (state.notifications || []).map((item) => (
        String(item?.id || '') === target ? { ...item, unread: false } : item
      ));
      setAutoUpdateNotifyButton();
    }

    function removeNotificationItem(notificationId) {
      const target = String(notificationId || '').trim();
      if (!target) return;
      state.notifications = (state.notifications || []).filter((item) => String(item?.id || '') !== target);
      setAutoUpdateNotifyButton();
    }

    function clearAllNotifications() {
      state.notifications = [];
      setAutoUpdateNotifyButton();
    }

    async function checkForUpdates(options = {}) {
      const manual = options.manual !== false;
      if (state.updateCheckRunning) {
        if (manual) showTransientMessage('更新チェックは実行中です。', 'info');
        return;
      }
      state.updateCheckRunning = true;
      try {
        setUpdateCheckUi(true);
        const result = await boothAPI.checkUpdates();
        if (result?.error) throw new Error(result.error);
        if (result.totalUpdates > 0) {
          if (manual) {
            showUpdateNotification(result.updates || []);
          } else {
            showTransientMessage(`${result.totalUpdates}件の更新を検出しました。`, 'info');
          }
        } else if (manual) {
          showTransientMessage('すべてのアセットは最新です。', 'info');
        }
        if (result.assets) {
          setAssetsFromMap(result.assets, { preserveRuntimeDownloaded: true });
          applyCategoryFilter(state.currentCategory || 'all');
        }
      } catch (error) {
        console.error(error);
        showTransientMessage(`更新チェックに失敗: ${error.message || error}`, 'error');
      } finally {
        state.updateCheckRunning = false;
        setUpdateCheckUi(false);
      }
    }

    function bindIpcEvents() {
      if (ipcEventsBound) return;
      ipcEventsBound = true;

      boothAPI.onMetaProgress((progress) => {
        if (!progress || !progress.phase) return;
        const scope = String(progress.scope || '').trim() || 'default';
        const activeScope = String(state.metaProgress.activeScope || '').trim();
        if (!activeScope && scope === 'load-assets') return;
        if (activeScope && scope !== activeScope) return;
        if (!activeScope) state.metaProgress.activeScope = scope;

        const now = Date.now();
        if (progress.phase === 'bytes' && (now - state.metaProgress.lastRenderAt) < 80) return;
        state.metaProgress.lastRenderAt = now;

        if (!domRefs.progressWrapper) return;
        domRefs.progressWrapper.classList.remove('hidden');

        let label = 'メタデータを読み込み中...';
        let percentLocal = 0;
        let countText = '';

        const phase = String(progress.phase || '');
        if (phase === 'prepare') {
          percentLocal = 0;
          label = String(
            progress.message
            || (scope === 'load-assets' ? 'ライブラリを読み込み中...' : '同期準備中...')
          );
        } else if (phase === 'orders' || phase === 'library') {
          const cur = progress.page || progress.index || 0;
          const total = progress.totalPages || progress.total || 1;
          percentLocal = total ? Math.round((cur / total) * 100) : 0;
          label = phase === 'orders' ? '注文情報を取得中...' : 'ライブラリ情報を取得中...';
          countText = `${cur} / ${total}`;
        } else if (phase === 'thumbnails' || phase === 'authorIcons') {
          const cur = progress.index || 0;
          const total = progress.total || 1;
          percentLocal = total ? Math.round((cur / total) * 100) : 0;
          label = phase === 'thumbnails' ? 'サムネイルを取得中...' : '作者アイコンを取得中...';
          countText = `${cur} / ${total}`;
        } else if (phase === 'categories') {
          const cur = progress.index || 0;
          const total = progress.total || 1;
          percentLocal = total ? Math.round((cur / total) * 100) : 0;
          label = 'カテゴリ情報を取得中...';
          countText = `${cur} / ${total}`;
        } else if (phase === 'bytes') {
          percentLocal = state.metaProgress.lastLocalPercent || 0;
          label = state.metaProgress.lastLabel || '画像データを取得中...';
          countText = state.metaProgress.lastCountText || '';
        } else if (phase === 'avatar-enrich') {
          const cur = progress.index || 0;
          const total = progress.total || 1;
          percentLocal = total ? Math.round((cur / total) * 100) : 0;
          label = '対応アバターを解析中...';
          countText = `${cur} / ${total}`;
        } else if (phase === 'done') {
          label = (scope === 'avatar-analysis' || scope === 'avatar-post-download')
            ? '対応衣装の詳細解析が完了しました'
            : 'メタデータの同期が完了しました';
          percentLocal = 100;
          setTimeout(() => {
            endMetaProgressScope(scope);
          }, 1000);
        }

        const global = getGlobalMetaProgress(progress);
        state.metaProgress.globalMax = Math.max(state.metaProgress.globalMax, global);
        const percentGlobal = Math.round(state.metaProgress.globalMax * 100);

        if (phase !== 'bytes') {
          state.metaProgress.lastLocalPercent = Math.max(state.metaProgress.lastLocalPercent, percentLocal);
          percentLocal = state.metaProgress.lastLocalPercent;
          state.metaProgress.lastLabel = label;
          state.metaProgress.lastCountText = countText;
        }
        if (phase === 'done') {
          state.metaProgress.lastLocalPercent = 100;
          state.metaProgress.lastLabel = label;
          state.metaProgress.lastCountText = '';
        }

        if (domRefs.progressLabel) domRefs.progressLabel.textContent = label;
        if (domRefs.progressPercent) domRefs.progressPercent.textContent = `${percentLocal}%`;
        if (domRefs.progressBarTop) domRefs.progressBarTop.style.width = `${percentLocal}%`;
        if (domRefs.progressBarBottom) domRefs.progressBarBottom.style.width = `${percentGlobal}%`;
        if (domRefs.progressCountLabel) domRefs.progressCountLabel.textContent = countText;
        const loadingTextEl = document.getElementById('asset-loading-text');
        if (loadingTextEl && phase !== 'done') {
          loadingTextEl.textContent = `${label}${countText ? ` (${countText})` : ''} ${percentLocal}%`;
        }
      });

      boothAPI.onUpdateNotification?.((payload) => {
        if (payload?.totalUpdates > 0) {
          const updates = payload.updates || [];
          upsertPendingAutoUpdates(updates);
          const count = Array.isArray(updates) ? updates.length : Number(payload.totalUpdates || 0);
          showTransientMessage(`${count}件の更新を検出しました。`, 'info');
        }
      });

      boothAPI.onAppUpdateStatus?.((payload) => {
        const phase = String(payload?.phase || '');
        const msg = String(payload?.message || '').trim();
        const releaseNotes = String(payload?.releaseNotes || '').trim();
        if (releaseNotes) state.appUpdateReleaseNotes = releaseNotes;
        if (phase === 'checking') {
          if (!releaseNotes) state.appUpdateReleaseNotes = '';
          setAppUpdateStatusUI(msg || 'アプリ更新をチェック中...', 'info');
          const keepVisible = !domRefs.settingAppUpdateProgressWrap?.classList.contains('hidden')
            || !domRefs.appUpdateProgressFloat?.classList.contains('hidden');
          setAppUpdateProgressUI(keepVisible ? 1 : 0, keepVisible, keepVisible ? '準備中...' : '');
          return;
        }
        if (phase === 'available') {
          setAppUpdateStatusUI(msg || `新しいバージョン ${payload?.version || ''} が見つかりました。`, 'warn');
          setAppUpdateProgressUI(0, false);
          return;
        }
        if (phase === 'not-available') {
          setAppUpdateStatusUI(msg || '現在のバージョンは最新です。', 'success');
          setAppUpdateProgressUI(0, false);
          state.appUpdateDownloadUi.sawProgress = false;
          state.appUpdateDownloadUi.lastPercent = 0;
          return;
        }
        if (phase === 'download-progress') {
          const percent = Number(payload?.percent || 0);
          state.appUpdateDownloadUi.sawProgress = true;
          state.appUpdateDownloadUi.lastPercent = percent;
          setAppUpdateStatusUI(msg || `更新ダウンロード中 ${Math.round(percent)}%`, 'info');
          const shown = Math.min(95, Math.max(0, percent));
          setAppUpdateProgressUI(shown, true, `ダウンロード中 ${Math.round(percent)}%`);
          return;
        }
        if (phase === 'downloaded') {
          setAppUpdateStatusUI(msg || '更新のダウンロードが完了しました。', 'success');
          const elapsed = Date.now() - Number(state.appUpdateDownloadUi.startedAt || 0);
          const meaningfulProgress = state.appUpdateDownloadUi.sawProgress
            && Number(state.appUpdateDownloadUi.lastPercent || 0) >= 5
            && elapsed >= 1500;
          if (meaningfulProgress) {
            setAppUpdateProgressUI(100, true);
          } else {
            setAppUpdateProgressUI(0, true, '完了 (キャッシュ)');
          }
          setTimeout(() => setAppUpdateProgressUI(0, false), 4000);
          const version = String(payload?.version || '');
          if (!isAppUpdateReminderActive(version)) {
            showAppUpdateDownloadedModal(
              msg || '更新のダウンロードが完了しました。再起動で適用されます。',
              version,
              state.appUpdateReleaseNotes,
            );
          } else {
            setAppUpdateStatusUI('更新は準備済みです（通知延期中）。', 'info');
          }
          state.appUpdateDownloadUi.sawProgress = false;
          return;
        }
        if (phase === 'error') {
          setAppUpdateStatusUI(msg || '更新チェックに失敗しました。', 'error');
          setAppUpdateProgressUI(0, false);
          state.appUpdateDownloadUi.sawProgress = false;
          state.appUpdateDownloadUi.lastPercent = 0;
          showTransientMessage(msg || '更新チェックに失敗しました。', 'error');
          return;
        }
        if (phase === 'skipped-dev') {
          setAppUpdateStatusUI(msg || '開発モードのため更新チェックをスキップ', 'info');
          setAppUpdateProgressUI(0, false);
          state.appUpdateDownloadUi.sawProgress = false;
          state.appUpdateDownloadUi.lastPercent = 0;
          return;
        }
        if (phase === 'unavailable') {
          setAppUpdateStatusUI(msg || 'アップデーターが利用できません。', 'warn');
          setAppUpdateProgressUI(0, false);
          state.appUpdateDownloadUi.sawProgress = false;
          state.appUpdateDownloadUi.lastPercent = 0;
        }
      });

      boothAPI.onAssetsRefreshed?.((assetsMap) => {
        try {
          if (!assetsMap || assetsMap.error) return;
          setAssetsFromMap(assetsMap, { preserveRuntimeDownloaded: true });
          const settledRecently = (Date.now() - Number(getLastQueueSettledAt() || 0)) < 3500;
          if (!isQueueLikelyActiveNow() && !settledRecently) {
            applyCategoryFilter(state.currentCategory || 'all');
          } else {
            refreshVisibleTileActionStates();
            scheduleAssetsRefreshedRerender();
          }
          scheduleStorageUsageRefresh(120);
          if (!settledRecently) {
            showTransientMessage('新着を反映しました。', 'info');
          }
        } catch (error) {
          console.warn('[renderer] onAssetsRefreshed failed:', error);
        }
      });
    }

    return {
      maybeShowShortcutsTutorialOnStartup,
      buildCandidateTokens,
      getPhaseLocalProgress,
      getGlobalMetaProgress,
      resetMetaProgressState,
      beginMetaProgressScope,
      endMetaProgressScope,
      setUpdateCheckUi,
      setUpdateActionUi,
      setAutoUpdateNotifyButton,
      upsertPendingAutoUpdates,
      sanitizeNotificationCenterState,
      upsertNotificationItem,
      markNotificationAsRead,
      removeNotificationItem,
      clearAllNotifications,
      checkForUpdates,
      bindIpcEvents,
    };
  }

  global.AvatoolRenderAppState = {
    createRenderAppState,
  };
})(window);
