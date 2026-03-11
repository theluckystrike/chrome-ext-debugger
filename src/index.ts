/**
 * webext-debugger - Universal Chrome Extension Testing & Debugging Toolkit
 *
 * Point this at ANY Chrome extension directory and get:
 * - Automated E2E tests with Playwright
 * - Service worker lifecycle testing
 * - Content script injection verification
 * - Storage debugging & state management
 * - Performance profiling via CDP
 * - Debug utilities for live inspection
 *
 * Works with any Manifest V3 Chrome extension.
 */

export { createExtensionFixture, type ExtensionFixtures } from './helpers/extension-fixture.js';
export { createTestServer, type TestServer } from './helpers/test-server.js';
export {
  seedStorage,
  dumpStorage,
  resetStorage,
  getStorage,
  watchStorageChanges,
  type StorageDump,
} from './helpers/storage-helpers.js';
export {
  terminateServiceWorker,
  waitForServiceWorkerRestart,
  bounceServiceWorker,
  getServiceWorkerLogs,
  evaluateInServiceWorker,
} from './helpers/service-worker-helpers.js';
export {
  waitForContentScriptReady,
  typeInField,
  getContentScriptStatus,
  getMatchingTabs,
  createTestInputPage,
} from './helpers/content-script-helpers.js';
export {
  takeHeapSnapshot,
  getPerformanceMetrics,
  getServiceWorkerMetrics,
  measureStartupTime,
  type PerfMetrics,
} from './helpers/cdp-helpers.js';
export {
  parseManifest,
  detectExtensionCapabilities,
  findExtensionDir,
  type ManifestV3,
  type ExtensionCapabilities,
} from './helpers/manifest-helpers.js';
