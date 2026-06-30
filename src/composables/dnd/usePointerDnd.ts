/**
 * Pointer-DnD engine (source side).
 *
 * A drag *source* calls {@link armPointerDnd} from its `pointerdown` handler.
 * The engine then:
 *   1. Arms a gesture watcher that distinguishes a click/tap/scroll from a drag
 *      (movement threshold for mouse/pen, long-press for touch). Until a drag
 *      actually commits it never calls `preventDefault`, so normal clicks and
 *      touch scrolling keep working.
 *   2. On commit: captures the pointer, marks the global dnd state active, and
 *      binds window-level pointermove/up/cancel + keydown(Escape) + blur.
 *   3. On every move: hit-tests `elementFromPoint`, resolves the drop zone, and
 *      dispatches enter/over/leave to the registered zone handlers.
 *   4. On pointerup over a zone: dispatches drop. On Escape / blur / cancel: aborts.
 *   5. Always runs cleanup exactly once (no stuck cursor — the core fix over
 *      HTML5 `dragend`, which is unreliable in WebKitGTK / never fires for touch).
 *
 * Only one internal drag can be active at a time (module-level singleton).
 */
import { elementFromPoint } from '~/utils/browser-api';
import type {
  DndDragContext,
  DndDropZoneHandlers,
  DndOperation,
  DndPayload,
  DndPointer,
  DndPointerType,
} from './dndTypes';
import {
  beginDndState,
  endDndState,
  setDndActiveZoneId,
  setDndOperation,
  updateDndPointer,
} from './dndState';
import { getDndZone, resolveDndZoneId } from './dndRegistry';
import {
  isPrimaryPointer,
  normalizePointerType,
  shouldStartDragOnMove,
  touchMovedIntoScroll,
  TOUCH_LONG_PRESS_MS,
} from './dndGesture';

export interface ArmPointerDndOptions {
  payload: DndPayload;
  /**
   * Allow the secondary (right) mouse button to start the drag. Off by default
   * (right-click on file rows must open the context menu). Used by the timeline
   * toolbar's right-drag-to-open-preset gesture.
   */
  acceptSecondaryButton?: boolean;
  /** Called once when the drag actually commits (past the gesture gate). */
  onStart?: () => void;
  /**
   * Called exactly once when the drag terminates, regardless of how (drop,
   * cancel, escape, blur). Use it to reset source-side domain state. Receives
   * whether a real drop happened.
   */
  onEnd?: (info: { dropped: boolean; cancelled: boolean }) => void;
}

interface ActiveDrag extends ArmPointerDndOptions {
  pointerId: number;
  pointerType: DndPointerType;
  captureEl: Element | null;
  startX: number;
  startY: number;
  committed: boolean;
  longPressTimer: number | null;
  currentZoneId: string | null;
  lastPointer: DndPointer;
  rafId: number;
}

let activeDrag: ActiveDrag | null = null;

function readModifiers(
  e: PointerEvent | KeyboardEvent,
): Pick<DndPointer, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'> {
  return { altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey };
}

function toPointerSnapshot(e: PointerEvent): DndPointer {
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    pointerType: normalizePointerType(e.pointerType),
    ...readModifiers(e),
  };
}

function buildContext(zoneId: string, targetEl: Element | null): DndDragContext {
  return {
    payload: activeDrag!.payload,
    pointer: activeDrag!.lastPointer,
    zoneId,
    targetEl,
    setOperation: (operation: DndOperation) => setDndOperation(operation),
  };
}

function zoneAccepts(handlers: DndDropZoneHandlers | null, payload: DndPayload): boolean {
  if (!handlers) return false;
  if (!handlers.canAccept) return true;
  return handlers.canAccept(payload);
}

/** Resolve the zone under the pointer, honouring each zone's canAccept gate. */
function resolveAcceptingZoneId(targetEl: Element | null, payload: DndPayload): string | null {
  let node: Element | null = targetEl;
  while (node) {
    const zoneId = resolveDndZoneId(node);
    if (!zoneId) break;
    const handlers = getDndZone(zoneId);
    if (zoneAccepts(handlers, payload)) return zoneId;
    // This zone rejects the payload; keep climbing to a possible outer zone.
    node = (getOwnerElementForZone(node, zoneId)?.parentElement ?? null) as Element | null;
  }
  return null;
}

