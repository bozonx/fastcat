<script setup lang="ts">
import { computed, nextTick, ref, useAttrs } from 'vue';
import type {
  TimelineTrack,
  TimelineTrackItem,
  TimelineClipActionPayload,
  TimelineMoveItemPayload,
  TimelineOpenSpeedModalPayload,
  TimelineResizeFadePayload,
  TimelineResizeVolumePayload,
  TimelineTransitionSelection,
  TimelineTrimItemPayload,
  TrackKind,
} from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { pxToTimeUs, timelineRangeToRoundedPx, timeUsToPx } from '~/utils/timeline/geometry';
import { formatStopFrameTimecode } from '~/utils/stop-frames';
import { sanitizeFps } from '~/timeline/commands/utils';
import { cloneValue } from '~/utils/clone';
import { useClipContextMenu } from '~/composables/timeline/useClipContextMenu';
import {
  getClipClass,
  getOverlayGuideOffsetPx,
  isVideo,
  isAudio,
  clipHasAudio,
} from '~/utils/timeline/clip';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useClipDrop } from '~/composables/timeline/useClipDrop';
import { useClipInteractions } from '~/composables/timeline/useClipInteractions';
import { isClipFreePosition } from '~/utils/timeline/clip-checks';
import { useClickOrDrag } from '~/composables/timeline/useClickOrDrag';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { DEFAULT_TRANSITION_MODE } from '~/transitions';

import ClipTransitions from './ClipTransitions.vue';
import ClipAudioFades from './ClipAudioFades.vue';
import ClipMetadata from './ClipMetadata.vue';
import TimelineClipThumbnails from './TimelineClipThumbnails.vue';
import TimelineAudioWaveform from './audio/TimelineAudioWaveform.vue';
import ClipParametersPasteModal from '~/components/properties/clip/ClipParametersPasteModal.vue';
import {
  buildClipParametersPatch,
  createClipParametersSnapshot,
  getApplicableClipParameterGroups,
  hasClipParametersPatch,
  type ClipParameterGroup,
} from '~/utils/timeline/clip-parameters';

defineOptions({ inheritAttrs: false });

const attrs = useAttrs();

