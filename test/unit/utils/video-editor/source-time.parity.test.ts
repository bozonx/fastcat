/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveClipSourceTimeUs,
  clampToLastReadableSourceUs,
  normalizeClipSpeed,
} from '~/utils/video-editor/source-time';

/**
 * Cross-engine parity contract. This test and the Rust test
 * `monitor::scene::tests::clip_source_pts_matches_shared_parity_fixture` read the
 * SAME fixture, so the web `resolveClipSourceTimeUs` and the native
 * `SceneLayer::source_pts_at` can never drift apart on the shared algorithm.
 */
interface ParityCase {
  name: string;
  timelineStartSec: number;
  timelineEndSec: number;
  sourceStartSec: number;
  sourceRangeDurationSec: number;
  speed: number;
  timelineSec: number;
  expectedSourceSec: number;
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'shared/parity/clip-source-pts.cases.json'), 'utf8'),
) as { guardSec: number; cases: ParityCase[] };

describe('clip source-PTS parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      const localTimeUs = (c.timelineSec - c.timelineStartSec) * 1_000_000;
      const sourceUs = resolveClipSourceTimeUs({
        localTimeUs,
        sourceStartUs: c.sourceStartSec * 1_000_000,
        sourceRangeDurationUs: c.sourceRangeDurationSec * 1_000_000,
        speed: c.speed,
        // No frameRate: this is the frame-rate-independent region where the two
        // engines agree exactly (the guard is the flat fixture.guardSec).
      });
      expect(sourceUs / 1_000_000).toBeCloseTo(c.expectedSourceSec, 5);
    });
  }
});

describe('source-time core', () => {
  it('normalizeClipSpeed clamps and rejects invalid', () => {
    expect(normalizeClipSpeed(2)).toBe(2);
    expect(normalizeClipSpeed(0)).toBe(1);
    expect(normalizeClipSpeed(Number.NaN)).toBe(1);
    expect(normalizeClipSpeed(50)).toBe(10);
    expect(normalizeClipSpeed(-50)).toBe(-10);
    expect(normalizeClipSpeed('x' as unknown)).toBe(1);
  });

  it('returns source start when the source range is empty', () => {
    expect(
      resolveClipSourceTimeUs({
        localTimeUs: 5_000_000,
        sourceStartUs: 2_000_000,
        sourceRangeDurationUs: 0,
        speed: 1,
      }),
    ).toBe(2_000_000);
  });

  // KNOWN INTENTIONAL DIVERGENCE FROM THE NATIVE ENGINE.
  // When a frameRate is supplied, the web path pulls the readable tail back by half
  // a frame (because it seeks an exact PTS), whereas the native path uses the flat
  // guard and snaps to the nearest decoded frame. This case is therefore web-only
  // and deliberately excluded from the shared parity fixture.
  it('web-only half-frame guard pulls the readable tail back for 30fps', () => {
    const flatGuard = clampToLastReadableSourceUs(5_000_000);
    const halfFrameGuard = clampToLastReadableSourceUs(5_000_000, 30);
    expect(flatGuard).toBe(4_999_000); // guardSec === 0.001
    expect(halfFrameGuard).toBe(5_000_000 - Math.round(500_000 / 30));
    expect(halfFrameGuard).toBeLessThan(flatGuard);
  });

  it('maps source time from clip speed and source fps, independent of timeline fps', () => {
    const sourceUs = resolveClipSourceTimeUs({
      localTimeUs: 1_000_000,
      sourceStartUs: 2_000_000,
      sourceRangeDurationUs: 5_000_000,
      speed: 2,
      frameRate: 24,
    });

    expect(sourceUs).toBe(4_000_000);
  });

  it('maps negative-speed video from the readable tail backwards', () => {
    const sourceUs = resolveClipSourceTimeUs({
      localTimeUs: 500_000,
      sourceStartUs: 10_000_000,
      sourceRangeDurationUs: 5_000_000,
      speed: -2,
      frameRate: 25,
    });

    expect(sourceUs).toBe(10_000_000 + 5_000_000 - Math.round(500_000 / 25) - 1_000_000);
  });
});
