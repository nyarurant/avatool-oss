(function attachRenderProjectItems(global) {
  function createRenderProjectItems(deps) {
    const state = deps?.state;
    const domRefs = deps?.domRefs || {};
    const boothAPI = deps?.boothAPI;
    const esc = deps?.esc || ((value) => String(value || ''));
    const formatDate = deps?.formatDate || ((value) => String(value || ''));
    const pathBasename = deps?.pathBasename || ((value) => String(value || ''));
    const buildCandidateTokens = deps?.buildCandidateTokens;
    const showTransientMessage = deps?.showTransientMessage;

    if (
      !state ||
      !boothAPI ||
      typeof buildCandidateTokens !== 'function' ||
      typeof showTransientMessage !== 'function'
    ) {
      throw new Error('createRenderProjectItems requires state, boothAPI, and project-items helpers.');
    }

    function renderProjectItemsProjectSelect(projects) {
      if (!domRefs.projectItemsSelect) return;
      const rows = Array.isArray(projects) ? projects : [];
      const prev = domRefs.projectItemsSelect.value;
      domRefs.projectItemsSelect.innerHTML = '<option value="">プロジェクトを選択...</option>';
      rows.forEach((project) => {
        const opt = document.createElement('option');
        opt.value = String(project.path || '');
        opt.textContent = project.name || pathBasename(project.path || '');
        domRefs.projectItemsSelect.appendChild(opt);
      });
      const hasPrev = rows.some((project) => String(project.path || '') === prev);
      if (hasPrev) {
        domRefs.projectItemsSelect.value = prev;
      } else if (rows.length) {
        domRefs.projectItemsSelect.value = String(rows[0].path || '');
      }
    }

    async function loadProjectItemsPanel(projectPath) {
      if (!domRefs.projectItemsList) return;
      const target = String(projectPath || '').trim();
      if (!target) {
        domRefs.projectItemsList.textContent = 'プロジェクトを選択するとインポート済み項目を表示します。';
        if (domRefs.projectItemsStatus) domRefs.projectItemsStatus.textContent = 'プロジェクトを選択するとインポート済み項目を表示します。';
        return;
      }
      if (!boothAPI.getProjectItems) {
        domRefs.projectItemsList.textContent = 'プロジェクト項目取得機能が利用できません。';
        return;
      }
      const res = await boothAPI.getProjectItems(target);
      if (res?.error) {
        domRefs.projectItemsList.textContent = `読み込みに失敗: ${res.error}`;
        if (domRefs.projectItemsStatus) domRefs.projectItemsStatus.textContent = `読み込みに失敗: ${res.error}`;
        return;
      }
      const items = Array.isArray(res?.items) ? res.items : [];
      if (!items.length) {
        domRefs.projectItemsList.textContent = 'このプロジェクトにインポート済み項目はありません。';
        if (domRefs.projectItemsStatus) domRefs.projectItemsStatus.textContent = 'このプロジェクトにインポート済み項目はありません。';
        return;
      }
      if (domRefs.projectItemsStatus) domRefs.projectItemsStatus.textContent = `${items.length}件`;
      const previewByItemId = new Map(
        (state.allAssets || []).map((asset) => [String(asset.itemId || ''), String(asset.preview?.[0] || '')])
      );
      domRefs.projectItemsList.innerHTML = items.slice(0, 150).map((item) => {
        const title = esc(item.title || '(untitled)');
        const top = esc(item.topFolder || '-');
        const date = esc(formatDate(item.lastImportedAt));
        const flagHtml = item.reconciled
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-emerald-400"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
          : '';
        const itemId = String(item.itemId || '');
        const preview = esc(previewByItemId.get(itemId) || '');
        const previewHtml = preview
          ? `<img src="${preview}" class="w-11 h-11 rounded object-cover bg-[#111] border border-gray-800 flex-shrink-0" alt="preview">`
          : '<div class="w-11 h-11 rounded bg-[#111] border border-gray-800 text-gray-600 flex items-center justify-center text-[8px] font-mono-custom flex-shrink-0">NO IMG</div>';

        return `<div class="grid grid-cols-[auto_1fr_120px_100px] items-center gap-4 p-2 rounded-lg border border-transparent hover:border-blue-500/30 hover:bg-blue-500/5 transition-all">
          ${previewHtml}
          <div class="min-w-0">
            <div class="text-[11px] font-medium text-gray-100 truncate flex items-center gap-2">
              ${title}
              ${flagHtml}
            </div>
            <div class="text-[9px] text-gray-500 truncate font-mono-custom">${top}</div>
          </div>
          <div class="text-[10px] text-gray-400 font-mono-custom">#${esc(itemId)}</div>
          <div class="text-[10px] text-gray-500 font-mono-custom text-right">${date}</div>
        </div>`;
      }).join('');
    }

    function setProjectItemsProgress(percent, statusText) {
      const p = Math.max(0, Math.min(100, Number(percent || 0)));
      if (domRefs.projectItemsProgressWrap) {
        if (p <= 0) domRefs.projectItemsProgressWrap.classList.add('hidden');
        else domRefs.projectItemsProgressWrap.classList.remove('hidden');
      }
      if (domRefs.projectItemsProgressBar) {
        domRefs.projectItemsProgressBar.style.width = `${p}%`;
      }
      if (domRefs.projectItemsStatus && statusText) {
        domRefs.projectItemsStatus.textContent = statusText;
      }
    }

    async function collectReconcilePackagesFromAssets(onProgress) {
      const targets = (state.allAssets || []).filter((asset) => asset.downloaded);
      if (typeof onProgress === 'function') onProgress(0, targets.length);

      const tokensByItemId = new Map(targets.map((a) => [String(a.itemId || ''), buildCandidateTokens(a)]));

      const res = await boothAPI.collectUnitypackages?.(
        targets.map((a) => ({ itemId: a.itemId, title: a.title || '' }))
      );

      if (typeof onProgress === 'function') onProgress(targets.length, targets.length);

      const rows = [];
      if (res?.ok && Array.isArray(res?.packages)) {
        for (const pkg of res.packages) {
          rows.push({
            itemId: String(pkg.itemId || ''),
            title: String(pkg.title || ''),
            packagePath: String(pkg.packagePath || ''),
            candidateTokens: tokensByItemId.get(String(pkg.itemId || '')) || [],
          });
        }
      } else {
        // フォールバック: 旧来の逐次処理
        for (let i = 0; i < targets.length; i += 1) {
          const asset = targets[i];
          const r = await boothAPI.listItemFiles(asset.itemId, asset.title || '');
          if (!r?.error && Array.isArray(r?.files)) {
            const tokens = buildCandidateTokens(asset);
            r.files
              .filter((f) => f.kind === 'file' && String(f.name || '').toLowerCase().endsWith('.unitypackage'))
              .forEach((f) => rows.push({
                itemId: String(asset.itemId || ''),
                title: String(asset.title || ''),
                packagePath: String(f.fullPath || ''),
                candidateTokens: tokens,
              }));
          }
          if (typeof onProgress === 'function') onProgress(i + 1, targets.length);
        }
      }
      return rows.filter((row) => row.itemId && row.packagePath);
    }

    async function runProjectItemsReconcile() {
      const projectPath = String(domRefs.projectItemsSelect?.value || '').trim();
      if (!projectPath) {
        showTransientMessage('先にプロジェクトを選択してください。', 'error');
        return;
      }
      if (!boothAPI.reconcileImports) {
        showTransientMessage('reconcileImports API は利用できません。', 'error');
        return;
      }

      if (domRefs.projectItemsReconcile) domRefs.projectItemsReconcile.disabled = true;
      setProjectItemsProgress(1, 'パッケージを収集中...');
      try {
        const packages = await collectReconcilePackagesFromAssets((done, total) => {
          const p = total > 0 ? (done / total) * 40 : 40;
          setProjectItemsProgress(p, `パッケージを収集中... ${done}/${total}`);
        });
        if (!packages.length) {
          setProjectItemsProgress(0, 'ローカルの unitypackage が見つかりません。');
          return;
        }

        setProjectItemsProgress(60, `照合中...`);
        const res = await boothAPI.reconcileImports(projectPath, packages, true, 0.5);
        if (res?.error) {
          setProjectItemsProgress(0, `照合に失敗: ${res.error}`);
          showTransientMessage(`照合に失敗: ${res.error}`, 'error');
          return;
        }
        const matchedTotal = Number(res?.matched || 0);
        const scannedTotal = Number(res?.scanned || 0);

        setProjectItemsProgress(100, `照合完了: ${matchedTotal}/${scannedTotal}`);
        showTransientMessage(`照合完了 ${matchedTotal}/${scannedTotal}`, 'info');
        await loadProjectItemsPanel(projectPath);
      } catch (error) {
        setProjectItemsProgress(0, `照合に失敗: ${error?.message || error}`);
        showTransientMessage(`照合に失敗: ${error?.message || error}`, 'error');
      } finally {
        if (domRefs.projectItemsReconcile) domRefs.projectItemsReconcile.disabled = false;
      }
    }

    async function openProjectItemsModal() {
      if (!state.settings && boothAPI.getSettings) {
        state.settings = await boothAPI.getSettings();
      }
      renderProjectItemsProjectSelect(state.settings?.unityProjects || []);
      await loadProjectItemsPanel(domRefs.projectItemsSelect?.value || '');
      domRefs.projectItemsModal?.classList.remove('hidden');
      domRefs.projectItemsModal?.classList.add('flex');
    }

    function closeProjectItemsModal() {
      domRefs.projectItemsModal?.classList.add('hidden');
      domRefs.projectItemsModal?.classList.remove('flex');
    }

    function bindUiEvents() {
      domRefs.projectItemsBtn?.addEventListener('click', async () => {
        await openProjectItemsModal();
      });
      domRefs.projectItemsClose?.addEventListener('click', () => {
        closeProjectItemsModal();
      });
      domRefs.projectItemsSelect?.addEventListener('change', async (event) => {
        await loadProjectItemsPanel(event.target.value || '');
      });
      domRefs.projectItemsReconcile?.addEventListener('click', async () => {
        await runProjectItemsReconcile();
      });
    }

    return {
      bindUiEvents,
      renderProjectItemsProjectSelect,
      loadProjectItemsPanel,
      setProjectItemsProgress,
      runProjectItemsReconcile,
      openProjectItemsModal,
      closeProjectItemsModal,
    };
  }

  global.AvatoolRenderProjectItems = {
    createRenderProjectItems,
  };
})(window);
