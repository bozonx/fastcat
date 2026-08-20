/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  zoomToPxPerSecond,
  pxPerSecondToZoom,
  ticksToPx,
  ticksToViewportPx,
  absolutePxToViewportPx,
  timelineRangeToRoundedPx,
  pxToTimeTicks,
  pxToDeltaTicks,
  computeAnchoredScrollLeft,
  computeTimelineCenteredScrollLeftForPlayhead,
  computeTimelinePlaybackAutoScrollLeft,
  computeTimelineScrollLeftForPlayhead,
  sanitizeFps,
  quantizeDeltaTicksToFrames,
  quantizeStartTicksToFrames,
  subframePhaseTicks,
  sanitizeSnapTargetsTicks,
  pickBestSnapCandidateTicks,
  computeSnappedStartTicks,
  calculatePointerTimeTicks,
} from '~/utils/timeline/geometry';
import { TICKS_PER_SECOND } from '~/utils/time';

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

describe('ticksToPx / pxToTimeTicks', () => {
  it('converts time to pixels and back', () => {
    const px = ticksToPx(254_016_000_000, 50);
    expect(px).toBe(10);
    expect(pxToTimeTicks(px, 50)).toBe(254_016_000_000);
  });
});

describe('timelineRangeToRoundedPx', () => {
  it('derives width from rounded absolute edges', () => {
    const range = { startTicks: 254_016_000_000, durationTicks: 254_016_000_000 };
    const zoom = pxPerSecondToZoom(10.4);

    expect(timelineRangeToRoundedPx(range, zoom, 1)).toEqual({
      leftPx: 10,
      widthPx: 11,
      endPx: 21,
    });
  });

  it('keeps adjacent ranges sharing the same rounded boundary', () => {
    const zoom = pxPerSecondToZoom(10.4);
    const left = timelineRangeToRoundedPx(
      { startTicks: 0, durationTicks: 254_016_000_000 },
      zoom,
      1,
    );
    const right = timelineRangeToRoundedPx(
      { startTicks: 254_016_000_000, durationTicks: 254_016_000_000 },
      zoom,
      1,
    );

    expect(left.endPx).toBe(right.leftPx);
  });
});

describe('absolutePxToViewportPx / ticksToViewportPx', () => {
  it('rounds in absolute space, then subtracts the raw scroll offset', () => {
    expect(absolutePxToViewportPx(10.4, 3.2)).toBe(10 - 3.2);
    expect(ticksToViewportPx(254_016_000_000, 50, 3.2)).toBe(
      Math.round(ticksToPx(254_016_000_000, 50)) - 3.2,
    );
  });

  it('keeps a playhead pixel-aligned with a clip edge on the same instant for fractional scrollLeft', () => {
    // The clip edge screen position = round(ticksToPx(start)) shifted by the
    // container transform (-scrollLeft). The playhead must resolve to the exact
    // same screen pixel so they never drift apart as scrollLeft varies.
    const zoom = 73;
    const timeTicks = 3_135_999_742_848;

    const clipLeftPx = timelineRangeToRoundedPx(
      { startTicks: timeTicks, durationTicks: 1 },
      zoom,
      2,
    ).leftPx;

    for (const scrollLeft of [0, 1, 2.5, 100.4, 257.35, 999.9]) {
      const playheadViewportX = ticksToViewportPx(timeTicks, zoom, scrollLeft);
      const clipViewportX = clipLeftPx - scrollLeft;
      expect(playheadViewportX).toBe(clipViewportX);
    }
  });
});

describe('pxToDeltaTicks', () => {
  it('converts pixel delta to ticks', () => {
    expect(pxToDeltaTicks(10, 50)).toBe(254_016_000_000);
  });
});

