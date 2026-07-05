/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  ANIMATABLE_PARAM_PATHS,
  clampAnimatedValue,
  evalTrackAt,
  hasAnyAnimation,
  hasKeyframes,
  normalizeKeyframeTrack,
  resolveClipAnimationTimeUs,
  resolveKeyframeTimelineTimeUs,
  sampleClipAnimations,
} from '~/timeline/animation/evaluate';
import type { KeyframeTrack } from '~/timeline/types';

const track = (
  ...kfs: [tUs: number, value: number, easing?: 'linear' | 'ease' | 'hold'][]
): KeyframeTrack => ({
  keyframes: kfs.map(([tUs, value, easing = 'linear']) => ({ tUs, value, easing })),
});

describe('normalizeKeyframeTrack', () => {
  it('sorts by time, clamps negative times, and dedups (last write wins)', () => {
    const t = normalizeKeyframeTrack(track([100, 2], [-5, 9], [0, 1], [0, 5]));
    expect(t.keyframes.map((k) => [k.tUs, k.value])).toEqual([
      [0, 5],
      [100, 2],
    ]);
  });

  it('rounds fractional times and defaults easing to linear', () => {
    const t = normalizeKeyframeTrack({ keyframes: [{ tUs: 10.6, value: 1 } as never] });
    expect(t.keyframes[0]).toEqual({ tUs: 11, value: 1, easing: 'linear' });
  });

  it('normalizes invalid easing to linear', () => {
    const t = normalizeKeyframeTrack({
      keyframes: [{ tUs: 10, value: 1, easing: 'snappy' } as never],
    });
    expect(t.keyframes[0]).toEqual({ tUs: 10, value: 1, easing: 'linear' });
  });
});

describe('resolveClipAnimationTimeUs', () => {
  it('maps timeline time through trim and forward speed', () => {
    expect(
      resolveClipAnimationTimeUs({
        timelineTimeUs: 1_500,
        timelineStartUs: 1_000,
        sourceStartUs: 10_000,
        sourceRangeDurationUs: 2_000,
        speed: 2,
      }),
    ).toBe(11_000);
  });

  it('maps reverse clips from the end of the source range', () => {
    expect(
      resolveClipAnimationTimeUs({
        timelineTimeUs: 1_500,
        timelineStartUs: 1_000,
        sourceStartUs: 10_000,
        sourceRangeDurationUs: 2_000,
        speed: -1,
      }),
    ).toBe(11_500);
  });
});

describe('evalTrackAt', () => {
  it('returns undefined for an empty/absent track', () => {
    expect(evalTrackAt(undefined, 0)).toBeUndefined();
    expect(evalTrackAt({ keyframes: [] }, 0)).toBeUndefined();
  });

  it('holds the boundary value before first and after last (no extrapolation)', () => {
    const t = track([100, 0.2], [300, 0.8]);
    expect(evalTrackAt(t, 0)).toBe(0.2);
    expect(evalTrackAt(t, 100)).toBe(0.2);
    expect(evalTrackAt(t, 300)).toBe(0.8);
    expect(evalTrackAt(t, 9999)).toBe(0.8);
  });

  it('interpolates linearly at the midpoint', () => {
    const t = track([0, 0], [200, 1]);
    expect(evalTrackAt(t, 100)).toBeCloseTo(0.5, 6);
    expect(evalTrackAt(t, 50)).toBeCloseTo(0.25, 6);
  });

  it('eases (smoothstep) — midpoint equals linear, but slope is flat at edges', () => {
    const t = track([0, 0, 'ease'], [100, 1]);
    expect(evalTrackAt(t, 50)).toBeCloseTo(0.5, 6);
    // smoothstep(0.25) = 0.15625 < linear 0.25
    expect(evalTrackAt(t, 25)).toBeCloseTo(0.15625, 6);
  });

  it('holds the left value across a hold segment, then jumps', () => {
    const t = track([0, 0.3, 'hold'], [100, 0.9]);
    expect(evalTrackAt(t, 50)).toBe(0.3);
    expect(evalTrackAt(t, 99)).toBe(0.3);
    expect(evalTrackAt(t, 100)).toBe(0.9);
  });

  it('jumps to the right value across a zero-length (coincident) mid segment', () => {
    // A hard cut in the middle: two keyframes share t=100. Querying at the cut
    // must resolve to the post-cut value, not divide by a zero span.
    const t: KeyframeTrack = {
      keyframes: [
        { tUs: 0, value: 0, easing: 'linear' },
        { tUs: 100, value: 0.1, easing: 'linear' },
        { tUs: 100, value: 0.7, easing: 'linear' },
        { tUs: 200, value: 1, easing: 'linear' },
      ],
    };
    expect(evalTrackAt(t, 100)).toBe(0.7);
    expect(evalTrackAt(t, 150)).toBeCloseTo(0.85, 6);
  });
});

