<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type {
  TimelineTrack,
  TimelineTrackItem,
  TimelineClipItem,
  ClipEffect,
} from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { timeUsToPx } from '~/utils/timeline/geometry';
import { useClipContextMenu } from '~/composables/timeline/useClipContextMenu';
import { clampHandlePx, getClipClass, transitionSvgParts } from '~/utils/timeline/clip';
import { getEffectManifest } from '~/effects';
import { sanitizeFps } from '~/timeline/commands/utils';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const projectStore = useProjectStore();
const mediaStore = useMediaStore();
const uiStore = useUiStore();

const isDraggingOver = ref(false);

let activeClipPointerMove: ((e: PointerEvent) => void) | null = null;
let activeClipPointerUp: ((e?: PointerEvent) => void) | null = null;
let didStartClipDrag = false;

function handleDragEnter(event: DragEvent) {
  if (event.dataTransfer?.types.includes('gran-effect')) {
    isDraggingOver.value = true;
  }
}

function handleDragLeave() {
  isDraggingOver.value = false;
}

function handleDragOver(event: DragEvent) {
  if (event.dataTransfer?.types.includes('gran-effect')) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }
}

function handleDrop(event: DragEvent) {
  isDraggingOver.value = false;
  const effectType = event.dataTransfer?.getData('gran-effect');
  if (!effectType || !clipItem.value) return;

  const manifest = getEffectManifest(effectType);
  if (!manifest) return;

  const newEffect = {
    id: `effect_${Date.now()}`,
    type: effectType,
    enabled: true,
    ...manifest.defaultValues,
  } as unknown as ClipEffect;

  const currentEffects = clipItem.value.effects || [];
  timelineStore.updateClipProperties(props.track.id, props.item.id, {
    effects: [newEffect, ...currentEffects],
  });

  // Select the clip
  selectionStore.selectTimelineItem(props.track.id, props.item.id, props.item.kind as 'clip');

  // Trigger scroll to effects
  setTimeout(() => {
    uiStore.triggerScrollToEffects();
  }, 50);

  event.preventDefault();
  event.stopPropagation();
}

function clearActiveClipPointerListeners() {
  if (activeClipPointerMove) {
    window.removeEventListener('pointermove', activeClipPointerMove);
    activeClipPointerMove = null;
  }
  if (activeClipPointerUp) {
    window.removeEventListener('pointerup', activeClipPointerUp as any);
    activeClipPointerUp = null;
  }
}

interface Props {
  track: TimelineTrack;
  item: TimelineTrackItem;
  trackHeight: number;
  isDraggingCurrentItem: boolean;
  isMovePreviewCurrentItem: boolean;
  selectedTransition: { trackId: string; itemId: string; edge: 'in' | 'out' } | null;
  resizeVolume: {
    itemId: string;
    trackId: string;
    startGain: number;
    startY: number;
    trackHeight: number;
  } | null;
}

const props = defineProps<Props>();

interface ClipActionPayload {
  action: 'extractAudio' | 'returnAudio' | 'freezeFrame' | 'resetFreezeFrame';
  trackId: string;
  itemId: string;
  videoItemId?: string;
}

const emit = defineEmits<{
  (e: 'selectItem', event: PointerEvent, itemId: string): void;
  (e: 'startMoveItem', event: PointerEvent, trackId: string, itemId: string, startUs: number): void;
  (
    e: 'startTrimItem',
    event: PointerEvent,
    payload: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number },
  ): void;
  (
    e: 'startResizeVolume',
    event: PointerEvent,
    trackId: string,
    itemId: string,
    gain: number,
    height: number,
  ): void;
  (
    e: 'startResizeFade',
    event: PointerEvent,
    trackId: string,
    itemId: string,
    edge: 'in' | 'out',
    durationUs: number,
  ): void;
  (
    e: 'startResizeTransition',
    event: PointerEvent,
    trackId: string,
    itemId: string,
    edge: 'in' | 'out',
    durationUs: number,
  ): void;
  (
    e: 'selectTransition',
    event: MouseEvent | PointerEvent,
    payload: { trackId: string; itemId: string; edge: 'in' | 'out' },
  ): void;
  (e: 'clipAction', payload: ClipActionPayload): void;
  (e: 'openSpeedModal', payload: { trackId: string; itemId: string; speed: number }): void;
  (e: 'resetVolume', trackId: string, itemId: string): void;
}>();