/** Finds the element that actually carries the given zone id, starting at `from`. */
function getOwnerElementForZone(from: Element | null, zoneId: string): Element | null {
  let node: Element | null = from;
  while (node) {
    if (node.getAttribute?.('data-dnd-zone-id') === zoneId) return node;
    node = node.parentElement;
  }
  return null;
}

function dispatchMove() {
  const drag = activeDrag;
  if (!drag || !drag.committed) return;

  const { clientX, clientY } = drag.lastPointer;
  const targetEl = elementFromPoint(clientX, clientY);
  const nextZoneId = resolveAcceptingZoneId(targetEl, drag.payload);

  if (nextZoneId !== drag.currentZoneId) {
    if (drag.currentZoneId) {
      getDndZone(drag.currentZoneId)?.onLeave?.(buildContext(drag.currentZoneId, targetEl));
    }
    drag.currentZoneId = nextZoneId;
    setDndActiveZoneId(nextZoneId);
    if (nextZoneId) {
      getDndZone(nextZoneId)?.onEnter?.(buildContext(nextZoneId, targetEl));
    } else {
      setDndOperation('none');
    }
  }

  if (nextZoneId) {
    getDndZone(nextZoneId)?.onOver?.(buildContext(nextZoneId, targetEl));
  }
}

function scheduleDispatchMove() {
  const drag = activeDrag;
  if (!drag) return;
  if (drag.rafId !== 0) return;
  drag.rafId = requestAnimationFrame(() => {
    if (!activeDrag) return;
    activeDrag.rafId = 0;
    dispatchMove();
  });
}

function commitDrag() {
  const drag = activeDrag;
  if (!drag || drag.committed) return;
  drag.committed = true;
  clearLongPress(drag);

  try {
    drag.captureEl?.setPointerCapture?.(drag.pointerId);
  } catch {
    // capture can fail if the pointer was already released; harmless.
  }

  beginDndState(drag.payload, drag.lastPointer);
  drag.onStart?.();
  dispatchMove();
}

function clearLongPress(drag: ActiveDrag) {
  if (drag.longPressTimer !== null) {
    window.clearTimeout(drag.longPressTimer);
    drag.longPressTimer = null;
  }
}

function teardown(info: { dropped: boolean; cancelled: boolean }) {
  const drag = activeDrag;
  if (!drag) return;
  activeDrag = null;

  clearLongPress(drag);
  if (drag.rafId !== 0) cancelAnimationFrame(drag.rafId);

  window.removeEventListener('pointermove', onWindowPointerMove, true);
  window.removeEventListener('pointerup', onWindowPointerUp, true);
  window.removeEventListener('pointercancel', onWindowPointerCancel, true);
  window.removeEventListener('keydown', onWindowKeyDown, true);
  window.removeEventListener('blur', onWindowBlur, true);

  try {
    drag.captureEl?.releasePointerCapture?.(drag.pointerId);
  } catch {
    // ignore — element may be gone or capture never taken.
  }

  // Reset visual/global state before notifying the source so the cursor never
  // lingers even if the source callback throws.
  endDndState();

  if (drag.committed) {
    drag.onEnd?.(info);
  }
}

function abort() {
  const drag = activeDrag;
  if (!drag) return;
  if (drag.committed && drag.currentZoneId) {
    getDndZone(drag.currentZoneId)?.onLeave?.(buildContext(drag.currentZoneId, null));
  }
  teardown({ dropped: false, cancelled: true });
}

function onWindowPointerMove(e: PointerEvent) {
  const drag = activeDrag;
  if (!drag || e.pointerId !== drag.pointerId) return;

  drag.lastPointer = toPointerSnapshot(e);

  if (!drag.committed) {
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (shouldStartDragOnMove({ pointerType: drag.pointerType, dx, dy })) {
      e.preventDefault();
      commitDrag();
    } else if (drag.pointerType === 'touch' && touchMovedIntoScroll(dx, dy)) {
      // Finger wandered before the long-press fired — this is a scroll. Abandon
      // the pending drag and let the scroll container have the gesture.
      teardown({ dropped: false, cancelled: true });
    }
    return;
  }

  // While committed we own the gesture; prevent text selection / scrolling.
  e.preventDefault();
  updateDndPointer(drag.lastPointer);
  scheduleDispatchMove();
}

