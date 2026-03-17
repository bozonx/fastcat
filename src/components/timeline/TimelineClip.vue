<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
  TimelineTrack,
  TimelineTrackItem,
  TimelineClipItem,
  TimelineClipActionPayload,
  TimelineMoveItemPayload,
  TimelineOpenSpeedModalPayload,
  TimelineResizeFadePayload,
  TimelineResizeVolumePayload,
  TimelineTransitionSelection,
  TimelineTrimItemPayload,
} from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import { timeUsToPx, sanitizeFps } from '~/utils/timeline/geometry';
import { useClipContextMenu } from '~/composables/timeline/useClipContextMenu';
import { getClipClass, getOverlayGuideOffsetPx } from '~/utils/timeline/clip';
import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useClipDrop } from '~/composables/timeline/useClipDrop';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useFocusStore } from '~/stores/focus.store';
import { useEditorViewStore } from '~/stores/editorView.store';
import { useFilesPageStore } from '~/stores/filesPage.store';
import { useProjectTabsStore } from '~/stores/tabs.store';

import ClipTransitions from './ClipTransitions.vue';
import ClipAudioFades from './ClipAudioFades.vue';
import ClipMetadata from './ClipMetadata.vue';
import TimelineClipThumbnails from './TimelineClipThumbnails.vue';
import TimelineAudioWaveform from './audio/TimelineAudioWaveform.vue';

interface Props {
  track: TimelineTrack;
  item: TimelineTrackItem;
  trackHeight: number;
  canEditClipContent: boolean;
  isDraggingCurrentItem: boolean;
  isMovePreviewCurrentItem: boolean;
  slipPreview?: {
    itemId: string;
    trackId: string;
    deltaUs: number;
    timecode: string;
  } | null;
  selectedTransition: { trackId: string; itemId: string; edge: 'in' | 'out' } | null;
  resizeVolume: {
    itemId: string;
    trackId: string;
    startGain: number;
    startY: number;
    trackHeight: number;
  } | null;
  isMobile?: boolean;
  scrollLeft?: number;
  viewportWidth?: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'selectItem', event: PointerEvent, itemId: string): void;
  (e: 'startMoveItem', event: PointerEvent, payload: TimelineMoveItemPayload): void;
  (e: 'startTrimItem', event: PointerEvent, payload: TimelineTrimItemPayload): void;
  (e: 'startResizeVolume', event: PointerEvent, payload: TimelineResizeVolumePayload): void;
  (e: 'startResizeFade', event: PointerEvent, payload: TimelineResizeFadePayload): void;
  (e: 'startResizeTransition', event: PointerEvent, payload: TimelineResizeFadePayload): void;
  (
    e: 'selectTransition',
    event: MouseEvent | PointerEvent,
    payload: TimelineTransitionSelection,
  ): void;
  (e: 'clipAction', payload: TimelineClipActionPayload): void;
  (e: 'openSpeedModal', payload: TimelineOpenSpeedModalPayload): void;
  (e: 'resetVolume', payload: { trackId: string; itemId: string }): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const mediaStore = useMediaStore();
const uiStore = useUiStore();
const projectStore = useProjectStore();
const settingsStore = useTimelineSettingsStore();
const workspaceStore = useWorkspaceStore();

let didStartClipDrag = false;
const rightClickDragTriggered = ref(false);
let rightClickDragTimer: number | null = null;
const RIGHT_CLICK_DRAG_DELAY_MS = 300;

const clipItem = computed<TimelineClipItem | null>(() =>
  props.item.kind === 'clip' ? (props.item as TimelineClipItem) : null,
);
const clipWidthPx = computed(() =>
  Math.max(2, timeUsToPx(props.item.timelineRange.durationUs, timelineStore.timelineZoom)),
);
const currentSlipPreview = computed(() => {
  if (!props.slipPreview || props.slipPreview.itemId !== props.item.id) return null;
  return props.slipPreview;
});

function toggleFadeCurve(edge: 'in' | 'out') {
  if (!clipItem.value || !props.canEditClipContent || clipItem.value.locked) return;

  const curveProp = edge === 'in' ? 'audioFadeInCurve' : 'audioFadeOutCurve';
  const currentCurve = clipItem.value[curveProp] === 'logarithmic' ? 'logarithmic' : 'linear';
  const nextCurve = currentCurve === 'logarithmic' ? 'linear' : 'logarithmic';

  timelineStore.updateClipProperties(props.track.id, props.item.id, {
    [curveProp]: nextCurve,
  });
  void timelineStore.requestTimelineSave({ immediate: true });
}

