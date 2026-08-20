/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MONITOR_ZOOM,
  DEFAULT_TIMELINE_ZOOM_POSITION,
  formatZoomMultiplier,
  formatZoomPercent,
  snapMonitorZoom,
  snapTimelineZoomPosition,
  stepMonitorZoom,
  stepTimelineZoomPosition,
  timelineZoomPositionToScale,
  timelineZoomScaleToPosition,
  snapValueToNearestStep,
  getSteppedValue,
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

  it('converts scale to timeline position and back', () => {
    const scale = timelineZoomPositionToScale(60);
    const position = timelineZoomScaleToPosition(scale);
    expect(position).toBeCloseTo(60, 5);
  });

  it('snaps value to nearest step', () => {
    expect(snapValueToNearestStep(3.3, [1, 2, 3, 4])).toBe(3);
    expect(snapValueToNearestStep(3.7, [1, 2, 3, 4])).toBe(4);
    expect(snapValueToNearestStep(0, [])).toBe(0);
  });

  it('steps value up and down through steps', () => {
    expect(getSteppedValue({ value: 2.5, direction: 1, steps: [1, 2, 3, 4] })).toBe(3);
    expect(getSteppedValue({ value: 2.5, direction: -1, steps: [1, 2, 3, 4] })).toBe(2);
    expect(getSteppedValue({ value: 5, direction: 1, steps: [1, 2, 3, 4] })).toBe(4);
  });

  it('formats zoom percent', () => {
    expect(formatZoomPercent(1)).toBe('100%');
    expect(formatZoomPercent(0.5)).toBe('50%');
    expect(formatZoomPercent(2.5)).toBe('250%');
  });
});
