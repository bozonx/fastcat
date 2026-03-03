export const TIMELINE_WHEEL_ACTIONS = [
  'scroll_vertical',
  'scroll_horizontal',
  'zoom_horizontal',
  'zoom_vertical',
  'none',
] as const;

export const MONITOR_WHEEL_ACTIONS = [
  'zoom',
  'scroll_vertical',
  'scroll_horizontal',
  'none',
] as const;

export const MIDDLE_CLICK_ACTIONS = ['pan', 'none'] as const;

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