describe('clampAnimatedValue', () => {
  it('clamps opacity to [0,1] and scale to non-negative', () => {
    expect(clampAnimatedValue('opacity', 1.5)).toBe(1);
    expect(clampAnimatedValue('opacity', -0.2)).toBe(0);
    expect(clampAnimatedValue('transform.scale.x', -3)).toBe(0);
  });

  it('passes finite position/rotation through unbounded', () => {
    expect(clampAnimatedValue('transform.position.x', -5000)).toBe(-5000);
    expect(clampAnimatedValue('transform.rotationDeg', 720)).toBe(720);
  });
});

describe('sampleClipAnimations', () => {
  it('samples only keyframed paths and clamps the result', () => {
    const out = sampleClipAnimations(
      {
        opacity: track([0, 2], [100, 2]), // above range -> clamped to 1
        'transform.rotationDeg': track([0, 0], [100, 90]),
      },
      50,
    );
    expect(out.opacity).toBe(1);
    expect(out['transform.rotationDeg']).toBeCloseTo(45, 6);
    expect(out['transform.position.x']).toBeUndefined();
  });

  it('returns an empty object for no animations', () => {
    expect(sampleClipAnimations(undefined, 0)).toEqual({});
    expect(sampleClipAnimations({}, 0)).toEqual({});
  });
});

describe('helpers', () => {
  it('hasKeyframes / hasAnyAnimation reflect track contents', () => {
    expect(hasKeyframes(undefined)).toBe(false);
    expect(hasKeyframes({ keyframes: [] })).toBe(false);
    expect(hasKeyframes(track([0, 1]))).toBe(true);
    expect(hasAnyAnimation(undefined)).toBe(false);
    expect(hasAnyAnimation({ 'transform.scale.x': { keyframes: [] } })).toBe(false);
    expect(hasAnyAnimation({ opacity: track([0, 1]) })).toBe(true);
  });

  it('exposes the closed set of animatable paths', () => {
    expect(ANIMATABLE_PARAM_PATHS).toContain('opacity');
    expect(ANIMATABLE_PARAM_PATHS).toContain('transform.rotationDeg');
    expect(ANIMATABLE_PARAM_PATHS.length).toBe(6);
  });
});

describe('resolveKeyframeTimelineTimeUs', () => {
  it('inverts resolveClipAnimationTimeUs for forward playback (round-trip)', () => {
    const base = {
      timelineStartUs: 2_000_000,
      sourceStartUs: 1_000_000,
      sourceRangeDurationUs: 5_000_000,
      speed: 1,
    };
    for (const timelineTimeUs of [2_000_000, 3_500_000, 6_000_000]) {
      const sourceTimeUs = resolveClipAnimationTimeUs({ ...base, timelineTimeUs });
      const back = resolveKeyframeTimelineTimeUs({ ...base, sourceTimeUs });
      expect(back).toBeCloseTo(timelineTimeUs, -1);
    }
  });

  it('inverts under 2x speed', () => {
    const base = {
      timelineStartUs: 0,
      sourceStartUs: 0,
      sourceRangeDurationUs: 10_000_000,
      speed: 2,
    };
    const sourceTimeUs = resolveClipAnimationTimeUs({ ...base, timelineTimeUs: 1_000_000 });
    // 1s of timeline at 2x = 2s of source
    expect(sourceTimeUs).toBe(2_000_000);
    expect(resolveKeyframeTimelineTimeUs({ ...base, sourceTimeUs })).toBe(1_000_000);
  });

  it('maps a source keyframe back to timeline time for reverse playback', () => {
    const base = {
      timelineStartUs: 0,
      sourceStartUs: 0,
      sourceRangeDurationUs: 4_000_000,
      speed: -1,
    };
    // At the clip start (timeline 0) reverse samples the source tail.
    const head = resolveClipAnimationTimeUs({ ...base, timelineTimeUs: 0 });
    expect(resolveKeyframeTimelineTimeUs({ ...base, sourceTimeUs: head })).toBe(0);
  });
});
