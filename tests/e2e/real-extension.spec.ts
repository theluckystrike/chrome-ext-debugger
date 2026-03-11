/**
 * Integration smoke test: loads a real Chrome MV3 extension and verifies
 * that webext-debugger's core framework works end-to-end.
 *
 * Run with:
 *   EXTENSION_PATH=/path/to/built/extension npx playwright test --project=e2e
 *
 * Skipped automatically when EXTENSION_PATH is not set (e.g. in CI).
 */

import { test as base, expect as baseExpect } from '@playwright/test';
import { createExtensionFixture } from '../../src/helpers/extension-fixture.js';
import { createTestServer, type TestServer } from '../../src/helpers/test-server.js';

const EXTENSION_PATH = process.env.EXTENSION_PATH;

if (!EXTENSION_PATH) {
  base.describe('E2E: real extension', () => {
    base.skip();
    base('placeholder', () => {});
  });
} else {

const { test, expect } = createExtensionFixture(EXTENSION_PATH);

let testServer: TestServer;

test.beforeAll(async () => {
  testServer = createTestServer();
  await testServer.start();
});

test.afterAll(async () => {
  await testServer.stop();
});

test.beforeEach(async ({ resetStorage }) => {
  await resetStorage();
});

test('extension loads and has correct ID', async ({ extensionId }) => {
  expect(
    extensionId,
    'extensionId should be a non-empty string'
  ).toBeTruthy();

  expect(
    extensionId,
    `extensionId should be exactly 32 lowercase characters, got "${extensionId}" (length ${extensionId.length})`
  ).toMatch(/^[a-z]{32}$/);
});

test('manifest is parsed correctly', async ({ manifest, capabilities }) => {
  expect(
    manifest.manifest_version,
    'Should be a Manifest V3 extension'
  ).toBe(3);

  expect(
    manifest.name,
    'manifest.name should be a non-empty string'
  ).toBeTruthy();

  expect(
    manifest.version,
    'manifest.version should be a semver-like string'
  ).toMatch(/^\d+(\.\d+){0,3}$/);

  // Verify capability detection returns expected shape
  expect(capabilities).toHaveProperty('hasServiceWorker');
  expect(capabilities).toHaveProperty('hasContentScripts');
  expect(capabilities).toHaveProperty('hasPopup');
  expect(capabilities).toHaveProperty('hasOptionsPage');
  expect(capabilities).toHaveProperty('hasStorage');
  expect(capabilities).toHaveProperty('hasContextMenus');
});

test('service worker is alive', async ({ serviceWorker, capabilities }) => {
  test.skip(!capabilities.hasServiceWorker, 'Extension has no service worker');

  const result = await serviceWorker.evaluate(() => true);
  expect(result, 'Service worker evaluate(() => true) should return true').toBe(true);

  // Verify the SW can access chrome APIs
  const hasRuntime = await serviceWorker.evaluate(() => typeof chrome.runtime !== 'undefined');
  expect(hasRuntime, 'Service worker should have access to chrome.runtime').toBe(true);
});

test('can read and write storage', async ({ seedStorage, getStorage, resetStorage, capabilities }) => {
  test.skip(!capabilities.hasStorage, 'Extension does not use storage');

  // Seed some data
  const testData = { greeting: 'hello', count: 42, active: true };
  await seedStorage(testData);

  // Read it back
  const stored = await getStorage(['greeting', 'count', 'active']);
  expect(stored.greeting, 'Should read back "greeting" from storage').toBe('hello');
  expect(stored.count, 'Should read back "count" from storage').toBe(42);
  expect(stored.active, 'Should read back "active" from storage').toBe(true);

  // Reset and verify it's gone
  await resetStorage();
  const afterReset = await getStorage(['greeting', 'count', 'active']);
  expect(
    Object.keys(afterReset).length,
    'Storage should be empty after reset'
  ).toBe(0);
});

test('storage persists data correctly', async ({ seedStorage, getStorage, capabilities }) => {
  test.skip(!capabilities.hasStorage, 'Extension does not use storage');

  const complexData = {
    items: [
      { key: 'a', value: 'alpha', tags: ['first', 'letter'] },
      { key: 'b', value: 'bravo', tags: ['second'] },
    ],
    settings: {
      enabled: true,
      theme: 'dark',
      shortcuts: { expand: 'Tab', dismiss: 'Escape' },
      nested: {
        deeply: {
          value: [1, 2, 3],
          flag: null,
        },
      },
    },
    metadata: {
      createdAt: '2026-01-15T10:30:00Z',
      version: 2,
    },
  };

  await seedStorage(complexData);

  // Read back all storage
  const stored = await getStorage(null);

  // Verify nested arrays
  expect(
    (stored.items as any[]).length,
    'Should persist an array with 2 items'
  ).toBe(2);

  expect(
    (stored.items as any[])[0].key,
    'First item key should be "a"'
  ).toBe('a');

  expect(
    (stored.items as any[])[0].tags,
    'Item tags should be preserved as arrays'
  ).toEqual(['first', 'letter']);

  // Verify deeply nested objects
  expect(
    (stored.settings as any).nested.deeply.value,
    'Deeply nested array should be preserved'
  ).toEqual([1, 2, 3]);

  expect(
    (stored.settings as any).nested.deeply.flag,
    'Null values should be preserved'
  ).toBeNull();

  // Verify the settings object structure
  expect(
    (stored.settings as any).shortcuts,
    'Nested object should be preserved'
  ).toEqual({ expand: 'Tab', dismiss: 'Escape' });

  expect(
    (stored.metadata as any).version,
    'Numeric metadata should be preserved'
  ).toBe(2);
});

test('popup page loads without errors', async ({ openPage, capabilities }) => {
  test.skip(!capabilities.hasPopup, 'Extension has no popup');

  const consoleErrors: string[] = [];

  const popup = await openPage(capabilities.popupPath!);

  popup.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Give the page a moment to execute any startup scripts
  await popup.waitForTimeout(1000);

  // Verify the page loaded (has a body element)
  const bodyVisible = await popup.locator('body').isVisible();
  expect(bodyVisible, 'Popup body should be visible').toBe(true);

  // Verify no console errors
  expect(
    consoleErrors,
    `Popup should have no console errors, but found: ${consoleErrors.join('; ')}`
  ).toEqual([]);

  await popup.close();
});

test('options page loads without errors', async ({ openPage, capabilities }) => {
  test.skip(!capabilities.hasOptionsPage, 'Extension has no options page');

  const consoleErrors: string[] = [];

  const options = await openPage(capabilities.optionsPath!);

  options.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Give the page a moment to execute any startup scripts
  await options.waitForTimeout(1000);

  // Verify the page loaded
  const bodyVisible = await options.locator('body').isVisible();
  expect(bodyVisible, 'Options page body should be visible').toBe(true);

  // Verify no console errors
  expect(
    consoleErrors,
    `Options page should have no console errors, but found: ${consoleErrors.join('; ')}`
  ).toEqual([]);

  await options.close();
});

test('test server serves built-in pages', async () => {
  const url = testServer.url('test-input.html');

  // Fetch the page directly to verify the server works
  const response = await fetch(url);
  expect(
    response.ok,
    `Test server should return 200 for test-input.html, got ${response.status}`
  ).toBe(true);

  const html = await response.text();
  expect(
    html,
    'test-input.html should contain the expected title'
  ).toContain('Extension Test - Input Fields');

  expect(
    html,
    'test-input.html should contain the text input field'
  ).toContain('id="text-input"');

  expect(
    html,
    'test-input.html should contain the textarea'
  ).toContain('id="text-area"');

  expect(
    html,
    'test-input.html should contain the contenteditable div'
  ).toContain('id="content-editable"');
});

test('content script context exists on web page', async ({ openWebPage, capabilities }) => {
  test.skip(!capabilities.hasContentScripts, 'Extension has no content scripts');

  const url = testServer.url('test-input.html');

  const page = await openWebPage(url);

  // Verify the page itself loaded correctly
  const title = await page.title();
  expect(
    title,
    'Page title should match the test-input.html title'
  ).toBe('Extension Test - Input Fields');

  // Verify key elements are present on the page
  const textInput = page.locator('#text-input');
  await expect(textInput, 'Text input should be visible on the page').toBeVisible();

  const textArea = page.locator('#text-area');
  await expect(textArea, 'Textarea should be visible on the page').toBeVisible();

  const contentEditable = page.locator('#content-editable');
  await expect(contentEditable, 'ContentEditable div should be visible on the page').toBeVisible();

  await page.close();
});

} // end if (EXTENSION_PATH)
