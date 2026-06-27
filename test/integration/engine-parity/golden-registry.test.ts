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
import {
  hammingDistance,
  colorSignatureDistance,
  DEFAULT_COLOR_TOLERANCE,
} from '../../parity-helpers/frame-hash';

const MEDIA_DIR = resolve(process.cwd(), 'test/fixtures/media');

const PLACEHOLDER = '0000000000000000';

/**
 * Goldens that are known-pending generation (placeholder hashes). Each key is
 * `scene:engine:timeSec`. A placeholder OUTSIDE this allowlist means a scene
 * was added without generating its golden — that now fails the suite instead of
 * silently rotting. To intentionally add a pending golden, add its key here;
 * to clear one, run the generator and remove the key.
 */
const KNOWN_PENDING_GOLDENS = new Set<string>([
  'multi-time-samples.json:native:1',
  'multi-time-samples.json:web:1',
  'transition-dissolve.json:native:0.5',
  'transition-dissolve.json:web:0.5',
  'transition-fade-to-black.json:native:0.5',
  'transition-fade-to-black.json:web:0.5',
  'transition-slide.json:native:0.5',
  'transition-slide.json:web:0.5',
  'transition-wipe.json:native:0.5',
  'transition-wipe.json:web:0.5',
]);

const pendingKey = (scene: string, engine: string, timeSec: number): string =>
  `${scene}:${engine}:${timeSec}`;

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

    it('every present color signature is a valid 24-char hex string', () => {
      for (const entry of registry.entries) {
        for (const sample of entry.samples) {
          if (sample.colorSig === undefined) continue;
          expect(
            sample.colorSig,
            `${entry.scene} ${entry.engine} t=${sample.timeSec}s has malformed colorSig`,
          ).toMatch(/^[0-9a-f]{24}$/);
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

          // Color signatures (when both engines captured one) must also agree —
          // catches hue divergence the luminance aHash is blind to.
          if (webSample.colorSig && nativeSample.colorSig) {
            const colorDist = colorSignatureDistance(webSample.colorSig, nativeSample.colorSig);
            expect(
              colorDist <= DEFAULT_COLOR_TOLERANCE,
              `cross-engine color mismatch for "${filename}" at t=${timeSec}s: ` +
                `distance=${colorDist} tolerance=${DEFAULT_COLOR_TOLERANCE} ` +
                `web=${webSample.colorSig} native=${nativeSample.colorSig}`,
            ).toBe(true);
          }
        }
      }
    });

    it('no placeholder hashes exist outside the known-pending allowlist', () => {
      const unexpected: string[] = [];
      const stalePending = new Set(KNOWN_PENDING_GOLDENS);

      for (const entry of registry.entries) {
        for (const sample of entry.samples) {
          if (sample.hash !== PLACEHOLDER) continue;
          const key = pendingKey(entry.scene, entry.engine, sample.timeSec);
          if (KNOWN_PENDING_GOLDENS.has(key)) {
            stalePending.delete(key);
          } else {
            unexpected.push(key);
          }
        }
      }

      // A placeholder for a scene that isn't on the allowlist = a golden was
      // never generated. Fail loudly instead of silently skipping it forever.
      expect(
        unexpected,
        `Un-generated golden hash(es) found. Run \`pnpm test:parity:gen-golden\` ` +
          `to generate them, or add to KNOWN_PENDING_GOLDENS if intentionally pending:\n` +
          unexpected.map((p) => `    - ${p}`).join('\n'),
      ).toEqual([]);

      // Allowlist entries that are no longer placeholders should be removed so
      // the list can't accumulate stale exemptions that mask real regressions.
      expect(
        [...stalePending],
        `KNOWN_PENDING_GOLDENS contains entries that are no longer placeholders ` +
          `(remove them):`,
      ).toEqual([]);
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
