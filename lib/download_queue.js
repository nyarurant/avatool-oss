'use strict';

const { toFiniteNumber, normalizeRetryAttempts, normalizeRetryBaseDelayMs, sanitizePathSegment, safeResolveUnder } = require('./utils');

/**
 * download_queue.js
 *
 * Factory module for download queue management.
 * Extracted from main.js.
 *
 * Usage:
 *   const queue = createDownloadQueue(deps);
 */

function createDownloadQueue(deps) {
  const {
    fs,
    path,
    os,
    axios,
    cheerio,
    getSettings,
    getBoothClient,
    setBoothClient,
    getBoothCookies,
    setBoothCookies,
    getMainWindow,
    createClientAndCookies,
    downloadItemFiles,
    extractArchivesInItemDir,
    setZipSafetyConfig,
    setZipSafetyHooks,
    normalizeZipMaxEntryBytes,
    DEFAULT_SETTINGS,
    boothCookieStore,
    dbgUpdate,
    appendOperationLog,
    pendingZipOversizeConfirms,
    markItemUpdatedInMeta,
    runAvatarEnrichAfterDownload,
    BOOTH_LOGIN_PARTITION,
    session,
    // These are main.js-level helpers needed by ensureClientReady.
    // They must be injected from main.js.
    runWithBoothCookieLoginFallback,
    openLoginWindowFlow,
    // getStorageUsageSnapshot is kept in main.js; passed as a dep
    // so checkDiskSpaceGuard can call it.
    getStorageUsageSnapshot,
  } = deps;

  // ---------------------------------------------------------------------------
  // Module-local state
  // ---------------------------------------------------------------------------

  const queueState = {
    paused: false,
    processing: false,
    concurrency: Math.max(1, Number(getSettings().concurrency || 2)),
    queued: [],
    running: new Map(),
    done: 0,
    failed: [],
  };

  const DOWNLOAD_PROGRESS_MIN_INTERVAL_MS = 120;
  const throttledDownloadProgressState = new Map();
  let queueSender = null;

  // Managed internally 窶・not exposed directly.
  let zipOversizeConfirmSeq = 0;

  function buildItemDir(itemId, title) {
    const settings = getSettings();
    const safeItemId = sanitizePathSegment(itemId, 'NO_ID');
    const safeName = sanitizePathSegment(title, 'NO_NAME');
    const canonical = path.join(settings.downloadPath, `${safeItemId}_${safeName}`);
    try {
      if (fs.existsSync(canonical)) return canonical;
      if (!fs.existsSync(settings.downloadPath)) return canonical;
      const dirs = fs.readdirSync(settings.downloadPath, { withFileTypes: true })
        .filter((e) => e.isDirectory() && String(e.name || '').startsWith(`${safeItemId}_`));
      if (!dirs.length) return canonical;
      if (dirs.length === 1) return path.join(settings.downloadPath, dirs[0].name);

      // Prefer extracted-ready directory when multiple folders with same itemId exist.
      const withScore = dirs.map((d) => {
        const full = path.join(settings.downloadPath, d.name);
        const flag = path.join(full, '__extracted', '__extracted.flag');
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(full).mtimeMs || 0; } catch {}
        return { full, hasExtractedFlag: fs.existsSync(flag), mtimeMs };
      });
      withScore.sort((a, b) => {
        if (a.hasExtractedFlag !== b.hasExtractedFlag) return a.hasExtractedFlag ? -1 : 1;
        return Number(b.mtimeMs || 0) - Number(a.mtimeMs || 0);
      });
      return withScore[0]?.full || canonical;
    } catch {
      return canonical;
    }
  }

  // ---------------------------------------------------------------------------
  // syncDownloaderRuntimeSettings / formatMiB
  // (from main.js lines 943-956)
  // ---------------------------------------------------------------------------

  function syncDownloaderRuntimeSettings() {
    const settings = getSettings();
    try {
      setZipSafetyConfig({
        maxZipEntryBytes: normalizeZipMaxEntryBytes(settings?.zipMaxEntryBytes, DEFAULT_SETTINGS.zipMaxEntryBytes),
      });
    } catch {
      // ignore
    }
  }

  function formatMiB(bytes) {
    const n = Math.max(0, Number(bytes || 0));
    return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  }

  // ---------------------------------------------------------------------------
  // Zip oversize confirm
  // (from main.js lines 958-994)
  // ---------------------------------------------------------------------------

  async function requestZipOversizeConfirmViaRenderer(payload = {}) {
    const sender = getMainWindow()?.webContents;
    if (!sender || sender.isDestroyed?.()) return false;
    const requestId = `zip-oversize-${Date.now()}-${++zipOversizeConfirmSeq}`;
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingZipOversizeConfirms.delete(requestId);
        resolve(false);
      }, 120000);
      pendingZipOversizeConfirms.set(requestId, {
        resolve: (allow) => {
          clearTimeout(timer);
          resolve(Boolean(allow));
        },
      });
      sender.send('zip-oversize-confirm-request', {
        requestId,
        entryPath: String(payload.entryPath || ''),
        zipPath: String(payload.zipPath || ''),
        entryBytes: Number(payload.entryBytes || 0),
        maxEntryBytes: Number(payload.maxEntryBytes || 0),
      });
    });
  }

  async function confirmOversizeZipEntryContinue(payload = {}) {
    const entryPath = String(payload.entryPath || '').trim();
    const zipPath = String(payload.zipPath || '').trim();
    const entryBytes = Number(payload.entryBytes || 0);
    const maxEntryBytes = Number(payload.maxEntryBytes || 0);
    return await requestZipOversizeConfirmViaRenderer({
      entryPath,
      zipPath,
      entryBytes,
      maxEntryBytes,
    });
  }

  // ---------------------------------------------------------------------------
  // Free download link extraction
  // (from main.js lines 1884-2034)
  // ---------------------------------------------------------------------------

  function dedupeDownloadLinks(links = []) {
    const map = new Map();
    for (const dl of (Array.isArray(links) ? links : [])) {
      const downloadableId = String(dl?.downloadableId || '').trim();
      if (!downloadableId) continue;
      const fileName = String(dl?.fileName || `file_${downloadableId}`).trim() || `file_${downloadableId}`;
      const key = `${downloadableId}:${fileName}`;
      const prev = map.get(key);
      map.set(key, {
        downloadableId,
        fileName,
        variationName: String(dl?.variationName || prev?.variationName || '').trim(),
      });
    }
    return Array.from(map.values());
  }

  function extractDownloadableIdFromHref(href) {
    const m = String(href || '').match(/\/downloadables\/(\d+)/);
    return m ? String(m[1]) : '';
  }

  function isFreePriceText(rawText) {
    const compact = String(rawText || '').replace(/\s+/g, '');
    if (!compact) return false;
    return /^[\\¥￥]?0(?:\.0+)?(?:円)?$/i.test(compact);
  }

  function isFreeLabelText(rawText) {
    const compact = String(rawText || '').replace(/\s+/g, '');
    if (!compact) return false;
    const FREE_DOWNLOAD_LABEL = '\u7121\u6599\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9';
    const FREE_WORD = '\u7121\u6599';
    const DOWNLOAD_WORD = '\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9';
    return compact.includes(FREE_DOWNLOAD_LABEL) || (compact.includes(FREE_WORD) && compact.includes(DOWNLOAD_WORD));
  }

  function extractFreeDownloadLinksFromItemHtml(html) {
    const out = [];
    if (!html) return out;
    const $ = cheerio.load(String(html));
    $('li.variation-item').each((_idx, row) => {
      const $row = $(row);
      const variationName = $row.find('.variation-name').first().text().replace(/\s+/g, ' ').trim();
      const priceText = $row.find('.variation-price').first().text().replace(/\s+/g, ' ').trim();
      const isFreeByPrice = isFreePriceText(priceText);
      $row.find('a[href*="/downloadables/"]').each((_j, a) => {
        const $a = $(a);
        const href = String($a.attr('href') || '').trim();
        const downloadableId = extractDownloadableIdFromHref(href);
        if (!downloadableId) return;
        const label = $a.find('.cmd-label').first().text().replace(/\s+/g, ' ').trim();
        const isFreeByLabel = isFreeLabelText(label);
        if (!(isFreeByLabel || isFreeByPrice)) return;
        const titleName = String($a.attr('title') || '').trim();
        const detailName = $a.find('.text-14').first().text().replace(/\s+/g, ' ').trim();
        const fileName = titleName || detailName || `file_${downloadableId}`;
        out.push({ downloadableId, fileName, variationName });
      });
    });
    return dedupeDownloadLinks(out);
  }

  function extractVariantToken(text) {
    const s = String(text || '').trim();
    if (!s) return '';
    const patterns = [
      /\b\d+\.\d+\.\d+\b/i,       // 1.2.3
      /\b\d+\.\d+\.x\b/i,         // 2.0.x
      /\b\d+\.x\.x\b/i,           // 2.x.x
      /\bv?\d+\.\d+\+?\b/i,       // v1.4 / 2.0+
    ];
    for (const re of patterns) {
      const m = s.match(re);
      if (m) return String(m[0]).toLowerCase();
    }
    return '';
  }

  function extractFreeDownloadLinksFromItemJson(payload) {
    const rows = [];
    const variations = Array.isArray(payload?.variations) ? payload.variations : [];
    for (const v of variations) {
      const priceCandidates = [
        v?.price,
        v?.price_yen,
        v?.price_jpy,
        v?.display_price,
        v?.amount,
      ];
      let isFree = false;
      for (const p of priceCandidates) {
        if (typeof p === 'number' && p === 0) { isFree = true; break; }
        if (typeof p === 'string') {
          if (isFreePriceText(p)) { isFree = true; break; }
        }
      }
      if (!isFree) continue;

      const name = String(v?.name || v?.variation_name || '').trim();
      const downloadableIdCandidates = [
        v?.downloadable_id,
        v?.downloadableId,
        v?.downloadable?.id,
      ].map((x) => String(x || '').trim()).filter(Boolean);

      const urlCandidates = [
        v?.download_url,
        v?.downloadable_url,
        v?.downloadable?.url,
        v?.url,
      ].map((x) => String(x || '').trim()).filter(Boolean);

      for (const u of urlCandidates) {
        const id = extractDownloadableIdFromHref(u);
        if (id) downloadableIdCandidates.push(id);
      }

      const uniqueIds = [...new Set(downloadableIdCandidates)];
      for (const id of uniqueIds) {
        rows.push({
          downloadableId: id,
          fileName: name || `file_${id}`,
          variationName: name,
        });
      }
    }
    return dedupeDownloadLinks(rows);
  }

  async function fetchFreeDownloadLinksForItem(itemId) {
    try {
      const id = String(itemId || '').trim();
      if (!id || !getBoothClient()) return [];
      const boothClient = getBoothClient();
      const htmlRes = await boothClient.get(`/ja/items/${id}`, { responseType: 'text' });
      try {
        const $d = cheerio.load(String(htmlRes?.data || ''));
        dbgUpdate(
          'autoboot:free-links:html-detail',
          `itemId=${id}`,
          `status=${Number(htmlRes?.status || 0)}`,
          `variationItems=${$d('li.variation-item').length}`,
          `downloadAnchors=${$d('a[href*="/downloadables/"]').length}`,
          `freeLabels=${$d('.cmd-label').filter((_i, el) => isFreeLabelText(String($d(el).text() || ''))).length}`,
        );
      } catch {}
      const fromHtml = extractFreeDownloadLinksFromItemHtml(htmlRes?.data || '');
      let links = fromHtml;
      if (!links.length) {
        try {
          const jsonRes = await boothClient.get(`/ja/items/${id}.json`, { responseType: 'json' });
          const fromJson = extractFreeDownloadLinksFromItemJson(jsonRes?.data || {});
          links = fromJson;
          dbgUpdate('autoboot:free-links:fallback-json', `itemId=${id}`, `count=${fromJson.length}`);
        } catch (e) {
          dbgUpdate('autoboot:free-links:fallback-json:error', `itemId=${id}`, e?.message || String(e));
        }
      }
      dbgUpdate('autoboot:free-links', `itemId=${id}`, `html=${fromHtml.length}`, `total=${links.length}`);
      return links;
    } catch {
      dbgUpdate('autoboot:free-links:error', `itemId=${String(itemId || '')}`);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Disk space guard
  // (from main.js lines 3004-3029)
  // ---------------------------------------------------------------------------

  function getMinFreeBytesThreshold() {
    const settings = getSettings();
    const gb = Math.max(0, Number(settings.minFreeSpaceGb ?? DEFAULT_SETTINGS.minFreeSpaceGb));
    return Math.floor(gb * 1024 * 1024 * 1024);
  }

  function checkDiskSpaceGuard() {
    const settings = getSettings();
    const minFreeBytes = getMinFreeBytesThreshold();
    if (minFreeBytes <= 0) {
      return { ok: true, skipped: true, reason: 'guard_disabled' };
    }
    const snap = getStorageUsageSnapshot();
    const freeBytes = Number(snap?.drive?.freeBytes || 0);
    if (!Number.isFinite(freeBytes) || freeBytes <= 0) {
      return { ok: true, skipped: true, reason: 'drive_free_unknown' };
    }
    if (freeBytes < minFreeBytes) {
      return {
        ok: false,
        error: 'insufficient_disk_space',
        freeBytes,
        minFreeBytes,
        mountPath: String(snap?.drive?.mountPath || settings.downloadPath || ''),
      };
    }
    return { ok: true, freeBytes, minFreeBytes, mountPath: String(snap?.drive?.mountPath || settings.downloadPath || '') };
  }

  // ---------------------------------------------------------------------------
  // Queue status / progress emit
  // (from main.js lines 3408-3493)
  // ---------------------------------------------------------------------------

  function getQueueStatus() {
    return {
      status: queueState.paused ? 'paused' : (queueState.running.size > 0 ? 'running' : (queueState.processing ? 'processing' : 'idle')),
      queued: queueState.queued.length,
      running: Array.from(queueState.running.values()).map((t) => ({
        itemId: t.itemId,
        title: t.title,
        attempt: t.attempt,
      })),
      done: queueState.done,
      failed: queueState.failed,
      paused: queueState.paused,
      concurrency: queueState.concurrency,
    };
  }

  function emitQueueStatus(senderOverride) {
    const sender = senderOverride || queueSender || getMainWindow()?.webContents;
    if (!sender || sender.isDestroyed?.()) return;
    sender.send('download-queue', getQueueStatus());
  }

  function appendQueueLog(type, message, meta = null) {
    try {
      appendOperationLog(type, message, meta);
    } catch {
      // Logging must never change queue behavior.
    }
  }

  // ---------------------------------------------------------------------------
  // ensureClientReady
  // (from main.js lines 3587-3604)
  // ---------------------------------------------------------------------------
  let ensureClientReadyInFlight = null;

  function isUsableBoothClient(client) {
    return Boolean(client && typeof client.get === 'function');
  }

  async function ensureClientReady() {
    const existingClient = getBoothClient();
    if (isUsableBoothClient(existingClient)) return;
    if (existingClient) {
      setBoothClient(null);
      setBoothCookies(null);
      dbgUpdate('queue:booth-client-reset', 'reason=invalid_client_shape');
    }
    if (ensureClientReadyInFlight) return await ensureClientReadyInFlight;
    ensureClientReadyInFlight = (async () => {
      const c = await runWithBoothCookieLoginFallback(async () => {
        if (!fs.existsSync(DEFAULT_SETTINGS.cookieFile)) {
          const loginRes = await openLoginWindowFlow();
          if (!loginRes?.ok) {
            const code = String(loginRes?.error || 'login_required');
            const err = new Error(code);
            err.code = code;
            throw err;
          }
        }
        return await createClientAndCookies();
      });
      if (!isUsableBoothClient(c?.client)) throw new Error('booth_client_init_failed');
      setBoothClient(c.client);
      setBoothCookies(c.cookies);
    })();
    try {
      return await ensureClientReadyInFlight;
    } finally {
      ensureClientReadyInFlight = null;
    }
  }

  // ---------------------------------------------------------------------------
  // processQueue
  // (from main.js lines 3606-3731)
  // ---------------------------------------------------------------------------

  async function processQueue(senderOverride) {
    if (queueState.processing) return;
    queueState.processing = true;
    let needsAvatarEnrichAfterDownload = new Set();

    try {
      // Outer loop handles items that arrive during avatar enrichment.
      let continueAfterEnrich = true;
      while (continueAfterEnrich) {
        continueAfterEnrich = false;

        while (!queueState.paused && (queueState.queued.length > 0 || queueState.running.size > 0)) {
          const diskGuard = checkDiskSpaceGuard();
          if (!diskGuard?.ok) {
            queueState.paused = true;
            dbgUpdate(
              'queue:paused:insufficient_disk_space',
              `free=${diskGuard.freeBytes}`,
              `min=${diskGuard.minFreeBytes}`,
              `mount=${diskGuard.mountPath || '-'}`,
            );
            emitQueueStatus(senderOverride);
            break;
          }
          while (
            !queueState.paused &&
            queueState.queued.length > 0 &&
            queueState.running.size < queueState.concurrency
          ) {
            const nowMs = Date.now();
            const idxRunnable = queueState.queued.findIndex((q) => Number(q?.nextRunAt || 0) <= nowMs);
            if (idxRunnable < 0) break;
            const [task] = queueState.queued.splice(idxRunnable, 1);
            dbgUpdate(
              'queue:start',
              `itemId=${task.itemId}`,
              `forceRedownload=${Boolean(task.asset?.forceRedownload)}`,
              `expected=${String(task.asset?.expectedStableHash || '').slice(0, 12) || '-'}`,
              `files=${Array.isArray(task.asset?.files) ? task.asset.files.length : 0}`,
            );
            queueState.running.set(String(task.itemId), task);
            emitQueueStatus(senderOverride);

            (async () => {
              try {
                await ensureClientReady();
                await downloadItemFiles(task.asset, getBoothClient(), getBoothCookies(), (prog) => {
                  const sender = senderOverride || queueSender || getMainWindow()?.webContents;
                  if (sender && !sender.isDestroyed?.()) sendDownloadProgress(sender, prog);
                });

                if (task.asset?.forceRedownload || task.asset?.expectedStableHash) {
                  try {
                    const markRes = markItemUpdatedInMeta(
                      task.itemId,
                      task.asset?.files || [],
                      task.asset?.expectedStableHash || null,
                    );
                    dbgUpdate(
                      'queue:mark-updated',
                      `itemId=${task.itemId}`,
                      `ok=${Boolean(markRes?.ok)}`,
                      `stable=${String(markRes?.stable || '').slice(0, 12) || '-'}`,
                      markRes?.error ? `error=${markRes.error}` : '',
                    );
                    if (markRes && markRes.ok === false) {
                      appendQueueLog('queue-post-download-warning', `Downloaded item meta update skipped: itemId=${task.itemId}`, {
                        itemId: task.itemId,
                        error: markRes.error || 'mark_updated_failed',
                      });
                    }
                  } catch (markErr) {
                    dbgUpdate('queue:mark-updated:error', `itemId=${task.itemId}`, markErr?.message || String(markErr));
                    appendQueueLog('queue-post-download-warning', `Downloaded item meta update failed: itemId=${task.itemId}`, {
                      itemId: task.itemId,
                      error: markErr?.message || String(markErr),
                    });
                  }
                }
                if (task?.asset?.analyzeAfterDownload !== false) {
                  needsAvatarEnrichAfterDownload.add(String(task.itemId || ''));
                }

                queueState.done += 1;
                dbgUpdate('queue:done', `itemId=${task.itemId}`);
              } catch (e) {
                const settings = getSettings();
                dbgUpdate('queue:error', `itemId=${task.itemId}`, e?.message || String(e));
                const statusCode = Number(e?.response?.status || e?.statusCode || 0) || 0;
                const retryable = statusCode === 429 || statusCode >= 500;
                const maxAttempts = normalizeRetryAttempts(settings.downloadRetryMaxAttempts, DEFAULT_SETTINGS.downloadRetryMaxAttempts);
                const currentAttempt = Number(task.attempt || 0);
                if (retryable && currentAttempt < maxAttempts) {
                  const baseMs = normalizeRetryBaseDelayMs(settings.downloadRetryBaseDelayMs, DEFAULT_SETTINGS.downloadRetryBaseDelayMs);
                  const nextAttempt = currentAttempt + 1;
                  const backoffMs = Math.min(120000, baseMs * Math.pow(2, Math.max(0, nextAttempt - 1)));
                  queueState.queued.push({
                    ...task,
                    attempt: nextAttempt,
                    nextRunAt: Date.now() + backoffMs,
                  });
                  appendQueueLog('queue-retry', `Retry scheduled: itemId=${task.itemId} attempt=${nextAttempt}`, {
                    itemId: task.itemId,
                    statusCode,
                    backoffMs,
                  });
                } else {
                  queueState.failed.push({
                    itemId: task.itemId,
                    title: task.title,
                    reason: e?.message || String(e),
                    step: e?.step || 'download',
                    statusCode: e?.response?.status,
                    attempt: task.attempt,
                    asset: task.asset,
                  });
                  // Notify the renderer so the tile UI resets immediately.
                  const failSender = senderOverride || queueSender || getMainWindow()?.webContents;
                  if (failSender && !failSender.isDestroyed?.()) {
                    sendDownloadProgress(failSender, {
                      itemId: task.itemId,
                      phase: 'failed',
                      reason: e?.message || String(e),
                    });
                  }
                }
              } finally {
                queueState.running.delete(String(task.itemId));
                emitQueueStatus(senderOverride);
              }
            })();
          }

          if (queueState.running.size > 0) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          } else if (queueState.queued.length > 0) {
            const nextRunAt = Math.min(...queueState.queued.map((q) => Number(q?.nextRunAt || 0)).filter((n) => Number.isFinite(n)));
            const waitMs = Number.isFinite(nextRunAt) ? Math.max(50, Math.min(1000, nextRunAt - Date.now())) : 120;
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
        }

        if (!queueState.paused && needsAvatarEnrichAfterDownload.size > 0) {
          const enrichIds = Array.from(needsAvatarEnrichAfterDownload);
          try {
            await runAvatarEnrichAfterDownload(new Set(enrichIds), senderOverride);
          } catch (enrichErr) {
            dbgUpdate('queue:avatar-enrich:error', enrichErr?.message || String(enrichErr));
            appendQueueLog('queue-post-download-warning', 'Downloaded item avatar analysis failed after queue completion', {
              itemIds: enrichIds,
              error: enrichErr?.message || String(enrichErr),
            });
          }
          needsAvatarEnrichAfterDownload = new Set();
        }
        // Items queued during enrichment: re-enter the processing loop
        if (!queueState.paused && queueState.queued.length > 0) {
          continueAfterEnrich = true;
        }
      }
    } finally {
      queueState.processing = false;
      emitQueueStatus(senderOverride);
    }
  }

  // ---------------------------------------------------------------------------
  // Download progress throttling
  // ---------------------------------------------------------------------------

  function makeProgressThrottleKey(sender, payload) {
    const sid = Number(sender?.id || 0);
    const itemId = String(payload?.itemId || '');
    return `${sid}:${itemId}`;
  }

  function sendDownloadProgress(sender, payload) {
    if (!sender || sender.isDestroyed?.() || !payload) return;
    const phase = String(payload?.phase || '');
    const status = String(payload?.status || '');
    const hasItemId = String(payload?.itemId || '').trim().length > 0;
    const shouldThrottle = (phase === 'downloading' && status === 'progress' && hasItemId)
      || (phase === 'extracting' && status === 'entry' && hasItemId);
    const key = makeProgressThrottleKey(sender, payload);

    if (!shouldThrottle) {
      const prev = throttledDownloadProgressState.get(key);
      if (prev?.timer) clearTimeout(prev.timer);
      throttledDownloadProgressState.delete(key);
      sender.send('download-progress', payload);
      return;
    }

    const now = Date.now();
    const row = throttledDownloadProgressState.get(key) || {
      lastSentAt: 0,
      pending: null,
      timer: null,
    };
    const elapsed = now - Number(row.lastSentAt || 0);
    if (elapsed >= DOWNLOAD_PROGRESS_MIN_INTERVAL_MS) {
      row.lastSentAt = now;
      row.pending = null;
      if (row.timer) {
        clearTimeout(row.timer);
        row.timer = null;
      }
      throttledDownloadProgressState.set(key, row);
      sender.send('download-progress', payload);
      return;
    }

    row.pending = payload;
    if (!row.timer) {
      const wait = Math.max(10, DOWNLOAD_PROGRESS_MIN_INTERVAL_MS - elapsed);
      row.timer = setTimeout(() => {
        const cur = throttledDownloadProgressState.get(key);
        if (!cur) return;
        if (sender.isDestroyed?.()) {
          throttledDownloadProgressState.delete(key);
          return;
        }
        cur.timer = null;
        const next = cur.pending;
        cur.pending = null;
        cur.lastSentAt = Date.now();
        throttledDownloadProgressState.set(key, cur);
        if (!sender.isDestroyed?.() && next) {
          sender.send('download-progress', next);
        }
      }, wait);
      if (typeof row.timer?.unref === 'function') row.timer.unref();
    }
    throttledDownloadProgressState.set(key, row);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    getQueueState: () => queueState,
    getQueueSender: () => queueSender,
    setQueueSender: (s) => { queueSender = s; },
    getQueueStatus,
    emitQueueStatus,
    processQueue,
    buildItemDir,
    ensureClientReady,
    syncDownloaderRuntimeSettings,
    dedupeDownloadLinks,
    fetchFreeDownloadLinksForItem,
    confirmOversizeZipEntryContinue,
    checkDiskSpaceGuard,
    sendDownloadProgress,
    // テスト用エクスポート (内部純粋関数)
    _test: {
      formatMiB,
      isFreeLabelText,
      extractVariantToken,
      extractFreeDownloadLinksFromItemJson,
      isUsableBoothClient,
    },
  };
}

module.exports = { createDownloadQueue };

