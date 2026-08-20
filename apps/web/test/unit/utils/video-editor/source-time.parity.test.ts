import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TICKS_PER_SECOND } from '~/utils/time';
import {
  resolveClipSourceTimeTicks,
  clampToLastReadableSourceTicks,
  normalizeClipSpeed,
} from '~/utils/video-editor/source-time';

/**
 * Cross-engine parity contract. This test and the Rust test
 * `monitor::scene::tests::clip_source_pts_matches_shared_parity_fixture` read the
 * SAME fixture, so the web `resolveClipSourceTimeTicks` and the native
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
  readFileSync(resolveSharedPath('parity/clip-source-pts.cases.json'), 'utf8'),
) as { guardSec: number; cases: ParityCase[] };

describe('clip source-PTS parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      const localTimeTicks = (c.timelineSec - c.timelineStartSec) * TICKS_PER_SECOND;
      const sourceTicks = resolveClipSourceTimeTicks({
        localTimeTicks,
        sourceStartTicks: c.sourceStartSec * TICKS_PER_SECOND,
        sourceRangeDurationTicks: c.sourceRangeDurationSec * TICKS_PER_SECOND,
        speed: c.speed,
        // No frameRate: this is the frame-rate-independent region where the two
        // engines agree exactly (the guard is the flat fixture.guardSec).
      });
      expect(sourceTicks / TICKS_PER_SECOND).toBeCloseTo(c.expectedSourceSec, 5);
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
      resolveClipSourceTimeTicks({
        localTimeTicks: 5 * TICKS_PER_SECOND,
        sourceStartTicks: 2 * TICKS_PER_SECOND,
        sourceRangeDurationTicks: 0,
        speed: 1,
      }),
    ).toBe(2 * TICKS_PER_SECOND);
  });

  // KNOWN INTENTIONAL DIVERGENCE FROM THE NATIVE ENGINE.
  // When a frameRate is supplied, the web path pulls the readable tail back by half
  // a frame (because it seeks an exact PTS), whereas the native path uses the flat
  // guard and snaps to the nearest decoded frame. This case is therefore web-only
  // and deliberately excluded from the shared parity fixture.
  it('web-only half-frame guard pulls the readable tail back for 30fps', () => {
    const flatGuard = clampToLastReadableSourceTicks(5 * TICKS_PER_SECOND);
    const halfFrameGuard = clampToLastReadableSourceTicks(5 * TICKS_PER_SECOND, 30);
    expect(flatGuard).toBe(5 * TICKS_PER_SECOND - TICKS_PER_SECOND / 1_000); // guardSec === 0.001
    expect(halfFrameGuard).toBe(5 * TICKS_PER_SECOND - Math.round(TICKS_PER_SECOND / (2 * 30)));
    expect(halfFrameGuard).toBeLessThan(flatGuard);
  });

  it('maps source time from clip speed and source fps, independent of timeline fps', () => {
    const sourceTicks = resolveClipSourceTimeTicks({
      localTimeTicks: 1 * TICKS_PER_SECOND,
      sourceStartTicks: 2 * TICKS_PER_SECOND,
      sourceRangeDurationTicks: 5 * TICKS_PER_SECOND,
      speed: 2,
      frameRate: 24,
    });

    expect(sourceTicks).toBe(4 * TICKS_PER_SECOND);
  });

  it('maps negative-speed video from the readable tail backwards', () => {
    const sourceTicks = resolveClipSourceTimeTicks({
      localTimeTicks: TICKS_PER_SECOND / 2,
      sourceStartTicks: 10 * TICKS_PER_SECOND,
      sourceRangeDurationTicks: 5 * TICKS_PER_SECOND,
      speed: -2,
      frameRate: 25,
    });

    expect(sourceTicks).toBe(
      10 * TICKS_PER_SECOND +
        5 * TICKS_PER_SECOND -
        Math.round(TICKS_PER_SECOND / (2 * 25)) -
        1 * TICKS_PER_SECOND,
    );
  });
});
