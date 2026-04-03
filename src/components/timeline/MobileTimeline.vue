<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
import {
  MIN_TIMELINE_ZOOM_POSITION,
  MAX_TIMELINE_ZOOM_POSITION,
  timelineZoomPositionToScale,
  timelineZoomScaleToPosition,
} from '~/utils/zoom';
import MultiClipProperties from '~/components/properties/MultiClipProperties.vue';
import { useClipBatchActions } from '~/composables/timeline/useClipBatchActions';
import { useMediaStore } from '~/stores/media.store';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';

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
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import MobileTrimToolbar from './MobileTrimToolbar.vue';
import MobileTimelineSettingsDrawer from './MobileTimelineSettingsDrawer.vue';
import { useTeleportTarget } from '~/composables/ui/useTeleportTarget';

const { target: teleportTarget } = useTeleportTarget();

const { t } = useI18n();
const toast = useToast();

const timelineStore = useTimelineStore();
const focusStore = useFocusStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const mediaStore = useMediaStore();
const clipboardStore = useAppClipboard();

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
const isMultiSelectionDrawerOpen = ref(false);
const isAddContentDrawerOpen = ref(false);
const isTrimDrawerOpen = ref(false);
const isVirtualClipPresetDrawerOpen = ref(false);
const isSettingsDrawerOpen = ref(false);
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

const selectedClips = computed(() => {
  const items = timelineStore.selectedItemIds.flatMap((itemId) => {
    const track = tracks.value.find((t) => t.items.some((it) => it.id === itemId));
    // Only include clips, not gaps — gaps are handled via selectedGap
    const item = track?.items.find((it) => it.id === itemId);
    if (!item || item.kind !== 'clip') return [];
    return [{ trackId: track?.id ?? '', itemId }];
  });
  return items.length > 0 ? items : null;
});

const isMultiSelectionMode = computed(() => Boolean(selectedClips.value?.length));

function syncSelectionStoreFromItemIds() {
  const selectedIdSet = new Set(timelineStore.selectedItemIds);
  const items = tracks.value.flatMap((track) =>
    track.items
      .filter((item) => item.kind === 'clip' && selectedIdSet.has(item.id))
      .map((item) => ({ trackId: track.id, itemId: item.id, kind: 'clip' as const })),
  );

  if (items.length === 0) {
    selectionStore.clearSelection();
    return;
  }

  selectionStore.selectTimelineItems(items);
}

const {
  handleDelete,
  toggleDisabled,
  toggleMuted,
  allDisabled,
  allMuted,
  allLocked,
  allSoloed,
  toggleLocked,
  toggleSolo,
  hasAudioOrVideoWithAudio,
  hasVideoOrImage,
} = useClipBatchActions(
  computed(() => selectedClips.value ?? []),
  {
    timelineDoc: computed(() => timelineStore.timelineDoc),
    mediaMetadata: computed(() => mediaStore.mediaMetadata),
    batchApplyTimeline: (cmds) => timelineStore.batchApplyTimeline(cmds),
    clearSelection: () => timelineStore.clearSelection(),
  },
);

function handleCopyClips() {
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'copy',
    items: timelineStore.copySelectedClips().map((item) => ({
      sourceTrackId: item.sourceTrackId,
      clip: item.clip,
    })),
  });
}

function handleCutClips() {
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'cut',
    items: timelineStore.cutSelectedClips().map((item) => ({
      sourceTrackId: item.sourceTrackId,
      clip: item.clip,
    })),
  });
}

function toggleMobileClipSelection(itemId: string) {
  timelineStore.toggleSelection(itemId, { multi: true });
  timelineStore.selectTrack(null);
  timelineStore.selectTransition(null);
  syncSelectionStoreFromItemIds();

  const count = timelineStore.selectedItemIds.length;
  if (count === 0) {
    closeAllDrawers();
    return;
  }

  // Once in multi-selection mode, we stay there unless we clear selection
  if (isMultiSelectionDrawerOpen.value || isLongPress.value || count > 1) {
    isClipPropertiesDrawerOpen.value = false;
    isMultiSelectionDrawerOpen.value = true;
  } else {
    isClipPropertiesDrawerOpen.value = true;
    isMultiSelectionDrawerOpen.value = false;
  }
}

function enterMobileMultiSelection(itemId: string) {
  timelineStore.selectTrack(null);
  timelineStore.selectTransition(null);

  const isSelected = timelineStore.selectedItemIds.includes(itemId);

  if (!isSelected) {
    timelineStore.clearSelection();
    toggleMobileClipSelection(itemId);
  } else {
    // If already selected, just make sure we go to multi-selection mode
    isClipPropertiesDrawerOpen.value = false;
    isMultiSelectionDrawerOpen.value = true;
  }
}

