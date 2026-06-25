/**
 * Golden hash generator for cross-engine video engine parity tests.
 *
 * Runs the web engine via Playwright for each scene in shared/scenes/,
 * captures the perceptual hash of each sample frame, and upserts it into
 * shared/golden/frames.json under the "web" engine.
 *
 * For the native engine, run: pnpm test:native:parity -- --nocapture
 * and copy the printed GOLDEN[native] lines, or run:
 *   cargo test --manifest-path src-tauri/Cargo.toml --features test-support \
 *     --test engine_parity -- --nocapture
 *
 * Usage:
 *   pnpm test:parity:gen-golden           # web only (via Playwright)
 *   pnpm test:parity:gen-golden -- --both # web + native (requires cargo)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { upsertGoldenSample, loadGoldenRegistry, saveGoldenRegistry } from '../test/integration/engine-parity/helpers/golden-compare';
import { DEFAULT_TOLERANCE, TEXT_SCENE_TOLERANCE } from '../test/integration/engine-parity/helpers/frame-hash';

const SCENES_DIR = resolve(process.cwd(), 'shared/scenes');
const MEDIA_DIR = resolve(process.cwd(), 'test/fixtures/media');

interface SceneDef {
  filename: string;
  tolerance: number;
}

const SCENES: SceneDef[] = [
  { filename: 'solid-background.json', tolerance: DEFAULT_TOLERANCE },
  { filename: 'video-clip.json', tolerance: DEFAULT_TOLERANCE },
  { filename: 'image-overlay.json', tolerance: DEFAULT_TOLERANCE },
  { filename: 'text-layer.json', tolerance: TEXT_SCENE_TOLERANCE },
  { filename: 'multi-layer-blend.json', tolerance: DEFAULT_TOLERANCE },
];

interface SceneFixture {
  scene: Record<string, unknown>;
  sample_times_sec: number[];
}

async function genWebGolden(): Promise<void> {
  const { chromium } = await import('@playwright/test');
  const { renderWebFrames } = await import(
    '../test/integration/engine-parity/helpers/web-render'
  );
  type WebSceneData = import('../test/integration/engine-parity/helpers/web-render').WebSceneData;
  const { writeFileToOpfs } = await import('../test/utils/e2e/virtual-fs');

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

  // Start a dev server or navigate to an existing one.
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3007';
  await page.goto(baseUrl);

  const registry = loadGoldenRegistry();

  for (const { filename, tolerance } of SCENES) {
    const sceneData = JSON.parse(
      readFileSync(resolve(SCENES_DIR, filename), 'utf8'),
    ) as SceneFixture;

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

    const results = await renderWebFrames(
      page,
      sceneData as WebSceneData,
      mediaMapping,
    );

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
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0] ?? '--web';

  console.log(`Generating golden hashes (${mode})...\n`);

  if (mode === '--web' || mode === '--both') {
    await genWebGolden();
  }

  if (mode === '--native' || mode === '--both') {
    console.log('\nFor native golden hashes, run:');
    console.log(
      '  cargo test --manifest-path src-tauri/Cargo.toml --features test-support \\',
    );
    console.log('    --test engine_parity -- --nocapture');
    console.log('\nThen copy the GOLDEN[native] lines into shared/golden/frames.json');
    console.log('or use: pnpm test:parity:import-native');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
