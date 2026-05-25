import { describe, expect, it } from 'vitest';
import { getTimelineTickCanvasX } from '~/utils/timeline/ruler-ticks';
import { timeUsToPx } from '~/utils/timeline/geometry';

describe('timeline ruler ticks', () => {
  it('keeps the same viewport pixel when canvases use different render windows', () => {
    const timeUs = 34_133_333;
    const zoom = 50;
    const scrollLeft = 257.35;
    const rulerRenderStartPx = 0;
    const gridRenderStartPx = 112.8;

    const rulerViewportX =
      getTimelineTickCanvasX({ timeUs, zoom, renderStartPx: rulerRenderStartPx }) +
      rulerRenderStartPx -
      scrollLeft;
    const gridViewportX =
      getTimelineTickCanvasX({ timeUs, zoom, renderStartPx: gridRenderStartPx }) +
      gridRenderStartPx -
      scrollLeft;

    expect(rulerViewportX).toBe(gridViewportX);
    expect(rulerViewportX).toBe(Math.round(timeUsToPx(timeUs, zoom)) + 0.5 - scrollLeft);
  });
});
