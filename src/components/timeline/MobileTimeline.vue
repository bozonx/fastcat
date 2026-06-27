<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWindowSize } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import type { TimelineTrack } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useTimelineInteraction } from '~/composables/timeline/useTimelineInteraction';
import { timeUsToPx } from '~/utils/timeline/geometry';
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
import MobileSelectionRangePropertiesDrawer from './MobileSelectionRangePropertiesDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import MobileTrimToolbar from './MobileTrimToolbar.vue';
import MobileTransitionToolbar from './MobileTransitionToolbar.vue';
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
import { useTimelineEdgeScroll } from '~/composables/timeline/useTimelineEdgeScroll';
import { useScrollRectCache } from '~/composables/timeline/useScrollRectCache';
import {
  MOBILE_EDGE_SCROLL_ZONE_PX,
  MOBILE_EDGE_SCROLL_MAX_SPEED_PX,
} from '~/utils/mobile/timeline';
import { useTimelineClipActions } from '~/composables/timeline/useTimelineClipActions';
import { useMobileTimelineScroll } from '~/composables/timeline/useMobileTimelineScroll';
import { useMobileTimelineTrackHeights } from '~/composables/timeline/useMobileTimelineTrackHeights';
import { useMobileTimelineBatchActions } from '~/composables/timeline/useMobileTimelineBatchActions';
import { useMobileTimelineVersion } from '~/composables/timeline/useMobileTimelineVersion';
import { useMobileTimelineTrim } from '~/composables/timeline/useMobileTimelineTrim';
import { useMobileTimelineGestures } from '~/composables/timeline/useMobileTimelineGestures';

const { target: teleportTarget } = useTeleportTarget();

const { width: windowWidth, height: windowHeight } = useWindowSize();
/** Landscape drawers dock to the side, so their toolbars render as a vertical rail. */
const drawerToolbarOrientation = computed(() =>
  windowWidth.value > windowHeight.value ? 'vertical' : 'horizontal',
);

const { t } = useI18n();

const timelineStore = useTimelineStore();
const focusStore = useFocusStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const mediaStore = useMediaStore();
const clipboardStore = useAppClipboard();
const uiStore = useUiStore();

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
  isMultiSelectionDrawerOpen,
  isAddContentDrawerOpen,
  isTrimDrawerOpen,
  isTransitionsPanelOpen,
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
  isAnyDrawerOpen,
  suppressDrawerSelectionClearTemporarily,
  closeAllDrawers,
  openTrackMixerDrawer,
  openTrackManagerDrawer,
  openHistoryDrawer,
  openMarkersDrawer,
  openClipDeleteDrawer,
  openClipTrimDrawer,
  openClipTransitionsPanel,
  backToClipProperties,
  onUpdateDrawerOpen,
  onClipPropertiesDrawerClose,
  onClipTrimDrawerClose,
  onTransitionsPanelClose,
  onClipDeleteDrawerClose,
  onMultiSelectionDrawerClose,
  onMarkerPropertiesDrawerClose,
  onSelectionRangeDrawerClose,
  onOpenVirtualClipPreset,
} = useMobileTimelineDrawers();

// Close all timeline drawers when the media replace picker opens on mobile,
// so clip properties are not visible behind the picker's backdrop.
watch(
  () => uiStore.isMediaReplaceModalOpen,
  (isOpen) => {
    if (isOpen) closeAllDrawers();
  },
);

const {
  selectedMarkerId,
  selectedTransitionContext: _selectedTransitionContext,
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

function handleAddContent(trackId: string) {
  addContentTargetTrackId.value = trackId;
  isAddContentDrawerOpen.value = true;
}

const playheadPx = computed(() =>
  Math.round(timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom)),
);

const scrollEl = ref<HTMLElement | null>(null);

const { scrollViewportWidth } = useMobileTimelineScroll({
  scrollEl,
  playheadPx,
  timelineStore,
});

const addContentTargetTrackId = ref<string | undefined>(undefined);

