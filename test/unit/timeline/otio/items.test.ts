/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { parseItemSequenceDurationUs, parseGapItem } from '~/timeline/otio/items';

vi.mock('~/timeline/otio/utils', () => ({
  fromRationalTimeUs: vi.fn((rt) => rt?.value ?? 0),
  safeFastCatMetadata: vi.fn((meta) => meta?.fastcat ?? {}),
  resolveStableItemId: vi.fn(() => 'gap-1'),
  fromTimeRange: vi.fn((range) => ({ startUs: 0, durationUs: range?.duration?.value ?? 0 })),
}));

describe('parseItemSequenceDurationUs', () => {
  it('returns 0 for invalid input', () => {
    expect(parseItemSequenceDurationUs(null)).toBe(0);
    expect(parseItemSequenceDurationUs({ OTIO_SCHEMA: 'Other.1' })).toBe(0);
  });

  it('returns duration for valid clip/gap', () => {
    expect(
      parseItemSequenceDurationUs({
        OTIO_SCHEMA: 'Clip.1',
        source_range: { duration: { value: 1_000_000 } },
      }),
    ).toBe(1_000_000);
    expect(
      parseItemSequenceDurationUs({
        OTIO_SCHEMA: 'Gap.1',
        source_range: { duration: { value: 500_000 } },
      }),
    ).toBe(500_000);
  });
});

describe('parseGapItem', () => {
  it('parses gap item', () => {
    const result = parseGapItem({
      trackId: 'track-1',
      otio: { source_range: { duration: { value: 500_000 } } },
      index: 0,
      occupiedIds: new Set(),
      fallbackStartUs: 1_000_000,
    });
    expect(result.kind).toBe('gap');
    expect(result.trackId).toBe('track-1');
    expect(result.timelineRange.durationUs).toBe(500_000);
  });
});
