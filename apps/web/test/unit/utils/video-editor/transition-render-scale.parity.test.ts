/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  previewEffectQualityTransitionScale,
  type PreviewEffectQuality,
} from '~/utils/preview-effect-quality';

/**
 * Cross-engine parity contract — pairs with the Rust test
 * `compositor::effects::tests::transition_render_scale_matches_shared_parity_fixture`.
 */
interface ScaleCase {
  quality: PreviewEffectQuality;
  expected: number;
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'shared/parity/transition-render-scale.cases.json'), 'utf8'),
) as { cases: ScaleCase[] };

describe('transition-render-scale parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for ${c.quality}`, () => {
      expect(previewEffectQualityTransitionScale(c.quality)).toBeCloseTo(c.expected, 9);
    });
  }
});
