/**
 * Shared constants for the mobile timeline / monitor surface.
 * Keeping them in one place prevents magic-number drift across components.
 */

// ─── Timeline pointer / tap thresholds ───
/** Pixels a pointer may move before a click is considered a drag. */
export const MOBILE_CLICK_MOVE_THRESHOLD_PX = 8;

/** Delay after pointer-up before the long-press flag is reset.
 *  Keeps the drawer system from re-opening immediately after a long-press multi-select. */
export const MOBILE_LONG_PRESS_RESET_DELAY_MS = 100;

// ─── Monitor long-press / double-tap ───
export const MOBILE_LONG_PRESS_MS = 500;
export const MOBILE_LONG_PRESS_MOVE_THRESHOLD_PX = 10;
export const MOBILE_DOUBLE_TAP_MS = 280;
export const MOBILE_MARKER_LONG_PRESS_MS = 500;

// ─── Edge auto-scroll during drag ───
/** Distance from viewport edge (px) that starts auto-scroll. */
export const MOBILE_EDGE_SCROLL_ZONE_PX = 60;
/** Max pixels to scroll per frame while dragging near an edge. */
export const MOBILE_EDGE_SCROLL_MAX_SPEED_PX = 14;

// ─── Drawer / UI ───
/** Default snap height for a drawer that shows only its toolbar (portrait). */
export const MOBILE_TOOLBAR_SNAP_HEIGHT_PX = 108;