const { trackHeights, toggleTrackHeightEnlarged } = useMobileTimelineTrackHeights({
  tracks,
  timelineStore,
});

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

const { updateEdgeScroll, stopEdgeScroll } = useTimelineEdgeScroll({
  scrollEl,
  isActive: computed(() => draggingMode.value !== null),
  onScrollStep: scheduleDragReapply,
  getRect: getCachedScrollRect,
  zonePx: MOBILE_EDGE_SCROLL_ZONE_PX,
  maxSpeedPx: MOBILE_EDGE_SCROLL_MAX_SPEED_PX,
  axes: { horizontal: true, vertical: true },
});

const { onTouchStart, onTouchMove } = useMobileTimelineZoom(scrollEl, getCachedScrollRect);

const { isToolbarTrimActive, onTrimToolbarStart, onTrimToolbarMove, onTrimToolbarEnd } =
  useMobileTimelineTrim({
    selectedClipContext,
    startTrimItem,
    onGlobalPointerMove,
    onGlobalPointerUp,
    draggingMode,
  });

const {
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
} = useMobileTimelineGestures({
  scrollEl,
  isLongPress,
  isToolbarTrimActive,
  drawerActiveSnapPoint,
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
});

const { handleCopyClips, handleCutClips, handleBladeClips } = useMobileTimelineBatchActions({
  clipboardStore,
  timelineStore,
});

const {
  isCreateVersionModalOpen,
  proposedVersionName,
  handleCreateVersionFromPreview,
  validateVersionName,
  handleConfirmCreateVersion,
} = useMobileTimelineVersion({
  timelineStore,
  projectStore,
  t,
});
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
      @open-delete-drawer="openClipDeleteDrawer"
      @open-trim-drawer="openClipTrimDrawer"
      @open-transitions-drawer="openClipTransitionsPanel"
    />

    <MobileClipDeleteDrawer
      v-if="isDeleteDrawerOpen"
      v-model:active-snap-point="drawerActiveSnapPoint"
      :is-open="isDeleteDrawerOpen"
      @back="backToClipProperties"
      @close="onClipDeleteDrawerClose"
    />

    <MobileTrimToolbar
      v-if="isTrimDrawerOpen"
      :trim-preview="trimPreview"
      @back="backToClipProperties"
      @close="onClipTrimDrawerClose"
      @trim-start="onTrimToolbarStart"
      @trim-move="onTrimToolbarMove"
      @trim-end="onTrimToolbarEnd"
    />

    <MobileTransitionToolbar
      v-if="isTransitionsPanelOpen"
      @back="backToClipProperties"
      @close="onTransitionsPanelClose"
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
            icon="i-lucide-lab-razor-blade"
            :label="t('fastcat.timeline.split')"
            @click="handleBladeClips"
          />
          <MobileDrawerToolbarButton
            :icon="allDisabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
            :label="allDisabled ? t('fastcat.timeline.enableClip') : t('fastcat.timeline.disableClip')"
            @click="toggleDisabled"
          />
          <MobileDrawerToolbarButton
            v-if="hasAudioOrVideoWithAudio"
            :icon="allMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark'"
            :label="allMuted ? t('fastcat.timeline.unmuteClip') : t('fastcat.timeline.muteClip')"
            @click="toggleMuted"
          />
          <MobileDrawerToolbarButton
            :icon="allLocked ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open'"
            :label="allLocked ? t('fastcat.timeline.unlockClip') : t('fastcat.timeline.lockClip')"
            @click="toggleLocked"
          />
          <div class="w-px h-6 bg-ui-border mx-1 shrink-0" />
          <MobileDrawerToolbarButton
            icon="i-heroicons-x-mark"
            :label="t('common.close')"
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

      <!-- Main scrollable tracks area: starts below ruler (top-12 = 48px) -->
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
      <div
        v-if="!isAnyDrawerOpen && uiStore.activeModalsCount === 0"
        class="fixed z-40 transition-all duration-300"
        :class="
          drawerToolbarOrientation === 'vertical'
            ? 'bottom-6 right-6'
            : 'bottom-20 right-6'
        "
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
