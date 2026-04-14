<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';

import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useDraggedFile } from '~/composables/useDraggedFile';

import type { TimelineClipActionPayload, TimelineTrack } from '~/timeline/types';
import { timeUsToPx, pxToTimeUs } from '~/utils/timeline/geometry';
import { isLayer1Active, isLayer1Pressed } from '~/utils/hotkeys/layerUtils';

import TimelineTrackSection from '~/components/timeline/TimelineTrackSection.vue';
import TimelineToolbar from '~/components/timeline/TimelineToolbar.vue';
import TimelineRuler from '~/components/timeline/TimelineRuler.vue';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';
import UiTimecode from '~/components/ui/editor/UiTimecode.vue';

import { useTimelineSectionResize } from '~/composables/timeline/useTimelineSectionResize';
import { useTimelineHorizontalScrollSync } from '~/composables/timeline/useTimelineHorizontalScrollSync';
import { useTimelinePan } from '~/composables/timeline/useTimelinePan';
import { useTimelineWheelHandler } from '~/composables/timeline/useTimelineWheelHandler';
import { useTimelineClickActions } from '~/composables/timeline/useTimelineClickActions';
import { useTimelineTextPreset } from '~/composables/timeline/useTimelineTextPreset';
import { useTimelineDropHandling } from '~/composables/timeline/useTimelineDropHandling';
import { useTimelineInteraction } from '~/composables/timeline/useTimelineInteraction';
import { useTimelineEmptyAreaContextMenu } from '~/composables/timeline/useTimelineEmptyAreaContextMenu';
import TextPresetSelectionModal from '~/components/timeline/TextPresetSelectionModal.vue';

const { t } = useI18n();
const toast = useToast();

const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const focusStore = useFocusStore();
const timelineSettingsStore = useTimelineSettingsStore();
const projectStore = useProjectStore();
const { setDraggedFile, clearDraggedFile } = useDraggedFile();

const { currentProjectId, currentView } = storeToRefs(projectStore);
const { trackHeights } = storeToRefs(timelineStore);

// --- Template refs ---
const containerRef = ref<HTMLElement | null>(null);
const rulerScrollEl = ref<HTMLElement | null>(null);
const rulerContainerRef = ref<HTMLElement | null>(null);
const videoSectionRef = ref<InstanceType<typeof TimelineTrackSection> | null>(null);
const audioSectionRef = ref<InstanceType<typeof TimelineTrackSection> | null>(null);
const menuRef = ref<InstanceType<typeof UiContextMenuPortal> | null>(null);

// --- Derived scroll elements (from TimelineTrackSection via defineExpose) ---
// Vue unwraps refs exposed via defineExpose, so .scrollEl is HTMLElement | null directly
const videoScrollEl = computed(() => videoSectionRef.value?.scrollEl ?? null);
const audioScrollEl = computed(() => audioSectionRef.value?.scrollEl ?? null);
const videoLabelsScrollEl = computed(() => videoSectionRef.value?.labelsScrollEl ?? null);
const audioLabelsScrollEl = computed(() => audioSectionRef.value?.labelsScrollEl ?? null);
const scrollEl = videoScrollEl;

// --- Data ---
const tracks = computed(() => (timelineStore.timelineDoc?.tracks as TimelineTrack[]) ?? []);
const videoTracks = computed(() => tracks.value.filter((t) => t.kind === 'video'));
const audioTracks = computed(() => tracks.value.filter((t) => t.kind === 'audio'));
const canEditClipContent = computed(() => ['cut', 'files', 'sound'].includes(currentView.value));
const timelineMouseSettings = computed(() => workspaceStore.userSettings.mouse.timeline);
const rulerMouseSettings = computed(() => workspaceStore.userSettings.mouse.ruler);

const anyMuted = computed(() => tracks.value.some((t) => t.audioMuted));
const anyLocked = computed(() => tracks.value.some((t) => t.locked));
const anyHidden = computed(() => tracks.value.some((t) => t.videoHidden));
const { isAnyTrackSoloed } = storeToRefs(timelineStore);

const timelineWidthStyle = computed(() => {
  const maxUs = Math.max(timelineStore.duration, timelineStore.currentTime) + 30_000_000;
  const widthPx = timeUsToPx(maxUs, timelineStore.timelineZoom);
  return { width: `${widthPx}px`, minWidth: '100%' };
});

