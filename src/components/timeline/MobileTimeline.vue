<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
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
import { useSelectionStore } from '~/stores/selection.store';
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
import MobileClipPropertiesDrawer from './MobileClipPropertiesDrawer.vue';
import MobileTrackPropertiesDrawer from './MobileTrackPropertiesDrawer.vue';
import MobileAddContentDrawer from './MobileAddContentDrawer.vue';
import MobileVirtualClipPresetDrawer from './MobileVirtualClipPresetDrawer.vue';
import MobileMarkerPropertiesDrawer from './MobileMarkerPropertiesDrawer.vue';
import MobileTransitionPropertiesDrawer from './MobileTransitionPropertiesDrawer.vue';
import MobileGapPropertiesDrawer from './MobileGapPropertiesDrawer.vue';
import MobileSelectionRangePropertiesDrawer from './MobileSelectionRangePropertiesDrawer.vue';

const { t } = useI18n();
const toast = useToast();

const timelineStore = useTimelineStore();
const focusStore = useFocusStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();

const { currentView } = storeToRefs(projectStore);
const { selectedEntity } = storeToRefs(selectionStore);

const canEditClipContent = computed(
  () =>
    currentView.value === 'cut' || currentView.value === 'files' || currentView.value === 'sound',
);

const tracks = computed(
  () => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [],
);

const isTrackPropertiesDrawerOpen = ref(false);
const isClipPropertiesDrawerOpen = ref(false);
const isMarkerPropertiesDrawerOpen = ref(false);
const isSelectionRangeDrawerOpen = ref(false);
const isTransitionDrawerOpen = ref(false);
const isGapPropertiesDrawerOpen = ref(false);
const isAddContentDrawerOpen = ref(false);
const isVirtualClipPresetDrawerOpen = ref(false);
const virtualClipPresetType = ref<'text' | 'shape' | 'hud'>('text');
const drawerActiveSnapPoint = ref<string | number | null>(null);
const isLongPress = ref(false);

function onOpenVirtualClipPreset(type: 'text' | 'shape' | 'hud') {
  virtualClipPresetType.value = type;
  nextTick(() => {
    isVirtualClipPresetDrawerOpen.value = true;
  });
}

const selectedMarkerId = computed(() => {
  if (selectedEntity.value?.source === 'timeline' && selectedEntity.value.kind === 'marker') {
    const markerId = selectedEntity.value.markerId;
    if (timelineStore.markers.some((m) => m.id === markerId)) {
      return markerId;
    }
  }
  return null;
});

const selectedTransitionContext = computed(() => {
  const sel = timelineStore.selectedTransition;
  if (!sel) return null;
  const track = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined)?.find(
    (tr) => tr.id === sel.trackId,
  );
  if (!track) return null;
  const clip = track.items.find((i) => i.id === sel.itemId);
  if (!clip || clip.kind !== 'clip') return null;
  return { track, clip };
});

const selectedGap = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'gap') return null;
  return { trackId: entity.trackId, itemId: entity.itemId };
});

function closeAllDrawers() {
  isTrackPropertiesDrawerOpen.value = false;
  isClipPropertiesDrawerOpen.value = false;
  isMarkerPropertiesDrawerOpen.value = false;
  isSelectionRangeDrawerOpen.value = false;
  isTransitionDrawerOpen.value = false;
  isGapPropertiesDrawerOpen.value = false;
  drawerActiveSnapPoint.value = null;
}

watch(
  () => !!timelineStore.selectedTrackId && timelineStore.selectedItemIds.length === 0,
  (val) => {
    if (val) {
      closeAllDrawers();
      isTrackPropertiesDrawerOpen.value = true;
    }
  },
  { immediate: true },
);

watch(
  () => timelineStore.selectedItemIds.length > 0,
  (val) => {
    if (val) {
      closeAllDrawers();
      isClipPropertiesDrawerOpen.value = true;
    }
  },
  { immediate: true },
);

watch(
  () => !!selectedMarkerId.value,
  (val) => {
    if (val) {
      closeAllDrawers();
      isMarkerPropertiesDrawerOpen.value = true;
    }
  },
  { immediate: true },
);

watch(
  () =>
    selectionStore.selectedEntity?.source === 'timeline' &&
    selectionStore.selectedEntity.kind === 'selection-range',
  (val) => {
    if (val) {
      closeAllDrawers();
      isSelectionRangeDrawerOpen.value = true;
    }
  },
  { immediate: true },
);

