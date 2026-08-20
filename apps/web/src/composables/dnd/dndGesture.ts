/**
 * Pure gesture helpers for the pointer-DnD engine. Kept side-effect free so the
 * threshold / long-press decisions can be unit-tested without a DOM.
 */
import type { DndPointerType } from './dndTypes';

/** Mouse/pen need only a few px of travel before a drag is intended. */
export const DRAG_THRESHOLD_MOUSE_PX = 5;

/**
 * Touch needs a larger slop so a tap or the start of a scroll is not read as a
 * drag. On touch the drag is gated by a long-press timer rather than pure
 * movement (see {@link isTouchDragGesture}).
 */
export const DRAG_THRESHOLD_TOUCH_PX = 12;

/** Past this much movement during the press window, a touch is a scroll, not a drag. */
export const TOUCH_SCROLL_CANCEL_PX = 16;

/** Long-press duration that promotes a stationary touch into a drag. */
export const TOUCH_LONG_PRESS_MS = 400;

export function dragThresholdForPointer(pointerType: DndPointerType): number {
  return pointerType === 'touch' ? DRAG_THRESHOLD_TOUCH_PX : DRAG_THRESHOLD_MOUSE_PX;
}

export function pointerDistance(dx: number, dy: number): number {
  return Math.hypot(dx, dy);
}

export function exceededThreshold(dx: number, dy: number, threshold: number): boolean {
  return pointerDistance(dx, dy) > threshold;
}

/**
 * For mouse/pen: a drag begins as soon as the pointer travels past the
 * threshold. For touch we do NOT start on movement (that would steal scroll);
 * the long-press timer starts the drag instead.
 */
export function shouldStartDragOnMove(params: {
  pointerType: DndPointerType;
  dx: number;
  dy: number;
}): boolean {
  if (params.pointerType === 'touch') return false;
  return exceededThreshold(params.dx, params.dy, dragThresholdForPointer(params.pointerType));
}

/**
 * Whether a touch press that moved this far should still be allowed to become a
 * drag via long-press. Once the finger wanders past the scroll-cancel distance
 * the gesture is a scroll and the pending long-press must be abandoned.
 */
export function touchMovedIntoScroll(dx: number, dy: number): boolean {
  return pointerDistance(dx, dy) > TOUCH_SCROLL_CANCEL_PX;
}

/** Only the primary (left) mouse button starts a drag; touch/pen have no button gate. */
export function isPrimaryPointer(pointerType: DndPointerType, button: number): boolean {
  if (pointerType === 'mouse' || pointerType === '') return button === 0;
  return true;
}

export function normalizePointerType(value: string | undefined): DndPointerType {
  if (value === 'touch' || value === 'pen' || value === 'mouse') return value;
  return '';
}
