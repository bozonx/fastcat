<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import { useDebounceFn, useLocalStorage, useResizeObserver } from '@vueuse/core';

import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useMediaStore } from '~/stores/media.store';
import { useFocusStore } from '~/stores/focus.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';

import type { TimelineClipActionPayload, TimelineTrack } from '~/timeline/types';
import { timeUsToPx, pxToTimeUs, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { formatZoomMultiplier, timelineZoomPositionToScale } from '~/utils/zoom';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';

import TimelineTrackLabels from '~/components/timeline/TimelineTrackLabels.vue';
import TimelineTracks from '~/components/timeline/TimelineTracks.vue';
import TimelineRuler from '~/components/timeline/TimelineRuler.vue';
import TimelineGrid from '~/components/timeline/TimelineGrid.vue';

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
const timelineTrackLabelsRef = ref<InstanceType<typeof TimelineTrackLabels> | null>(null);
const scrollLeftRef = ref(0);
const scrollbarHeight = ref(0);

const trackHeights = useLocalStorage<Record<string, number>>('fastcat-editor-track-heights-v1', {});
const timelineSplitKey = computed(() => `timeline-split-${currentView.value}`);
const { sizes: timelineSplitSizes, onResized: onTimelineSplitResize } = usePersistedSplitpanes(
  timelineSplitKey.value,
  currentProjectId,
  [10, 90],
);

const canEditClipContent = computed(() => ['cut', 'files', 'sound'].includes(currentView.value));
const tracks = computed(() => (timelineStore.timelineDoc?.tracks as TimelineTrack[]) ?? []);

const fps = computed(() => projectStore.projectSettings.project.fps || 30);
const playheadPx = computed(() =>
  timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom),
);
const playheadTransform = computed(() => `translate3d(${Math.round(playheadPx.value)}px, 0, 0)`);

const currentFrameHighlightStyle = computed(() => {
  const pxPerFrame = zoomToPxPerSecond(timelineStore.timelineZoom) / fps.value;
  if (pxPerFrame < 6) return null;

  const frameDurationUs = 1_000_000 / fps.value;
  const currentFrameStartUs =
    Math.floor(timelineStore.currentTime / frameDurationUs) * frameDurationUs;
  const currentFrameStartPx = timeUsToPx(currentFrameStartUs, timelineStore.timelineZoom);

  return {
    transform: `translate3d(${currentFrameStartPx}px, 0, 0)`,
    width: `${pxPerFrame}px`,
  };
});

const zoomFactor = computed(() =>
  formatZoomMultiplier(timelineZoomPositionToScale(timelineStore.timelineZoom)),
);
const isZooming = ref(false);
const hideZoomIndicator = useDebounceFn(() => {
  isZooming.value = false;
}, 180);

watch(
  () => timelineStore.timelineZoom,
  () => {
    isZooming.value = true;
    hideZoomIndicator();
  },
);

useResizeObserver(scrollEl, () => {
  if (scrollEl.value)
    scrollbarHeight.value = scrollEl.value.offsetHeight - scrollEl.value.clientHeight;
});

const { onScroll, onLabelsScroll, startPan, onPanMove, stopPan, isPanning } = useTimelineScrollSync(
  {
    scrollEl,
    labelsScrollContainer: computed(
      () => timelineTrackLabelsRef.value?.labelsScrollContainer ?? null,
    ),
    onScrollCallback: () => {
      if (scrollEl.value) scrollLeftRef.value = scrollEl.value.scrollLeft;
    },
  },
);

const { handleZoomWheel } = useTimelineZoom({ scrollEl });
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
  onTimeRulerPointerDown,
  startPlayheadDrag,
  onGlobalPointerMove,
  onGlobalPointerUp,
  selectItem,
  startMoveItem,
  startTrimItem,
} = useTimelineInteraction(scrollEl, tracks);

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
  const x = e.clientX - rect.left + el.scrollLeft;
  const y = e.clientY - rect.top + el.scrollTop;

  const totalTracksHeight = tracks.value.reduce(
    (sum, tr) => sum + (trackHeights.value[tr.id] ?? 40),
    0,
  );
  if (y > totalTracksHeight) {
    timelineStore.selectTimelineProperties();
  } else {
    timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
  }
}