function onContextMenu(e: MouseEvent) {
  if (didStartClipDrag || rightClickDragTriggered.value) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function onClipPointerdown(e: PointerEvent) {
  if (timelineStore.isTrimModeActive) return;
  if (e.button !== 0 && e.button !== 2) return;
  if (!props.canEditClipContent || !clipItem.value || clipItem.value.locked) return;

  e.stopPropagation();

  didStartClipDrag = false;
  rightClickDragTriggered.value = false;
  const startX = e.clientX;
  const startY = e.clientY;

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    if (rightClickDragTimer !== null) {
      window.clearTimeout(rightClickDragTimer);
      rightClickDragTimer = null;
    }
  };

  const startDrag = () => {
    if (didStartClipDrag) return;
    didStartClipDrag = true;
    if (e.button === 2) {
      rightClickDragTriggered.value = true;
    }
    cleanup();
    e.preventDefault();
    emit('startMoveItem', e, {
      trackId: props.track.id,
      itemId: props.item.id,
      startUs: props.item.timelineRange.startUs,
      mode:
        settingsStore.toolbarMoveModeEnabled && settingsStore.toolbarMoveMode === 'slip'
          ? 'slip'
          : 'move',
    });
  };

  const onMove = (ev: PointerEvent) => {
    if (e.button === 2) return;

    if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) {
      startDrag();
    }
  };

  const onPointerUp = () => {
    cleanup();
  };

  const onPointerCancel = () => {
    cleanup();
    rightClickDragTriggered.value = false;
  };

  if (e.button !== 2) {
    e.preventDefault();
  } else {
    rightClickDragTimer = window.setTimeout(() => {
      rightClickDragTimer = null;
      startDrag();
    }, RIGHT_CLICK_DRAG_DELAY_MS);
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
  window.addEventListener('pointercancel', onPointerCancel, { once: true });
}

function onTrimHandlePointerDown(e: PointerEvent, edge: 'start' | 'end') {
  if (e.button !== 0 && e.button !== 2) return;

  e.preventDefault();
  e.stopPropagation();

  emit('startTrimItem', e, {
    trackId: props.item.trackId,
    itemId: props.item.id,
    edge,
    startUs: props.item.timelineRange.startUs,
  });
}

function onClipClick(e: MouseEvent) {
  if (didStartClipDrag) return;
  if (timelineStore.isTrimModeActive) {
    if (e.button === 0 && props.canEditClipContent && clipItem.value && !clipItem.value.locked) {
      const isShift = isLayer1Active(e, workspaceStore.userSettings);
      const isCtrl = isLayer2Active(e, workspaceStore.userSettings);
      const target = {
        trackId: props.track.id,
        itemId: props.item.id,
      };

      timelineStore.selectTimelineItems([props.item.id]);

      if (isShift && !isCtrl) {
        void timelineStore.trimToPlayheadLeftNoRipple(target);
      } else if (!isShift && isCtrl) {
        void timelineStore.trimToPlayheadRightNoRipple(target);
      } else {
        void timelineStore.splitClipAtPlayhead(target);
      }
    }
    return;
  }
  if (e.button === 0) emit('selectItem', e as PointerEvent, props.item.id);
}

const editorViewStore = useEditorViewStore();
const focusStore = useFocusStore();
const filesPageStore = useFilesPageStore();
const projectTabsStore = useProjectTabsStore();
const fileManager = useFileManager();

const { handleSelectInFileManager, handleOpenNestedTimeline } = useClipPropertiesActions({
  clip: computed(() => clipItem.value!),
  trackKind: computed(() => props.track.kind),
  timelineStore,
  projectStore,
  uiStore,
  editorViewStore,
  filesPageStore,
  selectionStore,
  focusStore,
  fileManager,
  setActiveTab: projectTabsStore.setActiveTab,
});

function onClipDblClick() {
  if (!clipItem.value) return;

  if (clipItem.value.clipType === 'media') {
    void handleSelectInFileManager();
  } else if (clipItem.value.clipType === 'timeline') {
    void handleOpenNestedTimeline();
  }
}

