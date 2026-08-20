import { ref, type ComputedRef, type Ref } from 'vue';
import {
  MOBILE_CLICK_MOVE_THRESHOLD_PX,
  MOBILE_LONG_PRESS_RESET_DELAY_MS,
} from '~/utils/mobile/timeline';
import { resolvePlayheadClickTimeTicks } from '~/composables/timeline/timeline-drag-domain';
import { pxToTimeTicks } from '~/utils/timeline/geometry';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { closeAllContextMenus } from '~/composables/ui/useExclusiveContextMenu';
import type {
  TimelineClipActionPayload,
  TimelineMoveItemPayload,
  TimelineTrimItemPayload,
} from '~/timeline/types';

export interface UseMobileTimelineGesturesOptions {
  scrollEl: Ref<HTMLElement | null>;
  isLongPress: Ref<boolean>;
  isToolbarTrimActive: Ref<boolean>;
  isMultiSelectionMode: Ref<boolean>;
  trackHeights: ComputedRef<Record<string, number>>;
  suppressDrawerSelectionClearTemporarily: (callback?: () => void) => Promise<void>;
  toggleMobileClipSelection: (itemId: string) => void;
  enterMobileMultiSelection: (itemId: string) => void;
  selectItem: (ev: MouseEvent, id: string) => void;
  startMoveItem: (event: PointerEvent, payload: TimelineMoveItemPayload) => void;
  startTrimItem: (event: PointerEvent, payload: TimelineTrimItemPayload) => void;
  onGlobalPointerMove: (e: PointerEvent) => void;
  onGlobalPointerUp: (e?: PointerEvent) => void;
  updateEdgeScroll: (e: PointerEvent) => void;
  stopEdgeScroll: () => void;
  clearScrollRectCache: () => void;
  getCachedScrollRect: (el: HTMLElement) => DOMRect;
  draggingMode: Ref<string | null | false | undefined>;
  applyClipAction: (payload: TimelineClipActionPayload) => Promise<void>;
}

