<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useElementSize, useWindowSize } from '@vueuse/core';
import {
  MOBILE_CLICK_MOVE_THRESHOLD_PX,
  MOBILE_LONG_PRESS_RESET_DELAY_MS,
} from '~/utils/mobile/timeline';
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
import { resolvePlayheadClickTimeUs } from '~/composables/timeline/timeline-drag-domain';
import {
  computeTimelineScrollLeftForPlayhead,
  timeUsToPx,
  pxToTimeUs,
} from '~/utils/timeline/geometry';
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
import MobileClipDeleteDrawer from './MobileClipDeleteDrawer.vue';
import MobileTimelineSettingsDrawer from './MobileTimelineSettingsDrawer.vue';
import MobileTrackMixerDrawer from './MobileTrackMixerDrawer.vue';
import MobileTrackManagerDrawer from './MobileTrackManagerDrawer.vue';
import MobileHistoryDrawer from './MobileHistoryDrawer.vue';
import MobileMarkersDrawer from './MobileMarkersDrawer.vue';
import { useTeleportTarget } from '~/composables/ui/useTeleportTarget';

// Composables
import { useMobileTimelineDrawers } from '~/composables/timeline/useMobileTimelineDrawers';
import { useMobileTimelineSelection } from '~/composables/timeline/useMobileTimelineSelection';
import { useMobileTimelineZoom } from '~/composables/timeline/useMobileTimelineZoom';
import { useMobileTimelineEdgeScroll } from '~/composables/timeline/useMobileTimelineEdgeScroll';
import { useScrollRectCache } from '~/composables/timeline/useScrollRectCache';
import { useTimelineClipActions } from '~/composables/timeline/useTimelineClipActions';

const TIMELINE_RULER_HEIGHT_PX = 32;

const { target: teleportTarget } = useTeleportTarget();

const { width: windowWidth, height: windowHeight } = useWindowSize();
/** Landscape drawers dock to the side, so their toolbars render as a vertical rail. */
const drawerToolbarOrientation = computed(() =>
  windowWidth.value > windowHeight.value ? 'vertical' : 'horizontal',
);

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

const editableClipContentViews = new Set(['cut', 'files', 'sound']);
const canEditClipContent = computed(() => editableClipContentViews.has(currentView.value));

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
  isDeleteDrawerOpen,
  isVirtualClipPresetDrawerOpen,
  isSettingsDrawerOpen,
  isTrackMixerDrawerOpen,
  isHistoryDrawerOpen,
  isMarkersDrawerOpen,
  isTrackManagerDrawerOpen,
  virtualClipPresetType,
  drawerActiveSnapPoint,
  isLongPress,
  suppressDrawerSelectionClearTemporarily,
  closeAllDrawers,
  openTrackMixerDrawer,
  openTrackManagerDrawer,
  openHistoryDrawer,
  openMarkersDrawer,
  onUpdateDrawerOpen,
  onClipPropertiesDrawerClose,
  onClipTrimDrawerClose,
  onClipDeleteDrawerClose,
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
  toggleLocked,
  hasAudioOrVideoWithAudio,
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

function handleBladeClips() {
  void timelineStore.splitAllClipsAtPlayhead();
}

function handleAddContent(trackId: string) {
  addContentTargetTrackId.value = trackId;
  isAddContentDrawerOpen.value = true;
}

const scrollEl = ref<HTMLElement | null>(null);

// Reactive viewport width of the scroll container. Needed so clip thumbnails
// know the visible window — without it the thumbnail strip computes a zero-width
// range and renders nothing on mobile.
const { width: scrollViewportWidth } = useElementSize(scrollEl);

