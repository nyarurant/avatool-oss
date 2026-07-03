'use strict';

const { createSchedulerService } = require('../lib/scheduler_service');

function normalizeConcurrency(value) {
  const n = Math.trunc(Number(value) || 2);
  return Math.max(1, Math.min(4, n));
}

function normalizeSchedulerProfile(value) {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'light' || s === 'fast' || s === 'balanced') return s;
  return 'balanced';
}

function makeDeps(settingsOverrides = {}) {
  const queueState = { concurrency: 2, paused: false };
  const settings = {
    downloadSchedulerEnabled: true,
    downloadSchedulerProfile: 'light',
    downloadSchedulerStartHour: 0,
    downloadSchedulerEndHour: 23,
    concurrency: 4,
    ...settingsOverrides,
  };
  return {
    getSettings: jest.fn().mockReturnValue(settings),
    getMainWindow: jest.fn().mockReturnValue(null),
    normalizeConcurrency,
    normalizeSchedulerProfile,
    loadOrGenerateMeta: jest.fn().mockResolvedValue([]),
    generateLibraryMeta: jest.fn().mockResolvedValue([]),
    applyVersionTrackingKeepingManual: jest.fn(),
    writeMetaFile: jest.fn(),
    setMetaCache: jest.fn(),
    showDesktopNotification: jest.fn(),
    appendOperationLog: jest.fn(),
    processQueue: jest.fn(),
    dedupeMetaItemsByItemId: jest.fn((x) => x),
    queueMgr: { getQueueState: () => queueState },
    checkForAppUpdate: jest.fn(),
    getElectronAutoUpdater: jest.fn().mockReturnValue(null),
    APP_UPDATE_AUTO_CHECK_INTERVAL_MIN: 60,
  };
}

// ---------------------------------------------------------------------------
// maybeRunScheduledDownloads: concurrency restore
// ---------------------------------------------------------------------------
// Regression: applySchedulerProfileToConcurrency() overwrote the global queue
// concurrency for the scheduled window, but nothing ever restored the user's
// configured value once the window closed (or the scheduler was disabled),
// silently degrading manual-download throughput for the rest of the day.
describe('maybeRunScheduledDownloads concurrency handling', () => {
  test('window内ではプロファイルの同時実行数を適用する（light=1）', async () => {
    // start===end is treated as "always within window" by isWithinHourWindow,
    // so this is deterministic regardless of the hour the test runs at.
    const deps = makeDeps({ downloadSchedulerStartHour: 0, downloadSchedulerEndHour: 0 });
    const { maybeRunScheduledDownloads } = createSchedulerService(deps);
    await maybeRunScheduledDownloads();
    expect(deps.queueMgr.getQueueState().concurrency).toBe(1);
  });

  test('window外なら設定値の同時実行数に戻す', async () => {
    const currentHour = new Date().getHours();
    const startHour = (currentHour + 1) % 24;
    const endHour = (currentHour + 2) % 24;
    const deps = makeDeps({ downloadSchedulerStartHour: startHour, downloadSchedulerEndHour: endHour, concurrency: 4 });
    const { maybeRunScheduledDownloads, applySchedulerProfileToConcurrency } = createSchedulerService(deps);
    // Simulate a stale value left over from a previous scheduled window.
    applySchedulerProfileToConcurrency();
    expect(deps.queueMgr.getQueueState().concurrency).toBe(1);

    await maybeRunScheduledDownloads();
    expect(deps.queueMgr.getQueueState().concurrency).toBe(4);
  });

  test('スケジューラ無効時は設定値の同時実行数に戻す', async () => {
    const deps = makeDeps({ downloadSchedulerEnabled: false, concurrency: 4 });
    deps.queueMgr.getQueueState().concurrency = 1; // left over from a previous scheduled run
    const { maybeRunScheduledDownloads } = createSchedulerService(deps);
    await maybeRunScheduledDownloads();
    expect(deps.queueMgr.getQueueState().concurrency).toBe(4);
  });
});
