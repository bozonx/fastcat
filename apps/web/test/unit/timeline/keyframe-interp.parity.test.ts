import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evalTrackAt } from '~/timeline/animation/evaluate';
import type { Keyframe, KeyframeTrack } from '~/timeline/types';

/**
 * Cross-engine parity contract — pairs with the Rust test
 * `monitor::scene::build::animation::tests::eval_track_at_matches_shared_parity_fixture`.
 */
interface KeyframeInterpCase {
  name: string;
  keyframes: Keyframe[];
  queryTTicks: number;
  expected: number | null;
}

const fixture = JSON.parse(
  readFileSync(resolveSharedPath('parity/keyframe-interp.cases.json'), 'utf8'),
) as { cases: KeyframeInterpCase[] };

describe('keyframe-interp parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const track: KeyframeTrack = { keyframes: c.keyframes };
      const got = evalTrackAt(track, c.queryTTicks);
      if (c.expected === null) {
        expect(got).toBeUndefined();
      } else {
        expect(got).toBeCloseTo(c.expected, 9);
      }
    });
  }
});