// --- Composables ---
const { videoSectionPercent, sectionContainerRef, onSectionResizeStart, resetSectionPercent } =
  useTimelineSectionResize({ projectId: currentProjectId });

const {
  scrollLeftRef,
  scrollbarHeight,
  viewportWidth,
  onVideoScroll,
  onAudioScroll,
  onRulerScroll,
  onVideoLabelsScroll,
  onAudioLabelsScroll,
} = useTimelineHorizontalScrollSync({
  video: videoScrollEl,
  audio: audioScrollEl,
  ruler: rulerScrollEl,
  videoLabels: videoLabelsScrollEl,
  audioLabels: audioLabelsScrollEl,
});

const { isPanning, hasPanned, getActiveScrollEl, startPan, onPanMove, stopPan } = useTimelinePan({
  videoScrollEl,
  audioScrollEl,
});

const { fitTimelineZoom } = useTimelineWheelHandler({
  videoScrollEl,
  audioScrollEl,
  videoLabelsScrollEl,
  audioLabelsScrollEl,
  rulerContainerRef,
  scrollEl,
  tracks,
});

const { onTimelineClick, handleTimelineClickAction } = useTimelineClickActions({
  videoScrollEl,
  audioScrollEl,
  rulerScrollEl,
  scrollEl,
  videoTracks,
  audioTracks,
  getActiveScrollEl,
});

const {
  textPresetMenuRef,
  textPresetMenuItems,
  isPresetModalOpen,
  pendingClipInfo,
  applyTextPreset,
  cancelTextPreset,
} = useTimelineTextPreset();

const {
  dragPreview,
  clearDragPreview,
  handleFileDrop,
  handleLibraryDrop,
  getDropPosition,
  onTrackDragOver,
  onTrackDragLeave,
  isImporting,
  importProgress,
  importFileName,
  importPhase,
  cancelImport,
} = useTimelineDropHandling({ scrollEl });

const {
  draggingMode,
  draggingItemId,
  movePreview,
  slipPreview,
  trimPreview,
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

// --- Context menu ---
const { emptyAreaContextMenuItems } = useTimelineEmptyAreaContextMenu({
  onZoomToFit: () => fitTimelineZoom(),
});

const timelineMenuItems = computed(() => [
  ...emptyAreaContextMenuItems.value,
  [
    {
      label: t('common.actions.reset'),
      icon: 'i-heroicons-arrow-path',
      onSelect: resetSectionPercent,
    },
  ],
]);

// --- Event handlers ---
function onContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.classList.contains('timeline-section-resize-handle')) {
    e.preventDefault();
    menuRef.value?.open(e);
  }
}

function onTimeRulerPointerDown(e: PointerEvent) {
  focusStore.setMainFocus('timeline');
  onBaseTimeRulerPointerDown(e);
}

let cachedPointerRectEl: HTMLElement | null = null;
let cachedPointerRect: DOMRect | null = null;
let pointerRectFrameId = 0;

function clearPointerRectCache() {
  cachedPointerRectEl = null;
  cachedPointerRect = null;
  if (pointerRectFrameId !== 0) {
    cancelAnimationFrame(pointerRectFrameId);
    pointerRectFrameId = 0;
  }
}

function getCachedPointerRect(el: HTMLElement): DOMRect {
  if (cachedPointerRectEl === el && cachedPointerRect) {
    return cachedPointerRect;
  }

  cachedPointerRectEl = el;
  cachedPointerRect = el.getBoundingClientRect();

  if (pointerRectFrameId === 0) {
    pointerRectFrameId = requestAnimationFrame(() => {
      pointerRectFrameId = 0;
      cachedPointerRectEl = null;
      cachedPointerRect = null;
    });
  }

  return cachedPointerRect;
}

function getTimeUsFromPointerEvent(el: HTMLElement, event: PointerEvent): number {
  const rect = getCachedPointerRect(el);
  const x = event.clientX - rect.left + el.scrollLeft;
  return pxToTimeUs(x, timelineStore.timelineZoom);
}

