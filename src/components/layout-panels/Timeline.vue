<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import { useDebounceFn, useEventListener, useLocalStorage, useResizeObserver } from '@vueuse/core';
import type { FastCatUserSettings } from '~/utils/settings/defaults';

import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useMediaStore } from '~/stores/media.store';
import { useFocusStore } from '~/stores/focus.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';

import type { TimelineClipActionPayload, TimelineTrack } from '~/timeline/types';
import { timeUsToPx, pxToTimeUs, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { getWheelDelta, isSecondaryWheel } from '~/utils/mouse';
import { formatZoomMultiplier, timelineZoomPositionToScale } from '~/utils/zoom';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';

import TimelineTrackLabels from '~/components/timeline/TimelineTrackLabels.vue';
import TimelineTracks from '~/components/timeline/TimelineTracks.vue';
import TimelineRuler from '~/components/timeline/TimelineRuler.vue';
import TimelineGrid from '~/components/timeline/TimelineGrid.vue';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';

import { useTimelineZoom } from '~/composables/timeline/useTimelineZoom';
import { useTimelineScrollSync } from '~/composables/timeline/useTimelineScrollSync';
import { useTimelineDropHandling } from '~/composables/timeline/useTimelineDropHandling';
import { useTimelineInteraction } from '~/composables/timeline/useTimelineInteraction';

const { t } = useI18n();
const toast = useToast();

const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const mediaStore = useMediaStore();
const focusStore = useFocusStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const timelineSettingsStore = useTimelineSettingsStore();
const projectStore = useProjectStore();
const fileManager = useFileManager();

const { currentProjectId, currentView } = storeToRefs(projectStore);

const scrollEl = ref<HTMLElement | null>(null);
const rulerContainerRef = ref<HTMLElement | null>(null);
const timelineTrackLabelsRef = ref<InstanceType<typeof TimelineTrackLabels> | null>(null);
const scrollLeftRef = ref(0);
const scrollbarHeight = ref(0);
const viewportWidth = ref(0);
const trackAreaRef = ref<HTMLElement | null>(null);

const { trackHeights } = storeToRefs(timelineStore);
const timelineSplitKey = computed(() => `timeline-split-${currentView.value}`);
const {
  sizes: timelineSplitSizes,
  onResized: onTimelineSplitResize,
  reset: resetTimelineSplit,
} = usePersistedSplitpanes(timelineSplitKey.value, currentProjectId, [10, 90]);

const menuRef = ref<InstanceType<typeof UiContextMenuPortal> | null>(null);
const containerRef = ref<HTMLElement | null>(null);

const timelineMenuItems = computed(() => [
  [
    {
      label: t('common.actions.reset'),
      icon: 'i-heroicons-arrow-path',
      onSelect: () => {
        resetTimelineSplit();
      },
    },
  ],
]);

function onContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.classList.contains('splitpanes__splitter')) {
    e.preventDefault();
    menuRef.value?.open(e);
  }
}

const canEditClipContent = computed(() => ['cut', 'files', 'sound'].includes(currentView.value));
const tracks = computed(() => (timelineStore.timelineDoc?.tracks as TimelineTrack[]) ?? []);

const fps = computed(() => projectStore.projectSettings.project.fps || 30);
const playheadPx = computed(() =>
  timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom),
);
// Честное центрирование 1px линии через CSS translateX(-50%), без подгонки пикселей
const playheadTransform = computed(
  () => `translate3d(${playheadPx.value}px, 0, 0) translateX(-50%)`,
);

const currentFrameHighlightStyle = computed(() => {
  const pxPerFrame = zoomToPxPerSecond(timelineStore.timelineZoom) / fps.value;
  if (pxPerFrame < 6) return null;

  // Честная математика: currentTime округляется до целых микросекунд.
  // Максимальная погрешность при таком округлении - 0.5 мкс. Добавляем её для точного определения кадра.
  const currentFrameIndex = Math.floor(((timelineStore.currentTime + 0.5) * fps.value) / 1_000_000);
  const currentFrameStartUs = Math.round((currentFrameIndex * 1_000_000) / fps.value);
  const nextFrameStartUs = Math.round(((currentFrameIndex + 1) * 1_000_000) / fps.value);

  const currentFrameStartPx = timeUsToPx(currentFrameStartUs, timelineStore.timelineZoom);
  const nextFrameStartPx = timeUsToPx(nextFrameStartUs, timelineStore.timelineZoom);

  return {
    transform: `translate3d(${currentFrameStartPx}px, 0, 0)`,
    width: `${Math.max(1, nextFrameStartPx - currentFrameStartPx)}px`,
  };
});

