/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadGoldenRegistry,
  findGoldenEntry,
  findGoldenSample,
} from '../../parity-helpers/golden-compare';
import { loadAllScenes, collectSceneMediaPaths } from '../../parity-helpers/scene-loader';
import { hammingDistance } from '../../parity-helpers/frame-hash';

const MEDIA_DIR = resolve(process.cwd(), 'test/fixtures/media');

describe('golden-registry integration', () => {
  const registry = loadGoldenRegistry();
  const scenes = loadAllScenes();

  describe('registry structure', () => {
    it('loads a non-empty registry', () => {
      expect(registry.entries).toBeInstanceOf(Array);
      expect(registry.entries.length).toBeGreaterThan(0);
    });

    it('every entry has valid scene, engine, and samples', () => {
      for (const entry of registry.entries) {
        expect(entry.scene).toMatch(/\.json$/);
        expect(entry.engine).toMatch(/^(web|native)$/);
        expect(entry.samples).toBeInstanceOf(Array);
        expect(entry.samples.length).toBeGreaterThan(0);
      }
    });

    it('every sample has a valid 16-char hex hash and positive tolerance', () => {
      for (const entry of registry.entries) {
        for (const sample of entry.samples) {
          expect(sample.hash).toMatch(/^[0-9a-f]{16}$/);
          expect(sample.tolerance).toBeGreaterThan(0);
          expect(sample.timeSec).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('does not contain duplicate entries for the same scene + engine', () => {
      const seen = new Set<string>();
      for (const entry of registry.entries) {
        const key = `${entry.scene}:${entry.engine}`;
        expect(seen.has(key), `duplicate golden entry for ${key}`).toBe(false);
        seen.add(key);
      }
    });
  });

  describe('scene coverage', () => {
    it('every scene in shared/scenes/ has a golden entry for both engines', () => {
      for (const { filename } of scenes) {
        const web = findGoldenEntry(registry, filename, 'web');
        const native = findGoldenEntry(registry, filename, 'native');

        expect(web, `missing web golden for ${filename}`).toBeDefined();
        expect(native, `missing native golden for ${filename}`).toBeDefined();
      }
    });

    it('every golden entry references an existing scene file', () => {
      const sceneFiles = new Set(scenes.map((s) => s.filename));

      for (const entry of registry.entries) {
        expect(
          sceneFiles.has(entry.scene),
          `golden entry references unknown scene "${entry.scene}"`,
        ).toBe(true);
      }
    });

    it('every sample time in a scene has a corresponding golden sample', () => {
      for (const { filename, fixture } of scenes) {
        const webEntry = findGoldenEntry(registry, filename, 'web');
        const nativeEntry = findGoldenEntry(registry, filename, 'native');

        for (const timeSec of fixture.sample_times_sec) {
          if (webEntry) {
            const sample = findGoldenSample(webEntry, timeSec);
            expect(
              sample,
              `missing web golden sample for ${filename} at t=${timeSec}s`,
            ).toBeDefined();
          }
          if (nativeEntry) {
            const sample = findGoldenSample(nativeEntry, timeSec);
            expect(
              sample,
              `missing native golden sample for ${filename} at t=${timeSec}s`,
            ).toBeDefined();
          }
        }
      }
    });

    it('golden tolerance matches scene tolerance', () => {
      for (const { filename, fixture } of scenes) {
        const webEntry = findGoldenEntry(registry, filename, 'web');
        const nativeEntry = findGoldenEntry(registry, filename, 'native');

        for (const timeSec of fixture.sample_times_sec) {
          const webSample = webEntry ? findGoldenSample(webEntry, timeSec) : undefined;
          const nativeSample = nativeEntry ? findGoldenSample(nativeEntry, timeSec) : undefined;

          if (webSample) {
            expect(webSample.tolerance).toBe(fixture.tolerance);
          }
          if (nativeSample) {
            expect(nativeSample.tolerance).toBe(fixture.tolerance);
          }
        }
      }
    });
  });

  describe('cross-engine parity', () => {
    it('web and native golden hashes are within tolerance for every scene', () => {
      for (const { filename, fixture } of scenes) {
        const webEntry = findGoldenEntry(registry, filename, 'web');
        const nativeEntry = findGoldenEntry(registry, filename, 'native');

        if (!webEntry || !nativeEntry) continue;

        for (const timeSec of fixture.sample_times_sec) {
          const webSample = findGoldenSample(webEntry, timeSec);
          const nativeSample = findGoldenSample(nativeEntry, timeSec);

          if (!webSample || !nativeSample) continue;

          // Skip placeholder hashes — they haven't been generated yet.
          const PLACEHOLDER = '0000000000000000';
          if (webSample.hash === PLACEHOLDER || nativeSample.hash === PLACEHOLDER) continue;

          const tolerance = Math.max(
            webSample.tolerance,
            nativeSample.tolerance,
            fixture.tolerance,
          );
          const distance = hammingDistance(webSample.hash, nativeSample.hash);

          expect(
            distance <= tolerance,
            `cross-engine mismatch for "${filename}" at t=${timeSec}s: ` +
              `distance=${distance} tolerance=${tolerance} ` +
              `web=${webSample.hash} native=${nativeSample.hash}`,
          ).toBe(true);
        }
      }
    });

    it('placeholder hashes (all-zero) are flagged for regeneration', () => {
      const placeholders: string[] = [];

      for (const entry of registry.entries) {
        for (const sample of entry.samples) {
          if (sample.hash === '0000000000000000') {
            placeholders.push(`${entry.scene} ${entry.engine} t=${sample.timeSec}s`);
          }
        }
      }

      if (placeholders.length > 0) {
        // Warn but don't fail — placeholders are expected for new scenes
        // until `pnpm test:parity:gen-golden` is run.
        console.warn(
          `\n  [golden-registry] ${placeholders.length} placeholder hash(es) found — ` +
            `run \`pnpm test:parity:gen-golden\` to regenerate:\n` +
            placeholders.map((p) => `    - ${p}`).join('\n') +
            '\n',
        );
      }
    });
  });

  describe('media fixture coverage', () => {
    it('every media path referenced by scenes exists in test/fixtures/media/', () => {
      for (const { filename, fixture } of scenes) {
        const mediaPaths = collectSceneMediaPaths(fixture.scene);

        for (const relPath of mediaPaths) {
          const absPath = resolve(MEDIA_DIR, relPath);
          expect(
            existsSync(absPath),
            `media fixture "${relPath}" referenced by ${filename} not found at ${absPath}`,
          ).toBe(true);
        }
      }
    });
  });
});
