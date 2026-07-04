import { defineConfig, devices } from '@playwright/test';

const e2eHost = process.env.E2E_HOST ?? '127.0.0.1';
const e2ePort = Number(process.env.E2E_PORT ?? 37107);
const e2eWorkers = Number(process.env.E2E_WORKERS ?? 1);
const baseURL = process.env.E2E_BASE_URL ?? `http://${e2eHost}:${e2ePort}`;
const e2eOutputDir = process.env.E2E_OUTPUT_DIR ?? '.output';
const webServerCommand = `node scripts/static-preview-server.mjs --host ${e2eHost} --port ${e2ePort} --root ${e2eOutputDir}/public`;
const shouldUseWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER !== '1';

// Shared Chromium config for the smoke / e2e / golden tiers.
const chromiumUse = {
  ...devices['Desktop Chrome'],
  launchOptions: {
    args: [
      '--enable-features=FileSystemAccessAPI,Vulkan',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      // WebGPU: headless Chromium does not expose `navigator.gpu` without
      // these. On machines without a real GPU (CI/Docker) a Vulkan software
      // rasteriser is required — see scripts/e2e-docker.sh / docker image.
      '--enable-unsafe-webgpu',
      '--enable-unsafe-swiftshader',
      '--disable-vulkan-surface',
    ],
  },
};

export default defineConfig({
  testDir: './test',
  // Projects below own their `testMatch`; nothing runs unless a project claims
  // it. This keeps the tiers (smoke / e2e / golden) strictly disjoint so a spec
  // can never be pulled into two runs at once.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  workers: process.env.CI ? 1 : e2eWorkers,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // ── Tier: smoke ── engine-agnostic startup/UI checks. Cheap, deterministic,
    // no real-GPU pixel assertions → always blocking in CI.
    {
      name: 'smoke',
      testMatch: ['e2e/smoke/**/*.spec.ts'],
      use: chromiumUse,
    },
    // ── Tier: e2e ── UI-driven workflows (import/export/timeline). Chromium with
    // a software GPU rasteriser; behaviour-level, not pixel-exact.
    {
      name: 'e2e',
      testMatch: ['e2e/web/**/*.spec.ts'],
      use: chromiumUse,
    },
    // ── Tier: golden ── cross-engine RENDERED-FRAME comparison (perceptual
    // hashes vs shared/golden). Depends on a real/consistent GPU: SwiftShader in
    // CI is correct-but-approximate, so this tier runs in its own job and is not
    // a merge gate. Set REQUIRE_WEBGPU=1 to fail (not skip) when no adapter.
    {
      name: 'golden',
      testMatch: ['golden/**/*.spec.ts'],
      use: chromiumUse,
    },
    // Firefox smoke: verifies the OPFS-sandbox startup path works on a second
    // engine (cross-origin isolation, workspace bootstrap). Scoped to the
    // engine-agnostic smoke specs — WebGPU/export/codec breadth stays Chromium-
    // only where a software GPU rasteriser is available.
    {
      name: 'firefox-smoke',
      testMatch: ['e2e/smoke/loading.spec.ts', 'e2e/smoke/workspace.spec.ts'],
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'media.autoplay.default': 0,
            'dom.workers.modules.enabled': true,
          },
        },
      },
    },
  ],

  webServer: shouldUseWebServer
    ? {
        command: webServerCommand,
        url: baseURL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        env: {
          E2E_TEST: '1',
          E2E_HOST: e2eHost,
          E2E_PORT: String(e2ePort),
          NUXT_IGNORE_LOCK: '1',
        },
      }
    : undefined,
});