const zoomFactor = computed(() =>
  formatZoomMultiplier(timelineZoomPositionToScale(timelineStore.timelineZoom)),
);
const isZooming = ref(false);
const hideZoomIndicator = useDebounceFn(() => {
  isZooming.value = false;
}, 2000);

watch(
  () => timelineStore.timelineZoom,
  () => {
    isZooming.value = true;
    hideZoomIndicator();
  },
);

useResizeObserver(scrollEl, () => {
  if (scrollEl.value) {
    scrollbarHeight.value = scrollEl.value.offsetHeight - scrollEl.value.clientHeight;
    viewportWidth.value = scrollEl.value.clientWidth;
    timelineStore.timelineViewportWidth = viewportWidth.value;
  }
});

watch(
  () => timelineStore.scrollResetTicket,
  () => {
    if (scrollEl.value) scrollEl.value.scrollLeft = 0;
  },
);

const { onScroll, onLabelsScroll, startPan, onPanMove, stopPan, isPanning, hasPanned } =
  useTimelineScrollSync({
    scrollEl,
    labelsScrollContainer: computed(
      () => timelineTrackLabelsRef.value?.labelsScrollContainer ?? null,
    ),
    onScrollCallback: () => {
      if (scrollEl.value) scrollLeftRef.value = scrollEl.value.scrollLeft;
    },
  });

const { handleZoomWheel, fitTimelineZoom } = useTimelineZoom({ scrollEl });
const {
  dragPreview,
  clearDragPreview,
  handleFileDrop,
  handleLibraryDrop,
  getDropPosition,
  onTrackDragOver,
  onTrackDragLeave,
} = useTimelineDropHandling({ scrollEl });

const {
  draggingMode,
  draggingItemId,
  movePreview,
  slipPreview,
  onTimeRulerPointerDown: onBaseTimeRulerPointerDown,
  startPlayheadDrag,
  isDraggingPlayhead,
  hasPlayheadMoved,
  onGlobalPointerMove: onBaseGlobalPointerMove,
  onGlobalPointerUp: onBaseGlobalPointerUp,
  selectItem,
  startMoveItem,
  startTrimItem,
} = useTimelineInteraction(scrollEl, tracks);

const timelineMouseSettings = computed(() => workspaceStore.userSettings.mouse.timeline);
const rulerMouseSettings = computed(() => workspaceStore.userSettings.mouse.ruler);
const trackHeadersMouseSettings = computed(() => workspaceStore.userSettings.mouse.trackHeaders);

function onTimelinePointerMove(e: PointerEvent) {
  const isRuler = (e.target as HTMLElement | null)?.closest('.timeline-ruler-container');
  const settings = isRuler ? rulerMouseSettings.value : timelineMouseSettings.value;

  if (
    settings.horizontalMovement === 'move_playhead' &&
    !draggingMode.value &&
    !isPanning.value &&
    !isDraggingPlayhead.value
  ) {
    const el = scrollEl.value;
    if (el) {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left + el.scrollLeft;
      timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
    }
  }

  onBaseGlobalPointerMove(e);
  onPanMove(e);
}

function onTimelinePointerUp(e: PointerEvent) {
  onBaseGlobalPointerUp(e);
  stopPan(e);
}

function onTimeRulerPointerDown(e: PointerEvent) {
  focusStore.setMainFocus('timeline');
  onBaseTimeRulerPointerDown(e);
}

