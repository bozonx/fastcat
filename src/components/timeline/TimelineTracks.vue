<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useMediaStore } from '~/stores/media.store';
import type {
  TimelineClipActionPayload,
  TimelineClipItem,
  TimelineMoveItemPayload,
  TimelineOpenSpeedModalPayload,
  TimelineTrack,
  TimelineTrimItemPayload,
} from '~/timeline/types';
import { timeUsToPx } from '~/utils/timeline/geometry';
import { useTimelineItemResize } from '~/composables/timeline/useTimelineItemResize';
import { useTimelineMarquee } from '~/composables/timeline/useTimelineMarquee';

import TimelineClip from './TimelineClip.vue';
import TimelineGap from './TimelineGap.vue';
import TimelineSpeedModal from './TimelineSpeedModal.vue';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const mediaStore = useMediaStore();
const { selectedTransition } = storeToRefs(timelineStore);

const props = defineProps<{
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  canEditClipContent: boolean;
  dragPreview?: {
    trackId: string;
    startUs: number;
    label: string;
    durationUs: number;
    kind: 'timeline-clip' | 'file';
  } | null;
  movePreview?: { itemId: string; trackId: string; startUs: number } | null;
  draggingMode?: 'move' | 'trim_start' | 'trim_end' | null;
  draggingItemId?: string | null;
  isMobile?: boolean;
}>();

const emit = defineEmits<{
  (e: 'drop', event: DragEvent, trackId: string): void;
  (e: 'dragover', event: DragEvent, trackId: string): void;
  (e: 'dragleave', event: DragEvent, trackId: string): void;
  (e: 'startMoveItem', event: PointerEvent, payload: TimelineMoveItemPayload): void;
  (e: 'selectItem', event: PointerEvent, itemId: string): void;
  (e: 'clipAction', payload: TimelineClipActionPayload): void;
  (e: 'startTrimItem', event: PointerEvent, payload: TimelineTrimItemPayload): void;
}>();

const DEFAULT_TRACK_HEIGHT = 40;
const containerRef = ref<HTMLElement | null>(null);

const { tracks, trackHeights } = toRefs(props);
const { isMarqueeSelecting, marqueeStyle, startMarquee } = useTimelineMarquee(
  containerRef,
  tracks,
  trackHeights,
);

const { resizeVolume, startResizeVolume, startResizeFade, startResizeTransition } =
  useTimelineItemResize(() => props.tracks);

const timelineWidthPx = computed(() => {
  const maxUs = Math.max(timelineStore.duration, timelineStore.currentTime) + 30_000_000;
  return timeUsToPx(maxUs, timelineStore.timelineZoom);
});

const selectionRangeStyle = computed(() => {
  const range = timelineStore.getSelectionRange();
  if (!range) return null;
  return {
    left: `${timeUsToPx(range.startUs, timelineStore.timelineZoom)}px`,
    width: `${Math.max(1, timeUsToPx(range.endUs - range.startUs, timelineStore.timelineZoom))}px`,
  };
});

// Speed Modal State
const speedModal = ref<{ open: boolean; trackId: string; itemId: string; speed: number } | null>(
  null,
);

function openSpeedModal(trackId: string, itemId: string, currentSpeed: number | null | undefined) {
  speedModal.value = {
    open: true,
    trackId,
    itemId,
    speed: typeof currentSpeed === 'number' ? currentSpeed : 1,
  };
}

async function saveSpeedModal() {
  if (!speedModal.value) return;
  const { trackId, itemId, speed } = speedModal.value;
  if (Math.abs(speed) < 0.1) return;
  timelineStore.updateClipProperties(trackId, itemId, { speed });
  speedModal.value.open = false;
  await timelineStore.requestTimelineSave({ immediate: true });
}

const speedModalTargetHasAudio = computed(() => {
  if (!speedModal.value) return false;
  const track = props.tracks.find((t) => t.id === speedModal.value!.trackId);
  const clip = track?.items.find(
    (it): it is TimelineClipItem => it.id === speedModal.value!.itemId && it.kind === 'clip',
  );
  if (!clip || (track?.kind === 'video' && clip.audioFromVideoDisabled)) return false;
  if (track?.kind === 'audio') return true;
  return Boolean(clip.source?.path && mediaStore.mediaMetadata[clip.source.path]?.audio);
});

const movePreviewItem = computed(() =>
  props.tracks.flatMap((track) => track.items).find((item) => item.id === props.movePreview?.itemId),
);

function selectTransition(
  e: MouseEvent | PointerEvent,
  payload: { trackId: string; itemId: string; edge: 'in' | 'out' },
) {
  e.stopPropagation();
  timelineStore.selectTransition(payload);
  selectionStore.selectTimelineTransition(payload.trackId, payload.itemId, payload.edge);
}
</script>

