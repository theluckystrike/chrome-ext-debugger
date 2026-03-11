# chrome-ext-debugger

Automated testing and debugging toolkit for Chrome extensions. Point it at any Manifest V3 extension directory and get a full Playwright-based test suite with storage debugging, service worker lifecycle testing, content script verification, and performance profiling via CDP.

## Features

- **Zero-config extension loading** -- auto-detects `manifest.json` from `dist/`, `build/`, `out/`, or project root
- **Playwright fixtures** -- `extensionId`, `serviceWorker`, `openPage()`, `seedStorage()`, and more, injected into every test
- **Service worker lifecycle testing** -- terminate, restart, and verify state persistence across SW bounces
- **Storage debugging** -- seed, read, dump, reset, and watch `chrome.storage` changes in real time
- **Content script helpers** -- detect injection, simulate typed input, query matching tabs
- **Performance profiling** -- heap snapshots, memory metrics, cold-start timing via CDP
- **Scaffold generator** -- reads your manifest and generates only the tests your extension needs
- **Debug CLI** -- inspect state, profile memory, collect logs, trace message passing from the command line

## Quick Start

### 1. Install

```bash
npm install chrome-ext-debugger
npx playwright install chromium
```

### 2. Scaffold tests for your extension

```bash
npx webext-debug scaffold ./my-extension ./my-extension/tests
```

This reads your `manifest.json` and generates test files for every detected capability (popup, service worker, content scripts, storage, etc.). Files that already exist are never overwritten.

### 3. Run

```bash
cd my-extension/tests
npm install
npx playwright test
```

## API Reference

### `createExtensionFixture(path?)`

Creates a Playwright `test` object with extension-specific fixtures. If `path` is omitted, it reads `EXTENSION_PATH` env var or auto-detects from cwd.

```ts
import { createExtensionFixture } from 'chrome-ext-debugger';

const { test, expect } = createExtensionFixture('/path/to/extension');

test('extension loads', async ({ extensionId, manifest, capabilities }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
  expect(manifest.manifest_version).toBe(3);
  expect(capabilities.hasPopup).toBe(true);
});
```

**Fixtures provided:**

| Fixture | Type | Description |
|---------|------|-------------|
| `context` | `BrowserContext` | Browser context with the extension loaded |
| `extensionId` | `string` | 32-char extension ID, auto-discovered |
| `serviceWorker` | `Worker` | The extension's service worker handle |
| `manifest` | `ManifestV3` | Parsed `manifest.json` |
| `capabilities` | `ExtensionCapabilities` | Auto-detected flags (`hasPopup`, `hasStorage`, etc.) |
| `openPage(path)` | `(string) => Promise<Page>` | Open an extension page (e.g. `'popup.html'`) |
| `openWebPage(url)` | `(string) => Promise<Page>` | Open a regular URL (for content script testing) |
| `seedStorage(data)` | `(object) => Promise<void>` | Write to `chrome.storage.local` |
| `getStorage(keys?)` | `(string[]?) => Promise<object>` | Read from `chrome.storage.local` |
| `resetStorage()` | `() => Promise<void>` | Clear all storage areas (local, sync, session) |

### Storage Helpers

Standalone functions that operate on a service worker handle directly.

```ts
import {
  seedStorage,
  getStorage,
  resetStorage,
  dumpStorage,
  watchStorageChanges,
} from 'chrome-ext-debugger';

// Dump all storage areas with byte usage
const dump = await dumpStorage(serviceWorker);
console.log(dump.local, dump.localBytesUsed);

// Watch changes in real time
const watcher = await watchStorageChanges(serviceWorker);
await seedStorage(serviceWorker, { key: 'value' });
const changes = await watcher.getChanges();
await watcher.stop();
```

### Service Worker Helpers

```ts
import {
  terminateServiceWorker,
  waitForServiceWorkerRestart,
  bounceServiceWorker,
  getServiceWorkerLogs,
  evaluateInServiceWorker,
} from 'chrome-ext-debugger';

// Kill the SW via CDP, then wait for Chrome to restart it
await terminateServiceWorker(context);
const newSw = await waitForServiceWorkerRestart(context);

// Or do both in one call
const newSw = await bounceServiceWorker(context);

// Collect console output
const { logs, stop } = getServiceWorkerLogs(serviceWorker);
// ... do things ...
stop();
console.log(logs); // [{ type: 'log', text: '...', timestamp: ... }]
```

