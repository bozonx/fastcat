import { describe, it, expect } from 'vitest';
import {
  timeUsToPx,
  pxToTimeUs,
  pxToDeltaUs,
  BASE_PX_PER_SECOND,
} from '~/composables/timeline/useTimelineInteraction';

describe('useTimelineInteraction', () => {
  it('timeUsToPx should convert microseconds to pixels correctly', () => {
    // 1 second (1000000 us) should be BASE_PX_PER_SECOND at 100% zoom
    expect(timeUsToPx(1_000_000, 100)).toBe(BASE_PX_PER_SECOND);
    // 0.5 second
    expect(timeUsToPx(500_000, 100)).toBe(BASE_PX_PER_SECOND / 2);
  });

  it('pxToTimeUs should convert pixels to microseconds correctly', () => {
    expect(pxToTimeUs(BASE_PX_PER_SECOND, 100)).toBe(1_000_000);
    expect(pxToTimeUs(BASE_PX_PER_SECOND / 2, 100)).toBe(500_000);
    // Should never return negative
    expect(pxToTimeUs(-10, 100)).toBe(0);
  });

  it('pxToDeltaUs should convert pixels to delta microseconds correctly', () => {
    expect(pxToDeltaUs(BASE_PX_PER_SECOND, 100)).toBe(1_000_000);
    // Delta CAN be negative
    expect(pxToDeltaUs(-BASE_PX_PER_SECOND, 100)).toBe(-1_000_000);
  });
});
