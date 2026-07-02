/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPasses } from '~/utils/video-editor/compositor/WebGpuComputeRunner';
import type {
  ComputePass,
  EffectUniform,
} from '~/utils/video-editor/compositor/WebGpuComputeRunner';
import type { VideoEffectSpec } from '~/types/generated/native-monitor/VideoEffectSpec';
import type { PreviewEffectQuality } from '~/utils/preview-effect-quality';

/**
 * Cross-engine parity contract — pairs with the Rust test
 * `compositor::effects::tests::build_passes_match_shared_parity_fixture`.
 * The pass schedule (mode, uniform params, buffer routing) produced by
 * `buildPasses` must be identical on both engines for the same input.
 */
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'shared/parity/build-passes.cases.json'), 'utf8'),
) as {
  cases: Array<{
    name: string;
    effects: VideoEffectSpec[];
    width: number;
    height: number;
    quality: PreviewEffectQuality;
    passes: Array<{
      uniform: EffectUniform;
      customSource: string | null;
      src: ComputePass['src'];
      secondary: ComputePass['secondary'];
      dst: ComputePass['dst'];
    }>;
  }>;
};

const UNIFORM_KEYS: Array<keyof EffectUniform> = [
  'mode',
  'width',
  'height',
  'seed',
  'p0',
  'p1',
  'p2',
  'p3',
  'p4',
  'p5',
  'p6',
  'p7',
];

describe('build_passes parity (shared fixture)', () => {
  for (const tc of fixture.cases) {
    it(tc.name, () => {
      const passes = buildPasses(tc.effects, tc.width, tc.height, tc.quality);

      expect(passes.length, `${tc.name}: pass count`).toBe(tc.passes.length);

      for (let i = 0; i < passes.length; i++) {
        const actual = passes[i]!;
        const expected = tc.passes[i]!;

        // Buffer routing must match exactly.
        expect(actual.src, `${tc.name}: pass[${i}].src`).toBe(expected.src);
        expect(actual.secondary, `${tc.name}: pass[${i}].secondary`).toBe(expected.secondary);
        expect(actual.dst, `${tc.name}: pass[${i}].dst`).toBe(expected.dst);

        // customSource must match (null for built-in effects, string for custom-wgsl).
        expect(actual.customSource ?? null, `${tc.name}: pass[${i}].customSource`).toBe(
          expected.customSource,
        );

        // Uniform fields: integers exact, floats with 5 decimal precision.
        for (const key of UNIFORM_KEYS) {
          const k = key as string;
          const a = actual.uniform[key];
          const e = expected.uniform[key];
          if (Number.isInteger(a) && Number.isInteger(e)) {
            expect(a, `${tc.name}: pass[${i}].uniform.${k}`).toBe(e);
          } else {
            expect(a, `${tc.name}: pass[${i}].uniform.${k}`).toBeCloseTo(e, 5);
          }
        }
      }
    });
  }
});
