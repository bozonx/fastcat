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
    timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 },
    sourceRange: { startUs: 0, durationUs: 2_000_000 },
    ...overrides,
  } as TimelineClipItem;
}

describe('useClipKeyframes', () => {
  it('converts the absolute playhead to source-relative animation time', () => {
    const clip = ref(makeClip());
    const playheadUs = ref(1_500_000);
    const updateAnimations = vi.fn();
    const { localPlayheadUs } = useClipKeyframes({ clip, playheadUs, updateAnimations });
    expect(localPlayheadUs.value).toBe(500_000);
  });

  it('clamps animation time to the source range start when the playhead is before the clip', () => {
    const clip = ref(makeClip());
    const playheadUs = ref(0);
    const updateAnimations = vi.fn();
    const { localPlayheadUs } = useClipKeyframes({ clip, playheadUs, updateAnimations });
    expect(localPlayheadUs.value).toBe(0);
  });

  it('uses trim and speed when resolving animation time', () => {
    const clip = ref(
      makeClip({
        sourceRange: { startUs: 10_000, durationUs: 2_000 },
        speed: 2,
      }),
    );
    const playheadUs = ref(1_000_500);
    const updateAnimations = vi.fn();
    const { localPlayheadUs } = useClipKeyframes({ clip, playheadUs, updateAnimations });
    expect(localPlayheadUs.value).toBe(11_000);
  });

  it('uses reverse speed when resolving animation time', () => {
    const clip = ref(
      makeClip({
        sourceRange: { startUs: 10_000, durationUs: 2_000 },
        speed: -1,
      }),
    );
    const playheadUs = ref(1_001_000);
    const updateAnimations = vi.fn();
    const { localPlayheadUs } = useClipKeyframes({ clip, playheadUs, updateAnimations });
    expect(localPlayheadUs.value).toBe(11_000);
  });

  it('toggleAnimated turning ON seeds each path with the static value at the playhead', () => {
    const clip = ref(makeClip({ opacity: 0.6 }));
    const playheadUs = ref(1_500_000);
    let animations: ClipAnimations | undefined;
    const updateAnimations = vi.fn((next: ClipAnimations | undefined) => {
      animations = next;
    });
    const { toggleAnimated, isAnimated } = useClipKeyframes({ clip, playheadUs, updateAnimations });

    expect(isAnimated('opacity')).toBe(false);
    toggleAnimated(['opacity']);
    expect(animations?.opacity?.keyframes).toEqual([
      { tUs: 500_000, value: 0.6, easing: 'linear' },
    ]);
  });

  it('toggleAnimated turning OFF clears every path in the group', () => {
    const clip = ref(
      makeClip({
        transform: { position: { x: 5, y: 5 } },
        animations: {
          'transform.position.x': { keyframes: [{ tUs: 0, value: 5, easing: 'linear' }] },
          'transform.position.y': { keyframes: [{ tUs: 0, value: 5, easing: 'linear' }] },
        },
      }),
    );
    const playheadUs = ref(1_000_000);
    const updateAnimations = vi.fn();
    const { toggleAnimated } = useClipKeyframes({ clip, playheadUs, updateAnimations });

    toggleAnimated(['transform.position.x', 'transform.position.y']);
    expect(updateAnimations).toHaveBeenCalledWith(undefined);
  });

  it('recordValue upserts a keyframe when the path is animated, and reports it consumed the edit', () => {
    const clip = ref(
      makeClip({
        animations: { opacity: { keyframes: [{ tUs: 0, value: 0.2, easing: 'linear' }] } },
      }),
    );
    const playheadUs = ref(1_500_000);
    let animations: ClipAnimations | undefined;
    const updateAnimations = vi.fn((next: ClipAnimations | undefined) => {
      animations = next;
    });
    const { recordValue } = useClipKeyframes({ clip, playheadUs, updateAnimations });

    const consumed = recordValue('opacity', 0.9);
    expect(consumed).toBe(true);
    expect(animations?.opacity?.keyframes).toEqual([
      { tUs: 0, value: 0.2, easing: 'linear' },
      { tUs: 500_000, value: 0.9, easing: 'linear' },
    ]);
  });

  it('currentValue returns the interpolated value at the playhead when animated', () => {
    const clip = ref(
      makeClip({
        opacity: 0.1,
        animations: {
          opacity: {
            keyframes: [
              { tUs: 0, value: 0, easing: 'linear' },
              { tUs: 1_000_000, value: 1, easing: 'linear' },
            ],
          },
        },
      }),
    );
    const playheadUs = ref(1_500_000); // local 500_000 -> midpoint
    const updateAnimations = vi.fn();
    const { currentValue } = useClipKeyframes({ clip, playheadUs, updateAnimations });
    expect(currentValue('opacity', clip.value.opacity ?? 1)).toBeCloseTo(0.5, 6);
  });

  it('currentValue falls back to the static value when the path is not animated', () => {
    const clip = ref(makeClip({ opacity: 0.4 }));
    const playheadUs = ref(1_500_000);
    const updateAnimations = vi.fn();
    const { currentValue } = useClipKeyframes({ clip, playheadUs, updateAnimations });
    expect(currentValue('opacity', clip.value.opacity ?? 1)).toBe(0.4);
  });

  it('recordValue is a no-op and returns false when the path is not animated', () => {
    const clip = ref(makeClip());
    const playheadUs = ref(1_500_000);
    const updateAnimations = vi.fn();
    const { recordValue } = useClipKeyframes({ clip, playheadUs, updateAnimations });

    expect(recordValue('opacity', 0.9)).toBe(false);
    expect(updateAnimations).not.toHaveBeenCalled();
  });

  it('keyframeTimes / moveKeyframeMomentAt / deleteKeyframeMomentAt operate across all params', () => {
    const clip = ref(
      makeClip({
        animations: {
          opacity: { keyframes: [{ tUs: 100, value: 0.5, easing: 'linear' }] },
          'transform.rotationDeg': { keyframes: [{ tUs: 100, value: 45, easing: 'linear' }] },
        },
      }),
    );
    const playheadUs = ref(0);
    let animations: ClipAnimations | undefined;
    const updateAnimations = vi.fn((next: ClipAnimations | undefined) => {
      animations = next;
    });
    const { keyframeTimes, moveKeyframeMomentAt, deleteKeyframeMomentAt } = useClipKeyframes({
      clip,
      playheadUs,
      updateAnimations,
    });

    expect(keyframeTimes.value).toEqual([100]);

    moveKeyframeMomentAt(100, 300);
    expect(animations?.opacity?.keyframes[0]?.tUs).toBe(300);
    expect(animations?.['transform.rotationDeg']?.keyframes[0]?.tUs).toBe(300);

    clip.value = { ...clip.value, animations };
    deleteKeyframeMomentAt(300);
    expect(animations).toBeUndefined();
  });
});
