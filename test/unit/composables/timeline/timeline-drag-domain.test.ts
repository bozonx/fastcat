import { describe, expect, it } from 'vitest';
import type { TimelineDocument, TimelineTrack, TimelineMarker } from '~/timeline/types';
import {
  computeSnapTargetsTicks,
  getSelectedMovableItemIds,
  buildMultiItemMoves,
} from '~/composables/timeline/timeline-drag-domain';

function clip(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'c1',
    kind: 'clip',
    clipType: 'media',
    trackId: 'v1',
    timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
    ...overrides,
  };
}

function track(items: any[], overrides: Record<string, unknown> = {}): TimelineTrack {
  return {
    id: 'v1',
    kind: 'video',
    name: 'Video 1',
    locked: false,
    items,
    ...overrides,
  } as TimelineTrack;
}

function marker(overrides: Record<string, unknown> = {}): TimelineMarker {
  return { id: 'm1', timeTicks: 1_000_000, text: '', ...overrides } as TimelineMarker;
}

describe('computeSnapTargetsTicks', () => {
  it('returns empty array when nothing is included', () => {
    const result = computeSnapTargetsTicks({
      tracks: [],
      includeTimelineStart: false,
      includeTimelineEndTicks: null,
      includePlayheadTicks: null,
      includeMarkers: false,
      markers: [],
      includeClips: false,
    });
    expect(result).toEqual([]);
  });

  it('includes timeline start and end', () => {
    const result = computeSnapTargetsTicks({
      tracks: [],
      includeTimelineStart: true,
      includeTimelineEndTicks: 10_000_000,
      includePlayheadTicks: null,
      includeMarkers: false,
      markers: [],
      includeClips: false,
    });
    expect(result).toEqual([0, 10_000_000]);
  });

  it('includes playhead position', () => {
    const result = computeSnapTargetsTicks({
      tracks: [],
      includeTimelineStart: false,
      includeTimelineEndTicks: null,
      includePlayheadTicks: 3_500_000,
      includeMarkers: false,
      markers: [],
      includeClips: false,
    });
    expect(result).toEqual([3_500_000]);
  });

  it('includes marker time and marker end when duration is set', () => {
    const result = computeSnapTargetsTicks({
      tracks: [],
      includeTimelineStart: false,
      includeTimelineEndTicks: null,
      includePlayheadTicks: null,
      includeMarkers: true,
      markers: [
        marker({ id: 'm1', timeTicks: 1_000_000, durationTicks: 500_000 }),
        marker({ id: 'm2', timeTicks: 3_000_000 }),
      ],
      includeClips: false,
    });
    expect(result).toEqual([1_000_000, 1_500_000, 3_000_000]);
  });

  it('excludes marker by excludeMarkerId', () => {
    const result = computeSnapTargetsTicks({
      tracks: [],
      includeTimelineStart: false,
      includeTimelineEndTicks: null,
      includePlayheadTicks: null,
      includeMarkers: true,
      markers: [
        marker({ id: 'm1', timeTicks: 1_000_000 }),
        marker({ id: 'm2', timeTicks: 3_000_000 }),
      ],
      excludeMarkerId: 'm1',
      includeClips: false,
    });
    expect(result).toEqual([3_000_000]);
  });

  it('skips markers with non-finite timeTicks', () => {
    const result = computeSnapTargetsTicks({
      tracks: [],
      includeTimelineStart: false,
      includeTimelineEndTicks: null,
      includePlayheadTicks: null,
      includeMarkers: true,
      markers: [
        marker({ id: 'm1', timeTicks: Number.NaN }),
        marker({ id: 'm2', timeTicks: 2_000_000 }),
      ],
      includeClips: false,
    });
    expect(result).toEqual([2_000_000]);
  });

  it('includes selection range start and end', () => {
    const result = computeSnapTargetsTicks({
      tracks: [],
      includeTimelineStart: false,
      includeTimelineEndTicks: null,
      includePlayheadTicks: null,
      includeMarkers: false,
      markers: [],
      includeClips: false,
      selectionRangeTicks: { startTicks: 2_000_000, endTicks: 4_000_000 },
    });
    expect(result).toEqual([2_000_000, 4_000_000]);
  });

  it('includes clip start and end edges', () => {
    const result = computeSnapTargetsTicks({
      tracks: [
        track([
          clip({ id: 'c1', timelineRange: { startTicks: 1_000_000, durationTicks: 2_000_000 } }),
          clip({ id: 'c2', timelineRange: { startTicks: 5_000_000, durationTicks: 3_000_000 } }),
        ]),
      ],
      includeTimelineStart: false,
      includeTimelineEndTicks: null,
      includePlayheadTicks: null,
      includeMarkers: false,
      markers: [],
      includeClips: true,
    });
    expect(result).toEqual([1_000_000, 3_000_000, 5_000_000, 8_000_000]);
  });

  it('excludes clips by excludeItemIds', () => {
    const result = computeSnapTargetsTicks({
      tracks: [
        track([
          clip({ id: 'c1', timelineRange: { startTicks: 1_000_000, durationTicks: 2_000_000 } }),
          clip({ id: 'c2', timelineRange: { startTicks: 5_000_000, durationTicks: 3_000_000 } }),
        ]),
      ],
      includeTimelineStart: false,
      includeTimelineEndTicks: null,
      includePlayheadTicks: null,
      includeMarkers: false,
      markers: [],
      includeClips: true,
      excludeItemIds: ['c1'],
    });
    expect(result).toEqual([5_000_000, 8_000_000]);
  });

  it('skips non-clip items (gaps)', () => {
    const result = computeSnapTargetsTicks({
      tracks: [
        track([
          { id: 'gap1', kind: 'gap', timelineRange: { startTicks: 0, durationTicks: 500_000 } },
          clip({ id: 'c1', timelineRange: { startTicks: 500_000, durationTicks: 2_000_000 } }),
        ]),
      ],
      includeTimelineStart: false,
      includeTimelineEndTicks: null,
      includePlayheadTicks: null,
      includeMarkers: false,
      markers: [],
      includeClips: true,
    });
    expect(result).toEqual([500_000, 2_500_000]);
  });

  it('deduplicates and sorts targets', () => {
    const result = computeSnapTargetsTicks({
      tracks: [
        track([clip({ id: 'c1', timelineRange: { startTicks: 0, durationTicks: 5_000_000 } })]),
      ],
      includeTimelineStart: true,
      includeTimelineEndTicks: 5_000_000,
      includePlayheadTicks: 0,
      includeMarkers: false,
      markers: [],
      includeClips: true,
    });
    expect(result).toEqual([0, 5_000_000]);
  });

  it('combines all sources', () => {
    const result = computeSnapTargetsTicks({
      tracks: [
        track([
          clip({ id: 'c1', timelineRange: { startTicks: 2_000_000, durationTicks: 1_000_000 } }),
        ]),
      ],
      includeTimelineStart: true,
      includeTimelineEndTicks: 10_000_000,
      includePlayheadTicks: 5_000_000,
      includeMarkers: true,
      markers: [marker({ id: 'm1', timeTicks: 7_000_000 })],
      includeClips: true,
      selectionRangeTicks: { startTicks: 0, endTicks: 3_000_000 },
    });
    expect(result).toEqual([0, 2_000_000, 3_000_000, 5_000_000, 7_000_000, 10_000_000]);
  });
});

