import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
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

process.env.E2E_TEST ??= '1';

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

  afterSession: () => {
    tauriDriver?.kill();
  },
};
