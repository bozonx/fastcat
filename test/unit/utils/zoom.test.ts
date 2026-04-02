/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MONITOR_ZOOM,
  DEFAULT_TIMELINE_ZOOM_POSITION,
  formatZoomMultiplier,
  snapMonitorZoom,
  snapTimelineZoomPosition,
  stepMonitorZoom,
  stepTimelineZoomPosition,
  timelineZoomPositionToScale,
} from '~/utils/zoom';

describe('zoom utils', () => {
  it('keeps timeline default zoom at x1', () => {
    expect(timelineZoomPositionToScale(DEFAULT_TIMELINE_ZOOM_POSITION)).toBeCloseTo(1, 6);
  });

  it('steps timeline zoom through discrete predictable values', () => {
    const zoomIn = stepTimelineZoomPosition(DEFAULT_TIMELINE_ZOOM_POSITION, 1);
    const zoomOut = stepTimelineZoomPosition(DEFAULT_TIMELINE_ZOOM_POSITION, -1);

    expect(zoomIn).toBeGreaterThan(DEFAULT_TIMELINE_ZOOM_POSITION);
    expect(zoomOut).toBeLessThan(DEFAULT_TIMELINE_ZOOM_POSITION);
    expect(snapTimelineZoomPosition(zoomIn + 0.003)).toBe(zoomIn);
  });

  it('snaps and steps monitor zoom around common multiplier values', () => {
    expect(snapMonitorZoom(0.74)).toBeCloseTo(0.75, 6);
    expect(stepMonitorZoom(DEFAULT_MONITOR_ZOOM, 1)).toBeGreaterThan(1);
    expect(stepMonitorZoom(DEFAULT_MONITOR_ZOOM, -1)).toBeLessThan(1);
  });

  it('formats zoom multiplier without unnecessary trailing zeroes', () => {
    expect(formatZoomMultiplier(2)).toBe('x2');
    expect(formatZoomMultiplier(0.75)).toBe('x0.75');
    expect(formatZoomMultiplier(1.5)).toBe('x1.5');
  });
});
