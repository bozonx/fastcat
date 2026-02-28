<script setup lang="ts">
import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import type { TimelineClipItem, TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import { timeUsToPx, pxToDeltaUs } from '~/composables/timeline/useTimelineInteraction';
import AppModal from '~/components/common/AppModal.vue';
import TimelineClipThumbnails from './TimelineClipThumbnails.vue';
import TimelineAudioWaveform from './TimelineAudioWaveform.vue';
import TimelineClip from './TimelineClip.vue';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const projectStore = useProjectStore();
const mediaStore = useMediaStore();
const { selectedTransition } = storeToRefs(timelineStore);

const props = defineProps<{
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  dragPreview?: {
    trackId: string;
    startUs: number;
    label: string;
    durationUs: number;
    kind: 'timeline-clip' | 'file';
  } | null;
  movePreview?: {
    itemId: string;
    trackId: string;
    startUs: number;
  } | null;
  draggingMode?: 'move' | 'trim_start' | 'trim_end' | null;
  draggingItemId?: string | null;
}>();

const DEFAULT_TRACK_HEIGHT = 40;

const movePreviewResolved = computed(() => {
  const mp = props.movePreview;
  if (!mp) return null;
  const targetTrack = props.tracks.find((t) => t.id === mp.trackId);
  if (!targetTrack) return null;

  const clip = props.tracks
    .flatMap((t) => t.items)
    .find((it) => it.id === mp.itemId && it.kind === 'clip');
  if (!clip || clip.kind !== 'clip') return null;
  return {
    trackId: targetTrack.id,
    itemId: clip.id,
    startUs: mp.startUs,
    durationUs: clip.timelineRange.durationUs,
    label: clip.name,
    trackKind: targetTrack.kind,
    clipType: (clip as any).clipType as any,
  };
});

const emit = defineEmits<{
  (e: 'drop', event: DragEvent, trackId: string): void;
  (e: 'dragover', event: DragEvent, trackId: string): void;
  (e: 'dragleave', event: DragEvent, trackId: string): void;
  (e: 'startMoveItem', event: MouseEvent, trackId: string, itemId: string, startUs: number): void;
  (e: 'selectItem', event: MouseEvent, itemId: string): void;
  (
    e: 'clipAction',
    payload: {
      action: 'extractAudio' | 'returnAudio' | 'freezeFrame' | 'resetFreezeFrame';
      trackId: string;
      itemId: string;
      videoItemId?: string;
    },
  ): void;
  (
    e: 'startTrimItem',
    event: MouseEvent,
    payload: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number },
  ): void;
}>();

const speedModal = ref<{
  open: boolean;
  trackId: string;
  itemId: string;
  speed: number;
} | null>(null);

const speedModalOpen = computed({
  get: () => Boolean(speedModal.value?.open),
  set: (v) => {
    if (!speedModal.value) return;
    speedModal.value.open = v;
  },
});

const speedModalSpeed = computed({
  get: () => speedModal.value?.speed ?? 1,
  set: (v: number) => {
    if (!speedModal.value) return;
    speedModal.value.speed = v;
  },
});

function openSpeedModal(trackId: string, itemId: string, currentSpeed: unknown) {
  const base = typeof currentSpeed === 'number' && Number.isFinite(currentSpeed) ? currentSpeed : 1;
  speedModal.value = {
    open: true,
    trackId,
    itemId,
    speed: Math.max(0.1, Math.min(10, base)),
  };
}

async function saveSpeedModal() {
  if (!speedModal.value) return;
  const speed = Number(speedModal.value.speed);
  if (!Number.isFinite(speed) || speed <= 0) return;
  timelineStore.updateClipProperties(speedModal.value.trackId, speedModal.value.itemId, {
    speed: Math.max(0.1, Math.min(10, speed)),
  });
  speedModal.value.open = false;
  await timelineStore.requestTimelineSave({ immediate: true });
}

