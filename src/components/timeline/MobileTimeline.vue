<script setup lang="ts">
import { computed, ref } from 'vue';
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
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelineInteraction } from '~/composables/timeline/useTimelineInteraction';
import { resolvePlayheadClickTimeUs } from '~/composables/timeline/timelineInteractionUtils';
import { timeUsToPx, pxToTimeUs } from '~/utils/timeline/geometry';
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
import MobileSelectionRangePropertiesDrawer from './MobileSelectionRangePropertiesDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import MobileTrimToolbar from './MobileTrimToolbar.vue';
import MobileTimelineSettingsDrawer from './MobileTimelineSettingsDrawer.vue';
import MobileTrackMixerDrawer from './MobileTrackMixerDrawer.vue';
import MobileHistoryDrawer from './MobileHistoryDrawer.vue';
import MobileMarkersDrawer from './MobileMarkersDrawer.vue';
import { useTeleportTarget } from '~/composables/ui/useTeleportTarget';

// Composables
import { useMobileTimelineDrawers } from '~/composables/timeline/useMobileTimelineDrawers';
import { useMobileTimelineSelection } from '~/composables/timeline/useMobileTimelineSelection';
import { useMobileTimelineZoom } from '~/composables/timeline/useMobileTimelineZoom';
import { useMobileTimelineEdgeScroll } from '~/composables/timeline/useMobileTimelineEdgeScroll';
import { useScrollRectCache } from '~/composables/timeline/useScrollRectCache';

const { target: teleportTarget } = useTeleportTarget();

const { t } = useI18n();
const toast = useToast();

const timelineStore = useTimelineStore();
const timelineSettingsStore = useTimelineSettingsStore();
const focusStore = useFocusStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const workspaceStore = useWorkspaceStore();
const mediaStore = useMediaStore();
const clipboardStore = useAppClipboard();

const { currentView } = storeToRefs(projectStore);

const canEditClipContent = computed(
  () =>
    currentView.value === 'cut' || currentView.value === 'files' || currentView.value === 'sound',
);

const tracks = computed(
  () => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [],
);

const {
  isTrackPropertiesDrawerOpen,
  isClipPropertiesDrawerOpen,
  isMarkerPropertiesDrawerOpen,
  isSelectionRangeDrawerOpen,
  isTransitionDrawerOpen,
  isMultiSelectionDrawerOpen,
  isAddContentDrawerOpen,
  isTrimDrawerOpen,
  isVirtualClipPresetDrawerOpen,
  isSettingsDrawerOpen,
  isTrackMixerDrawerOpen,
  isHistoryDrawerOpen,
  isMarkersDrawerOpen,
  virtualClipPresetType,
  drawerActiveSnapPoint,
  isLongPress,
  suppressDrawerSelectionClearTemporarily,
  closeAllDrawers,
  onUpdateDrawerOpen,
  onClipPropertiesDrawerClose,
  onClipTrimDrawerClose,
  onMultiSelectionDrawerClose,
  onMarkerPropertiesDrawerClose,
  onSelectionRangeDrawerClose,
  onTransitionDrawerClose,
  onOpenVirtualClipPreset,
} = useMobileTimelineDrawers();

const {
  selectedMarkerId,
  selectedTransitionContext,
  selectedGap,
  selectedClipContext,
  selectedClips,
  isMultiSelectionMode,
  toggleMobileClipSelection,
  enterMobileMultiSelection,
} = useMobileTimelineSelection(
  tracks,
  isClipPropertiesDrawerOpen,
  isMultiSelectionDrawerOpen,
  isLongPress,
  closeAllDrawers,
);

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

const scrollEl = ref<HTMLElement | null>(null);
const lastPointerType = ref('');
const clickStartX = ref(0);
const clickStartY = ref(0);

const trackHeights = computed(() => {
  const heights: Record<string, number> = {};
  for (const t of tracks.value) {
    heights[t.id] = t.kind === 'video' ? 64 : 48;
  }
  return heights;
});

const playheadPx = computed(() =>
  Math.round(timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom)),
);

const { getCachedScrollRect, clearScrollRectCache } = useScrollRectCache();

const {
  draggingMode,
  draggingItemId,
  movePreview,
  trimPreview,
  onTimeRulerPointerDown,
  selectItem,
  startMoveItem,
  startTrimItem,
  onGlobalPointerMove,
  onGlobalPointerUp,
  scheduleDragReapply,
} = useTimelineInteraction(scrollEl, tracks, ref(true));

const { updateEdgeScroll, stopEdgeScroll } = useMobileTimelineEdgeScroll(
  scrollEl,
  draggingMode,
  scheduleDragReapply,
  getCachedScrollRect,
);

