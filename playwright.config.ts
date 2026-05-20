import { defineConfig, devices } from '@playwright/test';

const e2ePort = Number(process.env.E2E_PORT ?? 3008);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${e2ePort}`;
const e2eOutputDir = process.env.E2E_OUTPUT_DIR ?? '.output';
const webServerCommand = process.env.CI
  ? `E2E_TEST=1 E2E_OUTPUT_DIR=${e2eOutputDir} pnpm build && pnpm exec vite preview --host localhost --port ${e2ePort} --outDir ${e2eOutputDir}/public`
  : `E2E_TEST=1 pnpm dev --port ${e2ePort}`;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html']],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

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
    command: webServerCommand,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    env: {
      E2E_TEST: '1',
      E2E_PORT: String(e2ePort),
    },
  },
});