describe('computeAnchoredScrollLeft', () => {
  it('computes scroll left based on anchor', () => {
    const result = computeAnchoredScrollLeft({
      prevZoom: 50,
      nextZoom: 50,
      prevScrollLeft: 0,
      viewportWidth: 1000,
      anchor: { anchorTimeTicks: 254_016_000_000, anchorViewportX: 500 },
    });
    expect(result).toBe(Math.max(0, 10 - 500));
  });

  it('keeps adaptive anchor (timeline center) at viewport center when zooming from short timeline', () => {
    const result = computeAnchoredScrollLeft({
      prevZoom: 50,
      nextZoom: 100,
      prevScrollLeft: 0,
      viewportWidth: 1000,
      anchor: { anchorTimeTicks: 127_008_000_000, anchorViewportX: 500 },
    });

    const expectedAnchorPx = ticksToPx(127_008_000_000, 100);
    expect(expectedAnchorPx - result).toBeCloseTo(500, 6);
  });

  it('clamps scrollLeft to 0 when timeline still fits viewport after adaptive zoom', () => {
    const result = computeAnchoredScrollLeft({
      prevZoom: 50,
      nextZoom: 60,
      prevScrollLeft: 0,
      viewportWidth: 1000,
      anchor: { anchorTimeTicks: 127_008_000_000, anchorViewportX: 500 },
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
    expect(sanitizeFps(29.97)).toBeCloseTo(30_000 / 1_001, 10);
  });
});

describe('quantizeDeltaTicksToFrames', () => {
  it('rounds delta to frame boundary', () => {
    expect(quantizeDeltaTicksToFrames(TICKS_PER_SECOND, 30)).toBe(TICKS_PER_SECOND);
  });
});

describe('quantizeStartTicksToFrames', () => {
  it('rounds start to frame boundary', () => {
    expect(quantizeStartTicksToFrames(TICKS_PER_SECOND, 30)).toBe(TICKS_PER_SECOND);
  });
});

describe('sanitizeSnapTargetsTicks', () => {
  it('sorts and deduplicates targets', () => {
    expect(sanitizeSnapTargetsTicks([3, 1, 2, 1, NaN])).toEqual([1, 2, 3]);
  });

  it('filters out negative and non-finite values', () => {
    expect(sanitizeSnapTargetsTicks([-5, NaN, Infinity])).toEqual([0]);
    expect(sanitizeSnapTargetsTicks([NaN, Infinity])).toEqual([]);
  });
});

describe('pickBestSnapCandidateTicks', () => {
  it('picks closest target within threshold', () => {
    expect(
      pickBestSnapCandidateTicks({ rawTicks: 105, thresholdTicks: 10, targetsTicks: [100, 120] }),
    ).toEqual({ snappedTicks: 100, distTicks: 5 });
  });

  it('returns raw value when no target is within threshold', () => {
    expect(
      pickBestSnapCandidateTicks({ rawTicks: 150, thresholdTicks: 10, targetsTicks: [100, 200] }),
    ).toEqual({ snappedTicks: 150, distTicks: 10 });
  });
});

describe('computeSnappedStartTicks', () => {
  it('snaps to nearest target when enabled', () => {
    const result = computeSnappedStartTicks({
      rawStartTicks: 105,
      draggingItemDurationTicks: 100,
      fps: 30,
      zoom: 50,
      snapThresholdPx: 10,
      snapTargetsTicks: [100, 200],
      enableFrameSnap: false,
      enableClipSnap: true,
      frameOffsetTicks: 0,
    });
    expect(result).toBe(100);
  });

  it('snaps to frame boundary when enabled', () => {
    const result = computeSnappedStartTicks({
      rawStartTicks: TICKS_PER_SECOND + 1,
      draggingItemDurationTicks: 100,
      fps: 30,
      zoom: 50,
      snapThresholdPx: 0,
      snapTargetsTicks: [],
      enableFrameSnap: true,
      enableClipSnap: false,
      frameOffsetTicks: 0,
    });
    expect(result).toBe(TICKS_PER_SECOND);
  });

  // Regression: a clip whose start sits off the frame grid (e.g. placed flush
  // after a clip with a non-frame-aligned duration) must still resolve to an
  // absolute-grid position with frameOffsetTicks:0 — so the live move preview lands
  // exactly where the move command commits it, with no 1-frame jump on release.
  it('frame-snaps off-grid starts to the absolute grid (preview == commit)', () => {
    const fps = 30;
    const frameTicks = TICKS_PER_SECOND / fps;
    // ~half a frame off the grid — the worst case for a phase-preserving snap.
    const rawStartTicks =
      quantizeStartTicksToFrames(2 * TICKS_PER_SECOND, fps) + Math.round(frameTicks / 2) + 137;

    const previewStartTicks = computeSnappedStartTicks({
      rawStartTicks,
      draggingItemDurationTicks: 127_008_000_000,
      fps,
      zoom: 50,
      snapThresholdPx: 0,
      snapTargetsTicks: [],
      enableFrameSnap: true,
      enableClipSnap: false,
      frameOffsetTicks: 0,
    });

    // The commit re-quantizes to the absolute grid; with frameOffsetTicks:0 the
    // preview is already grid-aligned, so that re-quantization is a no-op.
    expect(previewStartTicks).toBe(quantizeStartTicksToFrames(previewStartTicks, fps));
  });
});

describe('subframePhaseTicks', () => {
  it('returns 0 for a frame-aligned start', () => {
    const fps = 30;
    const aligned = quantizeStartTicksToFrames(2 * TICKS_PER_SECOND, fps);
    expect(subframePhaseTicks(aligned, fps)).toBe(0);
  });

  it('preserves a one-tick phase', () => {
    const fps = 30;
    const aligned = quantizeStartTicksToFrames(2 * TICKS_PER_SECOND, fps);
    expect(subframePhaseTicks(aligned + 1, fps)).toBe(1);
    expect(subframePhaseTicks(aligned - 1, fps)).toBe(-1);
  });

  it('captures a genuine sub-frame offset', () => {
    const fps = 30;
    const aligned = quantizeStartTicksToFrames(2_000_000, fps);
    const phase = 7_000;
    expect(subframePhaseTicks(aligned + phase, fps)).toBe(phase);
  });

  it('round-trips through computeSnappedStartTicks to preserve phase across a whole-frame move', () => {
    const fps = 30;
    const frameTicks = Math.round(TICKS_PER_SECOND / fps);
    const aligned = quantizeStartTicksToFrames(2 * TICKS_PER_SECOND, fps);
    const originalStart = aligned + 7_000; // hand-dialed sub-frame sync offset
    const phase = subframePhaseTicks(originalStart, fps);

    // Drag it roughly 3.4 frames to the right; frame-snapping with the phase must
    // land it a whole number of frames away while keeping the same phase.
    const rawStart = originalStart + Math.round(frameTicks * 3.4);
    const snapped = computeSnappedStartTicks({
      rawStartTicks: rawStart,
      draggingItemDurationTicks: 127_008_000_000,
      fps,
      zoom: 50,
      snapThresholdPx: 0,
      snapTargetsTicks: [],
      enableFrameSnap: true,
      enableClipSnap: false,
      frameOffsetTicks: phase,
    });

    // Same phase preserved, and moved by an exact whole number of frames.
    expect(subframePhaseTicks(snapped, fps)).toBe(phase);
    const movedFrames = ((snapped - originalStart) * fps) / TICKS_PER_SECOND;
    expect(movedFrames).toBe(Math.round(movedFrames));
  });
});

describe('calculatePointerTimeTicks', () => {
  it('calculates pointer time code correctly within element width', () => {
    const params = {
      clientX: 150,
      rectLeft: 100,
      rectWidth: 200,
      clipStartTicks: TICKS_PER_SECOND,
      zoom: 50,
    };
    expect(calculatePointerTimeTicks(params)).toBe(6 * TICKS_PER_SECOND);
  });

  it('clamps pointer position within rectWidth', () => {
    const params = {
      clientX: 400,
      rectLeft: 100,
      rectWidth: 200,
      clipStartTicks: TICKS_PER_SECOND,
      zoom: 50,
    };
    expect(calculatePointerTimeTicks(params)).toBe(21 * TICKS_PER_SECOND);
  });

  it('clamps pointer position to 0 delta when clientX is to the left of rectLeft', () => {
    const params = {
      clientX: 50,
      rectLeft: 100,
      rectWidth: 200,
      clipStartTicks: TICKS_PER_SECOND,
      zoom: 50,
    };
    expect(calculatePointerTimeTicks(params)).toBe(TICKS_PER_SECOND);
  });
});
