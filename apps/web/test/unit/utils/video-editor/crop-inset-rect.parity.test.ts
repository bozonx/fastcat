import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeCropInsetRect } from '~/utils/video-editor/clip-layout';

/**
 * Cross-engine parity contract. This test and the Rust test
 * `compositor::scene::tests::crop_inset_rect_matches_shared_parity_fixture` read the
 * SAME fixture, so the web `computeCropInsetRect` and the native
 * `Transform::crop_inset_rect` can never drift apart for non-overlapping crops.
 */
interface ParityCase {
  name: string;
  width: number;
  height: number;
  crop: { top?: number; bottom?: number; left?: number; right?: number };
  expected: { xMin: number; yMin: number; xMax: number; yMax: number };
}

const fixture = JSON.parse(
  readFileSync(resolveSharedPath('parity/crop-inset-rect.cases.json'), 'utf8'),
) as { cases: ParityCase[] };

describe('crop inset-rect parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      const rect = computeCropInsetRect(c.width, c.height, c.crop);
      expect(rect.xMin).toBeCloseTo(c.expected.xMin, 6);
      expect(rect.yMin).toBeCloseTo(c.expected.yMin, 6);
      expect(rect.xMax).toBeCloseTo(c.expected.xMax, 6);
      expect(rect.yMax).toBeCloseTo(c.expected.yMax, 6);
    });
  }

  // KNOWN INTENTIONAL DIVERGENCE FROM THE NATIVE ENGINE (excluded from the fixture).
  // When opposing crops overlap, the web engine keeps the first edge and clamps the
  // second to the remaining space; the native engine scales both edges down
  // proportionally to a centered collapse.
  it('web clamps the second edge when opposing crops overlap', () => {
    // left 70% + right 70% overlap on a 100px box.
    const rect = computeCropInsetRect(100, 100, { left: 70, right: 70, top: 0, bottom: 0 });
    expect(rect.xMin).toBe(70); // first edge kept
    expect(rect.xMax).toBe(70); // second edge clamped to remaining space → zero width
  });
});
