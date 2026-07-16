/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useClipKeyframes } from '~/composables/timeline/useClipKeyframes';
import type { ClipAnimations, TimelineClipItem } from '~/timeline/types';

function makeClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'clip-1',
    trackId: 'v1',
    name: 'Clip',
    timelineRange: { startTicks: 1_000_000, durationTicks: 2_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 2_000_000 },
    ...overrides,
  } as TimelineClipItem;
}

describe('useClipKeyframes', () => {
  it('converts the absolute playhead to source-relative animation time', () => {
    const clip = ref(makeClip());
    const playheadTicks = ref(1_500_000);
    const updateAnimations = vi.fn();
    const { localPlayheadTicks } = useClipKeyframes({ clip, playheadTicks, updateAnimations });
    expect(localPlayheadTicks.value).toBe(500_000);
  });

  it('clamps animation time to the source range start when the playhead is before the clip', () => {
    const clip = ref(makeClip());
    const playheadTicks = ref(0);
    const updateAnimations = vi.fn();
    const { localPlayheadTicks } = useClipKeyframes({ clip, playheadTicks, updateAnimations });
    expect(localPlayheadTicks.value).toBe(0);
  });

  it('uses trim and speed when resolving animation time', () => {
    const clip = ref(
      makeClip({
        sourceRange: { startTicks: 10_000, durationTicks: 2_000 },
        speed: 2,
      }),
    );
    const playheadTicks = ref(1_000_500);
    const updateAnimations = vi.fn();
    const { localPlayheadTicks } = useClipKeyframes({ clip, playheadTicks, updateAnimations });
    expect(localPlayheadTicks.value).toBe(11_000);
  });

  it('uses reverse speed when resolving animation time', () => {
    const clip = ref(
      makeClip({
        sourceRange: { startTicks: 10_000, durationTicks: 2_000 },
        speed: -1,
      }),
    );
    const playheadTicks = ref(1_001_000);
    const updateAnimations = vi.fn();
    const { localPlayheadTicks } = useClipKeyframes({ clip, playheadTicks, updateAnimations });
    expect(localPlayheadTicks.value).toBe(11_000);
  });

  it('toggleAnimated turning ON seeds each path with the static value at the playhead', () => {
    const clip = ref(makeClip({ opacity: 0.6 }));
    const playheadTicks = ref(1_500_000);
    let animations: ClipAnimations | undefined;
    const updateAnimations = vi.fn((next: ClipAnimations | undefined) => {
      animations = next;
    });
    const { toggleAnimated, isAnimated } = useClipKeyframes({ clip, playheadTicks, updateAnimations });

    expect(isAnimated('opacity')).toBe(false);
    toggleAnimated(['opacity']);
    expect(animations?.opacity?.keyframes).toEqual([
      { tTicks: 500_000, value: 0.6, easing: 'linear' },
    ]);
  });

  it('toggleAnimated seeds audio volume and pan from static audio fields', () => {
    const clip = ref(makeClip({ audioGain: 0.35, audioBalance: -0.25 }));
    const playheadTicks = ref(1_500_000);
    let animations: ClipAnimations | undefined;
    const updateAnimations = vi.fn((next: ClipAnimations | undefined) => {
      animations = next;
    });
    const { toggleAnimated } = useClipKeyframes({ clip, playheadTicks, updateAnimations });

    toggleAnimated(['audio.volume', 'audio.pan']);
    expect(animations?.['audio.volume']?.keyframes).toEqual([
      { tTicks: 500_000, value: 0.35, easing: 'linear' },
    ]);
    expect(animations?.['audio.pan']?.keyframes).toEqual([
      { tTicks: 500_000, value: -0.25, easing: 'linear' },
    ]);
  });

  it('toggleAnimated turning OFF clears every path in the group', () => {
    const clip = ref(
      makeClip({
        transform: { position: { x: 5, y: 5 } },
        animations: {
          'transform.position.x': { keyframes: [{ tTicks: 0, value: 5, easing: 'linear' }] },
          'transform.position.y': { keyframes: [{ tTicks: 0, value: 5, easing: 'linear' }] },
        },
      }),
    );
    const playheadTicks = ref(1_000_000);
    const updateAnimations = vi.fn();
    const { toggleAnimated } = useClipKeyframes({ clip, playheadTicks, updateAnimations });

    toggleAnimated(['transform.position.x', 'transform.position.y']);
    expect(updateAnimations).toHaveBeenCalledWith(undefined);
  });

  it('recordValue upserts a keyframe when the path is animated, and reports it consumed the edit', () => {
    const clip = ref(
      makeClip({
        animations: { opacity: { keyframes: [{ tTicks: 0, value: 0.2, easing: 'linear' }] } },
      }),
    );
    const playheadTicks = ref(1_500_000);
    let animations: ClipAnimations | undefined;
    const updateAnimations = vi.fn((next: ClipAnimations | undefined) => {
      animations = next;
    });
    const { recordValue } = useClipKeyframes({ clip, playheadTicks, updateAnimations });

    const consumed = recordValue('opacity', 0.9);
    expect(consumed).toBe(true);
    expect(animations?.opacity?.keyframes).toEqual([
      { tTicks: 0, value: 0.2, easing: 'linear' },
      { tTicks: 500_000, value: 0.9, easing: 'linear' },
    ]);
  });

  it('currentValue returns the interpolated value at the playhead when animated', () => {
    const clip = ref(
      makeClip({
        opacity: 0.1,
        animations: {
          opacity: {
            keyframes: [
              { tTicks: 0, value: 0, easing: 'linear' },
              { tTicks: 1_000_000, value: 1, easing: 'linear' },
            ],
          },
        },
      }),
    );
    const playheadTicks = ref(1_500_000); // local 500_000 -> midpoint
    const updateAnimations = vi.fn();
    const { currentValue } = useClipKeyframes({ clip, playheadTicks, updateAnimations });
    expect(currentValue('opacity', clip.value.opacity ?? 1)).toBeCloseTo(0.5, 6);
  });

  it('currentValue falls back to the static value when the path is not animated', () => {
    const clip = ref(makeClip({ opacity: 0.4 }));
    const playheadTicks = ref(1_500_000);
    const updateAnimations = vi.fn();
    const { currentValue } = useClipKeyframes({ clip, playheadTicks, updateAnimations });
    expect(currentValue('opacity', clip.value.opacity ?? 1)).toBe(0.4);
  });

  it('recordValue is a no-op and returns false when the path is not animated', () => {
    const clip = ref(makeClip());
    const playheadTicks = ref(1_500_000);
    const updateAnimations = vi.fn();
    const { recordValue } = useClipKeyframes({ clip, playheadTicks, updateAnimations });

    expect(recordValue('opacity', 0.9)).toBe(false);
    expect(updateAnimations).not.toHaveBeenCalled();
  });

  it('keyframeTimes / moveKeyframeMomentAt / deleteKeyframeMomentAt operate across all params', () => {
    const clip = ref(
      makeClip({
        animations: {
          opacity: { keyframes: [{ tTicks: 100, value: 0.5, easing: 'linear' }] },
          'transform.rotationDeg': { keyframes: [{ tTicks: 100, value: 45, easing: 'linear' }] },
        },
      }),
    );
    const playheadTicks = ref(0);
    let animations: ClipAnimations | undefined;
    const updateAnimations = vi.fn((next: ClipAnimations | undefined) => {
      animations = next;
    });
    const { keyframeTimes, moveKeyframeMomentAt, deleteKeyframeMomentAt } = useClipKeyframes({
      clip,
      playheadTicks,
      updateAnimations,
    });

    expect(keyframeTimes.value).toEqual([100]);

    moveKeyframeMomentAt(100, 300);
    expect(animations?.opacity?.keyframes[0]?.tTicks).toBe(300);
    expect(animations?.['transform.rotationDeg']?.keyframes[0]?.tTicks).toBe(300);

    clip.value = { ...clip.value, animations };
    deleteKeyframeMomentAt(300);
    expect(animations).toBeUndefined();
  });

  it('toggleKeyframeAtPlayhead adds when off a keyframe and removes when on one', () => {
    const clip = ref(
      makeClip({
        animations: { opacity: { keyframes: [{ tTicks: 0, value: 0.2, easing: 'linear' }] } },
      }),
    );
    const playheadTicks = ref(1_500_000); // local 500_000, not on a keyframe
    let animations: ClipAnimations | undefined;
    const updateAnimations = vi.fn((next: ClipAnimations | undefined) => {
      animations = next;
    });
    const kf = useClipKeyframes({ clip, playheadTicks, updateAnimations });

    expect(kf.isOnKeyframe.value).toBe(false);
    kf.toggleKeyframeAtPlayhead();
    expect(animations?.opacity?.keyframes.map((k) => k.tTicks)).toContain(500_000);

    // Now sit on the new keyframe and toggle again -> removed.
    clip.value = { ...clip.value, animations };
    expect(kf.isOnKeyframe.value).toBe(true);
    kf.toggleKeyframeAtPlayhead();
    expect(animations?.opacity?.keyframes.map((k) => k.tTicks)).not.toContain(500_000);
  });

  it('seekNextKeyframe / seekPrevKeyframe move the playhead to adjacent keyframe timeline times', () => {
    const clip = ref(
      makeClip({
        // timelineStart 1_000_000, source-relative keyframes at 0 and 1_000_000 -> timeline 1_000_000 & 2_000_000
        animations: {
          opacity: {
            keyframes: [
              { tTicks: 0, value: 0, easing: 'linear' },
              { tTicks: 1_000_000, value: 1, easing: 'linear' },
            ],
          },
        },
      }),
    );
    const playheadTicks = ref(1_500_000);
    const seek = vi.fn();
    const kf = useClipKeyframes({ clip, playheadTicks, updateAnimations: vi.fn(), seek });

    kf.seekNextKeyframe();
    expect(seek).toHaveBeenLastCalledWith(2_000_000);

    kf.seekPrevKeyframe();
    expect(seek).toHaveBeenLastCalledWith(1_000_000);
  });

  it('seek is clamped to the clip timeline range and is a no-op without a seek callback', () => {
    const clip = ref(makeClip());
    const playheadTicks = ref(1_500_000);
    const kf = useClipKeyframes({ clip, playheadTicks, updateAnimations: vi.fn() });
    // No seek callback provided: navigation must not throw.
    expect(() => kf.seekNextKeyframe()).not.toThrow();
  });

  it('toggleEffectParam ON seeds an effect.<id>.<key> keyframe; OFF clears it', () => {
    const clip = ref(makeClip());
    const playheadTicks = ref(1_500_000); // local 500_000
    let animations: ClipAnimations | undefined;
    const updateAnimations = vi.fn((next: ClipAnimations | undefined) => {
      animations = next;
    });
    const kf = useClipKeyframes({ clip, playheadTicks, updateAnimations });

    kf.toggleEffectParam('fx1', 'radius', 8);
    expect(animations?.['effect.fx1.radius']?.keyframes).toEqual([
      { tTicks: 500_000, value: 8, easing: 'linear' },
    ]);

    clip.value = { ...clip.value, animations };
    expect(kf.isEffectParamAnimated('fx1', 'radius')).toBe(true);
    kf.toggleEffectParam('fx1', 'radius', 8);
    expect(animations).toBeUndefined();
  });

  it('recordEffectParam upserts when animated (true) and no-ops otherwise (false)', () => {
    const clip = ref(
      makeClip({
        animations: {
          'effect.fx1.radius': { keyframes: [{ tTicks: 0, value: 8, easing: 'linear' }] },
        },
      }),
    );
    const playheadTicks = ref(1_500_000);
    let animations: ClipAnimations | undefined;
    const updateAnimations = vi.fn((next: ClipAnimations | undefined) => {
      animations = next;
    });
    const kf = useClipKeyframes({ clip, playheadTicks, updateAnimations });

    expect(kf.recordEffectParam('fx1', 'radius', 40)).toBe(true);
    expect(animations?.['effect.fx1.radius']?.keyframes.at(-1)).toEqual({
      tTicks: 500_000,
      value: 40,
      easing: 'linear',
    });
    expect(kf.recordEffectParam('fx1', 'mix', 0.5)).toBe(false);
  });

  it('effectParamDisplayValue interpolates at the playhead when animated', () => {
    const clip = ref(
      makeClip({
        animations: {
          'effect.fx1.radius': {
            keyframes: [
              { tTicks: 0, value: 0, easing: 'linear' },
              { tTicks: 1_000_000, value: 100, easing: 'linear' },
            ],
          },
        },
      }),
    );
    const playheadTicks = ref(1_500_000); // local 500_000 -> midpoint
    const kf = useClipKeyframes({ clip, playheadTicks, updateAnimations: vi.fn() });
    expect(kf.effectParamDisplayValue('fx1', 'radius', 0)).toBeCloseTo(50);
    expect(kf.effectParamDisplayValue('fx1', 'other', 7)).toBe(7);
  });
});
