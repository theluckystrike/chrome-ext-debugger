#!/usr/bin/env tsx
/**
 * Log Collector - aggregates console output from ALL extension contexts
 *
 * Usage: npx tsx src/debug/collect-logs.ts /path/to/extension
 *
 * Listens to: service worker, popup, options page, content scripts (via pages)
 * Press Ctrl+C to stop.
 */

import { chromium } from '@playwright/test';
import path from 'path';
import { parseManifest, detectExtensionCapabilities } from '../helpers/manifest-helpers.js';

const extPath = process.argv[2] || process.env.EXTENSION_PATH;
if (!extPath) {
  console.error('Usage: collect-logs <extension-path>');
  process.exit(1);
}

const resolvedPath = path.resolve(extPath);

function timestamp() {
  return new Date().toISOString().substring(11, 23);
}

function colorize(label: string, type: string, text: string): string {
  const colors: Record<string, string> = {
    error: '\x1b[31m',    // red
    warning: '\x1b[33m',  // yellow
    log: '\x1b[37m',      // white
    info: '\x1b[36m',     // cyan
    debug: '\x1b[90m',    // gray
  };
  const reset = '\x1b[0m';
  const labelColors: Record<string, string> = {
    'SW': '\x1b[35m',       // magenta
    'POPUP': '\x1b[32m',    // green
    'OPTIONS': '\x1b[34m',  // blue
    'PAGE': '\x1b[36m',     // cyan
  };
  const lc = labelColors[label] ?? '\x1b[37m';
  const tc = colors[type] ?? colors.log;
  return `${lc}[${label}]${reset} ${tc}[${type}] ${text}${reset}`;
}

async function main() {
  const manifest = parseManifest(resolvedPath);
  const caps = detectExtensionCapabilities(manifest);

  console.log('╔══════════════════════════════════════════╗');
  console.log('║     Extension Log Collector              ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`Extension: ${manifest.name} v${manifest.version}`);
  console.log('Listening for logs from all contexts... (Ctrl+C to stop)\n');

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${resolvedPath}`,
      `--load-extension=${resolvedPath}`,
      '--no-first-run',
    ],
  });

  // Track all pages for console output
  function attachPageListeners(page: any, label?: string) {
    const getLabel = () => {
      if (label) return label;
      const url = page.url();
      if (url.includes('popup')) return 'POPUP';
      if (url.includes('option')) return 'OPTIONS';
      if (url.includes('sidepanel') || url.includes('side_panel')) return 'SIDEPANEL';
      return 'PAGE';
    };

    page.on('console', (msg: any) => {
      console.log(`[${timestamp()}] ${colorize(getLabel(), msg.type(), msg.text())}`);
    });

    page.on('pageerror', (err: any) => {
      console.log(`[${timestamp()}] ${colorize(getLabel(), 'error', `UNCAUGHT: ${err.message}`)}`);
    });
  }

  // Attach to existing and new pages
  for (const page of context.pages()) {
    attachPageListeners(page);
  }
  context.on('page', (page) => attachPageListeners(page));

  // Attach to service worker console
  if (caps.hasServiceWorker) {
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });

    const extensionId = new URL(sw.url()).hostname;
    console.log(`Extension ID: ${extensionId}\n`);

    sw.on('console', (msg: any) => {
      console.log(`[${timestamp()}] ${colorize('SW', msg.type(), msg.text())}`);
    });

    // Also listen for new service workers (after termination/restart)
    context.on('serviceworker', (newSw) => {
      console.log(`[${timestamp()}] ${colorize('SW', 'info', '*** Service Worker restarted ***')}`);
      newSw.on('console', (msg: any) => {
        console.log(`[${timestamp()}] ${colorize('SW', msg.type(), msg.text())}`);
      });
    });
  }

  // Open popup if available (to capture its logs)
  if (caps.hasPopup) {
    const sw = context.serviceWorkers()[0];
    if (sw) {
      const extId = new URL(sw.url()).hostname;
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extId}/${caps.popupPath}`);
      attachPageListeners(popup, 'POPUP');
    }
  }

  // Keep running until Ctrl+C
  process.on('SIGINT', async () => {
    console.log('\n\nStopping log collector...');
    await context.close();
    process.exit(0);
  });

  await new Promise(() => {}); // Block forever
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
