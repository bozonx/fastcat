import type { ComputedRef, Ref } from 'vue';
import { computed, onMounted, onBeforeUnmount } from 'vue';

import type { TimelineTrack, TimelineMoveItemPayload } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import {
  BASE_PX_PER_SECOND,
  timeUsToPx,
  pxToTimeUs,
  pxToDeltaUs,
  computeAnchoredScrollLeft,
} from '~/utils/timeline/geometry';
import { useTimelinePlayheadDrag } from '~/composables/timeline/useTimelinePlayheadDrag';
import { useTimelineItemSelection } from '~/composables/timeline/useTimelineItemSelection';
import { useTimelineItemDrag } from '~/composables/timeline/useTimelineItemDrag';

export { BASE_PX_PER_SECOND, timeUsToPx, pxToTimeUs, pxToDeltaUs, computeAnchoredScrollLeft };

export function useTimelineInteraction(
  scrollEl: Ref<HTMLElement | null>,
  tracks: ComputedRef<TimelineTrack[]>,
) {
  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();

  const {
    isDraggingPlayhead,
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
    startMoveItem: onDragStartMoveItem,
    startTrimItem: onDragStartTrimItem,
    onGlobalPointerMove: onItemDragGlobalPointerMove,
    onGlobalPointerUp: onItemDragGlobalPointerUp,
  } = useTimelineItemDrag(scrollEl, tracks);

  const canEditClipContent = computed(
    () =>
      projectStore.currentView === 'cut' ||
      projectStore.currentView === 'files' ||
      projectStore.currentView === 'sound',
  );

  function onGlobalPointerMove(e: PointerEvent) {
    if (timelineStore.isTrimModeActive && !isDraggingPlayhead.value && !draggingMode.value) {
      const scrollerRect = scrollEl.value?.getBoundingClientRect();
      if (scrollerRect) {
        const scrollX = scrollEl.value?.scrollLeft ?? 0;
        const x = e.clientX - scrollerRect.left + scrollX;
        timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
      }
      return;
    }

    if (onPlayheadGlobalPointerMove(e)) return;
    onItemDragGlobalPointerMove(e);
  }

  function onGlobalPointerUp(e?: PointerEvent) {
    onPlayheadGlobalPointerUp(e);
    onItemDragGlobalPointerUp(e);
  }

  function startMoveItem(e: PointerEvent, payload: TimelineMoveItemPayload) {
    if (!canEditClipContent.value) return;
    onDragStartMoveItem(e, payload);
  }

  function startTrimItem(
    e: PointerEvent,
    input: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number },
  ) {
    if (!canEditClipContent.value) return;
    onDragStartTrimItem(e, input);
  }

  function onGlobalKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && timelineStore.isTrimModeActive) {
      timelineStore.isTrimModeActive = false;
      e.preventDefault();
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onGlobalKeyDown);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onGlobalKeyDown);
  });

  return {
    isDraggingPlayhead,
    draggingMode,
    draggingItemId,
    movePreview,
    slipPreview,
    onTimeRulerPointerDown,
    onGlobalPointerMove,
    onGlobalPointerUp,
    startPlayheadDrag,
    selectItem,
    startMoveItem,
    startTrimItem,
  };
}