const { isDraggingOver, handleDragEnter, handleDragLeave, handleDragOver, handleDrop } =
  useClipDrop({
    track: computed(() => props.track),
    clipItem,
    canEditClipContent: computed(() => props.canEditClipContent),
    updateClipProperties: (trackId, itemId, patch) =>
      timelineStore.updateClipProperties(trackId, itemId, patch),
    updateClipTransition: (trackId, itemId, patch) =>
      timelineStore.updateClipTransition(trackId, itemId, patch),
    selectTimelineItem: (trackId, itemId, kind) =>
      selectionStore.selectTimelineItem(trackId, itemId, kind),
    selectTimelineTransition: (trackId, itemId, edge) =>
      selectionStore.selectTimelineTransition(trackId, itemId, edge),
    triggerScrollToEffects: () => uiStore.triggerScrollToEffects(),
    defaultTransitionDurationUs: computed(
      () => workspaceStore.userSettings.timeline.defaultTransitionDurationUs,
    ),
  });

function isVideo(it: TimelineTrackItem): it is TimelineClipItem {
  return (
    it.kind === 'clip' &&
    (it.clipType === 'media' || it.clipType === 'timeline') &&
    props.track.kind === 'video'
  );
}

function isAudio(it: TimelineTrackItem): it is TimelineClipItem {
  return (
    it.kind === 'clip' &&
    (it.clipType === 'media' || it.clipType === 'timeline') &&
    props.track.kind === 'audio'
  );
}

function clipHasAudio(it: TimelineTrackItem, track: TimelineTrack): boolean {
  if (it.kind !== 'clip') return false;
  const clip = it as any;
  if (clip.clipType === 'timeline') return true;
  if (track.kind === 'video' && clip.audioFromVideoDisabled) return false;
  if (clip.clipType !== 'media' && clip.clipType !== 'timeline') return track.kind === 'audio';
  if (!clip.source?.path) return track.kind === 'audio';
  return Boolean(mediaStore.mediaMetadata[clip.source.path]?.audio);
}

const isMediaMissing = computed(() => {
  if (
    !clipItem.value ||
    (clipItem.value.clipType !== 'media' && clipItem.value.clipType !== 'timeline')
  )
    return false;
  return mediaStore.missingPaths[clipItem.value.source.path] === true;
});

const { contextMenuItems } = useClipContextMenu({
  track: computed(() => props.track),
  item: computed(() => props.item),
  canEditClipContent: computed(() => props.canEditClipContent),
  timelineDoc: computed(() => timelineStore.timelineDoc),
  projectSettings: computed(() => projectStore.projectSettings),
  defaultTransitionDurationUs: computed(
    () => workspaceStore.userSettings.timeline.defaultTransitionDurationUs,
  ),
  selectedItemIds: computed(() => timelineStore.selectedItemIds),
  applyTimelineCommand: (cmd) => timelineStore.applyTimeline(cmd),
  batchApplyTimeline: (cmds) => timelineStore.batchApplyTimeline(cmds),
  updateClipProperties: (trackId, itemId, p) =>
    timelineStore.updateClipProperties(trackId, itemId, p),
  updateClipTransition: (trackId, itemId, p) =>
    timelineStore.updateClipTransition(trackId, itemId, p),
  requestTimelineSave: (opts) => timelineStore.requestTimelineSave(opts),
  selectTransition: (p) => timelineStore.selectTransition(p),
  clearSelection: () => selectionStore.clearSelection(),
  selectTimelineTransition: (trackId, itemId, edge) =>
    selectionStore.selectTimelineTransition(trackId, itemId, edge),
  emitOpenSpeedModal: (p) => emit('openSpeedModal', p),
  emitClipAction: (p) => emit('clipAction', p),
  t,
});

const isFreePosition = computed(() => {
  if (!clipItem.value || !timelineStore.timelineDoc) return false;
  const fps = timelineStore.fps || 30;
  const startFrame = (clipItem.value.timelineRange.startUs * fps) / 1_000_000;
  const durFrame = (clipItem.value.timelineRange.durationUs * fps) / 1_000_000;
  return (
    Math.abs(startFrame - Math.round(startFrame)) > 0.001 ||
    Math.abs(durFrame - Math.round(durFrame)) > 0.001
  );
});

const transitionInOverlayGuideStyle = computed<Record<string, string> | null>(() => {
  const offsetPx = getOverlayGuideOffsetPx(
    props.track,
    clipItem.value,
    'in',
    clipWidthPx.value,
    (us) => timeUsToPx(us, timelineStore.timelineZoom),
  );
  if (offsetPx === null) return null;

  return {
    left: `${offsetPx}px`,
  };
});

