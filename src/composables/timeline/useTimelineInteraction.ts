import type { ComputedRef, Ref } from 'vue';
import { computed, onMounted, onBeforeUnmount } from 'vue';

import type { TimelineTrack, TimelineMoveItemPayload } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  createDefaultHotkeyLookup,
  createHotkeyLookup,
  isCommandMatched,
} from '~/utils/hotkeys/runtime';
import { pxToTimeUs } from '~/utils/timeline/geometry';
import { useTimelinePlayheadDrag } from '~/composables/timeline/useTimelinePlayheadDrag';
import { useTimelineItemSelection } from '~/composables/timeline/useTimelineItemSelection';
import { useTimelineItemDrag } from '~/composables/timeline/useTimelineItemDrag';
import { useScrollRectCache } from '~/composables/timeline/useScrollRectCache';

export function useTimelineInteraction(
  scrollEl: Ref<HTMLElement | null>,
  tracks: ComputedRef<TimelineTrack[]>,
) {
  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();

  const commandOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
  const effectiveHotkeys = computed(() =>
    getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys),
  );
  const hotkeyLookup = computed(() => createHotkeyLookup(effectiveHotkeys.value, commandOrder));
  const defaultHotkeyLookup = computed(() => createDefaultHotkeyLookup(commandOrder));

  const {
    isDraggingPlayhead,
    hasPlayheadMoved,
    onTimeRulerPointerDown,
    startPlayheadDrag,
    onGlobalPointerMove: onPlayheadGlobalPointerMove,
    onGlobalPointerUp: onPlayheadGlobalPointerUp,
  } = useTimelinePlayheadDrag(scrollEl);

  const { selectItem } = useTimelineItemSelection(tracks);

  const {
    draggingMode,
    draggingItemId,
    movePreview,
    slipPreview,
    trimPreview,
    startMoveItem: onDragStartMoveItem,
    startTrimItem: onDragStartTrimItem,
    onGlobalPointerMove: onItemDragGlobalPointerMove,
    onGlobalPointerUp: onItemDragGlobalPointerUp,
    scheduleDragReapply,
  } = useTimelineItemDrag(scrollEl, tracks);

  const canEditClipContent = computed(
    () =>
      projectStore.currentView === 'cut' ||
      projectStore.currentView === 'files' ||
      projectStore.currentView === 'sound',
  );

  const { getCachedScrollRect, clearScrollRectCache } = useScrollRectCache();

  function onGlobalPointerMove(e: PointerEvent) {
    if (timelineStore.isTrimModeActive && !isDraggingPlayhead.value && !draggingMode.value) {
      const scroller = scrollEl.value;
      if (scroller) {
        const scrollerRect = getCachedScrollRect(scroller);
        const scrollX = scroller.scrollLeft;
        const x = e.clientX - scrollerRect.left + scrollX;
        timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
      }
      return;
    }

    if (onPlayheadGlobalPointerMove(e)) return;
    onItemDragGlobalPointerMove(e);
  }

  function onGlobalPointerUp(e?: PointerEvent) {
    clearScrollRectCache();
    onPlayheadGlobalPointerUp(e);
    onItemDragGlobalPointerUp(e);
  }

  const isReadOnly = computed(() => projectStore.isReadOnly || timelineStore.previewMode);

  function startMoveItem(e: PointerEvent, payload: TimelineMoveItemPayload) {
    if (!canEditClipContent.value) return;
    if (isReadOnly.value) return;
    onDragStartMoveItem(e, payload);
  }

  function startTrimItem(
    e: PointerEvent,
    input: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number },
  ) {
    if (!canEditClipContent.value) return;
    if (isReadOnly.value) return;
    onDragStartTrimItem(e, input);
  }

  function onGlobalKeyDown(e: KeyboardEvent) {
    const isCancel = isCommandMatched({
      event: e,
      cmdId: 'general.deselect',
      userSettings: workspaceStore.userSettings,
      hotkeyLookup: hotkeyLookup.value,
      defaultHotkeyLookup: defaultHotkeyLookup.value,
    });

    if (isCancel && timelineStore.isTrimModeActive) {
      timelineStore.isTrimModeActive = false;
      e.preventDefault();
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onGlobalKeyDown);
  });

  onBeforeUnmount(() => {
    clearScrollRectCache();
    window.removeEventListener('keydown', onGlobalKeyDown);
  });

  return {
    isDraggingPlayhead,
    hasPlayheadMoved,
    draggingMode,
    draggingItemId,
    movePreview,
    slipPreview,
    trimPreview,
    onTimeRulerPointerDown,
    onGlobalPointerMove,
    onGlobalPointerUp,
    startPlayheadDrag,
    selectItem,
    startMoveItem,
    startTrimItem,
    scheduleDragReapply,
  };
}
