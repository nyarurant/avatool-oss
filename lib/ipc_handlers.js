'use strict';

/**
 * ipc_handlers.js
 *
 * Registers all IPC handlers for the Avatool main process.
 * Extracted from main.js (lines 5782-7492).
 *
 * Window creation code intentionally stays in main.js.
 * All service calls are forwarded through injected deps.
 *
 * Usage:
 *   const { registerIpcHandlers } = require('./lib/ipc_handlers');
 *   registerIpcHandlers(deps);
 */

function registerIpcHandlers(deps) {
  const {
    ipcMain,
    // services
    settingsMgr,
    logMgr,
    appUpdater,
    metaMgr,
    downloadQueue,
    vpmMgr,
    unityMgr,
    // electron
    app,
    shell,
    dialog,
    BrowserWindow,
    session,
    // main.js state accessors
    getMainWindow,
    getLoginWindow,
    setLoginWindow,
    getLogWindow,
    getBoothClient,
    getBoothCookies,
    setBoothClient,
    setBoothCookies,
    // paths/constants
    TEMP_COOKIE_PATH,
    BOOTH_LOGIN_PARTITION,
    LOGIN_ALLOWED_HOST_SUFFIXES,
    LOGIN_ALLOWED_PROTOCOLS,
    ITEM_ID_INPUT_RE,
    MAX_ITEM_TITLE_INPUT,
    RENDERER_LOG_MAX_EVENTS_PER_SEC,
    LEGACY_APP_ROOT,
    APP_DATA_ROOT,
    DEFAULT_SETTINGS,
    // functions still in main.js
    appendRuntimeLog,
    ORIG_CONSOLE,
    runtimeLogBuffer,
    // booth functions
    readBoothCookiesFromFile,
    writeBoothCookiesToFile,
    validateBoothLogin,
    probeBoothLibrary,
    persistBoothCookies,
    runWithBoothCookieLoginFallback,
    refreshMetaAfterLoginDedup,
    // other
    getStorageUsageSnapshot,
    getQueueStatus,
    startAutoCheckTimer,
    maybeRunScheduledDownloads,
    startDownloadScheduler,
    runHealthCheck,
    openLoginWindowFlow,
    enrichUpdatesWithVersionDiff,
    backfillCategoriesForItemIds,
    extractBoothItemId,
    createManualFreeMetaItem,
    resolveManualFreeAssetCandidate,
    resolveWishlistCandidate,
    importBoothWishlist,
    addWishlistItemToBoothCart,
    fetchBoothCart,
    toBoothCategoryRowsFromItemJson,
    parseAutoBootstrapChoiceKey,
    listAutoBootstrapVariantOptions,
    listAutoBootstrapRuleChoices,
    enqueueAutoBootstrap,
    // main.js-local helpers used by handlers
    fs,
    path,
    pendingZipOversizeConfirms,
    pendingArchivePasswords,
    electronAutoUpdater,
    normalizeBoothCookies,
    isBoothDomain,
    cookieUrlFromRecord,
    persistTempBoothCookies,
    readVccProjectsFile,
    runReconcileWorker,
    isRegisteredUnityProject,
    normalizeItemRefInput,
    isFolderIconBootstrapEnabled,
    ensureUnityFolderIconBootstrapReady,
    ensureFolderIconBootstrapForProjects,
    appendReconciledImportHistory,
    writeReconcileLog,
    writeReconcileLogBatch,
    getRecommendedReconcileWorkerCount,
    getProjectIndexCached,
    setProjectIndexCache,
    getCpuCount,
    RECONCILE_LOG_PATH,
    MAX_LIST_ITEM_FILES,
    MAX_LIST_ITEM_DEPTH,
    safeResolveUnder,
    normalizeImportMode,
    META_PATH,
    AVATARS_PATH,
    VCC_SETTINGS_PATH,
    writeMetaFile,
    fetchItemPricePublic,
    searchBoothItems,
    fetchBoothItemDetail,
    fetchBoothHomeSections,
    fetchBoothRelatedItems,
    runWishlistPriceCheck,
    showDesktopNotification,
    Notification,
    normalizeAndPersistMeta,
    dedupeMetaItemsByItemId,
    generateFilesHash,
    generateFilesStableHash,
    dbgUpdate,
    sendDownloadProgress,
    downloadItemFiles,
    extractArchivesInItemDir,
    generateLibraryMeta,
    checkLibraryHasNewItems,
    enrichMetaSupportedAvatarsFromFolders,
    syncAvatarItemsToFile,
    fixAvatarItemFields,
    ensureRuntimeDirs,
    resolveExportBundlePath,
    saveOperationLogs,
    readJsonFileSafe,
    queueSenderRef,        // { value: sender } mutable box owned by main.js
    ensureUnityBatchImporterReady,
    ensureUnityLiveImporterReady,
    enqueueUnityLiveImport,
    writeSimpleFolderIcons,
    installSimpleFolderIconAsPackage,
  } = deps;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function pollLiveImportResults(projectPath, expectedCount, importedPackagesForIconRetry = []) {
    const resultLogPath = path.join(projectPath, 'booth_live_import_result.log');
    let offset = 0;
    try {
      if (fs.existsSync(resultLogPath)) offset = fs.statSync(resultLogPath).size;
    } catch { /* ignore */ }
    let completionCount = 0;
    let iconRetryStarted = false;
    const startTime = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000;
    const retryIconsOnce = (reason) => {
      if (iconRetryStarted) return;
      iconRetryStarted = true;
      const rows = Array.isArray(importedPackagesForIconRetry) ? importedPackagesForIconRetry : [];
      if (!rows.length) return;
      Promise.resolve()
        .then(() => writeSimpleFolderIcons(projectPath, rows))
        .then((res) => {
          if (!res?.ok) return;
          logMgr.appendUnityImportLog(`SimpleFolderIcon再試行 (${reason}): 生成 ${Number(res.written || 0)} 件 / スキップ ${Number(res.skipped || 0)} 件 / 競合 ${Number(res.conflicts || 0)} 件`);
        })
        .catch((e) => {
          logMgr.appendUnityImportLog(`SimpleFolderIcon再試行失敗 (${reason}): ${String(e?.message || e)}`);
        });
    };
    const onTimeout = () => {
      retryIconsOnce('timeout');
      logMgr.appendOperationLog('import', `Unityインポート結果の受信がタイムアウトしました（${Math.round(TIMEOUT_MS / 60000)}分）。Unityが起動中か確認してください。`);
    };
    const timer = setInterval(() => {
      try {
        if (!fs.existsSync(resultLogPath)) {
          if (Date.now() - startTime > TIMEOUT_MS) {
            clearInterval(timer);
            onTimeout();
          }
          return;
        }
        const st = fs.statSync(resultLogPath);
        if (st.size <= offset) {
          if (Date.now() - startTime > TIMEOUT_MS) {
            clearInterval(timer);
            onTimeout();
          }
          return;
        }
        const raw = fs.readFileSync(resultLogPath, 'utf8');
        const newContent = raw.slice(offset);
        offset = raw.length;
        const lines = newContent.split(/\r?\n/).filter((l) => l.trim());
        for (const line of lines) {
          logMgr.appendUnityImportLog(`  [ライブ] ${line.trim()}`);
          if (/\b(COMPLETED|FAILED|CANCELLED)\b/.test(line)) completionCount++;
        }
        if (completionCount >= expectedCount) {
          clearInterval(timer);
          retryIconsOnce('completed');
        } else if (Date.now() - startTime > TIMEOUT_MS) {
          clearInterval(timer);
          onTimeout();
        }
      } catch {
        if (Date.now() - startTime > TIMEOUT_MS) {
          clearInterval(timer);
          onTimeout();
        }
      }
    }, 1000);
  }

  function isTrustedRendererSender(event) {
    try {
      const url = String(event?.senderFrame?.url || event?.sender?.getURL?.() || '');
      if (!url.startsWith('file://')) return false;
      const appDir = path.resolve(__dirname, '..');
      const rawPath = decodeURIComponent(new URL(url).pathname);
      const fsPath = path.resolve(rawPath.replace(/^\/([A-Za-z]:)/, '$1'));
      const rel = path.relative(appDir.toLowerCase(), fsPath.toLowerCase());
      return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
    } catch {
      return false;
    }
  }

  function requireTrustedRendererSender(event) {
    if (!isTrustedRendererSender(event)) throw new Error('untrusted_sender');
  }

  function isVpmAutoInstaller(pkg) {
    return Array.isArray(pkg?.meta?.topFolders) &&
      pkg.meta.topFolders.some((f) => String(f?.name || '').toLowerCase().includes('com.anatawa12.vpm-package-auto-installer'));
  }

  function handleIpc(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        requireTrustedRendererSender(event);
      } catch {
        return { error: 'untrusted_sender' };
      }
      return handler(event, ...args);
    });
  }

  function readCurrentBoothCookies() {
    try {
      const cached = typeof getBoothCookies === 'function' ? getBoothCookies() : null;
      if (Array.isArray(cached) && cached.length > 0) return cached;
    } catch {
      // ignore
    }
    try {
      const cookiePath = settingsMgr?.getSettings?.()?.cookieFile || DEFAULT_SETTINGS?.cookieFile;
      if (cookiePath && typeof readBoothCookiesFromFile === 'function') {
        return readBoothCookiesFromFile(cookiePath);
      }
    } catch {
      // ignore
    }
    return [];
  }

  async function getBoothLibrarySessionState() {
    const cookies = readCurrentBoothCookies();
    if (!Array.isArray(cookies) || cookies.length <= 0) {
      return { loggedIn: false, reason: 'no_booth_cookies', libraryItemCount: 0 };
    }
    if (typeof probeBoothLibrary !== 'function') {
      return { loggedIn: null, reason: 'probe_unavailable', libraryItemCount: null };
    }
    const probe = await probeBoothLibrary(cookies);
    if (!probe?.ok) {
      return {
        loggedIn: false,
        reason: probe?.reason || 'library_probe_failed',
        libraryItemCount: 0,
      };
    }
    return {
      loggedIn: true,
      reason: '',
      libraryItemCount: Number.isFinite(Number(probe.itemCount)) ? Number(probe.itemCount) : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Rate-limiting state for renderer-log
  // ---------------------------------------------------------------------------
  let rendererLogWindowStartedAt = 0;
  let rendererLogWindowCount = 0;

  // ---------------------------------------------------------------------------
  // IPC Handlers
  // ---------------------------------------------------------------------------

  // IPC: load assets
  handleIpc('load-assets', async (event) => {
    try {
      const data = await runWithBoothCookieLoginFallback(async () => await metaMgr.loadOrGenerateMeta(event, 'load-assets'));
      // Fix any 3D character items whose supportedAvatars/supportedAvatarsInferred were
      // wrongly set by inference (e.g. avatar page mentions other avatars in tags).
      try {
        if (fixAvatarItemFields(Array.isArray(data) ? data : [])) writeMetaFile(data || []);
      } catch { /* non-critical */ }
      // Keep avatars.json populated so the avatar analysis dictionary is never empty on load.
      try { syncAvatarItemsToFile(Array.isArray(data) ? data : []); } catch { /* non-critical */ }
      return metaMgr.toAssetMap(data);
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('load-avatar-aliases', async () => {
    try {
      if (!AVATARS_PATH || !fs.existsSync(AVATARS_PATH)) return { ok: true, avatars: [] };
      const rows = JSON.parse(fs.readFileSync(AVATARS_PATH, 'utf8'));
      return { ok: true, avatars: Array.isArray(rows) ? rows : [] };
    } catch (e) {
      return { error: e?.message || String(e), avatars: [] };
    }
  });

  handleIpc('get-storage-usage', async () => {
    try {
      return getStorageUsageSnapshot();
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  // IPC: prepare downloader client
  handleIpc('prepare-client', async () => {
    try {
      await downloadQueue.ensureClientReady();
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('get-settings', async () => settingsMgr.getSettings());

  handleIpc('get-app-version', async () => ({
    ok: true,
    version: app.getVersion(),
    packaged: app.isPackaged,
    updaterAvailable: Boolean(electronAutoUpdater),
  }));

  handleIpc('check-app-update', async (_event, payload = {}) => {
    const manual = Boolean(payload?.manual);
    return await appUpdater.checkForAppUpdate(manual);
  });

  handleIpc('start-app-update-download', async () => {
    return await appUpdater.startAppUpdateDownload();
  });

  handleIpc('install-app-update-now', async () => {
    return await appUpdater.installAppUpdateNow();
  });

  handleIpc('respond-archive-password', async (_event, payload = {}) => {
    const requestId = String(payload?.requestId || '').trim();
    const password = payload?.cancelled ? null : (String(payload?.password || '').trim() || null);
    if (!requestId) return { ok: false, error: 'request_id_required' };
    const pending = pendingArchivePasswords.get(requestId);
    if (!pending) return { ok: false, error: 'request_not_found' };
    pendingArchivePasswords.delete(requestId);
    try { pending.resolve(password); } catch {}
    return { ok: true };
  });

  handleIpc('respond-zip-oversize-confirm', async (_event, payload = {}) => {
    const requestId = String(payload?.requestId || '').trim();
    const allow = Boolean(payload?.allow);
    if (!requestId) return { ok: false, error: 'request_id_required' };
    const pending = pendingZipOversizeConfirms.get(requestId);
    if (!pending) return { ok: false, error: 'request_not_found' };
    pendingZipOversizeConfirms.delete(requestId);
    try {
      pending.resolve(allow);
    } catch {
      // ignore
    }
    return { ok: true };
  });

  handleIpc('preview-manual-free-asset', async (_event, payload = {}) => {
    try {
      return await runWithBoothCookieLoginFallback(async () => {
        const rawInput = String(payload?.itemIdOrUrl || payload?.itemId || payload?.url || '').trim();
        const resolved = await resolveManualFreeAssetCandidate(rawInput);
        if (resolved?.error) return { error: resolved.error };
        return {
          ok: true,
          itemId: resolved.itemId,
          title: resolved.item?.itemName || '',
          author: resolved.item?.authorName || '',
          files: resolved.links.length,
          previewUrl: String(resolved.item?.localImagePath || resolved.item?.imageUrl || ''),
        };
      });
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('add-manual-free-asset', async (event, payload = {}) => {
    try {
      return await runWithBoothCookieLoginFallback(async () => {
        const rawInput = String(payload?.itemIdOrUrl || payload?.itemId || payload?.url || '').trim();
        const resolved = await resolveManualFreeAssetCandidate(rawInput);
        if (resolved?.error) return { error: resolved.error };
        const { itemId, links, item } = resolved;

        let meta = [];
        if (fs.existsSync(META_PATH)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
            meta = Array.isArray(parsed) ? parsed : [];
          } catch {
            meta = [];
          }
        }

        const next = [...meta.filter((m) => String(m?.itemId || '') !== String(itemId)), item];
        const normalized = dedupeMetaItemsByItemId(next);
        writeMetaFile(normalized);
        metaMgr.getMetaCache(); // keep external cache reference; metaCache update is via metaMgr
        // Directly update metaMgr internal state via markItemUpdatedInMeta is not sufficient here;
        // the full list was rewritten, so notify via metaMgr's cache invalidation path.
        // Since metaMgr exposes getMetaCache as a getter (not a setter), we use the injected
        // writeMetaFile + metaMgr reload pattern used elsewhere in main.js.
        // metaCacheAvatarEnriched = false is managed by metaMgr internally.

        try {
          if (event?.sender && !event.sender.isDestroyed?.()) {
            event.sender.send('assets-refreshed', metaMgr.toAssetMap(normalized));
          }
        } catch {
          // ignore
        }

        return {
          ok: true,
          itemId,
          title: item.itemName,
          files: links.length,
          assets: metaMgr.toAssetMap(normalized),
        };
      });
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('preview-wishlist-item', async (_event, payload = {}) => {
    try {
      return await runWithBoothCookieLoginFallback(async () => {
        const rawInput = String(payload?.itemIdOrUrl || payload?.itemId || payload?.url || '').trim();
        const resolved = await resolveWishlistCandidate(rawInput);
        if (resolved?.error) return { error: resolved.error };
        return {
          ok: true,
          itemId: resolved.itemId,
          title: resolved.item?.itemName || '',
          author: resolved.item?.authorName || '',
          previewUrl: String(resolved.item?.localImagePath || resolved.item?.imageUrl || ''),
        };
      });
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('import-booth-wishlist', async (event) => {
    try {
      return await runWithBoothCookieLoginFallback(async () => {
        if (typeof importBoothWishlist !== 'function') return { error: 'import_unavailable' };
        const result = await importBoothWishlist({
          onProgress: ({ done, total, itemId }) => {
            try {
              if (event?.sender && !event.sender.isDestroyed?.()) {
                event.sender.send('wishlist-import-progress', { done, total, itemId });
              }
            } catch { /* ignore */ }
          },
        });
        if (result?.ok && result.imported > 0) {
          let meta = [];
          if (fs.existsSync(META_PATH)) {
            try { meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch { meta = []; }
            if (!Array.isArray(meta)) meta = [];
          }
          try {
            if (event?.sender && !event.sender.isDestroyed?.()) {
              event.sender.send('assets-refreshed', metaMgr.toAssetMap(meta));
            }
          } catch { /* ignore */ }
        }
        return result;
      });
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('toggle-wishlist', async (event, payload = {}) => {
    try {
      return await runWithBoothCookieLoginFallback(async () => {
        const itemId = String(payload?.itemId || '').trim();
        if (!itemId) return { error: 'itemId required' };

        let meta = [];
        if (fs.existsSync(META_PATH)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
            meta = Array.isArray(parsed) ? parsed : [];
          } catch {
            meta = [];
          }
        }

        const existing = meta.find((m) => String(m?.itemId || '') === itemId);
        let next;

        if (existing) {
          // toggle flag on existing item
          next = meta.map((m) => String(m?.itemId || '') === itemId
            ? { ...m, isWishlisted: !m.isWishlisted }
            : m,
          );
          const isWishlisted = Boolean(!existing.isWishlisted);
          writeMetaFile(next);
          try {
            if (event?.sender && !event.sender.isDestroyed?.()) {
              event.sender.send('assets-refreshed', metaMgr.toAssetMap(next));
            }
          } catch { /* ignore */ }
          return { ok: true, itemId, isWishlisted };
        } else {
          // new wishlist item – fetch from BOOTH
          const rawInput = payload?.itemIdOrUrl || itemId;
          const resolved = await resolveWishlistCandidate(rawInput);
          if (resolved?.error) return { error: resolved.error };
          const item = resolved.item;
          next = dedupeMetaItemsByItemId([...meta, item]);
          writeMetaFile(next);
          try {
            if (event?.sender && !event.sender.isDestroyed?.()) {
              event.sender.send('assets-refreshed', metaMgr.toAssetMap(next));
            }
          } catch { /* ignore */ }
          return { ok: true, itemId: resolved.itemId, isWishlisted: true };
        }
      });
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('add-wishlist-item-to-cart', async (_event, payload = {}) => {
    try {
      return await runWithBoothCookieLoginFallback(async () => {
        if (typeof addWishlistItemToBoothCart !== 'function') return { error: 'cart_api_unavailable' };
        const rawInput = String(payload?.itemIdOrUrl || payload?.itemId || payload?.url || '').trim();
        const variationName = payload?.variationName ? String(payload.variationName) : undefined;
        const result = await addWishlistItemToBoothCart(rawInput, variationName);
        if (result?.error) return result;
        return result;
      });
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('get-booth-cart', async (_event, payload = {}) => {
    try {
      return await runWithBoothCookieLoginFallback(async () => {
        if (typeof fetchBoothCart !== 'function') return { error: 'unavailable' };
        return await fetchBoothCart(String(payload?.shopSubdomain || ''));
      });
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('search-booth', async (_event, payload = {}) => {
    try {
      if (typeof searchBoothItems !== 'function') return { error: 'search_unavailable' };
      const query = String(payload?.query || '').trim();
      if (!query) return { error: 'query_required' };
      const result = await searchBoothItems({
        query,
        page: Number(payload?.page) || 1,
        sort: String(payload?.sort || 'new_arrivals'),
        inStock: payload?.inStock !== false,
        categoryId: String(payload?.categoryId || ''),
        minPrice: payload?.minPrice != null ? Number(payload.minPrice) : null,
        maxPrice: payload?.maxPrice != null ? Number(payload.maxPrice) : null,
      });
      return { ok: true, ...result };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('fetch-booth-item-detail', async (_event, payload = {}) => {
    try {
      if (typeof fetchBoothItemDetail !== 'function') return { error: 'detail_unavailable' };
      return await fetchBoothItemDetail(String(payload?.itemId || '').trim());
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('fetch-booth-home', async (_event, payload = {}) => {
    try {
      if (typeof fetchBoothHomeSections !== 'function') return { error: 'home_unavailable' };
      return await runWithBoothCookieLoginFallback(async () => ({
        ok: true,
        ...(await fetchBoothHomeSections({
          limitSections: Number(payload?.limitSections) || 6,
          itemsPerSection: Number(payload?.itemsPerSection) || 4,
          client: typeof getBoothClient === 'function' ? getBoothClient() : null,
        })),
      }));
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('fetch-booth-related-items', async (_event, payload = {}) => {
    try {
      if (typeof fetchBoothRelatedItems !== 'function') return { error: 'related_unavailable' };
      return await runWithBoothCookieLoginFallback(async () => ({
        ok: true,
        ...(await fetchBoothRelatedItems({
          itemId: String(payload?.itemId || '').trim(),
          limit: Number(payload?.limit) || 12,
          client: typeof getBoothClient === 'function' ? getBoothClient() : null,
        })),
      }));
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('update-user-meta', async (event, payload = {}) => {
    try {
      const itemId = String(payload?.itemId || '').trim();
      if (!itemId) return { error: 'itemId required' };
      const patch = payload?.patch || {};

      let meta = [];
      if (fs.existsSync(META_PATH)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
          meta = Array.isArray(parsed) ? parsed : [];
        } catch {
          meta = [];
        }
      }

      const exists = meta.some((m) => String(m?.itemId || '') === itemId);
      if (!exists) return { error: 'item_not_found' };

      const allowed = {};
      if (Array.isArray(patch.userTags)) {
        allowed.userTags = patch.userTags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 50);
      }
      if (typeof patch.userNote === 'string') {
        allowed.userNote = patch.userNote.slice(0, 2000);
      }

      const next = meta.map((m) => String(m?.itemId || '') === itemId ? { ...m, ...allowed } : m);
      writeMetaFile(next);
      try {
        if (event?.sender && !event.sender.isDestroyed?.()) {
          event.sender.send('assets-refreshed', metaMgr.toAssetMap(next));
        }
      } catch { /* ignore */ }
      return { ok: true };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('list-auto-bootstrap-variants', async () => {
    try {
      const options = await listAutoBootstrapVariantOptions();
      return { ok: true, options };
    } catch (e) {
      return { error: e?.message || String(e), options: [] };
    }
  });

  handleIpc('list-auto-bootstrap-rule-choices', async () => {
    try {
      const choices = await listAutoBootstrapRuleChoices();
      return { ok: true, choices };
    } catch (e) {
      return { error: e?.message || String(e), choices: [] };
    }
  });

  handleIpc('update-settings', async (_event, newSettings = {}) => {
    try {
      const current = settingsMgr.getSettings();
      const merged = { ...current, ...settingsMgr.pickAllowedSettings(newSettings || {}) };
      settingsMgr.normalizeSettingsInPlace(merged);
      settingsMgr.saveSettings(merged);
      downloadQueue.getQueueState().concurrency = merged.concurrency;
      ensureRuntimeDirs();
      ensureFolderIconBootstrapForProjects(merged.unityProjects, 'update-settings');
      startAutoCheckTimer();
      startDownloadScheduler();
      return { ok: true, settings: settingsMgr.getSettings() };
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('run-health-check', async (_event, trigger = 'manual') => {
    try {
      const report = await runHealthCheck(String(trigger || 'manual'));
      return { ok: true, report };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('get-operation-logs', async () => {
    const logs = logMgr.getOperationLogs();
    return { ok: true, logs: Array.isArray(logs) ? logs.slice(-300) : [] };
  });

  handleIpc('clear-operation-logs', async () => {
    logMgr.clearOperationLogs();
    saveOperationLogs();
    logMgr.appendOperationLog('operation-log', '操作ログをクリアしました');
    return { ok: true, logs: [] };
  });

  handleIpc('list-settings-profiles', async () => {
    const profiles = settingsMgr.getSettingsProfiles();
    const names = Object.keys(profiles || {}).sort((a, b) => a.localeCompare(b, 'ja'));
    return { ok: true, names };
  });

  handleIpc('save-settings-profile', async (_event, profileName, profilePayload = null) => {
    const name = String(profileName || '').trim();
    if (!name) return { error: 'profile_name_required' };
    const settings = settingsMgr.getSettings();
    const data = profilePayload && typeof profilePayload === 'object'
      ? { ...settings, ...settingsMgr.pickAllowedSettings(profilePayload || {}) }
      : { ...settings };
    settingsMgr.normalizeSettingsInPlace(data);
    const profiles = settingsMgr.getSettingsProfiles();
    profiles[name] = data;
    settingsMgr.saveSettingsProfiles();
    logMgr.appendOperationLog('settings-profile', `設定プロファイルを保存: ${name}`);
    return { ok: true, name };
  });

  handleIpc('apply-settings-profile', async (_event, profileName) => {
    const name = String(profileName || '').trim();
    if (!name) return { error: 'profile_name_required' };
    const profiles = settingsMgr.getSettingsProfiles();
    const data = profiles[name];
    if (!data || typeof data !== 'object') return { error: 'profile_not_found' };
    const settings = settingsMgr.getSettings();
    const merged = { ...settings, ...settingsMgr.pickAllowedSettings(data) };
    settingsMgr.normalizeSettingsInPlace(merged);
    settingsMgr.saveSettings(merged);
    downloadQueue.getQueueState().concurrency = merged.concurrency;
    ensureFolderIconBootstrapForProjects(merged.unityProjects, 'apply-settings-profile');
    startAutoCheckTimer();
    startDownloadScheduler();
    logMgr.appendOperationLog('settings-profile', `設定プロファイルを適用: ${name}`);
    return { ok: true, settings: settingsMgr.getSettings(), name };
  });

  handleIpc('export-app-bundle', async (_event, payload = {}) => {
    try {
      const requestedPath = String(payload?.exportPath || '').trim();
      if (!requestedPath) return { error: 'export_path_required' };
      const exportPath = resolveExportBundlePath(requestedPath);
      if (!exportPath) return { error: 'export_path_required' };
      const exportDir = path.dirname(exportPath);
      if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
      const notifications = Array.isArray(payload?.notifications) ? payload.notifications : [];
      const meta = readJsonFileSafe(META_PATH, []);
      const manualItems = Array.isArray(meta) ? meta.filter((it) => Boolean(it?.manualAdded)) : [];
      const settings = settingsMgr.getSettings();
      const operationLogs = logMgr.getOperationLogs();
      const bundle = {
        exportedAt: new Date().toISOString(),
        app: 'avatool',
        settings,
        notifications,
        manualItems,
        operationLogs: Array.isArray(operationLogs) ? operationLogs.slice(-300) : [],
      };
      fs.writeFileSync(exportPath, JSON.stringify(bundle, null, 2), 'utf8');
      logMgr.appendOperationLog('export', `エクスポート完了: ${exportPath}`);
      return { ok: true, exportPath };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('import-app-bundle', async (_event, payload = {}) => {
    try {
      const importPath = String(payload?.importPath || '').trim();
      if (!importPath || !fs.existsSync(importPath)) return { error: 'import_path_not_found' };
      const importStat = fs.statSync(importPath);
      if (importStat.size > 50 * 1024 * 1024) return { error: 'file_too_large' };
      const data = readJsonFileSafe(importPath, null);
      if (!data || typeof data !== 'object') return { error: 'invalid_bundle' };
      if (data.settings && typeof data.settings === 'object') {
        const settings = settingsMgr.getSettings();
        const merged = { ...settings, ...settingsMgr.pickAllowedImportSettings(data.settings) };
        settingsMgr.normalizeSettingsInPlace(merged);
        settingsMgr.saveSettings(merged);
        downloadQueue.getQueueState().concurrency = merged.concurrency;
        ensureFolderIconBootstrapForProjects(merged.unityProjects, 'import-app-bundle');
        startAutoCheckTimer();
        startDownloadScheduler();
      }
      if (Array.isArray(data.operationLogs)) {
        // Replace logs in logMgr (slice to last 500)
        const trimmed = data.operationLogs.slice(-500);
        logMgr.clearOperationLogs();
        for (const entry of trimmed) {
          logMgr.appendOperationLog(entry?.type || 'import', entry?.message || '', entry?.meta);
        }
        saveOperationLogs();
      }
      if (Array.isArray(data.manualItems) && data.manualItems.length) {
        const current = dedupeMetaItemsByItemId(readJsonFileSafe(META_PATH, []));
        const merged = dedupeMetaItemsByItemId([
          ...current,
          ...data.manualItems.map((it) => ({ ...(it || {}), manualAdded: true })),
        ]);
        writeMetaFile(merged);
      }
      logMgr.appendOperationLog('import', `インポート完了: ${importPath}`);
      return {
        ok: true,
        settings: settingsMgr.getSettings(),
        notifications: Array.isArray(data.notifications) ? data.notifications : [],
      };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('load-cookie-file', async (_event, filePath) => {
    try {
      const os = require('os');
      const settings = settingsMgr.getSettings();
      const targetPath = String(filePath || settings.cookieFile || '').trim();
      if (!targetPath || !fs.existsSync(targetPath)) return { error: 'file_not_found' };
      const resolvedTarget = path.resolve(targetPath).toLowerCase();
      const homeLower = os.homedir().toLowerCase();
      const appDataLower = path.resolve(APP_DATA_ROOT).toLowerCase();
      if (!resolvedTarget.startsWith(homeLower) && !resolvedTarget.startsWith(appDataLower)) {
        return { error: 'invalid_path' };
      }
      const cookies = readBoothCookiesFromFile(targetPath);
      if (!Array.isArray(cookies) || cookies.length === 0) return { error: 'invalid_format' };

      // Cookie store is centralized under APP_DATA_ROOT.
      const saved = writeBoothCookiesToFile(DEFAULT_SETTINGS.cookieFile, normalizeBoothCookies(cookies));
      const updatedSettings = { ...settings, cookieFile: DEFAULT_SETTINGS.cookieFile };
      settingsMgr.saveSettings(updatedSettings);
      setBoothClient(null);
      setBoothCookies(null);
      return { ok: true, cookieCount: cookies.length, encrypted: Boolean(saved?.encrypted) };
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('open-login-window', async (event) => {
    const loginRes = await openLoginWindowFlow();
    if (!loginRes?.ok) return loginRes;
    refreshMetaAfterLoginDedup(event?.sender || null)
      .catch((e) => {
        console.warn('post-login meta refresh failed:', e?.message || e);
      });
    return { ...loginRes, metaRefreshStarted: true };
  });

  handleIpc('logout-session', async () => {
    try {
      const loginWindow = getLoginWindow();
      if (loginWindow && !loginWindow.isDestroyed()) {
        try { loginWindow.close(); } catch {}
        setLoginWindow(null);
      }

      const wcSession = session.fromPartition(BOOTH_LOGIN_PARTITION);
      if (wcSession) {
        const allCookies = await wcSession.cookies.get({});
        const boothCookiesNow = (allCookies || []).filter((c) => isBoothDomain(c?.domain));
        for (const c of boothCookiesNow) {
          const url = cookieUrlFromRecord(c);
          if (!url) continue;
          try {
            await wcSession.cookies.remove(url, String(c.name || ''));
          } catch {
            // ignore per-cookie failures
          }
        }
      }

      if (fs.existsSync(DEFAULT_SETTINGS.cookieFile)) {
        try { fs.unlinkSync(DEFAULT_SETTINGS.cookieFile); } catch {}
      }
      if (fs.existsSync(TEMP_COOKIE_PATH)) {
        try { fs.unlinkSync(TEMP_COOKIE_PATH); } catch {}
      }

      setBoothClient(null);
      setBoothCookies(null);

      return { ok: true };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('load-vcc-projects', async () => {
    console.log('[main] Loading VCC settings from:', VCC_SETTINGS_PATH);
    const vcc = readVccProjectsFile();
    if (!vcc?.ok) {
      console.warn('[main] VCC load failed:', vcc?.error);
      return { error: vcc?.error || 'unknown' };
    }
    console.log(`[main] Loaded ${vcc.projects.length} projects from VCC`);
    return vcc;
  });

  handleIpc('scan-unity-package', async (_event, payload = {}) => {
    try {
      return await runReconcileWorker('scan', payload);
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('analyze-import-tool-deps', async (_event, payload = {}) => {
    try {
      const projectPath = String(payload?.projectPath || '').trim();
      const packages = Array.isArray(payload?.packages) ? payload.packages : [];
      if (!projectPath || !fs.existsSync(projectPath)) return { error: 'project_not_found' };
      return await unityMgr.analyzeImportToolDependencies(projectPath, packages);
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('unity-import-dry-run', async (_event, payload = {}) => {
    try {
      if (!unityMgr.canRunUnityImport()) return { error: 'avatool_scripts_disabled' };
      const projectPath = String(payload?.projectPath || '').trim();
      const rawPackages = Array.isArray(payload?.packages) ? payload.packages : [];
      const packagePaths = Array.isArray(payload?.packagePaths)
        ? payload.packagePaths.map((p) => String(p || '').trim()).filter(Boolean)
        : [];
      if (!projectPath || !fs.existsSync(projectPath)) return { error: 'project_not_found' };
      if (!isRegisteredUnityProject(projectPath)) return { error: 'project_not_registered' };
      let packages = rawPackages.map((p) => ({
        itemId: String(p?.itemId || ''),
        title: String(p?.title || ''),
        packagePath: String(p?.packagePath || '').trim(),
        previewUrl: String(p?.previewUrl || ''),
        meta: {
          topFolders: Array.isArray(p?.meta?.topFolders) ? p.meta.topFolders : [],
          tokens: Array.isArray(p?.meta?.tokens) ? p.meta.tokens : [],
        },
      })).filter((p) => p.packagePath);
      if (!packages.length) {
        packages = packagePaths.map((pkgPath) => ({
          itemId: '',
          title: '',
          packagePath: pkgPath,
          previewUrl: '',
          meta: { topFolders: [], tokens: [] },
        }));
      }
      if (!packages.length) return { error: 'no_packages' };
      const baseCount = packages.length;
      const withSimpleFolderIcon = unityMgr.appendSimpleFolderIconToBatchPackages(packages);
      const addedSimpleFolderIcon = withSimpleFolderIcon.length > baseCount;
      const { validPackages, invalidPaths } = unityMgr.validateImportPackages(withSimpleFolderIcon);
      if (!validPackages.length) return { error: 'no_valid_packages', invalidPaths };
      const importPackagesRaw = await unityMgr.fillPackageMetaByScan(validPackages);
      const planned = unityMgr.planTopFolderRenames(projectPath, importPackagesRaw);
      const importPackages = planned.packages;
      const renameEntries = planned.renameEntries;
      const depRes = await unityMgr.analyzeImportToolDependencies(projectPath, importPackages);
      return {
        ok: true,
        projectPath,
        requested: withSimpleFolderIcon.length,
        valid: importPackages.length,
        invalid: invalidPaths.length,
        invalidPaths,
        addedSimpleFolderIcon,
        renameCount: renameEntries.length,
        renameEntries,
        missingDeps: Array.isArray(depRes?.missing) ? depRes.missing : [],
        packages: importPackages.map((p) => ({
          itemId: String(p?.itemId || ''),
          title: String(p?.title || ''),
          packagePath: String(p?.packagePath || ''),
          topFolders: Array.isArray(p?.meta?.topFolders) ? p.meta.topFolders : [],
        })),
      };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('install-import-tool-deps', async (_event, payload = {}) => {
    try {
      const projectPath = String(payload?.projectPath || '').trim();
      const tools = Array.isArray(payload?.tools) ? payload.tools : [];
      if (!projectPath || !fs.existsSync(projectPath)) return { error: 'project_not_found' };
      if (!isRegisteredUnityProject(projectPath)) return { error: 'project_not_registered' };
      return await unityMgr.installImportToolDependencies(projectPath, tools);
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('get-import-history', async (_event, itemId) => {
    const history = unityMgr.loadImportHistory();
    return { history: history[String(itemId)] || [] };
  });

  handleIpc('get-project-items', async (_event, projectPath) => {
    try {
      const target = settingsMgr.normalizeProjectPath(projectPath);
      if (!target) return { items: [] };
      if (isFolderIconBootstrapEnabled() && fs.existsSync(target)) {
        const bootstrapRes = ensureUnityFolderIconBootstrapReady(target);
        if (!bootstrapRes?.ok) {
          logMgr.appendOperationLog('folder-icon-bootstrap', `起動時フォルダアイコン再適用スクリプトの準備に失敗: ${String(bootstrapRes?.error || 'unknown')}`, {
            projectPath: target,
            trigger: 'get-project-items',
          });
        } else if (bootstrapRes?.status && bootstrapRes.status !== 'unchanged') {
          logMgr.appendOperationLog('folder-icon-bootstrap', `起動時フォルダアイコン再適用スクリプトを${bootstrapRes.status === 'created' ? '作成' : '更新'}しました`, {
            projectPath: target,
            scriptPath: String(bootstrapRes.scriptPath || ''),
            status: bootstrapRes.status,
            trigger: 'get-project-items',
          });
        }
      }
      const history = unityMgr.loadImportHistory();
      const items = [];

      for (const [itemId, rows] of Object.entries(history)) {
        const matched = (Array.isArray(rows) ? rows : [])
          .filter((r) => settingsMgr.normalizeProjectPath(r?.projectPath || '') === target);
        if (!matched.length) continue;
        matched.sort((a, b) => new Date(b?.importedAt || 0).getTime() - new Date(a?.importedAt || 0).getTime());
        const latest = matched[0] || {};
        items.push({
          itemId: String(itemId),
          title: String(latest?.title || ''),
          count: matched.length,
          lastImportedAt: latest?.importedAt || '',
          topFolder: latest?.topFolders?.[0]?.name || '',
          tokens: Array.isArray(latest?.tokens) ? latest.tokens : [],
          reconciled: Boolean(latest?.reconciled),
        });
      }

      items.sort((a, b) => new Date(b.lastImportedAt || 0).getTime() - new Date(a.lastImportedAt || 0).getTime());
      return { items };
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('reconcile-imports', async (_event, payload = {}) => {
    try {
      const projectPath = String(payload?.projectPath || '').trim();
      const packages = Array.isArray(payload?.packages) ? payload.packages : [];
      const persistMatched = payload?.persistMatched !== false;
      const threshold = Number(payload?.threshold ?? 0.6);

      if (!projectPath || !fs.existsSync(projectPath)) return { error: 'project_not_found' };
      if (!packages.length) return { error: 'no_packages' };

      const reconcileWorkerCount = getRecommendedReconcileWorkerCount(packages.length);
      const built = await unityMgr.buildPackageMetasAdaptive(packages, reconcileWorkerCount);
      const buildErr = built.find((r) => !r?.ok);
      if (buildErr) return { error: buildErr.error || 'package_scan_failed' };
      const preparedPackages = packages.map((pkg, i) => ({
        ...(pkg || {}),
        meta: built[i]?.meta || pkg?.meta || {},
      }));

      // プロジェクトインデックスキャッシュ（Assets/ mtime 変化時のみ再スキャン）
      const cachedIndex = getProjectIndexCached(projectPath);

      const workerRes = await runReconcileWorker('reconcile', {
        projectPath,
        packages: preparedPackages,
        threshold,
        projectIndex: cachedIndex || null,
      });
      if (workerRes?.error) return { error: workerRes.error };

      // worker が新規スキャンしたインデックスをキャッシュ
      if (workerRes?.projectIndex) {
        const fp = unityMgr.computeProjectFingerprint?.(projectPath);
        setProjectIndexCache(projectPath, { ...workerRes.projectIndex, fingerprint: fp || '' });
      }

      const results = Array.isArray(workerRes?.results) ? workerRes.results : [];
      const invalidPaths = Array.isArray(workerRes?.invalidPaths) ? workerRes.invalidPaths : [];
      const matched = results.filter((r) => r.matched);

      const normalizedProjectPath = settingsMgr.normalizeProjectPath(projectPath);
      const ts = new Date().toISOString();
      writeReconcileLogBatch(results.map((r) => ({
        timestamp: ts,
        itemId: r.itemId,
        title: r.title,
        packagePath: r.packagePath,
        projectPath: normalizedProjectPath,
        threshold: r.threshold ?? threshold,
        matched: Boolean(r.matched),
        score: Number(r.score || 0),
        details: {
          matchedTopFolderCount: Number(r.matchedTopFolderCount || 0),
          matchedAssetCount: Number(r.matchedAssetCount || 0),
          totalAssetCount: Number(r.totalAssetCount || 0),
          tokenMatchCount: Number(r.tokenMatchCount || 0),
        },
        sampleExistingPaths: Array.isArray(r.sampleExistingPaths) ? r.sampleExistingPaths.slice(0, 20) : [],
      })));

      if (persistMatched && matched.length) {
        appendReconciledImportHistory(
          projectPath,
          matched.map((m) => ({
            itemId: m.itemId,
            title: m.title,
            packagePath: m.packagePath,
            meta: {
              topFolders: m.meta.topFolders,
              tokens: m.meta.tokens,
            },
          }))
        );
      }

      return {
        ok: true,
        projectPath,
        threshold,
        total: packages.length,
        scanned: Number(workerRes?.scanned ?? results.length),
        reconcileWorkerCount,
        cpuCount: getCpuCount(),
        matched: matched.length,
        invalidPaths,
        reconcileLogPath: RECONCILE_LOG_PATH,
        results,
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('unity-import-package', async (event, payload = {}) => {
    try {
      if (!unityMgr.canRunUnityImport()) return { error: 'avatool_scripts_disabled' };
      const projectPath = String(payload.projectPath || '').trim();
      const packagePath = String(payload.packagePath || '').trim();
      const importMode = normalizeImportMode(payload.importMode);
      const packageMeta = (payload.packageMeta && typeof payload.packageMeta === 'object') ? payload.packageMeta : null;
      const singlePackageRow = {
        itemId: String(packageMeta?.itemId || ''),
        title: String(packageMeta?.title || ''),
        packagePath,
        previewUrl: String(packageMeta?.previewUrl || ''),
        meta: {
          topFolders: Array.isArray(packageMeta?.meta?.topFolders) ? packageMeta.meta.topFolders : [],
          tokens: Array.isArray(packageMeta?.meta?.tokens) ? packageMeta.meta.tokens : [],
        },
      };

      if (!projectPath || !fs.existsSync(projectPath)) return { error: 'project_not_found' };
      if (!isRegisteredUnityProject(projectPath)) return { error: 'project_not_registered' };
      if (!packagePath || !fs.existsSync(packagePath)) return { error: 'package_not_found' };

      const sfiRes = installSimpleFolderIconAsPackage(projectPath);
      if (!sfiRes?.ok) console.warn('[SimpleFolderIcon] install failed:', sfiRes?.error || sfiRes);
      const requestedPackages = unityMgr.appendSimpleFolderIconToBatchPackages([singlePackageRow]);
      const { validPackages } = unityMgr.validateImportPackages(requestedPackages);
      const importPackagesRaw = await unityMgr.fillPackageMetaByScan(validPackages);
      const planned = unityMgr.planTopFolderRenames(projectPath, importPackagesRaw);
      const importPackages = planned.packages;
      const renameEntries = planned.renameEntries;
      const validPaths = importPackages.map((p) => String(p?.packagePath || '').trim()).filter(Boolean);
      if (!validPaths.length) return { error: 'no_valid_packages' };
      logMgr.appendUnityImportLog(`インポート開始 (single): ${packagePath.split(/[\\/]/).pop()} → ${projectPath.split(/[\\/]/).pop()} [${importMode}]`);

      if (importMode === 'background' || importMode === 'normal') {
        const editorCheck = unityMgr.validateUnityEditorPathSetting();
        if (!editorCheck?.ok) return { error: editorCheck?.error || 'unity_editor_not_found' };
        if (unityMgr.isUnityProjectLocked(projectPath)) {
          const livePrep = ensureUnityLiveImporterReady(projectPath);
          if (!livePrep?.ok) return { error: livePrep?.error || 'prepare_unity_project_failed' };
          const enqueueRes = enqueueUnityLiveImport(projectPath, validPaths, renameEntries);
          if (enqueueRes?.ok) {
            unityMgr.appendImportHistory(projectPath, importPackages);
            const iconWrite = await writeSimpleFolderIcons(projectPath, importPackages);
            logMgr.appendUnityImportLog(`インポート完了 (ライブ/single): 1 件`);
            pollLiveImportResults(projectPath, 1, importPackages);
            return {
              ok: true,
              mode: 'live_bridge',
              queued: Number(enqueueRes.queued || 0),
              totalQueued: Number(enqueueRes.totalQueued || 0),
              iconWrite,
            };
          }
          return enqueueRes;
        }
        const prep = ensureUnityBatchImporterReady(projectPath);
        if (!prep?.ok) return { error: prep?.error || 'prepare_unity_project_failed' };
        const lock = unityMgr.acquireBackgroundImportProjectLock(projectPath);
        if (!lock?.ok) return { error: lock?.error || 'background_import_already_running' };
        const sendImportProgress = (prog) => {
          try {
            if (event?.sender && !event.sender.isDestroyed?.()) {
              event.sender.send('unity-import-progress', {
                ...(prog || {}),
                scope: 'manual-background-import',
                projectPath,
              });
            }
          } catch {
            // ignore renderer progress send failures
          }
        };
        let result = null;
        try {
          result = await unityMgr.runUnityBatchImport(projectPath, validPaths, sendImportProgress, { renameEntries });
        } finally {
          unityMgr.releaseBackgroundImportProjectLock(lock.key);
        }
        if (result?.ok) {
          unityMgr.appendImportHistory(projectPath, importPackages);
          const iconWrite = await writeSimpleFolderIcons(projectPath, importPackages);
          logMgr.appendUnityImportLog(`インポート完了 (single): 1 件${result.logPath ? ` (ログ: ${result.logPath})` : ''}`);
          logMgr.appendUnityBatchLog(result.logPath);
          return { ...result, mode: 'background', iconWrite };
        }
        logMgr.appendUnityImportLog(`インポート失敗 (single): ${String(result?.error || 'unknown')}`);
        return result;
      }
      if (!unityMgr.isUnityProjectLocked(projectPath)) {
        return { error: 'require_background_when_unity_closed' };
      }
      const iconWrite = await writeSimpleFolderIcons(projectPath, importPackages);
      const livePrep = ensureUnityLiveImporterReady(projectPath);
      if (!livePrep?.ok) return { error: livePrep?.error || 'prepare_unity_project_failed' };
      const enqueueRes = enqueueUnityLiveImport(projectPath, validPaths, renameEntries);
      if (enqueueRes?.ok) {
        unityMgr.appendImportHistory(projectPath, importPackages);
        logMgr.appendUnityImportLog(`インポート完了 (ライブ/single): 1 件`);
        pollLiveImportResults(projectPath, 1, importPackages);
        return {
          ok: true,
          mode: 'live_bridge',
          queued: Number(enqueueRes.queued || 0),
          totalQueued: Number(enqueueRes.totalQueued || 0),
          iconWrite,
        };
      }
      return enqueueRes;
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('prepare-unity-project', async (_event, projectPath) => {
    try {
      if (!unityMgr.canRunUnityImport()) return { error: 'avatool_scripts_disabled' };
      return ensureUnityBatchImporterReady(projectPath);
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('unity-import-multiple', async (event, payload = {}) => {
    try {
      if (!unityMgr.canRunUnityImport()) return { error: 'avatool_scripts_disabled' };
      const projectPath = String(payload.projectPath || '').trim();
      const packagePaths = Array.isArray(payload.packagePaths) ? payload.packagePaths.map((p) => String(p || '').trim()).filter(Boolean) : [];
      const importMode = normalizeImportMode(payload.importMode);

      if (!projectPath || !fs.existsSync(projectPath)) return { error: 'project_not_found' };
      if (!isRegisteredUnityProject(projectPath)) return { error: 'project_not_registered' };
      if (!packagePaths.length) return { error: 'no_packages' };
      const sfiRes = installSimpleFolderIconAsPackage(projectPath);
      if (!sfiRes?.ok) console.warn('[SimpleFolderIcon] install failed:', sfiRes?.error || sfiRes);
      const requestedPackages = packagePaths.map((p) => ({ packagePath: p }));
      const packagesWithSimpleFolderIcon = unityMgr.appendSimpleFolderIconToBatchPackages(requestedPackages);
      const { validPackages, invalidPaths } = unityMgr.validateImportPackages(
        packagesWithSimpleFolderIcon
      );
      const importPackagesRaw = await unityMgr.fillPackageMetaByScan(validPackages);
      const planned = unityMgr.planTopFolderRenames(projectPath, importPackagesRaw);
      const importPackages = planned.packages;
      const renameEntries = planned.renameEntries;
      const validPaths = importPackages.map((p) => p.packagePath);
      console.log(`[BatchImport] Total: ${packagesWithSimpleFolderIcon.length}, Valid: ${validPaths.length}, Invalid: ${invalidPaths.length}`);
      if (invalidPaths.length > 0) {
        console.warn('[BatchImport] Missing files:', invalidPaths);
      }
      if (!validPaths.length) return { error: 'no_valid_packages' };
      logMgr.appendUnityImportLog(`インポート開始 (multiple): ${validPaths.length} 件 → ${projectPath.split(/[\\/]/).pop()} [${importMode}]`);
      for (const p of validPaths) logMgr.appendUnityImportLog(`  パッケージ: ${p.split(/[\\/]/).pop()}`);
      if (importMode === 'background' || importMode === 'normal') {
        const editorCheck = unityMgr.validateUnityEditorPathSetting();
        if (!editorCheck?.ok) return { error: editorCheck?.error || 'unity_editor_not_found' };
        if (unityMgr.isUnityProjectLocked(projectPath)) {
          const livePrep = ensureUnityLiveImporterReady(projectPath);
          if (!livePrep?.ok) return { error: livePrep?.error || 'prepare_unity_project_failed' };
          const enqueueRes = enqueueUnityLiveImport(projectPath, validPaths, renameEntries);
          if (enqueueRes?.ok) {
            unityMgr.appendImportHistory(projectPath, importPackages.map((p) => ({
              itemId: '',
              title: '',
              packagePath: p.packagePath,
              meta: p.meta,
            })));
            const iconWrite = await writeSimpleFolderIcons(projectPath, importPackages);
            logMgr.appendUnityImportLog(`インポート完了 (ライブ/multiple): ${validPaths.length} 件`);
            pollLiveImportResults(projectPath, validPaths.length, importPackages);
            return {
              ok: true,
              mode: 'live_bridge',
              queued: Number(enqueueRes.queued || 0),
              totalQueued: Number(enqueueRes.totalQueued || 0),
              iconWrite,
            };
          }
          return enqueueRes;
        }
        const prep = ensureUnityBatchImporterReady(projectPath);
        if (!prep?.ok) return { error: prep?.error || 'prepare_unity_project_failed' };
        const lock = unityMgr.acquireBackgroundImportProjectLock(projectPath);
        if (!lock?.ok) return { error: lock?.error || 'background_import_already_running' };
        const sendImportProgress = (prog) => {
          try {
            if (event?.sender && !event.sender.isDestroyed?.()) {
              event.sender.send('unity-import-progress', {
                ...(prog || {}),
                scope: 'manual-background-import',
                projectPath,
              });
            }
          } catch {
            // ignore renderer progress send failures
          }
        };
        let result = null;
        try {
          result = await unityMgr.runUnityBatchImport(projectPath, validPaths, sendImportProgress, { renameEntries });
        } finally {
          unityMgr.releaseBackgroundImportProjectLock(lock.key);
        }
        if (result?.ok) {
          unityMgr.appendImportHistory(projectPath, importPackages.map((p) => ({
            itemId: '',
            title: '',
            packagePath: p.packagePath,
            meta: p.meta,
          })));
          const iconWrite = await writeSimpleFolderIcons(projectPath, importPackages);
          logMgr.appendUnityImportLog(`インポート完了 (multiple): ${validPaths.length} 件${result.logPath ? ` (ログ: ${result.logPath})` : ''}`);
          logMgr.appendUnityBatchLog(result.logPath);
          return { ...result, mode: 'background', iconWrite };
        }
        return result;
      }
      return { error: 'unsupported_import_mode' };
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('unity-import-multiple-with-meta', async (event, payload = {}) => {
    try {
      if (!unityMgr.canRunUnityImport()) return { error: 'avatool_scripts_disabled' };
      const projectPath = String(payload.projectPath || '').trim();
      const packages = Array.isArray(payload.packages) ? payload.packages : [];
      const importMode = normalizeImportMode(payload.importMode);
      console.log('[BatchImportMeta][Flow] enter', `mode=${importMode}`, `project=${projectPath}`, `packages=${packages.length}`);
      const projectBaseName = projectPath.split(/[\\/]/).pop() || projectPath;
      logMgr.appendUnityImportLog(`インポート開始: ${packages.length} 件 → ${projectBaseName} [${importMode}]`);
      for (const p of packages) {
        const pName = String(p?.packagePath || p?.title || '').split(/[\\/]/).pop();
        if (pName) logMgr.appendUnityImportLog(`  パッケージ: ${pName}`);
      }

      if (!projectPath || !fs.existsSync(projectPath)) {
        console.warn('[BatchImportMeta][Flow] return project_not_found');
        return { error: 'project_not_found' };
      }
      if (!isRegisteredUnityProject(projectPath)) {
        return { error: 'project_not_registered' };
      }
      if (!packages.length) {
        console.warn('[BatchImportMeta][Flow] return no_packages');
        return { error: 'no_packages' };
      }
      const sfiRes = installSimpleFolderIconAsPackage(projectPath);
      if (!sfiRes?.ok) console.warn('[SimpleFolderIcon] install failed:', sfiRes?.error || sfiRes);
      const packagesWithSimpleFolderIcon = unityMgr.appendSimpleFolderIconToBatchPackages(packages);
      const { validPackages, invalidPaths } = unityMgr.validateImportPackages(packagesWithSimpleFolderIcon);
      const importPackagesRaw = await unityMgr.fillPackageMetaByScan(validPackages);

      if (invalidPaths.length > 0) {
        for (const p of invalidPaths) logMgr.appendUnityImportLog(`  無効なパス (スキップ): ${String(p).split(/[\\/]/).pop()}`);
      }

      // VPM auto-installer パッケージを分離して Avatool 側でインストール
      const vpmAutoInstallerPackages = importPackagesRaw.filter((p) => isVpmAutoInstaller(p));
      const regularPackages = importPackagesRaw.filter((p) => !isVpmAutoInstaller(p));
      for (const pkg of vpmAutoInstallerPackages) {
        logMgr.appendUnityImportLog(`  VPMオートインストーラー検出: ${String(pkg.packagePath || '').split(/[\\/]/).pop()}`);
      }
      const vpmInstallResults = [];
      for (const pkg of vpmAutoInstallerPackages) {
        try {
          const config = unityMgr.extractVpmAutoInstallerConfig(String(pkg.packagePath || ''));
          if (!config) {
            vpmInstallResults.push({ packagePath: pkg.packagePath, error: 'config_parse_failed' });
            logMgr.appendUnityImportLog(`  config.json 解析失敗: ${String(pkg.packagePath || '').split(/[\\/]/).pop()}`);
            continue;
          }
          const vpmRepos = Array.isArray(config.vpmRepositories) ? config.vpmRepositories : [];
          const vpmDeps = typeof config.vpmDependencies === 'object' && config.vpmDependencies ? config.vpmDependencies : {};
          for (const [pkgName] of Object.entries(vpmDeps)) {
            let installed = false;
            let installedVia = null;
            for (const repoUrl of vpmRepos) {
              try {
                const res = await vpmMgr.installLocalVpmPackageFromRepo(projectPath, repoUrl, pkgName);
                if (res?.ok) { installed = true; installedVia = repoUrl; break; }
              } catch {
                // ignore per-repo install errors
              }
            }
            vpmInstallResults.push({ packagePath: pkg.packagePath, packageName: pkgName, installed });
            console.log(`[BatchImportMeta][VpmAutoInstaller] package=${pkgName} installed=${installed}`);
            if (installed) {
              logMgr.appendUnityImportLog(`  VPMインストール成功: ${pkgName} (${installedVia})`);
            } else {
              logMgr.appendUnityImportLog(`  VPMインストール失敗: ${pkgName} (試行リポ数: ${vpmRepos.length})`);
            }
          }
        } catch (e) {
          vpmInstallResults.push({ packagePath: pkg.packagePath, error: String(e?.message || e) });
          console.warn('[BatchImportMeta][VpmAutoInstaller] error', String(e?.message || e));
          logMgr.appendUnityImportLog(`  VPMインストール例外: ${String(pkg.packagePath || '').split(/[\\/]/).pop()} - ${String(e?.message || e)}`);
        }
      }

      const planned = unityMgr.planTopFolderRenames(projectPath, regularPackages);
      const importPackages = planned.packages;
      const renameEntries = planned.renameEntries;
      const validPaths = importPackages.map((p) => p.packagePath);

      if (validPaths.length > 0) {
        logMgr.appendUnityImportLog(`Unityインポート対象: ${validPaths.length} 件`);
        for (const p of validPaths) logMgr.appendUnityImportLog(`  ${String(p).split(/[\\/]/).pop()}`);
      }

      console.log(`[BatchImportMeta] Total: ${packagesWithSimpleFolderIcon.length}, Valid: ${validPaths.length}, Invalid: ${invalidPaths.length}, VpmAutoInstaller: ${vpmAutoInstallerPackages.length}`);
      if (invalidPaths.length > 0) {
        console.warn('[BatchImportMeta] Missing files:', invalidPaths);
      }
      if (!validPaths.length && !vpmAutoInstallerPackages.length) {
        console.warn('[BatchImportMeta][Flow] return no_valid_packages');
        return { error: 'no_valid_packages' };
      }
      if (!validPaths.length) {
        unityMgr.appendImportHistory(projectPath, []);
        logMgr.appendUnityImportLog(`インポート完了 (VPMのみ): ${vpmAutoInstallerPackages.length} 件`);
        return { ok: true, mode: 'vpm_only', vpmInstallResults };
      }
      if (importMode === 'background' || importMode === 'normal') {
        const editorCheck = unityMgr.validateUnityEditorPathSetting();
        if (!editorCheck?.ok) {
          const settings = settingsMgr.getSettings();
          console.warn('[BatchImportMeta][Flow] return unity_editor_invalid', String(settings.unityEditorPath || ''));
          return { error: editorCheck?.error || 'unity_editor_not_found' };
        }
        if (unityMgr.isUnityProjectLocked(projectPath)) {
          const livePrep = ensureUnityLiveImporterReady(projectPath);
          if (!livePrep?.ok) {
            console.warn('[BatchImportMeta][Flow] return prepare_unity_project_failed', livePrep?.error || '');
            return { error: livePrep?.error || 'prepare_unity_project_failed' };
          }
          const enqueueRes = enqueueUnityLiveImport(projectPath, validPaths, renameEntries);
          if (enqueueRes?.ok) {
            unityMgr.appendImportHistory(projectPath, importPackages);
            const iconWrite = await writeSimpleFolderIcons(projectPath, importPackages);
            logMgr.appendUnityImportLog(`インポート完了 (ライブ): ${validPaths.length} 件 (キュー: ${enqueueRes.queued}/${enqueueRes.totalQueued})`);
            pollLiveImportResults(projectPath, validPaths.length, importPackages);
            return {
              ok: true,
              mode: 'live_bridge',
              queued: Number(enqueueRes.queued || 0),
              totalQueued: Number(enqueueRes.totalQueued || 0),
              iconWrite,
              vpmInstallResults,
            };
          }
          return enqueueRes;
        }
        const prep = ensureUnityBatchImporterReady(projectPath);
        if (!prep?.ok) {
          console.warn('[BatchImportMeta][Flow] return prepare_unity_project_failed', prep?.error || '');
          return { error: prep?.error || 'prepare_unity_project_failed' };
        }
        const lock = unityMgr.acquireBackgroundImportProjectLock(projectPath);
        if (!lock?.ok) return { error: lock?.error || 'background_import_already_running' };
        console.log('[BatchImportMeta][Flow] call runUnityBatchImport', `valid=${validPaths.length}`);
        const sendImportProgress = (prog) => {
          try {
            if (event?.sender && !event.sender.isDestroyed?.()) {
              event.sender.send('unity-import-progress', {
                ...(prog || {}),
                scope: 'manual-background-import',
                projectPath,
              });
            }
          } catch {
            // ignore renderer progress send failures
          }
        };
        let result = null;
        try {
          result = await unityMgr.runUnityBatchImport(projectPath, validPaths, sendImportProgress, { renameEntries });
        } finally {
          unityMgr.releaseBackgroundImportProjectLock(lock.key);
        }
        console.log('[BatchImportMeta][Flow] runUnityBatchImport result', JSON.stringify({
          ok: Boolean(result?.ok),
          error: String(result?.error || ''),
          logPath: String(result?.logPath || ''),
        }));
        if (result?.ok) {
          unityMgr.appendImportHistory(projectPath, importPackages);
          const iconWrite = await writeSimpleFolderIcons(projectPath, importPackages);
          logMgr.appendUnityImportLog(`インポート完了: ${validPaths.length} 件${result.logPath ? ` (ログ: ${result.logPath})` : ''}`);
          logMgr.appendUnityBatchLog(result.logPath);
          return { ...result, mode: 'background', iconWrite, vpmInstallResults };
        }
        logMgr.appendUnityImportLog(`インポート失敗: ${String(result?.error || 'unknown')}${result?.logPath ? ` (ログ: ${result.logPath})` : ''}`);
        logMgr.appendUnityBatchLog(result?.logPath);
        return result;
      }
      return { error: 'unsupported_import_mode' };
    } catch (e) {
      console.error('[BatchImportMeta][Flow] throw', e?.message || String(e));
      logMgr.appendUnityImportLog(`インポート例外: ${String(e?.message || e)}`);
      return { error: e.message };
    }
  });

  handleIpc('open-packages-with-association', async (event, payload = {}) => {
    try {
      if (!unityMgr.canRunUnityImport()) return { error: 'avatool_scripts_disabled' };
      const settings = settingsMgr.getSettings();
      if (settings.safeMode) {
        return { error: 'safe_mode_blocks_os_association' };
      }
      const packagePaths = Array.isArray(payload?.packagePaths)
        ? payload.packagePaths.map((p) => String(p || '').trim()).filter(Boolean)
        : [];
      if (!packagePaths.length) return { error: 'no_packages' };
      logMgr.appendUnityImportLog(`インポート開始 (OS): ${packagePaths.length} 件`);
      for (const p of packagePaths) logMgr.appendUnityImportLog(`  パッケージ: ${p.split(/[\\/]/).pop()}`);
      const packageRowsFromPayload = Array.isArray(payload?.packages)
        ? payload.packages.map((p) => ({
          itemId: String(p?.itemId || ''),
          title: String(p?.title || ''),
          packagePath: String(p?.packagePath || '').trim(),
          previewUrl: String(p?.previewUrl || ''),
          meta: {
            topFolders: Array.isArray(p?.meta?.topFolders) ? p.meta.topFolders : [],
            tokens: Array.isArray(p?.meta?.tokens) ? p.meta.tokens : [],
          },
        })).filter((p) => p.packagePath)
        : [];
      const fallbackRows = packagePaths.map((pkgPath) => ({
        itemId: '',
        title: '',
        packagePath: pkgPath,
        previewUrl: '',
        meta: { topFolders: [], tokens: [] },
      }));
      const packageRowsBase = packageRowsFromPayload.length ? packageRowsFromPayload : fallbackRows;
      const { validPackages } = unityMgr.validateImportPackages(packageRowsBase);
      if (!validPackages.length) return { error: 'no_valid_packages' };
      const selected = await unityMgr.selectProjectPathForOsAssociation(event);
      if (selected?.error) return { error: selected.error };
      const projectPath = String(selected?.projectPath || '').trim();
      if (!isRegisteredUnityProject(projectPath)) return { error: 'project_not_registered' };

      const packagesWithMetaRaw = await unityMgr.fillPackageMetaByScan(validPackages);
      const vpmAutoInstallerPackages = packagesWithMetaRaw.filter((p) => isVpmAutoInstaller(p));
      const regularPackagesRaw = packagesWithMetaRaw.filter((p) => !isVpmAutoInstaller(p));
      for (const pkg of vpmAutoInstallerPackages) {
        logMgr.appendUnityImportLog(`  VPMオートインストーラー検出 (OS): ${String(pkg.packagePath || '').split(/[\\/]/).pop()}`);
      }
      const vpmInstallResults = [];
      for (const pkg of vpmAutoInstallerPackages) {
        try {
          const config = unityMgr.extractVpmAutoInstallerConfig(String(pkg.packagePath || ''));
          if (!config) {
            vpmInstallResults.push({ packagePath: pkg.packagePath, error: 'config_parse_failed' });
            logMgr.appendUnityImportLog(`  config.json 解析失敗 (OS): ${String(pkg.packagePath || '').split(/[\\/]/).pop()}`);
            continue;
          }
          const vpmRepos = Array.isArray(config.vpmRepositories) ? config.vpmRepositories : [];
          const vpmDeps = typeof config.vpmDependencies === 'object' && config.vpmDependencies ? config.vpmDependencies : {};
          for (const [pkgName] of Object.entries(vpmDeps)) {
            let installed = false;
            let installedVia = null;
            for (const repoUrl of vpmRepos) {
              try {
                const res = await vpmMgr.installLocalVpmPackageFromRepo(projectPath, repoUrl, pkgName);
                if (res?.ok) { installed = true; installedVia = repoUrl; break; }
              } catch {
                // ignore per-repo install errors
              }
            }
            vpmInstallResults.push({ packagePath: pkg.packagePath, packageName: pkgName, installed });
            if (installed) {
              logMgr.appendUnityImportLog(`  VPMインストール成功 (OS): ${pkgName} (${installedVia})`);
            } else {
              logMgr.appendUnityImportLog(`  VPMインストール失敗 (OS): ${pkgName} (試行リポ数: ${vpmRepos.length})`);
            }
          }
        } catch (e) {
          vpmInstallResults.push({ packagePath: pkg.packagePath, error: String(e?.message || e) });
          logMgr.appendUnityImportLog(`  VPMインストール例外 (OS): ${String(pkg.packagePath || '').split(/[\\/]/).pop()} - ${String(e?.message || e)}`);
        }
      }

      const planned = unityMgr.planTopFolderRenames(projectPath, regularPackagesRaw);
      const packagesWithMeta = planned.packages;
      const renameEntries = planned.renameEntries;
      const validPackagePaths = packagesWithMeta.map((p) => String(p?.packagePath || '').trim()).filter(Boolean);
      if (!validPackagePaths.length && !vpmAutoInstallerPackages.length) return { error: 'no_valid_packages' };
      if (!validPackagePaths.length) {
        unityMgr.appendImportHistory(projectPath, []);
        logMgr.appendUnityImportLog(`インポート完了 (VPMのみ/OS): ${vpmAutoInstallerPackages.length} 件`);
        return { ok: true, mode: 'vpm_only', projectPath, projectSource: selected?.source || '', vpmInstallResults };
      }
      if (!projectPath || !unityMgr.isUnityProjectLocked(projectPath)) {
        return { error: 'require_background_when_unity_closed' };
      }
      const iconWrite = await writeSimpleFolderIcons(projectPath, packagesWithMeta);
      const livePrep = ensureUnityLiveImporterReady(projectPath);
      if (!livePrep?.ok) return { error: livePrep?.error || 'prepare_unity_project_failed' };
      const enqueueRes = enqueueUnityLiveImport(projectPath, validPackagePaths, renameEntries);
      if (enqueueRes?.ok) {
        unityMgr.appendImportHistory(projectPath, packagesWithMeta);
        logMgr.appendUnityImportLog(`インポート完了 (ライブ/OS): ${validPackagePaths.length} 件 (キュー: ${enqueueRes.queued}/${enqueueRes.totalQueued})`);
        pollLiveImportResults(projectPath, validPackagePaths.length, packagesWithMeta);
        return {
          ok: true,
          mode: 'live_bridge',
          projectPath,
          projectSource: selected?.source || '',
          queued: Number(enqueueRes.queued || 0),
          totalQueued: Number(enqueueRes.totalQueued || 0),
          iconWrite,
          vpmInstallResults,
        };
      }
      logMgr.appendUnityImportLog(`インポート失敗 (OS): ${String(enqueueRes?.error || 'unknown')}`);
      return enqueueRes;
    } catch (e) {
      logMgr.appendUnityImportLog(`インポート例外 (OS): ${String(e?.message || e)}`);
      return { error: e.message };
    }
  });

  handleIpc('get-running-unity-projects', async () => {
    try {
      const projects = unityMgr.listRunningUnityProjectPaths();
      return {
        ok: true,
        count: projects.length,
        projects,
      };
    } catch (e) {
      return { ok: false, count: 0, projects: [], error: e?.message || String(e) };
    }
  });

  handleIpc('sync-library', async (event, options = {}) => {
    try {
      return await runWithBoothCookieLoginFallback(async () => {
        const startedAt = Date.now();
        const boothLibraryState = await getBoothLibrarySessionState();
        const refreshMetaIfNew = options.refreshMetaIfNew !== false;
        const fullRescan = options.fullRescan === true; // default: incremental sync
        const sendSyncProgress = (payload) => {
          const phase = String(payload?.phase || '');
          // library generator may emit done before avatar enrichment finishes.
          if (phase === 'done') return;
          event.sender.send('meta-progress', { ...(payload || {}), scope: 'sync-library' });
        };
        sendSyncProgress({ phase: 'prepare', index: 0, total: 1 });
        let latest = await metaMgr.loadOrGenerateMeta(event, 'sync-library');
        const knownPurchasedIds = typeof metaMgr.getKnownPurchasedItemIds === 'function'
          ? metaMgr.getKnownPurchasedItemIds(latest || [])
          : (latest || []).map((it) => String(it?.itemId || '').trim()).filter(Boolean);
        const existingIdSet = new Set(knownPurchasedIds);
        let refreshed = false;
        let backfilledCategories = 0;
        let backfillCategoryTargets = 0;
        let newItemIds = new Set();

        if (fullRescan) {
          const generated = await generateLibraryMeta(
            (msg) => event.sender.send('meta-log', msg),
            sendSyncProgress,
            {
              lightweight: true,
              persist: false,
            },
          );
          newItemIds = new Set(
            (generated || [])
              .map((it) => String(it?.itemId || '').trim())
              .filter((id) => id && !existingIdSet.has(id)),
          );
          latest = metaMgr.ensureMetaWithVersionTracking(latest, generated);
          refreshed = true;
        } else if (refreshMetaIfNew) {
          const existingIds = typeof metaMgr.getKnownPurchasedItemIds === 'function'
            ? metaMgr.getKnownPurchasedItemIds(latest || [])
            : (latest || []).map(i => String(i.itemId)).filter(Boolean);
          const hasNew = await checkLibraryHasNewItems(existingIds);
          if (hasNew) {
            const generated = await generateLibraryMeta(
              (msg) => event.sender.send('meta-log', msg),
              sendSyncProgress,
              {
                lightweight: true,
                persist: false,
              },
            );
            newItemIds = new Set(
              (generated || [])
                .map((it) => String(it?.itemId || '').trim())
                .filter((id) => id && !existingIdSet.has(id)),
            );
            latest = metaMgr.ensureMetaWithVersionTracking(latest, generated);
            refreshed = true;
          }
        }

        const categoryBackfillTargetIds = new Set(Array.from(newItemIds));
        for (const item of (latest || [])) {
          const itemId = String(item?.itemId || '').trim();
          if (!itemId) continue;
          const hasCategories = Array.isArray(item?.categories) && item.categories.length > 0;
          const hasPrimaryCategory = Boolean(item?.primaryCategory);
          const hasSupportedAvatars = Array.isArray(item?.supportedAvatars) && item.supportedAvatars.length > 0;
          const needsAvatarBackfill = Boolean(item?.isAvatarItem) && !hasSupportedAvatars;
          if (hasCategories && hasPrimaryCategory && !needsAvatarBackfill) continue;
          categoryBackfillTargetIds.add(itemId);
        }

        if (categoryBackfillTargetIds.size > 0) {
          const backfillRes = await backfillCategoriesForItemIds(latest || [], categoryBackfillTargetIds, sendSyncProgress);
          backfilledCategories = Number(backfillRes?.backfilled || 0);
          backfillCategoryTargets = Number(backfillRes?.total || 0);
          if (backfillRes?.changed) {
            writeMetaFile(latest || []);
          }
        }

        // Fix isAvatarItem/supportedAvatars for 3D-character items missing those fields.
        try {
          if (fixAvatarItemFields(latest || [])) writeMetaFile(latest || []);
        } catch { /* non-critical */ }

        // Keep avatars.json in sync for lookup use.
        try { syncAvatarItemsToFile(latest || []); } catch { /* non-critical */ }

        // Sync updates library metadata only; avatar enrichment runs after downloads.
        event.sender.send('meta-progress', { phase: 'done', scope: 'sync-library' });

        // ほしいリストの値下げチェック（非同期・ノンブロッキング）
        setImmediate(() => {
          runWishlistPriceCheck({
            metaPath: META_PATH,
            fs,
            fetchItemPricePublic,
            writeMetaFile,
            onPriceDrop: (item, prevPrice, currentPrice) => {
              try {
                const imgSrc = item.localImagePath || item.imageUrl || '';
                showDesktopNotification(
                  'ほしいリスト 値下げ通知',
                  `「${item.itemName}」が値下がりしました！ ¥${prevPrice} → ¥${currentPrice}`,
                  imgSrc,
                );
              } catch { /* ignore */ }
            },
            log: appendRuntimeLog,
          }).catch((e) => appendRuntimeLog?.(`[WishlistPriceChecker] Fatal: ${e?.message}\n`));
        });

        const stats = Array.isArray(latest) ? latest : [];
        const fallbackPreviewCount = stats.filter((it) => !it?.localImagePath && Boolean(it?.imageUrl)).length;
        const fallbackAuthorIconCount = stats.filter((it) => !it?.localAuthorIconPath && Boolean(it?.authorIconUrl)).length;
        const totalItemCount = stats.length;
        let emptyReason = '';
        if (totalItemCount <= 0) {
          if (boothLibraryState.loggedIn === false) emptyReason = 'not_logged_in';
          else if (boothLibraryState.loggedIn === true) emptyReason = 'no_purchases';
          else emptyReason = 'unknown';
        }

        return {
          ok: true,
          refreshed,
          summary: {
            elapsedMs: Date.now() - startedAt,
            totalItemCount,
            emptyReason,
            boothLoggedIn: boothLibraryState.loggedIn,
            boothLoginReason: boothLibraryState.reason || '',
            boothLibraryItemCount: boothLibraryState.libraryItemCount,
            newItemCount: newItemIds.size,
            categoryBackfillCount: backfilledCategories,
            categoryBackfillTargets: backfillCategoryTargets,
            fallbackPreviewCount,
            fallbackAuthorIconCount,
          },
          assets: metaMgr.toAssetMap(latest || []),
        };
      });
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('confirm-avatar-compatibility', async (event, payload = {}) => {
    try {
      const itemId = String(payload?.itemId || '').trim();
      const avatarName = String(payload?.avatarName || '').trim();
      const reset = Boolean(payload?.reset);
      if (!itemId) return { error: 'item_id_required' };
      if (!reset && !avatarName) return { error: 'avatar_name_required' };

      let rows = [];
      try {
        rows = normalizeAndPersistMeta(JSON.parse(fs.readFileSync(META_PATH, 'utf8')));
      } catch {
        rows = await metaMgr.loadOrGenerateMeta(event, 'avatar-confirm');
      }
      rows = Array.isArray(rows) ? rows : [];
      const item = rows.find((row) => String(row?.itemId || '').trim() === itemId);
      if (!item) return { error: 'asset_not_found' };

      const now = new Date().toISOString();
      const currentAnalysis = item.supportedAvatarAnalysis && typeof item.supportedAvatarAnalysis === 'object'
        ? item.supportedAvatarAnalysis
        : {};
      if (reset) {
        item.supportedAvatars = [];
        item.supportedAvatarsInferred = [];
        item.supportedAvatarAnalysis = {
          ...currentAnalysis,
          status: 'unclassified',
          primaryAvatar: '',
          manualConfirmed: false,
          resetAt: now,
        };
      } else {
        const supported = Array.from(new Set([
          ...(Array.isArray(item.supportedAvatars) ? item.supportedAvatars : []),
          avatarName,
        ].map((name) => String(name || '').trim()).filter(Boolean)));
        item.supportedAvatars = supported;
        item.supportedAvatarsInferred = [];
        const candidates = Array.isArray(currentAnalysis.candidates) ? currentAnalysis.candidates : [];
        const hasCandidate = candidates.some((row) => String(row?.name || '').trim() === avatarName);
        item.supportedAvatarAnalysis = {
          ...currentAnalysis,
          status: 'confirmed',
          primaryAvatar: avatarName,
          candidates: hasCandidate ? candidates : [{ name: avatarName, score: 999, reasons: ['manual-confirm'] }, ...candidates],
          manualConfirmed: true,
          confirmedAt: now,
        };
      }
      item.avatarAnalysisCheckedAt = now;
      writeMetaFile(rows);
      const normalizedRows = normalizeAndPersistMeta(rows);
      const assets = metaMgr.toAssetMap(normalizedRows);
      try {
        if (event.sender && !event.sender.isDestroyed?.()) event.sender.send('assets-refreshed', assets);
      } catch {
        // ignore renderer refresh failures
      }
      return { ok: true, assets };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  });

  handleIpc('analyze-avatar-compatibility', async (event, options = {}) => {
    try {
      return await runWithBoothCookieLoginFallback(async () => {
        const scope = String(options?.scope || 'avatar-analysis').trim() || 'avatar-analysis';
        const sendProgress = (payload) => {
          const phase = String(payload?.phase || '');
          if (phase === 'done') return;
          event.sender.send('meta-progress', { ...(payload || {}), scope });
        };
        sendProgress({ phase: 'prepare', message: '対応衣装の詳細解析を開始中...', index: 0, total: 1 });

        let latest = await metaMgr.loadOrGenerateMeta(event, scope);
        const onlyItemIds = Array.isArray(options?.onlyItemIds) ? options.onlyItemIds : null;
        latest = (await enrichMetaSupportedAvatarsFromFolders(latest || [], {
          persist: true,
          onProgress: sendProgress,
          progressEvery: 2,
          yieldEvery: 1,
          ...(onlyItemIds ? { onlyItemIds } : {}),
        })).items;

        const assets = metaMgr.toAssetMap(latest || []);
        try {
          if (event.sender && !event.sender.isDestroyed?.()) {
            event.sender.send('assets-refreshed', assets);
          }
        } catch {
          // ignore
        }
        event.sender.send('meta-progress', { phase: 'done', scope });
        return { ok: true, analyzed: latest.length, assets };
      });
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('check-updates', async (event) => {
    try {
      return await runWithBoothCookieLoginFallback(async () => {
        dbgUpdate('check-updates:start');
        const existing = dedupeMetaItemsByItemId(await metaMgr.loadOrGenerateMeta(event, 'check-updates'));
        const latest = await generateLibraryMeta(
          (msg) => event.sender.send('meta-log', msg),
          (p) => event.sender.send('meta-progress', { ...(p || {}), scope: 'check-updates' }),
          { lightweight: true, persist: false },
        );
        const { items, updates } = metaMgr.applyVersionTrackingKeepingManual(existing, latest, new Date().toISOString());
        dbgUpdate('check-updates:result', `updates=${updates.length}`, `items=${items.length}`);
        for (const u of (updates || []).slice(0, 20)) {
          dbgUpdate(
            'check-updates:item',
            `itemId=${u.itemId}`,
            `old=${String(u.oldHash || '').slice(0, 12)}`,
            `new=${String(u.newHash || '').slice(0, 12)}`,
          );
        }
        // Keep existing rich metadata (categories/images/icons) while updating version fields.
        const prevById = new Map((existing || []).map((it) => [String(it.itemId), it]));
        const merged = (items || []).map((it) => {
          const prev = prevById.get(String(it.itemId));
          if (!prev) return it;
          return {
            ...prev,
            itemName: it.itemName,
            orderDateTime: it.orderDateTime || prev.orderDateTime,
            downloadLinks: it.downloadLinks || prev.downloadLinks || [],
            versionHistory: it.versionHistory || prev.versionHistory || [],
            latestVersion: it.latestVersion || prev.latestVersion || null,
            hasUpdate: Boolean(it.hasUpdate),
            isGift: Boolean(prev.isGift || it.isGift),
            isFreeDownload: Boolean(prev.isFreeDownload || it.isFreeDownload),
            isWishlisted: Boolean(it.isWishlisted),
            wishlistAddedAt: it.isWishlisted ? (it.wishlistAddedAt || prev.wishlistAddedAt || null) : undefined,
            isRemoved: Boolean(it.isRemoved),
            removedAt: it.isRemoved ? (it.removedAt || prev.removedAt || null) : undefined,
            lastChecked: it.lastChecked || prev.lastChecked || null,
          };
        });
        const normalizedMerged = normalizeAndPersistMeta(merged);
        const enrichedUpdates = enrichUpdatesWithVersionDiff(normalizedMerged, updates);
        logMgr.appendOperationLog('check-updates', `更新チェック実行: ${enrichedUpdates.length} 件`, {
          totalItems: normalizedMerged.length,
        });
        return {
          ok: true,
          updates: enrichedUpdates,
          totalUpdates: enrichedUpdates.length,
          assets: metaMgr.toAssetMap(normalizedMerged),
        };
      });
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('mark-update-seen', async (_event, itemId, files = null, expectedStableHash = null) => {
    try {
      if (!fs.existsSync(META_PATH)) return { ok: true };
      const meta = normalizeAndPersistMeta(JSON.parse(fs.readFileSync(META_PATH, 'utf8')));
      const target = (meta || []).find(i => String(i.itemId) === String(itemId));
      if (target) {
        dbgUpdate(
          'mark-update-seen:start',
          `itemId=${itemId}`,
          `expected=${expectedStableHash ? String(expectedStableHash).slice(0, 12) : '-'}`,
          `prevStable=${String(target?.latestVersion?.filesHashStable || '').slice(0, 12)}`,
          `files=${Array.isArray(files) ? files.length : 0}`,
        );
        const now = new Date().toISOString();
        if (Array.isArray(files) && files.length > 0) {
          const normalizedLinks = files.map((f) => ({
            downloadableId: String(f?.downloadableId || ''),
            fileName: String(f?.fileName || ''),
          }));
          target.downloadLinks = normalizedLinks;
          target.latestVersion = {
            detectedAt: now,
            filesHash: generateFilesHash(normalizedLinks),
            filesHashStable: expectedStableHash
              ? String(expectedStableHash)
              : generateFilesStableHash(normalizedLinks),
          };
        } else if (expectedStableHash && target.latestVersion) {
          target.latestVersion = {
            ...target.latestVersion,
            detectedAt: now,
            filesHashStable: String(expectedStableHash),
          };
        }
        target.hasUpdate = false;
        target.lastChecked = now;
        writeMetaFile(meta);
        dbgUpdate(
          'mark-update-seen:done',
          `itemId=${itemId}`,
          `savedStable=${String(target?.latestVersion?.filesHashStable || '').slice(0, 12)}`,
        );
      }
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('extract-item', async (event, itemId, title, force = false) => {
    try {
      const itemDir = downloadQueue.buildItemDir(itemId, title);
      if (!fs.existsSync(itemDir)) return { error: 'item_dir_not_found' };

      const extractRoot = path.join(itemDir, '__extracted');
      if (force && fs.existsSync(extractRoot)) {
        fs.rmSync(extractRoot, { recursive: true, force: true });
      }

      await extractArchivesInItemDir(itemDir, { itemId, title }, (prog) => {
        sendDownloadProgress(event.sender, prog);
      });

      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('enqueue-downloads', async (event, assets = []) => {
    try {
      if (queueSenderRef) queueSenderRef.value = event.sender;
      downloadQueue.setQueueSender(event.sender);
      const diskGuard = downloadQueue.checkDiskSpaceGuard();
      if (!diskGuard?.ok) {
        downloadQueue.emitQueueStatus(event.sender);
        return { ...diskGuard, queue: getQueueStatus() };
      }
      const queueState = downloadQueue.getQueueState();
      if (!queueState.processing && queueState.running.size === 0 && queueState.queued.length === 0) {
        queueState.done = 0;
      }

      const BATCH_LIMIT = 30;
      const alreadyActive = queueState.queued.length + queueState.running.size;
      const available = Math.max(0, BATCH_LIMIT - alreadyActive);
      const incoming = (assets || []).filter(a => a && a.itemId);
      const toAdd = incoming.slice(0, available);
      const skippedCount = incoming.length - toAdd.length;

      for (const asset of toAdd) {
        dbgUpdate(
          'enqueue:incoming',
          `itemId=${asset.itemId}`,
          `forceRedownload=${Boolean(asset.forceRedownload)}`,
          `expected=${String(asset.expectedStableHash || '').slice(0, 12) || '-'}`,
          `files=${Array.isArray(asset.files) ? asset.files.length : 0}`,
        );
        const alreadyQueued = queueState.queued.some(q => String(q.itemId) === String(asset.itemId));
        const runningNow = queueState.running.has(String(asset.itemId));
        if (alreadyQueued || runningNow) continue;
        queueState.queued.push({
          itemId: asset.itemId,
          title: asset.title || '',
          attempt: 0,
          nextRunAt: 0,
          forceRedownload: Boolean(asset.forceRedownload),
          asset: {
            itemId: asset.itemId,
            title: asset.title || '',
            files: asset.files || [],
            forceRedownload: Boolean(asset.forceRedownload),
            analyzeAfterDownload: asset.analyzeAfterDownload !== false,
            expectedStableHash: asset.expectedStableHash ? String(asset.expectedStableHash) : null,
          },
        });
      }
      downloadQueue.emitQueueStatus(event.sender);
      logMgr.appendOperationLog('queue', `キュー追加: ${toAdd.length} 件${skippedCount > 0 ? ` (上限により ${skippedCount} 件スキップ)` : ''}`, { from: 'enqueue-downloads' });
      if (!queueState.paused) downloadQueue.processQueue(event.sender);
      return { ok: true, queue: getQueueStatus(), capped: skippedCount > 0, skippedCount, batchLimit: BATCH_LIMIT };
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('stop-queue', async (event) => {
    if (queueSenderRef) queueSenderRef.value = event.sender;
    downloadQueue.setQueueSender(event.sender);
    const queueState = downloadQueue.getQueueState();
    queueState.paused = true;
    downloadQueue.emitQueueStatus(event.sender);
    return { ok: true, queue: getQueueStatus() };
  });

  handleIpc('resume-queue', async (event) => {
    if (queueSenderRef) queueSenderRef.value = event.sender;
    downloadQueue.setQueueSender(event.sender);
    const queueState = downloadQueue.getQueueState();
    queueState.paused = false;
    downloadQueue.emitQueueStatus(event.sender);
    downloadQueue.processQueue(event.sender);
    return { ok: true, queue: getQueueStatus() };
  });

  handleIpc('retry-failed', async (event) => {
    if (queueSenderRef) queueSenderRef.value = event.sender;
    downloadQueue.setQueueSender(event.sender);
    const queueState = downloadQueue.getQueueState();
    const retryTargets = queueState.failed.splice(0, queueState.failed.length);
    for (const f of retryTargets) {
      queueState.queued.push({
        itemId: f.itemId,
        title: f.title || '',
        attempt: 0,
        nextRunAt: 0,
        asset: f.asset,
        source: 'retry-failed',
      });
    }
    logMgr.appendOperationLog('queue-retry', `失敗再試行: ${retryTargets.length} 件`, { count: retryTargets.length });
    queueState.paused = false;
    downloadQueue.emitQueueStatus(event.sender);
    downloadQueue.processQueue(event.sender);
    return { ok: true, queue: getQueueStatus() };
  });

  // IPC: download a single item immediately
  handleIpc('download-item', async (event, asset) => {
    try {
      const itemId = String(asset?.itemId || '').trim();
      if (!ITEM_ID_INPUT_RE.test(itemId)) return { error: 'invalid_item_id' };
      const title = String(asset?.title || '').trim();
      if (title.length > MAX_ITEM_TITLE_INPUT) return { error: 'invalid_title' };
      const diskGuard = downloadQueue.checkDiskSpaceGuard();
      if (!diskGuard?.ok) return diskGuard;
      await downloadQueue.ensureClientReady();

      await downloadItemFiles(asset, getBoothClient(), getBoothCookies(), (prog) => {
        sendDownloadProgress(event.sender, prog);
      });

      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  handleIpc('open-external-url', async (_event, url) => {
    const s = String(url || '').trim();
    if (!s.startsWith('https://booth.pm/') && !s.startsWith('https://accounts.booth.pm/') && !s.startsWith('https://checkout.booth.pm/') && !/^https:\/\/[a-zA-Z0-9-]+\.booth\.pm\//.test(s)) return { error: 'disallowed_url' };
    await shell.openExternal(s);
    return { ok: true };
  });

  // IPC: open item folder in OS file explorer
  handleIpc('open-item-folder', async (event, itemId, title) => {
    const itemRef = normalizeItemRefInput(itemId, title);
    if (itemRef?.error) return itemRef;
    const itemDir = downloadQueue.buildItemDir(itemRef.itemId, itemRef.title);
    if (!fs.existsSync(itemDir)) return { error: 'folder_not_found' };
    const openErr = await shell.openPath(itemDir);
    if (openErr) return { error: openErr };
    return { ok: true };
  });

  // IPC: open a file under __extracted using OS association
  handleIpc('open-extracted-entry', async (event, itemId, title, relPath) => {
    try {
      const itemRef = normalizeItemRefInput(itemId, title);
      if (itemRef?.error) return itemRef;
      const itemDir = downloadQueue.buildItemDir(itemRef.itemId, itemRef.title);
      const extractedRoot = path.join(itemDir, '__extracted');
      if (!fs.existsSync(extractedRoot)) return { error: '__extracted_not_found' };

      let targetPath;
      try {
        targetPath = safeResolveUnder(extractedRoot, relPath);
      } catch {
        return { error: 'invalid_rel_path' };
      }

      if (!fs.existsSync(targetPath)) return { error: 'file_not_found' };
      const stat = fs.statSync(targetPath);
      if (!stat.isFile()) return { error: 'not_a_file' };

      const openErr = await shell.openPath(targetPath);
      if (openErr) return { error: openErr };
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  // IPC: list files under __extracted for preview modal
  handleIpc('collect-unitypackages', async (_event, assets = []) => {
    const results = [];
    for (const asset of (Array.isArray(assets) ? assets : [])) {
      const itemId = String(asset?.itemId || '').trim();
      const title = String(asset?.title || '').trim();
      if (!itemId) continue;
      const itemDir = downloadQueue.buildItemDir(itemId, title);
      const extractedRoot = path.join(itemDir, '__extracted');
      if (!fs.existsSync(extractedRoot)) continue;
      const stack = [extractedRoot];
      while (stack.length) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const ent of entries) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) { stack.push(full); continue; }
          if (ent.name.toLowerCase().endsWith('.unitypackage')) {
            results.push({ itemId, title, packagePath: full });
          }
        }
      }
    }
    return { ok: true, packages: results };
  });

  handleIpc('list-item-files', async (event, itemId, title) => {
    try {
      const itemRef = normalizeItemRefInput(itemId, title);
      if (itemRef?.error) return itemRef;
      const itemDir = downloadQueue.buildItemDir(itemRef.itemId, itemRef.title);
      const extractedRoot = path.join(itemDir, '__extracted');

      if (!fs.existsSync(extractedRoot)) {
        return { error: '__extracted_not_found' };
      }

      const out = [];
      const stack = [{ dir: extractedRoot, base: '', depth: 0 }];
      let truncated = false;

      while (stack.length > 0) {
        if (out.length >= MAX_LIST_ITEM_FILES) {
          truncated = true;
          break;
        }

        const cur = stack.pop();
        let entries = [];
        try {
          entries = fs.readdirSync(cur.dir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const ent of entries) {
          if (out.length >= MAX_LIST_ITEM_FILES) {
            truncated = true;
            break;
          }

          const relPath = path.join(cur.base, ent.name);
          const fullPath = path.join(cur.dir, ent.name);
          let stat;
          try {
            stat = fs.statSync(fullPath);
          } catch {
            continue;
          }

          const common = {
            name: ent.name,
            relPath: relPath.replace(/\\/g, '/'),
            fullPath,
            size: stat.isFile() ? stat.size : 0,
            mtime: stat.mtimeMs,
          };

          if (ent.isDirectory()) {
            out.push({ ...common, kind: 'dir' });
            if (cur.depth < MAX_LIST_ITEM_DEPTH) {
              stack.push({ dir: fullPath, base: relPath, depth: cur.depth + 1 });
            } else {
              truncated = true;
            }
          } else {
            out.push({ ...common, kind: 'file' });
          }
        }
      }

      return { files: out, truncated, limit: MAX_LIST_ITEM_FILES };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Runtime logs from renderer -> main process log stream
  ipcMain.on('renderer-log', (_event, payload) => {
    if (!isTrustedRendererSender(_event)) return;
    const now = Date.now();
    if (now - rendererLogWindowStartedAt >= 1000) {
      rendererLogWindowStartedAt = now;
      rendererLogWindowCount = 0;
    }
    if (rendererLogWindowCount >= RENDERER_LOG_MAX_EVENTS_PER_SEC) return;
    rendererLogWindowCount += 1;

    const { level = 'log', msg, data } = payload || {};
    const safeMsg = logMgr.sanitizeRendererLogText(msg);
    let safeDataText = '';
    if (typeof data !== 'undefined') {
      try {
        safeDataText = logMgr.sanitizeRendererLogText(JSON.stringify(data));
      } catch {
        safeDataText = logMgr.sanitizeRendererLogText(String(data));
      }
    }
    const line = safeDataText ? `${safeMsg} ${safeDataText}` : safeMsg;
    appendRuntimeLog(level, 'renderer', line);

    if (level === 'error') ORIG_CONSOLE.error('[renderer]', line);
    else if (level === 'warn') ORIG_CONSOLE.warn('[renderer]', line);
    else ORIG_CONSOLE.log('[renderer]', line);
  });

  handleIpc('get-runtime-logs', async () => ({
    ok: true,
    logs: runtimeLogBuffer.slice(-2000),
  }));

  return { isTrustedRendererSender };
}

module.exports = { registerIpcHandlers };
