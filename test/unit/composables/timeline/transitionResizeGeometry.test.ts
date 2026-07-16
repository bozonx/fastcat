import { describe, expect, it } from 'vitest';
import {
  getOrderedClipsOnTrack,
  getAdjacentClipForTransitionEdge,
  getTransitionAdjacentHandleLimitTicks,
  computeMaxResizableTransitionDurationTicks,
  computeTransitionHandleSnapDurationTicks,
} from '~/composables/timeline/transitionResizeGeometry';
import { timelineTicks } from '../../utils/timeline-time';

function clip(overrides: Record<string, unknown> = {}): any {
  const result = {
    id: 'c',
    kind: 'clip',
    clipType: 'media',
    trackId: 'v1',
    timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
    ...overrides,
  };
  return {
    ...result,
    timelineRange: {
      startTicks: timelineTicks(result.timelineRange.startTicks),
      durationTicks: timelineTicks(result.timelineRange.durationTicks),
    },
    sourceRange: {
      startTicks: timelineTicks(result.sourceRange.startTicks),
      durationTicks: timelineTicks(result.sourceRange.durationTicks),
    },
    sourceDurationTicks:
      result.sourceDurationTicks === undefined ? undefined : timelineTicks(result.sourceDurationTicks),
    transitionIn: result.transitionIn && {
      ...result.transitionIn,
      durationTicks: timelineTicks(result.transitionIn.durationTicks),
    },
    transitionOut: result.transitionOut && {
      ...result.transitionOut,
      durationTicks: timelineTicks(result.transitionOut.durationTicks),
    },
  };
}

function track(items: any[]): any {
  return { id: 'v1', kind: 'video', items };
}

