import { describe, expect, it } from 'vitest';
import type { TimelineDocument, TimelineTrack, TimelineMarker } from '~/timeline/types';
import {
  computeSnapTargetsUs,
  getSelectedMovableItemIds,
  buildMultiItemMoves,
} from '~/composables/timeline/timeline-drag-domain';

function clip(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'c1',
    kind: 'clip',
    clipType: 'media',
    trackId: 'v1',
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
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
  return { id: 'm1', timeUs: 1_000_000, text: '', ...overrides } as TimelineMarker;
}

describe('computeSnapTargetsUs', () => {
  it('returns empty array when nothing is included', () => {
    const result = computeSnapTargetsUs({
      tracks: [],
      includeTimelineStart: false,
      includeTimelineEndUs: null,
      includePlayheadUs: null,
      includeMarkers: false,
      markers: [],
      includeClips: false,
    });
    expect(result).toEqual([]);
  });

  it('includes timeline start and end', () => {
    const result = computeSnapTargetsUs({
      tracks: [],
      includeTimelineStart: true,
      includeTimelineEndUs: 10_000_000,
      includePlayheadUs: null,
      includeMarkers: false,
      markers: [],
      includeClips: false,
    });
    expect(result).toEqual([0, 10_000_000]);
  });

  it('includes playhead position', () => {
    const result = computeSnapTargetsUs({
      tracks: [],
      includeTimelineStart: false,
      includeTimelineEndUs: null,
      includePlayheadUs: 3_500_000,
      includeMarkers: false,
      markers: [],
      includeClips: false,
    });
    expect(result).toEqual([3_500_000]);
  });

  it('includes marker time and marker end when duration is set', () => {
    const result = computeSnapTargetsUs({
      tracks: [],
      includeTimelineStart: false,
      includeTimelineEndUs: null,
      includePlayheadUs: null,
      includeMarkers: true,
      markers: [
        marker({ id: 'm1', timeUs: 1_000_000, durationUs: 500_000 }),
        marker({ id: 'm2', timeUs: 3_000_000 }),
      ],
      includeClips: false,
    });
    expect(result).toEqual([1_000_000, 1_500_000, 3_000_000]);
  });

  it('excludes marker by excludeMarkerId', () => {
    const result = computeSnapTargetsUs({
      tracks: [],
      includeTimelineStart: false,
      includeTimelineEndUs: null,
      includePlayheadUs: null,
      includeMarkers: true,
      markers: [marker({ id: 'm1', timeUs: 1_000_000 }), marker({ id: 'm2', timeUs: 3_000_000 })],
      excludeMarkerId: 'm1',
      includeClips: false,
    });
    expect(result).toEqual([3_000_000]);
  });

  it('skips markers with non-finite timeUs', () => {
    const result = computeSnapTargetsUs({
      tracks: [],
      includeTimelineStart: false,
      includeTimelineEndUs: null,
      includePlayheadUs: null,
      includeMarkers: true,
      markers: [marker({ id: 'm1', timeUs: Number.NaN }), marker({ id: 'm2', timeUs: 2_000_000 })],
      includeClips: false,
    });
    expect(result).toEqual([2_000_000]);
  });

  it('includes selection range start and end', () => {
    const result = computeSnapTargetsUs({
      tracks: [],
      includeTimelineStart: false,
      includeTimelineEndUs: null,
      includePlayheadUs: null,
      includeMarkers: false,
      markers: [],
      includeClips: false,
      selectionRangeUs: { startUs: 2_000_000, endUs: 4_000_000 },
    });
    expect(result).toEqual([2_000_000, 4_000_000]);
  });

  it('includes clip start and end edges', () => {
    const result = computeSnapTargetsUs({
      tracks: [
        track([
          clip({ id: 'c1', timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 } }),
          clip({ id: 'c2', timelineRange: { startUs: 5_000_000, durationUs: 3_000_000 } }),
        ]),
      ],
      includeTimelineStart: false,
      includeTimelineEndUs: null,
      includePlayheadUs: null,
      includeMarkers: false,
      markers: [],
      includeClips: true,
    });
    expect(result).toEqual([1_000_000, 3_000_000, 5_000_000, 8_000_000]);
  });

  it('excludes clips by excludeItemIds', () => {
    const result = computeSnapTargetsUs({
      tracks: [
        track([
          clip({ id: 'c1', timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 } }),
          clip({ id: 'c2', timelineRange: { startUs: 5_000_000, durationUs: 3_000_000 } }),
        ]),
      ],
      includeTimelineStart: false,
      includeTimelineEndUs: null,
      includePlayheadUs: null,
      includeMarkers: false,
      markers: [],
      includeClips: true,
      excludeItemIds: ['c1'],
    });
    expect(result).toEqual([5_000_000, 8_000_000]);
  });

  it('skips non-clip items (gaps)', () => {
    const result = computeSnapTargetsUs({
      tracks: [
        track([
          { id: 'gap1', kind: 'gap', timelineRange: { startUs: 0, durationUs: 500_000 } },
          clip({ id: 'c1', timelineRange: { startUs: 500_000, durationUs: 2_000_000 } }),
        ]),
      ],
      includeTimelineStart: false,
      includeTimelineEndUs: null,
      includePlayheadUs: null,
      includeMarkers: false,
      markers: [],
      includeClips: true,
    });
    expect(result).toEqual([500_000, 2_500_000]);
  });

  it('deduplicates and sorts targets', () => {
    const result = computeSnapTargetsUs({
      tracks: [track([clip({ id: 'c1', timelineRange: { startUs: 0, durationUs: 5_000_000 } })])],
      includeTimelineStart: true,
      includeTimelineEndUs: 5_000_000,
      includePlayheadUs: 0,
      includeMarkers: false,
      markers: [],
      includeClips: true,
    });
    expect(result).toEqual([0, 5_000_000]);
  });

  it('combines all sources', () => {
    const result = computeSnapTargetsUs({
      tracks: [
        track([clip({ id: 'c1', timelineRange: { startUs: 2_000_000, durationUs: 1_000_000 } })]),
      ],
      includeTimelineStart: true,
      includeTimelineEndUs: 10_000_000,
      includePlayheadUs: 5_000_000,
      includeMarkers: true,
      markers: [marker({ id: 'm1', timeUs: 7_000_000 })],
      includeClips: true,
      selectionRangeUs: { startUs: 0, endUs: 3_000_000 },
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
      track([{ id: 'gap1', kind: 'gap', timelineRange: { startUs: 0, durationUs: 1 } } as any]),
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

  it('moves items by deltaUs on the same track', () => {
    const t1 = track([
      clip({ id: 'c1', timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 } }),
      clip({ id: 'c2', timelineRange: { startUs: 5_000_000, durationUs: 2_000_000 } }),
    ]);
    const snapshot = makeDoc([t1]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'v1',
      selectedMovableItemIds: ['c1', 'c2'],
      deltaUs: 500_000,
    });

    expect(moves).toHaveLength(2);
    expect(moves[0]).toEqual({
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'c2',
      startUs: 5_500_000,
    });
    expect(moves[1]).toEqual({
      fromTrackId: 'v1',
      toTrackId: 'v1',
      itemId: 'c1',
      startUs: 1_500_000,
    });
  });

  it('clamps startUs to 0 for negative delta', () => {
    const t1 = track([
      clip({ id: 'c1', timelineRange: { startUs: 200_000, durationUs: 2_000_000 } }),
    ]);
    const snapshot = makeDoc([t1]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'v1',
      selectedMovableItemIds: ['c1'],
      deltaUs: -500_000,
    });

    expect(moves).toHaveLength(1);
    expect(moves[0]!.startUs).toBe(0);
  });

  it('moves items to a different track with same kind', () => {
    const t1 = track(
      [clip({ id: 'c1', timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 } })],
      { id: 'v1' },
    );
    const t2 = track(
      [clip({ id: 'c2', timelineRange: { startUs: 3_000_000, durationUs: 2_000_000 } })],
      { id: 'v2' },
    );
    const snapshot = makeDoc([t1, t2]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1, t2],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'v2',
      selectedMovableItemIds: ['c1'],
      deltaUs: 0,
    });

    expect(moves).toHaveLength(1);
    expect(moves[0]!.toTrackId).toBe('v2');
    expect(moves[0]!.fromTrackId).toBe('v1');
  });

  it('does not move to track of different kind', () => {
    const t1 = track(
      [clip({ id: 'c1', timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 } })],
      { id: 'v1', kind: 'video' },
    );
    const t2 = track(
      [clip({ id: 'c2', timelineRange: { startUs: 3_000_000, durationUs: 2_000_000 } })],
      { id: 'a1', kind: 'audio' },
    );
    const snapshot = makeDoc([t1, t2]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1, t2],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'a1',
      selectedMovableItemIds: ['c1'],
      deltaUs: 0,
    });

    expect(moves).toHaveLength(1);
    expect(moves[0]!.toTrackId).toBe('v1');
  });

  it('sorts descending by startUs for positive delta', () => {
    const t1 = track([
      clip({ id: 'c1', timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 } }),
      clip({ id: 'c2', timelineRange: { startUs: 5_000_000, durationUs: 1_000_000 } }),
    ]);
    const snapshot = makeDoc([t1]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'v1',
      selectedMovableItemIds: ['c1', 'c2'],
      deltaUs: 100_000,
    });

    expect(moves[0]!.startUs).toBeGreaterThanOrEqual(moves[1]!.startUs);
  });

  it('sorts ascending by startUs for negative delta', () => {
    const t1 = track([
      clip({ id: 'c1', timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 } }),
      clip({ id: 'c2', timelineRange: { startUs: 5_000_000, durationUs: 1_000_000 } }),
    ]);
    const snapshot = makeDoc([t1]);

    const moves = buildMultiItemMoves({
      currentTracks: [t1],
      dragStartSnapshot: snapshot,
      dragOriginTrackId: 'v1',
      targetTrackId: 'v1',
      selectedMovableItemIds: ['c1', 'c2'],
      deltaUs: -100_000,
    });

    expect(moves[0]!.startUs).toBeLessThanOrEqual(moves[1]!.startUs);
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
      deltaUs: 0,
    });

    expect(moves).toEqual([]);
  });
});
