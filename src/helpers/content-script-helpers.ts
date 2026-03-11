/**
 * Content script testing helpers.
 * Verify injection, test DOM effects, simulate user input.
 */

import type { Page, BrowserContext, Worker } from '@playwright/test';

/**
 * Wait for a content script to be injected and ready on a page.
 *
 * Strategy: Content scripts run in an isolated world, so we can't directly
 * detect them. Instead we look for their side effects:
 * 1. A data attribute they set on the document
 * 2. A DOM element they inject
 * 3. Or we ping via message passing
 *
 * @param page - The page to check
 * @param options - Detection strategy options
 */
export async function waitForContentScriptReady(
  page: Page,
  options: {
    /** A CSS selector that the content script adds to the page */
    selector?: string;
    /** A data attribute on documentElement the content script sets */
    dataAttribute?: string;
    /** Max time to wait in ms */
    timeout?: number;
  } = {}
): Promise<boolean> {
  const { selector, dataAttribute, timeout = 5000 } = options;

  if (selector) {
    try {
      await page.waitForSelector(selector, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  if (dataAttribute) {
    try {
      await page.waitForFunction(
        (attr: string) => document.documentElement.hasAttribute(attr),
        dataAttribute,
        { timeout }
      );
      return true;
    } catch {
      return false;
    }
  }

  // Generic fallback: wait for the page to be fully loaded and stable
  // Avoids the anti-pattern of waitForTimeout
  await page.waitForLoadState('networkidle').catch(() => {});
  return true;
}

/**
 * Type text into an input field with realistic timing.
 */
export async function typeInField(
  page: Page,
  selector: string,
  text: string,
  options: { delay?: number; clearFirst?: boolean } = {}
): Promise<void> {
  const { delay = 50, clearFirst = true } = options;

  await page.click(selector);
  if (clearFirst) {
    await page.fill(selector, '');
  }
  await page.type(selector, text, { delay });
}

/**
 * Check if content scripts are injected on a page by attempting
 * to send a message to them via the service worker.
 */
export async function getContentScriptStatus(
  sw: Worker,
  tabId: number
): Promise<{ injected: boolean; error?: string }> {
  return sw.evaluate(async (tid: number) => {
    try {
      await chrome.tabs.sendMessage(tid, { type: '__WEBEXT_DEBUG_PING__' });
      return { injected: true };
    } catch (e: any) {
      const msg = e.message ?? '';
      if (msg.includes('Could not establish connection') ||
          msg.includes('Receiving end does not exist')) {
        return { injected: false, error: 'No content script listener on this tab' };
      }
      if (msg.includes('message port closed')) {
        // CS exists but didn't call sendResponse - still injected
        return { injected: true };
      }
      // Unknown error (tab closed, invalid tab ID, etc.)
      return { injected: false, error: msg };
    }
  }, tabId);
}

/**
 * Get all tabs where content scripts should be active based on manifest matches.
 */
export async function getMatchingTabs(
  sw: Worker,
  contentScriptMatches: string[]
): Promise<Array<{ id: number; url: string; title: string; matched: boolean }>> {
  return sw.evaluate(async (matches: string[]) => {
    const tabs = await chrome.tabs.query({});

    // Convert Chrome match patterns to RegExp for filtering
    function matchPatternToRegex(pattern: string): RegExp | null {
      if (pattern === '<all_urls>') return /^https?:\/\//;
      try {
        const escaped = pattern
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\\\*/g, '.*');
        return new RegExp(`^${escaped}$`);
      } catch { return null; }
    }

    const regexes = matches.map(matchPatternToRegex).filter(Boolean) as RegExp[];

    return tabs
      .filter(t => t.url && t.id)
      .map(t => ({
        id: t.id!,
        url: t.url!,
        title: t.title ?? '',
        matched: regexes.some(rx => rx.test(t.url!)),
      }));
  }, contentScriptMatches);
}

/**
 * Create a test page with standard input elements for content script testing.
 * Returns a page with known selectors to type into.
 */
export async function createTestInputPage(
  context: BrowserContext,
  serverUrl: string
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${serverUrl}/test-input.html`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}
