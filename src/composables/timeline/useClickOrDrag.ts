import { onScopeDispose, ref } from 'vue';

export interface UseClickOrDragOptions {
  onDragStart: (e: PointerEvent) => void;
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
      e.preventDefault();
      options.onDragStart(e);
    };

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 5 || Math.abs(ev.clientY - startY) > 5) {
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