describe('getSelectedMovableItemIds', () => {
  it('returns only clip ids on unlocked tracks', () => {
    const tracks: TimelineTrack[] = [
      track([clip({ id: 'c1', locked: false }), clip({ id: 'c2', locked: true })]),
    ];
    const result = getSelectedMovableItemIds({
      selectedItemIds: ['c1', 'c2'],
      tracks,
    });
    expect(result).toEqual(['c1']);
  });

  it('excludes items on locked tracks', () => {
    const tracks: TimelineTrack[] = [track([clip({ id: 'c1', locked: false })], { locked: true })];
    const result = getSelectedMovableItemIds({
      selectedItemIds: ['c1'],
      tracks,
    });
    expect(result).toEqual([]);
  });

  it('excludes non-clip items', () => {
    const tracks: TimelineTrack[] = [
      track([
        { id: 'gap1', kind: 'gap', timelineRange: { startTicks: 0, durationTicks: 1 } } as any,
      ]),
    ];
    const result = getSelectedMovableItemIds({
      selectedItemIds: ['gap1'],
      tracks,
    });
    expect(result).toEqual([]);
  });

  it('returns empty for unknown ids', () => {
    const tracks: TimelineTrack[] = [track([clip({ id: 'c1' })])];
    const result = getSelectedMovableItemIds({
      selectedItemIds: ['unknown'],
      tracks,
    });
    expect(result).toEqual([]);
  });
});

