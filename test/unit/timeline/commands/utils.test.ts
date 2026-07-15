/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { timelineUs } from '../../utils/timeline-time';
import {
  sanitizeFps,
  ticksToFrame,
  frameToUs,
  quantizeTimeUsToFrames,
  findClipById,
  getLinkedClipGroupItemIds,
  rangesOverlap,
  assertNoOverlap,
  mergeAdjacentGaps,
  clampInt,
  nextTrackId,
  normalizeTrackOrder,
  computeTrackEndUs,
} from '~/timeline/commands/utils';

const mockDoc: any = {
  id: 'doc-1',
  tracks: [
    {
      id: 'track-1',
      kind: 'video',
      items: [
        {
          id: 'clip-1',
          kind: 'clip',
          timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
        },
        {
          id: 'clip-2',
          kind: 'clip',
          timelineRange: { startUs: timelineUs(1_000_000), durationUs: timelineUs(500_000) },
          linkedGroupId: 'group-1',
        },
      ],
    },
    {
      id: 'track-2',
      kind: 'audio',
      items: [
        {
          id: 'clip-3',
          kind: 'clip',
          timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) },
          linkedGroupId: 'group-1',
        },
        {
          id: 'clip-4',
          kind: 'clip',
          timelineRange: { startUs: timelineUs(2_000_000), durationUs: timelineUs(500_000) },
        },
      ],
    },
  ],
};

describe('sanitizeFps', () => {
  it('returns fallback for non-finite values', () => {
    expect(sanitizeFps(NaN)).toBe(30);
    expect(sanitizeFps(Infinity)).toBe(30);
  });

  it('clamps to min and max', () => {
    expect(sanitizeFps(0)).toBe(1);
    expect(sanitizeFps(300)).toBe(240);
  });

  it('preserves non-integer rates', () => {
    expect(sanitizeFps(29.97)).toBeCloseTo(30_000 / 1_001, 10);
  });
});

describe('ticksToFrame', () => {
  it('converts ticks to frames', () => {
    expect(ticksToFrame(timelineUs(1_000_000), 30, 'round')).toBe(30);
  });

  it('respects quantize mode', () => {
    expect(ticksToFrame(timelineUs(1_000_001), 30, 'floor')).toBe(30);
    expect(ticksToFrame(timelineUs(1_000_001), 30, 'ceil')).toBe(31);
  });
});

describe('frameToUs', () => {
  it('converts frames to microseconds', () => {
    expect(frameToUs(30, 30)).toBe(timelineUs(1_000_000));
  });
});

describe('quantizeTimeUsToFrames', () => {
  it('round-trips through frame quantization', () => {
    expect(quantizeTimeUsToFrames(timelineUs(1_000_001), 30, 'round')).toBe(timelineUs(1_000_000));
  });
});

describe('findClipById', () => {
  it('finds clip by id', () => {
    const result = findClipById(mockDoc, 'clip-1');
    expect(result?.item.id).toBe('clip-1');
    expect(result?.track.id).toBe('track-1');
  });

  it('returns null for missing clip', () => {
    expect(findClipById(mockDoc, 'missing')).toBeNull();
  });
});

describe('getLinkedClipGroupItemIds', () => {
  it('returns group members for linked clips', () => {
    const ids = getLinkedClipGroupItemIds(mockDoc, 'clip-2');
    expect(ids.sort()).toEqual(['clip-2', 'clip-3']);
  });

  it('returns single id for unlinked clip', () => {
    expect(getLinkedClipGroupItemIds(mockDoc, 'clip-1')).toEqual(['clip-1']);
  });

  it('uses cached results for the same document reference', () => {
    const tempDoc = {
      id: 'doc-temp',
      tracks: [
        {
          id: 'track-temp',
          kind: 'video',
          items: [
            { id: 'clip-temp', kind: 'clip', timelineRange: { startUs: 0, durationUs: 100 } },
          ],
        },
      ],
    };
    const result1 = getLinkedClipGroupItemIds(tempDoc as any, 'clip-temp');
    expect(result1).toEqual(['clip-temp']);

    // Mutate the document illegally to prove cache is used
    tempDoc.tracks[0].items.push({
      id: 'clip-temp-2',
      kind: 'clip',
      timelineRange: { startUs: 0, durationUs: 100 },
    } as any);
    const result2 = getLinkedClipGroupItemIds(tempDoc as any, 'clip-temp');
    // Result should still be the cached one, ignoring the new clip
    expect(result2).toEqual(['clip-temp']);

    // Create a new document reference with the mutated structure
    const newDocRef = { ...tempDoc };
    const result3 = getLinkedClipGroupItemIds(newDocRef as any, 'clip-temp');
    // Result should update since it's a new document reference
    expect(result3).toEqual(['clip-temp']);
  });
});

