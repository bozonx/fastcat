import { describe, it, expect } from 'vitest';
import {
  timeUsToPx,
  pxToTimeUs,
  pxToDeltaUs,
  BASE_PX_PER_SECOND,
  computeAnchoredScrollLeft,
} from '../../../../src/composables/timeline/useTimelineInteraction';

describe('useTimelineInteraction', () => {
  it('timeUsToPx should convert microseconds to pixels correctly', () => {
    // 1 second (1000000 us) should be BASE_PX_PER_SECOND at 1x zoom (slider position 50)
    expect(timeUsToPx(1_000_000, 50)).toBe(BASE_PX_PER_SECOND);
    // 0.5 second
    expect(timeUsToPx(500_000, 50)).toBe(BASE_PX_PER_SECOND / 2);
  });

  it('pxToTimeUs should convert pixels to microseconds correctly', () => {
    expect(pxToTimeUs(BASE_PX_PER_SECOND, 50)).toBe(1_000_000);
    expect(pxToTimeUs(BASE_PX_PER_SECOND / 2, 50)).toBe(500_000);
    // Should never return negative
    expect(pxToTimeUs(-10, 50)).toBe(0);
  });

  it('pxToDeltaUs should convert pixels to delta microseconds correctly', () => {
    expect(pxToDeltaUs(BASE_PX_PER_SECOND, 50)).toBe(1_000_000);
    // Delta CAN be negative
    expect(pxToDeltaUs(-BASE_PX_PER_SECOND, 50)).toBe(-1_000_000);
  });

  it('computeAnchoredScrollLeft should keep anchor time at same viewport position', () => {
    // At zoom 50, 1s => BASE_PX_PER_SECOND.
    // We want time=10s to stay at viewportX=100.
    const prevZoom = 50;
    const nextZoom = 60;
    const viewportWidth = 300;

    const anchorTimeUs = 10_000_000;
    const anchorViewportX = 100;

    const anchorPxAtPrevZoom = timeUsToPx(anchorTimeUs, prevZoom);
    const prevScrollLeft = Math.max(0, anchorPxAtPrevZoom - anchorViewportX);

    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom,
      nextZoom,
      prevScrollLeft,
      viewportWidth,
      anchor: { anchorTimeUs, anchorViewportX },
    });

    const anchorPxAtNextZoom = timeUsToPx(anchorTimeUs, nextZoom);
    expect(anchorPxAtNextZoom - nextScrollLeft).toBeCloseTo(anchorViewportX, 6);
  });

  it('computeAnchoredScrollLeft should clamp negative scrollLeft to 0', () => {
    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom: 50,
      nextZoom: 0,
      prevScrollLeft: 0,
      viewportWidth: 300,
      anchor: { anchorTimeUs: 0, anchorViewportX: 200 },
    });

    expect(nextScrollLeft).toBe(0);
  });
});
