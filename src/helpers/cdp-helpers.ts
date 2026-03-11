/**
 * Chrome DevTools Protocol helpers for advanced debugging.
 * Heap snapshots, performance metrics, network interception.
 */

import type { BrowserContext, CDPSession } from '@playwright/test';

export interface PerfMetrics {
  jsHeapUsedSizeMB: number;
  jsHeapTotalSizeMB: number;
  documents: number;
  frames: number;
  jsEventListeners: number;
  nodes: number;
  layoutCount: number;
  taskDuration: number;
  raw: Record<string, number>;
}

/**
 * Get a CDP session from the browser context.
 */
async function getCDP(context: BrowserContext): Promise<{ cdp: CDPSession; cleanup: () => Promise<void> }> {
  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();
  const cdp = await context.newCDPSession(page);
  return {
    cdp,
    cleanup: async () => { await cdp.detach(); },
  };
}

/**
 * Take a JS heap snapshot and return summary metrics.
 */
export async function takeHeapSnapshot(
  context: BrowserContext
): Promise<{ totalSizeBytes: number; chunks: number }> {
  const { cdp, cleanup } = await getCDP(context);

  try {
    let chunkCount = 0;
    let totalSizeBytes = 0;

    cdp.on('HeapProfiler.addHeapSnapshotChunk', (params: any) => {
      chunkCount++;
      totalSizeBytes += (params.chunk?.length ?? 0);
    });

    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });

    return { totalSizeBytes, chunks: chunkCount };
  } finally {
    await cleanup();
  }
}

/**
 * Get performance metrics via CDP Performance domain.
 *
 * Note: These metrics are for the browser page context. To get extension
 * service worker metrics, use getServiceWorkerMetrics() which attaches
 * to the SW target directly.
 */
export async function getPerformanceMetrics(
  context: BrowserContext
): Promise<PerfMetrics> {
  const { cdp, cleanup } = await getCDP(context);

  try {
    await cdp.send('Performance.enable');
    const { metrics } = await cdp.send('Performance.getMetrics');
    await cdp.send('Performance.disable');

    const raw = Object.fromEntries(metrics.map((m: any) => [m.name, m.value]));

    return {
      jsHeapUsedSizeMB: (raw.JSHeapUsedSize ?? 0) / (1024 * 1024),
      jsHeapTotalSizeMB: (raw.JSHeapTotalSize ?? 0) / (1024 * 1024),
      documents: raw.Documents ?? 0,
      frames: raw.Frames ?? 0,
      jsEventListeners: raw.JSEventListeners ?? 0,
      nodes: raw.Nodes ?? 0,
      layoutCount: raw.LayoutCount ?? 0,
      taskDuration: raw.TaskDuration ?? 0,
      raw,
    };
  } finally {
    await cleanup();
  }
}

/**
 * Get performance metrics from the extension's service worker context.
 * Uses the SW's evaluate() to read performance data from within the SW itself,
 * which gives actual extension memory usage rather than page metrics.
 */
export async function getServiceWorkerMetrics(
  context: BrowserContext
): Promise<{ jsHeapUsedSizeMB: number; jsHeapTotalSizeMB: number } | null> {
  const sws = context.serviceWorkers();
  const sw = sws[0];
  if (!sw) return null;

  try {
    const memInfo = await sw.evaluate(() => {
      // performance.memory is available in Chrome's V8 contexts
      const perf = (performance as any).memory;
      if (!perf) return null;
      return {
        usedJSHeapSize: perf.usedJSHeapSize,
        totalJSHeapSize: perf.totalJSHeapSize,
      };
    });

    if (!memInfo) return null;

    return {
      jsHeapUsedSizeMB: memInfo.usedJSHeapSize / (1024 * 1024),
      jsHeapTotalSizeMB: memInfo.totalJSHeapSize / (1024 * 1024),
    };
  } catch {
    return null;
  }
}

/**
 * Measure how long it takes for the extension's service worker to activate
 * after a cold start (termination + restart).
 *
 * This terminates the existing SW then measures restart time, which gives
 * a meaningful measurement rather than checking an already-running SW.
 */
export async function measureStartupTime(
  context: BrowserContext,
  timeoutMs = 15_000
): Promise<{ startupTimeMs: number; coldStart: boolean }> {
  // Check if SW is already running
  const existingSw = context.serviceWorkers()[0];

  if (existingSw) {
    // Terminate to measure cold start
    const pages = context.pages();
    const page = pages[0] ?? await context.newPage();
    const cdp = await context.newCDPSession(page);
    try {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const swTarget = targetInfos.find(
        (t: any) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://')
      );
      if (swTarget) {
        await cdp.send('Target.closeTarget', { targetId: swTarget.targetId });
      }
    } finally {
      await cdp.detach();
    }
  }

  const start = Date.now();

  // Trigger SW wake by opening a page (SWs restart on events)
  const triggerPage = await context.newPage();
  await triggerPage.goto('chrome://newtab').catch(() => {});

  const sw = await context.waitForEvent('serviceworker', { timeout: timeoutMs });
  await sw.evaluate(() => true); // Ensure it's responsive
  const elapsed = Date.now() - start;

  await triggerPage.close();

  return { startupTimeMs: elapsed, coldStart: !!existingSw };
}
