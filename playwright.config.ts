import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3009',
    trace: 'on-first-retry',

    launchOptions: {
      args: [
        '--enable-features=FileSystemAccessAPI',
        '--ignore-gpu-blocklist',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'E2E_TEST=1 pnpm dev',
    url: 'http://localhost:3009',
    reuseExistingServer: !process.env.CI,
    env: {
      E2E_TEST: '1',
    },
  },
});
