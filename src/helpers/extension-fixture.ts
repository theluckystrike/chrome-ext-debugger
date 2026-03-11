/**
 * Universal Playwright fixture for Chrome extension testing.
 *
 * Usage in any test file:
 *
 *   import { createExtensionFixture } from 'webext-debugger';
 *   const { test, expect } = createExtensionFixture('/path/to/extension');
 *
 *   test('popup loads', async ({ extensionId, openPage }) => {
 *     const popup = await openPage('popup.html');
 *     await expect(popup.locator('body')).toBeVisible();
 *   });
 *
 * Or via EXTENSION_PATH env var:
 *
 *   EXTENSION_PATH=/path/to/ext npx playwright test
 */

import { test as base, chromium, type BrowserContext, type Worker, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { parseManifest, detectExtensionCapabilities, findExtensionDir, type ExtensionCapabilities, type ManifestV3 } from './manifest-helpers.js';

export interface ExtensionFixtures {
  /** The browser context with the extension loaded */
  context: BrowserContext;
  /** The dynamically discovered extension ID */
  extensionId: string;
  /** The extension's service worker (if it has one) */
  serviceWorker: Worker;
  /** Parsed manifest.json */
  manifest: ManifestV3;
  /** Auto-detected capabilities */
  capabilities: ExtensionCapabilities;
  /** Open an extension page by relative path (e.g., 'popup.html') */
  openPage: (relativePath: string) => Promise<Page>;
  /** Seed chrome.storage.local with data */
  seedStorage: (data: Record<string, unknown>) => Promise<void>;
  /** Get all or specific keys from chrome.storage.local */
  getStorage: (keys?: string[] | null) => Promise<Record<string, unknown>>;
  /** Clear all extension storage */
  resetStorage: () => Promise<void>;
  /** Open a regular webpage (for content script testing) */
  openWebPage: (url: string) => Promise<Page>;
}

/**
 * Create a Playwright test fixture pre-configured for a specific extension.
 *
 * @param extensionPath - Path to the built extension directory containing manifest.json.
 *                        If omitted, reads from EXTENSION_PATH env var, or auto-detects from cwd.
 */
export function createExtensionFixture(extensionPath?: string) {
  const extPath = extensionPath
    ?? process.env.EXTENSION_PATH
    ?? findExtensionDir(process.cwd());

  const resolvedPath = path.resolve(extPath);

  if (!fs.existsSync(path.join(resolvedPath, 'manifest.json'))) {
    throw new Error(
      `No manifest.json found at ${resolvedPath}. ` +
      `Pass the path to your built extension directory.`
    );
  }

  const manifest = parseManifest(resolvedPath);
  const capabilities = detectExtensionCapabilities(manifest);

  const test = base.extend<ExtensionFixtures>({
    context: async ({}, use) => {
      const context = await chromium.launchPersistentContext('', {
        headless: false,
        args: [
          `--disable-extensions-except=${resolvedPath}`,
          `--load-extension=${resolvedPath}`,
          '--no-first-run',
          '--disable-default-apps',
          '--disable-popup-blocking',
          '--disable-search-engine-choice-screen',
        ],
      });
      await use(context);
      await context.close();
    },

    extensionId: async ({ context }, use) => {
      if (capabilities.hasServiceWorker) {
        // Get ID from service worker URL
        let sw = context.serviceWorkers()[0];
        if (!sw) {
          sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
        }
        const id = new URL(sw.url()).hostname;
        await use(id);
      } else {
        // Fallback for extensions without a service worker:
        // Use CDP to enumerate all targets and find the extension
        const page = context.pages()[0] ?? await context.newPage();
        const cdp = await context.newCDPSession(page);
        try {
          const { targetInfos } = await cdp.send('Target.getTargets');
          const extTarget = targetInfos.find(
            (t: any) => t.url?.startsWith('chrome-extension://')
          );
          const id = extTarget
            ? new URL(extTarget.url).hostname
            : '';
          await use(id);
        } finally {
          await cdp.detach();
        }
      }
    },

    serviceWorker: async ({ context }, use) => {
      if (!capabilities.hasServiceWorker) {
        // Create a proxy that gives helpful errors instead of null dereference crashes
        const noSwProxy = new Proxy({} as Worker, {
          get(_, prop) {
            if (prop === 'evaluate') {
              return () => { throw new Error('This extension has no service worker. Cannot call evaluate() - check capabilities.hasServiceWorker first.'); };
            }
            if (typeof prop === 'string') {
              throw new Error(`Cannot access serviceWorker.${prop} - this extension has no service worker (no background.service_worker in manifest.json).`);
            }
            return undefined;
          },
        });
        await use(noSwProxy);
        return;
      }
      let sw = context.serviceWorkers()[0];
      if (!sw) {
        sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
      }
      await use(sw);
    },

    manifest: async ({}, use) => {
      await use(manifest);
    },

    capabilities: async ({}, use) => {
      await use(capabilities);
    },

    openPage: async ({ context, extensionId }, use) => {
      const opener = async (relativePath: string): Promise<Page> => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/${relativePath}`);
        await page.waitForLoadState('domcontentloaded');
        return page;
      };
      await use(opener);
    },

    seedStorage: async ({ serviceWorker }, use) => {
      const seed = async (data: Record<string, unknown>) => {
        if (!serviceWorker) throw new Error('No service worker - cannot seed storage via SW. Extension has no background script.');
        await serviceWorker.evaluate(async (d: Record<string, unknown>) => {
          await chrome.storage.local.set(d);
        }, data);
      };
      await use(seed);
    },

    getStorage: async ({ serviceWorker }, use) => {
      const get = async (keys?: string[] | null): Promise<Record<string, unknown>> => {
        if (!serviceWorker) throw new Error('No service worker - cannot read storage via SW.');
        return serviceWorker.evaluate(async (k: string[] | null) => {
          return chrome.storage.local.get(k);
        }, keys ?? null);
      };
      await use(get);
    },

    resetStorage: async ({ serviceWorker }, use) => {
      const reset = async () => {
        if (!serviceWorker) throw new Error('No service worker - cannot reset storage via SW.');
        await serviceWorker.evaluate(async () => {
          await chrome.storage.local.clear();
          try { await chrome.storage.sync.clear(); } catch {}
          try { await chrome.storage.session.clear(); } catch {}
        });
      };
      await use(reset);
    },

    openWebPage: async ({ context }, use) => {
      const opener = async (url: string): Promise<Page> => {
        const page = await context.newPage();
        await page.goto(url);
        await page.waitForLoadState('domcontentloaded');
        return page;
      };
      await use(opener);
    },
  });

  return { test, expect: test.expect };
}