function closeAllDrawers() {
  isTrackPropertiesDrawerOpen.value = false;
  isClipPropertiesDrawerOpen.value = false;
  isMarkerPropertiesDrawerOpen.value = false;
  isSelectionRangeDrawerOpen.value = false;
  isTransitionDrawerOpen.value = false;
  isGapPropertiesDrawerOpen.value = false;
  isMultiSelectionDrawerOpen.value = false;
  isTrimDrawerOpen.value = false;
  isSettingsDrawerOpen.value = false;
  drawerActiveSnapPoint.value = null;
}

// Unified selection watcher — opens the correct drawer based on what is selected.
// Replaces separate per-entity watchers to avoid drawer-flicker when switching between
// different entity types (e.g. track → clip, gap → clip, etc.).
watch(
  () => ({
    trackId: timelineStore.selectedTrackId,
    itemIds: timelineStore.selectedItemIds,
    entity: selectionStore.selectedEntity,
    transition: timelineStore.selectedTransition,
    markerId: selectedMarkerId.value,
    gap: selectedGap.value,
  }),
  (state) => {
    const { trackId, itemIds, entity, transition, markerId, gap } = state;

    if (isLongPress.value) return;

    // Prioritize: long-press multi-select already handled via enterMobileMultiSelection
    if (isMultiSelectionDrawerOpen.value && itemIds.length > 0) return;

    // Transition selected
    if (transition) {
      closeAllDrawers();
      isTransitionDrawerOpen.value = true;
      return;
    }

    // Timeline Properties selected
    if (entity?.kind === 'timeline-properties' && entity.source === 'timeline') {
      closeAllDrawers();
      isSettingsDrawerOpen.value = true;
      return;
    }

    // Marker selected
    if (markerId) {
      closeAllDrawers();
      isMarkerPropertiesDrawerOpen.value = true;
      return;
    }

    // Selection range
    if (entity?.source === 'timeline' && entity.kind === 'selection-range') {
      closeAllDrawers();
      isSelectionRangeDrawerOpen.value = true;
      return;
    }

    // Gap selected — use the selectedGap computed to avoid TS narrowing issues
    if (gap) {
      closeAllDrawers();
      isGapPropertiesDrawerOpen.value = true;
      return;
    }

    // Clip(s) selected: only if no gap is active
    if (itemIds.length > 0 && !gap) {
      closeAllDrawers();
      if (itemIds.length > 1) {
        isMultiSelectionDrawerOpen.value = true;
      } else {
        isClipPropertiesDrawerOpen.value = true;
      }
      return;
    }

    // Track selected (and no clips/gaps)
    if (trackId && itemIds.length === 0 && !gap) {
      closeAllDrawers();
      isTrackPropertiesDrawerOpen.value = true;
      return;
    }

    // Nothing selected — close all
    if (!trackId && itemIds.length === 0 && !entity && !transition && !markerId) {
      closeAllDrawers();
    }
  },
  { immediate: true, deep: false },
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
  selectionStore.clearSelection();
}

function onClipTrimDrawerClose() {
  isTrimDrawerOpen.value = false;
  timelineStore.clearSelection();
  selectionStore.clearSelection();
}

function onMultiSelectionDrawerClose() {
  isMultiSelectionDrawerOpen.value = false;
  drawerActiveSnapPoint.value = null;
  isLongPress.value = false;
  timelineStore.clearSelection();
  selectionStore.clearSelection();
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
  selectionStore.clearSelection();
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
  onGlobalPointerMove,
  onGlobalPointerUp,
  scheduleDragReapply,
} = useTimelineInteraction(scrollEl, tracks);

// --- Edge auto-scroll during clip drag ---

const EDGE_ZONE_PX = 60;
const MAX_SCROLL_SPEED = 14;

let edgeScrollRafId = 0;
let edgeScrollDx = 0;
let edgeScrollDy = 0;

function stopEdgeScroll() {
  if (edgeScrollRafId) {
    cancelAnimationFrame(edgeScrollRafId);
    edgeScrollRafId = 0;
  }
  edgeScrollDx = 0;
  edgeScrollDy = 0;
}

function edgeScrollStep() {
  const el = scrollEl.value;
  if (!el || !draggingMode.value) {
    edgeScrollRafId = 0;
    return;
  }
  el.scrollLeft += edgeScrollDx;
  el.scrollTop += edgeScrollDy;
  scheduleDragReapply();
  edgeScrollRafId = requestAnimationFrame(edgeScrollStep);
}

