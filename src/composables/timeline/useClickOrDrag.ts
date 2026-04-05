import { onScopeDispose, ref } from 'vue';

export interface UseClickOrDragOptions {
  onDragStart: (e: PointerEvent) => boolean | void;
  onShortRightClick?: (e: PointerEvent) => void;
  onLongPress?: (e: PointerEvent) => void;
}

export function useClickOrDrag(options: UseClickOrDragOptions) {
  const didStartDrag = ref(false);
  const rightClickDragTriggered = ref(false);
  const rightClickPointerActive = ref(false);
  const longPressTriggered = ref(false);
  let rightClickDragTimer: number | null = null;
  const RIGHT_CLICK_DRAG_DELAY_MS = 300;
  // Separate thresholds: drag needs less movement, long press allows more jitter
  const DRAG_MOVE_THRESHOLD_PX = 5;
  const LONG_PRESS_CANCEL_THRESHOLD_PX = 10;

  let longPressTimer: number | null = null;
  const LONG_PRESS_DELAY_MS = 500;

  let activeCleanup: (() => void) | null = null;

  function onPointerDown(e: PointerEvent) {
    if (activeCleanup) activeCleanup();

    if (e.button !== 0 && e.button !== 2) return;

    didStartDrag.value = false;
    rightClickDragTriggered.value = false;
    longPressTriggered.value = false;

    if (e.button === 2) {
      rightClickPointerActive.value = true;
    }

    const startX = e.clientX;
    const startY = e.clientY;

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      if (rightClickDragTimer !== null) {
        window.clearTimeout(rightClickDragTimer);
        rightClickDragTimer = null;
      }
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      activeCleanup = null;
    };
    activeCleanup = cleanup;

    const startDrag = () => {
      if (didStartDrag.value) return;
      // If long press already triggered, don't start drag — long press takes priority
      if (longPressTriggered.value) return;
      const dragStarted = options.onDragStart(e);
      if (dragStarted === false) {
        return;
      }
      e.preventDefault();
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      didStartDrag.value = true;
      if (e.button === 2) {
        rightClickDragTriggered.value = true;
        rightClickPointerActive.value = false;
      }
      cleanup();
    };

    const onMove = (ev: PointerEvent) => {
      const dx = Math.abs(ev.clientX - startX);
      const dy = Math.abs(ev.clientY - startY);

      const jitterThreshold = e.pointerType === 'touch' ? 20 : LONG_PRESS_CANCEL_THRESHOLD_PX;
      const dragThreshold =
        e.pointerType === 'touch' && options.onLongPress ? jitterThreshold : DRAG_MOVE_THRESHOLD_PX;

      if ((dx > jitterThreshold || dy > jitterThreshold) && longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      if (dx > dragThreshold || dy > dragThreshold) {
        startDrag();
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      const wasShortRightClick = e.button === 2 && !didStartDrag.value;
      rightClickPointerActive.value = false;
      cleanup();
      if (wasShortRightClick) {
        options.onShortRightClick?.(ev);
      }
    };

    const onPointerCancel = () => {
      rightClickPointerActive.value = false;
      rightClickDragTriggered.value = false;
      // On touch devices the browser may fire pointercancel during a long
      // press (e.g. before showing the native context menu).  Keep the long
      // press timer alive so the gesture still registers.
      if (e.pointerType === 'touch' && longPressTimer !== null) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        activeCleanup = () => {
          if (longPressTimer !== null) {
            window.clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        };
        return;
      }
      cleanup();
    };

    if (e.button !== 2) {
      // Don't preventDefault for touch to allow scrolling if needed, but we handle it in timeline
      if (e.pointerType !== 'touch') {
        e.preventDefault();
      }

      // Start long press timer
      if (options.onLongPress) {
        longPressTimer = window.setTimeout(() => {
          longPressTimer = null;
          if (!didStartDrag.value) {
            longPressTriggered.value = true;
            options.onLongPress?.(e);
          }
        }, LONG_PRESS_DELAY_MS);
      }
    } else {
      rightClickDragTimer = window.setTimeout(() => {
        rightClickDragTimer = null;
        startDrag();
      }, RIGHT_CLICK_DRAG_DELAY_MS);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    window.addEventListener('pointercancel', onPointerCancel, { once: true });
  }

  onScopeDispose(() => {
    if (activeCleanup) activeCleanup();
  });

  return {
    didStartDrag,
    rightClickDragTriggered,
    rightClickPointerActive,
    longPressTriggered,
    onPointerDown,
  };
}
