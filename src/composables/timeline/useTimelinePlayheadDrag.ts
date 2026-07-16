import type { Ref } from 'vue';
import { ref, onBeforeUnmount } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { pxToTimeTicks } from '~/utils/timeline/geometry';
import { useEffectiveHotkeys } from '~/composables/editor/hotkeys/useEffectiveHotkeys';
import { isCommandMatched } from '~/utils/hotkeys/runtime';
import { DRAG_DEADZONE_PX } from '~/utils/mouse';

export function useTimelinePlayheadDrag(scrollEl: Ref<HTMLElement | null>) {
  const timelineStore = useTimelineStore();
  const isDraggingPlayhead = ref(false);
  const startDragTimeTicks = ref<number | null>(null);
  const startDragPos = ref({ x: 0, y: 0 });
  const dragOriginRect = ref<DOMRect | null>(null);
  const hasPlayheadMoved = ref(false);
  const workspaceStore = useWorkspaceStore();

  // The element that actually holds the pointer capture (the time ruler that was
  // pressed). Kept explicitly because the terminal pointerup/move may be
  // delivered with `currentTarget` set to a different element (the window or the
  // scroll container), so releasing capture off `e.currentTarget` would be a
  // silent no-op and leave the capture dangling.
  let captureEl: HTMLElement | null = null;
  let capturePointerId: number | null = null;

  function releaseCapture() {
    if (captureEl !== null && capturePointerId !== null) {
      try {
        captureEl.releasePointerCapture(capturePointerId);
      } catch {
        // Element may be gone or capture already released — harmless.
      }
    }
    captureEl = null;
    capturePointerId = null;
  }

  const { hotkeyLookup, defaultHotkeyLookup } = useEffectiveHotkeys();

  function getLocalX(e: MouseEvent): number {
    const target = e.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const scrollX = scrollEl.value?.scrollLeft ?? 0;
    if (!rect) return 0;
    return e.clientX - rect.left + scrollX;
  }

  function seekByMouseEvent(e: MouseEvent) {
    const x = getLocalX(e);
    timelineStore.setCurrentTimeTicks(pxToTimeTicks(x, timelineStore.timelineZoom));
  }

  function onGlobalKeyDown(e: KeyboardEvent) {
    const isCancel = isCommandMatched({
      event: e,
      cmdId: 'general.deselect',
      userSettings: workspaceStore.userSettings,
      hotkeyLookup: hotkeyLookup.value,
      defaultHotkeyLookup: defaultHotkeyLookup.value,
    });

    if (isCancel && isDraggingPlayhead.value) {
      isDraggingPlayhead.value = false;
      if (startDragTimeTicks.value !== null) {
        timelineStore.setCurrentTimeTicks(startDragTimeTicks.value);
        startDragTimeTicks.value = null;
      }
      e.preventDefault();
      releaseCapture();
      window.removeEventListener('keydown', onGlobalKeyDown);
    }
  }

  function startPlayheadDrag(e: PointerEvent) {
    isDraggingPlayhead.value = true;
    hasPlayheadMoved.value = false;
    startDragPos.value = { x: e.clientX, y: e.clientY };
    const target = e.currentTarget as HTMLElement | null;
    dragOriginRect.value = target?.getBoundingClientRect() ?? null;
    if (target) {
      try {
        target.setPointerCapture(e.pointerId);
        captureEl = target;
        capturePointerId = e.pointerId;
      } catch {
        // Capture can fail if the pointer was already released; harmless.
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown);
  }

  function onTimeRulerPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    startDragTimeTicks.value = timelineStore.currentTime;
    seekByMouseEvent(e);
    startPlayheadDrag(e);
  }

  function onGlobalPointerMove(e: PointerEvent): boolean {
    if (!isDraggingPlayhead.value) return false;
    e.preventDefault();

    if (e.buttons === 0) {
      onGlobalPointerUp(e);
      return true;
    }

    if (
      !hasPlayheadMoved.value &&
      (Math.abs(e.clientX - startDragPos.value.x) > DRAG_DEADZONE_PX ||
        Math.abs(e.clientY - startDragPos.value.y) > DRAG_DEADZONE_PX)
    ) {
      hasPlayheadMoved.value = true;
    }

    const scrollerRect = dragOriginRect.value;
    if (!scrollerRect) return true;
    const scrollX = scrollEl.value?.scrollLeft ?? 0;
    const x = e.clientX - scrollerRect.left + scrollX;
    timelineStore.setCurrentTimeTicks(pxToTimeTicks(x, timelineStore.timelineZoom));
    return true;
  }

  function onGlobalPointerUp(_e?: PointerEvent) {
    if (!isDraggingPlayhead.value) return;

    releaseCapture();
    isDraggingPlayhead.value = false;
    startDragTimeTicks.value = null;
    dragOriginRect.value = null;
    window.removeEventListener('keydown', onGlobalKeyDown);
  }

  onBeforeUnmount(() => {
    releaseCapture();
    window.removeEventListener('keydown', onGlobalKeyDown);
  });

  return {
    isDraggingPlayhead,
    hasPlayheadMoved,
    onTimeRulerPointerDown,
    startPlayheadDrag,
    onGlobalPointerMove,
    onGlobalPointerUp,
  };
}