const transitionOutOverlayGuideStyle = computed<Record<string, string> | null>(() => {
  const offsetPx = getOverlayGuideOffsetPx(
    props.track,
    clipItem.value,
    'out',
    clipWidthPx.value,
    (us) => timeUsToPx(us, timelineStore.timelineZoom),
  );
  if (offsetPx === null) return null;

  return {
    left: `${Math.max(0, clipWidthPx.value - offsetPx)}px`,
  };
});
function handleTransitionCreate(e: PointerEvent, payload: { edge: 'in' | 'out'; drag: boolean }) {
  if (!clipItem.value || !props.canEditClipContent) return;

  const defaultUs = Math.max(
    0,
    Math.round(
      Number(workspaceStore.userSettings.timeline.defaultTransitionDurationUs ?? 1_000_000),
    ),
  );
  const durationUs = Math.min(defaultUs, Math.round(clipItem.value.timelineRange.durationUs * 0.3));

  const transitionPatch = {
    type: 'dissolve',
    durationUs,
    mode: 'adjacent' as const,
    curve: 'linear' as const,
  };

  timelineStore.updateClipTransition(
    props.track.id,
    props.item.id,
    payload.edge === 'in' ? { transitionIn: transitionPatch } : { transitionOut: transitionPatch },
  );

  if (payload.drag) {
    // Defer starting drag to give vue time to render transition
    window.setTimeout(() => {
      emit('startResizeTransition', e, {
        trackId: props.track.id,
        itemId: props.item.id,
        edge: payload.edge,
        durationUs,
      });
    }, 0);
  }
}
</script>