function updateEdgeScroll(e: PointerEvent) {
  const el = scrollEl.value;
  if (!el || !draggingMode.value) {
    stopEdgeScroll();
    return;
  }

  const rect = el.getBoundingClientRect();
  let dx = 0;
  let dy = 0;

  const distLeft = e.clientX - rect.left;
  const distRight = rect.right - e.clientX;
  if (distLeft >= 0 && distLeft < EDGE_ZONE_PX) {
    dx = -Math.round(MAX_SCROLL_SPEED * (1 - distLeft / EDGE_ZONE_PX));
  } else if (distRight >= 0 && distRight < EDGE_ZONE_PX) {
    dx = Math.round(MAX_SCROLL_SPEED * (1 - distRight / EDGE_ZONE_PX));
  }

  const distTop = e.clientY - rect.top;
  const distBottom = rect.bottom - e.clientY;
  if (distTop >= 0 && distTop < EDGE_ZONE_PX) {
    dy = -Math.round(MAX_SCROLL_SPEED * (1 - distTop / EDGE_ZONE_PX));
  } else if (distBottom >= 0 && distBottom < EDGE_ZONE_PX) {
    dy = Math.round(MAX_SCROLL_SPEED * (1 - distBottom / EDGE_ZONE_PX));
  }

  if (dx !== 0 || dy !== 0) {
    edgeScrollDx = dx;
    edgeScrollDy = dy;
    if (!edgeScrollRafId) edgeScrollRafId = requestAnimationFrame(edgeScrollStep);
  } else {
    stopEdgeScroll();
  }
}

function onMobilePointerMove(e: PointerEvent) {
  onGlobalPointerMove(e);
  updateEdgeScroll(e);
}

function onMobilePointerUp(e: PointerEvent) {
  stopEdgeScroll();
  onGlobalPointerUp(e);
}

watch(
  () => draggingMode.value,
  (val) => {
    if (!val) stopEdgeScroll();
  },
);

onBeforeUnmount(stopEdgeScroll);

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

// Handles trackpad pinch and Chrome DevTools Shift+drag (both fire wheel with ctrlKey=true).
// deltaY < 0 = pinch out = zoom in; deltaY > 0 = pinch in = zoom out.
function onScrollElWheel(e: WheelEvent) {
  if (!e.ctrlKey) return;
  e.preventDefault();

  const el = scrollEl.value;
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const anchorViewportX = e.clientX - rect.left;
  const anchorTimeUs = pxToTimeUs(el.scrollLeft + anchorViewportX, timelineStore.timelineZoom);

  const step = e.deltaY > 0 ? -5 : 5;
  const nextZoom = Math.min(
    MAX_TIMELINE_ZOOM_POSITION,
    Math.max(MIN_TIMELINE_ZOOM_POSITION, timelineStore.timelineZoom + step),
  );

  applyZoomWithAnchor({ nextZoom, anchor: { anchorTimeUs, anchorViewportX } });
}

onMounted(() => {
  scrollEl.value?.addEventListener('wheel', onScrollElWheel, { passive: false });
});

onBeforeUnmount(() => {
  scrollEl.value?.removeEventListener('wheel', onScrollElWheel);
});

const clickStartX = ref(0);
const clickStartY = ref(0);

function onTimelinePointerDownCapture(e: PointerEvent) {
  if (e.button === 0) {
    clickStartX.value = e.clientX;
    clickStartY.value = e.clientY;
    isLongPress.value = false;
  }
}