export function useMobileTimelineGestures(options: UseMobileTimelineGesturesOptions) {
  const {
    scrollEl,
    isLongPress,
    isToolbarTrimActive,
    isMultiSelectionMode,
    trackHeights,
    draggingMode,
    suppressDrawerSelectionClearTemporarily,
    toggleMobileClipSelection,
    enterMobileMultiSelection,
    selectItem,
    startMoveItem,
    startTrimItem,
    onGlobalPointerMove,
    onGlobalPointerUp,
    updateEdgeScroll,
    stopEdgeScroll,
    clearScrollRectCache,
    getCachedScrollRect,
    applyClipAction,
  } = options;

  const timelineStore = useTimelineStore();
  const workspaceStore = useWorkspaceStore();
  const timelineSettingsStore = useTimelineSettingsStore();
  const selectionStore = useSelectionStore();
  const clipboardStore = useAppClipboard();
  const { t } = useI18n();
  const toast = useToast();

  const lastPointerType = ref('');
  const clickStartX = ref(0);
  const clickStartY = ref(0);

  function handleMobileTimelineItemSelect(ev: PointerEvent, id: string) {
    if (clipboardStore.hasTimelinePayload) {
      return;
    }
    const pointerType = ev.pointerType || lastPointerType.value;
    if (pointerType === 'touch') {
      const wasLongPress = isLongPress.value;
      isLongPress.value = false;

      if (wasLongPress) {
        return;
      }

      const entity = selectionStore.selectedEntity;
      const isGapSelected =
        entity?.source === 'timeline' && entity.kind === 'gap' && entity.itemId === id;
      const isTrackSelected = entity?.source === 'timeline' && entity.kind === 'track';

      if (isMultiSelectionMode.value && !isGapSelected && !isTrackSelected) {
        suppressDrawerSelectionClearTemporarily(() => {
          toggleMobileClipSelection(id);
        });
        return;
      }

      selectItem(ev, id);
      return;
    }

    selectItem(ev, id);
  }

  function handleMobileTimelineItemLongPress(id: string) {
    suppressDrawerSelectionClearTemporarily(() => {
      isLongPress.value = true;
      enterMobileMultiSelection(id);
    });
  }

  function onMobilePointerMove(e: PointerEvent) {
    if (isToolbarTrimActive.value) return;
    onGlobalPointerMove(e);
    updateEdgeScroll(e);
  }

  function resetLongPressAfterPointer() {
    setTimeout(() => {
      isLongPress.value = false;
    }, MOBILE_LONG_PRESS_RESET_DELAY_MS);
  }

  function onMobilePointerUp(e: PointerEvent) {
    clearScrollRectCache();
    stopEdgeScroll();
    onGlobalPointerUp(e);
    resetLongPressAfterPointer();
  }

  function onMobilePointerCancel(e: PointerEvent) {
    clearScrollRectCache();
    stopEdgeScroll();

    // A long-press gesture on touch frequently ends with `pointercancel` (the
    // webview takes the gesture over) rather than `pointerup`. Reset the flag
    // here too — otherwise it stays stuck `true` and the next tap is swallowed
    // by the long-press guards, so additional clips can never be selected.
    resetLongPressAfterPointer();

    if (draggingMode.value) return;
    onGlobalPointerUp(e);
  }

  function onStartMoveItem(event: PointerEvent, payload: TimelineMoveItemPayload) {
    startMoveItem(event, {
      trackId: payload.trackId,
      itemId: payload.itemId,
      startTicks: payload.startTicks,
    });
  }

  function onStartTrimItem(event: PointerEvent, payload: TimelineTrimItemPayload) {
    startTrimItem(event, payload);
  }

  function onTimelinePointerDownCapture(e: PointerEvent) {
    // Dismiss any open context/dropdown menu (ruler menu, monitor menu, …). This
    // runs in the capture phase so it fires even though descendant pointerdown
    // handlers below stopPropagation — which otherwise swallows the taps those
    // menus' own outside-dismiss layers listen for on `document`.
    closeAllContextMenus();
    if (e.button === 0) {
      clickStartX.value = e.clientX;
      clickStartY.value = e.clientY;
      isLongPress.value = false;
      lastPointerType.value = e.pointerType;
    }
  }

  function onTimelineClick(e: MouseEvent) {
    if (e.button !== 0) return;
    const dx = Math.abs(e.clientX - clickStartX.value);
    const dy = Math.abs(e.clientY - clickStartY.value);
    if (
      dx > MOBILE_CLICK_MOVE_THRESHOLD_PX ||
      dy > MOBILE_CLICK_MOVE_THRESHOLD_PX ||
      isLongPress.value
    ) {
      isLongPress.value = false;
      return;
    }

    const target = e.target as HTMLElement | null;
    if (target?.closest('button')) return;
    if (target?.closest('.cursor-ew-resize')) return;
    if (target?.closest('.cursor-ns-resize')) return;
    if (clipboardStore.hasTimelinePayload) {
      const trackEl = target?.closest('[data-track-id]');
      const trackId = trackEl?.getAttribute('data-track-id');
      if (trackId) {
        timelineStore.selectTrack(trackId);
      }

      const el = scrollEl.value;
      if (el) {
        const scrollerRectY = getCachedScrollRect(el);
        const scrollX = el.scrollLeft;
        const x = e.clientX - scrollerRectY.left + scrollX;
        const rawTimeTicks = pxToTimeTicks(x, timelineStore.timelineZoom);
        const timelineEndTicks = Number.isFinite(timelineStore.duration)
          ? Math.max(0, Math.round(timelineStore.duration))
          : null;
        const timeTicks = resolvePlayheadClickTimeTicks({
          rawTimeTicks,
          zoom: timelineStore.timelineZoom,
          snapThresholdPx: workspaceStore.userSettings.timeline.snapThresholdPx,
          toolbarSnapMode: timelineSettingsStore.toolbarSnapMode,
          snapping: workspaceStore.userSettings.timeline.snapping,
          tracks: timelineStore.timelineDoc?.tracks ?? [],
          markers: timelineStore.markers,
          durationTicks: timelineEndTicks,
          selectionRangeTicks: timelineStore.selectionRange,
        });

        timelineStore.setCurrentTimeTicks(timeTicks);
      }
      return;
    }

    if (target?.closest('[data-clip-id]')) return;
    if (target?.closest('[data-gap-id]')) return;
    if (target?.closest('[data-track-id]')) return;

    const el = scrollEl.value;
    if (!el) return;

    const tracksHeight = Object.values(trackHeights.value).reduce((a, b) => a + b, 0);
    const scrollerRectY = getCachedScrollRect(el);
    // `y` is measured inside scrollEl, which already starts below the ruler, so it is
    // a pure track-content offset — compare directly against the stacked track height.
    const y = e.clientY - scrollerRectY.top + el.scrollTop;
    if (y > tracksHeight) {
      timelineStore.selectTimelineProperties();
      return;
    }

    const scrollX = el.scrollLeft;
    const x = e.clientX - scrollerRectY.left + scrollX;
    const rawTimeTicks = pxToTimeTicks(x, timelineStore.timelineZoom);
    const timelineEndTicks = Number.isFinite(timelineStore.duration)
      ? Math.max(0, Math.round(timelineStore.duration))
      : null;
    const timeTicks = resolvePlayheadClickTimeTicks({
      rawTimeTicks,
      zoom: timelineStore.timelineZoom,
      snapThresholdPx: workspaceStore.userSettings.timeline.snapThresholdPx,
      toolbarSnapMode: timelineSettingsStore.toolbarSnapMode,
      snapping: workspaceStore.userSettings.timeline.snapping,
      tracks: timelineStore.timelineDoc?.tracks ?? [],
      markers: timelineStore.markers,
      durationTicks: timelineEndTicks,
      selectionRangeTicks: timelineStore.selectionRange,
    });

    timelineStore.setCurrentTimeTicks(timeTicks);
  }

  async function onClipAction(payload: TimelineClipActionPayload) {
    try {
      await applyClipAction(payload);
    } catch (err: unknown) {
      toast.add({
        title: t('common.error'),
        description: err instanceof Error ? err.message : String(err ?? ''),
        icon: 'i-heroicons-exclamation-triangle',
        color: 'error',
      });
    }
  }

  return {
    lastPointerType,
    clickStartX,
    clickStartY,
    handleMobileTimelineItemSelect,
    handleMobileTimelineItemLongPress,
    onMobilePointerMove,
    onMobilePointerUp,
    onMobilePointerCancel,
    onStartMoveItem,
    onStartTrimItem,
    onTimelinePointerDownCapture,
    onTimelineClick,
    onClipAction,
  };
}