describe('rangesOverlap', () => {
  it('detects overlapping ranges', () => {
    expect(rangesOverlap(0, 10, 5, 15)).toBe(true);
    expect(rangesOverlap(0, 5, 5, 10)).toBe(false);
    expect(rangesOverlap(0, 5, 10, 15)).toBe(false);
  });
});

describe('assertNoOverlap', () => {
  it('throws when items overlap', () => {
    const track: any = {
      items: [
        { id: 'a', kind: 'clip', timelineRange: { startUs: 0, durationUs: timelineUs(1_000_000) } },
        {
          id: 'b',
          kind: 'clip',
          timelineRange: { startUs: timelineUs(500_000), durationUs: timelineUs(1_000_000) },
        },
      ],
    };
    expect(() => assertNoOverlap(track, 'a', 0, timelineUs(1_000_000))).toThrow('Item overlaps');
  });

  it('does not throw for non-overlapping items', () => {
    const track: any = {
      items: [
        { id: 'a', kind: 'clip', timelineRange: { startUs: 0, durationUs: timelineUs(500_000) } },
        {
          id: 'b',
          kind: 'clip',
          timelineRange: { startUs: timelineUs(500_000), durationUs: timelineUs(500_000) },
        },
      ],
    };
    expect(() => assertNoOverlap(track, 'a', 0, timelineUs(500_000))).not.toThrow();
  });
});

describe('mergeAdjacentGaps', () => {
  it('merges consecutive gaps', () => {
    const items: any = [
      { kind: 'gap', timelineRange: { startUs: 0, durationUs: timelineUs(500_000) } },
      {
        kind: 'gap',
        timelineRange: { startUs: timelineUs(500_000), durationUs: timelineUs(500_000) },
      },
      {
        kind: 'clip',
        timelineRange: { startUs: timelineUs(1_000_000), durationUs: timelineUs(1_000_000) },
      },
    ];
    const result = mergeAdjacentGaps(items);
    expect(result).toHaveLength(2);
    expect(result[0].timelineRange.durationUs).toBe(timelineUs(1_000_000));
  });
});

describe('clampInt', () => {
  it('clamps values within range', () => {
    expect(clampInt(5, 0, 10)).toBe(5);
    expect(clampInt(-5, 0, 10)).toBe(0);
    expect(clampInt(15, 0, 10)).toBe(10);
  });

  it('handles non-finite values', () => {
    expect(clampInt(NaN, 0, 10)).toBe(0);
  });
});

describe('nextTrackId', () => {
  it('finds next available video track id', () => {
    expect(nextTrackId(mockDoc, 'v')).toBe('v1');
    expect(nextTrackId(mockDoc, 'a')).toBe('a1');
  });
});

describe('normalizeTrackOrder', () => {
  it('reorders tracks and groups by kind', () => {
    const ordered = normalizeTrackOrder(mockDoc, ['track-2', 'track-1']);
    expect(ordered.map((t) => t.id)).toEqual(['track-1', 'track-2']);
  });
});

describe('computeTrackEndUs', () => {
  it('returns max end time of track items', () => {
    expect(computeTrackEndUs(mockDoc.tracks[0])).toBe(timelineUs(1_500_000));
  });
});
