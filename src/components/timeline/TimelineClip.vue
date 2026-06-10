<script setup lang="ts">
import { computed, nextTick, ref, useAttrs, inject } from 'vue';
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
import type { AppClipboardPayload } from '~/stores/clipboard.store';
import type { MediaMetadata } from '~/stores/media.store';
import type { TimelineClipClipboardItem } from '~/stores/timeline/clips';
import type { FastCatProjectSettings } from '~/utils/project-settings';
import type { TimelineContext } from './context';
import {
  timelineRangeToRoundedPx,
  timeUsToPx,
  calculatePointerTimeUs,
} from '~/utils/timeline/geometry';
import { formatStopFrameTimecode } from '~/utils/stop-frames';
import { sanitizeFps } from '~/timeline/commands/utils';
import { cloneValue } from '~/utils/clone';
import { useClipContextMenu } from '~/composables/timeline/useClipContextMenu';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';
import {
  getClipClass,
  getOverlayGuideOffsetPx,
  isVideo,
  isAudio,
  clipHasAudio,
} from '~/utils/timeline/clip';
import { useClipDrop } from '~/composables/timeline/useClipDrop';
import { useClipInteractions } from '~/composables/timeline/useClipInteractions';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { isClipFreePosition } from '~/utils/timeline/clip-checks';
import { useClickOrDrag } from '~/composables/timeline/useClickOrDrag';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { DEFAULT_TRANSITION_MODE } from '~/transitions';
import { computeTrimGeometry } from '~/timeline/commands/item/trimGeometry';

import ClipTransitions from './ClipTransitions.vue';
import ClipAudioFades from './ClipAudioFades.vue';
import ClipMetadata from './ClipMetadata.vue';
import TimelineClipContent from './TimelineClipContent.vue';
import TimelineClipTrimHandles from './TimelineClipTrimHandles.vue';
import ClipParametersPasteModal from '~/components/properties/clip/ClipParametersPasteModal.vue';
import { useClipParametersClipboard } from '~/composables/editor/useClipParametersClipboard';

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
  trimPreview?:
    | {
        itemId: string;
        trackId: string;
        startUs: number;
        durationUs: number;
        edge: 'start' | 'end';
        deltaUs: number;
      }[]
    | null;
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
const timelineContext = inject<TimelineContext>('timelineContext')!;

const isHovered = ref(false);
const isTransitionCreateHandleActive = ref(false);

const myTrimPreview = computed(() => {
  if (!props.trimPreview) return null;
  return props.trimPreview.find((p) => p.itemId === props.item.id) ?? null;
});

const effectiveTimelineRange = computed(() => {
  const preview = myTrimPreview.value;
  if (preview) {
    return { startUs: preview.startUs, durationUs: preview.durationUs };
  }
  return props.item.timelineRange;
});