watch(
  () => timelineStore.selectedTransition,
  (val) => {
    if (val) {
      closeAllDrawers();
      isTransitionDrawerOpen.value = true;
    }
  },
  { immediate: true },
);

watch(
  () => !!selectedGap.value,
  (val) => {
    if (val) {
      closeAllDrawers();
      isGapPropertiesDrawerOpen.value = true;
    }
  },
  { immediate: true },
);

function onUpdateDrawerOpen(val: boolean) {
  if (!val) {
    if (timelineStore.selectedTrackId) {
      timelineStore.selectTrack(null);
    }
    drawerActiveSnapPoint.value = null;
    isLongPress.value = false;
  }
}

function onClipPropertiesDrawerClose() {
  isClipPropertiesDrawerOpen.value = false;
  drawerActiveSnapPoint.value = null;
  isLongPress.value = false;
  timelineStore.clearSelection();
}

function onMarkerPropertiesDrawerClose() {
  isMarkerPropertiesDrawerOpen.value = false;
  selectionStore.clearSelection();
}

function onSelectionRangeDrawerClose() {
  isSelectionRangeDrawerOpen.value = false;
  selectionStore.clearSelection();
}

function onTransitionDrawerClose() {
  isTransitionDrawerOpen.value = false;
  timelineStore.selectTransition(null);
}

function onGapPropertiesDrawerClose() {
  isGapPropertiesDrawerOpen.value = false;
  timelineStore.clearSelection();
  selectionStore.clearSelection();
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

const playheadPx = computed(() =>
  Math.round(timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom)),
);

const pendingZoomAnchor = ref<TimelineZoomAnchor | null>(null);