function selectTransition(
  e: MouseEvent,
  input: { trackId: string; itemId: string; edge: 'in' | 'out' },
) {
  e.stopPropagation();
  timelineStore.selectTransition(input);
  selectionStore.selectTimelineTransition(input.trackId, input.itemId, input.edge);
}

function transitionUsToPx(durationUs: number | undefined): number {
  const safeUs = typeof durationUs === 'number' && Number.isFinite(durationUs) ? durationUs : 0;
  return Math.max(8, timeUsToPx(Math.max(0, safeUs), timelineStore.timelineZoom));
}

/**
 * Returns true when this clip's transitionIn visually overlaps with the previous
 * clip's transitionOut (blend crossfade overlap). In that case we hide the transitionIn
 * SVG/icon to avoid rendering two overlapping triangles, but keep the button and
 * resize handle functional.
 */
function isCrossfadeTransitionIn(track: TimelineTrack, item: TimelineClipItem): boolean {
  if (!item.transitionIn) return false;
  const ordered = getOrderedClipsOnTrack(track);
  const idx = ordered.findIndex((c) => c.id === item.id);
  if (idx <= 0) return false;
  const prev = ordered[idx - 1]!;
  const overlapUs =
    prev.timelineRange.startUs + prev.timelineRange.durationUs - item.timelineRange.startUs;
  return overlapUs > 0 && Boolean(prev.transitionOut);
}

// --- Resize transition by dragging ---
const resizeTransition = ref<{
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  startX: number;
  startDurationUs: number;
} | null>(null);

// --- Resize audio fade by dragging ---
const resizeFade = ref<{
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  startX: number;
  startFadeUs: number;
} | null>(null);

// --- Resize volume by dragging ---
const resizeVolume = ref<{
  trackId: string;
  itemId: string;
  startY: number;
  startVolume: number;
  height: number;
} | null>(null);