<template>
  <UContextMenu :items="contextMenuItems" :disabled="rightClickDragTriggered">
    <div
      :data-clip-id="item.kind === 'clip' ? item.id : undefined"
      :data-gap-id="item.kind === 'gap' ? item.id : undefined"
      class="absolute top-0.5 bottom-0.5 rounded flex flex-col text-xs text-(--clip-text) select-none transition-shadow group/clip"
      :style="{
        left: `${timeUsToPx(item.timelineRange.startUs, timelineStore.timelineZoom)}px`,
        width: `${clipWidthPx}px`,
        zIndex: timelineStore.selectedItemIds.includes(item.id)
          ? 'var(--z-clip-selected)'
          : isDraggingOver
            ? 'var(--z-clip-dragging-over)'
            : 'var(--z-clip-normal)',
      }"
      :class="[
        getClipClass(item, track),
        timelineStore.selectedItemIds.includes(item.id)
          ? 'outline-(--color-primary) outline-2 z-10 shadow-lg'
          : 'outline-transparent',
        clipItem && typeof clipItem.freezeFrameSourceUs === 'number'
          ? 'outline-(--color-warning) outline-2'
          : '',
        clipItem &&
        (Boolean(clipItem.disabled) ||
          Boolean(track.videoHidden) ||
          (timelineStore.isAnyTrackSoloed && !track.audioSolo))
          ? 'opacity-40'
          : '',
        isMediaMissing ? 'bg-red-600! border-red-800! text-white!' : '',
        clipItem && Boolean(clipItem.locked) ? 'cursor-not-allowed' : '',
        isMobile ? 'touch-manipulation' : '',
      ]"
      @pointerdown="onClipPointerdown"
      @click="onClipClick"
      @dblclick="onClipDblClick"
      @contextmenu.capture="onContextMenu"
      @dragover="handleDragOver"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <!-- Indicators -->
      <div
        v-if="
          clipItem && typeof clipItem.speed === 'number' && clipItem.speed !== 1 && !isMediaMissing
        "
        class="absolute inset-0 rounded border-2 pointer-events-none"
        :style="{ zIndex: 'var(--z-clip-speed)' }"
        :class="clipItem.speed < 0 ? 'border-fuchsia-500' : 'border-violet-400'"
      />
      <div
        v-if="isFreePosition"
        class="absolute inset-0 rounded border-2 border-yellow-400 pointer-events-none"
        :style="{ zIndex: 'var(--z-clip-free-pos)' }"
      />

      <!-- Overlays (Missing Media, Disabled, Muted) -->
      <ClipMetadata
        :item="item"
        :track="track"
        :is-media-missing="isMediaMissing"
        :clip-width-px="clipWidthPx"
      />

      <!-- Sub-components for Transitions and Fades -->
      <ClipTransitions
        v-if="clipItem"
        :clip="clipItem"
        :track="track"
        :zoom="timelineStore.timelineZoom"
        :clip-width-px="clipWidthPx"
        :selected-transition="selectedTransition"
        :can-edit="canEditClipContent"
        @select="(e, payload) => emit('selectTransition', e, payload)"
        @resize="
          (e, payload) =>
            emit('startResizeTransition', e, {
              trackId: track.id,
              itemId: item.id,
              edge: payload.edge,
              durationUs: payload.durationUs,
            })
        "
        @create-transition="handleTransitionCreate"
      />

      <ClipAudioFades
        v-if="clipItem && clipHasAudio(item, track)"
        :clip="clipItem"
        :item="item"
        :track="track"
        :track-height="trackHeight"
        :zoom="timelineStore.timelineZoom"
        :clip-width-px="clipWidthPx"
        :can-edit="canEditClipContent"
        :is-dragging="isDraggingCurrentItem || isMovePreviewCurrentItem"
        :is-resizing-volume="resizeVolume?.itemId === item.id"
        :is-mobile="isMobile"
        @start-resize-fade="
          (e, payload) =>
            emit('startResizeFade', e, {
              trackId: track.id,
              itemId: item.id,
              edge: payload.edge,
              durationUs: payload.durationUs,
            })
        "
        @start-resize-volume="
          (e, gain) =>
            emit('startResizeVolume', e, {
              trackId: track.id,
              itemId: item.id,
              gain,
              trackHeight,
            })
        "
        @toggle-fade-curve="({ edge }) => toggleFadeCurve(edge)"
        @reset-volume="emit('resetVolume', { trackId: track.id, itemId: item.id })"
      />

      <!-- Content Area (Thumbnails / Waveform) -->
      <div class="flex-1 flex w-full min-h-0 relative" :style="{ zIndex: 'var(--z-clip-content)' }">
        <TimelineClipThumbnails
          v-if="isVideo(item) && clipItem?.showThumbnails !== false"
          :item="item as TimelineClipItem"
          :width="clipWidthPx"
          :scroll-left="scrollLeft ?? 0"
          :viewport-width="viewportWidth ?? 0"
          :clip-start-px="timeUsToPx(item.timelineRange.startUs, timelineStore.timelineZoom)"
        />
        <TimelineAudioWaveform
          v-if="
            isAudio(item) ||
            (isVideo(item) && clipHasAudio(item, track) && clipItem?.showWaveform !== false)
          "
          :item="item as TimelineClipItem"
        />

        <div
          v-if="clipItem"
          class="absolute bottom-0 left-0 right-0 flex items-end justify-center px-2 pb-0.5 pointer-events-none"
          :style="{ zIndex: 'var(--z-clip-name)' }"
        >
          <span class="truncate text-[10px] leading-tight opacity-70" :title="clipItem.name">{{
            clipItem.name
          }}</span>
        </div>

        <div
          v-if="currentSlipPreview"
          class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/80 px-2 py-1 text-[10px] font-medium text-white shadow-lg whitespace-nowrap pointer-events-none"
          :style="{ zIndex: 'var(--z-clip-guide)' }"
        >
          {{ currentSlipPreview.timecode }}
        </div>

        <div
          v-if="transitionInOverlayGuideStyle"
          class="absolute top-0 bottom-0 w-0 border-l-2 border-dashed border-yellow-400/95 pointer-events-none"
          :style="{ ...transitionInOverlayGuideStyle, zIndex: 'var(--z-clip-guide)' }"
        />

        <div
          v-if="transitionOutOverlayGuideStyle"
          class="absolute top-0 bottom-0 w-0 border-l-2 border-dashed border-cyan-400/95 pointer-events-none"
          :style="{ ...transitionOutOverlayGuideStyle, zIndex: 'var(--z-clip-guide)' }"
        />
      </div>

      <!-- Trim Handles -->
      <template v-if="clipItem && canEditClipContent && !clipItem.locked">
        <div
          class="absolute left-0 top-0 bottom-0 cursor-ew-resize bg-white/0 hover:bg-white/30 transition-colors group/trim"
          :style="{ zIndex: 'var(--z-clip-trim)' }"
          :class="isMobile ? 'w-4' : 'w-1.5'"
          @pointerdown="onTrimHandlePointerDown($event, 'start')"
        />
        <div
          class="absolute right-0 top-0 bottom-0 cursor-ew-resize bg-white/0 hover:bg-white/30 transition-colors group/trim"
          :style="{ zIndex: 'var(--z-clip-trim)' }"
          :class="isMobile ? 'w-4' : 'w-1.5'"
          @pointerdown="onTrimHandlePointerDown($event, 'end')"
        />
      </template>
    </div>
  </UContextMenu>
</template>
