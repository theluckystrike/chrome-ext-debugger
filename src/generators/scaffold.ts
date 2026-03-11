#!/usr/bin/env tsx
/**
 * Test Scaffold Generator
 *
 * Reads an extension's manifest.json and generates a tailored test suite.
 * Only creates tests for capabilities the extension actually has.
 *
 * Usage: npx tsx src/generators/scaffold.ts /path/to/extension [output-dir]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseManifest, detectExtensionCapabilities } from '../helpers/manifest-helpers.js';

// Resolve the webext-debugger package root (two levels up from src/generators/)
const __scaffoldFile = fileURLToPath(import.meta.url);
const webextDebuggerRoot = path.resolve(path.dirname(__scaffoldFile), '..', '..');

const extPath = process.argv[2] || process.env.EXTENSION_PATH;
const outputDir = process.argv[3] || path.join(process.cwd(), 'tests');

if (!extPath) {
  console.error('Usage: scaffold <extension-path> [output-dir]');
  process.exit(1);
}

const resolvedPath = path.resolve(extPath);
const manifest = parseManifest(resolvedPath);
const caps = detectExtensionCapabilities(manifest);

console.log(`Scaffolding tests for: ${manifest.name} v${manifest.version}`);
console.log(`Output: ${outputDir}\n`);

function write(relPath: string, content: string) {
  const fullPath = path.join(outputDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  if (fs.existsSync(fullPath)) {
    console.log(`  SKIP ${relPath} (already exists)`);
    return;
  }
  fs.writeFileSync(fullPath, content);
  console.log(`  CREATE ${relPath}`);
}

// --- Playwright config ---
write('playwright.config.ts', `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts'],
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  reporter: [
    ['html', { open: 'never' }],
    process.env.CI ? ['github'] : ['list'],
  ],
  outputDir: '../test-results/',
});
`);

// Compute relative path and normalize to forward slashes (Windows compat)
const relPath = path.relative(outputDir, resolvedPath).split(path.sep).join('/');

// --- Fixture setup ---
write('fixtures.ts', `/**
 * Extension test fixtures - auto-generated for ${manifest.name}
 */
import { createExtensionFixture, createTestServer, type TestServer } from 'webext-debugger';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Point to your built extension (dist/, build/, or root)
const EXTENSION_PATH = process.env.EXTENSION_PATH
  ?? path.resolve(__dirname, '${relPath}');

export const { test, expect } = createExtensionFixture(EXTENSION_PATH);

// Shared test server for content script testing
let _server: TestServer;

export async function getTestServer(): Promise<TestServer> {
  if (!_server) {
    _server = createTestServer();
    await _server.start();
  }
  return _server;
}

export async function stopTestServer(): Promise<void> {
  if (_server) {
    await _server.stop();
  }
}
`);

// --- Smoke test (always generated) ---
write('smoke.spec.ts', `import { test, expect } from './fixtures';

test.describe('Smoke Tests', () => {
  test('extension loads successfully', async ({ extensionId, capabilities }) => {
    expect(extensionId).toBeTruthy();
    expect(extensionId.length).toBe(32);
    console.log('Extension ID:', extensionId);
    console.log('Capabilities:', JSON.stringify(capabilities, null, 2));
  });
${caps.hasServiceWorker ? `
  test('service worker is active', async ({ serviceWorker }) => {
    expect(serviceWorker).toBeTruthy();
    const isAlive = await serviceWorker.evaluate(() => true);
    expect(isAlive).toBe(true);
  });
` : ''}${caps.hasStorage ? `
  test('storage is accessible', async ({ getStorage, seedStorage, resetStorage }) => {
    await resetStorage();
    await seedStorage({ __test: true });
    const data = await getStorage(['__test']);
    expect(data.__test).toBe(true);
    await resetStorage();
  });
` : ''}});
`);

// --- Popup tests ---
if (caps.hasPopup) {
  write('popup.spec.ts', `import { test, expect } from './fixtures';

