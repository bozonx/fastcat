/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  selectTrack,
  selectTracksByKind,
  selectAllItems,
  selectTimelineDurationUs,
} from '~/timeline/selectors';

const mockDoc: any = {
  id: 'doc-1',
  tracks: [
    {
      id: 'track-1',
      kind: 'video',
      items: [
        { id: 'clip-1', kind: 'clip', timelineRange: { startUs: 0, durationUs: 1_000_000 } },
        { id: 'gap-1', kind: 'gap', timelineRange: { startUs: 1_000_000, durationUs: 500_000 } },
      ],
    },
    {
      id: 'track-2',
      kind: 'audio',
      items: [{ id: 'clip-2', kind: 'clip', timelineRange: { startUs: 0, durationUs: 2_000_000 } }],
    },
  ],
};

describe('selectTrack', () => {
  it('returns track by id', () => {
    expect(selectTrack(mockDoc, 'track-1')?.id).toBe('track-1');
  });

  it('returns null for missing track', () => {
    expect(selectTrack(mockDoc, 'missing')).toBeNull();
  });
});

describe('selectTracksByKind', () => {
  it('filters tracks by kind', () => {
    expect(selectTracksByKind(mockDoc, 'video')).toHaveLength(1);
    expect(selectTracksByKind(mockDoc, 'audio')).toHaveLength(1);
  });
});

describe('selectAllItems', () => {
  it('flattens all track items', () => {
    const items = selectAllItems(mockDoc);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(['clip-1', 'gap-1', 'clip-2']);
  });
});

describe('selectTimelineDurationUs', () => {
  it('returns max end time across all items', () => {
    expect(selectTimelineDurationUs(mockDoc)).toBe(2_000_000);
  });

  it('returns 0 for empty timeline', () => {
    expect(selectTimelineDurationUs({ id: 'empty', tracks: [] } as any)).toBe(0);
  });
});