function onTimelinePointerMove(e: PointerEvent) {
  const isRuler = (e.target as HTMLElement | null)?.closest('.timeline-ruler-container');
  const settings = isRuler ? rulerMouseSettings.value : timelineMouseSettings.value;

  if (
    settings.horizontalMovement === 'move_playhead' &&
    !draggingMode.value &&
    !isPanning.value &&
    !isDraggingPlayhead.value
  ) {
    const el = getActiveScrollEl(e) || scrollEl.value;
    if (el) {
      timelineStore.setCurrentTimeUs(getTimeUsFromPointerEvent(el, e));
    }
  }

  onBaseGlobalPointerMove(e);
  onPanMove(e);
}

function onTimelinePointerUp(e: PointerEvent) {
  clearPointerRectCache();
  onBaseGlobalPointerUp(e);
  stopPan(e);
}

function onTrackAreaPointerDownCapture(e: PointerEvent) {
  const isRuler = (e.target as HTMLElement | null)?.closest('.timeline-ruler-container');
  if (isRuler) return;

  const isLabels = (e.target as HTMLElement | null)?.closest('.timeline-labels-container');

  if (e.button === 1) {
    hasPanned.value = false;
    hasPlayheadMoved.value = false;

    if (isLabels) {
      // Middle click/drag on track labels — use trackHeaders settings, no pan/seek
      return;
    }

    if (timelineMouseSettings.value.middleDrag === 'pan') {
      startPan(e);
    } else if (timelineMouseSettings.value.middleDrag === 'move_playhead') {
      const el = getActiveScrollEl(e) || scrollEl.value;
      if (!el) return;
      timelineStore.setCurrentTimeUs(getTimeUsFromPointerEvent(el, e));
      startPlayheadDrag(e);
    }
  }
}

onBeforeUnmount(() => {
  clearPointerRectCache();
});

