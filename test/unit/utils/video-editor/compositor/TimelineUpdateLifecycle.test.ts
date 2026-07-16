import { describe, expect, it, vi } from 'vitest';
import { TimelineUpdateLifecycle } from '~/utils/video-editor/compositor/TimelineUpdateLifecycle';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeClip(overrides: Partial<CompositorClip> = {}): CompositorClip {
  return {
    itemId: 'c1',
    layer: 0,
    startTicks: 0,
    endTicks: 5_000_000,
    durationTicks: 5_000_000,
    sourceStartTicks: 0,
    sourceRangeDurationTicks: 5_000_000,
    sourceDurationTicks: 10_000_000,
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

  it('returns maxDurationTicks as max of all clip endTicks', () => {
    const clips = [
      makeClip({ itemId: 'a', startTicks: 0, endTicks: 3_000_000 }),
      makeClip({ itemId: 'b', startTicks: 2_000_000, endTicks: 8_000_000 }),
      makeClip({ itemId: 'c', startTicks: 5_000_000, endTicks: 6_000_000 }),
    ];

    const result = lifecycle.apply(clips);

    expect(result.maxDurationTicks).toBe(8_000_000);
  });

  it('returns 0 for empty clips array', () => {
    const result = lifecycle.apply([]);

    expect(result.maxDurationTicks).toBe(0);
  });

  it('sorts clips by startTicks then layer', () => {
    const clips = [
      makeClip({ itemId: 'c', startTicks: 5_000_000, layer: 0 }),
      makeClip({ itemId: 'a', startTicks: 1_000_000, layer: 2 }),
      makeClip({ itemId: 'b', startTicks: 1_000_000, layer: 1 }),
    ];

    const result = lifecycle.apply(clips);

    expect(result.clips.map((c) => c.itemId)).toEqual(['b', 'a', 'c']);
  });

  it('sets stageSortDirty and activeSortDirty to true', () => {
    const result = lifecycle.apply([makeClip()]);

    expect(result.stageSortDirty).toBe(true);
    expect(result.activeSortDirty).toBe(true);
  });

  it('sets lastRenderedTimeTicks to NaN', () => {
    const result = lifecycle.apply([makeClip()]);

    expect(Number.isNaN(result.lastRenderedTimeTicks)).toBe(true);
  });

  it('clamps maxDurationTicks to 0 when all endTicks are negative', () => {
    const clips = [
      makeClip({ itemId: 'a', endTicks: -100 }),
      makeClip({ itemId: 'b', endTicks: -200 }),
    ];

    const result = lifecycle.apply(clips);

    expect(result.maxDurationTicks).toBe(0);
  });
});
