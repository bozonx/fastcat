import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyTransitionCurve, type TransitionCurve } from '~/transitions/core/registry';

/**
 * Cross-engine parity contract — pairs with the Rust test
 * `monitor::scene::build::transition::tests::curve_matches_shared_parity_fixture`.
 */
interface CurveCase {
  curve: TransitionCurve;
  progress: number;
  expected: number;
}

const fixture = JSON.parse(
  readFileSync(resolveSharedPath('parity/transition-curve.cases.json'), 'utf8'),
) as { cases: CurveCase[] };

describe('transition-curve parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for ${c.curve}@${c.progress}`, () => {
      expect(applyTransitionCurve(c.progress, c.curve)).toBeCloseTo(c.expected, 9);
    });
  }
});
