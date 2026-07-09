/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  zoomToPxPerSecond,
  pxPerSecondToZoom,
  timeUsToPx,
  timeUsToViewportPx,
  absolutePxToViewportPx,
  timelineRangeToRoundedPx,
  pxToTimeUs,
  pxToDeltaUs,
  computeAnchoredScrollLeft,
  computeTimelineCenteredScrollLeftForPlayhead,
  computeTimelinePlaybackAutoScrollLeft,
  computeTimelineScrollLeftForPlayhead,
  sanitizeFps,
  quantizeDeltaUsToFrames,
  quantizeStartUsToFrames,
  sanitizeSnapTargetsUs,
  pickBestSnapCandidateUs,
  computeSnappedStartUs,
  calculatePointerTimeUs,
} from '~/utils/timeline/geometry';

describe('zoomToPxPerSecond', () => {
  it('returns base value at zoom 50', () => {
    expect(zoomToPxPerSecond(50)).toBe(10);
  });

  it('doubles at zoom 57', () => {
    expect(zoomToPxPerSecond(57)).toBe(20);
  });

  it('halves at zoom 43', () => {
    expect(zoomToPxPerSecond(43)).toBe(5);
  });
});

describe('pxPerSecondToZoom', () => {
  it('round-trips through zoomToPxPerSecond', () => {
    const zoom = 60;
    const pps = zoomToPxPerSecond(zoom);
    expect(pxPerSecondToZoom(pps)).toBeCloseTo(zoom, 10);
  });
});

describe('timeUsToPx / pxToTimeUs', () => {
  it('converts time to pixels and back', () => {
    const px = timeUsToPx(1_000_000, 50);
    expect(px).toBe(10);
    expect(pxToTimeUs(px, 50)).toBe(1_000_000);
  });
});

describe('timelineRangeToRoundedPx', () => {
  it('derives width from rounded absolute edges', () => {
    const range = { startUs: 1_000_000, durationUs: 1_000_000 };
    const zoom = pxPerSecondToZoom(10.4);

    expect(timelineRangeToRoundedPx(range, zoom, 1)).toEqual({
      leftPx: 10,
      widthPx: 11,
      endPx: 21,
    });
  });

  it('keeps adjacent ranges sharing the same rounded boundary', () => {
    const zoom = pxPerSecondToZoom(10.4);
    const left = timelineRangeToRoundedPx({ startUs: 0, durationUs: 1_000_000 }, zoom, 1);
    const right = timelineRangeToRoundedPx({ startUs: 1_000_000, durationUs: 1_000_000 }, zoom, 1);

    expect(left.endPx).toBe(right.leftPx);
  });
});

describe('absolutePxToViewportPx / timeUsToViewportPx', () => {
  it('rounds in absolute space, then subtracts the raw scroll offset', () => {
    expect(absolutePxToViewportPx(10.4, 3.2)).toBe(10 - 3.2);
    expect(timeUsToViewportPx(1_000_000, 50, 3.2)).toBe(
      Math.round(timeUsToPx(1_000_000, 50)) - 3.2,
    );
  });

  it('keeps a playhead pixel-aligned with a clip edge on the same instant for fractional scrollLeft', () => {
    // The clip edge screen position = round(timeUsToPx(start)) shifted by the
    // container transform (-scrollLeft). The playhead must resolve to the exact
    // same screen pixel so they never drift apart as scrollLeft varies.
    const zoom = 73;
    const timeUs = 12_345_678;

    const clipLeftPx = timelineRangeToRoundedPx({ startUs: timeUs, durationUs: 1 }, zoom, 2).leftPx;

    for (const scrollLeft of [0, 1, 2.5, 100.4, 257.35, 999.9]) {
      const playheadViewportX = timeUsToViewportPx(timeUs, zoom, scrollLeft);
      const clipViewportX = clipLeftPx - scrollLeft;
      expect(playheadViewportX).toBe(clipViewportX);
    }
  });
});

describe('pxToDeltaUs', () => {
  it('converts pixel delta to microseconds', () => {
    expect(pxToDeltaUs(10, 50)).toBe(1_000_000);
  });
});