interface Props {
  track: TimelineTrack;
  item: TimelineTrackItem;
  trackHeight: number;
  canEditClipContent: boolean;
  isDraggingCurrentItem: boolean;
  isMovePreviewCurrentItem: boolean;
  isTrimPreviewCurrentItem?: boolean;
  isMovePreviewCollision?: boolean;
  slipPreview?: {
    itemId: string;
    trackId: string;
    deltaUs: number;
    timecode: string;
  } | null;
  trimPreview?: {
    itemId: string;
    trackId: string;
    startUs: number;
    durationUs: number;
    edge: 'start' | 'end';
    deltaUs: number;
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

interface SlipOverlayView {
  rangeStyle: Record<string, string>;
  deltaClass: string;
  direction: string;
  timecode: string;
  hasSourceRange: boolean;
}

interface TrimOverlayView {
  rangeStyle: Record<string, string>;
  direction: string;
  timecode: string;
  hasSourceRange: boolean;
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
const isTransitionCreateHandleActive = ref(false);

const effectiveTimelineRange = computed(() => {
  const preview = props.trimPreview;
  if (preview && preview.itemId === props.item.id) {
    return { startUs: preview.startUs, durationUs: preview.durationUs };
  }
  return props.item.timelineRange;
});

const clipGeometry = computed(() =>
  timelineRangeToRoundedPx(effectiveTimelineRange.value, timelineStore.timelineZoom, 2),
);
const clipWidthPx = computed(() => clipGeometry.value.widthPx);
const clipLeftPx = computed(() => clipGeometry.value.leftPx);
const currentSlipPreview = computed(() => {
  if (!props.slipPreview || props.slipPreview.itemId !== props.item.id) return null;
  return props.slipPreview;
});
const slipOverlay = computed<SlipOverlayView | null>(() => {
  const preview = currentSlipPreview.value;
  const clip = clipItem.value;
  if (!preview || !clip) return null;

  const sourceDurationUs = Math.max(0, Math.round(Number(clip.sourceDurationUs ?? 0)));
  const sourceRangeStartUs = Math.max(0, Math.round(Number(clip.sourceRange?.startUs ?? 0)));
  const sourceRangeDurationUs = Math.max(
    0,
    Math.round(Number(clip.sourceRange?.durationUs ?? clip.timelineRange.durationUs ?? 0)),
  );
  const hasSourceRange = sourceDurationUs > 0 && sourceDurationUs > sourceRangeDurationUs;
  const startPercent = hasSourceRange ? (sourceRangeStartUs / sourceDurationUs) * 100 : 0;
  const widthPercent = hasSourceRange ? (sourceRangeDurationUs / sourceDurationUs) * 100 : 100;

  return {
    rangeStyle: {
      left: `${Math.min(100, Math.max(0, startPercent))}%`,
      width: `${Math.min(100, Math.max(0, widthPercent))}%`,
    },
    deltaClass: preview.deltaUs === 0 ? 'text-white' : 'text-cyan-100',
    direction: preview.deltaUs < 0 ? '<' : preview.deltaUs > 0 ? '>' : '',
    timecode: preview.timecode,
    hasSourceRange,
  };
});

const trimOverlay = computed<TrimOverlayView | null>(() => {
  const preview = props.trimPreview;
  const clip = clipItem.value;
  if (!preview || preview.itemId !== props.item.id || !clip) return null;

  const sourceDurationUs = Math.max(0, Math.round(Number(clip.sourceDurationUs ?? 0)));
  const sourceRangeStartUs = Math.max(0, Math.round(Number(clip.sourceRange?.startUs ?? 0)));
  const sourceRangeDurationUs = Math.max(
    0,
    Math.round(Number(clip.sourceRange?.durationUs ?? clip.timelineRange.durationUs ?? 0)),
  );
  const hasSourceRange = sourceDurationUs > 0 && sourceDurationUs > sourceRangeDurationUs;
  const startPercent = hasSourceRange ? (sourceRangeStartUs / sourceDurationUs) * 100 : 0;
  const widthPercent = hasSourceRange ? (sourceRangeDurationUs / sourceDurationUs) * 100 : 100;

  const fps = sanitizeFps(timelineStore.timelineDoc?.timebase?.fps);
  const timecode = `${preview.deltaUs >= 0 ? '+' : '-'}${formatStopFrameTimecode({
    timeUs: Math.abs(preview.deltaUs),
    fps,
    frameDigits: 1,
  })}`;

  return {
    rangeStyle: {
      left: `${Math.min(100, Math.max(0, startPercent))}%`,
      width: `${Math.min(100, Math.max(0, widthPercent))}%`,
    },
    direction: preview.edge === 'start' ? '<' : '>',
    timecode,
    hasSourceRange,
  };
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
    // On mobile, contextmenu fires on long press (before pointercancel).
    // Use it as a fallback trigger for long press if our pointer-based timer was cancelled.
    if (props.isMobile && !longPressTriggered.value && !didStartDrag.value) {
      longPressTriggered.value = true;
      emit('clipAction', {
        action: 'longPress',
        trackId: props.track.id,
        itemId: props.item.id,
      });
    }
  }
}

const {
  didStartDrag,
  rightClickDragTriggered,
  rightClickPointerActive,
  longPressTriggered,
  onPointerDown,
} = useClickOrDrag({
  onDragStart: (e) => {
    if (clipItem.value?.locked || props.track.locked) return false;
    // On mobile, dragging is only allowed when the clip is already selected
    if (props.isMobile && !timelineStore.selectedItemIds.includes(props.item.id)) return false;
    emit('startMoveItem', e, {
      trackId: props.track.id,
      itemId: props.item.id,
      startUs: props.item.timelineRange.startUs,
      mode:
        settingsStore.toolbarDragModeEnabled && settingsStore.toolbarDragMode === 'slip'
          ? 'slip'
          : 'move',
    });
    return true;
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
  onLongPress: () => {
    if (props.isMobile) {
      emit('clipAction', {
        action: 'longPress',
        trackId: props.track.id,
        itemId: props.item.id,
      });
    }
  },
});

function onClipPointerdown(e: PointerEvent) {
  if (timelineStore.isTrimModeActive) return;
  if (!props.canEditClipContent || !clipItem.value) return;

  focusStore.setPanelFocus('timeline');

  if (props.isMobile && e.pointerType === 'touch') {
    e.stopPropagation();
    onPointerDown(e);
    return;
  }

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

const { clipItem, onClipClick: onClipClickInteraction } = useClipInteractions({
  track: computed(() => props.track),
  item: computed(() => props.item),
  canEditClipContent: computed(() => props.canEditClipContent),
  isTrimModeActive: computed(() => timelineStore.isTrimModeActive),
  userSettings: computed(() => workspaceStore.userSettings),
  selectTimelineItems: (ids) =>
    timelineStore.selectTimelineItems(
      ids.map((id) => ({ trackId: props.track.id, itemId: id, kind: 'clip' as const })),
    ),
  trimToPlayheadLeftNoRipple: (target) => void timelineStore.trimToPlayheadLeftNoRipple(target),
  trimToPlayheadRightNoRipple: (target) => void timelineStore.trimToPlayheadRightNoRipple(target),
  splitClipAtPlayhead: (target) => void timelineStore.splitClipAtPlayhead(target),
  splitClipAtTime: (target, atUs) => void timelineStore.splitClipAtTime(target, atUs),
  getPointerTimeUs: getClipPointerTimeUs,
  emitSelectItem: (e, itemId) => emit('selectItem', e, itemId),
  didStartDrag,
  longPressTriggered,
});

function onClipClick(e: MouseEvent) {
  if (longPressTriggered.value) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  onClipClickInteraction(e);
}

const focusStore = useFocusStore();
const fileManagerStore = useFileManagerStore();
const projectTabsStore = useProjectTabsStore();
const fileManager = useFileManager();
const isPasteParametersModalOpen = ref(false);
const selectedParameterGroups = ref<ClipParameterGroup[]>([]);
const pasteParametersTarget = ref<{
  clip: NonNullable<typeof clipItem.value>;
  trackKind: TrackKind;
} | null>(null);

const { handleSelectInFileManager, handleOpenNestedTimeline } = useClipPropertiesActions({
  clip: computed(() => clipItem.value!),
  trackKind: computed(() => props.track.kind),
  timelineStore,
  projectStore,
  uiStore,
  fileManagerStore,
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

const { isDraggingOver, handleDragLeave, handleDrop } = useClipDrop({
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

const isUnsupported = computed(() => {
  if (!clipItem.value || clipItem.value.clipType !== 'media') return false;
  const path = clipItem.value.source.path;
  const meta = mediaStore.mediaMetadata[path];
  if (!meta) return false;

  const isVideoType = isVideo(props.item, props.track);
  if (isVideoType) {
    if (meta.video?.canDecode === false) return true;
    if (meta.audio?.canDecode === false) return true;
    return false;
  }

  if (isAudio(props.item, props.track)) {
    if (meta.audio?.canDecode === false) return true;
  }

  return false;
});

const clipParameterGroupOptions = computed(() => {
  const payload = clipboardStore.clipboardPayload;
  const target = pasteParametersTarget.value;
  if (!payload || payload.source !== 'clipParameters' || !target) return [];
  return getApplicableClipParameterGroups({
    snapshot: payload.snapshot,
    targetClip: target.clip,
    targetTrackKind: target.trackKind,
  });
});

function copyClipParameters(clip: NonNullable<typeof clipItem.value>, trackKind: TrackKind) {
  clipboardStore.setClipboardPayload({
    source: 'clipParameters',
    snapshot: createClipParametersSnapshot({ clip, trackKind }),
  });
}

function openPasteClipParameters(clip: NonNullable<typeof clipItem.value>, trackKind: TrackKind) {
  const payload = clipboardStore.clipboardPayload;
  if (!payload || payload.source !== 'clipParameters') return;
  const groups = getApplicableClipParameterGroups({
    snapshot: payload.snapshot,
    targetClip: clip,
    targetTrackKind: trackKind,
  });
  if (groups.length === 0) return;
  pasteParametersTarget.value = { clip, trackKind };
  isPasteParametersModalOpen.value = true;
}

function applyClipParameters(groups: ClipParameterGroup[]) {
  const payload = clipboardStore.clipboardPayload;
  const target = pasteParametersTarget.value;
  if (!payload || payload.source !== 'clipParameters' || !target) return;

  const patch = buildClipParametersPatch({
    snapshot: payload.snapshot,
    targetClip: target.clip,
    targetTrackKind: target.trackKind,
    groups,
  });
  if (!hasClipParametersPatch(patch)) return;

  if (Object.keys(patch.properties).length > 0) {
    timelineStore.updateClipProperties(target.clip.trackId, target.clip.id, patch.properties);
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'transitionIn') ||
    Object.prototype.hasOwnProperty.call(patch, 'transitionOut')
  ) {
    timelineStore.updateClipTransition(target.clip.trackId, target.clip.id, {
      ...(Object.prototype.hasOwnProperty.call(patch, 'transitionIn')
        ? { transitionIn: patch.transitionIn }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'transitionOut')
        ? { transitionOut: patch.transitionOut }
        : {}),
    });
  }
}

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
      items: (timelineStore.copySelectedClips() || []).map((item) => ({
        sourceTrackId: item.sourceTrackId,
        clip: item.clip,
      })),
    });
  },
  cutSelectedClips: () => {
    clipboardStore.setClipboardPayload({
      source: 'timeline',
      operation: 'cut',
      items: (timelineStore.cutSelectedClips() || []).map((item) => ({
        sourceTrackId: item.sourceTrackId,
        clip: item.clip,
      })),
    });
  },
  pasteClips: (insertStartUs?: number) => {
    const payload = clipboardStore.clipboardPayload;
    if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
    void timelineStore.pasteClips(payload.items, { insertStartUs });
    if (payload.operation === 'cut') clipboardStore.setClipboardPayload(null);
  },
  get hasTimelineClipboard() {
    return clipboardStore.hasTimelinePayload;
  },
  copyClipParameters,
  pasteClipParameters: openPasteClipParameters,
  getClipParametersSnapshot: () => {
    const payload = clipboardStore.clipboardPayload;
    return payload?.source === 'clipParameters' ? payload.snapshot : null;
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

function getClipPointerTimeUs(e: MouseEvent): number | null {
  const el = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  const localX = Math.min(rect.width, Math.max(0, e.clientX - rect.left));
  return props.item.timelineRange.startUs + pxToTimeUs(localX, timelineStore.timelineZoom);
}

function handleTransitionCreate(
  e: PointerEvent,
  payload: { edge: 'in' | 'out'; drag: boolean; pointerStartClientX?: number },
) {
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
    // Clone upfront so the snapshot is independent of subsequent doc mutations.
    const docBeforeDrag = cloneValue(timelineStore.timelineDoc);

    const transitionPatch = {
      type: 'dissolve',
      durationUs: 0,
      mode: DEFAULT_TRANSITION_MODE,
      curve: 'linear' as const,
    };

    timelineStore.updateClipTransition(
      props.track.id,
      props.item.id,
      payload.edge === 'in'
        ? { transitionIn: transitionPatch }
        : { transitionOut: transitionPatch },
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

    emit('startResizeTransition', pointerEventSnapshot, {
      trackId: props.track.id,
      itemId: props.item.id,
      edge: payload.edge,
      durationUs: 0,
      pointerStartClientX: payload.pointerStartClientX,
      docBeforeDrag,
    });
  } else {
    const transitionPatch = {
      type: 'dissolve',
      durationUs: defaultDurationUs,
      mode: DEFAULT_TRANSITION_MODE,
      curve: 'linear' as const,
    };

    timelineStore.updateClipTransition(
      props.track.id,
      props.item.id,
      payload.edge === 'in'
        ? { transitionIn: transitionPatch }
        : { transitionOut: transitionPatch },
    );
  }
}
</script>

<template>
  <UContextMenu
    :items="contextMenuItems"
    :disabled="props.isMobile || rightClickPointerActive || rightClickDragTriggered"
  >
    <div
      :data-clip-id="item.kind === 'clip' ? item.id : undefined"
      :data-gap-id="item.kind === 'gap' ? item.id : undefined"
      class="absolute top-0.5 bottom-0.5 rounded flex flex-col text-xs text-(--clip-text) select-none transition-shadow group/clip"
      v-bind="attrs"
      :style="{
        left: `${clipLeftPx}px`,
        width: `${clipWidthPx}px`,
        zIndex: isHovered
          ? 'var(--z-clip-handles)'
          : timelineStore.selectedItemIds.includes(item.id)
            ? 'var(--z-clip-selected)'
            : isDraggingOver
              ? 'var(--z-clip-dragging-over)'
              : 'var(--z-clip-normal)',
        WebkitTouchCallout: isMobile ? 'none' : undefined,
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
        !isMediaMissing && clipItem && clipItem.disabled ? 'bg-red-500/40! border-red-400!' : '',
        !isMediaMissing && isUnsupported ? 'bg-amber-600/50! border-amber-700!' : '',
        (clipItem && Boolean(clipItem.locked)) || track.locked ? 'cursor-not-allowed' : '',
        isMobile ? 'touch-none' : '',
        isMovePreviewCollision ? 'bg-red-600/80! border-red-500! border-2! text-white! z-50!' : '',
      ]"
      @pointerdown="onClipPointerdown"
      @click.stop="onClipClick"
      @dblclick="onClipDblClick"
      @contextmenu="onContextMenu"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @pointerenter="isHovered = true"
      @pointerleave="isHovered = false"
    >
      <template v-if="!isMovePreviewCurrentItem">
        <!-- Indicators -->
        <div
          v-if="
            clipItem &&
            typeof clipItem.speed === 'number' &&
            clipItem.speed !== 1 &&
            !isMediaMissing
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
          :is-unsupported="isUnsupported"
          :clip-width-px="clipWidthPx"
        />

        <!-- Sub-components for Transitions and Fades -->
        <ClipTransitions
          v-if="clipItem"
          :clip="clipItem"
          :track="track"
          :zoom="timelineStore.timelineZoom"
          :clip-width-px="clipWidthPx"
          :track-height="trackHeight"
          :selected-transition="selectedTransition"
          :can-edit="canEditClipContent"
          :is-mobile="isMobile"
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
          @create-transition-handle-active="isTransitionCreateHandleActive = $event"
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
          :is-hovered="isHovered"
          :scroll-left="scrollLeft"
          :viewport-width="viewportWidth"
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
        <div
          class="flex-1 flex w-full min-h-0 relative"
          :style="{ zIndex: 'var(--z-clip-content)' }"
        >
          <TimelineClipThumbnails
            v-if="clipItem && isVideo(item, track) && clipItem.showThumbnails !== false"
            :item="clipItem"
            :width="clipWidthPx"
            :scroll-left="scrollLeft ?? 0"
            :viewport-width="viewportWidth ?? 0"
            :clip-start-px="timeUsToPx(item.timelineRange.startUs, timelineStore.timelineZoom)"
          />
          <TimelineAudioWaveform
            v-if="
              clipItem &&
              clipItem.showWaveform !== false &&
              (isAudio(item, track) ||
                (isVideo(item, track) && clipHasAudio(item, track, mediaStore.mediaMetadata)))
            "
            :item="clipItem"
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
            v-if="slipOverlay"
            class="absolute inset-0 rounded bg-cyan-950/35 ring-1 ring-cyan-300/70 pointer-events-none overflow-hidden"
            :style="{ zIndex: 'var(--z-clip-guide)' }"
            :title="t('fastcat.timeline.slipMode')"
            data-slip-overlay
          >
            <div
              class="absolute inset-x-1.5 top-1 h-1.5 rounded-full bg-black/45 ring-1 ring-white/15"
            >
              <div
                v-if="slipOverlay.hasSourceRange"
                class="absolute top-0 bottom-0 min-w-2 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.75)]"
                :style="slipOverlay.rangeStyle"
                data-slip-source-range
              />
              <div v-else class="absolute inset-0 rounded-full bg-cyan-300/85" />
            </div>
            <div
              class="absolute left-1/2 top-1/2 flex max-w-[calc(100%-8px)] -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded border border-cyan-200/35 bg-black/85 px-2 py-1 text-2xs font-semibold tabular-nums text-white shadow-lg whitespace-nowrap"
              :class="slipOverlay.deltaClass"
              data-slip-timecode
            >
              <span v-if="slipOverlay.direction" class="text-cyan-300">{{
                slipOverlay.direction
              }}</span>
              <span>{{ slipOverlay.timecode }}</span>
            </div>
            <div class="absolute inset-x-1.5 bottom-1 flex justify-between">
              <span class="h-2 w-px rounded-full bg-cyan-200/80" />
              <span class="h-2 w-px rounded-full bg-cyan-200/80" />
            </div>
          </div>

          <div
            v-if="trimOverlay"
            class="absolute inset-0 rounded bg-amber-950/35 ring-1 ring-amber-300/70 pointer-events-none overflow-hidden"
            :style="{ zIndex: 'var(--z-clip-guide)' }"
            :title="t('fastcat.timeline.trimOverlayMode')"
            data-trim-overlay
          >
            <div
              class="absolute inset-x-1.5 top-1 h-1.5 rounded-full bg-black/45 ring-1 ring-white/15"
            >
              <div
                v-if="trimOverlay.hasSourceRange"
                class="absolute top-0 bottom-0 min-w-2 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.75)]"
                :style="trimOverlay.rangeStyle"
                data-trim-source-range
              />
              <div v-else class="absolute inset-0 rounded-full bg-amber-300/85" />
            </div>
            <div
              class="absolute left-1/2 top-1/2 flex max-w-[calc(100%-8px)] -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded border border-amber-200/35 bg-black/85 px-2 py-1 text-2xs font-semibold tabular-nums text-white shadow-lg whitespace-nowrap"
              data-trim-timecode
            >
              <span v-if="trimOverlay.direction" class="text-amber-300">{{
                trimOverlay.direction
              }}</span>
              <span>{{ trimOverlay.timecode }}</span>
            </div>
            <div class="absolute inset-x-1.5 bottom-1 flex justify-between">
              <span class="h-2 w-px rounded-full bg-amber-200/80" />
              <span class="h-2 w-px rounded-full bg-amber-200/80" />
            </div>
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
        <template
          v-if="clipItem && canEditClipContent && !clipItem.locked && !track.locked && !isMobile"
        >
          <div
            class="absolute left-0 top-0 bottom-0 cursor-ew-resize bg-white/0 transition-colors group/trim"
            :style="{ zIndex: 'var(--z-clip-trim)' }"
            :class="[
              isMobile ? 'w-4' : 'w-4',
              isTransitionCreateHandleActive ? '' : 'hover:bg-white/30',
            ]"
            @pointerdown="onTrimHandlePointerDown($event, 'start')"
          />
          <div
            class="absolute right-0 top-0 bottom-0 cursor-ew-resize bg-white/0 transition-colors group/trim"
            :style="{ zIndex: 'var(--z-clip-trim)' }"
            :class="[
              isMobile ? 'w-4' : 'w-4',
              isTransitionCreateHandleActive ? '' : 'hover:bg-white/30',
            ]"
            @pointerdown="onTrimHandlePointerDown($event, 'end')"
          />
        </template>
      </template>
    </div>
  </UContextMenu>

  <ClipParametersPasteModal
    v-model:open="isPasteParametersModalOpen"
    v-model:selected-groups="selectedParameterGroups"
    :groups="clipParameterGroupOptions"
    @apply="applyClipParameters"
  />
</template>