test.describe('Popup', () => {
  test('popup page loads', async ({ openPage }) => {
    const popup = await openPage('${caps.popupPath}');
    await expect(popup.locator('body')).toBeVisible();
    const title = await popup.title();
    console.log('Popup title:', title);
    await popup.close();
  });

  test('popup has no console errors', async ({ openPage }) => {
    const errors: string[] = [];
    const popup = await openPage('${caps.popupPath}');
    popup.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    // Wait for any async initialization
    await popup.waitForTimeout(2000);
    expect(errors).toEqual([]);
    await popup.close();
  });

  // TODO: Add extension-specific popup tests
  // test('popup shows main UI element', async ({ openPage }) => {
  //   const popup = await openPage('${caps.popupPath}');
  //   await expect(popup.locator('#your-element')).toBeVisible();
  //   await popup.close();
  // });
});
`);
}

// --- Options page tests ---
if (caps.hasOptionsPage) {
  write('options.spec.ts', `import { test, expect } from './fixtures';

test.describe('Options Page', () => {
  test('options page loads', async ({ openPage }) => {
    const options = await openPage('${caps.optionsPath}');
    await expect(options.locator('body')).toBeVisible();
    await options.close();
  });

  test('options page has no console errors', async ({ openPage }) => {
    const errors: string[] = [];
    const options = await openPage('${caps.optionsPath}');
    options.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await options.waitForTimeout(2000);
    expect(errors).toEqual([]);
    await options.close();
  });
});
`);
}

// --- Service worker lifecycle tests ---
if (caps.hasServiceWorker) {
  write('service-worker.spec.ts', `import { test, expect } from './fixtures';
import { terminateServiceWorker, waitForServiceWorkerRestart } from 'webext-debugger';

test.describe('Service Worker Lifecycle', () => {
  test('survives termination and restart', async ({ context, serviceWorker }) => {
    // Verify SW is alive
    const alive = await serviceWorker.evaluate(() => true);
    expect(alive).toBe(true);

    // Kill it
    await terminateServiceWorker(context);

    // Wait for restart
    const newSw = await waitForServiceWorkerRestart(context);
    expect(newSw).toBeTruthy();

    // Verify the new SW is responsive
    const newAlive = await newSw.evaluate(() => true);
    expect(newAlive).toBe(true);
  });
${caps.hasStorage ? `
  test('storage persists across SW restart', async ({ context, seedStorage, getStorage }) => {
    // Seed data
    await seedStorage({ __lifecycle_test: 'persistent_data' });

    // Kill SW
    await terminateServiceWorker(context);
    const newSw = await waitForServiceWorkerRestart(context);

    // Verify data survived
    const data = await newSw.evaluate(async () => {
      return chrome.storage.local.get('__lifecycle_test');
    });
    expect(data.__lifecycle_test).toBe('persistent_data');
  });
` : ''}});
`);
}

// --- Content script tests ---
if (caps.hasContentScripts) {
  write('content-script.spec.ts', `import { test, expect, getTestServer, stopTestServer } from './fixtures';
import type { TestServer } from 'webext-debugger';

let server: TestServer;

test.beforeAll(async () => {
  server = await getTestServer();
});

test.afterAll(async () => {
  await stopTestServer();
});

test.describe('Content Script', () => {
  test('injects on matching pages', async ({ context }) => {
    const page = await context.newPage();
    await page.goto(server.url('test-input.html'));

    // Wait for content script to load
    // TODO: Replace with your extension's specific indicator
    await page.waitForTimeout(2000);

    // Verify the page loaded (content script injection is hard to detect directly)
    await expect(page.locator('#text-input')).toBeVisible();
    await page.close();
  });

  test('works with different input types', async ({ context }) => {
    const page = await context.newPage();
    await page.goto(server.url('test-input.html'));
    await page.waitForTimeout(2000);

    // Test regular input
    await page.fill('#text-input', 'test value');
    expect(await page.inputValue('#text-input')).toBe('test value');

    // Test textarea
    await page.fill('#text-area', 'textarea test');
    expect(await page.inputValue('#text-area')).toBe('textarea test');

    await page.close();
  });
});
`);
}

// --- Storage tests ---
if (caps.hasStorage) {
  write('storage.spec.ts', `import { test, expect } from './fixtures';
