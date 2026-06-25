import { describe, expect, it, vi } from 'vitest';
import { TimelineApplyLifecycle } from '~/utils/video-editor/compositor/TimelineApplyLifecycle';
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
      sequentialTimeUs: 0,
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
      sequentialTimeUs: 0,
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
      sequentialTimeUs: 0,
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
      sequentialTimeUs: 0,
      destroyClip: vi.fn(),
    });

    expect(replacedClipIds.size).toBe(0);
  });

  it('computes maxDurationUs as max(clipEnd, sequentialTimeUs)', () => {
    const clips = [
      makeClip({ itemId: 'a', endUs: 5_000_000 }),
      makeClip({ itemId: 'b', endUs: 3_000_000 }),
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
      sequentialTimeUs: 7_000_000,
      destroyClip: vi.fn(),
    });

    expect(result.maxDurationUs).toBe(7_000_000);
  });

  it('uses max clip end when it exceeds sequentialTimeUs', () => {
    const clips = [
      makeClip({ itemId: 'a', endUs: 10_000_000 }),
    ];

    const result = lifecycle.apply({
      previousClipById: new Map(),
      replacedClipIds: new Set(),
      nextClips: clips,
      nextClipById: new Map([['a', clips[0]!]]),
      sequentialTimeUs: 3_000_000,
      destroyClip: vi.fn(),
    });

    expect(result.maxDurationUs).toBe(10_000_000);
  });

  it('returns 0 maxDurationUs for empty clips and 0 sequential', () => {
    const result = lifecycle.apply({
      previousClipById: new Map(),
      replacedClipIds: new Set(),
      nextClips: [],
      nextClipById: new Map(),
      sequentialTimeUs: 0,
      destroyClip: vi.fn(),
    });

    expect(result.maxDurationUs).toBe(0);
  });

  it('sorts clips by startUs then layer', () => {
    const clips = [
      makeClip({ itemId: 'c', startUs: 5_000_000, layer: 0 }),
      makeClip({ itemId: 'a', startUs: 1_000_000, layer: 2 }),
      makeClip({ itemId: 'b', startUs: 1_000_000, layer: 1 }),
    ];
    const clipById = new Map(clips.map((c) => [c.itemId, c]));

    const result = lifecycle.apply({
      previousClipById: new Map(),
      replacedClipIds: new Set(),
      nextClips: clips,
      nextClipById: clipById,
      sequentialTimeUs: 0,
      destroyClip: vi.fn(),
    });

    expect(result.clips.map((c) => c.itemId)).toEqual(['b', 'a', 'c']);
  });

  it('sets lastRenderedTimeUs to 0', () => {
    const result = lifecycle.apply({
      previousClipById: new Map(),
      replacedClipIds: new Set(),
      nextClips: [makeClip()],
      nextClipById: new Map([['c1', makeClip()]]),
      sequentialTimeUs: 0,
      destroyClip: vi.fn(),
    });

    expect(result.lastRenderedTimeUs).toBe(0);
  });
});
