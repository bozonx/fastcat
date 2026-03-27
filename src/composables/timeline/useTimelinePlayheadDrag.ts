import type { Ref } from 'vue';
import { ref, onBeforeUnmount } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { pxToTimeUs } from '~/utils/timeline/geometry';
import { computed } from 'vue';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  createDefaultHotkeyLookup,
  createHotkeyLookup,
  isCommandMatched,
} from '~/utils/hotkeys/runtime';

export function useTimelinePlayheadDrag(scrollEl: Ref<HTMLElement | null>) {
  const timelineStore = useTimelineStore();
  const isDraggingPlayhead = ref(false);
  const startDragTimeUs = ref<number | null>(null);
  const hasMoved = ref(false);
  const workspaceStore = useWorkspaceStore();

  const commandOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
  const effectiveHotkeys = computed(() =>
    getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys),
  );
  const hotkeyLookup = computed(() => createHotkeyLookup(effectiveHotkeys.value, commandOrder));
  const defaultHotkeyLookup = computed(() => createDefaultHotkeyLookup(commandOrder));

  function getLocalX(e: MouseEvent): number {
    const target = e.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const scrollX = scrollEl.value?.scrollLeft ?? 0;
    if (!rect) return 0;
    return e.clientX - rect.left + scrollX;
  }

  function seekByMouseEvent(e: MouseEvent) {
    const x = getLocalX(e);
    timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
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
      if (startDragTimeUs.value !== null) {
        timelineStore.setCurrentTimeUs(startDragTimeUs.value);
        startDragTimeUs.value = null;
      }
      e.preventDefault();
      window.removeEventListener('keydown', onGlobalKeyDown);
    }
  }

  function startPlayheadDrag(e: PointerEvent) {
    isDraggingPlayhead.value = true;
    hasMoved.value = false;
    (e.currentTarget as HTMLElement | null)?.setPointerCapture(e.pointerId);
    window.addEventListener('keydown', onGlobalKeyDown);
  }

  function onTimeRulerPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    startDragTimeUs.value = timelineStore.currentTime;
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

    hasMoved.value = true;
    const scrollerRect = scrollEl.value?.getBoundingClientRect();
    if (!scrollerRect) return true;
    const scrollX = scrollEl.value?.scrollLeft ?? 0;
    const x = e.clientX - scrollerRect.left + scrollX;
    timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
    return true;
  }

  function onGlobalPointerUp(e?: PointerEvent) {
    if (!isDraggingPlayhead.value) return;
    if (e) {
      (e.currentTarget as HTMLElement | null)?.releasePointerCapture(e.pointerId);
    }

    if (hasMoved.value && startDragTimeUs.value !== null) {
      timelineStore.setCurrentTimeUs(startDragTimeUs.value);
    }

    isDraggingPlayhead.value = false;
    startDragTimeUs.value = null;
    hasMoved.value = false;
    window.removeEventListener('keydown', onGlobalKeyDown);
  }

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onGlobalKeyDown);
  });

  return {
    isDraggingPlayhead,
    onTimeRulerPointerDown,
    startPlayheadDrag,
    onGlobalPointerMove,
    onGlobalPointerUp,
  };
}
