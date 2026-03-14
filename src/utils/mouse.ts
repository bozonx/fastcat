export const COMMON_WHEEL_ACTIONS = [
  'scroll_vertical',
  'scroll_horizontal',
  'zoom_horizontal',
  'zoom_vertical',
  'seek_frame',
  'seek_second',
  'none',
] as const;

export type CommonWheelAction = (typeof COMMON_WHEEL_ACTIONS)[number];

export const TIMELINE_WHEEL_ACTIONS = COMMON_WHEEL_ACTIONS;

export const MONITOR_WHEEL_ACTIONS = [
  'zoom',
  'scroll_vertical',
  'scroll_horizontal',
  'none',
] as const;

export const TRACK_HEADERS_WHEEL_ACTIONS = ['resize_track', ...COMMON_WHEEL_ACTIONS] as const;

export const RULER_WHEEL_ACTIONS = COMMON_WHEEL_ACTIONS;

export const RULER_CLICK_ACTIONS = ['add_marker', 'reset_zoom', 'select_area', 'none'] as const;

export const RULER_DOUBLE_CLICK_ACTIONS = RULER_CLICK_ACTIONS;

export const MIDDLE_CLICK_ACTIONS = ['pan', 'move_playhead', 'reset_zoom', 'select_area', 'none'] as const;

export const DRAG_ACTIONS = ['pan', 'move_playhead', 'select_area', 'none'] as const;

export const SHIFT_CLICK_ACTIONS = RULER_CLICK_ACTIONS;

/**
 * Helper to determine if a wheel event is primarily a horizontal scroll
 * (e.g. from a trackpad or shift+wheel).
 */
export function isSecondaryWheel(e: WheelEvent): boolean {
  return (
    (e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) ||
    (e.deltaY === 0 && e.deltaX !== 0)
  );
}

/**
 * Helper to determine the dominant delta value from a wheel event.
 */
export function getWheelDelta(e: WheelEvent): number {
  return isSecondaryWheel(e) ? e.deltaX : e.deltaY;
}
