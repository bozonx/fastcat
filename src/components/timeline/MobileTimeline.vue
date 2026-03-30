<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type {
  TimelineClipActionPayload,
  TimelineMoveItemPayload,
  TimelineTrimItemPayload,
  TimelineTrack,
} from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useFocusStore } from '~/stores/focus.store';
import { useTimelineInteraction } from '~/composables/timeline/useTimelineInteraction';
import {
  computeAnchoredScrollLeft,
  timeUsToPx,
  pxToTimeUs,
  type TimelineZoomAnchor,
} from '~/utils/timeline/geometry';
import { timelineZoomPositionToScale, timelineZoomScaleToPosition } from '~/utils/zoom';

import TimelineTracks from './TimelineTracks.vue';
import TimelineRuler from './TimelineRuler.vue';
import TimelineGrid from './TimelineGrid.vue';
import MobileTimelineToolbar from './MobileTimelineToolbar.vue';
import TrackProperties from '~/components/properties/TrackProperties.vue';


const { t } = useI18n();
const toast = useToast();

const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const mediaStore = useMediaStore();
const focusStore = useFocusStore();
const projectStore = useProjectStore();

const { currentView } = storeToRefs(projectStore);

const canEditClipContent = computed(
  () =>
    currentView.value === 'cut' || currentView.value === 'files' || currentView.value === 'sound',
);

const tracks = computed(
  () => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [],
);

const selectedTrack = computed(() => {
  if (!timelineStore.selectedTrackId) return null;
  return tracks.value.find((t) => t.id === timelineStore.selectedTrackId) || null;
});

const selectedTrackNumber = computed(() => {
  if (!selectedTrack.value) return 1;
  const filtered = tracks.value.filter((t) => t.kind === selectedTrack.value!.kind);
  return filtered.indexOf(selectedTrack.value) + 1;
});

const isTrackPropertiesDrawerOpen = ref(false);

watch(
  () => !!timelineStore.selectedTrackId && timelineStore.selectedItemIds.length === 0,
  (val) => {
    isTrackPropertiesDrawerOpen.value = val;
  },
  { immediate: true }
);

function onUpdateDrawerOpen(val: boolean) {
  if (!val && timelineStore.selectedTrackId) {
    timelineStore.selectTrack(null);
  }
}


const scrollEl = ref<HTMLElement | null>(null);

const trackHeights = computed(() => {
  const heights: Record<string, number> = {};
  for (const t of tracks.value) {
    // Mobile optimized heights: video tracks are taller for easier manipulation
    heights[t.id] = t.kind === 'video' ? 64 : 48;
  }
  return heights;
});

const scrollLeftRef = ref(0);

const playheadPx = computed(() =>
  timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom),
);

const playheadLeft = computed(() => Math.round(playheadPx.value - scrollLeftRef.value));

const tracksHeightPx = computed(() => Object.values(trackHeights.value).reduce((a, b) => a + b, 0));

function onScroll() {
  const el = scrollEl.value;
  if (!el) return;
  scrollLeftRef.value = el.scrollLeft;
}

const pendingZoomAnchor = ref<TimelineZoomAnchor | null>(null);

const {
  draggingMode,
  draggingItemId,
  movePreview,
  onTimeRulerPointerDown,
  startPlayheadDrag,
  selectItem,
  startMoveItem,
  startTrimItem,
} = useTimelineInteraction(scrollEl, tracks);

function onStartMoveItem(event: PointerEvent, payload: TimelineMoveItemPayload) {
  startMoveItem(event, {
    trackId: payload.trackId,
    itemId: payload.itemId,
    startUs: payload.startUs,
  });
}

function onStartTrimItem(event: PointerEvent, payload: TimelineTrimItemPayload) {
  startTrimItem(event, payload);
}

function getViewportWidth(): number {
  return scrollEl.value?.clientWidth ?? 0;
}

function makePlayheadAnchor(params: { zoom: number }): TimelineZoomAnchor {
  const viewportWidth = getViewportWidth();
  const prevScrollLeft = scrollEl.value?.scrollLeft ?? 0;
  const playheadPx = timeUsToPx(timelineStore.currentTime, params.zoom);
  const isVisible = playheadPx >= prevScrollLeft && playheadPx <= prevScrollLeft + viewportWidth;
  return {
    anchorTimeUs: timelineStore.currentTime,
    anchorViewportX: isVisible ? playheadPx - prevScrollLeft : viewportWidth / 2,
  };
}

