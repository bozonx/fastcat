/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadGoldenRegistry,
  findGoldenEntry,
  findGoldenSample,
  PENDING_HASH,
  isPendingHash,
} from '../../golden-helpers/golden-compare';
import { loadAllScenes, collectSceneMediaPaths } from '../../golden-helpers/scene-loader';
import {
  hammingDistance,
  colorSignatureDistance,
  DEFAULT_COLOR_TOLERANCE,
} from '../../golden-helpers/frame-hash';

const MEDIA_DIR = resolve(process.cwd(), 'test/fixtures/media');

/**
 * Hard ceiling on a sample's Hamming tolerance. The aHash is 64 bits, so a
 * tolerance approaching 32 (half the bits) lets almost any frame pass and makes
 * the golden worthless. Anything above this is almost always a flake being
 * silenced rather than a legitimately fuzzy comparison — fail loudly instead.
 */
const MAX_HASH_TOLERANCE = 32;

/**
 * Scenes allowed to exceed `MAX_HASH_TOLERANCE`, with a justification. These are
 * cases where the two engines genuinely render the frame so differently that no
 * meaningful cross-engine aHash tolerance exists — vector-shape rasterization
 * (pixi tessellation vs vello) being the canonical example. They are kept for
 * per-engine golden *regression* coverage; their cross-engine hash agreement is
 * intentionally loose. An entry here is an explicit, reviewed exception — not a
 * silent flake suppression.
 */
const CEILING_EXEMPT = new Map<string, string>([
  ['shapes-all.json', 'pixi vs vello vector-shape rasterization diverges by >half the aHash bits'],
]);

/**
 * Goldens that are known-pending generation (`hash: "pending"`). Each key is
 * `scene:engine:timeSec`. A pending hash OUTSIDE this allowlist means a scene
 * was added without generating its golden — that now fails the suite instead of
 * silently rotting. To intentionally add a pending golden, add its key here;
 * to clear one, run the generator and remove the key.
 *
 * NOTE: an all-zero hash (`0000000000000000`) is NOT pending — it is the real
 * aHash of a uniform frame (e.g. a transition resolved to a solid colour) and
 * is validated normally via its colour signature.
 */
const KNOWN_PENDING_GOLDENS = new Set<string>([]);

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

    it('every sample has a valid 16-char hex hash (or pending) and positive tolerance', () => {
      for (const entry of registry.entries) {
        for (const sample of entry.samples) {
          expect(
            sample.hash === PENDING_HASH || /^[0-9a-f]{16}$/.test(sample.hash),
            `${entry.scene} ${entry.engine} t=${sample.timeSec}s has malformed hash "${sample.hash}"`,
          ).toBe(true);
          expect(sample.tolerance).toBeGreaterThan(0);
          expect(sample.timeSec).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('no sample tolerance exceeds the ceiling (catches flakes being silenced)', () => {
      const offenders: string[] = [];
      for (const entry of registry.entries) {
        if (CEILING_EXEMPT.has(entry.scene)) continue;
        for (const sample of entry.samples) {
          if (sample.tolerance > MAX_HASH_TOLERANCE) {
            offenders.push(
              `${entry.scene}:${entry.engine}:${sample.timeSec} tolerance=${sample.tolerance}`,
            );
          }
        }
      }
      expect(
        offenders,
        `Sample tolerance(s) exceed the ${MAX_HASH_TOLERANCE}-bit ceiling. A tolerance this ` +
          `high makes the golden meaningless; tighten the scene or split it instead:\n` +
          offenders.map((o) => `    - ${o}`).join('\n'),
      ).toEqual([]);
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

    // NOTE: we intentionally do NOT assert cross-scene hash/colorSig uniqueness.
    // A downsampled perceptual hash legitimately cannot distinguish frames that
    // differ only in high-frequency content (blur, sharpen, chromatic aberration,
    // noise all preserve the low-frequency mean), so distinct scenes sharing a
    // hash is a property of the metric, not a golden defect. Cross-engine
    // agreement, per-engine golden regression, and the colour signature provide
    // the real protection.

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

          // Skip pending hashes — they haven't been generated yet.
          if (isPendingHash(webSample.hash) || isPendingHash(nativeSample.hash)) continue;

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
            const colorTolerance = fixture.color_tolerance ?? DEFAULT_COLOR_TOLERANCE;
            const colorDist = colorSignatureDistance(webSample.colorSig, nativeSample.colorSig);
            expect(
              colorDist <= colorTolerance,
              `cross-engine color mismatch for "${filename}" at t=${timeSec}s: ` +
                `distance=${colorDist} tolerance=${colorTolerance} ` +
                `web=${webSample.colorSig} native=${nativeSample.colorSig}`,
            ).toBe(true);
          }
        }
      }
    });

    it('no pending hashes exist outside the known-pending allowlist', () => {
      const unexpected: string[] = [];
      const stalePending = new Set(KNOWN_PENDING_GOLDENS);

      for (const entry of registry.entries) {
        for (const sample of entry.samples) {
          if (!isPendingHash(sample.hash)) continue;
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
        `Un-generated golden hash(es) found. Run \`pnpm test:golden:gen\` ` +
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
