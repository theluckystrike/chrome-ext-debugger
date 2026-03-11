import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  parseManifest,
  detectExtensionCapabilities,
  findExtensionDir,
  type ManifestV3,
} from '../../src/helpers/manifest-helpers.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
}

function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── parseManifest ──────────────────────────────────────────────

describe('parseManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('parses a valid MV3 manifest', () => {
    const raw = {
      manifest_version: 3,
      name: 'Test Extension',
      version: '1.0.0',
      permissions: ['storage'],
    };
    writeManifest(tmpDir, raw);
    const result = parseManifest(tmpDir);
    expect(result.manifest_version).toBe(3);
    expect(result.name).toBe('Test Extension');
    expect(result.permissions).toEqual(['storage']);
  });

  it('throws when manifest.json is missing', () => {
    expect(() => parseManifest(tmpDir)).toThrow('No manifest.json found');
  });

  it('warns but does not crash for MV2 manifest', () => {
    const raw = {
      manifest_version: 2,
      name: 'Legacy Extension',
      version: '0.1',
    };
    writeManifest(tmpDir, raw);

    // Should log a warning but still return the manifest
    const result = parseManifest(tmpDir);
    expect(result.manifest_version).toBe(2);
    expect(result.name).toBe('Legacy Extension');
  });
});

// ── detectExtensionCapabilities ────────────────────────────────

