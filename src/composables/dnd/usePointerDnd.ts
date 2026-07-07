/**
 * Pointer-DnD engine (source side).
 *
 * A drag *source* calls {@link armPointerDnd} from its `pointerdown` handler.
 * The engine then:
 *   1. Arms a gesture watcher that distinguishes a click/tap/scroll from a drag
 *      (movement threshold for mouse/pen, long-press for touch). Mouse/pen
 *      sources suppress the browser's native drag/focus handling immediately;
 *      touch keeps its default behavior until the long-press commits so normal
 *      scrolling keeps working.
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
import { isOpenableProjectFileName, getMediaTypeFromFilename } from '~/utils/media-types';
import { useProjectStore } from '~/stores/project.store';
import type { FsEntry } from '~/types/fs';
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
import { createDevLogger } from '~/utils/dev-logger';
import { isTauriRuntime } from '~/utils/runtime';

const log = createDevLogger('pointerDnd');
type PanelDropPosition = 'left' | 'right' | 'top' | 'bottom';

const PANEL_DROP_EDGE_CLASS_BY_POSITION: Record<PanelDropPosition, string> = {
  left: 'fastcat-panel-drop-edge-left',
  right: 'fastcat-panel-drop-edge-right',
  top: 'fastcat-panel-drop-edge-top',
  bottom: 'fastcat-panel-drop-edge-bottom',
};
const PANEL_DROP_EDGE_CLASSES = Object.values(PANEL_DROP_EDGE_CLASS_BY_POSITION);

let highlightedPanelDropEl: HTMLElement | null = null;

// Opt-in tracing for hard-to-reproduce drag glitches. Enable in the console with
// `localStorage.fastcatDndDebug = '1'` (and reload), then reproduce the gesture;
// the log shows arm/commit, every zone change, and any frame where no drop zone
// resolved while dragging — the usual culprit for "no highlight / no mode".
function dndDebugEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('fastcatDndDebug') === '1';
  } catch {
    return false;
  }
}
function dndDebug(...args: unknown[]): void {
  // Use `warn` (not `debug`) so the trace is visible in production Tauri builds
  // too — it's already opt-in behind the localStorage flag, so it stays quiet
  // unless explicitly enabled.
  if (dndDebugEnabled()) log.warn(...args);
}

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

function getOpenableFileManagerItems(payload: DndPayload): FsEntry[] {
  if (payload.source !== 'file-manager') return [];

  const data = payload.data as { items?: FsEntry[]; primaryEntry?: FsEntry };
  const items = data.items ?? (data.primaryEntry ? [data.primaryEntry] : []);

  return items.filter(
    (item) => item.kind === 'file' && item.name && isOpenableProjectFileName(item.name),
  );
}

function getPanelDropPosition(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): PanelDropPosition | null {
  const distLeft = clientX - rect.left;
  const distRight = rect.right - clientX;
  const distTop = clientY - rect.top;
  const distBottom = rect.bottom - clientY;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  const threshold = Math.min(rect.width * 0.15, rect.height * 0.15, 60);

  if (minDist > threshold) return null;
  if (minDist === distLeft) return 'left';
  if (minDist === distRight) return 'right';
  if (minDist === distTop) return 'top';
  return 'bottom';
}

function resolveOpenPanelDropTarget(
  targetEl: Element | null,
  clientX: number,
  clientY: number,
): { panelEl: HTMLElement; panelId: string; position: PanelDropPosition } | null {
  const panelEl = targetEl?.closest?.('[data-panel-id]') as HTMLElement | null;
  const panelId = panelEl?.getAttribute('data-panel-id') ?? '';
  if (!panelEl || !panelId) return null;

  const position = getPanelDropPosition(panelEl.getBoundingClientRect(), clientX, clientY);
  if (!position) return null;

  return { panelEl, panelId, position };
}

function clearPanelDropHighlight(): void {
  if (!highlightedPanelDropEl) return;
  highlightedPanelDropEl.classList.remove(...PANEL_DROP_EDGE_CLASSES);
  highlightedPanelDropEl = null;
}

function setPanelDropHighlight(
  target: { panelEl: HTMLElement; position: PanelDropPosition } | null,
): void {
  if (!target) {
    clearPanelDropHighlight();
    return;
  }

  if (highlightedPanelDropEl && highlightedPanelDropEl !== target.panelEl) {
    clearPanelDropHighlight();
  }

  highlightedPanelDropEl = target.panelEl;
  target.panelEl.classList.remove(...PANEL_DROP_EDGE_CLASSES);
  target.panelEl.classList.add(PANEL_DROP_EDGE_CLASS_BY_POSITION[target.position]);
}

function updateFileManagerPanelOperation(
  payload: DndPayload,
  targetEl: Element | null,
  clientX: number,
  clientY: number,
): void {
  if (payload.source !== 'file-manager') return;

  const hasOpenableFile = getOpenableFileManagerItems(payload).length > 0;
  const target = hasOpenableFile ? resolveOpenPanelDropTarget(targetEl, clientX, clientY) : null;
  setPanelDropHighlight(target);
  setDndOperation(target ? 'open-panel' : 'cancel');
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
    dndDebug('zone change', {
      from: drag.currentZoneId,
      to: nextZoneId,
      target: (targetEl as HTMLElement | null)?.tagName,
      source: drag.payload.source,
    });
    if (drag.currentZoneId) {
      getDndZone(drag.currentZoneId)?.onLeave?.(buildContext(drag.currentZoneId, targetEl));
    }
    drag.currentZoneId = nextZoneId;
    setDndActiveZoneId(nextZoneId);
    if (nextZoneId) {
      getDndZone(nextZoneId)?.onEnter?.(buildContext(nextZoneId, targetEl));
    } else {
      // No drop zone under the pointer while dragging — this is what "no
      // highlight / no copy-move mode" looks like. Trace what the hit-test saw.
      dndDebug('no zone under pointer', {
        target: (targetEl as HTMLElement | null)?.tagName,
        targetCls: (targetEl as HTMLElement | null)?.className,
        x: clientX,
        y: clientY,
      });
      if (drag.payload.source === 'file-manager') {
        updateFileManagerPanelOperation(drag.payload, targetEl, clientX, clientY);
      } else {
        clearPanelDropHighlight();
        setDndOperation('none');
      }
    }
  }

  if (nextZoneId) {
    clearPanelDropHighlight();
    getDndZone(nextZoneId)?.onOver?.(buildContext(nextZoneId, targetEl));
  } else if (drag.payload.source === 'file-manager') {
    updateFileManagerPanelOperation(drag.payload, targetEl, clientX, clientY);
  } else {
    clearPanelDropHighlight();
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
  dndDebug('commit', { source: drag.payload.source, pointerType: drag.pointerType });

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

function teardown(info: { dropped: boolean; cancelled: boolean; nativeTakeover?: boolean }) {
  const drag = activeDrag;
  if (!drag) return;
  activeDrag = null;

  if (drag.committed) {
    const blockClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      window.removeEventListener('click', blockClick, true);
    };
    window.addEventListener('click', blockClick, true);
    setTimeout(() => {
      window.removeEventListener('click', blockClick, true);
    }, 50);
  }

  dndDebug('teardown', { committed: drag.committed, ...info });

  clearLongPress(drag);
  if (drag.rafId !== 0) cancelAnimationFrame(drag.rafId);

  window.removeEventListener('pointermove', onWindowPointerMove, true);
  window.removeEventListener('pointerup', onWindowPointerUp, true);
  window.removeEventListener('pointercancel', onWindowPointerCancel, true);
  window.removeEventListener('keydown', onWindowKeyDown, true);
  window.removeEventListener('keyup', onWindowKeyUp, true);
  window.removeEventListener('blur', onWindowBlur, true);
  window.removeEventListener('dragstart', onWindowDragStart, true);

  try {
    drag.captureEl?.releasePointerCapture?.(drag.pointerId);
  } catch {
    // ignore — element may be gone or capture never taken.
  }

  // Reset visual/global state before notifying the source so the cursor never
  // lingers even if the source callback throws.
  clearPanelDropHighlight();
  endDndState();

  // Run the source's cleanup (which clears the eagerly-set drag state:
  // `isFileManagerDragging` / `draggedFile` / clipboard) for EVERY ended gesture
  // EXCEPT a Tauri WebKitGTK native-drag takeover.
  //
  // Sources set their drag state on `pointerdown` (they must — in the Tauri shell
  // WebKitGTK can hijack the press into a native OS drag before our movement
  // threshold, so `onStart` may never fire). When WebKitGTK takes over it fires
  // `pointercancel` (and/or window `blur`) — sometimes before we commit, sometimes
  // after. In BOTH cases the internal drag state must PERSIST so the native
  // `onDragDropEvent` recognises it as an internal drag and suppresses the OS drop
  // overlay; the source clears its own state when that native flow ends.
  //
  // Everywhere else the state must be cleared eagerly: a plain click (pointerup
  // that never became a drag), Escape, touch-scroll abandonment, and all web
  // gestures. Previously this ran only for `committed` drags, so a click on a
  // file row left `isFileManagerDragging` stuck `true` forever — which made the
  // global drag-over handler bail and the external-file drop overlay never appear
  // again (and, when a committed drag was promoted to native, wiped the state so
  // the overlay wrongly appeared over an internal drag).
  const isTauriNativeTakeover = Boolean(info.nativeTakeover) && isTauriRuntime();
  if (!isTauriNativeTakeover) {
    drag.onEnd?.({ dropped: info.dropped, cancelled: info.cancelled });
  }
}

function abort(nativeTakeover = false) {
  const drag = activeDrag;
  if (!drag) return;
  if (drag.committed && drag.currentZoneId) {
    getDndZone(drag.currentZoneId)?.onLeave?.(buildContext(drag.currentZoneId, null));
  }
  teardown({ dropped: false, cancelled: true, nativeTakeover });
}

function onWindowDragStart(e: DragEvent) {
  e.preventDefault();
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

function handleOpenFileAsPanelDrop(
  entry: FsEntry,
  target: { panelId: string; position: PanelDropPosition },
) {
  try {
    const projectStore = useProjectStore();
    const type = getMediaTypeFromFilename(entry.name);

    if (type === 'text') {
      projectStore.addTextPanel(entry.path || '', entry.name, target.panelId, target.position);
    } else if (type === 'video' || type === 'audio' || type === 'image') {
      projectStore.addMediaPanel(entry, type, entry.name, target.panelId, target.position);
    }
  } catch (err) {
    log.error('Failed to open file as panel on drop', err);
  }
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
  } else if (drag.payload.source === 'file-manager') {
    const target = resolveOpenPanelDropTarget(targetEl, e.clientX, e.clientY);

    if (target) {
      for (const item of getOpenableFileManagerItems(drag.payload)) {
        dropped = true;
        handleOpenFileAsPanelDrop(item, target);
      }
    }
  }

  teardown({ dropped, cancelled: false });
}

function onWindowPointerCancel(e: PointerEvent) {
  const drag = activeDrag;
  if (!drag || e.pointerId !== drag.pointerId) return;
  // A `pointercancel` mid-gesture is the WebKitGTK signal that it is promoting the
  // press into a native OS drag — keep the internal drag state so `onDragDropEvent`
  // recognises it (Tauri only; harmless flag on web, which never takes over).
  abort(true);
}

function onWindowKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    abort();
    return;
  }
  // Re-evaluate operation when a modifier changes mid-drag (copy vs move).
  updateModifiersFromKeyboardEvent(e);
}

function onWindowKeyUp(e: KeyboardEvent) {
  updateModifiersFromKeyboardEvent(e);
}

function updateModifiersFromKeyboardEvent(e: KeyboardEvent) {
  const drag = activeDrag;
  if (!drag || !drag.committed) return;
  drag.lastPointer = { ...drag.lastPointer, ...readModifiers(e) };
  updateDndPointer(drag.lastPointer);
  scheduleDispatchMove();
}

function onWindowBlur() {
  // Losing the window mid-drag (alt-tab, OS drag takeover) — abort cleanly so the
  // cursor never sticks. Treat it as a native takeover: in the Tauri shell blur is
  // exactly what fires when WebKitGTK grabs the drag, so the internal drag state
  // must persist for `onDragDropEvent`.
  abort(true);
}

/**
 * Arm a pointer-drag from a source's `pointerdown`. Safe to call on every
 * pointerdown; it self-cancels any prior pending drag first.
 */
