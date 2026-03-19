import { onBeforeUnmount } from 'vue';

interface TimelinePointerSessionHandlers {
  onPointerMove?: ((event: PointerEvent) => void) | null;
  onPointerUp?: ((event?: PointerEvent) => void) | null;
  onKeyDown?: ((event: KeyboardEvent) => void) | null;
}

export function useTimelinePointerSession() {
  let activePointerMove: ((event: PointerEvent) => void) | null = null;
  let activePointerUp: ((event?: PointerEvent) => void) | null = null;
  let activeKeyDown: ((event: KeyboardEvent) => void) | null = null;
  let scheduledFrameId = 0;
  let scheduledUpdate: (() => void) | null = null;

  function flushScheduledUpdate() {
    scheduledFrameId = 0;
    const update = scheduledUpdate;
    scheduledUpdate = null;
    update?.();
  }

  function scheduleUpdate(update: () => void) {
    scheduledUpdate = update;
    if (scheduledFrameId !== 0) return;
    scheduledFrameId = requestAnimationFrame(flushScheduledUpdate);
  }

  function clearSession() {
    if (activePointerMove) {
      window.removeEventListener('pointermove', activePointerMove);
      activePointerMove = null;
    }

    if (activePointerUp) {
      window.removeEventListener('pointerup', activePointerUp);
      activePointerUp = null;
    }

    if (activeKeyDown) {
      window.removeEventListener('keydown', activeKeyDown);
      activeKeyDown = null;
    }

    if (scheduledFrameId !== 0) {
      cancelAnimationFrame(scheduledFrameId);
      scheduledFrameId = 0;
    }

    scheduledUpdate = null;
  }

  function bindSession(handlers: TimelinePointerSessionHandlers) {
    clearSession();

    activePointerMove = handlers.onPointerMove ?? null;
    activePointerUp = handlers.onPointerUp ?? null;
    activeKeyDown = handlers.onKeyDown ?? null;

    if (activePointerMove) {
      window.addEventListener('pointermove', activePointerMove);
    }

    if (activePointerUp) {
      window.addEventListener('pointerup', activePointerUp);
    }

    if (activeKeyDown) {
      window.addEventListener('keydown', activeKeyDown);
    }
  }

  onBeforeUnmount(() => {
    clearSession();
  });

  return {
    bindSession,
    clearSession,
    scheduleUpdate,
  };
}