const { onTouchStart, onTouchMove } = useMobileTimelineZoom(scrollEl, getCachedScrollRect);

function handleMobileTimelineItemSelect(ev: PointerEvent, id: string) {
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

    suppressDrawerSelectionClearTemporarily(() => {
      selectItem(ev, id);
    });
    return;
  }

  selectItem(ev, id);
}

function handleMobileTimelineItemLongPress(id: string) {
  suppressDrawerSelectionClearTemporarily(() => {
    isLongPress.value = true;
    drawerActiveSnapPoint.value = '108px';
    enterMobileMultiSelection(id);
  });
}

function onMobilePointerMove(e: PointerEvent) {
  onGlobalPointerMove(e);
  updateEdgeScroll(e);
}

function onMobilePointerUp(e: PointerEvent) {
  clearScrollRectCache();
  stopEdgeScroll();
  onGlobalPointerUp(e);

  setTimeout(() => {
    isLongPress.value = false;
  }, 100);
}

function onMobilePointerCancel(e: PointerEvent) {
  clearScrollRectCache();
  stopEdgeScroll();
  if (draggingMode.value) return;
  onGlobalPointerUp(e);
}

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

function createSyntheticTouchPointerEvent(position: {
  clientX: number;
  clientY: number;
  currentTarget?: EventTarget | null;
}): PointerEvent {
  return {
    button: 0,
    buttons: 1,
    clientX: position.clientX,
    clientY: position.clientY,
    pointerId: 1,
    pointerType: 'touch',
    currentTarget: position.currentTarget ?? scrollEl.value,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as PointerEvent;
}

function onTrimToolbarStart(payload: {
  trackId: string;
  itemId: string;
  edge: 'start' | 'end';
  clientX: number;
  clientY: number;
}) {
  const clipContext = selectedClipContext.value;
  if (!clipContext) return;

  startTrimItem(
    createSyntheticTouchPointerEvent({
      clientX: payload.clientX,
      clientY: payload.clientY,
    }),
    {
      trackId: payload.trackId,
      itemId: payload.itemId,
      edge: payload.edge,
      startUs: clipContext.clip.timelineRange.startUs,
    },
  );
}

function onTrimToolbarMove(payload: { clientX: number; clientY: number }) {
  if (!draggingMode.value) return;
  onGlobalPointerMove(
    createSyntheticTouchPointerEvent({
      clientX: payload.clientX,
      clientY: payload.clientY,
    }),
  );
}

function onTrimToolbarEnd(payload: { clientX: number; clientY: number }) {
  if (!draggingMode.value) return;
  onGlobalPointerUp(
    createSyntheticTouchPointerEvent({
      clientX: payload.clientX,
      clientY: payload.clientY,
    }),
  );
}

function onTimelinePointerDownCapture(e: PointerEvent) {
  if (e.button === 0) {
    clickStartX.value = e.clientX;
    clickStartY.value = e.clientY;
    isLongPress.value = false;
    lastPointerType.value = e.pointerType;
    suppressDrawerSelectionClearTemporarily();
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
  const scrollerRectY = getCachedScrollRect(el);
  const y = e.clientY - scrollerRectY.top + el.scrollTop;
  if (y > tracksHeight + 32) {
    timelineStore.selectTimelineProperties();
    return;
  }

  const scrollX = el.scrollLeft;
  const x = e.clientX - scrollerRectY.left + scrollX;
  const rawTimeUs = pxToTimeUs(x, timelineStore.timelineZoom);
  const timelineEndUs = Number.isFinite(timelineStore.duration)
    ? Math.max(0, Math.round(timelineStore.duration))
    : null;
  const timeUs = resolvePlayheadClickTimeUs({
    rawTimeUs,
    zoom: timelineStore.timelineZoom,
    snapThresholdPx: workspaceStore.userSettings.timeline.snapThresholdPx,
    toolbarSnapMode: timelineSettingsStore.toolbarSnapMode,
    snapping: workspaceStore.userSettings.timeline.snapping,
    tracks: timelineStore.timelineDoc?.tracks ?? [],
    markers: timelineStore.markers,
    durationUs: timelineEndUs,
    selectionRangeUs: timelineStore.selectionRange,
  });

  timelineStore.setCurrentTimeUs(timeUs);
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
      title: t('common.error'),
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
    @pointercancel="onMobilePointerCancel"
  >
    <MobileTimelineToolbar
      @open-track-mixer="isTrackMixerDrawerOpen = true"
      @open-history="isHistoryDrawerOpen = true"
      @open-markers="isMarkersDrawerOpen = true"
    />

    <MobileClipPropertiesDrawer
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isClipPropertiesDrawerOpen"
      @close="onClipPropertiesDrawerClose"
      @open-trim-drawer="
        isTrimDrawerOpen = true;
        isClipPropertiesDrawerOpen = false;
      "
    />

    <MobileTrimToolbar
      v-if="isTrimDrawerOpen"
      :trim-preview="trimPreview"
      @back="
        isTrimDrawerOpen = false;
        isClipPropertiesDrawerOpen = true;
      "
      @close="onClipTrimDrawerClose"
      @trim-start="onTrimToolbarStart"
      @trim-move="onTrimToolbarMove"
      @trim-end="onTrimToolbarEnd"
    />

    <!-- Multi Selection Drawer -->
    <MobileTimelineDrawer
      v-model:open="isMultiSelectionDrawerOpen"
      v-model:active-snap-point="drawerActiveSnapPoint"
      with-toolbar-snap
      @update:open="(value) => !value && onMultiSelectionDrawerClose()"
    >
      <template #toolbar>
        <MobileDrawerToolbar class="border-b border-ui-border">
          <MobileDrawerToolbarButton
            icon="i-heroicons-trash"
            :label="t('common.delete')"
            @click="handleDelete"
          />
          <MobileDrawerToolbarButton
            icon="i-heroicons-document-duplicate"
            :label="t('common.copy')"
            @click="handleCopyClips"
          />
          <MobileDrawerToolbarButton
            icon="i-heroicons-scissors"
            :label="t('common.cut')"
            @click="handleCutClips"
          />
          <MobileDrawerToolbarButton
            v-if="hasVideoOrImage"
            :icon="allDisabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
            :label="allDisabled ? t('fastcat.timeline.enable') : t('fastcat.timeline.disable')"
            @click="toggleDisabled"
          />
          <MobileDrawerToolbarButton
            v-if="hasAudioOrVideoWithAudio"
            :icon="allMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark'"
            :label="allMuted ? t('fastcat.timeline.unmute') : t('fastcat.timeline.mute')"
            @click="toggleMuted"
          />
          <MobileDrawerToolbarButton
            :icon="allSoloed ? 'i-heroicons-musical-note-solid' : 'i-heroicons-musical-note'"
            :label="allSoloed ? t('fastcat.timeline.unsolo') : t('fastcat.timeline.solo')"
            @click="toggleSolo"
          />
          <MobileDrawerToolbarButton
            :icon="allLocked ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open'"
            :label="allLocked ? t('fastcat.timeline.unlock') : t('fastcat.timeline.lock')"
            @click="toggleLocked"
          />
          <div class="w-px h-6 bg-ui-border mx-1 shrink-0" />
          <MobileDrawerToolbarButton
            icon="i-heroicons-x-mark"
            :label="t('common.clearSelection')"
            @click="onMultiSelectionDrawerClose"
          />
        </MobileDrawerToolbar>
      </template>

      <div v-if="selectedClips" class="px-4 pb-8 pt-4">
        <MultiClipProperties :items="selectedClips" />
      </div>
    </MobileTimelineDrawer>

    <!-- Track Properties Drawer -->
    <MobileTrackPropertiesDrawer
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isTrackPropertiesDrawerOpen"
      :track-id="selectedGap?.trackId ?? null"
      :gap-item-id="selectedGap?.itemId ?? null"
      @close="
        () => {
          onUpdateDrawerOpen(false);
          if (selectionStore.selectedEntity?.kind === 'gap') {
            timelineStore.clearSelection();
            selectionStore.clearSelection();
          } else if (selectionStore.selectedEntity?.kind === 'track') {
            selectionStore.clearSelection();
          }
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

    <!-- Timeline Settings Drawer -->
    <MobileTimelineSettingsDrawer
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isSettingsDrawerOpen"
      @close="
        () => {
          isSettingsDrawerOpen = false;
          if (selectionStore.selectedEntity?.kind === 'timeline-properties') {
            selectionStore.clearSelection();
          }
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

    <MobileTrackMixerDrawer
      :is-open="isTrackMixerDrawerOpen"
      @close="isTrackMixerDrawerOpen = false"
    />

    <MobileHistoryDrawer :is-open="isHistoryDrawerOpen" @close="isHistoryDrawerOpen = false" />

    <MobileMarkersDrawer :is-open="isMarkersDrawerOpen" @close="isMarkersDrawerOpen = false" />

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
            :trim-preview="trimPreview"
            is-mobile
            @select-item="handleMobileTimelineItemSelect"
            @start-move-item="onStartMoveItem"
            @start-trim-item="onStartTrimItem"
            @clip-action="onClipAction"
            @long-press-item="handleMobileTimelineItemLongPress"
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
          :aria-label="t('fastcat.timeline.addContent')"
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