export function armPointerDnd(e: PointerEvent, options: ArmPointerDndOptions): void {
  const pointerType = normalizePointerType(e.pointerType);
  const secondaryOk = options.acceptSecondaryButton === true && e.button === 2;
  if (!secondaryOk && !isPrimaryPointer(pointerType, e.button)) return;

  if (pointerType !== 'touch') {
    e.preventDefault();
  }

  // Cancel any stale drag (e.g. a previous gesture that never released).
  if (activeDrag) teardown({ dropped: false, cancelled: true });

  const initialPointer = toPointerSnapshot(e);

  activeDrag = {
    ...options,
    pointerId: e.pointerId,
    pointerType,
    // Capture on the pressed element (captured synchronously here — `currentTarget`
    // is nulled once the handler returns). Do NOT switch this to
    // `document.documentElement`: capturing the document root made drop-zone
    // highlighting flake intermittently in the Tauri shell. Row removal during a
    // drag does not lose the terminal event anyway — the window-level listeners
    // (added below) still receive pointerup/cancel regardless of the capture target.
    captureEl: (e.currentTarget as Element | null) ?? null,
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
  window.addEventListener('keyup', onWindowKeyUp, true);
  window.addEventListener('blur', onWindowBlur, true);
  window.addEventListener('dragstart', onWindowDragStart, true);

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
