/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  getBoundaryTimesUs,
  calculatePrevClipBoundary,
  calculateNextClipBoundary,
} from '~/timeline/domain/navigation';

vi.mock('~/timeline/selectors', () => ({
  selectTimelineDurationUs: vi.fn(() => 5_000_000),
}));

const mockDoc: any = {
  id: 'doc-1',
  tracks: [
    {
      id: 'track-1',
      items: [
        { id: 'clip-1', kind: 'clip', timelineRange: { startUs: 0, durationUs: 1_000_000 } },
        {
          id: 'clip-2',
          kind: 'clip',
          timelineRange: { startUs: 2_000_000, durationUs: 1_000_000 },
        },
      ],
    },
    {
      id: 'track-2',
      items: [
        { id: 'clip-3', kind: 'clip', timelineRange: { startUs: 500_000, durationUs: 500_000 } },
      ],
    },
  ],
};

describe('getBoundaryTimesUs', () => {
  it('collects sorted unique boundaries across all tracks', () => {
    expect(getBoundaryTimesUs(mockDoc, null)).toEqual([
      0, 500_000, 1_000_000, 2_000_000, 3_000_000,
    ]);
  });

  it('filters by trackId', () => {
    expect(getBoundaryTimesUs(mockDoc, (id) => id === 'track-1')).toEqual([
      0, 1_000_000, 2_000_000, 3_000_000,
    ]);
  });
});

describe('calculatePrevClipBoundary', () => {
  it('returns previous boundary before current time', () => {
    expect(calculatePrevClipBoundary(mockDoc, 1_500_000)).toBe(1_000_000);
  });

  it('returns null when no previous boundary exists', () => {
    expect(calculatePrevClipBoundary(mockDoc, 0)).toBeNull();
  });

  it('filters to current track when requested', () => {
    expect(
      calculatePrevClipBoundary(mockDoc, 2_500_000, {
        currentTrackOnly: true,
        currentTrackId: 'track-2',
      }),
    ).toBe(1_000_000);
  });

  it('returns null for currentTrackOnly without trackId', () => {
    expect(calculatePrevClipBoundary(mockDoc, 1_500_000, { currentTrackOnly: true })).toBeNull();
  });
});

describe('calculateNextClipBoundary', () => {
  it('returns next boundary after current time', () => {
    expect(calculateNextClipBoundary(mockDoc, 1_500_000, 5_000_000)).toBe(2_000_000);
  });

  it('falls back to duration when no next boundary', () => {
    expect(calculateNextClipBoundary(mockDoc, 4_000_000, 5_000_000)).toBe(5_000_000);
  });

  it('filters to current track when requested', () => {
    expect(
      calculateNextClipBoundary(mockDoc, 0, 5_000_000, {
        currentTrackOnly: true,
        currentTrackId: 'track-2',
      }),
    ).toBe(500_000);
  });

  it('returns currentTime when trackId missing and currentTrackOnly', () => {
    expect(calculateNextClipBoundary(mockDoc, 0, 5_000_000, { currentTrackOnly: true })).toBe(0);
  });
});