function applyZoomWithAnchor(params: { nextZoom: number; anchor: TimelineZoomAnchor }) {
  pendingZoomAnchor.value = params.anchor;
  timelineStore.setTimelineZoom(params.nextZoom);
}

let initialDistance = 0;
let initialZoomPosition = 1;

function getDistance(touches: TouchList) {
  const t0 = touches[0] as Touch;
  const t1 = touches[1] as Touch;
  const dx = t0.clientX - t1.clientX;
  const dy = t0.clientY - t1.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length === 2) {
    initialDistance = getDistance(e.touches);
    initialZoomPosition = timelineStore.timelineZoom;
  }
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const currentDistance = getDistance(e.touches);
    if (initialDistance === 0) return;

    const initialScale = timelineZoomPositionToScale(initialZoomPosition);
    const scaleRatio = currentDistance / initialDistance;
    const nextScale = initialScale * scaleRatio;
    const nextZoomPosition = timelineZoomScaleToPosition(nextScale);

    const el = scrollEl.value;
    if (el) {
      const rect = el.getBoundingClientRect();
      const midpointX = ((e.touches[0] as Touch).clientX + (e.touches[1] as Touch).clientX) / 2;
      const viewportX = midpointX - rect.left;
      const anchorPx = el.scrollLeft + viewportX;
      const anchorTimeUs = pxToTimeUs(anchorPx, initialZoomPosition);

      applyZoomWithAnchor({
        nextZoom: nextZoomPosition,
        anchor: { anchorTimeUs, anchorViewportX: viewportX },
      });
    }
  }
}

const clickStartX = ref(0);
const clickStartY = ref(0);

function onTimelinePointerDownCapture(e: PointerEvent) {
  if (e.button === 0) {
    clickStartX.value = e.clientX;
    clickStartY.value = e.clientY;
  }
}

function onTimelineClick(e: MouseEvent) {
  if (e.button !== 0) return;
  const dx = Math.abs(e.clientX - clickStartX.value);
  const dy = Math.abs(e.clientY - clickStartY.value);
  if (dx > 3 || dy > 3) return;

  const target = e.target as HTMLElement | null;
  if (target?.closest('button')) return;
  if (target?.closest('.cursor-ew-resize')) return;
  if (target?.closest('.cursor-ns-resize')) return;
  if (target?.closest('[data-clip-id]')) return;
  if (target?.closest('[data-gap-id]')) return;

  const el = scrollEl.value;
  if (!el) return;

  const docTracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  const tracksHeight = Object.values(trackHeights.value).reduce((a, b) => a + b, 0);

  const scrollerRectY = el.getBoundingClientRect();
  const y = e.clientY - scrollerRectY.top + el.scrollTop;
  if (y > tracksHeight + 32) {
    timelineStore.selectTimelineProperties();
    return;
  }

  const scrollerRect = el.getBoundingClientRect();
  const scrollX = el.scrollLeft;
  const x = e.clientX - scrollerRect.left + scrollX;

  timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
}

