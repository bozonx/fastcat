import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { probeWebGpu } from '../../utils/e2e/webgpu';
import { writeFileToOpfs } from '../../utils/e2e/virtual-fs';
import { renderWebFrames, type WebSceneData } from '../../parity-helpers/web-render';
import {
  loadGoldenRegistry,
  findGoldenEntry,
  findGoldenSample,
  compareHash,
  compareColorSig,
  isPendingHash,
} from '../../parity-helpers/golden-compare';
import { loadAllScenes } from '../../parity-helpers/scene-loader';
import { computeFrameHash } from '../../parity-helpers/frame-hash';

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
      const nativeEntry = findGoldenEntry(registry, filename, 'native');

      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const timeSec = sceneData.sample_times_sec[i]!;

        expect(result.error, `render error at t=${timeSec}s: ${result.error}`).toBeUndefined();

        if (!goldenEntry) {
          // No golden yet — just verify the hashes are well-formed.
          expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
          expect(result.colorSig).toMatch(/^[0-9a-f]{24}$/);
          test.info().annotations.push({
            type: 'golden-missing',
            description: `${filename} web t=${timeSec} hash=${result.hash} colorSig=${result.colorSig}`,
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

        // Color signature vs web golden (catches hue regressions in the web engine).
        if (golden!.colorSig) {
          const colorMatch = compareColorSig(result.colorSig, golden!.colorSig);
          expect(
            colorMatch.pass,
            `web color mismatch for "${filename}" at t=${timeSec}s: ` +
              `distance=${colorMatch.distance} tolerance=${colorMatch.tolerance} ` +
              `actual=${colorMatch.actualSig} expected=${colorMatch.expectedSig}`,
          ).toBe(true);
        }

        // Live cross-engine check: the freshly-rendered web frame must match the
        // stored native golden. This is the real web-side parity assertion — the
        // separate cross-engine test below only compares two stored numbers.
        const nativeGolden = nativeEntry ? findGoldenSample(nativeEntry, timeSec) : undefined;
        if (nativeGolden && !isPendingHash(nativeGolden.hash)) {
          const crossTol = Math.max(nativeGolden.tolerance, golden!.tolerance, tolerance);
          const crossMatch = compareHash(result.hash, nativeGolden.hash, crossTol);
          expect(
            crossMatch.pass,
            `live web vs native golden mismatch for "${filename}" at t=${timeSec}s: ` +
              `distance=${crossMatch.distance} tolerance=${crossMatch.tolerance} ` +
              `web=${crossMatch.actualHash} native=${crossMatch.expectedHash}`,
          ).toBe(true);

          if (nativeGolden.colorSig) {
            const crossColor = compareColorSig(
              result.colorSig,
              nativeGolden.colorSig,
              fixture.color_tolerance,
            );
            expect(
              crossColor.pass,
              `live web vs native color mismatch for "${filename}" at t=${timeSec}s: ` +
                `distance=${crossColor.distance} tolerance=${crossColor.tolerance} ` +
                `web=${crossColor.actualSig} native=${crossColor.expectedSig}`,
            ).toBe(true);
          }
        }
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

        // Skip pending hashes — they haven't been generated yet.
        if (isPendingHash(webSample.hash) || isPendingHash(nativeSample.hash)) continue;

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

        if (webSample.colorSig && nativeSample.colorSig) {
          const colorMatch = compareColorSig(
            webSample.colorSig,
            nativeSample.colorSig,
            fixture.color_tolerance,
          );
          expect(
            colorMatch.pass,
            `cross-engine color mismatch for "${filename}" at t=${webSample.timeSec}s: ` +
              `distance=${colorMatch.distance} tolerance=${colorMatch.tolerance} ` +
              `web=${colorMatch.actualSig} native=${colorMatch.expectedSig}`,
          ).toBe(true);
        }
      }
    }
  });
});

// Re-export computeFrameHash for the golden generator script.
export { computeFrameHash };