function onTimelineClick(e: MouseEvent) {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;

  if (timelineStore.isTrimModeActive) {
    if (!target?.closest('[data-clip-id]')) {
      timelineStore.isTrimModeActive = false;
    }
    return;
  }

  if (
    target?.closest('button, .cursor-ew-resize, .cursor-ns-resize, [data-clip-id], [data-gap-id]')
  )
    return;

  const el = scrollEl.value;
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const y = e.clientY - rect.top + el.scrollTop;

  const totalTracksHeight = tracks.value.reduce(
    (sum, tr) => sum + (trackHeights.value[tr.id] ?? 40),
    0,
  );

  if (y > totalTracksHeight) {
    timelineStore.selectTimelineProperties();
    return;
  }

  const isShift = isLayer1Active(e, workspaceStore.userSettings);
  const action = isShift
    ? timelineMouseSettings.value.shiftClick
    : timelineMouseSettings.value.click;
  handleTimelineClickAction(action, e);
}

function onGlobalTimelineClick(e: MouseEvent) {
  if (!timelineStore.isTrimModeActive) return;
  const target = e.target as HTMLElement;
  if (target?.closest('[data-timeline-toolbar]')) return;
  if (!target?.closest('.timeline-scroll-el') && !target?.closest('[data-clip-id]')) {
    timelineStore.isTrimModeActive = false;
  }
}

useEventListener(window, 'click', onGlobalTimelineClick, { capture: true });
useEventListener(scrollEl, 'wheel', onTimelineWheel, { passive: false });

function shouldUseNativeTimelineScroll(
  e: WheelEvent,
  action: string,
  category: keyof FastCatUserSettings['mouse'],
) {
  if (category !== 'timeline') return false;

  if (action === 'scroll_vertical') {
    return !isSecondaryWheel(e);
  }

  if (action === 'scroll_horizontal') {
    return isSecondaryWheel(e);
  }

  return false;
}

function onTimelineWheel(e: WheelEvent, category: keyof FastCatUserSettings['mouse'] = 'timeline') {
  if (!scrollEl.value) return;

  let settings;
  if (category === 'timeline') {
    settings = timelineMouseSettings.value;
  } else if (category === 'ruler') {
    settings = rulerMouseSettings.value;
  } else if (category === 'trackHeaders') {
    settings = trackHeadersMouseSettings.value;
  } else {
    settings = timelineMouseSettings.value; // Fallback
  }

  const isShift = isLayer1Active(e, workspaceStore.userSettings);
  const secondary = isSecondaryWheel(e);
  const action = secondary
    ? isShift
      ? settings.wheelSecondaryShift
      : settings.wheelSecondary
    : isShift
      ? settings.wheelShift
      : settings.wheel;

  if (shouldUseNativeTimelineScroll(e, action, category)) {
    return;
  }

  if (action === 'none') {
    e.preventDefault();
    return;
  }

  const delta = getWheelDelta(e);

  if (action === 'scroll_vertical') {
    e.preventDefault();
    scrollEl.value.scrollTop += delta;
    return;
  }

  if (action === 'scroll_horizontal') {
    e.preventDefault();
    scrollEl.value.scrollLeft += delta;
    return;
  }

  if (action === 'zoom_horizontal') {
    e.preventDefault();
    const rect = scrollEl.value.getBoundingClientRect();
    const anchorViewportX = e.clientX - rect.left;
    const anchorTimeUs = pxToTimeUs(
      scrollEl.value.scrollLeft + anchorViewportX,
      timelineStore.timelineZoom,
    );
    handleZoomWheel(delta > 0 ? -5 : 5, { anchorTimeUs, anchorViewportX });
    return;
  }

  if (action === 'zoom_vertical') {
    e.preventDefault();
    const factor = delta > 0 ? 0.9 : 1.1;
    tracks.value.forEach((track: TimelineTrack) => {
      const currentHeight = trackHeights.value[track.id] ?? 40;
      trackHeights.value[track.id] = Math.max(32, Math.min(300, currentHeight * factor));
    });
    timelineStore.markTimelineAsDirty();
    timelineStore.requestTimelineSave();
    return;
  }

  if (action === 'seek_frame') {
    e.preventDefault();
    const frameDurationUs = 1_000_000 / fps.value;
    timelineStore.setCurrentTimeUs(
      Math.max(0, Math.round(timelineStore.currentTime + (delta > 0 ? 1 : -1) * frameDurationUs)),
    );
    return;
  }

  if (action === 'seek_second') {
    e.preventDefault();
    timelineStore.setCurrentTimeUs(
      Math.max(0, Math.round(timelineStore.currentTime + (delta > 0 ? 1 : -1) * 1_000_000)),
    );
    return;
  }

  if (action === 'resize_track') {
    e.preventDefault();
    const target = e.target as Node;
    const el = target.nodeType === 3 ? target.parentElement : (target as Element);
    const trackEl = el?.closest?.('[data-track-id]');
    const trackId = trackEl?.getAttribute('data-track-id');
    if (trackId) {
      const currentHeight = trackHeights.value[trackId] ?? 40;
      const step = Math.abs(delta) < 10 ? delta * -1 : delta > 0 ? -8 : 8;
      const nextHeight = Math.max(32, Math.min(300, currentHeight + step));
      updateTrackHeight(trackId, nextHeight);
    }
  }
}