const clipGeometry = computed(() =>
  timelineRangeToRoundedPx(effectiveTimelineRange.value, timelineContext.zoom.value, 2),
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
  const preview = myTrimPreview.value;
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

  const fps = sanitizeFps(timelineContext.timelineDoc.value?.timebase?.fps);
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

  timelineContext.updateClipProperties(props.track.id, props.item.id, {
    [curveProp]: nextCurve,
  });
  void timelineContext.requestTimelineSave({ immediate: true });
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
    if (props.isMobile && !timelineContext.selectedItemIds.value.includes(props.item.id))
      return false;
    emit('startMoveItem', e, {
      trackId: props.track.id,
      itemId: props.item.id,
      startUs: props.item.timelineRange.startUs,
      mode:
        timelineContext.toolbarDragModeEnabled.value &&
        timelineContext.toolbarDragMode.value === 'slip'
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
  if (timelineContext.isTrimModeActive.value) return;
  if (!props.canEditClipContent || !clipItem.value) return;

  timelineContext.setPanelFocus('timeline');

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
  isTrimModeActive: computed(() => timelineContext.isTrimModeActive.value),
  userSettings: computed(() => timelineContext.userSettings.value),
  selectTimelineItems: (ids) =>
    timelineContext.selectTimelineItems(
      ids.map((id) => ({ trackId: props.track.id, itemId: id, kind: 'clip' as const })),
    ),
  trimToPlayheadLeftNoRipple: (target) => void timelineContext.trimToPlayheadLeftNoRipple(target),
  trimToPlayheadRightNoRipple: (target) => void timelineContext.trimToPlayheadRightNoRipple(target),
  trimToTimeLeftNoRipple: (target, atUs) =>
    void timelineContext.trimToTimeLeftNoRipple(target, atUs),
  trimToTimeRightNoRipple: (target, atUs) =>
    void timelineContext.trimToTimeRightNoRipple(target, atUs),
  splitClipAtPlayhead: (target) => void timelineContext.splitClipAtPlayhead(target),
  splitClipAtTime: (target, atUs) => void timelineContext.splitClipAtTime(target, atUs),
  getPointerTimeUs: getClipPointerTimeUs,
  emitSelectItem: (e, itemId) => emit('selectItem', e, itemId),
  didStartDrag,
  longPressTriggered,
});

const effectiveSourceRange = computed(() => {
  const preview = myTrimPreview.value;
  if (preview && clipItem.value) {
    const fps = sanitizeFps(timelineContext.timelineDoc.value?.timebase?.fps);
    const hasFixedSourceDuration =
      (clipItem.value.clipType === 'media' && !clipItem.value.isImage) ||
      clipItem.value.clipType === 'timeline';

    const { sourceRange } = computeTrimGeometry({
      edge: preview.edge,
      deltaUs: preview.deltaUs,
      speed: clipItem.value.speed,
      fps,
      quantizeToFrames: false,
      timelineRange: clipItem.value.timelineRange,
      sourceRange: clipItem.value.sourceRange,
      sourceDurationUs: clipItem.value.sourceDurationUs,
      hasFixedSourceDuration,
    });
    return sourceRange;
  }
  return clipItem.value?.sourceRange ?? { startUs: 0, durationUs: 0 };
});

const effectiveClipItem = computed(() => {
  if (!clipItem.value) return null;
  return {
    ...clipItem.value,
    timelineRange: effectiveTimelineRange.value,
    sourceRange: effectiveSourceRange.value,
  };
});

function onClipClick(e: MouseEvent) {
  if (longPressTriggered.value) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  onClipClickInteraction(e);
}

const safeClip = computed(() => clipItem.value!);
const safeTrackKind = computed<TrackKind>(() => props.track.kind);

const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const uiStore = useUiStore();
const fileManagerStore = useFileManagerStore();
const selectionStore = useSelectionStore();
const focusStore = useFocusStore();
const fileManager = useFileManager();
const { setActiveTab } = useProjectTabsStore();

const { handleSelectInFileManager, handleOpenNestedTimeline } = useClipPropertiesActions({
  clip: computed(() => clipItem.value!),
  trackKind: computed(() => props.track.kind),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  timelineStore: timelineStore as any,
  projectStore,
  uiStore,
  fileManagerStore,
  selectionStore,
  focusStore,
  fileManager,
  setActiveTab,
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
    timelineContext.updateClipProperties(trackId, itemId, patch),
  updateClipTransition: (trackId, itemId, patch) =>
    timelineContext.updateClipTransition(trackId, itemId, patch),
  selectTimelineItem: (trackId, itemId, kind) =>
    timelineContext.selectTimelineItem(trackId, itemId, kind),
  selectTimelineTransition: (trackId, itemId, edge) =>
    timelineContext.selectTimelineTransition(trackId, itemId, edge),
  triggerScrollToEffects: () => timelineContext.triggerScrollToEffects(),
  defaultTransitionDurationUs: computed(
    () => timelineContext.userSettings.value.timeline.defaultTransitionDurationUs,
  ),
});

const isMutedOrDisabled = computed(() => {
  if (!clipItem.value) return false;
  return (
    Boolean(clipItem.value.disabled) ||
    Boolean(clipItem.value.audioMuted) ||
    Boolean(props.track.audioMuted)
  );
});

const isMediaMissing = computed(() => {
  if (
    !clipItem.value ||
    (clipItem.value.clipType !== 'media' && clipItem.value.clipType !== 'timeline')
  )
    return false;
  return timelineContext.missingPaths.value[clipItem.value.source.path] === true;
});

const isUnsupported = computed(() => {
  if (!clipItem.value || clipItem.value.clipType !== 'media') return false;
  const path = clipItem.value.source.path;
  const meta = timelineContext.mediaMetadata.value[path] as MediaMetadata | undefined;
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

const {
  isPasteParametersModalOpen,
  selectedParameterGroups,
  clipParameterGroupOptions,
  copyClipParameters,
  openPasteClipParameters,
  applyClipParameters,
} = useClipParametersClipboard({
  clip: safeClip,
  trackKind: safeTrackKind,
  updateClipProperties: (trackId, itemId, props) =>
    timelineContext.updateClipProperties(trackId, itemId, props),
  updateClipTransition: (trackId, itemId, patch) =>
    timelineContext.updateClipTransition(trackId, itemId, patch),
});

const { getHotkeyKbds } = useHotkeyLabel();

const { contextMenuItems } = useClipContextMenu({
  track: computed(() => props.track),
  item: computed(() => props.item),
  canEditClipContent: computed(() => props.canEditClipContent),
  getHotkeyKbds,
  timelineDoc: computed(() => timelineContext.timelineDoc.value),
  projectSettings: computed(
    () => timelineContext.projectSettings.value as unknown as FastCatProjectSettings,
  ),
  defaultTransitionDurationUs: computed(
    () => timelineContext.userSettings.value.timeline.defaultTransitionDurationUs,
  ),
  selectedItemIds: computed(() => timelineContext.selectedItemIds.value),
  applyTimelineCommand: (cmd) => timelineContext.applyTimeline(cmd) as string[],
  batchApplyTimeline: (cmds) => timelineContext.batchApplyTimeline(cmds) as string[],
  updateClipProperties: (trackId, itemId, p) =>
    timelineContext.updateClipProperties(trackId, itemId, p) as string[],
  updateClipTransition: (trackId, itemId, p) =>
    timelineContext.updateClipTransition(trackId, itemId, p) as string[],
  requestTimelineSave: (opts) => timelineContext.requestTimelineSave(opts),
  selectTransition: (p) => timelineContext.selectTransition(p),
  clearSelection: () => timelineContext.clearSelection(),
  selectTimelineTransition: (trackId, itemId, edge) =>
    timelineContext.selectTimelineTransition(trackId, itemId, edge),
  emitOpenSpeedModal: (p) => emit('openSpeedModal', p),
  emitClipAction: (p) => emit('clipAction', p),
  copySelectedClips: () => {
    timelineContext.setClipboardPayload({
      source: 'timeline',
      operation: 'copy',
      items: ((timelineContext.copySelectedClips() || []) as TimelineClipClipboardItem[]).map(
        (item) => ({
          sourceTrackId: item.sourceTrackId,
          clip: item.clip,
        }),
      ),
    });
  },
  cutSelectedClips: () => {
    timelineContext.setClipboardPayload({
      source: 'timeline',
      operation: 'cut',
      items: ((timelineContext.cutSelectedClips() || []) as TimelineClipClipboardItem[]).map(
        (item) => ({
          sourceTrackId: item.sourceTrackId,
          clip: item.clip,
        }),
      ),
    });
  },
  pasteClips: (insertStartUs?: number) => {
    const payload = timelineContext.clipboardPayload.value as AppClipboardPayload | null;
    if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
    void timelineContext.pasteClips({ insertStartUs });
    if (payload.operation === 'cut') timelineContext.setClipboardPayload(null);
  },
  get hasTimelineClipboard() {
    return timelineContext.hasTimelinePayload.value;
  },
  requestRenameClip: (payload) => {
    uiStore.pendingClipRename = payload;
  },
  copyClipParameters,
  pasteClipParameters: openPasteClipParameters,
  getClipParametersSnapshot: () => {
    const payload = timelineContext.clipboardPayload.value as AppClipboardPayload | null;
    return payload?.source === 'clipParameters' ? payload.snapshot : null;
  },
  t,
});

const isFreePosition = computed(() =>
  isClipFreePosition(
    clipItem.value,
    timelineContext.timelineDoc.value,
    timelineContext.fps.value || 30,
  ),
);

const transitionInOverlayGuideStyle = computed<Record<string, string> | null>(() => {
  const offsetPx = getOverlayGuideOffsetPx(
    props.track,
    clipItem.value,
    'in',
    clipWidthPx.value,
    (us) => timeUsToPx(us, timelineContext.zoom.value),
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
    (us) => timeUsToPx(us, timelineContext.zoom.value),
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
  return calculatePointerTimeUs({
    clientX: e.clientX,
    rectLeft: rect.left,
    rectWidth: rect.width,
    clipStartUs: props.item.timelineRange.startUs,
    zoom: timelineContext.zoom.value,
  });
}

function handleTransitionCreate(
  e: PointerEvent,
  payload: { edge: 'in' | 'out'; drag: boolean; pointerStartClientX?: number },
) {
  if (!clipItem.value || !props.canEditClipContent) return;

  const defaultUs = Math.max(
    0,
    Math.round(
      Number(timelineContext.userSettings.value.timeline.defaultTransitionDurationUs ?? 1_000_000),
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
    const docBeforeDrag = cloneValue(timelineContext.timelineDoc.value);

    const transitionPatch = {
      type: 'dissolve',
      durationUs: 0,
      mode: DEFAULT_TRANSITION_MODE,
      curve: 'linear' as const,
    };

    timelineContext.updateClipTransition(
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

    timelineContext.updateClipTransition(
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
          : timelineContext.selectedItemIds.value.includes(item.id)
            ? 'var(--z-clip-selected)'
            : isDraggingOver
              ? 'var(--z-clip-dragging-over)'
              : 'var(--z-clip-normal)',
        WebkitTouchCallout: isMobile ? 'none' : undefined,
      }"
      :class="[
        getClipClass(item, track),
        timelineContext.selectedItemIds.value.includes(item.id)
          ? 'outline-(--color-primary) outline-2 z-10 shadow-lg'
          : 'outline-transparent',
        clipItem && typeof clipItem.freezeFrameSourceUs === 'number'
          ? 'outline-(--color-warning) outline-2'
          : '',
        clipItem &&
        (Boolean(track.videoHidden) ||
          (timelineContext.timelineDoc.value?.tracks.some((t) => t.audioSolo) && !track.audioSolo))
          ? 'opacity-40'
          : isMutedOrDisabled
            ? 'opacity-60'
            : '',
        isMediaMissing ? 'bg-red-600! border-red-800! text-white!' : '',
        !isMediaMissing && isMutedOrDisabled
          ? 'bg-zinc-800/80! border-zinc-700/80!'
          : '',
        !isMediaMissing && isUnsupported ? 'bg-amber-600/50! border-amber-700!' : '',
        (clipItem && Boolean(clipItem.locked)) || track.locked ? 'cursor-not-allowed' : '',
        isMobile && timelineContext.selectedItemIds.value.includes(item.id) ? 'touch-none' : '',
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
          :zoom="timelineContext.zoom.value"
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
          v-if="clipItem && clipHasAudio(item, track, timelineContext.mediaMetadata.value)"
          :clip="clipItem"
          :item="item"
          :track="track"
          :track-height="trackHeight"
          :zoom="timelineContext.zoom.value"
          :clip-width-px="clipWidthPx"
          :can-edit="canEditClipContent"
          :is-dragging="isDraggingCurrentItem || isMovePreviewCurrentItem"
          :is-resizing-volume="resizeVolume?.itemId === item.id"
          :is-mobile="isMobile"
          :is-hovered="isHovered"
          :is-selected="timelineContext.selectedItemIds.value.includes(item.id)"
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

        <TimelineClipContent
          :item="item"
          :track="track"
          :clip-item="clipItem"
          :effective-clip-item="effectiveClipItem"
          :effective-timeline-start-us="effectiveTimelineRange.startUs"
          :clip-width-px="clipWidthPx"
          :zoom="timelineContext.zoom.value"
          :scroll-left="scrollLeft ?? 0"
          :viewport-width="viewportWidth ?? 0"
          :media-metadata="timelineContext.mediaMetadata.value"
          :slip-overlay="slipOverlay"
          :trim-overlay="trimOverlay"
          :transition-in-overlay-guide-style="transitionInOverlayGuideStyle"
          :transition-out-overlay-guide-style="transitionOutOverlayGuideStyle"
        />

        <!-- Trim Handles -->
        <TimelineClipTrimHandles
          v-if="clipItem && canEditClipContent && !clipItem.locked && !track.locked && !isMobile"
          :is-transition-create-handle-active="isTransitionCreateHandleActive"
          @trim-start="onTrimHandlePointerDown($event, 'start')"
          @trim-end="onTrimHandlePointerDown($event, 'end')"
        />
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
