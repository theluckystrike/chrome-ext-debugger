/**
 * Service worker lifecycle helpers.
 * Test termination, restart, and state persistence for any MV3 extension.
 */

import type { BrowserContext, Worker } from '@playwright/test';

/**
 * Force-terminate the extension's service worker via CDP.
 * Critical for testing MV3 resilience - the SW can be killed at any time.
 */
export async function terminateServiceWorker(context: BrowserContext): Promise<void> {
  // We need a page to create a CDP session from
  const pages = context.pages();
  let createdPage = false;
  let page = pages[0];
  if (!page) {
    page = await context.newPage();
    createdPage = true;
  }
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
    if (createdPage) await page.close();
  }
}

/**
 * Wait for the service worker to restart after termination.
 * Returns the new Worker handle.
 */
export async function waitForServiceWorkerRestart(
  context: BrowserContext,
  timeoutMs = 15_000
): Promise<Worker> {
  return context.waitForEvent('serviceworker', { timeout: timeoutMs });
}

/**
 * Terminate the SW and wait for it to come back. Returns the new Worker.
 */
export async function bounceServiceWorker(
  context: BrowserContext,
  timeoutMs = 15_000
): Promise<Worker> {
  await terminateServiceWorker(context);

  // Small delay to ensure the old SW entry is cleared
  await new Promise(r => setTimeout(r, 200));

  // Check if SW already restarted
  const sws = context.serviceWorkers();
  if (sws.length > 0) return sws[0];

  // SW needs a trigger to restart. Extension pages or matching URLs work.
  // Navigate to an http page so content scripts can trigger, or open extension page.
  // Opening any page usually triggers the SW to wake up for the onInstalled/onStartup path.
  const page = await context.newPage();
  await page.goto('about:blank').catch(() => {});
  await page.close();

  return waitForServiceWorkerRestart(context, timeoutMs);
}

/**
 * Collect console logs from the service worker.
 * Returns a handle to read collected logs.
 */
export function getServiceWorkerLogs(sw: Worker): {
  logs: Array<{ type: string; text: string; timestamp: number }>;
  stop: () => void;
} {
  const logs: Array<{ type: string; text: string; timestamp: number }> = [];

  const handler = (msg: any) => {
    logs.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now(),
    });
  };

  sw.on('console', handler);

  return {
    logs,
    stop: () => sw.off('console', handler),
  };
}

/**
 * Evaluate code in the service worker context.
 * Convenience wrapper with error handling.
 */
export async function evaluateInServiceWorker<T>(
  sw: Worker,
  fn: ((arg: any) => T | Promise<T>) | (() => T | Promise<T>),
  arg?: any
): Promise<T> {
  if (arg !== undefined) {
    return sw.evaluate(fn as (arg: any) => T | Promise<T>, arg);
  }
  return sw.evaluate(fn as () => T | Promise<T>);
}
