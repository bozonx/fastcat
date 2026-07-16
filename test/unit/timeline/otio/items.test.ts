/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { parseItemSequenceDurationTicks, parseGapItem } from '~/timeline/otio/items';

vi.mock('~/timeline/otio/utils', () => ({
  fromRationalTimeTicks: vi.fn((rt) => rt?.value ?? 0),
  safeFastCatMetadata: vi.fn((meta) => meta?.fastcat ?? {}),
  resolveStableItemId: vi.fn(() => 'gap-1'),
  fromTimeRange: vi.fn((range) => ({ startTicks: 0, durationTicks: range?.duration?.value ?? 0 })),
}));

describe('parseItemSequenceDurationTicks', () => {
  it('returns 0 for invalid input', () => {
    expect(parseItemSequenceDurationTicks(null)).toBe(0);
    expect(parseItemSequenceDurationTicks({ OTIO_SCHEMA: 'Other.1' })).toBe(0);
  });

  it('returns duration for valid clip/gap', () => {
    expect(
      parseItemSequenceDurationTicks({
        OTIO_SCHEMA: 'Clip.1',
        source_range: { duration: { value: 1_000_000 } },
      }),
    ).toBe(1_000_000);
    expect(
      parseItemSequenceDurationTicks({
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
      fallbackStartTicks: 1_000_000,
    });
    expect(result.kind).toBe('gap');
    expect(result.trackId).toBe('track-1');
    expect(result.timelineRange.durationTicks).toBe(500_000);
  });
});
