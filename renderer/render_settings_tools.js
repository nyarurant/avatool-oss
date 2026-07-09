(function attachRenderSettingsTools(global) {
  function createRenderSettingsTools(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const boothAPI = deps?.boothAPI;
    const esc = deps?.esc || ((value) => String(value || ''));
    const pathBasename = deps?.pathBasename || ((value) => String(value || ''));
    const defaultShortcuts = deps?.defaultShortcuts || {};
    const getRenderModeSetting = deps?.getRenderModeSetting || (() => 'progressive');
    const setAppUpdateStatusUI = deps?.setAppUpdateStatusUI;
    const setAppUpdateProgressUI = deps?.setAppUpdateProgressUI;
    const setAutoUpdateNotifyButton = deps?.setAutoUpdateNotifyButton;
    const renderShortcutEditor = deps?.renderShortcutEditor;
    const getShortcutMap = deps?.getShortcutMap;
    const renderProjectItemsProjectSelect = deps?.renderProjectItemsProjectSelect;
    const loadProjectItemsPanel = deps?.loadProjectItemsPanel;
    const readShortcutEditorValue = deps?.readShortcutEditorValue;
    const validateShortcutMap = deps?.validateShortcutMap;
    const applyShortcutValidationUi = deps?.applyShortcutValidationUi;
    const persistRenderModeSetting = deps?.persistRenderModeSetting;
    const renderGrid = deps?.renderGrid;
    const showTransientMessage = deps?.showTransientMessage;
    const resetMetaProgressState = deps?.resetMetaProgressState;
    const initializeApp = deps?.initializeApp;
    const renderImportProjectList = deps?.renderImportProjectList;
    const pushOperationLog = deps?.pushOperationLog;
    const stopShortcutCapture = deps?.stopShortcutCapture;
    const closeTopOverlayOrMode = deps?.closeTopOverlayOrMode;
    let ipcEventsBound = false;

    if (
      !state ||
      !boothAPI ||
      typeof setAppUpdateStatusUI !== 'function' ||
      typeof setAppUpdateProgressUI !== 'function' ||
      typeof renderShortcutEditor !== 'function' ||
      typeof getShortcutMap !== 'function' ||
      typeof renderProjectItemsProjectSelect !== 'function' ||
      typeof loadProjectItemsPanel !== 'function' ||
      typeof readShortcutEditorValue !== 'function' ||
      typeof validateShortcutMap !== 'function' ||
      typeof applyShortcutValidationUi !== 'function' ||
      typeof persistRenderModeSetting !== 'function' ||
      typeof renderGrid !== 'function' ||
      typeof showTransientMessage !== 'function' ||
      typeof resetMetaProgressState !== 'function' ||
      typeof initializeApp !== 'function' ||
      typeof renderImportProjectList !== 'function' ||
      typeof pushOperationLog !== 'function' ||
      typeof stopShortcutCapture !== 'function' ||
      typeof closeTopOverlayOrMode !== 'function'
    ) {
      throw new Error('createRenderSettingsTools requires state, boothAPI, and settings helpers.');
    }

    function renderOperationLogs() {
      if (!domRefs.operationLogList) return;
      const rows = Array.isArray(state.operationLogs) ? state.operationLogs.slice(-80).reverse() : [];
      if (!rows.length) {
        domRefs.operationLogList.innerHTML = '<div class="text-zinc-500">ログはありません。</div>';
        return;
      }
      domRefs.operationLogList.innerHTML = rows.map((row) => {
        const at = row?.at ? new Date(row.at).toLocaleTimeString('ja-JP') : '';
        return `<div class="border border-white/10 rounded px-2 py-1 bg-black/20">
          <span class="text-zinc-500 mr-2">${esc(at)}</span>
          <span class="text-zinc-300">${esc(row?.message || '')}</span>
        </div>`;
      }).join('');
    }

    async function refreshOperationLogsFromMain() {
      if (!boothAPI.getOperationLogs) return;
      const res = await boothAPI.getOperationLogs();
      if (res?.ok && Array.isArray(res.logs)) {
        state.operationLogs = res.logs;
        renderOperationLogs();
      }
    }

    async function refreshSettingsProfilesList(selectedName = '') {
      if (!boothAPI.listSettingsProfiles || !domRefs.settingsProfileSelect) return;
      const res = await boothAPI.listSettingsProfiles();
      const names = (res?.ok && Array.isArray(res.names)) ? res.names : [];
      state.settingsProfiles = names;
      domRefs.settingsProfileSelect.innerHTML = '';
      const firstOpt = document.createElement('option');
      firstOpt.value = '';
      firstOpt.textContent = 'プロファイルを選択';
      domRefs.settingsProfileSelect.appendChild(firstOpt);
      for (const name of names) {
        const opt = document.createElement('option');
        opt.value = String(name);
        opt.textContent = String(name);
        domRefs.settingsProfileSelect.appendChild(opt);
      }
      if (selectedName && names.includes(selectedName)) {
        domRefs.settingsProfileSelect.value = selectedName;
      }
    }

    function renderUnityProjectsList(projects) {
      if (!domRefs.settingUnityProjects) return;
      const rows = Array.isArray(projects) ? projects : [];
      domRefs.settingUnityProjects.innerHTML = '';
      if (!rows.length) {
        domRefs.settingUnityProjects.innerHTML = '<div class="text-gray-500 text-[9px]">No projects registered.</div>';
        return;
      }

      rows.forEach((project, idx) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between gap-2 bg-black/25 px-2 py-1.5 rounded mb-1 border border-white/10';
        row.innerHTML = `
          <div class="truncate flex-1 mr-2">
            <div class="text-zinc-100 text-[10px] font-semibold">${esc(project.name || pathBasename(project.path || 'Project'))}</div>
            <div class="text-zinc-500 text-[9px] truncate" title="${esc(project.path || '')}">${esc(project.path || '')}</div>
          </div>
          <button class="settings-remove-btn" data-idx="${idx}" title="Remove" aria-label="Remove project">x</button>
        `;
        row.querySelector('button')?.addEventListener('click', () => {
          const name = project.name || pathBasename(project.path || 'Project');
          if (!confirm(`「${name}」をプロジェクトリストから削除しますか？`)) return;
          const next = [...(state.settings?.unityProjects || [])];
          next.splice(idx, 1);
          if (!state.settings) state.settings = {};
          state.settings.unityProjects = next;
          renderUnityProjectsList(next);
        });
        domRefs.settingUnityProjects.appendChild(row);
      });

      renderProjectItemsProjectSelect(rows);
    }

    async function openSettingsModal() {
      if (!domRefs.settingsModal || !boothAPI.getSettings) return;
      const settings = await boothAPI.getSettings();
      state.settings = settings || {};

      if (domRefs.settingDownloadPath) domRefs.settingDownloadPath.value = state.settings.downloadPath || '';
      if (domRefs.settingConcurrency) domRefs.settingConcurrency.value = String(state.settings.concurrency ?? 2);
      if (domRefs.settingAutoExtract) domRefs.settingAutoExtract.checked = Boolean(state.settings.autoExtract);
      if (domRefs.settingAutoCheckInterval) domRefs.settingAutoCheckInterval.value = String(state.settings.autoCheckInterval ?? 0);
      if (domRefs.settingMinFreeSpaceGb) domRefs.settingMinFreeSpaceGb.value = String(state.settings.minFreeSpaceGb ?? 2);
      if (domRefs.settingCookieFile) domRefs.settingCookieFile.value = state.settings.cookieFile || '';
      if (domRefs.settingUnityPath) domRefs.settingUnityPath.value = state.settings.unityEditorPath || '';
      if (domRefs.settingSafeMode) domRefs.settingSafeMode.checked = Boolean(state.settings.safeMode);
      if (domRefs.settingHealthCheckOnStartup) domRefs.settingHealthCheckOnStartup.checked = state.settings.healthCheckOnStartup !== false;
      if (domRefs.settingDebugLogEnabled) domRefs.settingDebugLogEnabled.checked = Boolean(state.settings.debugLogEnabled);
      if (domRefs.settingExperimentalModelPreview) domRefs.settingExperimentalModelPreview.checked = Boolean(state.settings.experimentalModelPreview);
      if (domRefs.settingRenderMode) domRefs.settingRenderMode.value = getRenderModeSetting();
      if (domRefs.settingAppVersion && boothAPI.getAppVersion) {
        try {
          const appInfo = await boothAPI.getAppVersion();
          const ver = String(appInfo?.version || '');
          const flag = appInfo?.packaged ? '' : ' (dev)';
          domRefs.settingAppVersion.textContent = `${ver}${flag}`;
        } catch {
          domRefs.settingAppVersion.textContent = '-';
        }
      }
      setAppUpdateStatusUI('更新状態: 未確認', 'info');
      setAppUpdateProgressUI(0, false);
      if (domRefs.settingKeyboardShortcutsEnabled) {
        domRefs.settingKeyboardShortcutsEnabled.checked = state.settings.keyboardShortcutsEnabled !== false;
      }
      renderShortcutEditor(getShortcutMap());
      if (domRefs.settingSchedulerEnabled) domRefs.settingSchedulerEnabled.checked = Boolean(state.settings.downloadSchedulerEnabled);
      if (domRefs.settingSchedulerProfile) domRefs.settingSchedulerProfile.value = String(state.settings.downloadSchedulerProfile || 'balanced');
      if (domRefs.settingSchedulerStartHour) domRefs.settingSchedulerStartHour.value = String(state.settings.downloadSchedulerStartHour ?? 1);
      if (domRefs.settingSchedulerEndHour) domRefs.settingSchedulerEndHour.value = String(state.settings.downloadSchedulerEndHour ?? 6);
      if (domRefs.settingRetryMaxAttempts) domRefs.settingRetryMaxAttempts.value = String(state.settings.downloadRetryMaxAttempts ?? 4);
      if (domRefs.settingRetryBaseDelayMs) domRefs.settingRetryBaseDelayMs.value = String(state.settings.downloadRetryBaseDelayMs ?? 1200);
      if (domRefs.cookieStatus) domRefs.cookieStatus.textContent = '';
      renderUnityProjectsList(state.settings.unityProjects || []);
      await refreshSettingsProfilesList();
      await refreshOperationLogsFromMain();
      if (domRefs.projectItemsSelect) {
        await loadProjectItemsPanel(domRefs.projectItemsSelect.value || '');
      }

      domRefs.settingsModal.classList.remove('hidden');
      domRefs.settingsModal.classList.add('flex');
    }

    async function loadVCCProjectsIntoSettings() {
      if (!boothAPI.loadVCCProjects) return;
      const res = await boothAPI.loadVCCProjects();
      if (!res?.ok) {
        showTransientMessage(`VCC load failed: ${res?.error || 'unknown'}`, 'error');
        return;
      }

      if (!state.settings) state.settings = {};
      if (domRefs.settingUnityPath && !domRefs.settingUnityPath.value && res.editorPath) {
        domRefs.settingUnityPath.value = res.editorPath;
      }

      const current = Array.isArray(state.settings.unityProjects) ? state.settings.unityProjects : [];
      const incoming = Array.isArray(res.projects) ? res.projects : [];
      const dedupIncoming = incoming.filter((project) => !current.some((currentProject) => currentProject.path === project.path));
      const merged = [...current, ...dedupIncoming];
      state.settings.unityProjects = merged;
      renderUnityProjectsList(merged);
      if (domRefs.projectItemsSelect) {
        await loadProjectItemsPanel(domRefs.projectItemsSelect.value || '');
      }
      showTransientMessage(`Loaded ${dedupIncoming.length} projects from VCC.`, 'info');
    }

    async function saveSettingsFromModal() {
      if (!boothAPI.updateSettings) return;
      const parsedShortcuts = readShortcutEditorValue();
      const validation = validateShortcutMap(parsedShortcuts);
      applyShortcutValidationUi(validation);
      if (validation.reservedHits.length) {
        showTransientMessage('予約キーが含まれているため保存できません。', 'error');
        return;
      }
      if (validation.duplicates.length) {
        showTransientMessage('ショートカットが重複しているため保存できません。', 'error');
        return;
      }
      const next = {
        downloadPath: domRefs.settingDownloadPath?.value || '',
        concurrency: Number(domRefs.settingConcurrency?.value || 2),
        autoExtract: Boolean(domRefs.settingAutoExtract?.checked),
        autoCheckInterval: Number(domRefs.settingAutoCheckInterval?.value || 0),
        minFreeSpaceGb: Number(domRefs.settingMinFreeSpaceGb?.value ?? 2),
        autoBootstrapEnabled: state.settings?.autoBootstrapEnabled !== false,
        unityEditorPath: domRefs.settingUnityPath?.value || '',
        unityProjects: state.settings?.unityProjects || [],
        safeMode: Boolean(domRefs.settingSafeMode?.checked),
        healthCheckOnStartup: Boolean(domRefs.settingHealthCheckOnStartup?.checked),
        debugLogEnabled: Boolean(domRefs.settingDebugLogEnabled?.checked),
        experimentalModelPreview: Boolean(domRefs.settingExperimentalModelPreview?.checked),
        keyboardShortcutsEnabled: Boolean(domRefs.settingKeyboardShortcutsEnabled?.checked),
        keyboardShortcuts: parsedShortcuts,
        downloadSchedulerEnabled: Boolean(domRefs.settingSchedulerEnabled?.checked),
        downloadSchedulerProfile: String(domRefs.settingSchedulerProfile?.value || 'balanced'),
        renderMode: String(domRefs.settingRenderMode?.value || getRenderModeSetting()),
        downloadSchedulerStartHour: Number(domRefs.settingSchedulerStartHour?.value || 1),
        downloadSchedulerEndHour: Number(domRefs.settingSchedulerEndHour?.value || 6),
        downloadRetryMaxAttempts: Number(domRefs.settingRetryMaxAttempts?.value || 4),
        downloadRetryBaseDelayMs: Number(domRefs.settingRetryBaseDelayMs?.value || 1200),
      };
      const res = await boothAPI.updateSettings(next);
      if (res?.ok) {
        state.settings = res.settings || next;
        if (typeof window.setupDebugConsoleBridge === 'function') window.setupDebugConsoleBridge();
        persistRenderModeSetting(state.settings?.renderMode || next.renderMode || 'progressive');
        renderGrid();
        showTransientMessage('設定を保存しました。', 'info');
        domRefs.settingsModal?.classList.add('hidden');
        domRefs.settingsModal?.classList.remove('flex');
      } else {
        showTransientMessage(`保存に失敗: ${res?.error || 'unknown'}`, 'error');
      }
    }

    async function loadCookieFileFromModal() {
      if (!boothAPI.loadCookieFile) return;
      const filePath = domRefs.settingCookieFile?.value || '';
      const res = await boothAPI.loadCookieFile(filePath);
      if (res?.ok) {
        if (domRefs.cookieStatus) {
          domRefs.cookieStatus.textContent = `${res.cookieCount}件のCookieを読み込みました`;
          domRefs.cookieStatus.className = 'text-[9px] text-emerald-400 mt-1';
        }
        showTransientMessage('Cookieを読み込みました。', 'info');
      } else {
        if (domRefs.cookieStatus) {
          const expText = res?.expiredAt ? ` (expired ${new Date(res.expiredAt).toLocaleString('ja-JP')})` : '';
          domRefs.cookieStatus.textContent = `読み込みに失敗: ${res?.error || 'unknown'}${expText}`;
          domRefs.cookieStatus.className = 'text-[9px] text-red-400 mt-1';
        }
        showTransientMessage(`Cookie読み込みに失敗: ${res?.error || 'unknown'}`, 'error');
      }
    }

    async function openLoginWindowFromModal() {
      if (!boothAPI.openLoginWindow) return;
      if (state.loginInProgress) return;
      state.loginInProgress = true;
      if (domRefs.cookieLoginBtn) domRefs.cookieLoginBtn.disabled = true;
      resetMetaProgressState();
      if (domRefs.metaProgressWrapper) domRefs.metaProgressWrapper.classList.remove('hidden');
      if (domRefs.progressBarTop) domRefs.progressBarTop.style.width = '0%';
      if (domRefs.progressBarBottom) domRefs.progressBarBottom.style.width = '0%';
      if (domRefs.progressPercent) domRefs.progressPercent.textContent = '0%';
      if (domRefs.progressLabel) domRefs.progressLabel.textContent = 'ログイン待機中...';
      if (domRefs.progressCountLabel) domRefs.progressCountLabel.textContent = '';
      if (domRefs.cookieStatus) {
        domRefs.cookieStatus.textContent = 'ログインウィンドウを開いています...';
        domRefs.cookieStatus.className = 'text-[9px] text-gray-400 mt-1';
      }
      try {
        const res = await Promise.race([
          boothAPI.openLoginWindow(),
          new Promise((resolve) => setTimeout(() => resolve({ error: 'login_flow_timeout' }), 180000)),
        ]);
        if (res?.ok) {
          const libText = Number.isFinite(Number(res.libraryItemCount))
            ? ` / library items: ${Number(res.libraryItemCount)}`
            : '';
          const metaText = res?.metaRefreshStarted
            ? ' / meta syncing...'
            : (res?.metaSaved
              ? ` / meta saved: ${Number(res.metaItemCount || 0)}`
              : (res?.metaSaveError ? ` / meta save failed: ${res.metaSaveError}` : ''));
          if (domRefs.cookieStatus) {
            domRefs.cookieStatus.textContent = `${res.cookieCount || 0}件のCookieを取得しました${libText}${metaText}`;
            domRefs.cookieStatus.className = 'text-[9px] text-emerald-400 mt-1';
          }
          await initializeApp();
          showTransientMessage(`Login window completed${libText}${metaText}.`, res?.metaSaveError ? 'error' : 'info');
        } else {
          const reason = String(res?.error || 'canceled');
          if (domRefs.cookieStatus) {
            domRefs.cookieStatus.textContent = `ログイン未完了: ${reason}`;
            domRefs.cookieStatus.className = 'text-[9px] text-amber-400 mt-1';
          }
          showTransientMessage(`Login not completed: ${reason}`, 'error');
          if (domRefs.metaProgressWrapper) domRefs.metaProgressWrapper.classList.add('hidden');
        }
      } finally {
        state.loginInProgress = false;
        if (domRefs.cookieLoginBtn) domRefs.cookieLoginBtn.disabled = false;
      }
    }

    async function logoutSessionFromModal() {
      if (!boothAPI.logoutSession) return;
      const res = await boothAPI.logoutSession();
      if (res?.ok) {
        if (domRefs.cookieStatus) {
          domRefs.cookieStatus.textContent = 'ログアウトしました（Cookieを削除）';
          domRefs.cookieStatus.className = 'text-[9px] text-emerald-400 mt-1';
        }
        showTransientMessage('ログアウトしました。', 'info');
      } else {
        const reason = String(res?.error || 'unknown');
        if (domRefs.cookieStatus) {
          domRefs.cookieStatus.textContent = `ログアウト失敗: ${reason}`;
          domRefs.cookieStatus.className = 'text-[9px] text-red-400 mt-1';
        }
        showTransientMessage(`ログアウトに失敗: ${reason}`, 'error');
      }
    }

    function bindUiEvents() {
      document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.settings-panel').forEach(p => p.classList.add('hidden'));
          tab.classList.add('active');
          document.querySelector(`.settings-panel[data-panel="${tab.dataset.tab}"]`)?.classList.remove('hidden');
          if (tab.dataset.tab === 'shortcuts') {
            renderShortcutEditor?.(getShortcutMap?.());
          }
        });
      });

      domRefs.settingsBtn?.addEventListener('click', async () => {
        document.querySelectorAll('.settings-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
        document.querySelectorAll('.settings-panel').forEach((p, i) => p.classList.toggle('hidden', i !== 0));
        await openSettingsModal();
      });
      domRefs.settingsClose?.addEventListener('click', () => {
        stopShortcutCapture();
        closeTopOverlayOrMode();
      });
      document.getElementById('settings-close-alt')?.addEventListener('click', () => {
        stopShortcutCapture();
        closeTopOverlayOrMode();
      });
      domRefs.settingShortcutsReset?.addEventListener('click', () => {
        renderShortcutEditor(defaultShortcuts);
        showTransientMessage('ショートカット設定をデフォルトに戻しました。', 'info');
      });
      domRefs.settingsSave?.addEventListener('click', async () => {
        await saveSettingsFromModal();
      });
      domRefs.settingsRunHealthCheck?.addEventListener('click', async () => {
        if (!boothAPI?.runHealthCheck) return;
        const res = await boothAPI.runHealthCheck('manual');
        if (res?.ok) {
          const issues = Array.isArray(res?.report?.issues) ? res.report.issues : [];
          showTransientMessage(`ヘルスチェック完了: 問題 ${issues.length} 件`, issues.length ? 'error' : 'info');
        } else {
          showTransientMessage(`ヘルスチェック失敗: ${res?.error || 'unknown'}`, 'error');
        }
      });
      domRefs.settingAppUpdateCheck?.addEventListener('click', async () => {
        if (!boothAPI?.checkAppUpdate) return;
        domRefs.settingAppUpdateCheck.disabled = true;
        setAppUpdateStatusUI('アプリ更新をチェック中...', 'info');
        try {
          const res = await boothAPI.checkAppUpdate(true);
          if (res?.error && res.error !== 'not_packaged') {
            setAppUpdateStatusUI(`更新チェック失敗: ${res.error}`, 'error');
          } else if (res?.error === 'not_packaged') {
            setAppUpdateStatusUI('開発モードのため更新チェックをスキップ', 'info');
          }
        } finally {
          domRefs.settingAppUpdateCheck.disabled = false;
        }
      });
      domRefs.settingsSaveProfile?.addEventListener('click', async () => {
        const name = String(domRefs.settingsProfileName?.value || '').trim();
        if (!name) {
          showTransientMessage('プロファイル名を入力してください。', 'error');
          return;
        }
        if (!boothAPI?.saveSettingsProfile) return;
        const res = await boothAPI.saveSettingsProfile(name, state.settings || {});
        if (res?.ok) {
          await refreshSettingsProfilesList(name);
          showTransientMessage(`プロファイル保存: ${name}`, 'info');
        } else {
          showTransientMessage(`プロファイル保存失敗: ${res?.error || 'unknown'}`, 'error');
        }
      });
      domRefs.settingsApplyProfile?.addEventListener('click', async () => {
        const name = String(domRefs.settingsProfileSelect?.value || '').trim();
        if (!name) {
          showTransientMessage('適用するプロファイルを選択してください。', 'error');
          return;
        }
        if (!boothAPI?.applySettingsProfile) return;
        const res = await boothAPI.applySettingsProfile(name);
        if (res?.ok) {
          state.settings = res.settings || state.settings || {};
          await openSettingsModal();
          showTransientMessage(`プロファイル適用: ${name}`, 'info');
        } else {
          showTransientMessage(`プロファイル適用失敗: ${res?.error || 'unknown'}`, 'error');
        }
      });
      domRefs.settingsExportBtn?.addEventListener('click', async () => {
        const exportPath = String(domRefs.settingsExportPath?.value || '').trim();
        if (!exportPath) {
          showTransientMessage('Export path を入力してください。', 'error');
          return;
        }
        if (!boothAPI?.exportAppBundle) return;
        const res = await boothAPI.exportAppBundle(exportPath, state.notifications || []);
        if (res?.ok) showTransientMessage(`Export 完了: ${exportPath}`, 'info');
        else showTransientMessage(`Export 失敗: ${res?.error || 'unknown'}`, 'error');
      });
      domRefs.settingsImportBtn?.addEventListener('click', async () => {
        const importPath = String(domRefs.settingsImportPath?.value || '').trim();
        if (!importPath) {
          showTransientMessage('Import path を入力してください。', 'error');
          return;
        }
        if (!boothAPI?.importAppBundle) return;
        const res = await boothAPI.importAppBundle(importPath);
        if (res?.ok) {
          if (Array.isArray(res.notifications)) {
            state.notifications = res.notifications;
            setAutoUpdateNotifyButton?.();
          }
          await openSettingsModal();
          await initializeApp();
          showTransientMessage(`Import 完了: ${importPath}`, 'info');
        } else {
          showTransientMessage(`Import 失敗: ${res?.error || 'unknown'}`, 'error');
        }
      });
      domRefs.operationLogClearBtn?.addEventListener('click', async () => {
        if (!boothAPI?.clearOperationLogs) return;
        if (!confirm('操作ログをすべて削除しますか？')) return;
        const res = await boothAPI.clearOperationLogs();
        if (res?.ok) {
          state.operationLogs = [];
          renderOperationLogs();
        }
      });
      domRefs.operationLogPanel?.addEventListener('toggle', async () => {
        if (!domRefs.operationLogPanel.open) return;
        await refreshOperationLogsFromMain();
      });
      domRefs.cookieLoadBtn?.addEventListener('click', async () => {
        await loadCookieFileFromModal();
      });
      domRefs.cookieLoginBtn?.addEventListener('click', async () => {
        await openLoginWindowFromModal();
      });
      domRefs.cookieLogoutBtn?.addEventListener('click', async () => {
        await logoutSessionFromModal();
      });
      domRefs.loadVccBtn?.addEventListener('click', async () => {
        await loadVCCProjectsIntoSettings();
      });
    }

    function bindIpcEvents() {
      if (ipcEventsBound) return;
      ipcEventsBound = true;
      boothAPI.onOperationLog?.((entry) => {
        pushOperationLog(entry);
      });
      boothAPI.onVccProjectsUpdated?.((payload) => {
        try {
          if (!state.settings) state.settings = {};
          state.settings.unityProjects = Array.isArray(payload?.unityProjects) ? payload.unityProjects : (state.settings.unityProjects || []);
          state.settings.unityEditorPath = String(payload?.unityEditorPath || state.settings.unityEditorPath || '');

          if (domRefs.settingUnityPath) domRefs.settingUnityPath.value = state.settings.unityEditorPath;
          renderUnityProjectsList(state.settings.unityProjects || []);
          renderImportProjectList();

          const added = Number(payload?.added || 0);
          const removed = Number(payload?.removed || 0);
          if (added > 0 || removed > 0) {
            const parts = [];
            if (added > 0) parts.push(`+${added}`);
            if (removed > 0) parts.push(`-${removed}`);
            showTransientMessage(`VCCプロジェクトを更新 (${parts.join(' / ')})`, 'info');
          }
        } catch (error) {
          console.warn('[renderer] onVccProjectsUpdated failed:', error);
        }
      });
    }

    return {
      bindUiEvents,
      bindIpcEvents,
      renderOperationLogs,
      refreshOperationLogsFromMain,
      refreshSettingsProfilesList,
      renderUnityProjectsList,
      openSettingsModal,
      loadVCCProjectsIntoSettings,
      saveSettingsFromModal,
      loadCookieFileFromModal,
      openLoginWindowFromModal,
      logoutSessionFromModal,
    };
  }

  global.AvatoolRenderSettingsTools = {
    createRenderSettingsTools,
  };
})(window);
