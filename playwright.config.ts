/**
 * Default Playwright config for webext-debugger's own tests.
 * When using webext-debugger in your project, the scaffold generator
 * creates a project-specific config.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Extension tests need serial execution
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  reporter: [
    ['html', { open: 'never' }],
    process.env.CI ? ['github'] : ['list'],
  ],
  outputDir: 'test-results/',
  projects: [
    {
      name: 'unit',
      testDir: './tests',
      testIgnore: ['**/e2e/**'],
    },
    {
      name: 'e2e',
      testDir: './tests/e2e',
      timeout: 60_000, // Extension tests need more time to launch Chrome
    },
  ],
});
