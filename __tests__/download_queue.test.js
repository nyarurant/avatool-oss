'use strict';

const { createDownloadQueue } = require('../lib/download_queue');

// ---------------------------------------------------------------------------
// テスト用 deps ファクトリ
// ---------------------------------------------------------------------------

function makeDeps(overrides = {}) {
  return {
    fs: {
      existsSync: jest.fn().mockReturnValue(false),
      readdirSync: jest.fn().mockReturnValue([]),
      statSync: jest.fn().mockReturnValue({ size: 0 }),
    },
    path: require('path'),
    os: require('os'),
    axios: { get: jest.fn() },
    cheerio: require('cheerio'),
    getSettings: jest.fn().mockReturnValue({
      downloadPath: '/test/downloads',
      concurrency: 2,
      minFreeSpaceGb: 0,
    }),
    getBoothClient: jest.fn().mockReturnValue(null),
    setBoothClient: jest.fn(),
    getBoothCookies: jest.fn().mockReturnValue(null),
    setBoothCookies: jest.fn(),
    getMainWindow: jest.fn().mockReturnValue(null),
    createClientAndCookies: jest.fn(),
    downloadItemFiles: jest.fn(),
    extractArchivesInItemDir: jest.fn(),
    setZipSafetyConfig: jest.fn(),
    setZipSafetyHooks: jest.fn(),
    normalizeZipMaxEntryBytes: jest.fn().mockReturnValue(512 * 1024 * 1024),
    DEFAULT_SETTINGS: { minFreeSpaceGb: 5, concurrency: 2 },
    boothCookieStore: { readBoothCookiesFromFile: jest.fn(), writeBoothCookiesToFile: jest.fn() },
    dbgUpdate: jest.fn(),
    appendOperationLog: jest.fn(),
    pendingZipOversizeConfirms: new Map(),
    markItemUpdatedInMeta: jest.fn(),
    runAvatarEnrichAfterDownload: jest.fn(),
    BOOTH_LOGIN_PARTITION: 'persist:booth-login',
    session: { fromPartition: jest.fn() },
    runWithBoothCookieLoginFallback: jest.fn(),
    openLoginWindowFlow: jest.fn(),
    getStorageUsageSnapshot: jest.fn().mockReturnValue({ drive: null }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatMiB (internal)
// ---------------------------------------------------------------------------

describe('formatMiB', () => {
  const { _test: { formatMiB } } = createDownloadQueue(makeDeps());

  test('バイト数を MiB に変換してフォーマットする', () => {
    expect(formatMiB(1024 * 1024)).toBe('1.0 MiB');
    expect(formatMiB(1.5 * 1024 * 1024)).toBe('1.5 MiB');
    expect(formatMiB(512 * 1024 * 1024)).toBe('512.0 MiB');
  });

  test('0 バイトは "0.0 MiB"', () => {
    expect(formatMiB(0)).toBe('0.0 MiB');
  });

  test('null / undefined は "0.0 MiB"', () => {
    expect(formatMiB(null)).toBe('0.0 MiB');
    expect(formatMiB(undefined)).toBe('0.0 MiB');
  });

  test('負数は 0 として扱う', () => {
    expect(formatMiB(-1024)).toBe('0.0 MiB');
  });
});

// ---------------------------------------------------------------------------
// isFreeLabelText (internal)
// ---------------------------------------------------------------------------

describe('isFreeLabelText', () => {
  const { _test: { isFreeLabelText } } = createDownloadQueue(makeDeps());

  test('"無料ダウンロード" は true', () => {
    expect(isFreeLabelText('無料ダウンロード')).toBe(true);
    expect(isFreeLabelText('  無料ダウンロード  ')).toBe(true);
  });

  test('"無料" と "ダウンロード" が両方含まれれば true', () => {
    expect(isFreeLabelText('このアイテムは無料でダウンロードできます')).toBe(true);
  });

  test('有料ラベルは false', () => {
    expect(isFreeLabelText('¥500')).toBe(false);
    expect(isFreeLabelText('購入する')).toBe(false);
  });

  test('空文字・null は false', () => {
    expect(isFreeLabelText('')).toBe(false);
    expect(isFreeLabelText(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractVariantToken (internal)
// ---------------------------------------------------------------------------

describe('extractVariantToken', () => {
  const { _test: { extractVariantToken } } = createDownloadQueue(makeDeps());

  test('x.y.z 形式のバージョンを抽出する', () => {
    expect(extractVariantToken('SDK 1.2.3 対応')).toBe('1.2.3');
    expect(extractVariantToken('version 2.0.1')).toBe('2.0.1');
  });

  test('x.y.x / x.x.x 形式も抽出する', () => {
    expect(extractVariantToken('SDK 2.0.x 用')).toBe('2.0.x');
    expect(extractVariantToken('2.x.x 対応パック')).toBe('2.x.x');
  });

  test('v1.4 は抽出する（+ サフィックスは word boundary の都合で除外）', () => {
    expect(extractVariantToken('v1.4対応')).toBe('v1.4');
    // \+?\b: + の後は非単語境界のためバックトラックし 2.0 のみマッチ
    expect(extractVariantToken('SDK 2.0+')).toBe('2.0');
  });

  test('バージョンがなければ空文字', () => {
    expect(extractVariantToken('通常版')).toBe('');
    expect(extractVariantToken('')).toBe('');
    expect(extractVariantToken(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// dedupeDownloadLinks (exported from factory)
// ---------------------------------------------------------------------------

describe('dedupeDownloadLinks', () => {
  const { dedupeDownloadLinks } = createDownloadQueue(makeDeps());

  test('同じ downloadableId + fileName は1件に絞られる', () => {
    const links = [
      { downloadableId: '1', fileName: 'a.zip' },
      { downloadableId: '1', fileName: 'a.zip' },
    ];
    expect(dedupeDownloadLinks(links)).toHaveLength(1);
  });

  test('異なる ID や名前は別件として残る', () => {
    const links = [
      { downloadableId: '1', fileName: 'a.zip' },
      { downloadableId: '2', fileName: 'b.zip' },
    ];
    expect(dedupeDownloadLinks(links)).toHaveLength(2);
  });

  test('variationName は後の値がマージされる', () => {
    const links = [
      { downloadableId: '1', fileName: 'a.zip', variationName: 'first' },
      { downloadableId: '1', fileName: 'a.zip', variationName: 'second' },
    ];
    const result = dedupeDownloadLinks(links);
    expect(result[0].variationName).toBe('second');
  });

  test('downloadableId が空のものはスキップ', () => {
    const links = [
      { downloadableId: '', fileName: 'a.zip' },
      { downloadableId: '1', fileName: 'b.zip' },
    ];
    expect(dedupeDownloadLinks(links)).toHaveLength(1);
  });

  test('fileName が空なら file_{id} がデフォルト', () => {
    const links = [{ downloadableId: '42', fileName: '' }];
    const [result] = dedupeDownloadLinks(links);
    expect(result.fileName).toBe('file_42');
  });

  test('空配列は空配列を返す', () => {
    expect(dedupeDownloadLinks([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractFreeDownloadLinksFromItemJson (internal)
// ---------------------------------------------------------------------------

describe('extractFreeDownloadLinksFromItemJson', () => {
  const { _test: { extractFreeDownloadLinksFromItemJson } } = createDownloadQueue(makeDeps());

  test('price=0 の variation から downloadable_id を取得', () => {
    const payload = {
      variations: [{ price: 0, downloadable_id: '555', name: 'free.zip' }],
    };
    const result = extractFreeDownloadLinksFromItemJson(payload);
    expect(result.some((r) => r.downloadableId === '555')).toBe(true);
  });

  test('price=0 でも downloadable_id がなければ download_url から ID を抽出', () => {
    const payload = {
      variations: [{ price: 0, download_url: '/downloadables/777', name: 'via-url.zip' }],
    };
    const result = extractFreeDownloadLinksFromItemJson(payload);
    expect(result.some((r) => r.downloadableId === '777')).toBe(true);
  });

  test('有料 variation は含まれない', () => {
    const payload = {
      variations: [{ price: 500, downloadable_id: '111', name: 'paid.zip' }],
    };
    expect(extractFreeDownloadLinksFromItemJson(payload)).toHaveLength(0);
  });

  test('price が "0円" 文字列でも無料と判定', () => {
    const payload = {
      variations: [{ price: '0円', downloadable_id: '222', name: 'text-free.zip' }],
    };
    expect(extractFreeDownloadLinksFromItemJson(payload)).toHaveLength(1);
  });

  test('variations がなければ空配列', () => {
    expect(extractFreeDownloadLinksFromItemJson({})).toHaveLength(0);
    expect(extractFreeDownloadLinksFromItemJson(null)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getQueueStatus (exported)
// ---------------------------------------------------------------------------

describe('getQueueStatus', () => {
  test('初期状態は idle', () => {
    const { getQueueStatus } = createDownloadQueue(makeDeps());
    const status = getQueueStatus();
    expect(status.status).toBe('idle');
    expect(status.queued).toBe(0);
    expect(status.running).toEqual([]);
    expect(status.done).toBe(0);
    expect(status.paused).toBe(false);
  });

  test('paused=true のとき status は "paused"', () => {
    const q = createDownloadQueue(makeDeps());
    q.getQueueState().paused = true;
    expect(q.getQueueStatus().status).toBe('paused');
  });

  test('running に要素があるとき status は "running"', () => {
    const q = createDownloadQueue(makeDeps());
    q.getQueueState().running.set('task1', { itemId: '100', title: 'Test', attempt: 1 });
    const status = q.getQueueStatus();
    expect(status.status).toBe('running');
    expect(status.running).toHaveLength(1);
    expect(status.running[0].itemId).toBe('100');
  });

  test('concurrency が設定値を反映する', () => {
    const deps = makeDeps({ getSettings: jest.fn().mockReturnValue({ concurrency: 4, downloadPath: '/d', minFreeSpaceGb: 0 }) });
    const { getQueueStatus } = createDownloadQueue(deps);
    expect(getQueueStatus().concurrency).toBe(4);
  });
});

describe('ensureClientReady', () => {
  test('rebuilds a cached client with an invalid shape', async () => {
    const invalidClient = { client: { get: jest.fn() }, cookies: [] };
    const validClient = { get: jest.fn() };
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(true) },
      getBoothClient: jest.fn().mockReturnValue(invalidClient),
      runWithBoothCookieLoginFallback: jest.fn(async (fn) => await fn()),
      createClientAndCookies: jest.fn().mockResolvedValue({ client: validClient, cookies: [{ name: 'sid' }] }),
    });
    const q = createDownloadQueue(deps);

    await q.ensureClientReady();

    expect(deps.setBoothClient).toHaveBeenNthCalledWith(1, null);
    expect(deps.setBoothCookies).toHaveBeenNthCalledWith(1, null);
    expect(deps.createClientAndCookies).toHaveBeenCalledTimes(1);
    expect(deps.setBoothClient).toHaveBeenLastCalledWith(validClient);
  });

  test('shares an in-flight client initialization across concurrent callers', async () => {
    let resolveFallback;
    const fallbackPromise = new Promise((resolve) => { resolveFallback = resolve; });
    const deps = makeDeps({
      fs: { existsSync: jest.fn().mockReturnValue(true) },
      runWithBoothCookieLoginFallback: jest.fn().mockReturnValue(fallbackPromise),
      createClientAndCookies: jest.fn(),
    });
    const q = createDownloadQueue(deps);

    const first = q.ensureClientReady();
    const second = q.ensureClientReady();
    expect(deps.runWithBoothCookieLoginFallback).toHaveBeenCalledTimes(1);

    resolveFallback({ client: { get: jest.fn() }, cookies: [{ name: 'sid' }] });
    await Promise.all([first, second]);
    expect(deps.setBoothClient).toHaveBeenCalledTimes(1);
    expect(deps.setBoothCookies).toHaveBeenCalledTimes(1);
  });
});

describe('processQueue post-download stability', () => {
  test('meta update errors after a completed download do not mark the item failed', async () => {
    const deps = makeDeps({
      getBoothClient: jest.fn().mockReturnValue({ get: jest.fn() }),
      getBoothCookies: jest.fn().mockReturnValue([]),
      downloadItemFiles: jest.fn().mockResolvedValue(undefined),
      markItemUpdatedInMeta: jest.fn(() => {
        throw new Error('meta_write_failed');
      }),
    });
    const q = createDownloadQueue(deps);
    q.getQueueState().queued.push({
      itemId: '100',
      title: 'Downloaded Item',
      attempt: 1,
      asset: {
        itemId: '100',
        title: 'Downloaded Item',
        files: [{ downloadableId: '1', fileName: 'item.zip' }],
        expectedStableHash: 'stable-hash',
        analyzeAfterDownload: false,
      },
    });

    await q.processQueue();

    expect(deps.downloadItemFiles).toHaveBeenCalledTimes(1);
    expect(q.getQueueStatus().done).toBe(1);
    expect(q.getQueueStatus().failed).toEqual([]);
    expect(deps.appendOperationLog).toHaveBeenCalledWith(
      'queue-post-download-warning',
      expect.stringContaining('meta update failed'),
      expect.objectContaining({ itemId: '100', error: 'meta_write_failed' }),
    );
  });

  test('avatar analysis errors after queue completion do not reject processing', async () => {
    const deps = makeDeps({
      getBoothClient: jest.fn().mockReturnValue({ get: jest.fn() }),
      getBoothCookies: jest.fn().mockReturnValue([]),
      downloadItemFiles: jest.fn().mockResolvedValue(undefined),
      runAvatarEnrichAfterDownload: jest.fn().mockRejectedValue(new Error('avatar_scan_failed')),
    });
    const q = createDownloadQueue(deps);
    q.getQueueState().queued.push({
      itemId: '200',
      title: 'Analyze Item',
      attempt: 1,
      asset: {
        itemId: '200',
        title: 'Analyze Item',
        files: [{ downloadableId: '2', fileName: 'item.zip' }],
      },
    });

    await q.processQueue();

    expect(deps.runAvatarEnrichAfterDownload).toHaveBeenCalledTimes(1);
    expect(q.getQueueStatus().done).toBe(1);
    expect(q.getQueueStatus().failed).toEqual([]);
    expect(q.getQueueStatus().status).toBe('idle');
    expect(deps.appendOperationLog).toHaveBeenCalledWith(
      'queue-post-download-warning',
      'Downloaded item avatar analysis failed after queue completion',
      expect.objectContaining({ itemIds: ['200'], error: 'avatar_scan_failed' }),
    );
  });
});

// ---------------------------------------------------------------------------
// processQueue regression tests
// ---------------------------------------------------------------------------

describe('processQueue regression', () => {
  test('アバター解析中にキューへ追加されたアイテムが処理される', async () => {
    let q;
    const downloadedIds = [];
    const deps = makeDeps({
      getBoothClient: jest.fn().mockReturnValue({ get: jest.fn() }),
      getBoothCookies: jest.fn().mockReturnValue([]),
      downloadItemFiles: jest.fn().mockImplementation(async (asset) => {
        downloadedIds.push(String(asset?.itemId || ''));
      }),
      runAvatarEnrichAfterDownload: jest.fn().mockImplementation(async () => {
        q.getQueueState().queued.push({
          itemId: '999',
          title: 'Added During Enrich',
          attempt: 0,
          nextRunAt: 0,
          asset: { itemId: '999', analyzeAfterDownload: false },
        });
      }),
    });
    q = createDownloadQueue(deps);
    q.getQueueState().queued.push({
      itemId: '100',
      title: 'First Item',
      attempt: 0,
      nextRunAt: 0,
      asset: { itemId: '100' },
    });

    await q.processQueue();

    expect(downloadedIds).toContain('999');
    expect(q.getQueueStatus().done).toBe(2);
    expect(q.getQueueStatus().failed).toEqual([]);
  }, 10000);

  test('非リトライ可能エラーで永久失敗時に phase:failed プログレスを送信する', async () => {
    const sender = { send: jest.fn(), isDestroyed: jest.fn().mockReturnValue(false) };
    const deps = makeDeps({
      getBoothClient: jest.fn().mockReturnValue({ get: jest.fn() }),
      getBoothCookies: jest.fn().mockReturnValue([]),
      getMainWindow: jest.fn().mockReturnValue({ webContents: sender }),
      downloadItemFiles: jest.fn().mockRejectedValue(new Error('network_error')),
    });
    const q = createDownloadQueue(deps);
    q.getQueueState().queued.push({
      itemId: '300',
      title: 'Fail Item',
      attempt: 0,
      nextRunAt: 0,
      asset: { itemId: '300' },
    });

    await q.processQueue();

    const failedProgressCalls = sender.send.mock.calls.filter(
      ([ch, payload]) => ch === 'download-progress' && payload?.phase === 'failed',
    );
    expect(failedProgressCalls).toHaveLength(1);
    expect(failedProgressCalls[0][1].itemId).toBe('300');
    expect(q.getQueueStatus().failed).toHaveLength(1);
  }, 10000);

  test('リトライ上限到達後に phase:failed プログレスを送信する', async () => {
    const sender = { send: jest.fn(), isDestroyed: jest.fn().mockReturnValue(false) };
    const retryableErr = new Error('server_error');
    retryableErr.response = { status: 503 };
    // maxAttempts=1, attempt=1 → 1 < 1 = false → 即座に永久失敗
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({
        downloadPath: '/test/downloads',
        concurrency: 2,
        minFreeSpaceGb: 0,
        downloadRetryMaxAttempts: 1,
      }),
      getBoothClient: jest.fn().mockReturnValue({ get: jest.fn() }),
      getBoothCookies: jest.fn().mockReturnValue([]),
      getMainWindow: jest.fn().mockReturnValue({ webContents: sender }),
      downloadItemFiles: jest.fn().mockRejectedValue(retryableErr),
    });
    const q = createDownloadQueue(deps);
    q.getQueueState().queued.push({
      itemId: '400',
      title: 'Retry Exhausted Item',
      attempt: 1,
      nextRunAt: 0,
      asset: { itemId: '400' },
    });

    await q.processQueue();

    const failedProgressCalls = sender.send.mock.calls.filter(
      ([ch, payload]) => ch === 'download-progress' && payload?.phase === 'failed',
    );
    expect(failedProgressCalls).toHaveLength(1);
    expect(failedProgressCalls[0][1].itemId).toBe('400');
    expect(q.getQueueStatus().failed).toHaveLength(1);
  }, 10000);
});

// ---------------------------------------------------------------------------
// checkDiskSpaceGuard (exported)
// ---------------------------------------------------------------------------

describe('checkDiskSpaceGuard', () => {
  test('minFreeSpaceGb=0 なら guard_disabled を返す', () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ downloadPath: '/d', concurrency: 2, minFreeSpaceGb: 0 }),
    });
    const { checkDiskSpaceGuard } = createDownloadQueue(deps);
    const result = checkDiskSpaceGuard();
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('guard_disabled');
  });

  test('ドライブ空き容量が取得できなければ drive_free_unknown', () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ downloadPath: '/d', concurrency: 2, minFreeSpaceGb: 5 }),
      getStorageUsageSnapshot: jest.fn().mockReturnValue({ drive: null }),
    });
    const { checkDiskSpaceGuard } = createDownloadQueue(deps);
    const result = checkDiskSpaceGuard();
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('drive_free_unknown');
  });

  test('空き容量が閾値以上なら ok=true', () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ downloadPath: '/d', concurrency: 2, minFreeSpaceGb: 5 }),
      getStorageUsageSnapshot: jest.fn().mockReturnValue({
        drive: { freeBytes: 10 * 1024 * 1024 * 1024, mountPath: '/d' }, // 10 GiB
      }),
    });
    const { checkDiskSpaceGuard } = createDownloadQueue(deps);
    const result = checkDiskSpaceGuard();
    expect(result.ok).toBe(true);
    expect(result.freeBytes).toBeGreaterThan(0);
  });

  test('空き容量が閾値未満なら insufficient_disk_space', () => {
    const deps = makeDeps({
      getSettings: jest.fn().mockReturnValue({ downloadPath: '/d', concurrency: 2, minFreeSpaceGb: 10 }),
      getStorageUsageSnapshot: jest.fn().mockReturnValue({
        drive: { freeBytes: 1 * 1024 * 1024 * 1024, mountPath: '/d' }, // 1 GiB < 10 GiB
      }),
    });
    const { checkDiskSpaceGuard } = createDownloadQueue(deps);
    const result = checkDiskSpaceGuard();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('insufficient_disk_space');
  });
});