async function onClipAction(payload: TimelineClipActionPayload) {
  try {
    if (payload.action === 'extractAudio') {
      await timelineStore.extractAudioToTrack({
        videoTrackId: payload.trackId,
        videoItemId: payload.itemId,
      });
    } else if (payload.action === 'freezeFrame') {
      timelineStore.setClipFreezeFrameFromPlayhead({
        trackId: payload.trackId,
        itemId: payload.itemId,
      });
    } else if (payload.action === 'resetFreezeFrame') {
      timelineStore.resetClipFreezeFrame({ trackId: payload.trackId, itemId: payload.itemId });
    } else {
      timelineStore.returnAudioToVideo({ videoItemId: payload.videoItemId ?? payload.itemId });
    }
    await timelineStore.requestTimelineSave({ immediate: true });
  } catch (err: unknown) {
    toast.add({
      title: t('common.error'),
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
    });
  }
}

function updateTrackHeight(trackId: string, height: number) {
  trackHeights.value[trackId] = height;
  timelineStore.markTimelineAsDirty();
  timelineStore.requestTimelineSave();
}

const onDrop = async (e: DragEvent, trackId: string) => {
  const startUs = getDropPosition(e);
  if (startUs === null) return;

  const pseudo =
    isLayer1Active(e as unknown as MouseEvent, workspaceStore.userSettings) ||
    timelineSettingsStore.overlapMode === 'pseudo';

  const libraryItemData =
    e.dataTransfer?.getData('fastcat-item') || e.dataTransfer?.getData('application/json');
  if (libraryItemData) {
    try {
      const parsed = JSON.parse(libraryItemData);
      // Only handle if it's our known internal drag objects
      if (parsed.kind || (Array.isArray(parsed) && parsed.length > 0 && parsed[0].kind)) {
        await handleLibraryDrop(libraryItemData, trackId, startUs, { pseudo });
        return;
      }
    } catch {
      // ignore JSON parse errors and fall through
    }
  }

  const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
  if (files.length > 0) {
    await handleFileDrop(files, trackId, startUs);
  }

  clearDragPreview();
};
const trackHeadersContainerRef = ref<HTMLElement | null>(null);
useEventListener(
  trackHeadersContainerRef,
  'wheel',
  (e: WheelEvent) => onTimelineWheel(e, 'trackHeaders'),
  { passive: false },
);
useEventListener(rulerContainerRef, 'wheel', (e: WheelEvent) => onTimelineWheel(e, 'ruler'), {
  passive: false,
});
const handleTimelineClickAction = (action: string, e: PointerEvent | MouseEvent) => {
  if (action === 'none') return;
  if (action === 'reset_zoom') {
    timelineStore.resetTimelineZoom();
    return;
  }
  if (action === 'fit_zoom') {
    timelineStore.fitTimelineZoom();
    return;
  }
  if (action === 'select_item') {
    // TODO: выбрать клип (по умолчанию)
    return;
  }
  if (action === 'select_multiple') {
    // TODO: выделить несколько клипов (по умолчанию)
    return;
  }
  if (action === 'seek' || action === 'move_playhead') {
    const el = scrollEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
    return;
  }
  if (action === 'select_area') {
    // Selection range logic in track area is usually handled by useTimelineInteraction
    // for left click. For middle click we'd need to expose it if we want it here.
    // For now we can use seek here.
    return;
  }
  if (action === 'add_marker') {
    const el = scrollEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    const timeUs = pxToTimeUs(x, timelineStore.timelineZoom);
    const newMarkerId = `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    timelineStore.applyTimeline({
      type: 'add_marker',
      id: newMarkerId,
      timeUs,
      text: '',
    });
  }
};

const onTrackAreaPointerDownCapture = (e: PointerEvent) => {
  const isRuler = (e.target as HTMLElement | null)?.closest('.timeline-ruler-container');
  if (isRuler) return;

  if (e.button === 1) {
    hasPanned.value = false;
    hasPlayheadMoved.value = false;
    const settings = timelineMouseSettings.value;

    if (settings.middleDrag === 'pan') {
      startPan(e);
    } else if (settings.middleDrag === 'move_playhead') {
      const el = scrollEl.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left + el.scrollLeft;
      timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
      startPlayheadDrag(e);
    } else if (settings.middleDrag === 'select_area') {
      // Logic for select_area drag on timeline?
      // Usually done with Left button + Shift. Implementation might be complex to port here.
    }
  }
};

const onTrackAreaAuxClick = (e: MouseEvent) => {
  if (e.button === 1) {
    const isRuler = (e.target as HTMLElement).closest('.timeline-ruler-container');
    if (!isRuler) {
      if (hasPanned.value || hasPlayheadMoved.value) return;

      const settings = timelineMouseSettings.value;
      handleTimelineClickAction(settings.middleClick, e);
    }
  }
};

function executeTimelineRulerAction(action: string, e: MouseEvent) {
  if (action === 'none') return;

  const rect = trackAreaRef.value?.getBoundingClientRect();
  if (!rect) return;
  const x = e.clientX - rect.left + (scrollEl.value?.scrollLeft ?? 0);
  const timeUs = pxToTimeUs(x, timelineStore.timelineZoom);

  if (action === 'seek') {
    timelineStore.setCurrentTimeUs(timeUs);
  } else if (action === 'add_marker') {
    const id = `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    timelineStore.applyTimeline({
      type: 'add_marker',
      id,
      timeUs,
      text: '',
    });
  } else if (action === 'reset_zoom') {
    timelineStore.resetTimelineZoom();
  }
}
</script>

