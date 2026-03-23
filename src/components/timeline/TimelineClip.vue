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
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { timeUsToPx, sanitizeFps } from '~/utils/timeline/geometry';
import { useClipContextMenu } from '~/composables/timeline/useClipContextMenu';
import {
  getClipClass,
  getOverlayGuideOffsetPx,
  isVideo,
  isAudio,
  clipHasAudio,
} from '~/utils/timeline/clip';
import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useClipDrop } from '~/composables/timeline/useClipDrop';
import { useClipInteractions } from '~/composables/timeline/useClipInteractions';
import { isClipFreePosition } from '~/utils/timeline/clipChecks';
import { useClickOrDrag } from '~/composables/timeline/useClickOrDrag';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useFocusStore } from '~/stores/focus.store';
import { useEditorViewStore } from '~/stores/editor-view.store';
import { useFilesPageStore } from '~/stores/files-page.store';
import { useProjectTabsStore } from '~/stores/tabs.store';
import { useAppClipboard } from '~/composables/useAppClipboard';

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
const clipboardStore = useAppClipboard();

const isHovered = ref(false);

const clipWidthPx = computed(() =>
  Math.max(2, timeUsToPx(props.item.timelineRange.durationUs, timelineStore.timelineZoom)),
);
const currentSlipPreview = computed(() => {
  if (!props.slipPreview || props.slipPreview.itemId !== props.item.id) return null;
  return props.slipPreview;
});

function toggleFadeCurve(edge: 'in' | 'out') {
  if (!clipItem.value || !props.canEditClipContent) return;

  const curveProp = edge === 'in' ? 'audioFadeInCurve' : 'audioFadeOutCurve';
  const currentCurve = clipItem.value[curveProp] === 'logarithmic' ? 'logarithmic' : 'linear';
  const nextCurve = currentCurve === 'logarithmic' ? 'linear' : 'logarithmic';

  timelineStore.updateClipProperties(props.track.id, props.item.id, {
    [curveProp]: nextCurve,
  });
  void timelineStore.requestTimelineSave({ immediate: true });
}

function onContextMenu(e: MouseEvent) {
  // Always block native contextmenu (isTrusted=true) — let only synthetic events through
  if (e.isTrusted) {
    e.preventDefault();
    e.stopPropagation();
  }
}

const { didStartDrag, rightClickDragTriggered, rightClickPointerActive, onPointerDown } =
  useClickOrDrag({
    onDragStart: (e) => {
      if (clipItem.value?.locked || props.track.locked) return;
      emit('startMoveItem', e, {
        trackId: props.track.id,
        itemId: props.item.id,
        startUs: props.item.timelineRange.startUs,
        mode:
          settingsStore.toolbarDragModeEnabled && settingsStore.toolbarDragMode === 'slip'
            ? 'slip'
            : 'move',
      });
    },
    onShortRightClick: (e) => {
      const target = e.target as HTMLElement | null;
      void nextTick().then(() => {
        target?.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: e.clientX,
            clientY: e.clientY,
          }),
        );
      });
    },
  });

function onClipPointerdown(e: PointerEvent) {
  if (timelineStore.isTrimModeActive) return;
  if (!props.canEditClipContent || !clipItem.value) return;

  focusStore.setPanelFocus('timeline');

  e.stopPropagation();
  onPointerDown(e);
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

const { clipItem, onClipClick } = useClipInteractions({
  track: computed(() => props.track),
  item: computed(() => props.item),
  canEditClipContent: computed(() => props.canEditClipContent),
  isTrimModeActive: computed(() => timelineStore.isTrimModeActive),
  userSettings: computed(() => workspaceStore.userSettings),
  selectTimelineItems: (ids) => timelineStore.selectTimelineItems(ids.map(id => ({ trackId: props.track.id, itemId: id, kind: 'clip' }))),
  trimToPlayheadLeftNoRipple: (target) => void timelineStore.trimToPlayheadLeftNoRipple(target),
  trimToPlayheadRightNoRipple: (target) => void timelineStore.trimToPlayheadRightNoRipple(target),
  splitClipAtPlayhead: (target) => void timelineStore.splitClipAtPlayhead(target),
  emitSelectItem: (e, itemId) => emit('selectItem', e, itemId),
  didStartDrag,
});

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
  copySelectedClips: () => {
    clipboardStore.setClipboardPayload({
      source: 'timeline',
      operation: 'copy',
      items: timelineStore.copySelectedClips().map((item) => ({
        sourceTrackId: item.sourceTrackId,
        clip: item.clip,
      })),
    });
  },
  cutSelectedClips: () => {
    clipboardStore.setClipboardPayload({
      source: 'timeline',
      operation: 'cut',
      items: timelineStore.cutSelectedClips().map((item) => ({
        sourceTrackId: item.sourceTrackId,
        clip: item.clip,
      })),
    });
  },
  pasteClips: (insertStartUs?: number) => {
    const payload = clipboardStore.clipboardPayload;
    if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
    timelineStore.pasteClips(payload.items, { insertStartUs });
    if (payload.operation === 'cut') clipboardStore.setClipboardPayload(null);
  },
  get hasTimelineClipboard() {
    return clipboardStore.hasTimelinePayload;
  },
  t,
});

