#!/usr/bin/env tsx
/**
 * Message Tracer - monitors all chrome.runtime message passing in real-time
 *
 * Usage: npx tsx src/debug/trace-messages.ts /path/to/extension
 *
 * Uses chrome.runtime.onMessage to intercept messages in the SW context.
 * Unlike monkey-patching addListener (which misses already-registered listeners),
 * this adds our OWN listener that sees all messages before/alongside existing ones.
 *
 * Press Ctrl+C to stop.
 */

import { chromium } from '@playwright/test';
import path from 'path';
import { parseManifest, detectExtensionCapabilities } from '../helpers/manifest-helpers.js';

const extPath = process.argv[2] || process.env.EXTENSION_PATH;
if (!extPath) {
  console.error('Usage: trace-messages <extension-path>');
  process.exit(1);
}

const resolvedPath = path.resolve(extPath);

function timestamp() {
  return new Date().toISOString().substring(11, 23);
}

async function installTracer(sw: any): Promise<void> {
  await sw.evaluate(() => {
    // Buffer for messages to be polled
    (globalThis as any).__messageLog = [];

    // Add our OWN listener - chrome.runtime.onMessage supports multiple listeners.
    // This sees ALL messages sent to the SW, alongside the extension's own listeners.
    chrome.runtime.onMessage.addListener(
      (message: any, sender: any, _sendResponse: any) => {
        const entry = {
          timestamp: Date.now(),
          direction: 'incoming',
          message,
          sender: {
            tab: sender.tab
              ? { id: sender.tab.id, url: sender.tab.url?.substring(0, 80) }
              : null,
            frameId: sender.frameId,
            id: sender.id,
            origin: sender.origin,
          },
        };
        (globalThis as any).__messageLog.push(entry);
        // Don't return true - let the extension's real handler respond
        return false;
      }
    );

    // Also intercept outgoing messages (sendMessage calls FROM the SW)
    const origSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    (chrome.runtime as any).sendMessage = function (msg: any, opts?: any) {
      const entry = {
        timestamp: Date.now(),
        direction: 'outgoing',
        message: msg,
        sender: { tab: null, frameId: null, id: 'background', origin: null },
      };
      (globalThis as any).__messageLog.push(entry);
      return origSendMessage(msg, opts);
    };

    // Intercept tabs.sendMessage (SW -> content script)
    if (chrome.tabs?.sendMessage) {
      const origTabsSend = chrome.tabs.sendMessage.bind(chrome.tabs);
      (chrome.tabs as any).sendMessage = function (tabId: number, msg: any, opts?: any) {
        const entry = {
          timestamp: Date.now(),
          direction: 'to-tab',
          message: msg,
          sender: { tab: { id: tabId, url: null }, frameId: null, id: 'background', origin: null },
        };
        (globalThis as any).__messageLog.push(entry);
        return origTabsSend(tabId, msg, opts);
      };
    }
  });
}

async function main() {
  const manifest = parseManifest(resolvedPath);
  const caps = detectExtensionCapabilities(manifest);

  if (!caps.hasServiceWorker) {
    console.error('This extension has no service worker - message tracing requires one.');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════╗');
  console.log('║     Extension Message Tracer             ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`Extension: ${manifest.name} v${manifest.version}`);
  console.log('Tracing all chrome.runtime messages... (Ctrl+C to stop)\n');

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${resolvedPath}`,
      `--load-extension=${resolvedPath}`,
      '--no-first-run',
    ],
  });

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });

  const extensionId = new URL(sw.url()).hostname;
  console.log(`Extension ID: ${extensionId}\n`);

  // Install the tracer (adds a new listener, doesn't need monkey-patching existing ones)
  await installTracer(sw);
  console.log('Tracer installed. Waiting for messages...\n');

  // Poll for messages and print them
  const pollInterval = setInterval(async () => {
    try {
      const messages = await sw.evaluate(() => {
        const log = (globalThis as any).__messageLog ?? [];
        (globalThis as any).__messageLog = [];
        return log;
      });

      for (const msg of messages) {
        const dirSymbol = msg.direction === 'incoming'
          ? '\x1b[32m<- IN \x1b[0m'
          : msg.direction === 'to-tab'
          ? '\x1b[33m-> TAB\x1b[0m'
          : '\x1b[34m-> OUT\x1b[0m';
        const sender = msg.sender?.tab
          ? `Tab ${msg.sender.tab.id}${msg.sender.tab.url ? ` (${msg.sender.tab.url})` : ''}`
          : msg.sender?.id ?? 'unknown';
        const payload = JSON.stringify(msg.message);
        console.log(`[${timestamp()}] ${dirSymbol} ${sender}: ${payload}`);
      }
    } catch {
      // SW was terminated - wait for restart
    }
  }, 500);

  // Re-install tracer on SW restart
  context.on('serviceworker', async (newSw) => {
    console.log(`\n[${timestamp()}] *** Service Worker restarted - re-installing tracer ***\n`);
    sw = newSw;
    try {
      await installTracer(sw);
    } catch (e: any) {
      console.error(`Failed to re-install tracer: ${e.message}`);
    }
  });

  process.on('SIGINT', async () => {
    clearInterval(pollInterval);
    console.log('\n\nStopping message tracer...');
    await context.close();
    process.exit(0);
  });

  await new Promise(() => {}); // Block forever
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
