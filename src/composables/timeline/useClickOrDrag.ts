import { ref } from 'vue';

export interface UseClickOrDragOptions {
  onDragStart: (e: PointerEvent) => void;
  onShortRightClick?: (e: PointerEvent) => void;
}

export function useClickOrDrag(options: UseClickOrDragOptions) {
  const didStartDrag = ref(false);
  const rightClickDragTriggered = ref(false);
  const rightClickPointerActive = ref(false);
  let rightClickDragTimer: number | null = null;
  const RIGHT_CLICK_DRAG_DELAY_MS = 300;

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 2) return;

    didStartDrag.value = false;
    rightClickDragTriggered.value = false;

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
    };

    const startDrag = () => {
      if (didStartDrag.value) return;
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
      if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) {
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
      e.preventDefault();
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

  return {
    didStartDrag,
    rightClickDragTriggered,
    rightClickPointerActive,
    onPointerDown,
  };
}
