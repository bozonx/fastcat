/**
 * Golden hash generator for cross-engine video engine parity tests.
 *
 * Runs the web engine via Playwright for each scene in shared/scenes/,
 * captures the perceptual hash of each sample frame, and upserts it into
 * shared/golden/frames.json under the "web" engine.
 *
 * For the native engine, this script can also invoke pnpm test:parity:import-native
 * which runs the Rust engine_parity tests and imports the printed GOLDEN[native]
 * lines automatically.
 *
 * Usage:
 *   pnpm test:parity:gen-golden           # web only (via Playwright)
 *   pnpm test:parity:gen-golden -- --both # web + native (requires cargo)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  upsertGoldenSample,
  loadGoldenRegistry,
  saveGoldenRegistry,
} from '../test/parity-helpers/golden-compare';
import { loadAllScenes } from '../test/parity-helpers/scene-loader';

const E2E_PORT = Number(process.env.E2E_PORT ?? 3007);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`;

const MEDIA_DIR = resolve(process.cwd(), 'test/fixtures/media');

/**
 * Poll a URL until it responds or timeout is reached.
 * Uses AbortController to avoid hanging on slow SSR compilation.
 * Tries both localhost and 127.0.0.1 in case of IPv6/IPv4 mismatch.
 */
async function waitForServer(url: string, timeoutMs = 120_000): Promise<void> {
  // Also try 127.0.0.1 in case localhost resolves to IPv6 only.
  const altUrl = url.replace('localhost', '127.0.0.1');
  const urls = [url, altUrl];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const u of urls) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(u, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok || res.status > 0) return;
      } catch {
        // server not ready yet or fetch failed
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

/**
 * Start a Nuxt dev server if no server is already running at BASE_URL.
 * Returns the child process so the caller can kill it on exit.
 */
async function ensureDevServer(): Promise<ChildProcess | null> {
  // Check if a server is already running.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(BASE_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok || res.status > 0) {
      console.log(`  Using existing server at ${BASE_URL}`);
      return null;
    }
  } catch {
    // no server running — start one
  }

  console.log(`  Starting dev server on port ${E2E_PORT}...`);
  const proc = spawn('pnpm', ['dev', '--port', String(E2E_PORT)], {
    cwd: process.cwd(),
    stdio: 'pipe',
    env: { ...process.env, E2E_TEST: '1' },
  });

  proc.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line && !line.startsWith('HTTP')) {
      console.log(`  [dev] ${line}`);
    }
  });
  proc.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) {
      console.error(`  [dev] ${line}`);
    }
  });

  await waitForServer(BASE_URL);
  console.log(`  Dev server ready at ${BASE_URL}`);
  return proc;
}

async function genWebGolden(): Promise<void> {
  const { chromium } = await import('@playwright/test');
  const { renderWebFrames } = await import('../test/parity-helpers/web-render');
  type WebSceneData = import('../test/parity-helpers/web-render').WebSceneData;
  const { writeFileToOpfs } = await import('../test/utils/e2e/virtual-fs');

  const serverProc = await ensureDevServer();

  try {
    const browser = await chromium.launch({
      args: [
        '--enable-features=FileSystemAccessAPI,Vulkan',
        '--ignore-gpu-blocklist',
        '--autoplay-policy=no-user-gesture-required',
        '--enable-unsafe-webgpu',
        '--enable-unsafe-swiftshader',
        '--disable-vulkan-surface',
      ],
    });

    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/test/parity`);

    const registry = loadGoldenRegistry();

    const scenes = loadAllScenes();

    for (const { filename, fixture: sceneData } of scenes) {
      const tolerance = sceneData.tolerance;

      const scene = sceneData.scene as {
        layers: Array<Record<string, unknown>>;
      };

      // Load media fixtures into OPFS.
      const mediaMapping: Record<string, string> = {};
      for (const layer of scene.layers) {
        const relPath = layer.path as string | undefined;
        if (!relPath) continue;

        const opfsPath = `parity-media/${relPath}`;
        mediaMapping[relPath] = opfsPath;

        const absPath = resolve(MEDIA_DIR, relPath);
        try {
          const bytes = readFileSync(absPath);
          await writeFileToOpfs(page, { path: opfsPath, data: new Uint8Array(bytes) });
        } catch (e) {
          console.warn(`Skipping media ${relPath}: ${(e as Error).message}`);
        }
      }

      const results = await renderWebFrames(page, sceneData as WebSceneData, mediaMapping);

      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const timeSec = sceneData.sample_times_sec[i]!;

        if (result.error) {
          console.error(`  ${filename} t=${timeSec}s: ERROR ${result.error}`);
          continue;
        }

        console.log(`  WEB  ${filename} t=${timeSec}s hash=${result.hash}`);
        upsertGoldenSample(registry, filename, 'web', timeSec, result.hash, tolerance);
      }
    }

    saveGoldenRegistry(registry);
    await browser.close();
    console.log('\nWeb golden hashes saved to shared/golden/frames.json');
  } finally {
    if (serverProc) {
      console.log('  Stopping dev server...');
      serverProc.kill('SIGTERM');
    }
  }
}

function runImportNative(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('\nImporting native golden hashes...\n');
    const proc = spawn('pnpm', ['test:parity:import-native'], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    proc.on('error', (error) => reject(error));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`pnpm test:parity:import-native exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0] ?? '--web';

  console.log(`Generating golden hashes (${mode})...\n`);

  if (mode === '--web' || mode === '--both') {
    await genWebGolden();
  }

  if (mode === '--native' || mode === '--both') {
    await runImportNative();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
