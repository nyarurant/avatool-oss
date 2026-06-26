(function attachRenderImportModal(global) {
  function createRenderImportModal(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const boothAPI = deps?.boothAPI;
    const esc = deps?.esc;
    const formatDate = deps?.formatDate;
    const pathBasename = deps?.pathBasename;
    const enableKeyboardActivation = deps?.enableKeyboardActivation;
    const showTransientMessage = deps?.showTransientMessage;
    const clearSelectionMode = deps?.clearSelectionMode;
    const renderGrid = deps?.renderGrid;
    const setImportProgress = deps?.setImportProgress;
    const resetImportProgress = deps?.resetImportProgress;
    const setImportPhase = deps?.setImportPhase;
    const setImportAcknowledgeMode = deps?.setImportAcknowledgeMode;
    const setImportActionButtonsBusy = deps?.setImportActionButtonsBusy;
    const setImportCloseDisabled = deps?.setImportCloseDisabled;
    let ipcEventsBound = false;

    if (!state || !boothAPI || typeof esc !== 'function') {
      throw new Error('createRenderImportModal requires renderer import modal dependencies.');
    }

    function getPackageSelectImportMode() {
      return domRefs.pkgSelectModeBackground?.checked ? 'background' : 'live';
    }

    function syncModeButtonStyles(mode) {
      const isNormal = mode !== 'background';
      if (domRefs.pkgModeNormalBtn) {
        domRefs.pkgModeNormalBtn.style.borderColor = isNormal ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.1)';
        domRefs.pkgModeNormalBtn.style.background = isNormal ? 'rgba(59,130,246,0.08)' : 'transparent';
        const t = domRefs.pkgModeNormalBtn.querySelector('[data-mode-title]');
        if (t) t.style.color = isNormal ? '#93c5fd' : '#71717a';
      }
      if (domRefs.pkgModeBgBtn) {
        domRefs.pkgModeBgBtn.style.borderColor = isNormal ? 'rgba(255,255,255,0.1)' : 'rgba(59,130,246,0.4)';
        domRefs.pkgModeBgBtn.style.background = isNormal ? 'transparent' : 'rgba(59,130,246,0.08)';
        const t = domRefs.pkgModeBgBtn.querySelector('[data-mode-title]');
        if (t) t.style.color = isNormal ? '#71717a' : '#93c5fd';
      }
    }

    function updatePkgSelectConfirmLabel() {
      if (!domRefs.pkgSelectConfirm) return;
      const mode = getPackageSelectImportMode();
      domRefs.pkgSelectConfirm.textContent = mode === 'background'
        ? 'バックグラウンドインポートへ進む'
        : 'ライブインポートを開始';
      syncModeButtonStyles(mode);
    }

    function isInstallerPackageName(name) {
      const lower = String(name || '').toLowerCase();
      return lower.includes('installer') || lower.includes('vpm-package-auto-installer');
    }

    function getDefaultCheckedPackagePaths(packages = []) {
      const defaultPaths = new Set();
      const newest = packages[0];
      if (!newest) return defaultPaths;

      defaultPaths.add(String(newest.fullPath || ''));
      if (isInstallerPackageName(newest.name)) {
        const firstContentPackage = packages.find((pkg) => !isInstallerPackageName(pkg?.name));
        if (firstContentPackage) defaultPaths.add(String(firstContentPackage.fullPath || ''));
      }
      return defaultPaths;
    }

    async function openPackageSelectionModal(scanResults) {
      if (!domRefs.pkgSelectModal || !domRefs.pkgSelectList) return;
      domRefs.pkgSelectList.innerHTML = '';
      state.packageSelectionMap = new Map();
      if (domRefs.pkgSelectModeNormal) {
        domRefs.pkgSelectModeNormal.checked = true;
        domRefs.pkgSelectModeNormal.disabled = false;
      }
      if (domRefs.pkgSelectModeBackground) {
        domRefs.pkgSelectModeBackground.checked = false;
        domRefs.pkgSelectModeBackground.disabled = false;
      }
      updatePkgSelectConfirmLabel();

      scanResults.forEach((item) => {
        const { asset, packages } = item;
        const groupDiv = document.createElement('div');
        groupDiv.className = 'bg-[#111] border border-gray-800 rounded p-3';

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2 mb-2 border-b border-gray-800 pb-2';
        header.innerHTML = `
          <img src="${esc(asset.preview?.[0] || '')}" class="w-6 h-6 rounded object-cover bg-gray-800" />
          <span class="text-xs font-bold text-gray-200 truncate">${esc(asset.title || '無題')}</span>
          <span class="text-[10px] text-gray-500 ml-auto">${packages.length} packages</span>
        `;
        groupDiv.appendChild(header);

        const listDiv = document.createElement('div');
        listDiv.className = 'space-y-1';
        const defaultCheckedPaths = getDefaultCheckedPackagePaths(packages);
        packages.forEach((pkg, idx) => {
          const row = document.createElement('label');
          row.className = 'flex items-center gap-2 p-1.5 hover:bg-[#222] rounded cursor-pointer transition select-none';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'h-3.5 w-3.5 rounded bg-gray-700 border-gray-600';
          checkbox.checked = defaultCheckedPaths.has(String(pkg.fullPath || ''));
          checkbox.dataset.fullPath = pkg.fullPath || '';
          checkbox.dataset.itemId = String(asset?.itemId || '');
          checkbox.dataset.assetTitle = String(asset?.title || '');
          state.packageSelectionMap.set(String(pkg.fullPath || ''), asset);

          const info = document.createElement('div');
          info.className = 'flex-1 min-w-0';
          const sizeMb = Number(pkg.size || 0) / 1024 / 1024;
          info.innerHTML = `
            <div class="text-[11px] text-gray-300 truncate font-mono-custom">${esc(pkg.name || '')}</div>
            <div class="text-[9px] text-gray-600 flex gap-2">
              <span>${isFinite(sizeMb) ? sizeMb.toFixed(1) : '0.0'} MB</span>
              <span>${esc(formatDate?.(pkg.mtime) || '')}</span>
              ${idx === 0 ? '<span class="text-emerald-500 font-bold ml-1">NEW</span>' : ''}
            </div>
          `;

          row.appendChild(checkbox);
          row.appendChild(info);
          listDiv.appendChild(row);
        });

        groupDiv.appendChild(listDiv);
        domRefs.pkgSelectList.appendChild(groupDiv);
      });

      domRefs.pkgSelectModal.classList.remove('hidden');
      domRefs.pkgSelectModal.classList.add('flex');
    }

    function closePackageSelectionModal() {
      domRefs.pkgSelectModal?.classList.add('hidden');
      domRefs.pkgSelectModal?.classList.remove('flex');
      if (domRefs.pkgSelectModeNormal) {
        domRefs.pkgSelectModeNormal.disabled = false;
        domRefs.pkgSelectModeNormal.checked = true;
      }
      if (domRefs.pkgSelectModeBackground) domRefs.pkgSelectModeBackground.checked = false;
      updatePkgSelectConfirmLabel();
    }

    function normalizeProjectPresetKey(projectPath) {
      return String(projectPath || '').replace(/\//g, '\\').trim().toLowerCase();
    }

    function getProjectImportPreset(projectPath) {
      const key = normalizeProjectPresetKey(projectPath);
      const presets = (state.settings && typeof state.settings.projectImportPresets === 'object' && !Array.isArray(state.settings.projectImportPresets))
        ? state.settings.projectImportPresets
        : {};
      const row = presets[key] || {};
      return {
        autoDryRun: row?.autoDryRun !== false,
        autoInstallDeps: Boolean(row?.autoInstallDeps),
      };
    }

    async function updateProjectImportPreset(projectPath, patch = {}) {
      if (!boothAPI?.updateSettings) return;
      const key = normalizeProjectPresetKey(projectPath);
      if (!key) return;
      const current = getProjectImportPreset(projectPath);
      const nextPreset = {
        autoDryRun: patch?.autoDryRun !== undefined ? Boolean(patch.autoDryRun) : current.autoDryRun,
        autoInstallDeps: patch?.autoInstallDeps !== undefined ? Boolean(patch.autoInstallDeps) : current.autoInstallDeps,
      };
      const nextSettings = {
        ...(state.settings || {}),
        projectImportPresets: {
          ...((state.settings && typeof state.settings.projectImportPresets === 'object' && !Array.isArray(state.settings.projectImportPresets))
            ? state.settings.projectImportPresets
            : {}),
          [key]: nextPreset,
        },
      };
      const res = await boothAPI.updateSettings(nextSettings);
      if (res?.ok) state.settings = res.settings || nextSettings;
    }

    function renderProjectImportPresetEditor() {
      const selected = String(state.importModal.selectedProject || '').trim();
      const enabled = Boolean(selected);
      if (domRefs.importPresetPanel) domRefs.importPresetPanel.classList.toggle('opacity-50', !enabled);
      const preset = getProjectImportPreset(selected);
      if (domRefs.importPresetAutoDryRun) {
        domRefs.importPresetAutoDryRun.checked = preset.autoDryRun;
        domRefs.importPresetAutoDryRun.disabled = !enabled;
      }
      if (domRefs.importPresetAutoInstallDeps) {
        domRefs.importPresetAutoInstallDeps.checked = preset.autoInstallDeps;
        domRefs.importPresetAutoInstallDeps.disabled = !enabled;
      }
    }

    function renderImportProjectList() {
      if (!domRefs.importProjectList) return;
      const projects = state.settings?.unityProjects || [];
      const normalizeProjectPath = (value) => String(value || '').replace(/\//g, '\\').trim().toLowerCase();
      const runningSet = new Set(
        (Array.isArray(state.importModal.runningProjectPaths) ? state.importModal.runningProjectPaths : [])
          .map((value) => normalizeProjectPath(value))
          .filter(Boolean)
      );
      domRefs.importProjectList.innerHTML = '';

      if (!projects.length) {
        domRefs.importProjectList.innerHTML = `
          <div class="text-[10px] text-red-400 p-2 border border-red-900/50 bg-red-900/10 rounded">
            プロジェクトがありません。設定で読み込んでください。
          </div>
        `;
        return;
      }

      projects.forEach((project) => {
        const isRunning = runningSet.has(normalizeProjectPath(project.path));
        const row = document.createElement('div');
        row.className = `flex items-center gap-2 p-2 rounded border border-transparent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${
          isRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[#333]'
        }`;
        row.tabIndex = isRunning ? -1 : 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-pressed', 'false');
        row.setAttribute('aria-disabled', isRunning ? 'true' : 'false');
        row.setAttribute('aria-label', isRunning
          ? `インポート先 ${project.name || pathBasename(project.path)} は起動中のため選択不可`
          : `インポート先 ${project.name || pathBasename(project.path)} を選択`);
        row.innerHTML = `
          <div class="w-3 h-3 rounded-full border border-gray-600 flex items-center justify-center">
            <div class="w-1.5 h-1.5 rounded-full bg-blue-500 hidden"></div>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[11px] text-gray-200 font-bold truncate">${esc(project.name || pathBasename(project.path))}</div>
            <div class="text-[9px] text-gray-500 truncate font-mono-custom">${esc(project.path || '')}</div>
            ${isRunning ? '<div class="text-[9px] text-amber-300">起動中のため選択できません</div>' : ''}
          </div>
        `;
        row.addEventListener('click', () => {
          if (isRunning) return;
          domRefs.importProjectList.querySelectorAll(':scope > div').forEach((el) => {
            el.classList.remove('bg-blue-900/20', 'border-blue-800');
            el.setAttribute?.('aria-pressed', 'false');
            const dot = el.querySelector('.w-1\\.5');
            const ring = el.querySelector('.w-3');
            if (dot) dot.classList.add('hidden');
            if (ring) ring.classList.remove('border-blue-500');
          });
          row.classList.add('bg-blue-900/20', 'border-blue-800');
          row.setAttribute('aria-pressed', 'true');
          row.querySelector('.w-1\\.5')?.classList.remove('hidden');
          row.querySelector('.w-3')?.classList.add('border-blue-500');
          state.importModal.selectedProject = project.path;
          if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.disabled = false;
          if (domRefs.importDryRunBtn) domRefs.importDryRunBtn.disabled = false;
          renderProjectImportPresetEditor();
        });
        if (!isRunning) enableKeyboardActivation?.(row, () => row.click());
        domRefs.importProjectList.appendChild(row);
      });
    }

    async function openImportModal(packagePath, options = {}) {
      if (!domRefs.importModal) return;
      state.importModal.packagePath = String(packagePath || '').trim();
      state.importModal.selectedProject = null;
      state.importModal.isBatch = Boolean(options?.isBatch);
      state.importModal.batchTargets = Array.isArray(options.batchTargets) ? options.batchTargets : [];
      state.importModal.batchPaths = Array.isArray(options.batchPaths) ? options.batchPaths : [];
      state.importModal.batchPackages = Array.isArray(options.batchPackages) ? options.batchPackages : [];
      state.importModal.singlePackage = options?.singlePackage
        ? { ...options.singlePackage }
        : (state.importModal.batchPackages.length === 1 ? { ...state.importModal.batchPackages[0] } : null);
      state.importModal.runningProjectPaths = [];
      state.importModal.inProgress = false;
      try {
        const runningRes = await boothAPI?.getRunningUnityProjects?.();
        if (runningRes?.ok && Array.isArray(runningRes.projects)) {
          state.importModal.runningProjectPaths = runningRes.projects;
        }
      } catch {
        state.importModal.runningProjectPaths = [];
      }

      if (domRefs.importPackagePath) {
        const batchCount = state.importModal.isBatch ? state.importModal.batchPackages.length : 0;
        domRefs.importPackagePath.textContent = batchCount > 1
          ? `${batchCount} 件のパッケージ`
          : state.importModal.packagePath;
      }
      if (domRefs.importStatusBox) {
        domRefs.importStatusBox.classList.add('hidden');
        domRefs.importStatusBox.textContent = '';
      }
      if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.disabled = true;
      if (domRefs.importDryRunBtn) domRefs.importDryRunBtn.disabled = true;
      renderImportProjectList();
      renderProjectImportPresetEditor();

      domRefs.importModal.classList.remove('hidden');
      domRefs.importModal.classList.add('flex');
    }

    function closeImportModal(force = false) {
      if (state.importModal.inProgress && !force) return false;
      state.importModal.packagePath = '';
      state.importModal.selectedProject = null;
      state.importModal.isBatch = false;
      state.importModal.batchTargets = [];
      state.importModal.batchPaths = [];
      state.importModal.batchPackages = [];
      state.importModal.singlePackage = null;
      state.importModal.runningProjectPaths = [];
      state.importModal.inProgress = false;
      setImportAcknowledgeMode(false);
      setImportActionButtonsBusy(false);
      setImportCloseDisabled(false);
      resetImportProgress();
      domRefs.importModal?.classList.add('hidden');
      domRefs.importModal?.classList.remove('flex');
      return true;
    }

    function formatDryRunSummary(res) {
      if (!res || res.error) return '';
      const missing = Array.isArray(res.missingDeps) ? res.missingDeps.length : 0;
      const invalid = Number(res.invalid || 0);
      const renames = Number(res.renameCount || 0);
      const valid = Number(res.valid || 0);
      return `ドライラン: 有効 ${valid} 件 / 無効 ${invalid} 件 / リネーム予定 ${renames} 件 / 依存不足 ${missing} 件`;
    }

    async function resolveImportTargetsFromModal() {
      const packagePath = state.importModal.packagePath;
      const isBatch = Boolean(state.importModal.isBatch);
      const batchTargets = Array.isArray(state.importModal.batchTargets) ? state.importModal.batchTargets : [];
      const batchPackages = Array.isArray(state.importModal.batchPackages) ? state.importModal.batchPackages : [];
      const singlePackage = state.importModal.singlePackage && typeof state.importModal.singlePackage === 'object'
        ? state.importModal.singlePackage
        : null;
      let targetPaths = [];
      let packagesForImport = [];
      if (isBatch && state.importModal.batchPaths?.length) {
        targetPaths = [...state.importModal.batchPaths];
        packagesForImport = batchPackages.length
          ? [...batchPackages]
          : targetPaths.map((p) => ({ itemId: '', title: '', packagePath: p, meta: { topFolders: [], tokens: [] } }));
      } else if (isBatch) {
        if (domRefs.importStatusBox) domRefs.importStatusBox.innerHTML += '<br><span class="text-gray-300">パッケージパスを解決中...</span>';
        const resolveResults = await Promise.allSettled(batchTargets.map(async (target) => {
          const res = await boothAPI.listItemFiles(target.itemId, target.title);
          if (res?.error || !Array.isArray(res?.files)) return null;
          const file = res.files.find((row) => String(row.name || '').toLowerCase() === String(target.fileName || '').toLowerCase());
          return file?.fullPath || null;
        }));
        targetPaths = resolveResults
          .filter((row) => row.status === 'fulfilled' && row.value)
          .map((row) => row.value);
        packagesForImport = targetPaths.map((p) => ({ itemId: '', title: '', packagePath: p, meta: { topFolders: [], tokens: [] } }));
      } else {
        targetPaths = [packagePath];
        packagesForImport = [singlePackage || { itemId: '', title: '', packagePath, meta: { topFolders: [], tokens: [] } }];
      }
      targetPaths = Array.from(new Set(targetPaths.map((p) => String(p || '').trim()).filter(Boolean)));
      if (packagesForImport.length) {
        const pathSet = new Set(targetPaths);
        packagesForImport = packagesForImport
          .filter((row) => pathSet.has(String(row?.packagePath || '').trim()))
          .map((row) => ({
            itemId: String(row?.itemId || ''),
            title: String(row?.title || ''),
            packagePath: String(row?.packagePath || ''),
            previewUrl: String(row?.previewUrl || ''),
            meta: {
              topFolders: Array.isArray(row?.meta?.topFolders) ? row.meta.topFolders : [],
              tokens: Array.isArray(row?.meta?.tokens) ? row.meta.tokens : [],
            },
          }));
      }
      if (!packagesForImport.length) {
        packagesForImport = targetPaths.map((p) => ({ itemId: '', title: '', packagePath: p, previewUrl: '', meta: { topFolders: [], tokens: [] } }));
      }
      return { targetPaths, packagesForImport };
    }

    function showImportDependencyModal(options = {}) {
      const missing = Array.isArray(options.missing) ? options.missing : [];
      const rows = missing.map((row) => {
        const label = String(row?.label || row?.tool || '-');
        const installable = Boolean(row?.installable);
        return `<div class="text-[11px] text-zinc-300">${esc(label)} <span class="text-[10px] ${installable ? 'text-emerald-300' : 'text-amber-300'}">${installable ? '(導入可能)' : '(自動導入なし)'}</span></div>`;
      }).join('');
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[122] bg-black/75 flex items-center justify-center p-4';
        overlay.innerHTML = `
          <div class="w-full max-w-lg bg-[#0b0c10] border border-white/10 rounded-xl p-4 shadow-2xl">
            <div class="text-sm font-bold text-zinc-100 mb-2">依存ツールの確認</div>
            <div class="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap">インポート対象に必要なツールが未導入の可能性があります。
どうしますか？</div>
            <div class="mt-3 p-2 rounded border border-white/10 bg-black/30 space-y-1">
              ${rows || '<div class="text-[11px] text-zinc-500">未導入候補なし</div>'}
            </div>
            <div class="mt-4 flex justify-end gap-2">
              <button data-role="cancel" class="btn-action whitespace-nowrap">キャンセル</button>
              <button data-role="ignore" class="btn-action whitespace-nowrap">警告を無視して続行</button>
              <button data-role="install" class="btn-action btn-primary whitespace-nowrap">必要ツールを導入して続行</button>
            </div>
          </div>
        `;
        const close = (value) => {
          overlay.remove();
          document.removeEventListener('keydown', onKeyDown);
          resolve(value || 'cancel');
        };
        const onKeyDown = (e) => {
          if (e.key === 'Escape') close('cancel');
        };
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) close('cancel');
        });
        overlay.querySelector('[data-role="cancel"]')?.addEventListener('click', () => close('cancel'));
        overlay.querySelector('[data-role="ignore"]')?.addEventListener('click', () => close('ignore'));
        overlay.querySelector('[data-role="install"]')?.addEventListener('click', () => close('install'));
        document.addEventListener('keydown', onKeyDown);
        document.body.appendChild(overlay);
      });
    }

    function showDryRunReportModal(report = {}) {
      const packages = Array.isArray(report?.packages) ? report.packages : [];
      const renames = Array.isArray(report?.renameEntries) ? report.renameEntries : [];
      const missingDeps = Array.isArray(report?.missingDeps) ? report.missingDeps : [];
      const invalidPaths = Array.isArray(report?.invalidPaths) ? report.invalidPaths : [];
      const packageRows = packages.length
        ? packages.map((row) => {
          const title = String(row?.title || row?.itemId || '(no title)');
          const pkg = String(row?.packagePath || '');
          const tops = Array.isArray(row?.topFolders) ? row.topFolders.slice(0, 2).join(', ') : '';
          return `<div class="text-[10px] text-zinc-300"><span class="text-zinc-100">${esc(title)}</span><br><span class="text-zinc-500">${esc(pkg)}</span>${tops ? `<br><span class="text-zinc-400">top: ${esc(tops)}</span>` : ''}</div>`;
        }).join('')
        : '<div class="text-[10px] text-zinc-500">なし</div>';
      const renameRows = renames.length
        ? renames.map((row) => `<div class="text-[10px] text-zinc-300">${esc(String(row?.sourceTopFolder || ''))} <span class="text-zinc-500">-></span> ${esc(String(row?.targetTopFolder || ''))}</div>`).join('')
        : '<div class="text-[10px] text-zinc-500">なし</div>';
      const depRows = missingDeps.length
        ? missingDeps.map((row) => {
          const label = String(row?.label || row?.tool || '-');
          const tag = row?.installable ? '導入可能' : '自動導入なし';
          return `<div class="text-[10px] text-zinc-300">${esc(label)} <span class="text-[9px] text-amber-300">(${esc(tag)})</span></div>`;
        }).join('')
        : '<div class="text-[10px] text-zinc-500">なし</div>';
      const invalidRows = invalidPaths.length
        ? invalidPaths.map((row) => `<div class="text-[10px] text-zinc-400">${esc(String(row || ''))}</div>`).join('')
        : '<div class="text-[10px] text-zinc-500">なし</div>';
      const summary = formatDryRunSummary(report);
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[123] bg-black/80 flex items-center justify-center p-4';
        overlay.innerHTML = `
          <div class="w-full max-w-3xl max-h-[86vh] bg-[#0b0c10] border border-white/10 rounded-xl p-4 shadow-2xl overflow-hidden flex flex-col">
            <div class="text-sm font-bold text-zinc-100 mb-2">ドライラン結果</div>
            <div class="text-[11px] text-blue-300 mb-3">${esc(summary || '結果を取得しました。')}</div>
            <div class="overflow-y-auto pr-1 space-y-3">
              <div class="p-2 rounded border border-white/10 bg-black/30"><div class="text-[11px] text-zinc-200 mb-1">依存不足</div><div class="space-y-1">${depRows}</div></div>
              <div class="p-2 rounded border border-white/10 bg-black/30"><div class="text-[11px] text-zinc-200 mb-1">リネーム予定</div><div class="space-y-1">${renameRows}</div></div>
              <div class="p-2 rounded border border-white/10 bg-black/30"><div class="text-[11px] text-zinc-200 mb-1">無効パス</div><div class="space-y-1">${invalidRows}</div></div>
              <div class="p-2 rounded border border-white/10 bg-black/30"><div class="text-[11px] text-zinc-200 mb-1">インポート対象</div><div class="space-y-2">${packageRows}</div></div>
            </div>
            <div class="mt-3 flex justify-end gap-2"><button data-role="close" class="btn-action btn-primary">閉じる</button></div>
          </div>
        `;
        const close = () => {
          overlay.remove();
          document.removeEventListener('keydown', onKeyDown);
          resolve();
        };
        const onKeyDown = (e) => {
          if (e.key === 'Escape') close();
        };
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) close();
        });
        overlay.querySelector('[data-role="close"]')?.addEventListener('click', close);
        document.addEventListener('keydown', onKeyDown);
        document.body.appendChild(overlay);
      });
    }

    function getUnityImportErrorMessage(errorCode) {
      const code = String(errorCode || 'unknown');
      if (code === 'project_already_open') return 'Unityプロジェクトが別プロセスで開かれています。先にUnityを閉じてください。';
      if (code === 'unity_editor_not_found') return 'Unity Editorが見つかりません。設定でUnity Editorパスを指定してください。';
      if (code === 'project_not_found') return 'Unityプロジェクトが見つかりません。';
      if (code === 'avatool_scripts_disabled') return 'Avatool 独自Scriptを導入 がOFFのため、インポートを実行できません。自動インポート設定でONにしてください。';
      if (code === 'no_valid_packages') return '有効な .unitypackage ファイルが見つかりません。';
      if (code === 'os_association_failed') return 'Scriptインポート（OS連携）で .unitypackage を開けませんでした。Unityの起動状態と設定を確認してください。';
      if (code === 'os_assoc_project_selection_cancelled') return 'プロジェクト選択がキャンセルされました。';
      if (code === 'os_assoc_project_not_found') return '対象プロジェクトを特定できませんでした。UnityまたはVCCを開いた状態で再試行してください。';
      if (code === 'batch_os_association_disabled') return '一括通常インポートは現在有効です。再実行してください。';
      if (code === 'require_background_when_unity_closed') return 'Unity未起動時はバックグラウンドモードのみ利用できます。バックグラウンドで実行してください。';
      if (code === 'background_import_already_running') return 'このプロジェクトでは別のバックグラウンドインポートが実行中です。完了後に再試行してください。';
      if (code === 'unity_editor_invalid' || code === 'unity_editor_path_not_absolute') return 'Unity Editor Path が不正です。Unity.exe の絶対パスを設定してください。';
      if (code === 'import_list_integrity_failed') return 'インポートリストの整合性検証に失敗しました。再試行してください。';
      if (code === 'unity_exit_code_1') return 'Unityが終了コード 1 で異常終了しました。下のデバッグログ（末尾）を確認してください。';
      if (code === 'unsupported_import_mode') return 'このインポートモードはサポートされていません。';
      return `エラー: ${code}`;
    }

    async function executeImportDryRun(options = {}) {
      const showDetailsModal = options?.showDetailsModal !== false;
      const selectedProject = String(state.importModal.selectedProject || '').trim();
      if (!selectedProject) {
        showTransientMessage('先にインポート先プロジェクトを選択してください。', 'error');
        return null;
      }
      const { targetPaths, packagesForImport } = await resolveImportTargetsFromModal();
      if (!targetPaths.length) {
        if (domRefs.importStatusBox) {
          domRefs.importStatusBox.classList.remove('hidden');
          domRefs.importStatusBox.innerHTML = '<span class="text-red-400">有効なパッケージが見つかりません。</span>';
        }
        showTransientMessage('有効なパッケージが見つかりません。', 'error');
        return null;
      }
      if (!boothAPI?.importDryRun) return null;
      if (domRefs.importStatusBox) {
        domRefs.importStatusBox.classList.remove('hidden');
        domRefs.importStatusBox.innerHTML += '<br><span class="text-gray-300">ドライランを実行中...</span>';
      }
      const dryRunRes = await boothAPI.importDryRun(selectedProject, packagesForImport, targetPaths);
      if (!dryRunRes?.ok) {
        const friendly = getUnityImportErrorMessage(dryRunRes?.error || 'unknown');
        if (domRefs.importStatusBox) domRefs.importStatusBox.innerHTML += `<br><span class="text-red-400">ドライラン失敗: ${esc(friendly)}</span>`;
        showTransientMessage(`ドライラン失敗: ${friendly}`, 'error');
        return null;
      }
      const summary = formatDryRunSummary(dryRunRes);
      if (domRefs.importStatusBox && summary) domRefs.importStatusBox.innerHTML += `<br><span class="text-blue-300">${esc(summary)}</span>`;
      const renamePreview = Array.isArray(dryRunRes.renameEntries) ? dryRunRes.renameEntries.slice(0, 3) : [];
      if (domRefs.importStatusBox && renamePreview.length) {
        const detail = renamePreview.map((row) => `${row.sourceTopFolder} -> ${row.targetTopFolder}`).join(' / ');
        domRefs.importStatusBox.innerHTML += `<br><span class="text-zinc-400">リネーム例: ${esc(detail)}</span>`;
      }
      showTransientMessage(summary || 'ドライラン完了', 'info');
      if (showDetailsModal) {
        await showDryRunReportModal(dryRunRes);
      }
      return { dryRunRes, targetPaths, packagesForImport };
    }

    async function executeBackgroundImport() {
      if (state.importModal.inProgress) return;
      const selectedProject = String(state.importModal.selectedProject || '').trim();
      const isBatch = Boolean(state.importModal.isBatch);
      if (!selectedProject) return;
      if (!boothAPI?.importMultipleToUnity) return;
      const preset = getProjectImportPreset(selectedProject);

      state.importModal.inProgress = true;
      setImportActionButtonsBusy(true);
      setImportCloseDisabled(true);
      if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.disabled = true;
      if (domRefs.importStatusBox) {
        domRefs.importStatusBox.classList.remove('hidden');
        domRefs.importStatusBox.innerHTML = '<span class="text-amber-400">準備中...</span>';
      }
      setImportProgress(0, '準備中... 0/0');
      setImportPhase?.('running', '準備中...');

      try {
        try {
          const runningRes = await boothAPI?.getRunningUnityProjects?.();
          const running = Array.isArray(runningRes?.projects) ? runningRes.projects : [];
          const normalizedSelected = String(selectedProject || '').replace(/\//g, '\\').trim().toLowerCase();
          const isRunning = running.some((row) => String(row || '').replace(/\//g, '\\').trim().toLowerCase() === normalizedSelected);
          if (isRunning) {
            showTransientMessage('起動中のプロジェクトは background で選択できません。別プロジェクトを選択してください。', 'error');
            if (domRefs.importStatusBox) {
              domRefs.importStatusBox.classList.remove('hidden');
              domRefs.importStatusBox.innerHTML = '<span class="text-red-300">起動中プロジェクトは background 対象外です。</span>';
            }
            setImportPhase?.('error', 'プロジェクトが起動中です');
            setImportActionButtonsBusy(false);
            setImportCloseDisabled(false);
            return;
          }
        } catch {}
        const resolved = await resolveImportTargetsFromModal();
        let { targetPaths, packagesForImport } = resolved;

        if (!targetPaths.length) {
          if (domRefs.importStatusBox) domRefs.importStatusBox.innerHTML += '<br><span class="text-red-400">有効なパッケージが見つかりません。</span>';
          setImportProgress(0, '有効なパッケージが見つかりません');
          setImportPhase?.('error', '有効なパッケージが見つかりません');
          setImportActionButtonsBusy(false);
          setImportCloseDisabled(false);
          if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.disabled = false;
          return;
        }

        if (preset.autoDryRun) {
          setImportPhase?.('running', 'ドライランを実行中...');
          const dryRes = await executeImportDryRun({ showDetailsModal: false });
          if (!dryRes) {
            setImportPhase?.('error', 'ドライランに失敗しました');
            setImportProgress(0, 'ドライランに失敗しました');
            setImportActionButtonsBusy(false);
            setImportCloseDisabled(false);
            if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.disabled = false;
            return;
          }
          targetPaths = dryRes.targetPaths;
          packagesForImport = dryRes.packagesForImport;
        }

        if (boothAPI?.analyzeImportToolDeps) {
          setImportPhase?.('running', '依存関係を確認中...');
          const depRes = await boothAPI.analyzeImportToolDeps(selectedProject, packagesForImport);
          if (depRes?.error) {
            showTransientMessage(`依存チェック失敗: ${depRes.error}`, 'error');
            if (domRefs.importStatusBox) domRefs.importStatusBox.innerHTML += `<br><span class="text-red-400">依存チェック失敗: ${esc(depRes.error)}</span>`;
            setImportProgress(0, '依存チェックに失敗しました');
            setImportPhase?.('error', '依存チェックに失敗しました');
            setImportActionButtonsBusy(false);
            setImportCloseDisabled(false);
            if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.disabled = false;
            return;
          }
          const missing = Array.isArray(depRes?.missing) ? depRes.missing : [];
          if (missing.length > 0) {
            const choice = preset.autoInstallDeps
              ? 'install'
              : await showImportDependencyModal({ missing });
            if (choice === 'cancel') {
              setImportProgress(0, 'インポートをキャンセルしました');
              setImportPhase?.(null);
              setImportActionButtonsBusy(false);
              setImportCloseDisabled(false);
              if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.disabled = false;
              return;
            }
            if (choice === 'install') {
              const installTargets = missing.filter((row) => row?.installable).map((row) => String(row.tool || '').trim());
              if (installTargets.length > 0 && boothAPI?.installImportToolDeps) {
                if (domRefs.importStatusBox) domRefs.importStatusBox.innerHTML += '<br><span class="text-gray-300">依存ツールを導入中...</span>';
                const installRes = await boothAPI.installImportToolDeps(selectedProject, installTargets);
                if (installRes?.error || installRes?.ok === false) {
                  const msg = String(installRes?.error || (Array.isArray(installRes?.failed) ? installRes.failed.map((row) => `${row.tool}:${row.error}`).join(', ') : 'dependency_install_failed'));
                  showTransientMessage(`依存導入失敗: ${msg}`, 'error');
                  if (domRefs.importStatusBox) domRefs.importStatusBox.innerHTML += `<br><span class="text-red-400">依存導入失敗: ${esc(msg)}</span>`;
                  setImportProgress(0, '依存導入に失敗しました');
                  setImportPhase?.('error', '依存ツールの導入に失敗しました');
                  setImportActionButtonsBusy(false);
                  setImportCloseDisabled(false);
                  if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.disabled = false;
                  return;
                }
              }
            }
          }
        }

        if (domRefs.importStatusBox) domRefs.importStatusBox.innerHTML += `<br><span class="text-gray-300">インポートを開始 (${targetPaths.length} 件)...</span>`;
        setImportProgress(2, `インポート開始... 0/${targetPaths.length}`);
        setImportPhase?.('running', `Unityにインポートを送信中... (${targetPaths.length} 件)`);
        const res = boothAPI?.importMultipleToUnityWithMeta
          ? await boothAPI.importMultipleToUnityWithMeta(selectedProject, packagesForImport, 'background')
          : await boothAPI.importMultipleToUnity(selectedProject, targetPaths, 'background');
        if (res?.ok) {
          if (domRefs.importStatusBox) {
            if (String(res.mode || '') === 'os_association') {
              const opened = Number(res.opened || 0);
              const failed = Array.isArray(res.failed) ? res.failed.length : 0;
              domRefs.importStatusBox.innerHTML += `<br><span class="text-emerald-400">インポート処理を受け付けました。成功 ${opened} 件 / 失敗 ${failed} 件</span>`;
            } else if (String(res.mode || '') === 'live_bridge') {
              const queued = Number(res.queued || 0);
              const totalQueued = Number(res.totalQueued || queued);
              domRefs.importStatusBox.innerHTML += `<br><span class="text-emerald-400">Unity起動中のためライブ投入しました。追加 ${queued} 件（キュー合計 ${totalQueued} 件）</span>`;
            } else {
              domRefs.importStatusBox.innerHTML += '<br><span class="text-emerald-400">インポートに成功しました。</span>';
              if (res?.iconWrite && typeof res.iconWrite === 'object') {
                const written = Number(res.iconWrite.written || 0);
                const skipped = Number(res.iconWrite.skipped || 0);
                const conflicts = Number(res.iconWrite.conflicts || 0);
                domRefs.importStatusBox.innerHTML += `<br><span class="text-blue-300">SimpleFolderIcon: 生成 ${written} 件 / スキップ ${skipped} 件 / 競合 ${conflicts} 件</span>`;
              }
            }
          }
          setImportProgress(100, `インポート開始済み ${targetPaths.length}/${targetPaths.length}`);
          setImportPhase?.('done', 'インポート受け付け完了');
          setImportCloseDisabled(false);
          setImportAcknowledgeMode(true);
          if (isBatch) {
            clearSelectionMode?.();
            renderGrid?.();
          }
        } else {
          const friendly = getUnityImportErrorMessage(res?.error);
          if (domRefs.importStatusBox) domRefs.importStatusBox.innerHTML += `<br><span class="text-red-400">${esc(friendly)}</span>`;
          setImportProgress(0, 'インポートに失敗しました');
          setImportPhase?.('error', friendly);
          setImportActionButtonsBusy(false);
          setImportCloseDisabled(false);
          showTransientMessage(friendly, 'error');
          if (domRefs.importExecuteBtn) domRefs.importExecuteBtn.disabled = false;
        }
      } finally {
        state.importModal.inProgress = false;
      }
    }

    function bindUiEvents() {
      domRefs.importExecuteBtn?.addEventListener('click', async () => {
        await executeBackgroundImport();
      });
      domRefs.importDryRunBtn?.addEventListener('click', async () => {
        if (state.importModal.inProgress) return;
        await executeImportDryRun();
      });
      domRefs.importPresetAutoDryRun?.addEventListener('change', async (event) => {
        const selected = String(state.importModal.selectedProject || '').trim();
        if (!selected) return;
        await updateProjectImportPreset(selected, { autoDryRun: Boolean(event?.target?.checked) });
        renderProjectImportPresetEditor();
      });
      domRefs.importPresetAutoInstallDeps?.addEventListener('change', async (event) => {
        const selected = String(state.importModal.selectedProject || '').trim();
        if (!selected) return;
        await updateProjectImportPreset(selected, { autoInstallDeps: Boolean(event?.target?.checked) });
        renderProjectImportPresetEditor();
      });
      domRefs.importCloseBtn?.addEventListener('click', () => closeImportModal());
      domRefs.importCancelBtn?.addEventListener('click', () => closeImportModal());
      domRefs.pkgSelectCancel?.addEventListener('click', () => closePackageSelectionModal());
      domRefs.pkgSelectModeNormal?.addEventListener('change', () => updatePkgSelectConfirmLabel());
      domRefs.pkgSelectModeBackground?.addEventListener('change', () => updatePkgSelectConfirmLabel());
      domRefs.pkgSelectConfirm?.addEventListener('click', async () => {
        const selectedPackages = [];
        const checked = domRefs.pkgSelectList?.querySelectorAll('input[type="checkbox"]:checked');
        checked?.forEach((checkbox) => {
          const packagePath = checkbox.dataset.fullPath;
          if (!packagePath) return;
          const asset = state.packageSelectionMap.get(String(packagePath)) || null;
          selectedPackages.push({
            itemId: String(checkbox.dataset.itemId || asset?.itemId || ''),
            title: String(checkbox.dataset.assetTitle || asset?.title || ''),
            packagePath: String(packagePath),
            asset,
          });
        });
        if (!selectedPackages.length) {
          showTransientMessage('少なくとも1つのパッケージを選択してください。', 'error');
          return;
        }

        const originalText = domRefs.pkgSelectConfirm.textContent;
        domRefs.pkgSelectConfirm.textContent = '起動中...';
        domRefs.pkgSelectConfirm.disabled = true;
        try {
          const importMode = getPackageSelectImportMode();
          const dedupedPackages = Array.from(new Map(selectedPackages.map((row) => [String(row.packagePath || ''), row])).values());
          const paths = dedupedPackages.map((row) => String(row.packagePath || '').trim()).filter(Boolean);

          if (importMode === 'background') {
            closePackageSelectionModal();
            await openImportModal(paths[0] || '', {
              isBatch: paths.length > 1,
              batchPaths: paths,
              batchPackages: dedupedPackages.map((row) => ({
                itemId: String(row.itemId || ''),
                title: String(row.title || ''),
                packagePath: String(row.packagePath || ''),
                previewUrl: String(row?.asset?.preview?.[0] || ''),
                meta: { topFolders: [], tokens: [] },
              })),
            });
            showTransientMessage('インポート先プロジェクトを選択してください。', 'info');
            return;
          }

          const openRes = await boothAPI?.openPackagesWithAssociation?.(
            paths,
            dedupedPackages.map((row) => ({
              itemId: String(row.itemId || ''),
              title: String(row.title || ''),
              packagePath: String(row.packagePath || ''),
              previewUrl: String(row?.asset?.preview?.[0] || ''),
              meta: { topFolders: [], tokens: [] },
            }))
          );
          if (openRes?.ok) {
            let msg;
            let msgType = 'info';
            if (String(openRes.mode || '') === 'live_bridge') {
              const queued = Number(openRes.queued || 0);
              const totalQueued = Number(openRes.totalQueued || queued);
              msg = `ライブインポートをキューに追加しました: ${queued} 件（キュー合計 ${totalQueued} 件）`;
            } else {
              const opened = Number(openRes.opened || 0);
              const failed = Array.isArray(openRes.failed) ? openRes.failed.length : 0;
              msg = `ライブインポート: 成功 ${opened} 件 / 失敗 ${failed} 件`;
              if (failed) msgType = 'error';
            }
            showTransientMessage(msg, msgType);
            closePackageSelectionModal();
            if (state.selectionMode) {
              clearSelectionMode?.();
              renderGrid?.();
            }
          } else {
            const friendly = getUnityImportErrorMessage(openRes?.error || 'unknown');
            showTransientMessage(`ライブインポートに失敗: ${friendly}`, 'error');
          }
        } finally {
          domRefs.pkgSelectConfirm.textContent = originalText;
          domRefs.pkgSelectConfirm.disabled = false;
        }
      });
    }

    function bindIpcEvents() {
      if (ipcEventsBound) return;
      ipcEventsBound = true;
      boothAPI.onUnityImportProgress?.((progress) => {
        if (!progress || progress.scope !== 'manual-background-import') return;
        if (!domRefs.importModal || domRefs.importModal.classList.contains('hidden')) return;
        const total = Math.max(0, Number(progress.total || 0));
        const completed = Math.max(0, Number(progress.completed || 0));
        const fallbackPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
        const percent = Math.max(0, Math.min(100, Number(progress.percent ?? fallbackPercent) || 0));
        const message = String(progress.message || '').trim()
          || (total > 0 ? `インポート中... ${Math.min(completed, total)}/${total}` : 'インポート中...');
        setImportProgress(percent, message);
      });
    }

    return {
      bindUiEvents,
      bindIpcEvents,
      openImportModal,
      closeImportModal,
      openPackageSelectionModal,
      closePackageSelectionModal,
      renderImportProjectList,
      getPackageSelectImportMode,
      updatePkgSelectConfirmLabel,
      updateProjectImportPreset,
      renderProjectImportPresetEditor,
      executeImportDryRun,
      executeBackgroundImport,
      getUnityImportErrorMessage,
    };
  }

  global.AvatoolRenderImportModal = {
    createRenderImportModal,
  };
})(window);