function startResizeVolume(
  e: MouseEvent,
  trackId: string,
  itemId: string,
  currentVolume: number,
  clipHeight: number,
) {
  e.stopPropagation();
  e.preventDefault();
  resizeVolume.value = {
    trackId,
    itemId,
    startY: e.clientY,
    startVolume: currentVolume,
    height: clipHeight,
  };

  function onMouseMove(ev: MouseEvent) {
    if (!resizeVolume.value) return;
    const dy = ev.clientY - resizeVolume.value.startY;
    const deltaVol = -(dy / resizeVolume.value.height) * 2;
    let newVol = resizeVolume.value.startVolume + deltaVol;
    newVol = Math.max(0, Math.min(2, newVol));

    timelineStore.updateClipProperties(trackId, itemId, {
      audioGain: newVol,
    });
  }

  function onMouseUp() {
    if (resizeVolume.value) {
      timelineStore.requestTimelineSave({ immediate: true });
    }
    resizeVolume.value = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function startResizeFade(
  e: MouseEvent,
  trackId: string,
  itemId: string,
  edge: 'in' | 'out',
  currentFadeUs: number,
) {
  e.stopPropagation();
  e.preventDefault();
  resizeFade.value = {
    trackId,
    itemId,
    edge,
    startX: e.clientX,
    startFadeUs: currentFadeUs,
  };

  function onMouseMove(ev: MouseEvent) {
    if (!resizeFade.value) return;
    const dx = ev.clientX - resizeFade.value.startX;
    // For 'in' edge: drag right = longer fade, drag left = shorter fade
    // For 'out' edge: drag left = longer fade (towards start), drag right = shorter fade
    const sign = edge === 'in' ? 1 : -1;
    const deltaPx = dx * sign;
    const deltaUs = pxToDeltaUs(deltaPx, timelineStore.timelineZoom);

    const track = props.tracks.find((t) => t.id === trackId);
    const item = track?.items.find((i) => i.id === itemId);
    if (!item || item.kind !== 'clip') return;

    const clipDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));
    const oppFadeUs = Math.max(
      0,
      Math.round(
        edge === 'in' ? ((item as any).audioFadeOutUs ?? 0) : ((item as any).audioFadeInUs ?? 0),
      ),
    );
    const maxUs = Math.max(0, clipDurationUs - oppFadeUs);
    let newFadeUs = resizeFade.value.startFadeUs + deltaUs;
    newFadeUs = Math.max(0, Math.min(maxUs, newFadeUs));

    const propName = edge === 'in' ? 'audioFadeInUs' : 'audioFadeOutUs';
    timelineStore.updateClipProperties(trackId, itemId, {
      [propName]: Math.round(newFadeUs),
    });
  }

  function onMouseUp() {
    if (resizeFade.value) {
      timelineStore.requestTimelineSave({ immediate: true });
    }
    resizeFade.value = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

// --- Collapse Logic for Transitions and Fades ---
function clipHasAudio(item: TimelineClipItem, track: TimelineTrack): boolean {
  if (track.kind === 'video' && item.audioFromVideoDisabled) return false;
  if (item.clipType !== 'media' && item.clipType !== 'timeline') return false;
  if (!item.source?.path) return false;
  const meta = mediaStore.mediaMetadata[item.source.path];
  return Boolean(meta?.audio);
}

function shouldCollapseTransitions(item: TimelineClipItem): boolean {
  const inUs = (item as any).transitionIn?.durationUs ?? 0;
  const outUs = (item as any).transitionOut?.durationUs ?? 0;
  if (inUs === 0 && outUs === 0) return false;

  const clipDurationUs = item.timelineRange.durationUs;
  const hitEachOther = inUs + outUs > clipDurationUs + 1000; // 1ms tolerance

  const clipUnstretchedPx = timeUsToPx(clipDurationUs, timelineStore.timelineZoom);
  const clipWidth = Math.max(2, clipUnstretchedPx);

  // Collapse if they hit each other in time, but the clip is artificially stretched
  // so they can no longer visually show the correct proportional sizes (a gap would appear).
  if (hitEachOther && clipWidth > clipUnstretchedPx + 1) {
    return true;
  }

  // Also collapse if their minimum pixel size forces them to visually overlap in the clip box
  const inPx = inUs > 0 ? transitionUsToPx(inUs) : 0;
  const outPx = outUs > 0 ? transitionUsToPx(outUs) : 0;
  if (inPx + outPx > clipWidth) {
    return true;
  }

  return false;
}

function clampHandlePx(px: number, clipPx: number): number {
  const safePx = Number.isFinite(px) ? px : 0;
  const safeClipPx = Number.isFinite(clipPx) ? Math.max(0, clipPx) : 0;
  const padPx = 3;
  if (safeClipPx <= padPx * 2) {
    return safeClipPx / 2;
  }
  return Math.max(padPx, Math.min(safeClipPx - padPx, safePx));
}

function shouldCollapseFades(item: TimelineClipItem): boolean {
  const inUs = (item as any).audioFadeInUs ?? 0;
  const outUs = (item as any).audioFadeOutUs ?? 0;
  if (inUs === 0 && outUs === 0) return false;

  const clipDurationUs = item.timelineRange.durationUs;
  const hitEachOther = inUs > 0 && outUs > 0 && inUs + outUs > clipDurationUs - 1000;

  const clipUnstretchedPx = timeUsToPx(clipDurationUs, timelineStore.timelineZoom);
  const clipWidth = Math.max(2, clipUnstretchedPx);

  if (hitEachOther && clipWidth > clipUnstretchedPx + 1) {
    return true;
  }

  const inPx = timeUsToPx(inUs, timelineStore.timelineZoom);
  const outPx = timeUsToPx(outUs, timelineStore.timelineZoom);
  if (inPx + outPx > clipWidth) {
    return true;
  }

  return false;
}

function getOrderedClipsOnTrack(track: TimelineTrack): TimelineClipItem[] {
  const clips = track.items.filter((it): it is TimelineClipItem => it.kind === 'clip');
  return [...clips].sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
}

function getAdjacentClipForTransitionEdge(input: {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
}): { clip: TimelineClipItem; adjacent: TimelineClipItem | null } | null {
  const track = props.tracks.find((t) => t.id === input.trackId);
  if (!track) return null;
  const ordered = getOrderedClipsOnTrack(track);
  const idx = ordered.findIndex((c) => c.id === input.itemId);
  if (idx === -1) return null;
  const clip = ordered[idx]!;
  const adjacent =
    input.edge === 'in'
      ? idx > 0
        ? ordered[idx - 1]!
        : null
      : idx < ordered.length - 1
        ? ordered[idx + 1]!
        : null;
  return { clip, adjacent };
}

function computeMaxResizableTransitionDurationUs(input: {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  currentTransition: import('~/timeline/types').ClipTransition;
}): number {
  const resolved = getAdjacentClipForTransitionEdge({
    trackId: input.trackId,
    itemId: input.itemId,
    edge: input.edge,
  });
  if (!resolved) return 10_000_000;

  const { clip, adjacent } = resolved;

  const clipDuration = clip.timelineRange.durationUs;
  const oppTransitionUs =
    input.edge === 'in'
      ? ((clip as any).transitionOut?.durationUs ?? 0)
      : ((clip as any).transitionIn?.durationUs ?? 0);
  const maxWithinClip = Math.max(0, clipDuration - oppTransitionUs);

  let limitByHandle = Number.POSITIVE_INFINITY;

  // Only enforce hard max for blend crossfades (needs overlap material)
  const mode = input.currentTransition.mode ?? 'blend';
  if (mode === 'blend' && adjacent) {
    if (input.edge === 'in') {
      // We're resizing transitionIn of `clip` => crossfade uses previous clip tail handle.
      const prev = adjacent;
      const prevSourceEnd = (prev.sourceRange?.startUs ?? 0) + (prev.sourceRange?.durationUs ?? 0);
      const prevMaxEnd =
        prev.clipType === 'media' && !prev.isImage
          ? ((prev as any).sourceDurationUs ?? prevSourceEnd)
          : Number.POSITIVE_INFINITY;
      const prevTailHandleUs = Number.isFinite(prevMaxEnd)
        ? Math.max(0, Math.round(Number(prevMaxEnd)) - Math.round(prevSourceEnd))
        : Number.POSITIVE_INFINITY;
      limitByHandle = Math.max(0, prevTailHandleUs + input.currentTransition.durationUs);
    } else {
      // Resizing transitionOut of `clip` => uses this clip tail handle.
      const curr = clip;
      const currSourceEnd = (curr.sourceRange?.startUs ?? 0) + (curr.sourceRange?.durationUs ?? 0);
      const currMaxEnd =
        curr.clipType === 'media' && !curr.isImage
          ? ((curr as any).sourceDurationUs ?? currSourceEnd)
          : Number.POSITIVE_INFINITY;
      const currTailHandleUs = Number.isFinite(currMaxEnd)
        ? Math.max(0, Math.round(Number(currMaxEnd)) - Math.round(currSourceEnd))
        : Number.POSITIVE_INFINITY;
      limitByHandle = Math.max(0, currTailHandleUs + input.currentTransition.durationUs);
    }
  }

  return Math.min(maxWithinClip, limitByHandle);
}

function startResizeTransition(
  e: MouseEvent,
  trackId: string,
  itemId: string,
  edge: 'in' | 'out',
  currentDurationUs: number,
) {
  e.stopPropagation();
  e.preventDefault();
  resizeTransition.value = {
    trackId,
    itemId,
    edge,
    startX: e.clientX,
    startDurationUs: currentDurationUs,
  };

  function onMouseMove(ev: MouseEvent) {
    if (!resizeTransition.value) return;
    const dx = ev.clientX - resizeTransition.value.startX;
    // For 'in' edge: drag right = longer, drag left = shorter
    // For 'out' edge: drag left = longer (towards start), drag right = shorter
    const sign = edge === 'in' ? 1 : -1;
    const deltaPx = dx * sign;
    const deltaUs = pxToDeltaUs(deltaPx, timelineStore.timelineZoom);
    const minUs = 100_000; // 0.1s

    const track = props.tracks.find((t) => t.id === trackId);
    const item = track?.items.find((i) => i.id === itemId);
    if (!item || item.kind !== 'clip') return;

    const current =
      edge === 'in'
        ? (item as TimelineClipItem).transitionIn
        : (item as TimelineClipItem).transitionOut;
    if (!current) return;

    const maxUsRaw = computeMaxResizableTransitionDurationUs({
      trackId,
      itemId,
      edge,
      currentTransition: current,
    });

    if (maxUsRaw <= 0) return;
    const maxUs = Math.max(minUs, maxUsRaw);

    const newDurationUs = Math.min(
      maxUs,
      Math.max(minUs, resizeTransition.value.startDurationUs + deltaUs),
    );

    timelineStore.updateClipTransition(trackId, itemId, {
      [edge === 'in' ? 'transitionIn' : 'transitionOut']: {
        ...current,
        durationUs: Math.round(newDurationUs),
      },
    });
  }

  function onMouseUp() {
    resizeTransition.value = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

// --- Problem detection: previous clip too short for blend transition ---
function openSpeedModal(trackId: string, itemId: string, speed: number) {
  speedModal.value = { trackId, itemId, open: true };
  speedModalSpeed.value = speed;
  speedModalOpen.value = true;
}
</script>

<template>
  <div
    class="flex flex-col divide-y divide-ui-border min-h-full"
    @mousedown="
      if ($event.button !== 1 && $event.target === $event.currentTarget) {
        timelineStore.clearSelection();
        selectionStore.clearSelection();
        timelineStore.selectTrack(null);
      }
    "
  >
    <AppModal
      v-model:open="speedModalOpen"
      :title="t('granVideoEditor.timeline.speedModalTitle', 'Clip speed')"
      :description="
        t('granVideoEditor.timeline.speedModalDescription', 'Changes clip playback speed')
      "
      :ui="{ content: 'sm:max-w-md' }"
    >
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-ui-text">
            {{ t('granVideoEditor.timeline.speedValue', 'Speed') }}
          </span>
          <span class="text-sm font-mono text-ui-text-muted">{{
            Number(speedModalSpeed).toFixed(2)
          }}</span>
        </div>

        <UInput v-model.number="speedModalSpeed" type="number" :min="0.1" :max="10" :step="0.05" />
      </div>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="speedModal && (speedModal.open = false)">
            {{ t('common.cancel', 'Cancel') }}
          </UButton>
          <UButton color="primary" @click="saveSpeedModal">
            {{ t('common.save', 'Save') }}
          </UButton>
        </div>
      </template>
    </AppModal>

    <div
      v-for="track in tracks"
      :key="track.id"
      :data-track-id="track.id"
      class="flex items-center px-2 relative transition-colors"
      :class="[
        timelineStore.selectedTrackId === track.id ? 'bg-ui-bg-elevated' : '',
        timelineStore.hoveredTrackId === track.id && timelineStore.selectedTrackId !== track.id
          ? 'bg-ui-bg-elevated/50'
          : '',
      ]"
      :style="{ height: `${trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT}px` }"
      @dragover.prevent="emit('dragover', $event, track.id)"
      @dragleave.prevent="emit('dragleave', $event, track.id)"
      @drop.prevent="emit('drop', $event, track.id)"
      @mouseenter="timelineStore.hoveredTrackId = track.id"
      @mouseleave="timelineStore.hoveredTrackId = null"
      @mousedown="
        if ($event.button !== 1 && $event.target === $event.currentTarget) {
          timelineStore.clearSelection();
          selectionStore.clearSelection();
          timelineStore.selectTrack(null);
        }
      "
    >
      <div
        v-if="dragPreview && dragPreview.trackId === track.id"
        class="absolute inset-y-0 rounded px-2 flex items-center text-xs text-(--clip-text) z-30 pointer-events-none opacity-80"
        :class="
          dragPreview.kind === 'file'
            ? 'bg-primary-600 border border-primary-400'
            : 'bg-ui-bg-accent border border-ui-border'
        "
        :style="{
          left: `${2 + timeUsToPx(dragPreview.startUs, timelineStore.timelineZoom)}px`,
          width: `${Math.max(2, timeUsToPx(dragPreview.durationUs, timelineStore.timelineZoom))}px`,
        }"
      >
        <span class="truncate" :title="dragPreview.label">{{ dragPreview.label }}</span>
      </div>

      <div
        v-if="movePreviewResolved && movePreviewResolved.trackId === track.id"
        class="absolute inset-y-0 rounded px-2 flex items-center text-xs text-(--clip-text) z-40 pointer-events-none opacity-60 bg-ui-bg-accent border border-ui-border"
        :style="{
          left: `${2 + timeUsToPx(movePreviewResolved.startUs, timelineStore.timelineZoom)}px`,
          width: `${Math.max(2, timeUsToPx(movePreviewResolved.durationUs, timelineStore.timelineZoom))}px`,
        }"
      >
        <span class="truncate" :title="movePreviewResolved.label">{{
          movePreviewResolved.label
        }}</span>
      </div>

      <template v-for="item in track.items" :key="item.id">
        <!-- Gap rendering -->
        <UContextMenu
          v-if="item.kind === 'gap'"
          :items="[
            [
              {
                label: t('granVideoEditor.timeline.delete', 'Delete'),
                icon: 'i-heroicons-trash',
                onSelect: () => {
                  timelineStore.applyTimeline({
                    type: 'delete_items',
                    trackId: track.id,
                    itemIds: [item.id],
                  });
                },
              },
            ],
          ]"
        >
          <div
            class="absolute inset-y-0 rounded border border-dashed border-ui-border/50 bg-ui-bg-elevated/20 hover:bg-ui-bg-elevated/40 text-ui-text-muted transition-colors z-10 cursor-pointer select-none"
            :style="{
              left: `${2 + timeUsToPx(item.timelineRange.startUs, timelineStore.timelineZoom)}px`,
              width: `${Math.max(2, timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom))}px`,
            }"
            @pointerdown="
              if ($event.button !== 1) {
                $event.stopPropagation();
                emit('selectItem', $event, item.id);
                selectionStore.selectTimelineItem(track.id, item.id, 'gap');
              }
            "
          />
        </UContextMenu>

        <!-- Clip rendering -->
        <TimelineClip
          v-else
          :track="track"
          :item="item"
          :track-height="trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT"
          :is-dragging-current-item="props.draggingMode && props.draggingItemId === item.id"
          :is-move-preview-current-item="props.movePreview?.itemId === item.id"
          :selected-transition="selectedTransition"
          :resize-volume="resizeVolume"
          @select-item="(ev, id) => emit('selectItem', ev, id)"
          @start-move-item="(ev, tId, id, sUs) => emit('startMoveItem', ev, tId, id, sUs)"
          @start-trim-item="payload => emit('startTrimItem', payload.event as any, payload)"
          @start-resize-volume="(ev, tId, id, gain, h) => startResizeVolume(ev, tId, id, gain, h)"
          @start-resize-fade="(ev, tId, id, edge, dur) => startResizeFade(ev, tId, id, edge, dur)"
          @start-resize-transition="(ev, tId, id, edge, dur) => startResizeTransition(ev, tId, id, edge, dur)"
          @select-transition="(ev, payload) => selectTransition(ev, payload)"
          @clip-action="payload => emit('clipAction', payload)"
          @open-speed-modal="payload => openSpeedModal(payload.trackId, payload.itemId, payload.speed)"
        />
      </template>
    </div>
  </div>
</template>