describe('computeAnchoredScrollLeft', () => {
  it('computes scroll left based on anchor', () => {
    const result = computeAnchoredScrollLeft({
      prevZoom: 50,
      nextZoom: 50,
      prevScrollLeft: 0,
      viewportWidth: 1000,
      anchor: { anchorTimeUs: 1_000_000, anchorViewportX: 500 },
    });
    expect(result).toBe(Math.max(0, 10 - 500));
  });

  it('keeps adaptive anchor (timeline center) at viewport center when zooming from short timeline', () => {
    const result = computeAnchoredScrollLeft({
      prevZoom: 50,
      nextZoom: 100,
      prevScrollLeft: 0,
      viewportWidth: 1000,
      anchor: { anchorTimeUs: 500_000, anchorViewportX: 500 },
    });

    const expectedAnchorPx = timeUsToPx(500_000, 100);
    expect(expectedAnchorPx - result).toBeCloseTo(500, 6);
  });

  it('clamps scrollLeft to 0 when timeline still fits viewport after adaptive zoom', () => {
    const result = computeAnchoredScrollLeft({
      prevZoom: 50,
      nextZoom: 60,
      prevScrollLeft: 0,
      viewportWidth: 1000,
      anchor: { anchorTimeUs: 500_000, anchorViewportX: 500 },
    });

    expect(result).toBe(0);
  });
});

describe('computeTimelinePlaybackAutoScrollLeft', () => {
  it('returns null when playhead is before trigger', () => {
    const result = computeTimelinePlaybackAutoScrollLeft({
      playheadPx: 100,
      scrollLeft: 0,
      viewportWidth: 1000,
    });
    expect(result).toBeNull();
  });

  it('scrolls when playhead exceeds trigger', () => {
    const result = computeTimelinePlaybackAutoScrollLeft({
      playheadPx: 900,
      scrollLeft: 0,
      viewportWidth: 1000,
    });
    expect(result).toBe(900 - 1000 * 0.3);
  });
});

describe('computeTimelineScrollLeftForPlayhead', () => {
  it('returns null when playhead is already visible', () => {
    const result = computeTimelineScrollLeftForPlayhead({
      playheadPx: 150,
      scrollLeft: 100,
      viewportWidth: 200,
    });

    expect(result).toBeNull();
  });

  it('centers the playhead when it is outside the viewport', () => {
    const result = computeTimelineScrollLeftForPlayhead({
      playheadPx: 500,
      scrollLeft: 0,
      viewportWidth: 200,
    });

    expect(result).toBe(400);
  });

  it('clamps to available scroll range', () => {
    const result = computeTimelineScrollLeftForPlayhead({
      playheadPx: 900,
      scrollLeft: 0,
      viewportWidth: 200,
      maxScrollLeft: 650,
    });

    expect(result).toBe(650);
  });
});

describe('computeTimelineCenteredScrollLeftForPlayhead', () => {
  it('centers the playhead even when it is already visible', () => {
    const result = computeTimelineCenteredScrollLeftForPlayhead({
      playheadPx: 250,
      viewportWidth: 200,
    });

    expect(result).toBe(150);
  });

  it('clamps centered scroll to available range', () => {
    const result = computeTimelineCenteredScrollLeftForPlayhead({
      playheadPx: 900,
      viewportWidth: 200,
      maxScrollLeft: 650,
    });

    expect(result).toBe(650);
  });
});

describe('sanitizeFps', () => {
  it('returns fallback for invalid values', () => {
    expect(sanitizeFps(NaN)).toBe(30);
    expect(sanitizeFps(Infinity)).toBe(30);
  });

  it('clamps to valid range', () => {
    expect(sanitizeFps(0)).toBe(1);
    expect(sanitizeFps(300)).toBe(240);
  });

  it('preserves non-integer rates', () => {
    expect(sanitizeFps(29.97)).toBe(29.97);
  });
});

describe('quantizeDeltaUsToFrames', () => {
  it('rounds delta to frame boundary', () => {
    expect(quantizeDeltaUsToFrames(1_000_000, 30)).toBe(1_000_000);
  });
});

describe('quantizeStartUsToFrames', () => {
  it('rounds start to frame boundary', () => {
    expect(quantizeStartUsToFrames(1_000_000, 30)).toBe(1_000_000);
  });
});

