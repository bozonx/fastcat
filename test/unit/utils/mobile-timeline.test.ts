/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  MOBILE_CLICK_MOVE_THRESHOLD_PX,
  MOBILE_LONG_PRESS_RESET_DELAY_MS,
  MOBILE_LONG_PRESS_MS,
  MOBILE_LONG_PRESS_MOVE_THRESHOLD_PX,
  MOBILE_DOUBLE_TAP_MS,
  MOBILE_MARKER_LONG_PRESS_MS,
  MOBILE_EDGE_SCROLL_ZONE_PX,
  MOBILE_EDGE_SCROLL_MAX_SPEED_PX,
  MOBILE_TOOLBAR_SNAP_HEIGHT_PX,
} from '~/utils/mobile/timeline';

describe('mobile/timeline constants', () => {
  it('exports positive numeric constants', () => {
    expect(MOBILE_CLICK_MOVE_THRESHOLD_PX).toBeGreaterThan(0);
    expect(MOBILE_LONG_PRESS_RESET_DELAY_MS).toBeGreaterThan(0);
    expect(MOBILE_LONG_PRESS_MS).toBeGreaterThan(0);
    expect(MOBILE_LONG_PRESS_MOVE_THRESHOLD_PX).toBeGreaterThan(0);
    expect(MOBILE_DOUBLE_TAP_MS).toBeGreaterThan(0);
    expect(MOBILE_MARKER_LONG_PRESS_MS).toBeGreaterThan(0);
    expect(MOBILE_EDGE_SCROLL_ZONE_PX).toBeGreaterThan(0);
    expect(MOBILE_EDGE_SCROLL_MAX_SPEED_PX).toBeGreaterThan(0);
    expect(MOBILE_TOOLBAR_SNAP_HEIGHT_PX).toBeGreaterThan(0);
  });

  it('has expected default values', () => {
    expect(MOBILE_CLICK_MOVE_THRESHOLD_PX).toBe(8);
    expect(MOBILE_LONG_PRESS_MS).toBe(500);
    expect(MOBILE_DOUBLE_TAP_MS).toBe(280);
    expect(MOBILE_EDGE_SCROLL_ZONE_PX).toBe(60);
    expect(MOBILE_EDGE_SCROLL_MAX_SPEED_PX).toBe(14);
    expect(MOBILE_TOOLBAR_SNAP_HEIGHT_PX).toBe(108);
  });
});