<template>
  <div
    ref="containerRef"
    class="panel-focus-frame relative flex flex-col h-full bg-ui-bg border-t border-ui-border"
    :class="{
      'panel-focus-frame--active': focusStore.isPanelFocused('timeline'),
    }"
    @pointerdown.capture="focusStore.setMainFocus('timeline')"
  >
    <UiContextMenuPortal
      ref="menuRef"
      :items="timelineMenuItems"
      :target-el="containerRef"
      manual
    />
    <ClientOnly>
      <Splitpanes
        class="flex flex-1 min-h-0 overflow-hidden editor-splitpanes"
        @resized="onTimelineSplitResize"
        @contextmenu="onContextMenu"
      >
        <Pane :size="timelineSplitSizes[0]" min-size="5" max-size="50">
          <div ref="trackHeadersContainerRef" class="h-full">
            <TimelineTrackLabels
              ref="timelineTrackLabelsRef"
              :tracks="tracks"
              :track-heights="trackHeights"
              :scrollbar-compensation="scrollbarHeight"
              class="h-full border-r border-ui-border"
              :on-zoom-to-fit="fitTimelineZoom"
              @update:track-height="updateTrackHeight"
              @scroll="onLabelsScroll"
            />
          </div>
        </Pane>
        <Pane :size="timelineSplitSizes[1]" min-size="50">
          <div
            ref="trackAreaRef"
            class="flex flex-col h-full w-full relative min-h-0"
            @pointermove="onTimelinePointerMove"
            @pointerup="onTimelinePointerUp"
            @pointercancel="onTimelinePointerUp"
            @pointerdown.capture="onTrackAreaPointerDownCapture"
            @auxclick="onTrackAreaAuxClick"
          >
            <div
              ref="rulerContainerRef"
              class="relative shrink-0 z-10 timeline-ruler-container h-8"
            >
              <TimelineRuler
                class="h-full border-b border-ui-border bg-ui-bg-elevated cursor-pointer w-full"
                :scroll-el="scrollEl"
                @pointerdown="onTimeRulerPointerDown"
                @start-playhead-drag="startPlayheadDrag"
                @start-pan="startPan"
              />
            </div>

            <!-- Grid lines overlaid on tracks area, below ruler, behind tracks -->
            <TimelineGrid
              class="absolute left-0 right-0 pointer-events-none z-0"
              :style="{ top: '2rem', bottom: `${scrollbarHeight}px` }"
              :scroll-el="scrollEl"
            />

            <div
              ref="scrollEl"
              class="w-full flex-1 overflow-auto relative timeline-scroll-el z-10"
              @click="onTimelineClick"
              @scroll="onScroll"
            >
              <!-- Tracks -->
              <TimelineTracks
                ref="timelineTracksRef"
                :tracks="tracks"
                :track-heights="trackHeights"
                :can-edit-clip-content="canEditClipContent"
                :drag-preview="dragPreview"
                :move-preview="movePreview"
                :slip-preview="slipPreview"
                :dragging-mode="draggingMode"
                :dragging-item-id="draggingItemId"
                :scroll-left="scrollLeftRef"
                :viewport-width="viewportWidth"
                :on-zoom-to-fit="fitTimelineZoom"
                @drop="onDrop"
                @dragover="onTrackDragOver"
                @dragleave="onTrackDragLeave"
                @start-move-item="startMoveItem"
                @select-item="selectItem"
                @start-trim-item="startTrimItem"
                @clip-action="onClipAction"
              />

              <div
                class="absolute inset-y-0 w-px pointer-events-none"
                :style="{
                  transform: playheadTransform,
                  willChange: 'transform',
                  zIndex: 50,
                  backgroundColor: '#ef4444',
                }"
              />

              <div
                v-if="currentFrameHighlightStyle"
                class="absolute top-0 bottom-0 pointer-events-none"
                :style="{
                  ...currentFrameHighlightStyle,
                  zIndex: 5,
                  backgroundColor: '#ef4444',
                  opacity: '0.12',
                }"
              />
            </div>

            <!-- Zoom indicator — absolute in bottom-right of visible track area -->
            <Transition
              enter-active-class="transition-opacity duration-150"
              enter-from-class="opacity-0"
              enter-to-class="opacity-100"
              leave-active-class="transition-opacity duration-500"
              leave-from-class="opacity-100"
              leave-to-class="opacity-0"
            >
              <div
                v-if="isZooming"
                class="absolute bottom-2 right-3 px-2 py-1 text-xs font-mono font-semibold rounded-md bg-neutral-900/90 text-neutral-100 shadow-lg backdrop-blur-sm pointer-events-none select-none"
                :style="{ zIndex: 60 }"
              >
                {{ zoomFactor }}
              </div>
            </Transition>
          </div>
        </Pane>
      </Splitpanes>
    </ClientOnly>
  </div>
</template>

<style scoped>
/*
  Use overlay-style scrollbars (drawn on top of content) to keep clientHeight
  consistent between tracks scroll-el and labels panel (which has no scrollbar).
  Falls back gracefully in browsers that don't support overlay.
*/
.timeline-scroll-el {
  scrollbar-width: thin;
  scrollbar-color: var(--ui-border-accent, #666) transparent;
}

.timeline-scroll-el::-webkit-scrollbar {
  height: 10px;
  width: 10px;
}

.timeline-scroll-el::-webkit-scrollbar-track {
  background: transparent;
}

.timeline-scroll-el::-webkit-scrollbar-thumb {
  background: var(--ui-border, #444);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.timeline-scroll-el::-webkit-scrollbar-thumb:hover {
  background: var(--ui-border-accent, #666);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
</style>
