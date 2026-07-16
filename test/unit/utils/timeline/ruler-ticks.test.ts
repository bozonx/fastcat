import { describe, expect, it } from 'vitest';
import {
  getFirstTimelineRulerMajorFrame,
  getTimelineFrameTickCanvasX,
  getTimelineRulerMainStepS,
  getTimelineRulerSubStepFrames,
  getTimelineTickCanvasX,
} from '~/utils/timeline/ruler-ticks';
import { timeUsToPx } from '~/utils/timeline/geometry';
import { TICKS_PER_MICROSECOND } from '~/utils/time';

describe('timeline ruler ticks', () => {
  it('keeps the same viewport pixel when canvases use different render windows', () => {
    const timeTicks = 34_133_333;
    const zoom = 50;
    const scrollLeft = 257.35;
    const rulerRenderStartPx = 0;
    const gridRenderStartPx = 112.8;

    const rulerViewportX =
      getTimelineTickCanvasX({ timeTicks, zoom, renderStartPx: rulerRenderStartPx }) +
      rulerRenderStartPx -
      scrollLeft;
    const gridViewportX =
      getTimelineTickCanvasX({ timeTicks, zoom, renderStartPx: gridRenderStartPx }) +
      gridRenderStartPx -
      scrollLeft;

    expect(rulerViewportX).toBe(gridViewportX);
    expect(rulerViewportX).toBe(Math.round(timeUsToPx(timeTicks, zoom)) + 0.5 - scrollLeft);
  });

  it('frame tick X agrees with the timeTicks tick X for the same instant', () => {
    const fps = 30;
    const zoom = 70;
    const renderStartPx = 40;
    const frame = 123;

    const frameX = getTimelineFrameTickCanvasX({ frame, fps, zoom, renderStartPx });
    const timeX = getTimelineTickCanvasX({
      timeTicks: Math.round((frame * 1_000_000 * TICKS_PER_MICROSECOND) / fps),
      zoom,
      renderStartPx,
    });

    expect(frameX).toBe(timeX);
  });
});

describe('getTimelineRulerMainStepS', () => {
  // Steps are chosen so a labeled mark stays at least ~90px (× scale) apart.
  it('picks the smallest step that satisfies the minimum spacing', () => {
    // 10 px/s: a 1s step is only 10px apart (< 90), so it climbs the ladder.
    expect(getTimelineRulerMainStepS({ pxPerSecond: 10, interfaceScale: 14 })).toBe(10);
  });

  it('uses 1s steps when zoomed in enough', () => {
    // 100 px/s: a 1s step is 100px apart (>= 90) → finest step.
    expect(getTimelineRulerMainStepS({ pxPerSecond: 100, interfaceScale: 14 })).toBe(1);
  });

  it('falls back to the coarsest step at extreme zoom-out', () => {
    expect(getTimelineRulerMainStepS({ pxPerSecond: 0.01, interfaceScale: 14 })).toBe(3600);
  });

  it('scales the minimum spacing with the interface scale', () => {
    // Larger UI scale demands wider spacing, pushing to a coarser step for the
    // same px/s than the default scale would.
    const base = getTimelineRulerMainStepS({ pxPerSecond: 18, interfaceScale: 14 });
    const scaled = getTimelineRulerMainStepS({ pxPerSecond: 18, interfaceScale: 28 });
    expect(scaled).toBeGreaterThanOrEqual(base);
  });
});

describe('getTimelineRulerSubStepFrames', () => {
  it('uses 10s sub-steps for minute-scale major steps', () => {
    expect(getTimelineRulerSubStepFrames({ mainStepS: 60, fps: 30 })).toBe(300);
    expect(getTimelineRulerSubStepFrames({ mainStepS: 120, fps: 30 })).toBe(300);
  });

  it('uses 5s sub-steps for 10-30s major steps', () => {
    expect(getTimelineRulerSubStepFrames({ mainStepS: 10, fps: 30 })).toBe(150);
    expect(getTimelineRulerSubStepFrames({ mainStepS: 30, fps: 30 })).toBe(150);
  });

  it('uses 1s sub-steps for 5s major steps', () => {
    expect(getTimelineRulerSubStepFrames({ mainStepS: 5, fps: 30 })).toBe(30);
  });

  it('uses 1s sub-steps below 5s major steps', () => {
    expect(getTimelineRulerSubStepFrames({ mainStepS: 2, fps: 30 })).toBe(30);
  });

  it('rounds fractional fps to whole frames and never returns below 1', () => {
    expect(getTimelineRulerSubStepFrames({ mainStepS: 5, fps: 29.97 })).toBe(30);
    expect(getTimelineRulerSubStepFrames({ mainStepS: 5, fps: 0.1 })).toBe(1);
  });
});

describe('getFirstTimelineRulerMajorFrame', () => {
  it('floors the start frame down to the major-step grid', () => {
    expect(
      getFirstTimelineRulerMajorFrame({ startFrame: 47, endFrame: 200, mainStepFrames: 30 }),
    ).toBe(30);
  });

  it('returns the start frame itself when already aligned', () => {
    expect(
      getFirstTimelineRulerMajorFrame({ startFrame: 60, endFrame: 200, mainStepFrames: 30 }),
    ).toBe(60);
  });

  it('returns 0 for a viewport anchored at the timeline origin', () => {
    expect(
      getFirstTimelineRulerMajorFrame({ startFrame: 0, endFrame: 200, mainStepFrames: 30 }),
    ).toBe(0);
  });
});
