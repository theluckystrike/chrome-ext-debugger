#!/usr/bin/env tsx
/**
 * Extension State Inspector
 *
 * Usage: npx tsx src/debug/inspect-state.ts /path/to/extension
 *        or: EXTENSION_PATH=/path/to/ext npx tsx src/debug/inspect-state.ts
 *
 * Launches Chrome with your extension, dumps ALL state, then exits.
 */

import { chromium } from '@playwright/test';
import path from 'path';
import { parseManifest, detectExtensionCapabilities, findExtensionDir } from '../helpers/manifest-helpers.js';

const extPath = process.argv[2] || process.env.EXTENSION_PATH;
if (!extPath) {
  console.error('Usage: inspect-state <extension-path>');
  console.error('  Or set EXTENSION_PATH env var');
  process.exit(1);
}

const resolvedPath = path.resolve(extPath);

async function main() {
  const manifest = parseManifest(resolvedPath);
  const caps = detectExtensionCapabilities(manifest);

  console.log('╔══════════════════════════════════════════╗');
  console.log('║     Extension State Inspector            ║');
  console.log('╚══════════════════════════════════════════╝\n');

  console.log(`Extension: ${manifest.name} v${manifest.version}`);
  console.log(`Path: ${resolvedPath}`);
  console.log(`Manifest Version: ${manifest.manifest_version}`);
  console.log('\n--- Capabilities ---');
  console.log(`Service Worker: ${caps.hasServiceWorker ? caps.serviceWorkerPath : 'none'}`);
  console.log(`Popup: ${caps.hasPopup ? caps.popupPath : 'none'}`);
  console.log(`Options: ${caps.hasOptionsPage ? caps.optionsPath : 'none'}`);
  console.log(`Side Panel: ${caps.hasSidePanel ? caps.sidePanelPath : 'none'}`);
  console.log(`Content Scripts: ${caps.hasContentScripts ? caps.contentScriptMatches.join(', ') : 'none'}`);
  console.log(`Permissions: ${caps.permissions.join(', ') || 'none'}`);
  console.log(`Host Permissions: ${caps.hostPermissions.join(', ') || 'none'}`);

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${resolvedPath}`,
      `--load-extension=${resolvedPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

  try {
    if (caps.hasServiceWorker) {
      let sw = context.serviceWorkers()[0];
      if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
      const extensionId = new URL(sw.url()).hostname;

      console.log(`\nExtension ID: ${extensionId}`);
      console.log(`Service Worker URL: ${sw.url()}`);

      // Dump storage (only if extension has storage permission)
      if (caps.hasStorage) {
        const hasUnlimited = caps.permissions.includes('unlimitedStorage');
        const storage = await sw.evaluate(async () => {
          const local = await chrome.storage.local.get(null);
          const localBytes = await chrome.storage.local.getBytesInUse(null);
          let sync: any = {}, syncBytes = 0;
          try { sync = await chrome.storage.sync.get(null); syncBytes = await chrome.storage.sync.getBytesInUse(null); } catch {}
          let session: any = {};
          try { session = await chrome.storage.session.get(null); } catch {}
          return { local, localBytes, sync, syncBytes, session };
        });

        console.log('\n--- chrome.storage.local ---');
        if (hasUnlimited) {
          console.log(`Bytes used: ${storage.localBytes} (unlimitedStorage)`);
        } else {
          console.log(`Bytes used: ${storage.localBytes} / 10,485,760 (${((storage.localBytes / 10485760) * 100).toFixed(2)}%)`);
        }
        console.log(JSON.stringify(storage.local, null, 2));

        console.log('\n--- chrome.storage.sync ---');
        console.log(`Bytes used: ${storage.syncBytes} / 102,400 (${((storage.syncBytes / 102400) * 100).toFixed(2)}%)`);
        console.log(JSON.stringify(storage.sync, null, 2));

        console.log('\n--- chrome.storage.session ---');
        console.log(JSON.stringify(storage.session, null, 2));
      } else {
        console.log('\n--- Storage ---');
        console.log('Extension does not have "storage" permission.');
      }

      // List active tabs
      const tabs = await sw.evaluate(async () => {
        try {
          const allTabs = await chrome.tabs.query({});
          return allTabs.map(t => ({
            id: t.id,
            url: t.url?.substring(0, 80),
            status: t.status,
            active: t.active,
          }));
        } catch { return []; }
      });

      console.log('\n--- Active Tabs ---');
      console.log(JSON.stringify(tabs, null, 2));

      // Check alarms
      if (caps.hasAlarms) {
        const alarms = await sw.evaluate(async () => {
          try { return await chrome.alarms.getAll(); } catch { return []; }
        });
        console.log('\n--- Alarms ---');
        console.log(JSON.stringify(alarms, null, 2));
      }
    } else {
      console.log('\nNo service worker - limited inspection available.');
    }
  } finally {
    await context.close();
  }

  console.log('\n✓ Inspection complete');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
