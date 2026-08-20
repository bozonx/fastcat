/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeContainFit, orientedFitScale } from '~/utils/video-editor/clip-layout';

/**
 * Cross-engine parity contract — pairs with the Rust test
 * `compositor::scene::tests::fit_into_matches_shared_parity_fixture`.
 */
interface FitCase {
  name: string;
  natural: [number, number];
  viewport: [number, number];
  expected: { scale: number; offsetX: number; offsetY: number };
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'shared/parity/contain-fit.cases.json'), 'utf8'),
) as { cases: FitCase[] };

describe('contain-fit parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      const fit = computeContainFit(c.natural[0], c.natural[1], c.viewport[0], c.viewport[1]);
      expect(fit.scale).toBeCloseTo(c.expected.scale, 9);
      expect(fit.offsetX).toBeCloseTo(c.expected.offsetX, 6);
      expect(fit.offsetY).toBeCloseTo(c.expected.offsetY, 6);
    });
  }

  it('orientedFitScale swaps the box for a quarter turn', () => {
    // A 1080x1920 portrait source rotated 90° fits as 1920x1080 into a 1920x1080 scene.
    expect(orientedFitScale(1080, 1920, 1920, 1080, 90)).toBeCloseTo(1, 9);
    // Without rotation the same source is pillarboxed.
    expect(orientedFitScale(1080, 1920, 1920, 1080, 0)).toBeCloseTo(0.5625, 9);
  });
});