describe('buildMultiItemMoves', () => {
  function makeDoc(tracks: TimelineTrack[]): TimelineDocument {
    return {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc1',
      name: 'Test',
      timebase: { fps: 30 },
      tracks,
    };
  }

  it('moves items by deltaTicks on the same track', () => {
    const t1 = track([
      clip({ id: 'c1', timelineRange: { startTicks: 1_000_000, durationTicks: 2_000_000 } }),
      clip({ id: 'c2', timelineRange: { startTicks: 5_000_000, durationTicks: 2_000_000 } }),
    ]);
    const snapshot = makeDoc([t1]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'v1',
      selectedMovableItemIds: ['c1', 'c2'],
      deltaTicks: 500_000,
    });

    expect(moves).toHaveLength(2);
    expect(moves[0]).toEqual({
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'c2',
      startTicks: 5_500_000,
    });
    expect(moves[1]).toEqual({
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'c1',
      startTicks: 1_500_000,
    });
  });

  it('clamps startTicks to 0 for negative delta', () => {
    const t1 = track([
      clip({ id: 'c1', timelineRange: { startTicks: 200_000, durationTicks: 2_000_000 } }),
    ]);
    const snapshot = makeDoc([t1]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'v1',
      selectedMovableItemIds: ['c1'],
      deltaTicks: -500_000,
    });

    expect(moves).toHaveLength(1);
    expect(moves[0]!.startTicks).toBe(0);
  });

  it('clamps a negative-delta group rigidly against its earliest member', () => {
    // c1 starts at 200_000; a -500_000 delta would push it past 0. The whole
    // group must shift by the same clamped delta (-200_000) so relative geometry
    // is preserved, instead of piling c1 at 0 while c2 keeps its full -500_000.
    const t1 = track([
      clip({ id: 'c1', timelineRange: { startTicks: 200_000, durationTicks: 1_000_000 } }),
      clip({ id: 'c2', timelineRange: { startTicks: 5_000_000, durationTicks: 1_000_000 } }),
    ]);
    const snapshot = makeDoc([t1]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'v1',
      selectedMovableItemIds: ['c1', 'c2'],
      deltaTicks: -500_000,
    });

    const byId = Object.fromEntries(moves.map((m) => [m.itemId, m.startTicks]));
    expect(byId.c1).toBe(0);
    expect(byId.c2).toBe(4_800_000);
    // Relative gap between members is unchanged (4_800_000, same as original).
    expect(byId.c2 - byId.c1).toBe(4_800_000);
  });

  it('moves items to a different track with same kind', () => {
    const t1 = track(
      [clip({ id: 'c1', timelineRange: { startTicks: 1_000_000, durationTicks: 2_000_000 } })],
      { id: 'v1' },
    );
    const t2 = track(
      [clip({ id: 'c2', timelineRange: { startTicks: 3_000_000, durationTicks: 2_000_000 } })],
      { id: 'v2' },
    );
    const snapshot = makeDoc([t1, t2]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1, t2],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'v2',
      selectedMovableItemIds: ['c1'],
      deltaTicks: 0,
    });

    expect(moves).toHaveLength(1);
    expect(moves[0]!.toTrackId).toBe('v2');
    expect(moves[0]!.fromTrackId).toBe('v1');
  });

  it('does not move to track of different kind', () => {
    const t1 = track(
      [clip({ id: 'c1', timelineRange: { startTicks: 1_000_000, durationTicks: 2_000_000 } })],
      { id: 'v1', kind: 'video' },
    );
    const t2 = track(
      [clip({ id: 'c2', timelineRange: { startTicks: 3_000_000, durationTicks: 2_000_000 } })],
      { id: 'a1', kind: 'audio' },
    );
    const snapshot = makeDoc([t1, t2]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1, t2],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'a1',
      selectedMovableItemIds: ['c1'],
      deltaTicks: 0,
    });

    expect(moves).toHaveLength(1);
    expect(moves[0]!.toTrackId).toBe('v1');
  });

  it('sorts descending by startTicks for positive delta', () => {
    const t1 = track([
      clip({ id: 'c1', timelineRange: { startTicks: 1_000_000, durationTicks: 1_000_000 } }),
      clip({ id: 'c2', timelineRange: { startTicks: 5_000_000, durationTicks: 1_000_000 } }),
    ]);
    const snapshot = makeDoc([t1]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'v1',
      selectedMovableItemIds: ['c1', 'c2'],
      deltaTicks: 100_000,
    });

    expect(moves[0]!.startTicks).toBeGreaterThanOrEqual(moves[1]!.startTicks);
  });

  it('sorts ascending by startTicks for negative delta', () => {
    const t1 = track([
      clip({ id: 'c1', timelineRange: { startTicks: 1_000_000, durationTicks: 1_000_000 } }),
      clip({ id: 'c2', timelineRange: { startTicks: 5_000_000, durationTicks: 1_000_000 } }),
    ]);
    const snapshot = makeDoc([t1]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'v1',
      selectedMovableItemIds: ['c1', 'c2'],
      deltaTicks: -100_000,
    });

    expect(moves[0]!.startTicks).toBeLessThanOrEqual(moves[1]!.startTicks);
  });

  it('skips items not found in snapshot', () => {
    const t1 = track([clip({ id: 'c1' })]);
    const snapshot = makeDoc([t1]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'v1',
      selectedMovableItemIds: ['unknown'],
      deltaTicks: 0,
    });

    expect(moves).toEqual([]);
  });
});
