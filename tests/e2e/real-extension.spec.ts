/**
 * Integration smoke test: loads a real Chrome extension (text-expander-pro)
 * and verifies that webext-debugger's core framework works end-to-end.
 *
 * This is the proof that webext-debugger actually works in practice.
 */

import { createExtensionFixture } from '../../src/helpers/extension-fixture.js';
import { createTestServer, type TestServer } from '../../src/helpers/test-server.js';

const EXTENSION_PATH = '/Users/mike/text-expander-pro/dist';

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
  // The extension uses i18n for name, so manifest.name is the raw __MSG_ token
  expect(
    manifest.name,
    'manifest.name should be the i18n message token'
  ).toBe('__MSG_extensionName__');

  expect(
    manifest.version,
    'manifest.version should be a semver-like string'
  ).toMatch(/^\d+\.\d+\.\d+$/);

  expect(
    manifest.manifest_version,
    'Should be a Manifest V3 extension'
  ).toBe(3);

  // Verify capability detection
  expect(capabilities.hasServiceWorker, 'Should detect service worker').toBe(true);
  expect(capabilities.hasContentScripts, 'Should detect content scripts').toBe(true);
  expect(capabilities.hasPopup, 'Should detect popup').toBe(true);
  expect(capabilities.hasOptionsPage, 'Should detect options page').toBe(true);
  expect(capabilities.hasStorage, 'Should detect storage permission').toBe(true);
  expect(capabilities.hasContextMenus, 'Should detect contextMenus permission').toBe(true);

  // Verify paths were extracted
  expect(
    capabilities.serviceWorkerPath,
    'Should extract service worker path from manifest'
  ).toBeTruthy();

  expect(
    capabilities.popupPath,
    'Should extract popup path from manifest'
  ).toBe('src/popup/popup.html');

  expect(
    capabilities.optionsPath,
    'Should extract options page path from manifest'
  ).toBe('src/options/options.html');

  // Verify host permissions and content script matches
  expect(
    capabilities.hostPermissions,
    'Should include <all_urls> host permission'
  ).toContain('<all_urls>');

  expect(
    capabilities.contentScriptMatches,
    'Content scripts should match <all_urls>'
  ).toContain('<all_urls>');
});

test('service worker is alive', async ({ serviceWorker }) => {
  const result = await serviceWorker.evaluate(() => true);
  expect(result, 'Service worker evaluate(() => true) should return true').toBe(true);

  // Verify the SW can access chrome APIs
  const hasRuntime = await serviceWorker.evaluate(() => typeof chrome.runtime !== 'undefined');
  expect(hasRuntime, 'Service worker should have access to chrome.runtime').toBe(true);

  const hasStorage = await serviceWorker.evaluate(() => typeof chrome.storage !== 'undefined');
  expect(hasStorage, 'Service worker should have access to chrome.storage').toBe(true);
});

test('can read and write storage', async ({ seedStorage, getStorage, resetStorage }) => {
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

test('storage persists data correctly', async ({ seedStorage, getStorage }) => {
  const complexData = {
    snippets: [
      { trigger: ':sig', expansion: 'Best regards,\nJohn Doe', tags: ['email', 'signature'] },
      { trigger: ':addr', expansion: '123 Main St\nAnytown, USA', tags: ['address'] },
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
    (stored.snippets as any[]).length,
    'Should persist an array with 2 snippets'
  ).toBe(2);

  expect(
    (stored.snippets as any[])[0].trigger,
    'First snippet trigger should be ":sig"'
  ).toBe(':sig');

  expect(
    (stored.snippets as any[])[0].tags,
    'Snippet tags should be preserved as arrays'
  ).toEqual(['email', 'signature']);

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

test('popup page loads without errors', async ({ openPage }) => {
  const consoleErrors: string[] = [];

  const popup = await openPage('src/popup/popup.html');

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

test('options page loads without errors', async ({ openPage }) => {
  const consoleErrors: string[] = [];

  const options = await openPage('src/options/options.html');

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

test('content script context exists on web page', async ({ openWebPage }) => {
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
