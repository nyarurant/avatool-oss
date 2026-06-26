(function attachRenderAuxUi(global) {
  function createRenderAuxUi(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const boothAPI = deps?.boothAPI;
    const esc = deps?.esc || ((value) => String(value || ''));
    const shortcutFieldDefs = Array.isArray(deps?.shortcutFieldDefs) ? deps.shortcutFieldDefs : [];
    const defaultShortcuts = deps?.defaultShortcuts || {};
    const reservedShortcuts = Array.isArray(deps?.reservedShortcuts) ? deps.reservedShortcuts : [];
    const shortcutsTutorialSeenKey = String(deps?.shortcutsTutorialSeenKey || 'shortcutsTutorialSeenV1');
    const getShortcutMap = deps?.getShortcutMap;
    const formatShortcutDisplay = deps?.formatShortcutDisplay;
    const removeNotificationItem = deps?.removeNotificationItem;
    const markNotificationAsRead = deps?.markNotificationAsRead;
    const clearAllNotifications = deps?.clearAllNotifications;
    const sanitizeNotificationCenterState = deps?.sanitizeNotificationCenterState;
    const showUpdateNotification = deps?.showUpdateNotification;
    const setAppUpdateStatusUI = deps?.setAppUpdateStatusUI;
    const setAppUpdateProgressUI = deps?.setAppUpdateProgressUI;
    const showTransientMessage = deps?.showTransientMessage;
    const refreshAvatarAnalysisUI = deps?.refreshAvatarAnalysisUI;
    const refreshMetaNewUI = deps?.refreshMetaNewUI;
    const showUpdateActionModal = deps?.showUpdateActionModal;
    const checkForUpdates = deps?.checkForUpdates;
    const setUpdateActionUi = deps?.setUpdateActionUi;
    const isElementShown = deps?.isElementShown;
    const isConfirmModalOpen = deps?.isConfirmModalOpen;
    const clickIfEnabled = deps?.clickIfEnabled;
    const focusSearchInput = deps?.focusSearchInput;
    const closeTopOverlayOrMode = deps?.closeTopOverlayOrMode;
    const isTypingTarget = deps?.isTypingTarget;
    const eventMatchesShortcut = deps?.eventMatchesShortcut;
    const clearSelectionMode = deps?.clearSelectionMode;
    const renderGrid = deps?.renderGrid;
    const logShortcutDebug = deps?.logShortcutDebug;
    const upsertNotificationItem = deps?.upsertNotificationItem;
    const showConfirmModal = deps?.showConfirmModal;
    const requireSafeModeConfirm = deps?.requireSafeModeConfirm;
    const initializeApp = deps?.initializeApp;
    let ipcEventsBound = false;

    if (
      !state ||
      !boothAPI ||
      typeof getShortcutMap !== 'function' ||
      typeof formatShortcutDisplay !== 'function' ||
      typeof removeNotificationItem !== 'function' ||
      typeof markNotificationAsRead !== 'function' ||
      typeof clearAllNotifications !== 'function' ||
      typeof sanitizeNotificationCenterState !== 'function' ||
      typeof showUpdateNotification !== 'function' ||
      typeof setAppUpdateStatusUI !== 'function' ||
      typeof setAppUpdateProgressUI !== 'function' ||
      typeof showTransientMessage !== 'function' ||
      typeof refreshAvatarAnalysisUI !== 'function' ||
      typeof refreshMetaNewUI !== 'function' ||
      typeof showUpdateActionModal !== 'function' ||
      typeof checkForUpdates !== 'function' ||
      typeof setUpdateActionUi !== 'function' ||
      typeof isElementShown !== 'function' ||
      typeof isConfirmModalOpen !== 'function' ||
      typeof clickIfEnabled !== 'function' ||
      typeof focusSearchInput !== 'function' ||
      typeof closeTopOverlayOrMode !== 'function' ||
      typeof isTypingTarget !== 'function' ||
      typeof eventMatchesShortcut !== 'function' ||
      typeof clearSelectionMode !== 'function' ||
      typeof renderGrid !== 'function' ||
      typeof logShortcutDebug !== 'function' ||
      typeof upsertNotificationItem !== 'function' ||
      typeof showConfirmModal !== 'function' ||
      typeof requireSafeModeConfirm !== 'function' ||
      typeof initializeApp !== 'function'
    ) {
      throw new Error('createRenderAuxUi requires state, boothAPI, and shared UI helpers.');
    }

    function showShortcutsTutorialOverlay() {
      const shortcuts = getShortcutMap();
      const groups = [
        { title: 'Main', keys: ['focusSearch', 'focusSearchAlt', 'viewGrid', 'viewList', 'syncLibrary', 'checkUpdates', 'downloadAll', 'downloadUndownloaded', 'queueToggle', 'retryFailed', 'manualAdd', 'notifications', 'openSettings', 'openSettingsAlt'] },
        { title: '選択モード', keys: ['toggleSelectionMode', 'clearSelectionMode', 'batchImport'] },
        { title: 'Preview', keys: ['previewOpenFolder', 'previewOpenEntry', 'previewBack'] },
        { title: 'モーダル共通', keys: ['modalConfirm', 'modalPrimary'] },
      ];
      const findLabel = (key) => shortcutFieldDefs.find((def) => def.key === key)?.label || key;
      const overlay = document.createElement('div');
      overlay.id = 'shortcuts-tutorial-overlay';
      overlay.className = 'fixed inset-0 z-[122] bg-black/80 flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="w-full max-w-3xl max-h-[86vh] overflow-y-auto modal-card p-4">
          <div class="flex items-center justify-between mb-3">
            <div>
              <div class="text-sm font-bold text-white">Shortcut Guide</div>
              <div class="text-[10px] text-zinc-500 mt-0.5">You can open this again from settings.</div>
            </div>
            <button id="shortcuts-guide-close" class="btn-action">閉じる</button>
          </div>
          <div class="space-y-3">
            ${groups.map((group) => `
              <section class="settings-section">
                <div class="settings-section-title">${esc(group.title)}</div>
                <div class="space-y-1">
                  ${group.keys.map((key) => `
                    <div class="flex items-center justify-between text-[11px] border-b border-white/5 pb-1">
                      <span class="text-zinc-300">${esc(findLabel(key))}</span>
                      <span class="font-mono-custom text-zinc-100">${esc(formatShortcutDisplay(shortcuts[key] || defaultShortcuts[key] || ''))}</span>
                    </div>
                  `).join('')}
                </div>
              </section>
            `).join('')}
          </div>
          <div class="mt-3 text-[10px] text-zinc-500">Reserved keys: ${esc(reservedShortcuts.map((row) => row.spec).join(', '))}</div>
        </div>
      `;
      const close = () => {
        overlay.remove();
        try { localStorage.setItem(shortcutsTutorialSeenKey, '1'); } catch {}
      };
      overlay.querySelector('#shortcuts-guide-close')?.addEventListener('click', close);
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
      });
      document.body.appendChild(overlay);
    }

    function showNotificationCenter() {
      sanitizeNotificationCenterState();
      const items = Array.isArray(state.notifications) ? state.notifications : [];
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 z-[95] bg-black/0 flex items-start justify-end p-4 transition-colors duration-180';
      const escText = (value) => esc(String(value || ''));
      const rowsHtml = items.length
        ? items.map((note) => {
            const created = note?.createdAt ? new Date(note.createdAt).toLocaleString('ja-JP') : '';
            const unreadCls = note?.unread ? 'border-amber-600/60 bg-amber-900/10' : 'border-[#222] bg-[#111]';
            const action = note?.type === 'library-updates'
              ? `<button data-action="open-updates" data-id="${escText(note.id)}" class="btn-action whitespace-nowrap">詳細を開く</button>`
              : (note?.type === 'app-update'
                  ? `<button data-action="start-app-update" data-id="${escText(note.id)}" class="btn-action btn-primary whitespace-nowrap">更新開始</button>`
                  : '');
            return `
              <div class="border ${unreadCls} rounded p-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-[11px] text-white">${escText(note.title)}</div>
                  <div class="text-[9px] text-gray-500 font-mono-custom">${escText(created)}</div>
                </div>
                <div class="mt-1 text-[10px] text-zinc-400">${escText(note.message)}</div>
                <div class="mt-2 flex gap-2">
                  ${action}
                  <button data-action="mark-read" data-id="${escText(note.id)}" class="btn-action whitespace-nowrap">既読</button>
                </div>
              </div>
            `;
          }).join('')
        : '<div class="border border-[#222] bg-[#111] rounded p-3 text-[11px] text-zinc-400">No notifications.</div>';

      overlay.innerHTML = `
        <div id="notification-center-panel" class="w-full max-w-md max-h-[75vh] overflow-y-auto bg-[#0a0a0a] border border-[#222] rounded p-4 origin-top-right">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-bold text-amber-300">Notification Center</h2>
            <div class="flex items-center gap-2">
              <button id="notify-center-clear-all" class="btn-action whitespace-nowrap">すべて消去</button>
              <button id="notify-center-close" class="btn-action whitespace-nowrap">閉じる</button>
            </div>
          </div>
          <div class="space-y-2">${rowsHtml}</div>
        </div>
      `;
      document.body.appendChild(overlay);
      const panel = overlay.querySelector('#notification-center-panel');
      const bell = domRefs.autoUpdateNotifyBtn;

      const calcDeltaFromBell = () => {
        if (!panel || !bell) return { dx: 0, dy: -16 };
        const panelRect = panel.getBoundingClientRect();
        const bellRect = bell.getBoundingClientRect();
        const panelAnchorX = panelRect.right - 20;
        const panelAnchorY = panelRect.top + 16;
        const bellCenterX = bellRect.left + (bellRect.width / 2);
        const bellCenterY = bellRect.top + (bellRect.height / 2);
        return {
          dx: bellCenterX - panelAnchorX,
          dy: bellCenterY - panelAnchorY,
        };
      };

      const closeCenter = () => {
        if (!panel) {
          overlay.remove();
          return;
        }
        const { dx, dy } = calcDeltaFromBell();
        overlay.classList.remove('bg-black/60');
        overlay.classList.add('bg-black/0');
        panel.style.transition = 'transform 160ms cubic-bezier(0.4, 0, 1, 1), opacity 160ms ease';
        panel.style.transform = `translate(${dx}px, ${dy}px) scale(0.2)`;
        panel.style.opacity = '0';
        setTimeout(() => overlay.remove(), 170);
      };

      overlay.querySelector('#notify-center-close')?.addEventListener('click', closeCenter);
      overlay.querySelector('#notify-center-clear-all')?.addEventListener('click', () => {
        clearAllNotifications();
        closeCenter();
        showNotificationCenter();
      });
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeCenter();
      });

      if (panel) {
        const { dx, dy } = calcDeltaFromBell();
        panel.style.transform = `translate(${dx}px, ${dy}px) scale(0.2)`;
        panel.style.opacity = '0';
        panel.style.transition = 'transform 210ms cubic-bezier(0.2, 0.9, 0.2, 1), opacity 180ms ease';
        requestAnimationFrame(() => {
          overlay.classList.remove('bg-black/0');
          overlay.classList.add('bg-black/60');
          panel.style.transform = 'translate(0px, 0px) scale(1)';
          panel.style.opacity = '1';
        });
      }
      if (bell?.animate) {
        bell.animate(
          [
            { transform: 'scale(1) rotate(0deg)' },
            { transform: 'scale(1.1) rotate(-8deg)' },
            { transform: 'scale(1) rotate(0deg)' },
          ],
          { duration: 220, easing: 'ease-out' },
        );
      }

      overlay.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          const action = String(event.currentTarget?.getAttribute('data-action') || '');
          const id = String(event.currentTarget?.getAttribute('data-id') || '');
          const note = (state.notifications || []).find((row) => String(row?.id || '') === id);
          if (!note) return;
          if (action === 'mark-read') {
            removeNotificationItem(id);
            closeCenter();
            showNotificationCenter();
            return;
          }
          if (action === 'open-updates') {
            const updates = Array.isArray(note?.payload?.updates) ? note.payload.updates : [];
            if (updates.length > 0) showUpdateNotification(updates);
            markNotificationAsRead(id);
            state.pendingAutoUpdates = [];
            closeCenter();
            return;
          }
          if (action === 'start-app-update') {
            removeNotificationItem(id);
            closeCenter();
            if (!boothAPI.startAppUpdateDownload) return;
            state.appUpdateDownloadUi.startedAt = Date.now();
            state.appUpdateDownloadUi.sawProgress = false;
            state.appUpdateDownloadUi.lastPercent = 0;
            setAppUpdateStatusUI('アップデートを確認しています...', 'info');
            setAppUpdateProgressUI(0, true, '準備中...');
            showTransientMessage('アップデートの確認を開始しました。通知欄を確認してください。', 'info');
            boothAPI.startAppUpdateDownload()
              .then((res) => {
                if (res?.error === 'not_packaged') {
                  setAppUpdateStatusUI('開発モードではアップデートを確認できません。', 'info');
                  return;
                }
                if (res?.error === 'not_available') {
                  setAppUpdateStatusUI('現在のバージョンは最新です。', 'success');
                  return;
                }
                if (res?.error) {
                  setAppUpdateStatusUI(`Update start failed: ${res.error}`, 'error');
                }
              })
              .catch((error) => {
                setAppUpdateStatusUI(`Update start failed: ${error?.message || error}`, 'error');
              });
          }
        });
      });
    }

    function showAvatarFilterAnalysisPromptModal() {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[123] bg-black/70 flex items-center justify-center p-4';
        overlay.innerHTML = `
          <div class="w-full max-w-md bg-[#0b0c10] border border-white/10 rounded-xl p-4 shadow-2xl">
            <div class="text-sm font-bold text-zinc-100 mb-2">Detailed avatar analysis is required</div>
            <div class="text-[11px] text-zinc-300 leading-relaxed">
              Please analyze all items before using this filter.
            </div>
            <div data-role="progress-wrap" class="hidden mt-3">
              <div class="h-1.5 w-full bg-black rounded-full overflow-hidden border border-white/10">
                <div data-role="progress-bar" class="h-full bg-cyan-400 transition-all duration-300" style="width:0%"></div>
              </div>
              <div data-role="progress-text" class="text-[10px] text-cyan-300 mt-1">解析を準備中...</div>
            </div>
            <div class="mt-4 flex justify-end gap-2">
              <button data-role="cancel" class="btn-action whitespace-nowrap">キャンセル</button>
              <button data-role="analyze" class="btn-action btn-primary whitespace-nowrap">解析を実行</button>
              <button data-role="ok" class="btn-action btn-primary whitespace-nowrap hidden">OK</button>
            </div>
          </div>
        `;

        let running = false;
        let completed = false;
        let fakeTimer = null;
        const cancelBtn = overlay.querySelector('[data-role="cancel"]');
        const analyzeBtn = overlay.querySelector('[data-role="analyze"]');
        const okBtn = overlay.querySelector('[data-role="ok"]');
        const progressWrap = overlay.querySelector('[data-role="progress-wrap"]');
        const progressBar = overlay.querySelector('[data-role="progress-bar"]');
        const progressText = overlay.querySelector('[data-role="progress-text"]');

        const close = (goAnalyze) => {
          if (running) return;
          if (fakeTimer) {
            clearInterval(fakeTimer);
            fakeTimer = null;
          }
          overlay.remove();
          document.removeEventListener('keydown', onKeyDown);
          resolve(Boolean(goAnalyze));
        };

        const onKeyDown = (event) => {
          if (running) return;
          if (event.key === 'Escape') close(false);
          if (event.key === 'Enter') {
            event.preventDefault();
            if (completed) {
              okBtn?.click();
              return;
            }
            analyzeBtn?.click();
          }
        };

        overlay.addEventListener('click', (event) => {
          if (running) return;
          if (event.target === overlay) close(false);
        });
        cancelBtn?.addEventListener('click', () => close(false));
        okBtn?.addEventListener('click', () => close(true));
        analyzeBtn?.addEventListener('click', async () => {
          if (running) return;
          running = true;
          if (cancelBtn) cancelBtn.disabled = true;
          if (analyzeBtn) analyzeBtn.disabled = true;
          if (progressWrap) progressWrap.classList.remove('hidden');
          if (progressText) progressText.textContent = 'Running analysis...';
          let p = 5;
          if (progressBar) progressBar.style.width = `${p}%`;
          fakeTimer = setInterval(() => {
            p = Math.min(92, p + (p < 40 ? 8 : (p < 70 ? 4 : 2)));
            if (progressBar) progressBar.style.width = `${p}%`;
          }, 220);

          try {
            const analyzed = await refreshAvatarAnalysisUI();
            if (fakeTimer) {
              clearInterval(fakeTimer);
              fakeTimer = null;
            }
            if (progressBar) progressBar.style.width = analyzed ? '100%' : `${Math.max(8, p)}%`;
            if (progressText) progressText.textContent = analyzed ? '解析が完了しました。' : '解析に失敗しました。';
            running = false;
            if (analyzed) {
              completed = true;
              if (analyzeBtn) analyzeBtn.classList.add('hidden');
              if (cancelBtn) cancelBtn.classList.add('hidden');
              if (okBtn) okBtn.classList.remove('hidden');
              return;
            }
            close(false);
          } catch {
            if (fakeTimer) {
              clearInterval(fakeTimer);
              fakeTimer = null;
            }
            if (progressText) progressText.textContent = '解析に失敗しました。';
            running = false;
            close(false);
          }
        });
        document.addEventListener('keydown', onKeyDown);
        document.body.appendChild(overlay);
      });
    }

    function bindUiEvents() {
      domRefs.autoSyncToggle?.addEventListener('change', (event) => {
        localStorage.setItem('autoSyncOnStartup', event.target.checked ? '1' : '0');
      });
      domRefs.extractRepairBtn?.addEventListener('click', async () => {
        const ok = await requireSafeModeConfirm('展開済みデータを再展開します。実行しますか?');
        if (!ok) return;
        const selected = state.modal.selectedAsset;
        if (selected) {
          await boothAPI.extractItem(selected.itemId, selected.title || '', true);
        } else {
          const targets = Array.isArray(state.downloadedAssets) ? state.downloadedAssets : [];
          for (const asset of targets) {
            await boothAPI.extractItem(asset.itemId, asset.title || '', true);
          }
        }
        await initializeApp();
      });
      domRefs.syncLibraryBtn?.addEventListener('click', async () => {
        await refreshMetaNewUI();
      });
      if (domRefs.analyzeAvatarCompatBtn && domRefs.analyzeAvatarCompatBtn.dataset.avatoolAnalyzeBound !== '1') {
        domRefs.analyzeAvatarCompatBtn.dataset.avatoolAnalyzeBound = '1';
      domRefs.analyzeAvatarCompatBtn?.addEventListener('click', async () => {
        const downloadedAssets = (Array.isArray(state.allAssets) ? state.allAssets : [])
          .filter((asset) => asset.downloaded);
        if (downloadedAssets.length === 0) {
          showTransientMessage('ダウンロード済みのアイテムがありません。', 'info');
          return;
        }
        const unanalyzedIds = downloadedAssets
          .filter((asset) => !String(asset?.avatarAnalysisCheckedAt || '').trim())
          .map((asset) => asset.itemId);
        const targetIds = unanalyzedIds.length > 0
          ? unanalyzedIds
          : downloadedAssets.map((asset) => asset.itemId);
        await refreshAvatarAnalysisUI({ onlyItemIds: targetIds });
      });
      }
      domRefs.checkUpdatesBtn?.addEventListener('click', async () => {
        const mode = await showUpdateActionModal();
        if (!mode) return;
        if (mode === 'check') {
          await checkForUpdates();
          return;
        }
        setUpdateActionUi(true);
        try {
          const synced = await refreshMetaNewUI();
          if (mode === 'both' && synced) {
            await checkForUpdates();
          }
        } finally {
          if (!state.updateCheckRunning) setUpdateActionUi(false);
        }
      });
      domRefs.autoUpdateNotifyBtn?.addEventListener('click', () => {
        showNotificationCenter();
      });
      domRefs.shortcutsGuideBtn?.addEventListener('click', () => {
        showShortcutsTutorialOverlay();
      });
    }

    async function handleGlobalShortcutEvent(e) {
      if (!e || e.defaultPrevented) return;
      const key = String(e.key || '');
      const typing = isTypingTarget(e.target);
      const shortcutsEnabled = state.settings?.keyboardShortcutsEnabled !== false;
      const shortcuts = getShortcutMap();

      if (key === 'Escape') {
        if (closeTopOverlayOrMode()) {
          e.preventDefault();
        }
        return;
      }

      const f3Like = key === 'F3' || String(e.code || '') === 'F3' || Number(e.keyCode || 0) === 114;
      if (f3Like || (e.ctrlKey && e.shiftKey)) {
        logShortcutDebug('[shortcut-debug] Ctrl+Shift+F3 check', {
          key,
          code: String(e.code || ''),
          keyCode: Number(e.keyCode || 0),
          ctrl: Boolean(e.ctrlKey),
          shift: Boolean(e.shiftKey),
          alt: Boolean(e.altKey),
          meta: Boolean(e.metaKey),
        });
      }

      if (shortcutsEnabled && eventMatchesShortcut(e, shortcuts.focusSearchAlt)) {
        if (focusSearchInput(true)) {
          e.preventDefault();
        }
        return;
      }

      const settingsOpen = isElementShown(domRefs.settingsModal);
      const autoBootstrapOpen = isElementShown(domRefs.autoBootstrapModal);
      const manualAddOpen = isElementShown(domRefs.manualAddModal);
      const importOpen = isElementShown(domRefs.importModal);
      const pkgOpen = isElementShown(domRefs.pkgSelectModal);
      const previewOpen = isElementShown(domRefs.previewOverlay);
      const projectItemsOpen = isElementShown(domRefs.projectItemsModal);
      const confirmOpen = isConfirmModalOpen();
      const notificationOpen = Boolean(document.querySelector('#notify-center-close'));
      const updatesOpen = Boolean(document.querySelector('#updates-close'));
      const historyOpen = Boolean(document.querySelector('#history-close'));
      const anyModalOpen = (
        settingsOpen
        || autoBootstrapOpen
        || manualAddOpen
        || importOpen
        || pkgOpen
        || previewOpen
        || projectItemsOpen
        || confirmOpen
        || notificationOpen
        || updatesOpen
        || historyOpen
      );

      if (shortcutsEnabled && eventMatchesShortcut(e, shortcuts.modalPrimary)) {
        let handled = false;
        if (settingsOpen) handled = clickIfEnabled(domRefs.settingsSave);
        else if (autoBootstrapOpen) handled = clickIfEnabled(domRefs.autoBootstrapSave);
        else if (manualAddOpen) handled = clickIfEnabled(domRefs.manualAddSubmit);
        else if (importOpen) handled = clickIfEnabled(domRefs.importExecuteBtn);
        else if (pkgOpen) handled = clickIfEnabled(domRefs.pkgSelectConfirm);
        else if (projectItemsOpen) handled = clickIfEnabled(domRefs.projectItemsReconcile);
        if (handled) {
          e.preventDefault();
        }
        return;
      }

      if (typing) return;

      if (shortcutsEnabled && eventMatchesShortcut(e, shortcuts.focusSearch)) {
        if (focusSearchInput(false)) {
          e.preventDefault();
        }
        return;
      }

      if (!shortcutsEnabled) return;

      if (anyModalOpen) {
        if (eventMatchesShortcut(e, shortcuts.modalConfirm)) {
          if (importOpen && clickIfEnabled(domRefs.importExecuteBtn)) {
            e.preventDefault();
            return;
          }
          if (pkgOpen && clickIfEnabled(domRefs.pkgSelectConfirm)) {
            e.preventDefault();
            return;
          }
        }
        if (previewOpen) {
          if (eventMatchesShortcut(e, shortcuts.previewOpenFolder) && clickIfEnabled(domRefs.modalOpenFolderBtn)) {
            e.preventDefault();
            return;
          }
          if (eventMatchesShortcut(e, shortcuts.previewOpenEntry) && clickIfEnabled(domRefs.modalOpenEntryBtn)) {
            e.preventDefault();
            return;
          }
          if (eventMatchesShortcut(e, shortcuts.previewBack) && clickIfEnabled(domRefs.modalBackBtn)) {
            e.preventDefault();
            return;
          }
        }
        return;
      }

      if (e.repeat) return;

      if (eventMatchesShortcut(e, shortcuts.viewGrid) && clickIfEnabled(domRefs.viewGridBtn)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.viewList) && clickIfEnabled(domRefs.viewListBtn)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.syncLibrary) && clickIfEnabled(domRefs.syncLibraryBtn)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.checkUpdates) && clickIfEnabled(domRefs.checkUpdatesBtn)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.downloadUndownloaded) && clickIfEnabled(domRefs.downloadUndownloadedBtn)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.downloadAll) && clickIfEnabled(domRefs.downloadAllBtn)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.queueToggle) && clickIfEnabled(domRefs.queueToggleBtn)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.retryFailed) && clickIfEnabled(domRefs.retryFailedBtn)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.toggleSelectionMode) && clickIfEnabled(domRefs.btnToggleSelect)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.clearSelectionMode) && state.selectionMode) {
        clearSelectionMode();
        renderGrid();
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.batchImport) && state.selectionMode && clickIfEnabled(domRefs.btnBatchImport)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.manualAdd) && clickIfEnabled(domRefs.manualAddBtn)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.notifications) && clickIfEnabled(domRefs.autoUpdateNotifyBtn)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.autoBootstrap) && clickIfEnabled(domRefs.autoBootstrapBtn)) {
        e.preventDefault();
        return;
      }
      if (eventMatchesShortcut(e, shortcuts.projectItems) && clickIfEnabled(domRefs.projectItemsBtn)) {
        e.preventDefault();
        return;
      }
      if (
        (eventMatchesShortcut(e, shortcuts.openSettings) || eventMatchesShortcut(e, shortcuts.openSettingsAlt))
        && clickIfEnabled(domRefs.settingsBtn)
      ) {
        e.preventDefault();
      }
    }

    function bindIpcEvents() {
      if (ipcEventsBound) return;
      ipcEventsBound = true;

      boothAPI.onHealthCheckReport?.((payload) => {
        const issues = Array.isArray(payload?.issues) ? payload.issues : [];
        const errs = issues.filter((item) => item?.level === 'error').length;
        const warns = issues.filter((item) => item?.level === 'warn').length;
        if (errs > 0 || warns > 0) {
          const tone = errs > 0 ? 'error' : 'warn';
          showTransientMessage(`ヘルスチェック: エラー ${errs} 件 / 警告 ${warns} 件`, tone, 6000);
          upsertNotificationItem({
            id: `health-${Date.now()}`,
            type: 'health-check',
            title: 'ヘルスチェック結果',
            message: issues.map((item) => item.message).slice(0, 3).join(' / '),
            payload: { issues, at: payload?.at || new Date().toISOString() },
            unread: true,
          });
        }
      });

      boothAPI.onArchivePasswordRequired?.(async (payload) => {
        const requestId = String(payload?.requestId || '').trim();
        const archivePath = String(payload?.archivePath || '').trim();
        if (!requestId) return;
        const modal = document.getElementById('archive-password-modal');
        const filenameEl = document.getElementById('archive-password-filename');
        const input = document.getElementById('archive-password-input');
        const submitBtn = document.getElementById('archive-password-submit');
        const cancelBtn = document.getElementById('archive-password-cancel');
        if (!modal || !input || !submitBtn || !cancelBtn) {
          await boothAPI.respondArchivePassword?.(requestId, '', true);
          return;
        }
        if (filenameEl) filenameEl.textContent = archivePath;
        input.value = '';
        modal.classList.remove('hidden');
        input.focus();
        await new Promise((resolve) => {
          const finish = async (cancelled) => {
            modal.classList.add('hidden');
            submitBtn.removeEventListener('click', onSubmit);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKeydown);
            await boothAPI.respondArchivePassword?.(requestId, cancelled ? '' : input.value.trim(), cancelled);
            resolve();
          };
          const onSubmit = () => finish(false);
          const onCancel = () => finish(true);
          const onKeydown = (e) => { if (e.key === 'Enter') finish(false); if (e.key === 'Escape') finish(true); };
          submitBtn.addEventListener('click', onSubmit);
          cancelBtn.addEventListener('click', onCancel);
          input.addEventListener('keydown', onKeydown);
        });
      });

      boothAPI.onZipOversizeConfirmRequest?.(async (payload) => {
        const requestId = String(payload?.requestId || '').trim();
        if (!requestId) return;
        const entryBytes = Number(payload?.entryBytes || 0);
        const maxEntryBytes = Number(payload?.maxEntryBytes || 0);
        const sizeMb = Math.round(entryBytes / (1024 * 1024));
        const entryPath = String(payload?.entryPath || '').trim();
        const zipPath = String(payload?.zipPath || '').trim();
        const message = [
          `ZIP 内に ${sizeMb}MB のファイルがあります。`,
          '大容量ファイルは処理負荷が高くなる可能性があります。続行しますか?',
          `entry: ${entryPath || '-'}`,
          `zip: ${zipPath || '-'}`,
          `size: ${(entryBytes / (1024 * 1024)).toFixed(1)} MiB / limit: ${(maxEntryBytes / (1024 * 1024)).toFixed(1)} MiB`,
        ].join('\n');
        const allow = await showConfirmModal({
          title: 'ZIP展開の確認',
          message,
          confirmText: '展開を続行',
          cancelText: 'キャンセル',
          danger: true,
        });
        try {
          await boothAPI.respondZipOversizeConfirm?.(requestId, allow);
        } catch {
          // ignore
        }
      });
    }

    return {
      bindUiEvents,
      bindIpcEvents,
      handleGlobalShortcutEvent,
      showShortcutsTutorialOverlay,
      showNotificationCenter,
      showAvatarFilterAnalysisPromptModal,
    };
  }

  global.AvatoolRenderAuxUi = {
    createRenderAuxUi,
  };
})(window);