const {
  draggingMode,
  draggingItemId,
  movePreview,
  onTimeRulerPointerDown,
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
  if (dx > 3 || dy > 3 || isLongPress.value) {
    isLongPress.value = false;
    return;
  }

  const target = e.target as HTMLElement | null;
  if (target?.closest('button')) return;
  if (target?.closest('.cursor-ew-resize')) return;
  if (target?.closest('.cursor-ns-resize')) return;
  if (target?.closest('[data-clip-id]')) return;
  if (target?.closest('[data-gap-id]')) return;
  if (target?.closest('[data-track-id]')) return;

  const el = scrollEl.value;
  if (!el) return;

  const tracksHeight = Object.values(trackHeights.value).reduce((a, b) => a + b, 0);
  const scrollerRectY = el.getBoundingClientRect();
  const y = e.clientY - scrollerRectY.top + el.scrollTop;
  if (y > tracksHeight + 32) {
    timelineStore.selectTimelineProperties();
    return;
  }

  // Tapping empty space clears selection (closes property drawers)
  timelineStore.clearSelection();
  timelineStore.selectTrack(null);

  const scrollX = el.scrollLeft;
  const x = e.clientX - scrollerRectY.left + scrollX;
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

    <!-- Clip Properties Drawer -->
    <MobileClipPropertiesDrawer
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isClipPropertiesDrawerOpen"
      @close="onClipPropertiesDrawerClose"
    />

    <!-- Track Properties Drawer -->
    <MobileTrackPropertiesDrawer
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isTrackPropertiesDrawerOpen"
      @close="onUpdateDrawerOpen(false)"
    />

    <!-- Marker Properties Drawer -->
    <MobileMarkerPropertiesDrawer
      v-if="selectedMarkerId"
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isMarkerPropertiesDrawerOpen"
      :marker-id="selectedMarkerId"
      @close="onMarkerPropertiesDrawerClose"
    />

    <!-- Selection Range Properties Drawer -->
    <MobileSelectionRangePropertiesDrawer
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isSelectionRangeDrawerOpen"
      @close="onSelectionRangeDrawerClose"
    />

    <!-- Transition Properties Drawer -->
    <MobileTransitionPropertiesDrawer
      v-if="timelineStore.selectedTransition && selectedTransitionContext"
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isTransitionDrawerOpen"
      :transition-selection="timelineStore.selectedTransition"
      :clip="selectedTransitionContext.clip"
      :track="selectedTransitionContext.track"
      @close="onTransitionDrawerClose"
    />

    <!-- Gap Properties Drawer -->
    <MobileGapPropertiesDrawer
      v-if="selectedGap"
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isGapPropertiesDrawerOpen"
      :track-id="selectedGap.trackId"
      :item-id="selectedGap.itemId"
      @close="onGapPropertiesDrawerClose"
    />

    <!-- Add content drawer -->
    <MobileAddContentDrawer
      :is-open="isAddContentDrawerOpen"
      @close="isAddContentDrawerOpen = false"
      @open-virtual-clip-preset="onOpenVirtualClipPreset"
    />

    <!-- Virtual clip preset drawer (text / shape / hud) -->
    <MobileVirtualClipPresetDrawer
      :is-open="isVirtualClipPresetDrawerOpen"
      :type="virtualClipPresetType"
      @close="isVirtualClipPresetDrawerOpen = false"
    />

    <!-- Tracks area -->
    <div class="flex-1 relative overflow-hidden">
      <!-- Ruler: outside scrollEl — not scrolled, draws based on scrollEl.scrollLeft -->
      <div
        class="absolute top-0 left-0 right-0 h-8 z-40 bg-ui-bg/95 border-b border-ui-border select-none touch-none backdrop-blur shadow-sm"
      >
        <TimelineRuler
          class="touch-none w-full h-full"
          :scroll-el="scrollEl"
          :is-mobile="true"
          @pointerdown="onTimeRulerPointerDown"
        />
      </div>

      <!-- Grid: outside scrollEl — covers tracks area, draws based on scrollEl.scrollLeft -->
      <TimelineGrid
        class="absolute left-0 right-0 bottom-0 pointer-events-none z-0"
        style="top: 32px"
        :scroll-el="scrollEl"
      />

      <!-- Main scrollable tracks area: starts below ruler (top-8 = 32px) -->
      <div
        ref="scrollEl"
        class="absolute top-8 left-0 right-0 bottom-0 overflow-auto overscroll-none touch-pan-x touch-pan-y no-scrollbar"
        @touchstart.passive="onTouchStart"
        @touchmove="onTouchMove"
        @pointerdown.capture="onTimelinePointerDownCapture"
        @click="onTimelineClick"
      >
        <div class="relative min-w-max h-full">
          <TimelineTracks
            class="min-w-full"
            :tracks="tracks"
            :track-heights="trackHeights"
            :can-edit-clip-content="canEditClipContent"
            :dragging-mode="draggingMode"
            :dragging-item-id="draggingItemId"
            :move-preview="movePreview"
            is-mobile
            @select-item="
              (ev, id) => {
                if (ev.pointerType === 'touch') {
                  // Long press is handled in TimelineClip via emit.
                  // But for short tap, we want to ensure it's NOT expanded.
                  drawerActiveSnapPoint = null;
                }
                selectItem(ev, id);
              }
            "
            @start-move-item="onStartMoveItem"
            @start-trim-item="onStartTrimItem"
            @clip-action="onClipAction"
            @long-press-item="
              (id: string) => {
                isLongPress = true;
                drawerActiveSnapPoint = 0.92;
                timelineStore.selectTimelineItems([{ itemId: id, trackId: '' }]);
              }
            "
            @long-press-track="
              (trackId: string) => {
                isLongPress = true;
                drawerActiveSnapPoint = 0.92;
                timelineStore.selectTrack(trackId);
                selectionStore.selectTimelineTrack(trackId);
                timelineStore.clearSelection();
              }
            "
          />

          <!-- Playhead line (ruler renders its own triangle marker) -->
          <div
            class="absolute inset-y-0 w-px bg-red-500 shadow-[0_0_2px_rgba(239,68,68,0.5)] z-30 pointer-events-none timeline-playhead"
            :style="{ left: `${playheadPx}px` }"
          />
        </div>
      </div>
    </div>

    <!-- FAB: add content -->
    <Teleport to="body">
      <div
        class="fixed bottom-20 right-6 z-40 transition-all duration-300"
      >
        <UButton
          icon="lucide:plus"
          size="xl"
          class="rounded-full shadow-2xl w-14 h-14 flex items-center justify-center bg-ui-action hover:bg-ui-action-hover text-white border-none shadow-ui-action/20"
          :ui="{ icon: 'w-7 h-7' }"
          :aria-label="t('fastcat.timeline.addContent', 'Add content')"
          @click="isAddContentDrawerOpen = true"
        />
      </div>
    </Teleport>
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
