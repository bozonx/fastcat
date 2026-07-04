/**
 * Golden hash generator for cross-engine video engine parity tests.
 *
 * Runs the web engine via Playwright for each scene in shared/scenes/,
 * captures the perceptual hash of each sample frame, and upserts it into
 * shared/golden/frames.json under the "web" engine.
 *
 * For the native engine, this script can also invoke pnpm test:golden:import-native
 * which runs the Rust engine_parity tests and imports the printed GOLDEN[native]
 * lines automatically.
 *
 * Usage:
 *   pnpm test:golden:gen                              # web only (via Playwright)
 *   pnpm test:golden:gen -- --both                    # web + native (requires cargo)
 *   pnpm test:golden:gen -- --both --scene scene.json # one scene only
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  upsertGoldenSample,
  loadGoldenRegistry,
  saveGoldenRegistry,
} from '../test/golden-helpers/golden-compare';
import { loadAllScenes } from '../test/golden-helpers/scene-loader';
import { staticPreviewServerArgs, waitForServer } from './lib/preview-server.mjs';

const E2E_HOST = process.env.E2E_HOST ?? '127.0.0.1';
const E2E_PORT = Number(process.env.E2E_PORT ?? 37107);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://${E2E_HOST}:${E2E_PORT}`;

const MEDIA_DIR = resolve(process.cwd(), 'test/fixtures/media');

interface GenerateOptions {
  mode: '--web' | '--native' | '--both';
  scene?: string;
}

function parseArgs(args: string[]): GenerateOptions {
  let mode: GenerateOptions['mode'] = '--web';
  let scene: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--') continue;

    if (arg === '--web' || arg === '--native' || arg === '--both') {
      mode = arg;
      continue;
    }

    if (arg === '--scene') {
      scene = args[i + 1];
      i++;
      continue;
    }

    if (arg?.startsWith('--scene=')) {
      scene = arg.slice('--scene='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { mode, scene };
}

/**
 * Poll a URL until it responds or timeout is reached.
 * Uses AbortController to avoid hanging on slow SSR compilation.
 */
/**
 * Start a preview server if no server is already running at BASE_URL.
 * Returns the child process so the caller can kill it on exit.
 */
async function ensurePreviewServer(): Promise<ChildProcess | null> {
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

  console.log('  Building preview bundle...');
  const build = spawnSync('pnpm', ['build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, E2E_HOST, E2E_PORT: String(E2E_PORT), E2E_TEST: '1' },
  });

  if (build.status !== 0) {
    throw new Error(`Build failed with exit code ${build.status ?? 'unknown'}`);
  }

  console.log(`  Starting preview server on ${E2E_HOST}:${E2E_PORT}...`);
  const proc = spawn('node', staticPreviewServerArgs({ host: E2E_HOST, port: E2E_PORT }), {
    cwd: process.cwd(),
    stdio: 'pipe',
    env: { ...process.env, E2E_HOST, E2E_PORT: String(E2E_PORT), E2E_TEST: '1' },
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

function filterScenes(
  scenes: ReturnType<typeof loadAllScenes>,
  sceneFilter: string | undefined,
): ReturnType<typeof loadAllScenes> {
  if (!sceneFilter) return scenes;

  const filtered = scenes.filter(({ filename }) => filename === sceneFilter);

  if (filtered.length === 0) {
    throw new Error(`Scene not found in shared/scenes/: ${sceneFilter}`);
  }

  return filtered;
}

async function genWebGolden(sceneFilter: string | undefined): Promise<void> {
  const { chromium } = await import('@playwright/test');
  const { renderWebFrames } = await import('../test/golden-helpers/web-render');
  type WebSceneData = import('../test/golden-helpers/web-render').WebSceneData;
  const { writeFileToOpfs } = await import('../test/utils/e2e/virtual-fs');

  const serverProc = await ensurePreviewServer();

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
    await page.goto(`${BASE_URL}/test/golden`);

    const registry = loadGoldenRegistry();

    const scenes = filterScenes(loadAllScenes(), sceneFilter);

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

        console.log(
          `  WEB  ${filename} t=${timeSec}s hash=${result.hash} colorSig=${result.colorSig}`,
        );
        upsertGoldenSample(
          registry,
          filename,
          'web',
          timeSec,
          result.hash,
          tolerance,
          result.colorSig,
        );
      }
    }

    saveGoldenRegistry(registry);
    await browser.close();
    console.log('\nWeb golden hashes saved to shared/golden/frames.json');
  } finally {
    if (serverProc) {
      console.log('  Stopping preview server...');
      serverProc.kill('SIGTERM');
    }
  }
}

function runImportNative(sceneFilter: string | undefined): Promise<boolean> {
  return new Promise((resolve, reject) => {
    console.log('\nImporting native golden hashes...\n');
    const args = ['test:golden:import-native'];
    if (sceneFilter) {
      args.push('--', '--scene', sceneFilter);
    }
    const proc = spawn('pnpm', args, {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    proc.on('error', (error) => reject(error));
    proc.on('close', (code) => {
      if (code !== 0) {
        console.warn(
          '\nNative golden import skipped (tests likely skipped — no ffmpeg/ffprobe or wgpu adapter).\n' +
            'Web goldens were saved successfully. Install ffmpeg/ffprobe and a wgpu adapter to also generate native goldens.',
        );
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

async function main(): Promise<void> {
  const { mode, scene } = parseArgs(process.argv.slice(2));

  console.log(`Generating golden hashes (${mode}${scene ? `, scene=${scene}` : ''})...\n`);

  if (mode === '--web' || mode === '--both') {
    await genWebGolden(scene);
  }

  if (mode === '--native' || mode === '--both') {
    const ok = await runImportNative(scene);
    if (!ok && mode === '--native') {
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
