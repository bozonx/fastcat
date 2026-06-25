import { describe, expect, it, vi } from 'vitest';
import { TimelineUpdateLifecycle } from '~/utils/video-editor/compositor/TimelineUpdateLifecycle';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeClip(overrides: Partial<CompositorClip> = {}): CompositorClip {
  return {
    itemId: 'c1',
    layer: 0,
    startUs: 0,
    endUs: 5_000_000,
    durationUs: 5_000_000,
    sourceStartUs: 0,
    sourceRangeDurationUs: 5_000_000,
    sourceDurationUs: 10_000_000,
    sprite: null,
    imageSource: null as any,
    lastVideoFrame: null,
    canvas: null,
    ctx: null,
    bitmap: null,
    ...overrides,
  } as unknown as CompositorClip;
}

describe('TimelineUpdateLifecycle', () => {
  const lifecycle = new TimelineUpdateLifecycle();

  it('returns maxDurationUs as max of all clip endUs', () => {
    const clips = [
      makeClip({ itemId: 'a', startUs: 0, endUs: 3_000_000 }),
      makeClip({ itemId: 'b', startUs: 2_000_000, endUs: 8_000_000 }),
      makeClip({ itemId: 'c', startUs: 5_000_000, endUs: 6_000_000 }),
    ];

    const result = lifecycle.apply(clips);

    expect(result.maxDurationUs).toBe(8_000_000);
  });

  it('returns 0 for empty clips array', () => {
    const result = lifecycle.apply([]);

    expect(result.maxDurationUs).toBe(0);
  });

  it('sorts clips by startUs then layer', () => {
    const clips = [
      makeClip({ itemId: 'c', startUs: 5_000_000, layer: 0 }),
      makeClip({ itemId: 'a', startUs: 1_000_000, layer: 2 }),
      makeClip({ itemId: 'b', startUs: 1_000_000, layer: 1 }),
    ];

    const result = lifecycle.apply(clips);

    expect(result.clips.map((c) => c.itemId)).toEqual(['b', 'a', 'c']);
  });

  it('sets stageSortDirty and activeSortDirty to true', () => {
    const result = lifecycle.apply([makeClip()]);

    expect(result.stageSortDirty).toBe(true);
    expect(result.activeSortDirty).toBe(true);
  });

  it('sets lastRenderedTimeUs to NaN', () => {
    const result = lifecycle.apply([makeClip()]);

    expect(Number.isNaN(result.lastRenderedTimeUs)).toBe(true);
  });

  it('clamps maxDurationUs to 0 when all endUs are negative', () => {
    const clips = [
      makeClip({ itemId: 'a', endUs: -100 }),
      makeClip({ itemId: 'b', endUs: -200 }),
    ];

    const result = lifecycle.apply(clips);

    expect(result.maxDurationUs).toBe(0);
  });
});
