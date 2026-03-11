/**
 * Universal storage debugging helpers.
 * Work with any Chrome extension's chrome.storage API.
 */

import type { Worker } from '@playwright/test';

export interface StorageDump {
  local: Record<string, unknown>;
  sync: Record<string, unknown>;
  session: Record<string, unknown>;
  localBytesUsed: number;
  syncBytesUsed: number;
}

/**
 * Seed chrome.storage.local with test data.
 */
export async function seedStorage(sw: Worker, data: Record<string, unknown>): Promise<void> {
  await sw.evaluate(async (d: Record<string, unknown>) => {
    await chrome.storage.local.set(d);
  }, data);
}

/**
 * Dump ALL storage areas (local, sync, session) with byte usage.
 */
export async function dumpStorage(sw: Worker): Promise<StorageDump> {
  return sw.evaluate(async () => {
    const local = await chrome.storage.local.get(null);
    const localBytes = await chrome.storage.local.getBytesInUse(null);

    let sync: Record<string, unknown> = {};
    let syncBytes = 0;
    try {
      sync = await chrome.storage.sync.get(null);
      syncBytes = await chrome.storage.sync.getBytesInUse(null);
    } catch {}

    let session: Record<string, unknown> = {};
    try {
      session = await chrome.storage.session.get(null);
    } catch {}

    return {
      local,
      sync,
      session,
      localBytesUsed: localBytes,
      syncBytesUsed: syncBytes,
    };
  });
}

/**
 * Clear all storage areas.
 */
export async function resetStorage(sw: Worker): Promise<void> {
  await sw.evaluate(async () => {
    await chrome.storage.local.clear();
    try { await chrome.storage.sync.clear(); } catch {}
    try { await chrome.storage.session.clear(); } catch {}
  });
}

/**
 * Get specific keys or all keys from chrome.storage.local.
 */
export async function getStorage(
  sw: Worker,
  keys?: string[] | null
): Promise<Record<string, unknown>> {
  return sw.evaluate(async (k: string[] | null) => {
    return chrome.storage.local.get(k);
  }, keys ?? null);
}

/**
 * Watch for storage changes in real-time.
 * Returns a handle with collected changes and a stop function.
 */
export async function watchStorageChanges(sw: Worker): Promise<{
  getChanges: () => Promise<Array<{ area: string; key: string; oldValue: unknown; newValue: unknown }>>;
  stop: () => Promise<void>;
}> {
  // Install a listener in the service worker that buffers changes
  await sw.evaluate(() => {
    (globalThis as any).__storageChanges = [];
    (globalThis as any).__storageListener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      for (const [key, change] of Object.entries(changes)) {
        (globalThis as any).__storageChanges.push({
          area: areaName,
          key,
          oldValue: change.oldValue,
          newValue: change.newValue,
        });
      }
    };
    chrome.storage.onChanged.addListener((globalThis as any).__storageListener);
  });

  return {
    getChanges: async () => {
      try {
        return await sw.evaluate(() => [...((globalThis as any).__storageChanges ?? [])]);
      } catch {
        // SW was terminated - return empty (buffer is lost)
        return [];
      }
    },
    stop: async () => {
      try {
        await sw.evaluate(() => {
          if ((globalThis as any).__storageListener) {
            chrome.storage.onChanged.removeListener((globalThis as any).__storageListener);
          }
          delete (globalThis as any).__storageChanges;
          delete (globalThis as any).__storageListener;
        });
      } catch {
        // SW was terminated - listener is already gone
      }
    },
  };
}