describe('sanitizeSnapTargetsUs', () => {
  it('sorts and deduplicates targets', () => {
    expect(sanitizeSnapTargetsUs([3, 1, 2, 1, NaN])).toEqual([1, 2, 3]);
  });

  it('filters out negative and non-finite values', () => {
    expect(sanitizeSnapTargetsUs([-5, NaN, Infinity])).toEqual([0]);
    expect(sanitizeSnapTargetsUs([NaN, Infinity])).toEqual([]);
  });
});

describe('pickBestSnapCandidateUs', () => {
  it('picks closest target within threshold', () => {
    expect(pickBestSnapCandidateUs({ rawUs: 105, thresholdUs: 10, targetsUs: [100, 120] })).toEqual(
      { snappedUs: 100, distUs: 5 },
    );
  });

  it('returns raw value when no target is within threshold', () => {
    expect(pickBestSnapCandidateUs({ rawUs: 150, thresholdUs: 10, targetsUs: [100, 200] })).toEqual(
      { snappedUs: 150, distUs: 10 },
    );
  });
});

describe('computeSnappedStartUs', () => {
  it('snaps to nearest target when enabled', () => {
    const result = computeSnappedStartUs({
      rawStartUs: 105,
      draggingItemDurationUs: 100,
      fps: 30,
      zoom: 50,
      snapThresholdPx: 10,
      snapTargetsUs: [100, 200],
      enableFrameSnap: false,
      enableClipSnap: true,
      frameOffsetUs: 0,
    });
    expect(result).toBe(100);
  });

  it('snaps to frame boundary when enabled', () => {
    const result = computeSnappedStartUs({
      rawStartUs: 1_000_001,
      draggingItemDurationUs: 100,
      fps: 30,
      zoom: 50,
      snapThresholdPx: 0,
      snapTargetsUs: [],
      enableFrameSnap: true,
      enableClipSnap: false,
      frameOffsetUs: 0,
    });
    expect(result).toBe(1_000_000);
  });

  // Regression: a clip whose start sits off the frame grid (e.g. placed flush
  // after a clip with a non-frame-aligned duration) must still resolve to an
  // absolute-grid position with frameOffsetUs:0 — so the live move preview lands
  // exactly where the move command commits it, with no 1-frame jump on release.
  it('frame-snaps off-grid starts to the absolute grid (preview == commit)', () => {
    const fps = 30;
    const frameUs = 1e6 / fps;
    // ~half a frame off the grid — the worst case for a phase-preserving snap.
    const rawStartUs = quantizeStartUsToFrames(2_000_000, fps) + Math.round(frameUs / 2) + 137;

    const previewStartUs = computeSnappedStartUs({
      rawStartUs,
      draggingItemDurationUs: 500_000,
      fps,
      zoom: 50,
      snapThresholdPx: 0,
      snapTargetsUs: [],
      enableFrameSnap: true,
      enableClipSnap: false,
      frameOffsetUs: 0,
    });

    // The commit re-quantizes to the absolute grid; with frameOffsetUs:0 the
    // preview is already grid-aligned, so that re-quantization is a no-op.
    expect(previewStartUs).toBe(quantizeStartUsToFrames(previewStartUs, fps));
  });
});

describe('calculatePointerTimeUs', () => {
  it('calculates pointer time code correctly within element width', () => {
    const params = {
      clientX: 150,
      rectLeft: 100,
      rectWidth: 200,
      clipStartUs: 1_000_000,
      zoom: 50,
    };
    expect(calculatePointerTimeUs(params)).toBe(6_000_000);
  });

  it('clamps pointer position within rectWidth', () => {
    const params = {
      clientX: 400,
      rectLeft: 100,
      rectWidth: 200,
      clipStartUs: 1_000_000,
      zoom: 50,
    };
    expect(calculatePointerTimeUs(params)).toBe(21_000_000);
  });

  it('clamps pointer position to 0 delta when clientX is to the left of rectLeft', () => {
    const params = {
      clientX: 50,
      rectLeft: 100,
      rectWidth: 200,
      clipStartUs: 1_000_000,
      zoom: 50,
    };
    expect(calculatePointerTimeUs(params)).toBe(1_000_000);
  });
});