// Narrowed clip reference — null when item is a gap
const clipItem = computed<TimelineClipItem | null>(() =>
  props.item.kind === 'clip' ? (props.item as TimelineClipItem) : null,
);

let activeTransitionPointerMove: ((e: PointerEvent) => void) | null = null;
let activeTransitionPointerUp: ((e?: PointerEvent) => void) | null = null;

function clearActiveTransitionPointerListeners() {
  if (activeTransitionPointerMove) {
    window.removeEventListener('pointermove', activeTransitionPointerMove);
    activeTransitionPointerMove = null;
  }
  if (activeTransitionPointerUp) {
    window.removeEventListener('pointerup', activeTransitionPointerUp as any);
    activeTransitionPointerUp = null;
  }
}

function onTransitionPointerdown(e: PointerEvent) {
  if (!clipItem.value || Boolean(clipItem.value.locked)) return;
  const startX = e.clientX;
  const startY = e.clientY;

  clearActiveTransitionPointerListeners();

  function onPointerMove(ev: PointerEvent) {
    const dx = Math.abs(ev.clientX - startX);
    const dy = Math.abs(ev.clientY - startY);
    if (dx > 3 || dy > 3) {
      clearActiveTransitionPointerListeners();
      emit(
        'startMoveItem',
        ev,
        props.item.trackId,
        props.item.id,
        props.item.timelineRange.startUs,
      );
    }
  }

  function onPointerUp() {
    clearActiveTransitionPointerListeners();
  }

  activeTransitionPointerMove = onPointerMove;
  activeTransitionPointerUp = onPointerUp;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function onClipClick(e: MouseEvent) {
  if (didStartClipDrag) {
    didStartClipDrag = false;
    return;
  }

  if (e.button !== 1) {
    emit('selectItem', e as unknown as PointerEvent, props.item.id);
    // Selection logic is handled in the parent component via the selectItem event
  }
}

function onClipPointerdown(e: PointerEvent) {
  if (e.button !== 0) return;
  if (!clipItem.value || Boolean(clipItem.value.locked)) return;

  didStartClipDrag = false;

  const targetEl = e.currentTarget as HTMLElement | null;
  targetEl?.setPointerCapture(e.pointerId);

  const startX = e.clientX;
  const startY = e.clientY;

  clearActiveClipPointerListeners();

  function onPointerMove(ev: PointerEvent) {
    const dx = Math.abs(ev.clientX - startX);
    const dy = Math.abs(ev.clientY - startY);
    if (dx > 3 || dy > 3) {
      didStartClipDrag = true;
      clearActiveClipPointerListeners();
      emit('startMoveItem', e, props.item.trackId, props.item.id, props.item.timelineRange.startUs);
    }
  }

  function onPointerUp() {
    clearActiveClipPointerListeners();
  }

  activeClipPointerMove = onPointerMove;
  activeClipPointerUp = onPointerUp;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

onBeforeUnmount(() => {
  clearActiveTransitionPointerListeners();
  clearActiveClipPointerListeners();
});

const clipWidthPx = computed(() => {
  return Math.max(2, timeUsToPx(props.item.timelineRange.durationUs, timelineStore.timelineZoom));
});

function isVideo(item: TimelineTrackItem): item is TimelineClipItem {
  return item.kind === 'clip' && item.clipType === 'media' && props.track.kind === 'video';
}

function isAudio(item: TimelineTrackItem): item is TimelineClipItem {
  return item.kind === 'clip' && item.clipType === 'media' && props.track.kind === 'audio';
}

function clipHasAudio(item: TimelineTrackItem, track: TimelineTrack): boolean {
  if (item.kind !== 'clip') return false;
  const clip = item as TimelineClipItem;
  if (track.kind === 'video' && clip.audioFromVideoDisabled) return false;
  if (clip.clipType !== 'media' && clip.clipType !== 'timeline') return track.kind === 'audio';
  if (!clip.source?.path) return track.kind === 'audio';
  const meta = mediaStore.mediaMetadata[clip.source.path];
  return Boolean(meta?.audio) || track.kind === 'audio';
}

function shouldCollapseTransitions(item: TimelineTrackItem): boolean {
  if (item.kind !== 'clip') return false;
  const clip = item as TimelineClipItem;
  const inUs = clip.transitionIn?.durationUs ?? 0;
  const outUs = clip.transitionOut?.durationUs ?? 0;
  if (inUs === 0 && outUs === 0) return false;

  const clipDurationUs = clip.timelineRange.durationUs;
  const hitEachOther = inUs + outUs > clipDurationUs + 1000;

  const clipUnstretchedPx = timeUsToPx(clipDurationUs, timelineStore.timelineZoom);
  const clipWidth = Math.max(2, clipUnstretchedPx);

  if (hitEachOther && clipWidth > clipUnstretchedPx + 1) return true;

  const inPx = inUs > 0 ? transitionUsToPx(inUs) : 0;
  const outPx = outUs > 0 ? transitionUsToPx(outUs) : 0;
  if (inPx + outPx > clipWidth) return true;

  return false;
}

function transitionUsToPx(us: number) {
  return timeUsToPx(us, timelineStore.timelineZoom);
}

function shouldCollapseFades(item: TimelineTrackItem): boolean {
  if (item.kind !== 'clip') return false;
  const clip = item as TimelineClipItem;
  const inUs = clip.audioFadeInUs ?? 0;
  const outUs = clip.audioFadeOutUs ?? 0;
  if (inUs === 0 && outUs === 0) return false;

  const clipDurationUs = clip.timelineRange.durationUs;
  const hitEachOther = inUs > 0 && outUs > 0 && inUs + outUs > clipDurationUs - 1000;

  const clipUnstretchedPx = timeUsToPx(clipDurationUs, timelineStore.timelineZoom);
  const clipWidth = Math.max(2, clipUnstretchedPx);

  if (hitEachOther && clipWidth > clipUnstretchedPx + 1) return true;

  const inPx = timeUsToPx(inUs, timelineStore.timelineZoom);
  const outPx = timeUsToPx(outUs, timelineStore.timelineZoom);
  if (inPx + outPx > clipWidth) return true;

  return false;
}

function getPrevClipForItem(
  track: TimelineTrack,
  item: TimelineTrackItem,
): TimelineClipItem | null {
  const clips = track.items.filter((it): it is TimelineClipItem => it.kind === 'clip');
  const idx = clips.findIndex((c) => c.id === item.id);
  if (idx <= 0) return null;
  return clips[idx - 1] ?? null;
}

function getNextClipForItem(
  track: TimelineTrack,
  item: TimelineTrackItem,
): TimelineClipItem | null {
  const clips = track.items.filter((it): it is TimelineClipItem => it.kind === 'clip');
  const idx = clips.findIndex((c) => c.id === item.id);
  if (idx < 0 || idx >= clips.length - 1) return null;
  return clips[idx + 1] ?? null;
}

function isCrossfadeTransitionIn(track: TimelineTrack, item: TimelineClipItem): boolean {
  if (track.kind !== 'video') return false;
  const prev = getPrevClipForItem(track, item);
  if (!prev) return false;

  const gapUs =
    item.timelineRange.startUs - (prev.timelineRange.startUs + prev.timelineRange.durationUs);
  if (gapUs > 1000) return false;

  const transIn = item.transitionIn;
  if (!transIn) return false;
  return transIn.mode === 'blend';
}

function hasTransitionInProblem(track: TimelineTrack, item: TimelineTrackItem): string | null {
  if (item.kind !== 'clip') return null;
  const clip = item as TimelineClipItem;
  const tr = clip.transitionIn;
  if (!tr) return null;
  const mode = tr.mode ?? 'blend';

  if (mode === 'blend') {
    const prev = getPrevClipForItem(track, item);
    if (!prev)
      return t(
        'granVideoEditor.timeline.transition.errorNoPreviousClip',
        'No previous clip to blend with',
      );
    const prevEndUs = prev.timelineRange.startUs + prev.timelineRange.durationUs;
    const gapUs = clip.timelineRange.startUs - prevEndUs;
    if (gapUs > 1_000)
      return t('granVideoEditor.timeline.transition.errorGapBetweenClips', {
        gapSeconds: (gapUs / 1e6).toFixed(2),
      });
    const prevDurS = prev.timelineRange.durationUs / 1e6;
    const needS = tr.durationUs / 1e6;
    if (prevDurS < needS)
      return t('granVideoEditor.timeline.transition.errorPrevClipTooShort', {
        needSeconds: needS.toFixed(2),
        haveSeconds: prevDurS.toFixed(2),
      });
    if (prev.clipType === 'media') {
      const prevSourceEnd = (prev.sourceRange?.startUs ?? 0) + (prev.sourceRange?.durationUs ?? 0);
      const prevTimelineEnd = prev.timelineRange.durationUs;
      const handleUs = prevSourceEnd - prevTimelineEnd;
      if (handleUs < tr.durationUs - 1_000)
        return t('granVideoEditor.timeline.transition.errorPrevHandleTooShort', {
          needSeconds: needS.toFixed(2),
          haveSeconds: Math.max(0, handleUs / 1e6).toFixed(2),
        });
    }
    return null;
  }

  return null;
}

function hasTransitionOutProblem(track: TimelineTrack, item: TimelineTrackItem): string | null {
  if (item.kind !== 'clip') return null;
  const clip = item as TimelineClipItem;
  const tr = clip.transitionOut;
  if (!tr) return null;
  const mode = tr.mode ?? 'blend';

  if (mode === 'blend') {
    const next = getNextClipForItem(track, item);
    if (!next)
      return t('granVideoEditor.timeline.transition.errorNoNextClip', 'No next clip to blend with');
    const clipEndUs = clip.timelineRange.startUs + clip.timelineRange.durationUs;
    const gapUs = next.timelineRange.startUs - clipEndUs;
    if (gapUs > 1_000)
      return t('granVideoEditor.timeline.transition.errorGapBetweenClips', {
        gapSeconds: (gapUs / 1e6).toFixed(2),
      });
    const clipDurS = clip.timelineRange.durationUs / 1e6;
    const needS = tr.durationUs / 1e6;
    if (clipDurS < needS)
      return t('granVideoEditor.timeline.transition.errorClipTooShort', {
        needSeconds: needS.toFixed(2),
        haveSeconds: clipDurS.toFixed(2),
      });
  }

  return null;
}

const trackRef = computed(() => props.track);
const itemRef = computed(() => props.item);
const timelineDocRef = computed(() => timelineStore.timelineDoc);
const projectSettingsRef = computed(() => projectStore.projectSettings);

const isMediaMissing = computed(() => {
  if (
    !clipItem.value ||
    (clipItem.value.clipType !== 'media' && clipItem.value.clipType !== 'timeline')
  )
    return false;
  return mediaStore.missingPaths[clipItem.value.source.path] === true;
});

const selectedItemIdsRef = computed(() => timelineStore.selectedItemIds);

const { contextMenuItems } = useClipContextMenu({
  track: trackRef,
  item: itemRef,
  timelineDoc: timelineDocRef,
  projectSettings: projectSettingsRef,
  selectedItemIds: selectedItemIdsRef,
  applyTimelineCommand: (cmd) => timelineStore.applyTimeline(cmd),
  batchApplyTimeline: (cmds) => timelineStore.batchApplyTimeline(cmds),
  updateClipProperties: (trackId, itemId, p) =>
    timelineStore.updateClipProperties(trackId, itemId, p),
  updateClipTransition: (trackId, itemId, p) =>
    timelineStore.updateClipTransition(trackId, itemId, p),
  requestTimelineSave: (opts) => timelineStore.requestTimelineSave(opts),
  selectTransition: (payload) => timelineStore.selectTransition(payload),
  clearSelection: () => selectionStore.clearSelection(),
  selectTimelineTransition: (trackId, itemId, edge) =>
    selectionStore.selectTimelineTransition(trackId, itemId, edge),
  emitOpenSpeedModal: (payload) => emit('openSpeedModal', payload),
  emitClipAction: (payload) => emit('clipAction', payload),
  t,
});
 
const isFreePosition = computed(() => {
  if (!clipItem.value || !timelineStore.timelineDoc) return false;
  const fps = sanitizeFps(timelineStore.timelineDoc.timebase.fps);
  
  const startFrame = (clipItem.value.timelineRange.startUs * fps) / 1_000_000;
  const durFrame = (clipItem.value.timelineRange.durationUs * fps) / 1_000_000;
  
  const isStartQuantized = Math.abs(startFrame - Math.round(startFrame)) < 0.001;
  const isDurationQuantized = Math.abs(durFrame - Math.round(durFrame)) < 0.001;
 
  return !isStartQuantized || !isDurationQuantized;
});
</script>

<template>
  <UContextMenu :items="contextMenuItems">
    <div
      :data-clip-id="item.kind === 'clip' ? item.id : undefined"
      :data-gap-id="item.kind === 'gap' ? item.id : undefined"
      class="absolute inset-y-0 rounded flex flex-col text-xs text-(--clip-text) z-10 cursor-pointer select-none transition-shadow group/clip"
      :class="[
        timelineStore.selectedItemIds.includes(item.id)
          ? 'ring-2 ring-(--selection-ring) z-20 shadow-lg'
          : '',
        isDraggingOver ? 'ring-2 ring-primary-500 z-30' : '',
        clipItem && typeof clipItem.freezeFrameSourceUs === 'number'
          ? 'outline-(--color-warning) outline-2'
          : '',
        isFreePosition ? 'ring-2 ring-inset ring-yellow-400' : '',
        clipItem && (Boolean(clipItem.disabled) || Boolean(track.videoHidden)) ? 'opacity-40' : '',
        isMediaMissing ? 'bg-red-600! border-red-800! text-white!' : '',
        clipItem && Boolean(clipItem.locked) ? 'cursor-not-allowed' : '',
        ...getClipClass(item, track),
      ]"
      :style="{
        left: `${timeUsToPx(item.timelineRange.startUs, timelineStore.timelineZoom)}px`,
        width: `${clipWidthPx}px`,
      }"
      @pointerdown="onClipPointerdown($event)"
      @click="onClipClick($event)"
      @dragover="handleDragOver"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <!-- Missing Media Overlay -->
      <div
        v-if="isMediaMissing"
        class="absolute inset-0 flex flex-col items-center justify-center z-30 pointer-events-none"
      >
        <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 text-white mb-1" />
        <span v-if="clipWidthPx > 60" class="text-[10px] font-bold uppercase tracking-wider">
          {{ t('granVideoEditor.timeline.noMedia', 'No media') }}
        </span>
      </div>

      <!-- Muted / Disabled Overlay -->
      <div
        v-if="clipItem && (clipItem.disabled || clipItem.audioMuted) && !isMediaMissing"
        class="absolute inset-0 flex items-center justify-center z-30 pointer-events-none"
      >
        <div v-if="clipItem.audioMuted" class="bg-black/30 rounded-full p-1.5">
          <UIcon name="i-heroicons-speaker-x-mark" class="w-6 h-6 text-white/90" />
        </div>
        <div v-else-if="clipItem.disabled" class="bg-black/30 rounded-full p-1">
          <UIcon
            :name="track.kind === 'audio' ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-eye-slash'"
            class="w-4 h-4 text-white/80"
          />
        </div>
      </div>
      <!-- Audio Fade Layer -->
      <div
        v-if="clipItem && clipHasAudio(item, track) && !shouldCollapseFades(item)"
        class="absolute inset-0 pointer-events-none overflow-hidden rounded"
        style="z-index: 25"
      >
        <svg
          v-if="
            (clipItem.audioFadeInUs ?? 0) > 0 &&
            (clipItem.audioFadeInUs ?? 0) <= item.timelineRange.durationUs
          "
          class="absolute left-0 top-0 h-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
          :style="{
            width: `${Math.min(
              Math.max(
                0,
                timeUsToPx(
                  Math.max(0, Math.round(Number(clipItem.audioFadeInUs) || 0)),
                  timelineStore.timelineZoom,
                ),
              ),
              clipWidthPx,
            )}px`,
          }"
        >
          <polygon points="0,0 100,0 0,100" fill="var(--clip-lower-tri)" />
        </svg>

        <svg
          v-if="
            (clipItem.audioFadeOutUs ?? 0) > 0 &&
            (clipItem.audioFadeOutUs ?? 0) <= item.timelineRange.durationUs
          "
          class="absolute right-0 top-0 h-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
          :style="{
            width: `${Math.min(
              Math.max(
                0,
                timeUsToPx(
                  Math.max(0, Math.round(Number(clipItem.audioFadeOutUs) || 0)),
                  timelineStore.timelineZoom,
                ),
              ),
              clipWidthPx,
            )}px`,
          }"
        >
          <polygon points="0,0 100,0 100,100" fill="var(--clip-lower-tri)" />
        </svg>
      </div>

      <!-- Fade Handles -->
      <template
        v-if="
          clipItem &&
          clipHasAudio(item, track) &&
          !Boolean(clipItem.locked) &&
          !shouldCollapseFades(item)
        "
      >
        <div
          class="absolute top-0 w-6 h-6 -ml-3 -translate-y-1/2 transition-opacity z-60 flex items-center justify-center shadow-sm"
          :class="
            clipWidthPx >= 30
              ? 'cursor-ew-resize opacity-0 group-hover/clip:opacity-100'
              : 'hidden pointer-events-none'
          "
          :style="{
            left: `${clampHandlePx(
              Math.min(
                Math.max(0, timeUsToPx(clipItem.audioFadeInUs || 0, timelineStore.timelineZoom)),
                clipWidthPx,
              ),
              clipWidthPx,
            )}px`,
          }"
          @pointerdown.stop.prevent="
            emit('startResizeFade', $event, track.id, item.id, 'in', clipItem.audioFadeInUs || 0)
          "
        >
          <div class="w-2.5 h-2.5 rounded-full bg-white border border-black/30"></div>
        </div>

        <div
          class="absolute top-0 w-6 h-6 -mr-3 -translate-y-1/2 transition-opacity z-60 flex items-center justify-center shadow-sm"
          :class="
            clipWidthPx >= 30
              ? 'cursor-ew-resize opacity-0 group-hover/clip:opacity-100'
              : 'hidden pointer-events-none'
          "
          :style="{
            right: `${clampHandlePx(
              Math.min(
                Math.max(0, timeUsToPx(clipItem.audioFadeOutUs || 0, timelineStore.timelineZoom)),
                clipWidthPx,
              ),
              clipWidthPx,
            )}px`,
          }"
          @pointerdown.stop.prevent="
            emit('startResizeFade', $event, track.id, item.id, 'out', clipItem.audioFadeOutUs || 0)
          "
        >
          <div class="w-2.5 h-2.5 rounded-full bg-white border border-black/30"></div>
        </div>
      </template>

      <!-- Collapsed Indicators -->
      <div
        v-if="
          clipItem &&
          (shouldCollapseTransitions(item) ||
            (clipHasAudio(item, track) && shouldCollapseFades(item)))
        "
        class="absolute top-0.5 left-0.5 flex flex-col gap-0.5 z-40 pointer-events-none"
      >
        <div
          v-if="
            clipWidthPx >= 30 &&
            clipHasAudio(item, track) &&
            shouldCollapseFades(item) &&
            (clipItem.audioFadeInUs ?? 0) > 0
          "
          class="w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center shadow-sm"
          title="Fade In"
        >
          <UIcon name="i-heroicons-arrow-right" class="w-2.5 h-2.5 text-gray-800" />
        </div>
        <div
          v-if="
            clipHasAudio(item, track) &&
            shouldCollapseFades(item) &&
            (clipItem.audioFadeOutUs ?? 0) > 0
          "
          class="w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center shadow-sm"
          title="Fade Out"
        >
          <UIcon name="i-heroicons-arrow-left" class="w-2.5 h-2.5 text-gray-800" />
        </div>
        <div
          v-if="shouldCollapseTransitions(item) && clipItem.transitionIn"
          class="w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center shadow-sm"
          title="Transition In"
        >
          <UIcon name="i-heroicons-arrow-right" class="w-2.5 h-2.5 text-white" />
        </div>
        <div
          v-if="shouldCollapseTransitions(item) && clipItem.transitionOut"
          class="w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center shadow-sm"
          title="Transition Out"
        >
          <UIcon name="i-heroicons-arrow-left" class="w-2.5 h-2.5 text-white" />
        </div>
      </div>

      <!-- Volume Control Line -->
      <div
        v-if="clipItem && clipHasAudio(item, track)"
        class="absolute left-0 right-0 z-45 h-3 -mt-1.5 flex flex-col justify-center transition-opacity"
        :class="[
          !Boolean(clipItem.locked) ? 'cursor-ns-resize' : '',
          clipItem.audioMuted && !timelineStore.selectedItemIds.includes(item.id)
            ? 'opacity-0 group-hover/clip:opacity-100'
            : (clipItem.audioGain !== undefined && Math.abs(clipItem.audioGain - 1) > 0.001) ||
                timelineStore.selectedItemIds.includes(item.id)
              ? 'opacity-100'
              : 'opacity-0 group-hover/clip:opacity-100',
          (isDraggingCurrentItem || isMovePreviewCurrentItem) && resizeVolume?.itemId !== item.id
            ? 'opacity-0! pointer-events-none'
            : '',
        ]"
        :style="{
          top: `${100 - ((clipItem.audioGain ?? 1) / 2) * 100}%`,
        }"
        @pointerdown.stop.prevent="
          $event.button === 0 &&
          !Boolean(clipItem.locked) &&
          emit('startResizeVolume', $event, track.id, item.id, clipItem.audioGain ?? 1, trackHeight)
        "
        @dblclick.stop.prevent="
          !Boolean(clipItem.locked) &&
          (() => {
            emit('resetVolume', track.id, item.id);
          })()
        "
      >
        <div
          class="w-full h-[1.5px] bg-yellow-400 pointer-events-none opacity-80"
          :class="clipWidthPx >= 15 ? 'group-hover/clip:opacity-100' : 'hidden'"
        ></div>

        <div
          class="absolute left-1/2 -translate-x-1/2 text-[10px] font-mono text-yellow-400 leading-none py-0.5 bg-black/60 px-1 rounded pointer-events-none select-none transition-opacity"
          :class="[
            clipWidthPx < 30
              ? 'hidden'
              : resizeVolume?.itemId === item.id
                ? 'opacity-100 z-50'
                : 'opacity-0 group-hover/clip:opacity-100',
            (clipItem.audioGain ?? 1) > 1 ? 'top-full mt-0.5' : 'bottom-full mb-0.5',
          ]"
        >
          {{ Math.round((clipItem.audioGain ?? 1) * 100) }}%
        </div>
      </div>

      <!-- Speed Indicator -->
      <div
        v-if="clipItem && Math.abs((clipItem.speed ?? 1) - 1) > 0.0001"
        class="absolute top-0.5 right-0.5 px-1 py-0.5 rounded bg-(--overlay-bg) text-[10px] leading-none font-mono z-40"
      >
        x{{ Number(clipItem.speed ?? 1).toFixed(2) }}
      </div>

      <!-- Main Content -->
      <div class="flex-1 flex w-full min-h-0 relative z-20">
        <TimelineClipThumbnails
          v-if="isVideo(item) && clipItem?.showThumbnails !== false"
          :item="item as any"
          :width="clipWidthPx"
        />

        <TimelineAudioWaveform
          v-if="
            isAudio(item) ||
            (isVideo(item) && clipHasAudio(item, track) && clipItem?.showWaveform !== false)
          "
          :item="item as any"
        />

        <div
          v-if="clipItem && !shouldCollapseTransitions(item)"
          class="absolute bottom-0 left-0 right-0 flex items-end justify-center px-2 pb-0.5 z-15 pointer-events-none"
        >
          <span class="truncate text-[10px] leading-tight opacity-70" :title="clipItem.name">
            {{ clipItem.name }}
          </span>
        </div>

        <!-- Transition In -->
        <div
          v-if="clipItem?.transitionIn && !shouldCollapseTransitions(item)"
          class="absolute left-0 top-0 bottom-0 z-10"
          :style="{ width: `${transitionUsToPx(clipItem.transitionIn.durationUs)}px` }"
        >
          <button
            type="button"
            class="w-full h-full overflow-hidden group/trans"
            :class="[
              selectedTransition?.itemId === item.id && selectedTransition?.edge === 'in'
                ? 'ring-2 ring-inset ring-amber-300 z-10'
                : hasTransitionInProblem(track, item)
                  ? 'ring-2 ring-inset ring-orange-500 z-10'
                  : '',
            ]"
            @pointerdown.stop="onTransitionPointerdown($event)"
            @click.stop="
              emit('selectTransition', $event, {
                trackId: item.trackId,
                itemId: item.id,
                edge: 'in',
              })
            "
          >
            <template v-if="!isCrossfadeTransitionIn(track, clipItem)">
              <svg
                v-if="(clipItem.transitionIn.mode ?? 'blend') === 'blend'"
                class="w-full h-full block"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                <path :d="transitionSvgParts(100, 100, 'in')" fill="var(--clip-lower-tri)" />
              </svg>
              <template v-else>
                <div class="absolute inset-0 bg-linear-to-r from-transparent to-white/20" />
                <span class="i-heroicons-squares-plus w-3 h-3 absolute inset-0 m-auto opacity-70" />
              </template>
            </template>
            <div
              v-if="!Boolean(clipItem.locked)"
              class="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 group-hover/trans:bg-white/20 hover:bg-white/40! transition-colors z-40"
              @pointerdown.stop.prevent="
                emit(
                  'startResizeTransition',
                  $event,
                  item.trackId,
                  item.id,
                  'in',
                  clipItem.transitionIn!.durationUs,
                )
              "
            />
          </button>
        </div>

        <!-- Transition Out -->
        <div
          v-if="clipItem?.transitionOut && !shouldCollapseTransitions(item)"
          class="absolute right-0 top-0 bottom-0 z-10"
          :style="{ width: `${transitionUsToPx(clipItem.transitionOut.durationUs)}px` }"
        >
          <button
            type="button"
            class="w-full h-full overflow-hidden group/trans"
            :class="[
              selectedTransition?.itemId === item.id && selectedTransition?.edge === 'out'
                ? 'ring-2 ring-inset ring-amber-300 z-10'
                : hasTransitionOutProblem(track, item)
                  ? 'ring-2 ring-inset ring-orange-500 z-10'
                  : '',
            ]"
            @pointerdown.stop="onTransitionPointerdown($event)"
            @click.stop="
              emit('selectTransition', $event, {
                trackId: item.trackId,
                itemId: item.id,
                edge: 'out',
              })
            "
          >
            <svg
              v-if="(clipItem.transitionOut.mode ?? 'blend') === 'blend'"
              class="w-full h-full block"
              preserveAspectRatio="none"
              viewBox="0 0 100 100"
            >
              <path :d="transitionSvgParts(100, 100, 'out')" fill="var(--clip-lower-tri)" />
            </svg>
            <template v-else>
              <div class="absolute inset-0 bg-linear-to-l from-transparent to-white/20" />
              <span class="i-heroicons-squares-plus w-3 h-3 absolute inset-0 m-auto opacity-70" />
            </template>
            <div
              v-if="!Boolean(clipItem.locked)"
              class="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 group-hover/trans:bg-white/20 hover:bg-white/40! transition-colors z-40"
              @pointerdown.stop.prevent="
                emit(
                  'startResizeTransition',
                  $event,
                  item.trackId,
                  item.id,
                  'out',
                  clipItem.transitionOut!.durationUs,
                )
              "
            />
          </button>
        </div>
      </div>

      <!-- Trim Handles -->
      <div
        v-if="clipItem && !Boolean(clipItem.locked)"
        class="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30 transition-colors z-50 group/trim"
        @pointerdown.stop="
          emit('startTrimItem', $event, {
            trackId: item.trackId,
            itemId: item.id,
            edge: 'start',
            startUs: item.timelineRange.startUs,
          })
        "
      />
      <div
        v-if="clipItem && !Boolean(clipItem.locked)"
        class="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30 transition-colors z-50 group/trim"
        @pointerdown.stop="
          emit('startTrimItem', $event, {
            trackId: item.trackId,
            itemId: item.id,
            edge: 'end',
            startUs: item.timelineRange.startUs,
          })
        "
      />
    </div>
  </UContextMenu>
</template>
