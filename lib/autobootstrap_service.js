function createAutoBootstrapService(deps) {
  let startupBootstrapDownloadPromise = null;
  let autoBootstrapQueue = Promise.resolve();
  const autoBootstrapRunningProjects = new Set();

  async function runWithLoginFallback(task) {
    if (typeof deps.runWithBoothCookieLoginFallback === 'function') {
      return await deps.runWithBoothCookieLoginFallback(task);
    }
    return await task();
  }

  // Auto-bootstrap downloads (startup fixed items, VCC-project imports) call
  // downloadItemFiles() directly instead of going through the download queue's
  // enqueue-downloads path, so the queue's own alreadyQueued/runningNow dedup
  // guard never sees them. Without registering a claim here, a manual "download
  // this item" click for the same itemId while auto-bootstrap is mid-download
  // races unsynchronized writes to the same item directory. Piggyback on the
  // same shared queueState.running map so both directions see each other.
  function claimQueueSlot(itemId, title) {
    const queueState = typeof deps.getQueueState === 'function' ? deps.getQueueState() : null;
    if (!queueState || !itemId) return true;
    const id = String(itemId);
    if (queueState.running.has(id) || (queueState.queued || []).some((q) => String(q?.itemId) === id)) {
      return false;
    }
    queueState.running.set(id, { itemId: id, title: title || '', source: 'autobootstrap' });
    return true;
  }

  function releaseQueueSlot(itemId) {
    const queueState = typeof deps.getQueueState === 'function' ? deps.getQueueState() : null;
    if (!queueState || !itemId) return;
    queueState.running.delete(String(itemId));
  }

  function getSettings() {
    return deps.getSettings();
  }

  function selectAutoBootstrapPackageRows(packageRows) {
    const rows = Array.isArray(packageRows) ? packageRows : [];
    if (!rows.length) return [];
    // Variant filtering is disabled. Import candidates are selected by target settings only.
    return rows;
  }

  function parseVersionPartsFromName(name) {
    const s = String(name || '');
    const m = s.match(/(?:^|[^0-9])v?(\d+(?:\.\d+){1,3})(?:[^0-9]|$)/i);
    if (!m) return [];
    return String(m[1]).split('.').map((n) => Number(n)).filter((n) => Number.isFinite(n));
  }

  function compareVersionParts(a, b) {
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i += 1) {
      const av = Number(a[i] ?? 0);
      const bv = Number(b[i] ?? 0);
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  }

  function normalizePackageIdentityFromName(name) {
    const base = deps.path.basename(String(name || ''), '.unitypackage').toLowerCase();
    const withoutVer = base
      .replace(/(?:^|[_\-\s])v?\d+(?:\.\d+){1,3}(?:$|[_\-\s])/gi, '_')
      .replace(/(?:^|[_\-\s])\d+\.x\.x(?:$|[_\-\s])/gi, '_')
      .replace(/[_\-\s]+/g, '')
      .trim();
    return withoutVer || base;
  }

  function dedupePackageRowsPreferNewest(rows) {
    const map = new Map();
    for (const row of (rows || [])) {
      const itemId = String(row?.itemId || '');
      const pkgPath = String(row?.packagePath || '');
      const fileName = deps.path.basename(pkgPath || '');
      const identity = normalizePackageIdentityFromName(fileName);
      const key = `${itemId}:${identity}`;
      const curVersion = parseVersionPartsFromName(fileName);
      const curMtime = Number(row?.mtimeMs || 0);
      const prev = map.get(key);
      if (!prev) {
        map.set(key, row);
        continue;
      }
      const prevName = deps.path.basename(String(prev?.packagePath || ''));
      const prevVersion = parseVersionPartsFromName(prevName);
      const byVer = compareVersionParts(curVersion, prevVersion);
      if (byVer > 0) {
        map.set(key, row);
        continue;
      }
      if (byVer < 0) continue;
      const prevMtime = Number(prev?.mtimeMs || 0);
      if (curMtime > prevMtime) {
        map.set(key, row);
      }
    }
    return Array.from(map.values());
  }

  async function runStartupBootstrapDownloads() {
    if (startupBootstrapDownloadPromise) return startupBootstrapDownloadPromise;
    startupBootstrapDownloadPromise = (async () => {
      try {
        const settings = getSettings();
        if (!settings.autoBootstrapEnabled) return { skipped: true, reason: 'disabled' };
        const assetMap = deps.getMetaAssetMapFast();
        const targets = deps.pickBootstrapAssets(assetMap).filter((a) => !a.downloaded);
        deps.dbgUpdate('autoboot:startup:start', `targets=${targets.length}`);
        if (!targets.length) {
          deps.emitAutoBootstrapStatus({
            phase: 'skipped',
            source: 'startup',
            projectPath: '',
            message: '起動時の自動ダウンロード: 対象はすべてダウンロード済みです。',
          });
          return { skipped: true, reason: 'all_downloaded' };
        }

        await deps.ensureClientReady();
        deps.emitAutoBootstrapStatus({
          phase: 'started',
          source: 'startup',
          projectPath: '',
          message: `起動時の自動ダウンロードを開始します (${targets.length}件)`,
        });

        let downloaded = 0;
        for (let i = 0; i < targets.length; i += 1) {
          const a = targets[i];
          const freeLinks = await runWithLoginFallback(async () => await deps.fetchFreeDownloadLinksForItem(a.itemId));
          const allFreeLinks = deps.dedupeDownloadLinks(freeLinks);
          const fallbackLinks = deps.dedupeDownloadLinks(a.files || []);
          const linksToDownload = allFreeLinks.length > 0 ? allFreeLinks : fallbackLinks;
          deps.dbgUpdate('autoboot:startup:item', `itemId=${a.itemId}`, `free=${allFreeLinks.length}`, `fallback=${fallbackLinks.length}`, `use=${linksToDownload.length}`);
          if (!linksToDownload.length) {
            deps.emitAutoBootstrapStatus({
              phase: 'skipped',
              source: 'startup',
              projectPath: '',
              itemId: a.itemId,
              title: a.title,
              message: `${a.title || a.itemId}: 無料ダウンロード候補が見つからないためスキップしました。`,
            });
            continue;
          }

          if (!claimQueueSlot(a.itemId, a.title)) {
            deps.emitAutoBootstrapStatus({
              phase: 'skipped',
              source: 'startup',
              projectPath: '',
              itemId: a.itemId,
              title: a.title,
              message: `${a.title || a.itemId}: 他の処理でダウンロード中のためスキップしました。`,
            });
            continue;
          }
          try {
            deps.emitAutoBootstrapStatus({
              phase: 'downloading',
              source: 'startup',
              projectPath: '',
              index: i + 1,
              total: targets.length,
              itemId: a.itemId,
              title: a.title,
              message: `起動時の自動ダウンロード: ${i + 1}/${targets.length} をダウンロード中 (${linksToDownload.length}件)`,
            });
            await runWithLoginFallback(async () => (
              await deps.downloadItemFiles({ ...a, files: linksToDownload }, deps.getBoothClient(), deps.getBoothCookies())
            ));
            deps.dbgUpdate('autoboot:startup:item:downloaded', `itemId=${a.itemId}`, `files=${linksToDownload.length}`);
            if (settings.autoExtract) {
              const itemDir = deps.buildItemDir(a.itemId, a.title || '');
              await deps.extractArchivesInItemDir(itemDir, { itemId: a.itemId, title: a.title || '' });
              deps.dbgUpdate('autoboot:startup:item:extracted', `itemId=${a.itemId}`);
            }
            downloaded += 1;
          } finally {
            releaseQueueSlot(a.itemId);
          }
        }

        deps.emitAutoBootstrapStatus({
          phase: 'done',
          source: 'startup',
          projectPath: '',
          packageCount: downloaded,
          message: `起動時の自動ダウンロードが完了しました (${downloaded}/${targets.length})`,
        });
        return { ok: true, downloaded, total: targets.length };
      } catch (e) {
        deps.dbgUpdate('autoboot:startup:error', e?.message || String(e));
        deps.emitAutoBootstrapStatus({
          phase: 'error',
          source: 'startup',
          projectPath: '',
          message: `起動時の自動ダウンロードに失敗しました: ${e?.message || e}`,
        });
        return { error: e?.message || String(e) };
      } finally {
        startupBootstrapDownloadPromise = null;
      }
    })();
    return startupBootstrapDownloadPromise;
  }

  async function runAutoBootstrapForProject(projectPath, source = 'watch') {
    const project = String(projectPath || '').trim();
    const projectKey = deps.normalizeProjectPath(project);
    const startedAtMs = Date.now();
    const elapsedMs = () => Math.max(0, Date.now() - startedAtMs);
    if (!project || !projectKey) return { error: 'project_not_found' };
    if (autoBootstrapRunningProjects.has(projectKey)) return { error: 'already_running' };
    autoBootstrapRunningProjects.add(projectKey);
    try {
      const settings = getSettings();
      deps.dbgUpdate('autoboot:project:start', `project=${project}`, `source=${source}`);
      if (!settings.autoBootstrapEnabled) return { skipped: true, reason: 'disabled' };
      const editorCheck = deps.validateUnityEditorPathSetting();
      if (!editorCheck?.ok) return { error: editorCheck?.error || 'unity_editor_not_found' };
      if (!deps.fs.existsSync(project)) return { error: 'project_not_found' };
      if (deps.isUnityProjectLocked(project)) return { error: 'project_already_open' };

      const history = deps.loadAutoBootstrapHistory();
      if (history[projectKey]?.doneAt) {
        return { skipped: true, reason: 'already_bootstrapped' };
      }

      deps.emitAutoBootstrapStatus({
        phase: 'started',
        source,
        projectPath: project,
        message: '自動インポートが作動中です。インポートと初期コンパイルを実行します。初回はUnityの初期ビルドも同時進行するため時間がかかる場合があります。処理完了までこのプロジェクトを開かないでください。',
      });
      if (settings.autoBootstrapIncludeMA !== false) {
        const maRes = await deps.ensureModularAvatarDependency(project);
        deps.dbgUpdate('autoboot:project:ma', `ok=${Boolean(maRes?.ok)}`, `version=${maRes?.version || '-'}`, `source=${maRes?.source || '-'}`);
      } else {
        deps.dbgUpdate('autoboot:project:ma', 'skipped=disabled');
      }

      const includeMA = settings.autoBootstrapIncludeMA !== false;
      const defaultIncludeLiltoon = settings.autoBootstrapIncludeLiltoon !== false;
      const defaultIncludeFaceEmo = settings.autoBootstrapIncludeFaceEmo !== false;
      const includeAvatoolScripts = settings.autoBootstrapIncludeAvatoolScripts !== false;
      const includeFolderIconBootstrap = deps.isFolderIconBootstrapEnabled();
      const includeSimpleFolderIcon = settings.autoBootstrapIncludeSimpleFolderIcon !== false;
      if (includeSimpleFolderIcon) {
        const sfiRes = deps.installSimpleFolderIconAsPackage(project);
        deps.dbgUpdate('autoboot:project:sfi', `ok=${Boolean(sfiRes?.ok)}`, `status=${sfiRes?.status || '-'}`);
      }
      const defaultIncludePurchased = false;
      const importRules = deps.normalizeAutoBootstrapProjectImportRules(settings.autoBootstrapProjectImportRules);
      const projectLower = project.toLowerCase();
      const projectNameLower = deps.path.basename(project).toLowerCase();
      const matchedImportRules = importRules.filter((r) => {
        const pattern = String(r?.projectPattern || '').trim().toLowerCase();
        if (!pattern) return false;
        return projectLower.includes(pattern) || projectNameLower.includes(pattern);
      });
      let includeLiltoon = defaultIncludeLiltoon;
      let includeFaceEmo = defaultIncludeFaceEmo;
      let includePurchased = defaultIncludePurchased;
      const forcedRuleChoices = [];
      const isForcedFixedItem = (itemId) => itemId === '3087170' || itemId === '4915091';
      if (matchedImportRules.length) {
        for (const matchedImportRule of matchedImportRules) {
          const forcedRuleChoice = deps.parseAutoBootstrapChoiceKey(matchedImportRule.choiceKey);
          if (forcedRuleChoice.itemId) forcedRuleChoices.push(forcedRuleChoice);
          if (forcedRuleChoice.itemId === '3087170') includeLiltoon = true;
          if (forcedRuleChoice.itemId === '4915091') includeFaceEmo = true;
          if (forcedRuleChoice.itemId && !isForcedFixedItem(forcedRuleChoice.itemId)) {
            includePurchased = true;
          }
        }
        const matchedPatterns = Array.from(new Set(matchedImportRules.map((r) => String(r?.projectPattern || '').trim()).filter(Boolean)));
        const matchedChoices = matchedImportRules.map((r) => String(r?.choiceKey || '').trim()).filter(Boolean);
        deps.dbgUpdate(
          'autoboot:project:import-rule',
          `project=${deps.path.basename(project)}`,
          `patterns=${matchedPatterns.join('|')}`,
          `choices=${matchedChoices.join('|')}`,
        );
      }
      const assetMap = deps.getMetaAssetMapFast();
      const fixedTargets = deps.pickBootstrapAssets(assetMap).filter((a) => {
        const id = String(a?.itemId || '').trim();
        if (id === '3087170') return includeLiltoon;
        if (id === '4915091') return includeFaceEmo;
        return true;
      });
      const excluded = new Set(fixedTargets.map((a) => String(a?.itemId || '').trim()).filter(Boolean));
      let purchasedTargets = includePurchased
        ? deps.pickPurchasedBootstrapAssets(assetMap, excluded)
        : [];
      const forcedPurchasedIds = Array.from(new Set(
        forcedRuleChoices
          .map((choice) => String(choice?.itemId || '').trim())
          .filter((itemId) => itemId && !isForcedFixedItem(itemId))
      ));
      if (includePurchased && forcedPurchasedIds.length) {
        const wantedIds = new Set(forcedPurchasedIds);
        purchasedTargets = purchasedTargets.filter((a) => wantedIds.has(String(a?.itemId || '').trim()));
        for (const itemId of wantedIds) {
          if (!purchasedTargets.some((a) => String(a?.itemId || '').trim() === itemId) && assetMap?.[itemId]) {
            purchasedTargets.push(assetMap[itemId]);
          }
        }
      }
      const targetsById = new Map();
      for (const row of [...fixedTargets, ...purchasedTargets]) {
        const id = String(row?.itemId || '').trim();
        if (!id || targetsById.has(id)) continue;
        targetsById.set(id, row);
      }
      const targets = Array.from(targetsById.values());
      deps.dbgUpdate('autoboot:project:targets', `count=${targets.length}`);
      if (!targets.length) {
        const enabledTargets = [];
        if (includeLiltoon) enabledTargets.push('liltoon[VPM]');
        if (includeMA) enabledTargets.push('MA/NDMF[VPM]');
        if (includeFaceEmo) enabledTargets.push('FaceEmo[unitypackage]');
        if (includeAvatoolScripts) enabledTargets.push('Avatool Script');
        if (includeFolderIconBootstrap) enabledTargets.push('FolderIcon Bootstrap');
        if (includeSimpleFolderIcon) enabledTargets.push('SimpleFolderIcon');
        if (includePurchased) enabledTargets.push('購入済みアイテム');
        if (!enabledTargets.length) {
          deps.emitAutoBootstrapStatus({
            phase: 'skipped',
            source,
            projectPath: project,
            elapsedMs: elapsedMs(),
            message: `自動インポート対象がすべて無効化されています。 (所要時間: ${deps.formatElapsedMs(elapsedMs())})`,
          });
          history[projectKey] = { doneAt: new Date().toISOString(), source, packageCount: 0, skipped: true };
          deps.saveAutoBootstrapHistory(history);
          return { skipped: true, reason: 'all_targets_disabled', elapsedMs: elapsedMs() };
        }
        deps.emitAutoBootstrapStatus({
          phase: 'done',
          source,
          projectPath: project,
          packageCount: 0,
          elapsedMs: elapsedMs(),
          message: `自動インポートが完了しました（追加対象なし: ${enabledTargets.join(', ')}）。(所要時間: ${deps.formatElapsedMs(elapsedMs())})`,
        });
        history[projectKey] = { doneAt: new Date().toISOString(), source, packageCount: 0, skipped: true };
        deps.saveAutoBootstrapHistory(history);
        return { ok: true, packageCount: 0, skipped: true, elapsedMs: elapsedMs() };
      }

      await deps.ensureClientReady();
      const hasLiltoonTarget = targets.some((a) => String(a?.itemId || '').trim() === '3087170');
      let liltoonInstalledByVpm = false;
      if (hasLiltoonTarget) {
        const liltoonRes = await deps.ensureLiltoonDependency(project);
        deps.dbgUpdate('autoboot:project:liltoon-vpm', `ok=${Boolean(liltoonRes?.ok)}`, `version=${liltoonRes?.version || '-'}`);
        if (!liltoonRes?.ok) {
          deps.emitAutoBootstrapStatus({
            phase: 'error',
            source,
            projectPath: project,
            elapsedMs: elapsedMs(),
            message: `自動インポート失敗: liltoon のVPM導入に失敗しました (${liltoonRes?.error || 'unknown'}) (所要時間: ${deps.formatElapsedMs(elapsedMs())})`,
          });
          return { error: liltoonRes?.error || 'liltoon_vpm_install_failed', elapsedMs: elapsedMs() };
        }
        liltoonInstalledByVpm = true;
      }
      for (let i = 0; i < targets.length; i += 1) {
        const a = targets[i];
        if (a.downloaded) continue;
        const freeLinks = await runWithLoginFallback(async () => await deps.fetchFreeDownloadLinksForItem(a.itemId));
        const allFreeLinks = deps.dedupeDownloadLinks(freeLinks);
        const fallbackLinks = deps.dedupeDownloadLinks(a.files || []);
        const linksToDownload = allFreeLinks.length > 0 ? allFreeLinks : fallbackLinks;
        deps.dbgUpdate('autoboot:project:item', `itemId=${a.itemId}`, `free=${allFreeLinks.length}`, `fallback=${fallbackLinks.length}`, `use=${linksToDownload.length}`);
        if (!linksToDownload.length) {
          deps.emitAutoBootstrapStatus({
            phase: 'skipped',
            source,
            projectPath: project,
            itemId: a.itemId,
            title: a.title,
            message: `${a.title || a.itemId}: 無料ダウンロード候補が見つからないためスキップしました。`,
          });
          continue;
        }
        if (!claimQueueSlot(a.itemId, a.title)) {
          deps.emitAutoBootstrapStatus({
            phase: 'skipped',
            source,
            projectPath: project,
            itemId: a.itemId,
            title: a.title,
            message: `${a.title || a.itemId}: 他の処理でダウンロード中のためスキップしました。`,
          });
          continue;
        }
        try {
          deps.emitAutoBootstrapStatus({
            phase: 'downloading',
            source,
            projectPath: project,
            index: i + 1,
            total: targets.length,
            itemId: a.itemId,
            title: a.title,
            message: `自動インポート準備中: ${i + 1}/${targets.length} をダウンロード中 (${linksToDownload.length}件)`,
          });
          await runWithLoginFallback(async () => (
            await deps.downloadItemFiles({ ...a, files: linksToDownload }, deps.getBoothClient(), deps.getBoothCookies())
          ));
          deps.dbgUpdate('autoboot:project:item:downloaded', `itemId=${a.itemId}`, `files=${linksToDownload.length}`);
          if (settings.autoExtract) {
            const itemDir = deps.buildItemDir(a.itemId, a.title || '');
            await deps.extractArchivesInItemDir(itemDir, { itemId: a.itemId, title: a.title || '' });
            deps.dbgUpdate('autoboot:project:item:extracted', `itemId=${a.itemId}`);
          }
        } finally {
          releaseQueueSlot(a.itemId);
        }
      }

      const importRows = [];
      for (const a of targets) {
        const itemDir = deps.buildItemDir(a.itemId, a.title || '');
        const rootPkgs = deps.listUnityPackagesInDir(itemDir);
        const uniq = [...new Set(rootPkgs)];
        const allRows = [];
        for (const pkgPath of uniq) {
          const relDir = deps.path.relative(itemDir, deps.path.dirname(pkgPath)).replace(/\\/g, '/');
          const variantKey = `${String(a.itemId || '').trim()}:${String(relDir || '.').toLowerCase()}`;
          let mtimeMs = 0;
          try {
            mtimeMs = Number(deps.fs.statSync(pkgPath).mtimeMs || 0);
          } catch { /* stat失敗時はmtimeMs=0のフォールバックのまま続行 */ }
          allRows.push({
            itemId: String(a.itemId || ''),
            title: String(a.title || ''),
            packagePath: String(pkgPath),
            previewUrl: String(Array.isArray(a?.preview) ? (a.preview[0] || '') : (a?.previewUrl || '')).trim(),
            type: 'unitypackage',
            variantKey,
            mtimeMs,
            meta: { topFolders: [], tokens: [] },
          });
        }
        const sourceRoots = deps.listSourceImportRootsInDir(itemDir);
        for (const sourceRoot of sourceRoots) {
          const relDir = deps.path.relative(itemDir, sourceRoot).replace(/\\/g, '/');
          const variantKey = `${String(a.itemId || '').trim()}:${String(relDir || '.').toLowerCase()}`;
          let mtimeMs = 0;
          try {
            mtimeMs = Number(deps.fs.statSync(sourceRoot).mtimeMs || 0);
          } catch { /* stat失敗時はmtimeMs=0のフォールバックのまま続行 */ }
          allRows.push({
            itemId: String(a.itemId || ''),
            title: String(a.title || ''),
            type: 'source',
            sourceRoot: String(sourceRoot),
            variantKey,
            mtimeMs,
            meta: { topFolders: [], tokens: [] },
          });
        }
        const vpmRoots = deps.listVpmPackageRootsInDir(itemDir);
        for (const vpmRoot of vpmRoots) {
          const relDir = deps.path.relative(itemDir, vpmRoot).replace(/\\/g, '/');
          const variantKey = `${String(a.itemId || '').trim()}:${String(relDir || '.').toLowerCase()}`;
          let mtimeMs = 0;
          try {
            mtimeMs = Number(deps.fs.statSync(vpmRoot).mtimeMs || 0);
          } catch { /* stat失敗時はmtimeMs=0のフォールバックのまま続行 */ }
          allRows.push({
            itemId: String(a.itemId || ''),
            title: String(a.title || ''),
            type: 'vpm',
            vpmRoot: String(vpmRoot),
            variantKey,
            mtimeMs,
            meta: { topFolders: [], tokens: [] },
          });
        }
        if (!allRows.length) continue;
        const selectedRows = selectAutoBootstrapPackageRows(allRows);
        let selectedPackageRows = selectedRows.filter((r) => (
          r.type === 'unitypackage'
          && !(liltoonInstalledByVpm && String(r?.itemId || '').trim() === '3087170')
        ));
        const forcedFileChoice = forcedRuleChoices.find((choice) => (
          choice.type === 'file' && choice.itemId === String(a.itemId || '')
        ));
        if (forcedFileChoice) {
          const wanted = String(forcedFileChoice.relPath || '').toLowerCase().replace(/\\/g, '/');
          selectedPackageRows = selectedPackageRows.filter((r) => {
            const rel = deps.path.relative(itemDir, String(r?.packagePath || '')).replace(/\\/g, '/').toLowerCase();
            return rel === wanted;
          });
        }
        const selectedSourceRows = selectedRows.filter((r) => r.type === 'source');
        const selectedVpmRows = selectedRows.filter((r) => r.type === 'vpm');
        const dedupedPackageRows = dedupePackageRowsPreferNewest(selectedPackageRows);
        deps.dbgUpdate(
          'autoboot:project:item:packages',
          `itemId=${a.itemId}`,
          `all=${allRows.length}`,
          `selected=${selectedRows.length}`,
          `pkg=${dedupedPackageRows.length}`,
          `src=${selectedSourceRows.length}`,
          `vpm=${selectedVpmRows.length}`,
        );
        importRows.push(...dedupedPackageRows, ...selectedSourceRows, ...selectedVpmRows);
      }
      if (!importRows.length) {
        deps.emitAutoBootstrapStatus({
          phase: 'error',
          source,
          projectPath: project,
          elapsedMs: elapsedMs(),
          message: `自動インポート対象からインポート可能なデータを見つけられませんでした。 (所要時間: ${deps.formatElapsedMs(elapsedMs())})`,
        });
        return { error: 'no_importable_found', elapsedMs: elapsedMs() };
      }

      deps.emitAutoBootstrapStatus({
        phase: 'importing',
        source,
        projectPath: project,
        packageCount: importRows.length,
        message: `自動インポート中: ${importRows.length} 件`,
      });

      const prep = deps.ensureUnityBatchImporterReady(project);
      if (!prep?.ok) return { error: prep?.error || 'prepare_unity_project_failed' };
      if (includeAvatoolScripts) {
        const livePrep = deps.ensureUnityLiveImporterReady(project);
        if (!livePrep?.ok) return { error: livePrep?.error || 'prepare_unity_project_failed' };
      } else {
        deps.dbgUpdate('autoboot:project:avatool-scripts', 'skipped=disabled');
      }

      const vpmRows = importRows.filter((r) => r.type === 'vpm');
      const sourceRows = importRows.filter((r) => r.type === 'source');
      const packageRows = importRows.filter((r) => r.type === 'unitypackage');
      const finalPackageRows = settings.autoBootstrapIncludeSimpleFolderIcon !== false
        ? deps.appendSimpleFolderIconToBatchPackages(packageRows)
        : packageRows.filter((p) => String(deps.path.basename(String(p?.packagePath || '')) || '').toLowerCase() !== String(deps.SIMPLE_FOLDER_ICON_PACKAGE_NAME || '').toLowerCase());
      if (vpmRows.length) {
        const vpmRes = await deps.applyVpmPackagesToProject(project, vpmRows);
        deps.dbgUpdate('autoboot:project:vpm-install', `ok=${Boolean(vpmRes?.ok)}`, `applied=${vpmRes?.applied || 0}`);
      }
      if (sourceRows.length) {
        const copyRes = deps.applySourceRootsToProject(project, sourceRows);
        deps.dbgUpdate('autoboot:project:source-copy', `ok=${Boolean(copyRes?.ok)}`, `applied=${copyRes?.applied || 0}`);
      }

      let result = { ok: true };
      const lock = deps.acquireBackgroundImportProjectLock(project);
      if (!lock?.ok) {
        return { error: lock?.error || 'background_import_already_running', elapsedMs: elapsedMs() };
      }
      try {
        if (finalPackageRows.length) {
          result = await deps.runUnityBatchImport(project, finalPackageRows.map((p) => p.packagePath));
        } else {
          result = await deps.runUnityBatchRefresh(project);
        }
      } finally {
        deps.releaseBackgroundImportProjectLock(lock.key);
        if (!includeAvatoolScripts) {
          const cleanupRes = deps.cleanupAutoBootstrapSupportScripts(project);
          deps.dbgUpdate('autoboot:project:avatool-scripts-cleanup', `ok=${Boolean(cleanupRes?.ok)}`, `removed=${cleanupRes?.removed || 0}`);
        }
      }
      deps.dbgUpdate('autoboot:project:unity', `ok=${Boolean(result?.ok)}`, `pkg=${finalPackageRows.length}`, `src=${sourceRows.length}`, `vpm=${vpmRows.length}`);
      if (!result?.ok) {
        deps.emitAutoBootstrapStatus({
          phase: 'error',
          source,
          projectPath: project,
          elapsedMs: elapsedMs(),
          message: `自動インポート失敗: ${result?.error || 'unknown'} (所要時間: ${deps.formatElapsedMs(elapsedMs())})`,
        });
        return { error: result?.error || 'auto_bootstrap_import_failed', elapsedMs: elapsedMs() };
      }
      let postcheck = deps.validateAutoBootstrapImportResult(project, finalPackageRows, result?.logPath || '');
      if (!postcheck.ok && postcheck.issues.includes('liltoon_not_installed')) {
        const refresh = await deps.runUnityBatchRefresh(project);
        if (refresh?.ok) {
          postcheck = deps.validateAutoBootstrapImportResult(project, finalPackageRows, refresh?.logPath || '');
        }
      }
      if (!postcheck.ok) {
        const reasons = [];
        if (postcheck.issues.includes('liltoon_not_installed')) reasons.push('liltoon 未導入');
        if (postcheck.logFlags?.hasAssemblyReloadFailure) reasons.push('アセンブリ再読み込み失敗');
        if (postcheck.logFlags?.hasArgumentRangeError) reasons.push('ArgumentException');
        if (postcheck.logFlags?.hasNetworkResolveError) reasons.push('ネットワーク名前解決失敗');
        const reasonText = reasons.length ? ` (${reasons.join(', ')})` : '';
        const userMessage = `自動インポート失敗: 導入検証に失敗しました${reasonText}`;
        deps.emitAutoBootstrapStatus({
          phase: 'error',
          source,
          projectPath: project,
          elapsedMs: elapsedMs(),
          message: `${userMessage} (所要時間: ${deps.formatElapsedMs(elapsedMs())})`,
        });
        return {
          error: 'auto_bootstrap_postcheck_failed',
          details: postcheck,
          logPath: result?.logPath || '',
          alreadyNotified: true,
          userMessage: `${userMessage} (所要時間: ${deps.formatElapsedMs(elapsedMs())})`,
          elapsedMs: elapsedMs(),
        };
      }

      deps.appendImportHistory(project, finalPackageRows);
      if (includeSimpleFolderIcon && typeof deps.writeSimpleFolderIcons === 'function') {
        const scannedRows = typeof deps.fillPackageMetaByScan === 'function'
          ? await deps.fillPackageMetaByScan(finalPackageRows)
          : finalPackageRows;
        await deps.writeSimpleFolderIcons(project, scannedRows);
        deps.dbgUpdate('autoboot:project:sfi-icons', 'done');
      }
      history[projectKey] = {
        doneAt: new Date().toISOString(),
        source,
        packageCount: importRows.length,
        targets: targets.map((a) => ({ itemId: String(a.itemId || ''), title: String(a.title || '') })),
      };
      deps.saveAutoBootstrapHistory(history);
      deps.emitAutoBootstrapStatus({
        phase: 'done',
        source,
        projectPath: project,
        packageCount: importRows.length,
        elapsedMs: elapsedMs(),
        message: `自動インポートが完了しました。 (所要時間: ${deps.formatElapsedMs(elapsedMs())})`,
      });
      return { ok: true, packageCount: importRows.length, elapsedMs: elapsedMs() };
    } finally {
      autoBootstrapRunningProjects.delete(projectKey);
    }
  }

  function enqueueAutoBootstrap(projectPath, source = 'watch') {
    const p = String(projectPath || '').trim();
    if (!p) return;
    autoBootstrapQueue = autoBootstrapQueue
      .catch((e) => {
        deps.dbgUpdate('autoboot:queue:unhandled', e?.message || String(e));
      })
      .then(async () => {
        const res = await runAutoBootstrapForProject(p, source);
        if (res?.error) {
          if (res?.alreadyNotified) return;
          const elapsedText = Number(res?.elapsedMs || 0) > 0 ? ` (所要時間: ${deps.formatElapsedMs(res.elapsedMs)})` : '';
          deps.emitAutoBootstrapStatus({
            phase: 'error',
            source,
            projectPath: p,
            elapsedMs: Number(res?.elapsedMs || 0),
            message: String(res?.userMessage || `自動インポート失敗: ${res.error}${elapsedText}`),
          });
        }
      })
      .catch((e) => {
        deps.dbgUpdate('autoboot:queue:then:unhandled', e?.message || String(e));
        deps.emitAutoBootstrapStatus({
          phase: 'error',
          source,
          projectPath: p,
          elapsedMs: 0,
          message: `自動インポート中に予期しないエラーが発生しました: ${e?.message || String(e)}`,
        });
      });
  }

  function parseAutoBootstrapChoiceKey(choiceKey) {
    const s = String(choiceKey || '').trim();
    if (!s) return { type: '', itemId: '', relPath: '' };
    if (s.startsWith('item:')) {
      return { type: 'item', itemId: s.slice(5).trim(), relPath: '' };
    }
    if (s.startsWith('file:')) {
      const rest = s.slice(5);
      const idx = rest.indexOf(':');
      if (idx <= 0) return { type: '', itemId: '', relPath: '' };
      const itemId = rest.slice(0, idx).trim();
      const enc = rest.slice(idx + 1).trim();
      let relPath = '';
      try { relPath = decodeURIComponent(enc); } catch { relPath = enc; }
      return { type: 'file', itemId, relPath };
    }
    return { type: '', itemId: '', relPath: '' };
  }

  async function listAutoBootstrapVariantOptions() {
    const assetMap = deps.getMetaAssetMapFast();
    const targets = deps.pickBootstrapAssets(assetMap);
    if (!targets.length) return [];
    deps.dbgUpdate('autoboot:variants:scan:start', `targets=${targets.length}`);
    const options = [];
    for (const a of targets) {
      const itemDir = deps.buildItemDir(a.itemId, a.title || '');
      const pkgPaths = deps.listUnityPackagesInDir(itemDir);
      const dirs = Array.from(new Set(pkgPaths.map((p) => deps.path.dirname(p))));
      const sourceRoots = deps.listSourceImportRootsInDir(itemDir);
      const vpmRoots = deps.listVpmPackageRootsInDir(itemDir);
      deps.dbgUpdate('autoboot:variants:scan:item', `itemId=${a.itemId}`, `pkg=${pkgPaths.length}`, `dirs=${dirs.length}`, `src=${sourceRoots.length}`, `vpm=${vpmRoots.length}`);
      for (const dirPath of dirs) {
        const rel = deps.path.relative(itemDir, dirPath).replace(/\\/g, '/');
        const key = `${String(a.itemId || '').trim()}:${String(rel || '.').toLowerCase()}`;
        const label = `${String(a.title || a.itemId)} / ${rel || '.'}`;
        options.push({ key, label, itemId: String(a.itemId || ''), relDir: rel || '.' });
      }
      for (const root of sourceRoots) {
        const rel = deps.path.relative(itemDir, root).replace(/\\/g, '/');
        const key = `${String(a.itemId || '').trim()}:${String(rel || '.').toLowerCase()}`;
        const label = `${String(a.title || a.itemId)} / ${rel || '.'}`;
        options.push({ key, label, itemId: String(a.itemId || ''), relDir: rel || '.' });
      }
      for (const root of vpmRoots) {
        const rel = deps.path.relative(itemDir, root).replace(/\\/g, '/');
        const key = `${String(a.itemId || '').trim()}:${String(rel || '.').toLowerCase()}`;
        const label = `${String(a.title || a.itemId)} / ${rel || '.'}`;
        options.push({ key, label, itemId: String(a.itemId || ''), relDir: rel || '.' });
      }
    }
    const dedup = [];
    const seen = new Set();
    for (const op of options) {
      const key = String(op?.key || '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      dedup.push(op);
    }
    deps.dbgUpdate('autoboot:variants:scan:done', `options=${dedup.length}`);
    return dedup;
  }

  async function listAutoBootstrapRuleChoices() {
    const assetMap = deps.getMetaAssetMapFast();
    const rows = Object.values(assetMap || {});
    const out = [];
    for (const row of rows) {
      const itemId = String(row?.itemId || '').trim();
      if (!itemId) continue;
      const title = String(row?.title || itemId).trim();
      const previewUrl = String(Array.isArray(row?.preview) ? (row.preview[0] || '') : '').trim();
      const itemDir = deps.buildItemDir(itemId, title);
      const pkgPaths = deps.listUnityPackagesInDir(itemDir);
      if (!pkgPaths.length) continue;
      out.push({
        key: `item:${itemId}`,
        type: 'item',
        itemId,
        itemTitle: title,
        previewUrl,
        label: `[Item] ${title}`,
      });
      for (const pkg of pkgPaths) {
        const rel = deps.path.relative(itemDir, pkg).replace(/\\/g, '/');
        out.push({
          key: `file:${itemId}:${encodeURIComponent(rel)}`,
          type: 'file',
          itemId,
          itemTitle: title,
          previewUrl,
          relPath: rel,
          label: `[File] ${title} / ${rel}`,
        });
      }
    }
    return out;
  }

  return {
    runStartupBootstrapDownloads,
    runAutoBootstrapForProject,
    enqueueAutoBootstrap,
    parseAutoBootstrapChoiceKey,
    listAutoBootstrapVariantOptions,
    listAutoBootstrapRuleChoices,
    _test: {
      parseVersionPartsFromName,
      compareVersionParts,
      normalizePackageIdentityFromName,
      dedupePackageRowsPreferNewest,
      selectAutoBootstrapPackageRows,
    },
  };
}

module.exports = {
  createAutoBootstrapService,
};
