/**
 * Manifest parser and extension capability detector.
 * Auto-detects what an extension can do from its manifest.json
 * so tests and debug scripts adapt automatically.
 */

import fs from 'fs';
import path from 'path';

export interface ManifestV3 {
  manifest_version: number;
  name: string;
  version: string;
  description?: string;
  permissions?: string[];
  host_permissions?: string[];
  optional_permissions?: string[];
  background?: {
    service_worker?: string;
    type?: string;
  };
  content_scripts?: Array<{
    matches: string[];
    js?: string[];
    css?: string[];
    run_at?: string;
  }>;
  action?: {
    default_popup?: string;
    default_icon?: Record<string, string> | string;
  };
  options_page?: string;
  options_ui?: {
    page: string;
    open_in_tab?: boolean;
  };
  side_panel?: {
    default_path?: string;
  };
  devtools_page?: string;
  web_accessible_resources?: Array<{
    resources: string[];
    matches: string[];
  }>;
  commands?: Record<string, { suggested_key?: Record<string, string>; description?: string }>;
  content_security_policy?: {
    extension_pages?: string;
  };
  key?: string;
  [key: string]: unknown;
}

export interface ExtensionCapabilities {
  hasServiceWorker: boolean;
  hasContentScripts: boolean;
  hasPopup: boolean;
  hasOptionsPage: boolean;
  hasSidePanel: boolean;
  hasDevtools: boolean;
  hasContextMenus: boolean;
  hasStorage: boolean;
  hasAlarms: boolean;
  hasNotifications: boolean;
  hasTabs: boolean;
  hasWebRequest: boolean;
  hasDeclarativeNetRequest: boolean;
  hasOffscreen: boolean;
  permissions: string[];
  hostPermissions: string[];
  contentScriptMatches: string[];
  serviceWorkerPath: string | null;
  popupPath: string | null;
  optionsPath: string | null;
  sidePanelPath: string | null;
}

/**
 * Parse manifest.json from an extension directory.
 */
export function parseManifest(extensionDir: string): ManifestV3 {
  const manifestPath = path.join(extensionDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest.json found at ${manifestPath}`);
  }
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as ManifestV3;

  if (manifest.manifest_version !== 3) {
    console.warn(`Warning: manifest_version is ${manifest.manifest_version}, expected 3. Some features may not work.`);
  }

  return manifest;
}

/**
 * Auto-detect what the extension can do from its manifest.
 * This drives which tests and debug tools are applicable.
 */
export function detectExtensionCapabilities(manifest: ManifestV3): ExtensionCapabilities {
  const perms = manifest.permissions ?? [];
  const hostPerms = [
    ...(manifest.host_permissions ?? []),
    ...((manifest as any).optional_host_permissions ?? []),
  ];

  const allContentMatches = (manifest.content_scripts ?? [])
    .flatMap(cs => cs.matches);

  return {
    hasServiceWorker: !!manifest.background?.service_worker,
    hasContentScripts: (manifest.content_scripts ?? []).length > 0,
    hasPopup: !!manifest.action?.default_popup,
    hasOptionsPage: !!(manifest.options_page || manifest.options_ui?.page),
    hasSidePanel: !!manifest.side_panel?.default_path,
    hasDevtools: !!manifest.devtools_page,
    hasContextMenus: perms.includes('contextMenus'),
    hasStorage: perms.includes('storage'),
    hasAlarms: perms.includes('alarms'),
    hasNotifications: perms.includes('notifications'),
    hasTabs: perms.includes('tabs'),
    hasWebRequest: perms.includes('webRequest'),
    hasDeclarativeNetRequest: perms.includes('declarativeNetRequest') || perms.includes('declarativeNetRequestWithHostAccess'),
    hasOffscreen: perms.includes('offscreen'),
    permissions: perms,
    hostPermissions: hostPerms,
    contentScriptMatches: allContentMatches,
    serviceWorkerPath: manifest.background?.service_worker ?? null,
    popupPath: manifest.action?.default_popup ?? null,
    optionsPath: manifest.options_ui?.page ?? manifest.options_page ?? null,
    sidePanelPath: manifest.side_panel?.default_path ?? null,
  };
}

/**
 * Find the built extension directory.
 * Checks common build output paths: dist/, build/, out/, or the root itself.
 */
export function findExtensionDir(projectRoot: string): string {
  const candidates = ['dist', 'build', 'out', '.'];
  for (const dir of candidates) {
    const fullPath = path.resolve(projectRoot, dir);
    const manifestPath = path.join(fullPath, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      return fullPath;
    }
  }
  throw new Error(
    `No manifest.json found in ${projectRoot} or its dist/build/out directories. ` +
    `Build the extension first, or pass the extension directory explicitly.`
  );
}