import { dumpStorage, watchStorageChanges } from 'webext-debugger';

test.describe('Storage', () => {
  test.beforeEach(async ({ resetStorage }) => {
    await resetStorage();
  });

  test('read and write to local storage', async ({ seedStorage, getStorage }) => {
    await seedStorage({ key1: 'value1', key2: { nested: true } });
    const data = await getStorage(['key1', 'key2']);
    expect(data.key1).toBe('value1');
    expect(data.key2).toEqual({ nested: true });
  });

  test('storage change events fire correctly', async ({ serviceWorker, seedStorage }) => {
    const watcher = await watchStorageChanges(serviceWorker);

    await seedStorage({ watched_key: 'initial' });
    await seedStorage({ watched_key: 'updated' });

    // Small delay for events to propagate
    await new Promise(r => setTimeout(r, 200));

    const changes = await watcher.getChanges();
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes.some(c => c.key === 'watched_key')).toBe(true);

    await watcher.stop();
  });

  test('dump all storage areas', async ({ serviceWorker, seedStorage }) => {
    await seedStorage({ dump_test: true });
    const dump = await dumpStorage(serviceWorker);
    expect(dump.local.dump_test).toBe(true);
    expect(dump.localBytesUsed).toBeGreaterThan(0);
    console.log('Storage dump:', JSON.stringify(dump, null, 2));
  });
});
`);
}

// --- Performance tests ---
write('performance.spec.ts', `import { test, expect } from './fixtures';
import { getPerformanceMetrics, measureStartupTime } from 'webext-debugger';

test.describe('Performance', () => {
  test('startup time is acceptable', async ({ context }) => {
    const { startupTimeMs } = await measureStartupTime(context);
    console.log(\`Startup time: \${startupTimeMs}ms\`);
    expect(startupTimeMs).toBeLessThan(5000); // 5s max
  });

  test('memory usage is reasonable', async ({ context }) => {
    const metrics = await getPerformanceMetrics(context);
    console.log(\`Heap used: \${metrics.jsHeapUsedSizeMB.toFixed(2)} MB\`);
    console.log(\`DOM nodes: \${metrics.nodes}\`);
    console.log(\`Event listeners: \${metrics.jsEventListeners}\`);
    expect(metrics.jsHeapUsedSizeMB).toBeLessThan(100); // 100MB max
  });
});
`);

// --- package.json with local dependency links ---
const packageJsonPath = path.join(outputDir, 'package.json');
if (!fs.existsSync(packageJsonPath)) {
  const pkgJson = {
    name: `${manifest.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-e2e-tests`,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      test: 'npx playwright test',
      'test:headed': 'npx playwright test --headed',
    },
    dependencies: {
      'webext-debugger': `file:${webextDebuggerRoot}`,
      '@playwright/test': '^1.50.0',
    },
  };
  write('package.json', JSON.stringify(pkgJson, null, 2) + '\n');
} else {
  console.log(`  SKIP package.json (already exists)`);
}

// --- .gitignore for test artifacts ---
write('.gitignore', `node_modules/
test-results/
playwright-report/
blob-report/
`);

console.log(`\n✓ Scaffolding complete!`);
console.log(`\nGenerated tests based on detected capabilities:`);
console.log(`  Service Worker: ${caps.hasServiceWorker}`);
console.log(`  Popup: ${caps.hasPopup}`);
console.log(`  Options Page: ${caps.hasOptionsPage}`);
console.log(`  Content Scripts: ${caps.hasContentScripts}`);
console.log(`  Storage: ${caps.hasStorage}`);
console.log(`  Context Menus: ${caps.hasContextMenus}`);
console.log(`\nNext steps:`);
console.log(`  1. cd ${outputDir}`);
console.log(`  2. npm install`);
console.log(`  3. npx playwright install chromium`);
console.log(`  4. npx playwright test`);