describe('getOrderedClipsOnTrack', () => {
  it('returns clips sorted by start time and drops non-clip items', () => {
    const t = track([
      clip({ id: 'b', timelineRange: { startTicks: 5_000_000, durationTicks: 1_000_000 } }),
      { id: 'gap', kind: 'gap', timelineRange: { startTicks: 0, durationTicks: 1 } },
      clip({ id: 'a', timelineRange: { startTicks: 0, durationTicks: 1_000_000 } }),
    ]);
    expect(getOrderedClipsOnTrack(t).map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('getAdjacentClipForTransitionEdge', () => {
  const a = clip({ id: 'a', timelineRange: { startTicks: 0, durationTicks: 2_000_000 } });
  const b = clip({ id: 'b', timelineRange: { startTicks: 2_000_000, durationTicks: 2_000_000 } });
  const c = clip({ id: 'c', timelineRange: { startTicks: 4_000_000, durationTicks: 2_000_000 } });
  const tracks = [track([a, b, c])];

  it('resolves the previous clip for an in edge', () => {
    const res = getAdjacentClipForTransitionEdge({
      tracks,
      trackId: 'v1',
      itemId: 'b',
      edge: 'in',
    });
    expect(res?.clip.id).toBe('b');
    expect(res?.adjacent?.id).toBe('a');
  });

  it('resolves the next clip for an out edge', () => {
    const res = getAdjacentClipForTransitionEdge({
      tracks,
      trackId: 'v1',
      itemId: 'b',
      edge: 'out',
    });
    expect(res?.adjacent?.id).toBe('c');
  });

  it('returns null adjacent at the boundaries', () => {
    expect(
      getAdjacentClipForTransitionEdge({ tracks, trackId: 'v1', itemId: 'a', edge: 'in' })
        ?.adjacent,
    ).toBeNull();
    expect(
      getAdjacentClipForTransitionEdge({ tracks, trackId: 'v1', itemId: 'c', edge: 'out' })
        ?.adjacent,
    ).toBeNull();
  });

  it('returns null for an unknown track or item', () => {
    expect(
      getAdjacentClipForTransitionEdge({ tracks, trackId: 'x', itemId: 'b', edge: 'in' }),
    ).toBeNull();
    expect(
      getAdjacentClipForTransitionEdge({ tracks, trackId: 'v1', itemId: 'z', edge: 'in' }),
    ).toBeNull();
  });
});

describe('getTransitionAdjacentHandleLimitTicks', () => {
  it('is infinite when there is no neighbour', () => {
    expect(getTransitionAdjacentHandleLimitTicks({ edge: 'in', adjacent: null })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('for an in edge, returns the previous clip source headroom past its current end', () => {
    const prev = clip({
      sourceRange: { startTicks: 0, durationTicks: 2_000_000 },
      sourceDurationTicks: 5_000_000,
    });
    // headroom = total source (5s) - currently used source end (2s) = 3s
    expect(getTransitionAdjacentHandleLimitTicks({ edge: 'in', adjacent: prev })).toBe(
      timelineTicks(3_000_000),
    );
  });

  it('for an out edge, returns the next clip leading source offset', () => {
    const next = clip({ sourceRange: { startTicks: 1_500_000, durationTicks: 2_000_000 } });
    expect(getTransitionAdjacentHandleLimitTicks({ edge: 'out', adjacent: next })).toBe(
      timelineTicks(1_500_000),
    );
  });

  it('is infinite for non-source clips (e.g. text)', () => {
    const text = clip({ clipType: 'text' });
    expect(getTransitionAdjacentHandleLimitTicks({ edge: 'out', adjacent: text })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('computeMaxResizableTransitionDurationTicks', () => {
  it('returns the fallback when the clip cannot be resolved', () => {
    expect(
      computeMaxResizableTransitionDurationTicks({
        tracks: [],
        trackId: 'v1',
        itemId: 'missing',
        edge: 'in',
        currentTransition: {} as any,
      }),
    ).toBe(timelineTicks(10_000_000));
  });

  it('caps by the clip length minus the opposite-edge transition', () => {
    const c = clip({
      id: 'c',
      timelineRange: { startTicks: 0, durationTicks: 4_000_000 },
      transitionOut: { durationTicks: 1_000_000 },
    });
    const result = computeMaxResizableTransitionDurationTicks({
      tracks: [track([c])],
      trackId: 'v1',
      itemId: 'c',
      edge: 'in',
      currentTransition: { mode: 'single' } as any,
    });
    expect(result).toBe(timelineTicks(3_000_000));
  });

  it('in adjacent mode, also caps by the neighbour source headroom', () => {
    const prev = clip({ id: 'a', timelineRange: { startTicks: 0, durationTicks: 2_000_000 } });
    const cur = clip({
      id: 'b',
      timelineRange: { startTicks: 2_000_000, durationTicks: 4_000_000 },
    });
    // prev headroom = 2s used, 2s total -> 0 headroom, so the handle limit wins.
    const result = computeMaxResizableTransitionDurationTicks({
      tracks: [track([prev, cur])],
      trackId: 'v1',
      itemId: 'b',
      edge: 'in',
      currentTransition: { mode: 'adjacent' } as any,
    });
    expect(result).toBe(0);
  });
});

describe('computeTransitionHandleSnapDurationTicks', () => {
  it('returns null when not in adjacent mode', () => {
    const prev = clip({ id: 'a', timelineRange: { startTicks: 0, durationTicks: 2_000_000 } });
    const cur = clip({ id: 'b', timelineRange: { startTicks: 2_000_000, durationTicks: 2_000_000 } });
    expect(
      computeTransitionHandleSnapDurationTicks({
        tracks: [track([prev, cur])],
        trackId: 'v1',
        itemId: 'b',
        edge: 'in',
        currentTransition: { mode: 'single' } as any,
        rawDurationTicks: timelineTicks(500_000),
      }),
    ).toBeNull();
  });

  it('returns null when the clip and neighbour are not adjacent (gap too large)', () => {
    const prev = clip({ id: 'a', timelineRange: { startTicks: 0, durationTicks: 1_000_000 } });
    const cur = clip({ id: 'b', timelineRange: { startTicks: 5_000_000, durationTicks: 2_000_000 } });
    expect(
      computeTransitionHandleSnapDurationTicks({
        tracks: [track([prev, cur])],
        trackId: 'v1',
        itemId: 'b',
        edge: 'in',
        currentTransition: { mode: 'adjacent' } as any,
        rawDurationTicks: 500_000,
      }),
    ).toBeNull();
  });

  it('returns the neighbour handle limit when clips touch in adjacent mode', () => {
    const prev = clip({
      id: 'a',
      timelineRange: { startTicks: 0, durationTicks: 2_000_000 },
      sourceRange: { startTicks: 0, durationTicks: 2_000_000 },
      sourceDurationTicks: 5_000_000,
    });
    const cur = clip({ id: 'b', timelineRange: { startTicks: 2_000_000, durationTicks: 2_000_000 } });
    expect(
      computeTransitionHandleSnapDurationTicks({
        tracks: [track([prev, cur])],
        trackId: 'v1',
        itemId: 'b',
        edge: 'in',
        currentTransition: { mode: 'adjacent' } as any,
        rawDurationTicks: 500_000,
      }),
    ).toBe(timelineTicks(3_000_000));
  });

  it('does not snap a handle across a one-tick gap', () => {
    const prev = clip({ id: 'a', timelineRange: { startTicks: 0, durationTicks: 2_000_000 } });
    const cur = clip({ id: 'b', timelineRange: { startTicks: 2_000_000, durationTicks: 2_000_000 } });
    cur.timelineRange.startTicks += 1;

    expect(
      computeTransitionHandleSnapDurationTicks({
        tracks: [track([prev, cur])],
        trackId: 'v1',
        itemId: 'b',
        edge: 'in',
        currentTransition: { mode: 'adjacent' } as any,
        rawDurationTicks: timelineTicks(500_000),
      }),
    ).toBeNull();
  });
});