function onTimelineClick(e: MouseEvent) {
  if (e.button !== 0) return;
  const dx = Math.abs(e.clientX - clickStartX.value);
  const dy = Math.abs(e.clientY - clickStartY.value);
  if (dx > 8 || dy > 8 || isLongPress.value) {
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

  closeAllDrawers();
  timelineStore.clearSelection();
  timelineStore.selectTrack(null);
  timelineStore.selectTransition(null);
  selectionStore.clearSelection();

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
    @pointermove="onMobilePointerMove"
    @pointerup="onMobilePointerUp"
    @pointercancel="onMobilePointerUp"
  >
    <MobileTimelineToolbar />

    <MobileClipPropertiesDrawer
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isClipPropertiesDrawerOpen"
      @close="onClipPropertiesDrawerClose"
      @open-trim-drawer="isTrimDrawerOpen = true; isClipPropertiesDrawerOpen = false"
    />

    <MobileTrimToolbar
      v-if="isTrimDrawerOpen"
      @back="isTrimDrawerOpen = false; isClipPropertiesDrawerOpen = true"
      @close="onClipTrimDrawerClose"
    />

    <!-- Multi Selection Drawer -->
    <MobileTimelineDrawer
      v-model:open="isMultiSelectionDrawerOpen"
      v-model:active-snap-point="drawerActiveSnapPoint"
      force-landscape-direction="bottom"
      @update:open="(value) => !value && onMultiSelectionDrawerClose()"
    >
      <div v-if="selectedClips" class="px-4 pb-8">
        <div class="mb-4 pt-1">
          <MobileDrawerToolbar class="-mx-4 border-b border-ui-border mb-2">
            <MobileDrawerToolbarButton
              icon="i-heroicons-trash"
              :label="t('common.delete', 'Delete')"
              @click="handleDelete"
            />
            <MobileDrawerToolbarButton
              icon="i-heroicons-document-duplicate"
              :label="t('common.copy', 'Copy')"
              @click="handleCopyClips"
            />
            <MobileDrawerToolbarButton
              icon="i-heroicons-scissors"
              :label="t('common.cut', 'Cut')"
              @click="handleCutClips"
            />
            <MobileDrawerToolbarButton
              v-if="hasVideoOrImage"
              :icon="allDisabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
              :label="
                allDisabled
                  ? t('fastcat.timeline.enable', 'Enable')
                  : t('fastcat.timeline.disable', 'Disable')
              "
              @click="toggleDisabled"
            />
            <MobileDrawerToolbarButton
              v-if="hasAudioOrVideoWithAudio"
              :icon="allMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark'"
              :label="
                allMuted ? t('fastcat.timeline.unmute', 'Unmute') : t('fastcat.timeline.mute', 'Mute')
              "
              @click="toggleMuted"
            />
            <MobileDrawerToolbarButton
              :icon="allSoloed ? 'i-heroicons-star-solid' : 'i-heroicons-star'"
              :label="
                allSoloed
                  ? t('fastcat.timeline.unsolo', 'Unsolo')
                  : t('fastcat.timeline.solo', 'Solo')
              "
              @click="toggleSolo"
            />
            <MobileDrawerToolbarButton
              :icon="allLocked ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open'"
              :label="
                allLocked
                  ? t('fastcat.timeline.unlock', 'Unlock')
                  : t('fastcat.timeline.lock', 'Lock')
              "
              @click="toggleLocked"
            />
            <div class="w-px h-6 bg-ui-border mx-1 shrink-0" />
            <MobileDrawerToolbarButton
              icon="i-heroicons-x-mark"
              :label="t('common.clearSelection', 'Clear')"
              @click="onMultiSelectionDrawerClose"
            />
          </MobileDrawerToolbar>
        </div>

        <MultiClipProperties :items="selectedClips" />
      </div>
    </MobileTimelineDrawer>

    <!-- Track Properties Drawer -->
    <MobileTrackPropertiesDrawer
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isTrackPropertiesDrawerOpen"
      @close="
        () => {
          onUpdateDrawerOpen(false);
          selectionStore.clearSelection();
        }
      "
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

    <!-- Timeline Settings Drawer -->
    <MobileTimelineSettingsDrawer
      :is-open="isSettingsDrawerOpen"
      @close="
        () => {
          isSettingsDrawerOpen = false;
          selectionStore.clearSelection();
        }
      "
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
        class="absolute top-0 left-0 right-0 h-12 z-40 bg-ui-bg/95 border-b border-ui-border select-none touch-none backdrop-blur shadow-sm overflow-hidden"
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
        style="top: 48px"
        :scroll-el="scrollEl"
      />

      <!-- Main scrollable tracks area: starts below ruler (top-8 = 32px) -->
      <div
        ref="scrollEl"
        class="absolute top-12 left-0 right-0 bottom-0 overflow-auto overscroll-none no-scrollbar"
        :class="draggingMode ? 'touch-none' : 'touch-pan-x touch-pan-y'"
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
                  if (isLongPress) {
                    isLongPress = false;
                    return;
                  }

                  drawerActiveSnapPoint = null;

                  const entity = selectionStore.selectedEntity;
                  const isGapSelected =
                    entity?.source === 'timeline' && entity.kind === 'gap' && entity.itemId === id;
                  const isTrackSelected = entity?.source === 'timeline' && entity.kind === 'track';

                  if (isMultiSelectionMode && !isGapSelected && !isTrackSelected) {
                    toggleMobileClipSelection(id);
                    return;
                  }
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
                drawerActiveSnapPoint = '116px';
                enterMobileMultiSelection(id);
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
    <Teleport :to="teleportTarget">
      <div
        v-if="!isTrimDrawerOpen"
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
