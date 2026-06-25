import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { probeWebGpu } from '../../utils/e2e/webgpu';
import { writeFileToOpfs } from '../../utils/e2e/virtual-fs';
import {
  renderWebFrames,
  type WebSceneData,
} from '../../integration/engine-parity/helpers/web-render';
import {
  loadGoldenRegistry,
  findGoldenEntry,
  findGoldenSample,
  compareHash,
} from '../../integration/engine-parity/helpers/golden-compare';
import { loadAllScenes } from '../../integration/engine-parity/helpers/scene-loader';
import { computeFrameHash } from '../../integration/engine-parity/helpers/frame-hash';

const MEDIA_DIR = resolve(process.cwd(), 'test/fixtures/media');

const SCENES = loadAllScenes();

test.describe('Web engine parity @parity', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'WebGPU parity requires Chromium');

  test.beforeAll(async ({ browser }) => {
    // Verify WebGPU is available before running the suite.
    const page = await browser.newPage();
    await page.goto('/');
    const info = await probeWebGpu(page);
    await page.close();
    test.skip(!info.available, `WebGPU not available: ${info.reason ?? 'unknown'}`);
  });

  for (const { filename, fixture } of SCENES) {
    const tolerance = fixture.tolerance;
    test(`web renders "${filename}" matching golden hash`, async ({ page }) => {
      const sceneData = fixture as unknown as WebSceneData;

      // Load media fixtures referenced by the scene into OPFS.
      const scene = sceneData.scene as {
        layers: Array<Record<string, unknown>>;
      };

      const mediaMapping: Record<string, string> = {};

      // Navigate to the parity page first so OPFS APIs (navigator.storage) are available.
      await page.goto('/test/parity');
      await page.waitForLoadState('domcontentloaded');

      for (const layer of scene.layers) {
        const relPath = layer.path as string | undefined;
        if (!relPath) continue;

        // Map relative media path to an OPFS path.
        const opfsPath = `parity-media/${relPath}`;
        mediaMapping[relPath] = opfsPath;

        const absPath = resolve(MEDIA_DIR, relPath);
        const bytes = readFileSync(absPath);
        await writeFileToOpfs(page, { path: opfsPath, data: new Uint8Array(bytes) });
      }

      const results = await renderWebFrames(page, sceneData, mediaMapping);

      expect(results).toHaveLength(sceneData.sample_times_sec.length);

      const registry = loadGoldenRegistry();
      const goldenEntry = findGoldenEntry(registry, filename, 'web');

      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const timeSec = sceneData.sample_times_sec[i]!;

        expect(result.error, `render error at t=${timeSec}s: ${result.error}`).toBeUndefined();

        if (!goldenEntry) {
          // No golden yet — just verify the hash is a valid 16-char hex string.
          expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
          test.info().annotations.push({
            type: 'golden-missing',
            description: `${filename} web t=${timeSec} hash=${result.hash}`,
          });
          continue;
        }

        const golden = findGoldenSample(goldenEntry, timeSec);
        expect(golden, `golden sample for ${filename} web t=${timeSec}`).toBeDefined();

        const match = compareHash(result.hash, golden!.hash, golden?.tolerance ?? tolerance);
        expect(
          match.pass,
          `hash mismatch for "${filename}" web at t=${timeSec}s: ` +
            `distance=${match.distance} tolerance=${match.tolerance} ` +
            `actual=${match.actualHash} expected=${match.expectedHash}`,
        ).toBe(true);
      }
    });
  }

  test('web and native hashes are within tolerance of each other', async ({ page }) => {
    // This test compares web hashes against native golden hashes.
    // It only runs if both golden sets exist.
    const registry = loadGoldenRegistry();

    for (const { filename, fixture } of SCENES) {
      const tolerance = fixture.tolerance;
      const webEntry = findGoldenEntry(registry, filename, 'web');
      const nativeEntry = findGoldenEntry(registry, filename, 'native');
      if (!webEntry || !nativeEntry) continue;

      test.info().annotations.push({
        type: 'cross-engine',
        description: `Comparing ${filename}: web vs native`,
      });

      for (const webSample of webEntry.samples) {
        const nativeSample = findGoldenSample(nativeEntry, webSample.timeSec);
        if (!nativeSample) continue;

        const match = compareHash(
          webSample.hash,
          nativeSample.hash,
          Math.max(webSample.tolerance, nativeSample.tolerance, tolerance),
        );

        expect(
          match.pass,
          `cross-engine mismatch for "${filename}" at t=${webSample.timeSec}s: ` +
            `distance=${match.distance} tolerance=${match.tolerance} ` +
            `web=${match.actualHash} native=${match.expectedHash}`,
        ).toBe(true);
      }
    }
  });
});

// Re-export computeFrameHash for the golden generator script.
export { computeFrameHash };