<template>
  <div
    ref="containerRef"
    class="flex flex-col min-h-full relative"
    :style="{ minWidth: `max(100%, ${timelineWidthPx}px)` }"
    @pointerdown="
      if ($event.button === 0 && $event.target === $event.currentTarget) {
        startMarquee($event);
      } else if ($event.button !== 1 && $event.target === $event.currentTarget) {
        timelineStore.clearSelection();
        selectionStore.clearSelection();
        timelineStore.selectTrack(null);
      }
    "
  >
    <div
      v-if="selectionRangeStyle"
      class="absolute top-0 bottom-0 z-20 pointer-events-none border-l border-r border-violet-400/80 bg-violet-500/18 shadow-[0_0_0_1px_rgba(167,139,250,0.25)]"
      :style="selectionRangeStyle"
    />

    <div
      v-if="isMarqueeSelecting"
      class="absolute border-2 border-primary-500 bg-primary-500/20 pointer-events-none z-50"
      :style="marqueeStyle"
    />

    <TimelineSpeedModal
      v-if="speedModal"
      v-model:open="speedModal.open"
      v-model:speed="speedModal.speed"
      :has-audio="speedModalTargetHasAudio"
      @save="saveSpeedModal"
    />

    <div
      v-for="track in tracks"
      :key="track.id"
      :data-track-id="track.id"
      class="flex items-center px-2 relative transition-colors border-b border-ui-border"
      :class="[
        timelineStore.selectedTrackId === track.id ? 'bg-ui-bg-elevated' : '',
        timelineStore.hoveredTrackId === track.id && timelineStore.selectedTrackId !== track.id
          ? 'bg-ui-bg-elevated/50'
          : '',
      ]"
      :style="{ height: `${trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT}px` }"
      @pointerdown="
        if ($event.button === 0 && $event.target === $event.currentTarget) {
          startMarquee($event, () => {
            timelineStore.selectTrack(track.id);
            timelineStore.clearSelection();
            selectionStore.clearSelection();
          });
        }
      "
      @mouseenter="timelineStore.hoveredTrackId = track.id"
      @mouseleave="timelineStore.hoveredTrackId = null"
      @dragover.prevent="emit('dragover', $event, track.id)"
      @dragleave.prevent="emit('dragleave', $event, track.id)"
      @drop.prevent="emit('drop', $event, track.id)"
    >
      <!-- Drop Previews inside track -->
      <div
        v-if="dragPreview && dragPreview.trackId === track.id"
        class="absolute inset-y-0 rounded px-2 flex items-center text-xs text-(--clip-text) z-30 pointer-events-none opacity-80"
        :class="
          dragPreview.kind === 'file'
            ? 'bg-primary-600 border border-primary-400'
            : 'bg-ui-bg-accent border border-ui-border'
        "
        :style="{
          left: `${timeUsToPx(dragPreview.startUs, timelineStore.timelineZoom)}px`,
          width: `${Math.max(2, timeUsToPx(dragPreview.durationUs, timelineStore.timelineZoom))}px`,
        }"
      >
        <span class="truncate" :title="dragPreview.label">{{ dragPreview.label }}</span>
      </div>

      <div
        v-if="movePreview && movePreview.trackId === track.id"
        class="absolute inset-y-0 rounded px-2 flex items-center text-xs text-(--clip-text) z-40 pointer-events-none opacity-60 bg-ui-bg-accent border border-ui-border"
        :style="{
          left: `${timeUsToPx(movePreview.startUs, timelineStore.timelineZoom)}px`,
          width: `${Math.max(2, timeUsToPx(movePreviewItem?.timelineRange.durationUs ?? 0, timelineStore.timelineZoom))}px`,
        }"
      >
        <span class="truncate">{{ movePreviewItem && 'name' in movePreviewItem ? movePreviewItem.name : '' }}</span>
      </div>

      <template v-for="item in track.items" :key="item.id">
        <TimelineGap
          v-if="item.kind === 'gap'"
          :item="item"
          :track-id="track.id"
          @select="(e) => emit('selectItem', e, item.id)"
          @marquee-start="(e) => startMarquee(e, () => emit('selectItem', e, item.id))"
        />
        <TimelineClip
          v-else
          :track="track"
          :item="item"
          :track-height="trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT"
          :can-edit-clip-content="canEditClipContent"
          :is-dragging-current-item="draggingItemId === item.id"
          :is-move-preview-current-item="movePreview?.itemId === item.id"
          :selected-transition="selectedTransition"
          :resize-volume="resizeVolume"
          @select-item="(ev, id) => emit('selectItem', ev, id)"
          @start-move-item="(ev, payload) => emit('startMoveItem', ev, payload)"
          @start-trim-item="(ev, payload) => emit('startTrimItem', ev, payload)"
          @start-resize-volume="startResizeVolume"
          @start-resize-fade="startResizeFade"
          @start-resize-transition="startResizeTransition"
          @select-transition="selectTransition"
          @clip-action="(p) => emit('clipAction', p)"
          @open-speed-modal="(p: TimelineOpenSpeedModalPayload) => openSpeedModal(track.id, p.itemId, p.speed)"
          @reset-volume="(payload) => timelineStore.updateClipProperties(payload.trackId, payload.itemId, { audioGain: 1 })"
        />
      </template>
    </div>

    <div class="w-full flex-1 min-h-7" @click="timelineStore.selectTrack(null)" />
    <div class="h-16 shrink-0" />
  </div>
</template>