describe('detectExtensionCapabilities', () => {
  it('detects all capabilities from a full MV3 manifest', () => {
    const manifest: ManifestV3 = {
      manifest_version: 3,
      name: 'Full Extension',
      version: '1.0.0',
      permissions: [
        'storage',
        'alarms',
        'notifications',
        'tabs',
        'contextMenus',
        'webRequest',
        'declarativeNetRequest',
        'offscreen',
      ],
      host_permissions: ['https://*.example.com/*'],
      background: { service_worker: 'background.js', type: 'module' },
      content_scripts: [
        { matches: ['https://*.google.com/*'], js: ['content.js'] },
        { matches: ['https://*.github.com/*'], js: ['inject.js'] },
      ],
      action: { default_popup: 'popup.html' },
      options_ui: { page: 'options.html', open_in_tab: true },
      side_panel: { default_path: 'sidepanel.html' },
      devtools_page: 'devtools.html',
    };

    const caps = detectExtensionCapabilities(manifest);

    expect(caps.hasServiceWorker).toBe(true);
    expect(caps.hasContentScripts).toBe(true);
    expect(caps.hasPopup).toBe(true);
    expect(caps.hasOptionsPage).toBe(true);
    expect(caps.hasSidePanel).toBe(true);
    expect(caps.hasDevtools).toBe(true);
    expect(caps.hasContextMenus).toBe(true);
    expect(caps.hasStorage).toBe(true);
    expect(caps.hasAlarms).toBe(true);
    expect(caps.hasNotifications).toBe(true);
    expect(caps.hasTabs).toBe(true);
    expect(caps.hasWebRequest).toBe(true);
    expect(caps.hasDeclarativeNetRequest).toBe(true);
    expect(caps.hasOffscreen).toBe(true);
    expect(caps.permissions).toEqual(manifest.permissions);
    expect(caps.hostPermissions).toEqual(['https://*.example.com/*']);
    expect(caps.contentScriptMatches).toEqual([
      'https://*.google.com/*',
      'https://*.github.com/*',
    ]);
    expect(caps.serviceWorkerPath).toBe('background.js');
    expect(caps.popupPath).toBe('popup.html');
    expect(caps.optionsPath).toBe('options.html');
    expect(caps.sidePanelPath).toBe('sidepanel.html');
  });

  it('handles a minimal manifest with no permissions, background, or content scripts', () => {
    const manifest: ManifestV3 = {
      manifest_version: 3,
      name: 'Bare Minimum',
      version: '0.0.1',
    };

    const caps = detectExtensionCapabilities(manifest);

    expect(caps.hasServiceWorker).toBe(false);
    expect(caps.hasContentScripts).toBe(false);
    expect(caps.hasPopup).toBe(false);
    expect(caps.hasOptionsPage).toBe(false);
    expect(caps.hasSidePanel).toBe(false);
    expect(caps.hasDevtools).toBe(false);
    expect(caps.hasContextMenus).toBe(false);
    expect(caps.hasStorage).toBe(false);
    expect(caps.hasAlarms).toBe(false);
    expect(caps.hasNotifications).toBe(false);
    expect(caps.hasTabs).toBe(false);
    expect(caps.hasWebRequest).toBe(false);
    expect(caps.hasDeclarativeNetRequest).toBe(false);
    expect(caps.hasOffscreen).toBe(false);
    expect(caps.permissions).toEqual([]);
    expect(caps.hostPermissions).toEqual([]);
    expect(caps.contentScriptMatches).toEqual([]);
    expect(caps.serviceWorkerPath).toBeNull();
    expect(caps.popupPath).toBeNull();
    expect(caps.optionsPath).toBeNull();
    expect(caps.sidePanelPath).toBeNull();
  });

  it('detects popup-only extension', () => {
    const manifest: ManifestV3 = {
      manifest_version: 3,
      name: 'Popup Only',
      version: '1.0',
      action: { default_popup: 'popup.html' },
    };

    const caps = detectExtensionCapabilities(manifest);
    expect(caps.hasPopup).toBe(true);
    expect(caps.popupPath).toBe('popup.html');
    expect(caps.hasServiceWorker).toBe(false);
    expect(caps.hasContentScripts).toBe(false);
  });

  it('detects content-scripts-only extension', () => {
    const manifest: ManifestV3 = {
      manifest_version: 3,
      name: 'Content Scripts Only',
      version: '1.0',
      content_scripts: [
        { matches: ['<all_urls>'], js: ['inject.js'], run_at: 'document_idle' },
      ],
    };

    const caps = detectExtensionCapabilities(manifest);
    expect(caps.hasContentScripts).toBe(true);
    expect(caps.contentScriptMatches).toEqual(['<all_urls>']);
    expect(caps.hasPopup).toBe(false);
    expect(caps.hasServiceWorker).toBe(false);
  });

  it('detects declarativeNetRequest permission', () => {
    const manifest: ManifestV3 = {
      manifest_version: 3,
      name: 'DNR',
      version: '1.0',
      permissions: ['declarativeNetRequest'],
    };
    expect(detectExtensionCapabilities(manifest).hasDeclarativeNetRequest).toBe(true);
  });

  it('detects declarativeNetRequestWithHostAccess permission', () => {
    const manifest: ManifestV3 = {
      manifest_version: 3,
      name: 'DNR Host',
      version: '1.0',
      permissions: ['declarativeNetRequestWithHostAccess'],
    };
    expect(detectExtensionCapabilities(manifest).hasDeclarativeNetRequest).toBe(true);
  });

  it('includes optional_host_permissions in hostPermissions', () => {
    const manifest: ManifestV3 = {
      manifest_version: 3,
      name: 'Optional Hosts',
      version: '1.0',
      host_permissions: ['https://required.com/*'],
      optional_host_permissions: ['https://optional.com/*'],
    } as ManifestV3;

    const caps = detectExtensionCapabilities(manifest);
    expect(caps.hostPermissions).toEqual([
      'https://required.com/*',
      'https://optional.com/*',
    ]);
  });
});

// ── findExtensionDir ───────────────────────────────────────────

describe('findExtensionDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('finds manifest.json in dist/', () => {
    const distDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(distDir);
    writeManifest(distDir, { manifest_version: 3, name: 'Dist', version: '1.0' });

    const result = findExtensionDir(tmpDir);
    expect(result).toBe(distDir);
  });

  it('finds manifest.json in the project root', () => {
    writeManifest(tmpDir, { manifest_version: 3, name: 'Root', version: '1.0' });

    const result = findExtensionDir(tmpDir);
    // root is checked last (candidates: dist, build, out, .), so the resolved path
    // should match the tmpDir itself
    expect(result).toBe(path.resolve(tmpDir));
  });

  it('prefers dist/ over root when both have manifests', () => {
    const distDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(distDir);
    writeManifest(distDir, { manifest_version: 3, name: 'Dist', version: '1.0' });
    writeManifest(tmpDir, { manifest_version: 3, name: 'Root', version: '1.0' });

    const result = findExtensionDir(tmpDir);
    expect(result).toBe(distDir);
  });

  it('throws when no manifest.json is found anywhere', () => {
    expect(() => findExtensionDir(tmpDir)).toThrow(
      /No manifest\.json found/
    );
  });
});