function scrollPlayheadIntoView() {
  const el = scrollEl.value;
  if (!el) return;

  const nextScrollLeft = computeTimelineScrollLeftForPlayhead({
    playheadPx: playheadPx.value,
    scrollLeft: el.scrollLeft,
    viewportWidth: el.clientWidth,
    maxScrollLeft: el.scrollWidth - el.clientWidth,
  });

  if (nextScrollLeft === null) {
    timelineStore.timelineScrollLeftPx = el.scrollLeft;
    return;
  }

  el.scrollLeft = nextScrollLeft;
  timelineStore.timelineScrollLeftPx = el.scrollLeft;
}

// Keep the store's scroll position in sync with the mobile scrollEl so ruler/grid/playhead align.
watch(
  scrollEl,
  (el, _oldEl, onCleanup) => {
    if (!el) return;
    const onScroll = () => {
      timelineStore.timelineScrollLeftPx = el.scrollLeft;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    nextTick(scrollPlayheadIntoView);
    onCleanup(() => el.removeEventListener('scroll', onScroll));
  },
  { immediate: true },
);

watch(
  () => timelineStore.scrollToPlayheadRequest,
  () => {
    nextTick(scrollPlayheadIntoView);
  },
);

const lastPointerType = ref('');
const clickStartX = ref(0);
const clickStartY = ref(0);
const addContentTargetTrackId = ref<string | undefined>(undefined);

const isAnyDrawerOpen = computed(
  () =>
    isTrackPropertiesDrawerOpen.value ||
    isClipPropertiesDrawerOpen.value ||
    isMarkerPropertiesDrawerOpen.value ||
    isSelectionRangeDrawerOpen.value ||
    isTransitionDrawerOpen.value ||
    isMultiSelectionDrawerOpen.value ||
    isTrimDrawerOpen.value ||
    isDeleteDrawerOpen.value ||
    isAddContentDrawerOpen.value ||
    isVirtualClipPresetDrawerOpen.value,
);

const trackHeights = computed(() => {
  const heights: Record<string, number> = {};
  const enlarged = timelineStore.mobileTrackHeightsEnlarged;
  for (const t of tracks.value) {
    const multiplier = enlarged[t.id] ? 3 : 1;
    heights[t.id] = (t.kind === 'video' ? 64 : 48) * multiplier;
  }
  return heights;
});

function toggleTrackHeightEnlarged(trackId: string) {
  const enlarged = { ...timelineStore.mobileTrackHeightsEnlarged };
  if (enlarged[trackId]) {
    Reflect.deleteProperty(enlarged, trackId);
  } else {
    enlarged[trackId] = true;
  }
  timelineStore.mobileTrackHeightsEnlarged = enlarged;
}

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
} = useTimelineInteraction(scrollEl, tracks);

const { applyClipAction } = useTimelineClipActions();

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

    selectItem(ev, id);
    return;
  }

  selectItem(ev, id);
}

function handleMobileTimelineItemLongPress(id: string) {
  suppressDrawerSelectionClearTemporarily(() => {
    isLongPress.value = true;
    drawerActiveSnapPoint.value = null;
    enterMobileMultiSelection(id);
  });
}

// True while a trim is being driven by the fixed bottom trim toolbar. The
// toolbar emits its own synthetic pointer events to drive the trim, but the
// underlying real touch still bubbles pointer events up to the timeline root.
// We must ignore those here: the finger sits at the very bottom of the screen
// (on the toolbar), so feeding them to `updateEdgeScroll` would make the
// timeline continuously auto-scroll down while the user slides.
const isToolbarTrimActive = ref(false);

function onMobilePointerMove(e: PointerEvent) {
  if (isToolbarTrimActive.value) return;
  onGlobalPointerMove(e);
  updateEdgeScroll(e);
}

function onMobilePointerUp(e: PointerEvent) {
  clearScrollRectCache();
  stopEdgeScroll();
  onGlobalPointerUp(e);

  setTimeout(() => {
    isLongPress.value = false;
  }, MOBILE_LONG_PRESS_RESET_DELAY_MS);
}