// Ensure the playhead starts in view if zooming happens from other causes
watch(
  () => timelineStore.timelineZoom,
  (nextZoom, prevZoom) => {
    const el = scrollEl.value;
    if (!el) return;
    if (!Number.isFinite(prevZoom)) return;
    if (nextZoom === prevZoom) return;

    const prevScrollLeft = el.scrollLeft;
    const viewportWidth = el.clientWidth;
    const anchor = pendingZoomAnchor.value ?? makePlayheadAnchor({ zoom: prevZoom });
    pendingZoomAnchor.value = null;

    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom,
      nextZoom,
      prevScrollLeft,
      viewportWidth,
      anchor,
    });
    el.scrollLeft = nextScrollLeft;
    scrollLeftRef.value = nextScrollLeft;
  },
  { flush: 'post' },
);

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
      timelineStore.resetClipFreezeFrame({
        trackId: payload.trackId,
        itemId: payload.itemId,
      });
    } else {
      timelineStore.returnAudioToVideo({ videoItemId: payload.videoItemId ?? payload.itemId });
    }
    await timelineStore.requestTimelineSave({ immediate: true });
  } catch (err: unknown) {
    toast.add({
      title: t('common.error', 'Error'),
      description: err instanceof Error ? err.message : String(err ?? ''),
      icon: 'i-heroicons-exclamation-triangle',
      color: 'error',
    });
  }
}
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated relative overflow-hidden"
    @pointerdown="focusStore.setMainFocus('timeline')"
  >
    <MobileTimelineToolbar />
    
    <!-- Track Properties Drawer -->
    <UDrawer
      :open="isTrackPropertiesDrawerOpen"
      @update:open="onUpdateDrawerOpen"
      direction="bottom"
      :snap-points="[0.12, 0.85]"
      dismissible
      :title="selectedTrack?.name || selectedTrack?.id || ''"
      should-scale-background
    >
      <template #content>
        <div class="flex flex-col w-full min-h-24 max-h-[85vh]">
          <!-- Track Label Header (Mobile Title) -->
          <div class="shrink-0 pt-6 pb-4 px-4 flex items-center gap-2">
            <div
              v-if="selectedTrack"
              class="w-6 h-6 rounded shrink-0 flex items-center justify-center font-black text-[10px]"
              :style="{ 
                backgroundColor: selectedTrack.color && selectedTrack.color !== '#2a2a2a' ? `${selectedTrack.color}33` : '#1e293b',
                color: selectedTrack.color && selectedTrack.color !== '#2a2a2a' ? selectedTrack.color : '#94a3b8'
              }"
            >
              {{ selectedTrack.kind === 'video' ? 'V' : 'A' }}{{ selectedTrackNumber }}
            </div>
            
            <span v-if="selectedTrack" class="text-sm font-medium text-slate-200 truncate flex-1 leading-none">
              {{ selectedTrack.name || selectedTrack.id }}
            </span>
          </div>
          
          <!-- Track Properties Content -->
          <div class="flex-1 overflow-y-auto no-scrollbar pb-[env(safe-area-inset-bottom,24px)] px-4">
            <TrackProperties v-if="selectedTrack" :track="selectedTrack" />
          </div>
        </div>
      </template>
    </UDrawer>

    <!-- Tracks area: holds scroll view -->
    <div
      class="flex-1 relative overflow-hidden"
    >

      <!-- Main scrollable tracks area -->
      <div
        ref="scrollEl"
        class="absolute inset-0 overflow-auto overscroll-none touch-pan-x touch-pan-y no-scrollbar"
        @scroll.passive="onScroll"
        @touchstart.passive="onTouchStart"
        @touchmove="onTouchMove"
        @pointerdown.capture="onTimelinePointerDownCapture"
        @click="onTimelineClick"
      >
        <div class="relative min-w-max h-full">
          <div
            class="sticky top-0 z-40 w-full h-8 bg-ui-bg/95 border-b border-ui-border shrink-0 select-none touch-none backdrop-blur shadow-sm"
          >
            <TimelineRuler
              class="touch-none w-full h-full"
              :scroll-el="scrollEl"
              @pointerdown="onTimeRulerPointerDown"
            />
          </div>

          <TimelineTracks
            class="min-w-full"
            :tracks="tracks"
            :track-heights="trackHeights"
            :can-edit-clip-content="canEditClipContent"
            :dragging-mode="draggingMode"
            :dragging-item-id="draggingItemId"
            :move-preview="movePreview"
            is-mobile
            @select-item="selectItem"
            @start-move-item="onStartMoveItem"
            @start-trim-item="onStartTrimItem"
            @clip-action="onClipAction"
          />

          <TimelineGrid
            class="absolute left-0 right-0 bottom-0 pointer-events-none"
            :style="{ top: '32px', height: `${tracksHeightPx}px` }"
            :scroll-el="scrollEl"
          />

          <div
            class="absolute bottom-0 z-30 pointer-events-none timeline-playhead"
            :style="{
              top: '0px',
              left: `${playheadLeft}px`,
            }"
          >
            <div class="w-px h-full bg-red-500 shadow-[0_0_2px_rgba(239,68,68,0.5)]"></div>
            <div
              class="absolute top-0 -translate-x-[50%] w-6 h-6 flex items-center justify-center pointer-events-auto touch-none"
              @pointerdown.stop.prevent="startPlayheadDrag"
            >
              <div
                class="w-4 h-4 bg-red-500 shadow-sm rounded-b-sm"
                style="clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%)"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline-playhead {
  will-change: transform;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