### Content Script Helpers

```ts
import {
  waitForContentScriptReady,
  typeInField,
  getContentScriptStatus,
  getMatchingTabs,
  createTestInputPage,
} from 'chrome-ext-debugger';

// Wait for a content script to inject (by selector or data attribute)
await waitForContentScriptReady(page, { selector: '#my-ext-root' });

// Type with realistic keystroke timing
await typeInField(page, '#text-input', 'hello world', { delay: 50 });

// Check if a content script is listening on a tab
const status = await getContentScriptStatus(serviceWorker, tabId);
console.log(status.injected); // true | false
```

### CDP Helpers

```ts
import {
  takeHeapSnapshot,
  getPerformanceMetrics,
  getServiceWorkerMetrics,
  measureStartupTime,
} from 'chrome-ext-debugger';

// Cold-start timing (terminates SW first, then measures restart)
const { startupTimeMs } = await measureStartupTime(context);

// Page-level performance metrics
const metrics = await getPerformanceMetrics(context);
console.log(metrics.jsHeapUsedSizeMB, metrics.nodes, metrics.jsEventListeners);

// SW-specific memory from inside the worker
const swMetrics = await getServiceWorkerMetrics(context);
```

### Manifest Helpers

```ts
import {
  parseManifest,
  detectExtensionCapabilities,
  findExtensionDir,
} from 'chrome-ext-debugger';

const dir = findExtensionDir(process.cwd()); // checks dist/, build/, out/, .
const manifest = parseManifest(dir);
const caps = detectExtensionCapabilities(manifest);

if (caps.hasServiceWorker) { /* ... */ }
if (caps.hasContentScripts) { /* ... */ }
```

## Debug Commands

Run these against any built extension directory. Each launches a real Chrome instance, loads the extension, and collects data.

```bash
# Dump all extension state: storage contents, active tabs, alarms, permissions
npx webext-debug inspect ./my-extension/dist

# Profile memory usage over time (default or specify seconds)
npx webext-debug memory ./my-extension/dist 60

# Collect console output from all extension contexts (SW, popup, content scripts)
npx webext-debug logs ./my-extension/dist

# Trace chrome.runtime.sendMessage / onMessage traffic
npx webext-debug messages ./my-extension/dist
```

## CLI Reference

```
webext-debug <command> <extension-path> [options]

Commands:
  scaffold <ext-path> [output-dir]  Generate a test suite tailored to the extension
  inspect  <ext-path>               Dump all extension state
  memory   <ext-path> [duration]    Profile memory usage (duration in seconds)
  logs     <ext-path>               Collect console output from all contexts
  messages <ext-path>               Trace chrome.runtime message passing
```

## How It Works

The toolkit uses Playwright's `chromium.launchPersistentContext()` with `--load-extension` and `--disable-extensions-except` flags to launch a real Chrome instance with the extension side-loaded. This is the same mechanism Chrome uses for unpacked extensions.

On launch, `createExtensionFixture` does the following:

1. Finds `manifest.json` in the given path (or auto-detects from `dist/`, `build/`, `out/`)
2. Parses the manifest and detects capabilities (popup, service worker, content scripts, permissions)
3. Launches Chrome with the extension loaded via `launchPersistentContext`
4. Discovers the extension ID from the service worker URL (or via CDP target enumeration as fallback)
5. Provides typed Playwright fixtures (`extensionId`, `serviceWorker`, `openPage`, storage helpers) to every test

The service worker handle comes from Playwright's `context.serviceWorkers()` / `context.waitForEvent('serviceworker')`. Termination uses CDP's `Target.closeTarget`. Storage operations run inside the service worker via `serviceWorker.evaluate()`.

## Requirements

- Node.js 18+
- Chrome or Chromium (installed via `npx playwright install chromium`)
- Manifest V3 extension (V2 will show a warning and may not work fully)

## License

MIT