function onGlobalTimelineClick(e: MouseEvent) {
  if (!timelineStore.isTrimModeActive) return;
  const target = e.target as HTMLElement;
  if (!target?.closest('.timeline-scroll-el') && !target?.closest('[data-clip-id]')) {
    timelineStore.isTrimModeActive = false;
  }
}

onMounted(() => {
  window.addEventListener('click', onGlobalTimelineClick, { capture: true });
});

onUnmounted(() => {
  window.removeEventListener('click', onGlobalTimelineClick, { capture: true });
});

function onTimelineWheel(e: WheelEvent) {
  const isShift = isLayer1Active(e, workspaceStore.userSettings);
  const isCtrl = e.ctrlKey || e.metaKey;

  if (isCtrl) {
    e.preventDefault();
    handleZoomWheel(e.deltaY > 0 ? -5 : 5);
    return;
  }

  if (isShift && scrollEl.value) {
    e.preventDefault();
    scrollEl.value.scrollLeft += e.deltaY;
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
const onTimelineRulerWheel = (e: WheelEvent) => onTimelineWheel(e);
const onTrackAreaPointerDownCapture = (e: PointerEvent) => {
  if (e.button === 1) startPan(e);
};
const onTimelinePointerMove = onGlobalPointerMove;
const onTimelinePointerUp = onGlobalPointerUp;
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg border-t border-ui-border"
    :class="{
      'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
        focusStore.isPanelFocused('timeline'),
    }"
    @pointerdown.capture="focusStore.setMainFocus('timeline')"
  >
    <ClientOnly>
      <Splitpanes
        class="flex flex-1 min-h-0 overflow-hidden editor-splitpanes"
        @resized="onTimelineSplitResize"
      >
        <Pane :size="timelineSplitSizes[0]" min-size="5" max-size="50">
          <TimelineTrackLabels
            ref="timelineTrackLabelsRef"
            :tracks="tracks"
            :track-heights="trackHeights"
            :scrollbar-compensation="scrollbarHeight"
            class="h-full border-r border-ui-border"
            @update:track-height="updateTrackHeight"
            @scroll="onLabelsScroll"
          />
        </Pane>
        <Pane :size="timelineSplitSizes[1]" min-size="50">
          <div
            ref="trackAreaRef"
            class="flex flex-col h-full w-full relative min-h-0"
            @pointermove="onTimelinePointerMove"
            @pointerup="onTimelinePointerUp"
            @pointercancel="onTimelinePointerUp"
            @pointerdown.capture="onTrackAreaPointerDownCapture"
          >
            <div class="relative shrink-0 z-10">
              <TimelineRuler
                class="h-7 border-b border-ui-border bg-ui-bg-elevated cursor-pointer w-full"
                :scroll-el="scrollEl"
                @pointerdown="onTimeRulerPointerDown"
                @start-playhead-drag="startPlayheadDrag"
                @start-pan="startPan"
                @wheel="onTimelineRulerWheel"
              />
            </div>
            <div
              ref="scrollEl"
              class="w-full flex-1 overflow-auto relative timeline-scroll-el"
              @click="onTimelineClick"
              @wheel="onTimelineWheel"
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
                :dragging-mode="draggingMode"
                :dragging-item-id="draggingItemId"
                @drop="onDrop"
                @dragover="onTrackDragOver"
                @dragleave="onTrackDragLeave"
                @start-move-item="startMoveItem"
                @select-item="selectItem"
                @start-trim-item="startTrimItem"
                @clip-action="onClipAction"
              />

              <div
                v-if="currentFrameHighlightStyle"
                class="absolute top-0 bottom-0 pointer-events-none"
                :style="{
                  ...currentFrameHighlightStyle,
                  zIndex: 5,
                  backgroundColor: 'var(--color-primary-500, #3b82f6)',
                  opacity: '0.12',
                }"
              />

              <div
                class="absolute top-0 bottom-0 w-px pointer-events-none"
                :style="{
                  transform: playheadTransform,
                  willChange: 'transform',
                  zIndex: 50,
                  backgroundColor: 'var(--color-primary-500, #3b82f6)',
                }"
              />
            </div>

            <!-- Grid lines overlaid on tracks area, below ruler -->
            <TimelineGrid
              class="absolute left-0 right-0 pointer-events-none"
              :style="{ top: '28px', bottom: `${scrollbarHeight}px` }"
              :scroll-el="scrollEl"
            />

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