function onTrackAreaAuxClick(e: MouseEvent) {
  if (e.button !== 1) return;
  const isRuler = (e.target as HTMLElement).closest('.timeline-ruler-container');
  const isLabels = (e.target as HTMLElement).closest('.timeline-labels-container');
  if (!isRuler) {
    if (hasPanned.value || hasPlayheadMoved.value) return;
    if (isLabels) return;
    handleTimelineClickAction(timelineMouseSettings.value.middleClick, e);
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

// Scroll the timeline so the playhead is visible (used after rewind to start/end)
watch(
  () => timelineStore.scrollToPlayheadRequest,
  () => {
    nextTick(() => {
      const el = scrollEl.value;
      if (!el) return;
      const playheadPx = timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom);
      const vw = el.clientWidth;
      if (playheadPx < el.scrollLeft || playheadPx > el.scrollLeft + vw) {
        el.scrollLeft = Math.max(0, playheadPx - vw / 2);
      }
    });
  },
);

function updateTrackHeight(trackId: string, height: number) {
  trackHeights.value[trackId] = height;
  timelineStore.markTimelineAsDirty();
  timelineStore.requestTimelineSave();
}

async function onDrop(e: DragEvent, trackId: string) {
  const startUs = getDropPosition(e);
  if (startUs === null) return;

  const pseudo =
    isLayer1Pressed(e as DragEvent, workspaceStore.userSettings) ||
    timelineSettingsStore.overlapMode === 'pseudo';

  const libraryItemData =
    e.dataTransfer?.getData('fastcat-item') || e.dataTransfer?.getData('application/json');
  if (libraryItemData) {
    try {
      const parsed = JSON.parse(libraryItemData);
      if (parsed.kind || (Array.isArray(parsed) && parsed.length > 0 && parsed[0].kind)) {
        const showPresets = isLayer1Pressed(e as DragEvent, workspaceStore.userSettings);
        await handleLibraryDrop(libraryItemData, trackId, startUs, {
          pseudo,
          clientX: e.clientX,
          clientY: e.clientY,
          showPresets,
        });
        return;
      }
    } catch {
      // ignore
    }
  }

  const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
  if (files.length > 0) await handleFileDrop(files, trackId, startUs);
  clearDragPreview();
}

function onDragVirtualStart(event: DragEvent, type: 'adjustment' | 'background' | 'text') {
  setDraggedFile({
    kind: type,
    name: t(
      `fastcat.timeline.${type}ClipDefaultName`,
      type.charAt(0).toUpperCase() + type.slice(1),
    ),
    path: '',
  });
}

function onDragVirtualEnd() {
  clearDraggedFile();
}
</script>

<template>
  <div
    ref="containerRef"
    class="panel-focus-frame relative flex flex-col h-full bg-ui-bg border-t border-ui-border"
    :class="{ 'panel-focus-frame--active': focusStore.isPanelFocused('timeline') }"
    @pointerdown.capture="focusStore.setMainFocus('timeline')"
    @contextmenu="onContextMenu"
  >
    <UiContextMenuPortal
      ref="menuRef"
      :items="timelineMenuItems"
      :target-el="containerRef"
      manual
    />
    <UiContextMenuPortal
      ref="textPresetMenuRef"
      :items="textPresetMenuItems"
      :target-el="containerRef"
      manual
    />
    <TextPresetSelectionModal
      v-if="pendingClipInfo"
      v-model:open="isPresetModalOpen"
      :track-id="pendingClipInfo.trackId"
      :item-id="pendingClipInfo.itemId"
      @select="(id) => applyTextPreset(id, pendingClipInfo!)"
      @close="cancelTextPreset"
    />

    <!-- Row 1: Toolbar -->
    <TimelineToolbar
      @drag-virtual-start="onDragVirtualStart"
      @drag-virtual-end="onDragVirtualEnd"
    />

    <FileManagerRemoteTransferProgressModal
      :open="isImporting"
      :title="t('videoEditor.fileManager.actions.importing')"
      :description="t('videoEditor.fileManager.actions.importing')"
      :progress="importProgress"
      :phase="importPhase"
      :file-name="importFileName"
      @cancel="cancelImport"
    />

    <!-- Row 2: Ruler with playhead timecode -->
    <div
      class="flex shrink-0 h-8 border-b border-ui-border"
      @pointermove="onTimelinePointerMove"
      @pointerup="onTimelinePointerUp"
      @pointercancel="onTimelinePointerUp"
    >
      <UContextMenu :items="emptyAreaContextMenuItems">
        <div
          class="shrink-0 border-r border-ui-border bg-ui-bg-elevated flex items-center px-2 gap-2"
          style="width: 220px"
        >
          <UiTimecode
            class="flex-1"
            :model-value="timelineStore.currentTime"
            wheel-without-focus
            @update:model-value="timelineStore.setCurrentTimeUs($event)"
          />

          <div class="flex items-center gap-1">
            <UTooltip v-if="anyLocked" :text="t('fastcat.track.resetLocked')" :shortcuts="['L']">
              <UButton
                icon="i-heroicons-lock-closed"
                color="primary"
                variant="solid"
                size="xs"
                class="w-5 h-5 p-0! rounded-full"
                :style="{ backgroundColor: '#3b82f6', color: '#ffffff' }"
                @click="timelineStore.unlockAllTracks()"
              />
            </UTooltip>
            <UTooltip v-if="anyHidden" :text="t('fastcat.track.resetHidden')" :shortcuts="['H']">
              <UButton
                icon="i-heroicons-eye-slash"
                color="white"
                variant="solid"
                size="xs"
                class="w-5 h-5 p-0! rounded-full ring-1 ring-ui-border"
                :style="{ backgroundColor: '#ffffff', color: '#000000' }"
                @click="timelineStore.showAllTracks()"
              />
            </UTooltip>
            <UTooltip v-if="anyMuted" :text="t('fastcat.track.resetMuted')" :shortcuts="['M']">
              <UButton
                icon="i-heroicons-speaker-x-mark"
                color="error"
                variant="solid"
                size="xs"
                class="w-5 h-5 p-0! rounded-full"
                :style="{ backgroundColor: '#ef4444', color: '#ffffff' }"
                @click="timelineStore.unmuteAllTracks()"
              />
            </UTooltip>
            <UTooltip
              v-if="isAnyTrackSoloed"
              :text="t('fastcat.track.resetSolo')"
              :shortcuts="['S']"
            >
              <UButton
                icon="i-heroicons-musical-note"
                color="success"
                variant="solid"
                size="xs"
                class="w-5 h-5 p-0! rounded-full"
                :style="{ backgroundColor: '#22c55e', color: '#ffffff' }"
                @click="timelineStore.unsoloAllTracks()"
              />
            </UTooltip>
          </div>
        </div>
      </UContextMenu>
      <div
        ref="rulerContainerRef"
        class="flex-1 relative z-10 timeline-ruler-container overflow-hidden"
      >
        <UContextMenu :items="emptyAreaContextMenuItems">
          <TimelineRuler
            class="absolute inset-0 h-full border-b border-ui-border bg-ui-bg-elevated cursor-pointer"
            :scroll-el="rulerScrollEl"
            @pointerdown="onTimeRulerPointerDown"
            @start-playhead-drag="startPlayheadDrag"
            @start-pan="startPan"
          />
        </UContextMenu>
        <div
          ref="rulerScrollEl"
          class="absolute inset-0 overflow-x-scroll overflow-y-hidden scroll-sync-hidden pointer-events-none"
          @scroll="onRulerScroll"
        >
          <div
            :style="{ ...timelineWidthStyle, paddingRight: `${scrollbarHeight}px` }"
            class="h-full"
          />
        </div>
      </div>
    </div>

    <!-- Rows 3 & 4: Track sections -->
    <div
      ref="sectionContainerRef"
      class="flex-1 flex flex-col min-h-0 relative"
      @pointermove="onTimelinePointerMove"
      @pointerup="onTimelinePointerUp"
      @pointercancel="onTimelinePointerUp"
      @pointerdown.capture="onTrackAreaPointerDownCapture"
      @auxclick="onTrackAreaAuxClick"
    >
      <!-- Video Tracks Section -->
      <TimelineTrackSection
        ref="videoSectionRef"
        kind="video"
        :style="{ height: `${videoSectionPercent}%` }"
        :tracks="videoTracks"
        :track-heights="trackHeights"
        :can-edit-clip-content="canEditClipContent"
        :drag-preview="dragPreview"
        :move-preview="movePreview"
        :slip-preview="slipPreview"
        :trim-preview="trimPreview"
        :dragging-mode="draggingMode"
        :dragging-item-id="draggingItemId"
        :scroll-left="scrollLeftRef"
        :viewport-width="viewportWidth"
        :on-zoom-to-fit="fitTimelineZoom"
        @scroll="onVideoScroll"
        @labels-scroll="onVideoLabelsScroll"
        @click="onTimelineClick"
        @drop="onDrop"
        @dragover="(ev, id) => onTrackDragOver(ev, id)"
        @dragleave="(ev, id) => onTrackDragLeave(ev, id)"
        @start-move-item="startMoveItem"
        @select-item="selectItem"
        @start-trim-item="startTrimItem"
        @clip-action="onClipAction"
        @update-track-height="updateTrackHeight"
      />

      <!-- Section resize handle -->
      <div
        class="timeline-section-resize-handle h-1.5 cursor-ns-resize bg-ui-bg hover:bg-primary-500/30 transition-colors z-20 shrink-0 flex items-center justify-center group"
        @mousedown="onSectionResizeStart"
      >
        <div
          class="w-8 h-0.5 rounded bg-ui-border group-hover:bg-primary-500/60 transition-colors"
        />
      </div>

      <!-- Audio Tracks Section -->
      <TimelineTrackSection
        ref="audioSectionRef"
        kind="audio"
        :tracks="audioTracks"
        :track-heights="trackHeights"
        :can-edit-clip-content="canEditClipContent"
        :drag-preview="dragPreview"
        :move-preview="movePreview"
        :slip-preview="slipPreview"
        :trim-preview="trimPreview"
        :dragging-mode="draggingMode"
        :dragging-item-id="draggingItemId"
        :scroll-left="scrollLeftRef"
        :viewport-width="viewportWidth"
        :on-zoom-to-fit="fitTimelineZoom"
        @scroll="onAudioScroll"
        @labels-scroll="onAudioLabelsScroll"
        @click="onTimelineClick"
        @drop="onDrop"
        @dragover="(ev, id) => onTrackDragOver(ev, id)"
        @dragleave="(ev, id) => onTrackDragLeave(ev, id)"
        @start-move-item="startMoveItem"
        @select-item="selectItem"
        @start-trim-item="startTrimItem"
        @clip-action="onClipAction"
        @update-track-height="updateTrackHeight"
      />
    </div>
  </div>
</template>

<style scoped>
.scroll-sync-hidden {
  scrollbar-width: none;
}
.scroll-sync-hidden::-webkit-scrollbar {
  display: none;
}
</style>
