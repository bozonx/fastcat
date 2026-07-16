import { describe, expect, it, vi } from 'vitest';
import { TimelineApplyLifecycle } from '~/utils/video-editor/compositor/TimelineApplyLifecycle';
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

describe('TimelineApplyLifecycle', () => {
  const lifecycle = new TimelineApplyLifecycle();

  it('destroys clips that are in previous but not in next', () => {
    const destroyed: string[] = [];
    const destroyClip = vi.fn((clip: CompositorClip) => {
      destroyed.push(clip.itemId);
    });

    const prevA = makeClip({ itemId: 'a' });
    const prevB = makeClip({ itemId: 'b' });
    const nextC = makeClip({ itemId: 'c' });

    const previousClipById = new Map([
      ['a', prevA],
      ['b', prevB],
    ]);
    const nextClipById = new Map([['c', nextC]]);

    lifecycle.apply({
      previousClipById,
      replacedClipIds: new Set(),
      nextClips: [nextC],
      nextClipById,
      sequentialTimeTicks: 0,
      destroyClip,
    });

    expect(destroyClip).toHaveBeenCalledTimes(2);
    expect(destroyed).toContain('a');
    expect(destroyed).toContain('b');
  });

  it('does not destroy replaced clips', () => {
    const destroyClip = vi.fn();
    const prevA = makeClip({ itemId: 'a' });

    lifecycle.apply({
      previousClipById: new Map([['a', prevA]]),
      replacedClipIds: new Set(['a']),
      nextClips: [],
      nextClipById: new Map(),
      sequentialTimeTicks: 0,
      destroyClip,
    });

    expect(destroyClip).not.toHaveBeenCalled();
  });

  it('does not destroy clips that exist in next', () => {
    const destroyClip = vi.fn();
    const prevA = makeClip({ itemId: 'a' });
    const nextA = makeClip({ itemId: 'a' });

    lifecycle.apply({
      previousClipById: new Map([['a', prevA]]),
      replacedClipIds: new Set(),
      nextClips: [nextA],
      nextClipById: new Map([['a', nextA]]),
      sequentialTimeTicks: 0,
      destroyClip,
    });

    expect(destroyClip).not.toHaveBeenCalled();
  });

  it('clears replacedClipIds set after processing', () => {
    const replacedClipIds = new Set(['a', 'b']);

    lifecycle.apply({
      previousClipById: new Map(),
      replacedClipIds,
      nextClips: [],
      nextClipById: new Map(),
      sequentialTimeTicks: 0,
      destroyClip: vi.fn(),
    });

    expect(replacedClipIds.size).toBe(0);
  });

  it('computes maxDurationTicks as max(clipEnd, sequentialTimeTicks)', () => {
    const clips = [
      makeClip({ itemId: 'a', endTicks: 5_000_000 }),
      makeClip({ itemId: 'b', endTicks: 3_000_000 }),
    ];
    const clipById = new Map([
      ['a', clips[0]!],
      ['b', clips[1]!],
    ]);

    const result = lifecycle.apply({
      previousClipById: new Map(),
      replacedClipIds: new Set(),
      nextClips: clips,
      nextClipById: clipById,
      sequentialTimeTicks: 7_000_000,
      destroyClip: vi.fn(),
    });

    expect(result.maxDurationTicks).toBe(7_000_000);
  });

  it('uses max clip end when it exceeds sequentialTimeTicks', () => {
    const clips = [makeClip({ itemId: 'a', endTicks: 10_000_000 })];

    const result = lifecycle.apply({
      previousClipById: new Map(),
      replacedClipIds: new Set(),
      nextClips: clips,
      nextClipById: new Map([['a', clips[0]!]]),
      sequentialTimeTicks: 3_000_000,
      destroyClip: vi.fn(),
    });

    expect(result.maxDurationTicks).toBe(10_000_000);
  });

  it('returns 0 maxDurationTicks for empty clips and 0 sequential', () => {
    const result = lifecycle.apply({
      previousClipById: new Map(),
      replacedClipIds: new Set(),
      nextClips: [],
      nextClipById: new Map(),
      sequentialTimeTicks: 0,
      destroyClip: vi.fn(),
    });

    expect(result.maxDurationTicks).toBe(0);
  });

  it('sorts clips by startTicks then layer', () => {
    const clips = [
      makeClip({ itemId: 'c', startTicks: 5_000_000, layer: 0 }),
      makeClip({ itemId: 'a', startTicks: 1_000_000, layer: 2 }),
      makeClip({ itemId: 'b', startTicks: 1_000_000, layer: 1 }),
    ];
    const clipById = new Map(clips.map((c) => [c.itemId, c]));

    const result = lifecycle.apply({
      previousClipById: new Map(),
      replacedClipIds: new Set(),
      nextClips: clips,
      nextClipById: clipById,
      sequentialTimeTicks: 0,
      destroyClip: vi.fn(),
    });

    expect(result.clips.map((c) => c.itemId)).toEqual(['b', 'a', 'c']);
  });

  it('sets lastRenderedTimeTicks to NaN to force a full render of the loaded timeline', () => {
    const result = lifecycle.apply({
      previousClipById: new Map(),
      replacedClipIds: new Set(),
      nextClips: [makeClip()],
      nextClipById: new Map([['c1', makeClip()]]),
      sequentialTimeTicks: 0,
      destroyClip: vi.fn(),
    });

    // NaN never equals the incoming timeTicks, so the RenderingEngine early-exit is
    // defeated and the previous timeline's stale frame cannot linger at timeTicks 0.
    expect(result.lastRenderedTimeTicks).toBeNaN();
  });
});
