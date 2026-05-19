/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  sanitizeFps,
  usToFrame,
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
        { id: 'clip-1', kind: 'clip', timelineRange: { startUs: 0, durationUs: 1_000_000 } },
        {
          id: 'clip-2',
          kind: 'clip',
          timelineRange: { startUs: 1_000_000, durationUs: 500_000 },
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
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          linkedGroupId: 'group-1',
        },
        {
          id: 'clip-4',
          kind: 'clip',
          timelineRange: { startUs: 2_000_000, durationUs: 500_000 },
          linkedVideoClipId: 'clip-1',
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
    expect(sanitizeFps(29.97)).toBe(29.97);
  });
});

describe('usToFrame', () => {
  it('converts microseconds to frames', () => {
    expect(usToFrame(1_000_000, 30, 'round')).toBe(30);
  });

  it('respects quantize mode', () => {
    expect(usToFrame(1_000_001, 30, 'floor')).toBe(30);
    expect(usToFrame(1_000_001, 30, 'ceil')).toBe(31);
  });
});

describe('frameToUs', () => {
  it('converts frames to microseconds', () => {
    expect(frameToUs(30, 30)).toBe(1_000_000);
  });
});

describe('quantizeTimeUsToFrames', () => {
  it('round-trips through frame quantization', () => {
    expect(quantizeTimeUsToFrames(1_000_001, 30, 'round')).toBe(1_000_000);
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
    expect(getLinkedClipGroupItemIds(mockDoc, 'clip-1')).toEqual(['clip-1', 'clip-4']);
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
        { id: 'a', kind: 'clip', timelineRange: { startUs: 0, durationUs: 1_000_000 } },
        { id: 'b', kind: 'clip', timelineRange: { startUs: 500_000, durationUs: 1_000_000 } },
      ],
    };
    expect(() => assertNoOverlap(track, 'a', 0, 1_000_000)).toThrow('Item overlaps');
  });

  it('does not throw for non-overlapping items', () => {
    const track: any = {
      items: [
        { id: 'a', kind: 'clip', timelineRange: { startUs: 0, durationUs: 500_000 } },
        { id: 'b', kind: 'clip', timelineRange: { startUs: 500_000, durationUs: 500_000 } },
      ],
    };
    expect(() => assertNoOverlap(track, 'a', 0, 500_000)).not.toThrow();
  });
});

describe('mergeAdjacentGaps', () => {
  it('merges consecutive gaps', () => {
    const items: any = [
      { kind: 'gap', timelineRange: { startUs: 0, durationUs: 500_000 } },
      { kind: 'gap', timelineRange: { startUs: 500_000, durationUs: 500_000 } },
      { kind: 'clip', timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 } },
    ];
    const result = mergeAdjacentGaps(items);
    expect(result).toHaveLength(2);
    expect(result[0].timelineRange.durationUs).toBe(1_000_000);
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
    expect(computeTrackEndUs(mockDoc.tracks[0])).toBe(1_500_000);
  });
});
