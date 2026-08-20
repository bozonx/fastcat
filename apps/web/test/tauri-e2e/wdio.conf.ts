import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import type { Options } from '@wdio/types';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * WebdriverIO config for driving the real Tauri (WebKitGTK) app on Linux via
 * the official `tauri-driver` intermediary.
 *
 * Flow:
 *   wdio  ->  tauri-driver  ->  WebKitWebDriver  ->  built FastCat binary
 *
 * Prerequisites (Linux):
 *   - `WebKitWebDriver` on PATH (package `webkit2gtk-driver` / `webkitgtk-6.0`)
 *   - `tauri-driver` installed (`cargo install tauri-driver --locked`)
 *   - the release binary built (run `pnpm tauri:build:e2e` first, or let
 *     `onPrepare` build it automatically)
 */

const projectRoot = path.resolve(here, '..', '..');
const tauriDir = path.join(projectRoot, 'src-tauri');
const defaultTauriE2eRoot = path.join(projectRoot, 'test-files', 'tauri-e2e');

process.env.E2E_TEST ??= '1';
process.env.FASTCAT_DEV_DIR ??= defaultTauriE2eRoot;
process.env.TAURI_E2E_PROJECTS_ROOT ??= path.join(
  process.env.FASTCAT_DEV_DIR,
  'home',
  'user',
  'Documents',
  'FastCat',
  'projects',
);
process.env.TAURI_E2E_TEMP_ROOT ??= path.join(process.env.FASTCAT_DEV_DIR, 'tmp', 'fixtures');
process.env.TMPDIR ??= path.join(process.env.FASTCAT_DEV_DIR, 'tmp', 'native');

// Cargo package name is `fastcat`, so the release binary is `target/release/fastcat`.
// `TAURI_E2E_BINARY` lets you point at an already-built binary (e.g. a debug
// build) to skip the slow release build during local iteration.
const application = process.env.TAURI_E2E_BINARY
  ? path.resolve(process.env.TAURI_E2E_BINARY)
  : path.join(tauriDir, 'target', 'release', 'fastcat');

const tauriDriverBin =
  process.env.TAURI_DRIVER_PATH ?? path.resolve(os.homedir(), '.cargo', 'bin', 'tauri-driver');

let tauriDriver: ChildProcess | undefined;

// Port tauri-driver listens on (its `--port`, default 4444). WDIO v9 needs an
// explicit host/port to attach to this already-running WebDriver instead of
// trying to auto-provision its own browser driver.
const tauriDriverPort = Number(process.env.TAURI_DRIVER_PORT ?? 4444);

const testProjectPrefixes = ['Tauri Drop '];

interface WdioBrowserGlobal {
  execute: <T>(fn: () => T | Promise<T>) => Promise<T>;
  refresh: () => Promise<void>;
  waitUntil: (
    condition: () => Promise<boolean> | boolean,
    options?: { timeout?: number; timeoutMsg?: string },
  ) => Promise<boolean>;
}

function cleanupTauriE2eProjects(): void {
  const projectsRoot = process.env.TAURI_E2E_PROJECTS_ROOT
    ? path.resolve(process.env.TAURI_E2E_PROJECTS_ROOT)
    : path.join(defaultTauriE2eRoot, 'home', 'user', 'Documents', 'FastCat', 'projects');

  if (!existsSync(projectsRoot)) {
    return;
  }

  for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!testProjectPrefixes.some((prefix) => entry.name.startsWith(prefix))) continue;

    rmSync(path.join(projectsRoot, entry.name), { recursive: true, force: true });
  }
}

export const config: Options.Testrunner = {
  runner: 'local',
  tsConfigPath: path.join(here, 'tsconfig.json'),

  specs: [path.join(here, 'specs', '**', '*.e2e.ts')],
  maxInstances: 1,

  // Attach to the tauri-driver intermediary (started in `beforeSession`).
  hostname: '127.0.0.1',
  port: tauriDriverPort,
  path: '/',
  automationProtocol: 'webdriver',

  capabilities: [
    {
      // @ts-expect-error tauri:options is a tauri-driver–specific capability
      'tauri:options': {
        application,
      },
    },
  ],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120_000,
  },

  // Build the release binary up front if it is missing. Building the frontend
  // (`pnpm generate`) + cargo is slow, so we skip when the binary already
  // exists — run `pnpm tauri:build:e2e` to force a rebuild.
  onPrepare: () => {
    cleanupTauriE2eProjects();

    if (existsSync(application)) {
      return;
    }

    console.log('[tauri-e2e] release binary not found, building (this may take a while)...');
    const result = spawnSync('pnpm', ['tauri', 'build', '--no-bundle'], {
      cwd: projectRoot,
      stdio: 'inherit',
    });

    if (result.status !== 0) {
      throw new Error('[tauri-e2e] `pnpm tauri build --no-bundle` failed');
    }
  },

  // Start tauri-driver before the session and tear it down afterwards.
  beforeSession: () => {
    tauriDriver = spawn(tauriDriverBin, ['--port', String(tauriDriverPort)], {
      stdio: [null, process.stdout, process.stderr],
    });

    tauriDriver.on('error', (error) => {
      console.error('[tauri-e2e] failed to start tauri-driver:', error);
      process.exit(1);
    });
  },

  before: async () => {
    const browser = (globalThis as unknown as { browser: WdioBrowserGlobal }).browser;
    await browser.execute(() => {
      localStorage.removeItem('fastcat_recent_projects');
    });
    await browser.refresh();
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const hasTauriInternals =
            typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
          return document.readyState === 'complete' && hasTauriInternals;
        }),
      {
        timeout: 10_000,
        timeoutMsg: 'Tauri e2e app did not finish reloading after storage cleanup',
      },
    );
  },

  afterSession: () => {
    tauriDriver?.kill();
  },
};