function onWindowPointerUp(e: PointerEvent) {
  const drag = activeDrag;
  if (!drag || e.pointerId !== drag.pointerId) return;

  if (!drag.committed) {
    // Released before the gesture became a drag → it was a click/tap. Do nothing
    // (let the source's own click handling proceed) and tear the watcher down.
    teardown({ dropped: false, cancelled: false });
    return;
  }

  drag.lastPointer = toPointerSnapshot(e);
  updateDndPointer(drag.lastPointer);

  const targetEl = elementFromPoint(e.clientX, e.clientY);
  const zoneId = resolveAcceptingZoneId(targetEl, drag.payload);

  let dropped = false;
  if (zoneId) {
    const handlers = getDndZone(zoneId);
    if (handlers?.onDrop) {
      dropped = true;
      // Fire-and-forget: async drop work must not block teardown (cursor reset).
      void Promise.resolve(handlers.onDrop(buildContext(zoneId, targetEl))).catch(() => {});
    }
  }

  teardown({ dropped, cancelled: false });
}

function onWindowPointerCancel(e: PointerEvent) {
  const drag = activeDrag;
  if (!drag || e.pointerId !== drag.pointerId) return;
  abort();
}

function onWindowKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    abort();
    return;
  }
  // Re-evaluate operation when a modifier changes mid-drag (copy vs move).
  const drag = activeDrag;
  if (!drag || !drag.committed) return;
  drag.lastPointer = { ...drag.lastPointer, ...readModifiers(e) };
  updateDndPointer(drag.lastPointer);
  scheduleDispatchMove();
}

function onWindowBlur() {
  // Losing the window mid-drag (alt-tab, OS drag takeover) — abort cleanly so the
  // cursor never sticks.
  abort();
}

/**
 * Arm a pointer-drag from a source's `pointerdown`. Safe to call on every
 * pointerdown; it self-cancels any prior pending drag first.
 */
export function armPointerDnd(e: PointerEvent, options: ArmPointerDndOptions): void {
  const pointerType = normalizePointerType(e.pointerType);
  const secondaryOk = options.acceptSecondaryButton === true && e.button === 2;
  if (!secondaryOk && !isPrimaryPointer(pointerType, e.button)) return;

  // Cancel any stale drag (e.g. a previous gesture that never released).
  if (activeDrag) teardown({ dropped: false, cancelled: true });

  const initialPointer = toPointerSnapshot(e);

  activeDrag = {
    ...options,
    pointerId: e.pointerId,
    pointerType,
    // Capture on a STABLE element (the document root), not the pressed element.
    // Drag sources like the folder tree / file list re-render during a drag
    // (navigation, copy results), which removes the pressed row from the DOM. If
    // we'd captured on that row, its removal could swallow the terminal
    // pointerup/pointercancel — leaving the drag (and its ghost) stuck. The
    // document element is never removed, so capture (and thus teardown) survives.
    captureEl:
      typeof document !== 'undefined'
        ? document.documentElement
        : ((e.currentTarget as Element | null) ?? null),
    startX: e.clientX,
    startY: e.clientY,
    committed: false,
    longPressTimer: null,
    currentZoneId: null,
    lastPointer: initialPointer,
    rafId: 0,
  };

  window.addEventListener('pointermove', onWindowPointerMove, true);
  window.addEventListener('pointerup', onWindowPointerUp, true);
  window.addEventListener('pointercancel', onWindowPointerCancel, true);
  window.addEventListener('keydown', onWindowKeyDown, true);
  window.addEventListener('blur', onWindowBlur, true);

  // Touch: promote a stationary press to a drag after the long-press delay.
  if (pointerType === 'touch') {
    activeDrag.longPressTimer = window.setTimeout(() => {
      if (activeDrag && !activeDrag.committed) commitDrag();
    }, TOUCH_LONG_PRESS_MS);
  }
}

/** Imperatively cancel the active drag (e.g. from an external command). */
export function cancelPointerDnd(): void {
  abort();
}

/** Test-only reset. */
export function resetPointerDndForTest(): void {
  if (activeDrag) teardown({ dropped: false, cancelled: true });
}