const isFreePosition = computed(() =>
  isClipFreePosition(clipItem.value, timelineStore.timelineDoc, timelineStore.fps || 30),
);

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
  const defaultDurationUs = Math.min(
    defaultUs,
    Math.round(clipItem.value.timelineRange.durationUs * 0.3),
  );

  if (payload.drag) {
    // Create at 0 duration so the transition length matches the mouse position from the start.
    // Capture snapshot BEFORE creating so undo restores to "no transition" state.
    // History will be recorded on drag release by startResizeTransition.
    const docBeforeDrag = timelineStore.timelineDoc;

    const transitionPatch = {
      type: 'dissolve',
      durationUs: 0,
      mode: 'adjacent' as const,
      curve: 'linear' as const,
    };

    timelineStore.updateClipTransition(
      props.track.id,
      props.item.id,
      payload.edge === 'in' ? { transitionIn: transitionPatch } : { transitionOut: transitionPatch },
      { skipHistory: true, saveMode: 'none' },
    );

    const pointerEventSnapshot = {
      clientX: e.clientX,
      clientY: e.clientY,
      button: e.button,
      buttons: e.buttons,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      stopPropagation: () => {},
      preventDefault: () => {},
    } as PointerEvent;

    // Defer starting drag to give Vue time to render the transition element
    window.setTimeout(() => {
      emit('startResizeTransition', pointerEventSnapshot, {
        trackId: props.track.id,
        itemId: props.item.id,
        edge: payload.edge,
        durationUs: 0,
        docBeforeDrag,
      });
    }, 0);
  } else {
    const transitionPatch = {
      type: 'dissolve',
      durationUs: defaultDurationUs,
      mode: 'adjacent' as const,
      curve: 'linear' as const,
    };

    timelineStore.updateClipTransition(
      props.track.id,
      props.item.id,
      payload.edge === 'in' ? { transitionIn: transitionPatch } : { transitionOut: transitionPatch },
    );
  }
}
</script>

<template>
  <UContextMenu :items="contextMenuItems" :disabled="rightClickPointerActive || rightClickDragTriggered">
    <div
      :data-clip-id="item.kind === 'clip' ? item.id : undefined"
      :data-gap-id="item.kind === 'gap' ? item.id : undefined"
      class="absolute top-0.5 bottom-0.5 rounded flex flex-col text-xs text-(--clip-text) select-none transition-shadow group/clip"
      :style="{
        left: `${timeUsToPx(item.timelineRange.startUs, timelineStore.timelineZoom)}px`,
        width: `${clipWidthPx}px`,
        zIndex: isHovered
          ? 'var(--z-clip-handles)'
          : timelineStore.selectedItemIds.includes(item.id)
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
        (clipItem && Boolean(clipItem.locked)) || track.locked ? 'cursor-not-allowed' : '',
        isMobile ? 'touch-manipulation' : '',
      ]"
      @pointerdown="onClipPointerdown"
      @click="onClipClick"
      @dblclick="onClipDblClick"
      @contextmenu.capture="onContextMenu"
      @contextmenu.stop
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @pointerenter="isHovered = true"
      @pointerleave="isHovered = false"
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
      <div
        v-if="track.locked || (clipItem && clipItem.locked)"
        class="absolute inset-0 rounded hatching-diagonal pointer-events-none"
        :style="{ zIndex: 'var(--z-clip-handles)' }"
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
        v-if="clipItem && clipHasAudio(item, track, mediaStore.mediaMetadata)"
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
          v-if="isVideo(item, track) && clipItem?.showThumbnails !== false"
          :item="item as TimelineClipItem"
          :width="clipWidthPx"
          :scroll-left="scrollLeft ?? 0"
          :viewport-width="viewportWidth ?? 0"
          :clip-start-px="timeUsToPx(item.timelineRange.startUs, timelineStore.timelineZoom)"
        />
        <TimelineAudioWaveform
          v-if="
            isAudio(item, track) ||
            (isVideo(item, track) &&
              clipHasAudio(item, track, mediaStore.mediaMetadata) &&
              clipItem?.showWaveform !== false)
          "
          :item="item as TimelineClipItem"
        />

        <div
          v-if="clipItem"
          class="absolute bottom-0 left-0 right-0 flex items-end justify-center px-2 pb-0.5 pointer-events-none"
          :style="{ zIndex: 'var(--z-clip-name)' }"
        >
          <span class="truncate text-2xs leading-tight opacity-70" :title="clipItem.name">{{
            clipItem.name
          }}</span>
        </div>

        <div
          v-if="currentSlipPreview"
          class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/80 px-2 py-1 text-2xs font-medium text-white shadow-lg whitespace-nowrap pointer-events-none"
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
      <template v-if="clipItem && canEditClipContent && !clipItem.locked && !track.locked">
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