function onMobilePointerCancel(e: PointerEvent) {
  clearScrollRectCache();
  stopEdgeScroll();

  // A long-press gesture on touch frequently ends with `pointercancel` (the
  // webview takes the gesture over) rather than `pointerup`. Reset the flag
  // here too — otherwise it stays stuck `true` and the next tap is swallowed
  // by the long-press guards, so additional clips can never be selected.
  setTimeout(() => {
    isLongPress.value = false;
  }, MOBILE_LONG_PRESS_RESET_DELAY_MS);

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
}): PointerEvent {
  return new PointerEvent('pointermove', {
    button: 0,
    buttons: 1,
    clientX: position.clientX,
    clientY: position.clientY,
    pointerId: 1,
    pointerType: 'touch',
    bubbles: false,
    cancelable: false,
  });
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

  isToolbarTrimActive.value = true;
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
  isToolbarTrimActive.value = false;
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
  if (target?.closest('[data-clip-id]')) return;
  if (target?.closest('[data-gap-id]')) return;
  if (target?.closest('[data-track-id]')) return;

  const el = scrollEl.value;
  if (!el) return;

  const tracksHeight = Object.values(trackHeights.value).reduce((a, b) => a + b, 0);
  const scrollerRectY = getCachedScrollRect(el);
  const y = e.clientY - scrollerRectY.top + el.scrollTop;
  if (y > tracksHeight + TIMELINE_RULER_HEIGHT_PX) {
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

const isCreateVersionModalOpen = ref(false);
const proposedVersionName = ref('');
const existingNamesInFolder = ref<string[]>([]);

async function handleCreateVersionFromPreview() {
  if (timelineStore.currentTimelinePath) {
    const parts = timelineStore.currentTimelinePath.split('/');
    parts.pop();
    const parentPath = parts.join('/');
    existingNamesInFolder.value = await projectStore.listEntryNames(parentPath);
  } else {
    existingNamesInFolder.value = [];
  }

  proposedVersionName.value = await timelineStore.getNextVersionName();
  isCreateVersionModalOpen.value = true;
}

function validateVersionName(newName: string): string | boolean | null {
  const trimmed = newName.trim();
  if (!trimmed) return false;
  const finalName = trimmed.toLowerCase().endsWith('.otio') ? trimmed : `${trimmed}.otio`;
  if (existingNamesInFolder.value.includes(finalName)) {
    return t('common.validation.exists', 'Имя уже существует');
  }
  return true;
}

async function handleConfirmCreateVersion(newName: string) {
  isCreateVersionModalOpen.value = false;
  if (timelineStore.previewBackupInfo) {
    await timelineStore.createVersionFromBackup(timelineStore.previewBackupInfo, newName);
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
    <UiEntityCreationModal
      v-model:open="isCreateVersionModalOpen"
      :title="t('fastcat.timeline.createVersion')"
      :confirm-label="t('common.confirm')"
      :default-value="proposedVersionName"
      select-without-extension
      :validate="validateVersionName"
      @confirm="handleConfirmCreateVersion"
    />
    <MobileTimelineToolbar
      @open-track-mixer="openTrackMixerDrawer"
      @open-track-manager="openTrackManagerDrawer"
      @open-history="openHistoryDrawer"
      @open-markers="openMarkersDrawer"
    />

    <!-- Backup Preview Banner (Mobile) -->
    <div
      v-if="timelineStore.previewMode"
      class="bg-amber-950/95 border-b border-amber-800/50 px-4 py-2.5 flex items-center justify-between text-xs text-amber-200 z-50 shrink-0"
    >
      <div class="flex items-center gap-1.5 min-w-0 flex-1">
        <UIcon name="i-heroicons-information-circle" class="w-4 h-4 text-amber-400 shrink-0" />
        <span class="truncate">{{
          t('videoEditor.timeline.backups.previewBannerMobile', {
            name: timelineStore.previewBackupInfo?.name,
          })
        }}</span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <UButton
          size="xs"
          color="amber"
          variant="outline"
          class="cursor-pointer"
          @click="timelineStore.exitPreviewAndReload"
        >
          {{ t('videoEditor.timeline.backups.actionsLabel.returnMobile') }}
        </UButton>
        <UButton
          size="xs"
          color="amber"
          variant="solid"
          class="cursor-pointer"
          @click="handleCreateVersionFromPreview"
        >
          {{ t('fastcat.timeline.createVersion') }}
        </UButton>
      </div>
    </div>

    <MobileClipPropertiesDrawer
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isClipPropertiesDrawerOpen"
      @close="onClipPropertiesDrawerClose"
      @open-delete-drawer="
        isDeleteDrawerOpen = true;
        isClipPropertiesDrawerOpen = false;
      "
      @open-trim-drawer="
        isTrimDrawerOpen = true;
        isClipPropertiesDrawerOpen = false;
      "
    />

    <MobileClipDeleteDrawer
      v-if="isDeleteDrawerOpen"
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isDeleteDrawerOpen"
      @back="
        isDeleteDrawerOpen = false;
        isClipPropertiesDrawerOpen = true;
      "
      @close="onClipDeleteDrawerClose"
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
        <MobileDrawerToolbar
          :orientation="drawerToolbarOrientation"
          :class="
            drawerToolbarOrientation === 'vertical'
              ? 'border-r border-ui-border'
              : 'border-b border-ui-border'
          "
        >
          <MobileDrawerToolbarButton icon="i-heroicons-trash" @click="handleDelete" />
          <MobileDrawerToolbarButton
            icon="i-heroicons-document-duplicate"
            @click="handleCopyClips"
          />
          <MobileDrawerToolbarButton icon="i-heroicons-scissors" @click="handleCutClips" />
          <MobileDrawerToolbarButton icon="i-lucide-lab-razor-blade" @click="handleBladeClips" />
          <MobileDrawerToolbarButton
            :icon="allDisabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
            @click="toggleDisabled"
          />
          <MobileDrawerToolbarButton
            v-if="hasAudioOrVideoWithAudio"
            :icon="allMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark'"
            @click="toggleMuted"
          />
          <MobileDrawerToolbarButton
            :icon="allLocked ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open'"
            @click="toggleLocked"
          />
          <div class="w-px h-6 bg-ui-border mx-1 shrink-0" />
          <MobileDrawerToolbarButton
            icon="i-heroicons-x-mark"
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
      :is-track-height-enlarged="
        Boolean(timelineStore.mobileTrackHeightsEnlarged[selectedGap?.trackId ?? ''])
      "
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
      @add-content="handleAddContent"
      @toggle-track-height="toggleTrackHeightEnlarged"
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
      :target-track-id="addContentTargetTrackId"
      @close="
        () => {
          isAddContentDrawerOpen = false;
          addContentTargetTrackId = undefined;
        }
      "
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

    <MobileTrackManagerDrawer
      :is-open="isTrackManagerDrawerOpen"
      @close="isTrackManagerDrawerOpen = false"
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
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @pointerdown.capture="onTimelinePointerDownCapture"
        @click="onTimelineClick"
      >
        <div class="relative min-w-max h-full">
          <TimelineTracks
            class="min-w-full"
            :tracks="tracks"
            :track-heights="trackHeights"
            :scroll-left="timelineStore.timelineScrollLeftPx"
            :viewport-width="scrollViewportWidth"
            :can-edit-clip-content="canEditClipContent"
            :dragging-mode="draggingMode"
            :dragging-item-id="draggingItemId"
            :move-preview="movePreview"
            :trim-preview="trimPreview"
            is-mobile
            :is-any-drawer-open="isAnyDrawerOpen"
            :is-multi-select-mode="isMultiSelectionMode"
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
      <div v-if="!isAnyDrawerOpen" class="fixed bottom-20 right-6 z-40 transition-all duration-300">
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
