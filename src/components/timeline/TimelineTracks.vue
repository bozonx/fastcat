<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import type { TimelineTrack } from '~/timeline/types';
import { timeUsToPx } from '~/utils/timeline/geometry';
import { useTimelineItemResize } from '~/composables/timeline/useTimelineItemResize';
import AppModal from '~/components/ui/AppModal.vue';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
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
  canEditClipContent: boolean;
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

const {
  resizeTransition,
  resizeFade,
  resizeVolume,
  startResizeVolume,
  startResizeFade,
  startResizeTransition,
} = useTimelineItemResize(() => props.tracks);

const timelineWidthPx = computed(() => {
  const d = timelineStore.duration;
  const c = timelineStore.currentTime;
  const maxUs = Math.max(d, c) + 30_000_000; // 30 seconds padding
  return timeUsToPx(maxUs, timelineStore.timelineZoom);
});

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

const selectionRange = computed(() => timelineStore.getSelectionRange());

const selectionRangeStyle = computed(() => {
  const range = selectionRange.value;
  if (!range) return null;

  return {
    left: `${timeUsToPx(range.startUs, timelineStore.timelineZoom)}px`,
    width: `${Math.max(1, timeUsToPx(range.endUs - range.startUs, timelineStore.timelineZoom))}px`,
  };
});

const canOpenClipProperties = computed(
  () => projectStore.currentView === 'cut' || projectStore.currentView === 'sound',
);

// Marquee Selection Logic
const containerRef = ref<HTMLElement | null>(null);
const isMarqueeSelecting = ref(false);
const marqueeStart = ref({ x: 0, y: 0 });
const marqueeCurrent = ref({ x: 0, y: 0 });

const marqueeStyle = computed(() => {
  if (!isMarqueeSelecting.value) return {};
  const left = Math.min(marqueeStart.value.x, marqueeCurrent.value.x);
  const top = Math.min(marqueeStart.value.y, marqueeCurrent.value.y);
  const width = Math.abs(marqueeCurrent.value.x - marqueeStart.value.x);
  const height = Math.abs(marqueeCurrent.value.y - marqueeStart.value.y);
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
});

function getPointerCoords(e: PointerEvent) {
  if (!containerRef.value) return { x: 0, y: 0 };
  const rect = containerRef.value.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

let onMarqueeMove: ((e: PointerEvent) => void) | null = null;
let onMarqueeUp: ((e: PointerEvent) => void) | null = null;

function updateLiveMarqueeSelection() {
  if (!isMarqueeSelecting.value) return;

  const left = Math.min(marqueeStart.value.x, marqueeCurrent.value.x);
  const right = Math.max(marqueeStart.value.x, marqueeCurrent.value.x);
  const top = Math.min(marqueeStart.value.y, marqueeCurrent.value.y);
  const bottom = Math.max(marqueeStart.value.y, marqueeCurrent.value.y);

  const zoom = timelineStore.timelineZoom;
  const selectedItems: { trackId: string; itemId: string }[] = [];

  let currentY = 0;
  for (const track of props.tracks) {
    const trackHeight = props.trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT;
    const trackTop = currentY;
    const trackBottom = currentY + trackHeight;

    const isYFullyInside = trackTop >= top && trackBottom <= bottom;

    if (isYFullyInside) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;
        if ((item as any).locked) continue;

        const clipStartPx = timeUsToPx(item.timelineRange.startUs, zoom);
        const clipEndPx = timeUsToPx(
          item.timelineRange.startUs + item.timelineRange.durationUs,
          zoom,
        );

        const isXFullyInside = clipStartPx >= left && clipEndPx <= right;

        if (isXFullyInside) {
          selectedItems.push({ trackId: track.id, itemId: item.id });
        }
      }
    }

    currentY += trackHeight;
  }

  if (selectedItems.length > 0) {
    timelineStore.selectTimelineItems(selectedItems.map((i) => i.itemId));

    if (canOpenClipProperties.value) {
      selectionStore.selectTimelineItems(selectedItems);
    } else {
      selectionStore.clearSelection();
    }
  } else {
    timelineStore.clearSelection();
    selectionStore.clearSelection();
  }
}

function startMarquee(e: PointerEvent, onClick?: () => void) {
  if (e.button !== 0) return;

  e.preventDefault();
  e.stopPropagation();

  const coords = getPointerCoords(e);
  marqueeStart.value = coords;
  marqueeCurrent.value = coords;
  let didMove = false;

  try {
    containerRef.value?.setPointerCapture(e.pointerId);
  } catch {
    // ignore
  }

  onMarqueeMove = (ev: PointerEvent) => {
    const currentCoords = getPointerCoords(ev);

    if (!didMove) {
      const dx = Math.abs(currentCoords.x - marqueeStart.value.x);
      const dy = Math.abs(currentCoords.y - marqueeStart.value.y);
      if (dx > 3 || dy > 3) {
        didMove = true;
        isMarqueeSelecting.value = true;
        timelineStore.clearSelection();
        selectionStore.clearSelection();
      }
    }

    if (didMove) {
      marqueeCurrent.value = currentCoords;
      updateLiveMarqueeSelection();
    }
  };

  onMarqueeUp = (ev: PointerEvent) => {
    if (didMove) {
      isMarqueeSelecting.value = false;
      updateLiveMarqueeSelection();
    } else {
      if (onClick) onClick();
    }

    try {
      containerRef.value?.releasePointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
    cleanupMarqueeListeners();
  };

  window.addEventListener('pointermove', onMarqueeMove);
  window.addEventListener('pointerup', onMarqueeUp);
}

function cleanupMarqueeListeners() {
  if (onMarqueeMove) window.removeEventListener('pointermove', onMarqueeMove);
  if (onMarqueeUp) window.removeEventListener('pointerup', onMarqueeUp);
  onMarqueeMove = null;
  onMarqueeUp = null;
}

onBeforeUnmount(() => {
  cleanupMarqueeListeners();
});

const emit = defineEmits<{
  (e: 'drop', event: DragEvent, trackId: string): void;
  (e: 'dragover', event: DragEvent, trackId: string): void;
  (e: 'dragleave', event: DragEvent, trackId: string): void;
  (e: 'startMoveItem', event: PointerEvent, trackId: string, itemId: string, startUs: number): void;
  (e: 'selectItem', event: PointerEvent, itemId: string): void;
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
    event: PointerEvent,
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
    speed: Math.max(-10, Math.min(10, base)),
  };
}

async function saveSpeedModal() {
  if (!speedModal.value) return;
  const speed = Number(speedModal.value.speed);
  if (!Number.isFinite(speed) || speed === 0) return;
  timelineStore.updateClipProperties(speedModal.value.trackId, speedModal.value.itemId, {
    speed: Math.max(-10, Math.min(10, speed)),
  });
  speedModal.value.open = false;
  await timelineStore.requestTimelineSave({ immediate: true });
}

async function resetVolume(trackId: string, itemId: string) {
  timelineStore.updateClipProperties(trackId, itemId, {
    audioGain: 1,
  });
  await timelineStore.requestTimelineSave({ immediate: true });
}

function selectTransition(
  e: MouseEvent | PointerEvent,
  input: { trackId: string; itemId: string; edge: 'in' | 'out' },
) {
  e.stopPropagation();
  timelineStore.selectTransition(input);
  selectionStore.selectTimelineTransition(input.trackId, input.itemId, input.edge);
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

    <!-- Marquee Selection Rectangle -->
    <div
      v-if="isMarqueeSelecting"
      class="absolute border-2 border-primary-500 bg-primary-500/20 pointer-events-none z-50"
      :style="marqueeStyle"
    />

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

        <WheelNumberInput v-model="speedModalSpeed" :min="-10" :max="10" :step="0.05" />
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

    <!-- Tracks -->
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
        } else if ($event.button !== 1 && $event.target === $event.currentTarget) {
          timelineStore.selectTrack(track.id);
          timelineStore.clearSelection();
          selectionStore.clearSelection();
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
        v-if="movePreviewResolved && movePreviewResolved.trackId === track.id"
        class="absolute inset-y-0 rounded px-2 flex items-center text-xs text-(--clip-text) z-40 pointer-events-none opacity-60 bg-ui-bg-accent border border-ui-border"
        :style="{
          left: `${timeUsToPx(movePreviewResolved.startUs, timelineStore.timelineZoom)}px`,
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
                  timelineStore.clearSelection();
                  selectionStore.clearSelection();
                },
              },
            ],
          ]"
        >
          <div
            :data-gap-id="item.id"
            class="absolute inset-y-0 rounded border border-dashed transition-colors z-10 cursor-pointer select-none"
            :class="
              timelineStore.selectedItemIds.includes(item.id)
                ? 'border-primary-500 bg-primary-500/15 hover:bg-primary-500/25'
                : 'border-ui-border/50 bg-ui-bg-elevated/20 hover:bg-ui-bg-elevated/40'
            "
            :style="{
              left: `${timeUsToPx(item.timelineRange.startUs, timelineStore.timelineZoom)}px`,
              width: `${Math.max(2, timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom))}px`,
            }"
            @pointerdown="
              if ($event.button === 0) {
                $event.stopPropagation();
                startMarquee($event, () => {
                  emit('selectItem', $event, item.id);
                  selectionStore.selectTimelineItem(track.id, item.id, 'gap');
                });
              } else if ($event.button !== 1) {
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
          :can-edit-clip-content="canEditClipContent"
          :is-dragging-current-item="
            Boolean(props.draggingMode && props.draggingItemId === item.id)
          "
          :is-move-preview-current-item="Boolean(props.movePreview?.itemId === item.id)"
          :selected-transition="selectedTransition"
          :resize-volume="resizeVolume"
          @select-item="(ev, id) => emit('selectItem', ev, id)"
          @start-move-item="(ev, tId, id, sUs) => emit('startMoveItem', ev, tId, id, sUs)"
          @start-trim-item="(ev: any, payload: any) => emit('startTrimItem', ev, payload)"
          @start-resize-volume="(ev, tId, id, gain, h) => startResizeVolume(ev, tId, id, gain, h)"
          @start-resize-fade="(ev, tId, id, edge, dur) => startResizeFade(ev, tId, id, edge, dur)"
          @start-resize-transition="
            (ev, tId, id, edge, dur) => startResizeTransition(ev, tId, id, edge, dur)
          "
          @select-transition="(ev, payload) => selectTransition(ev, payload)"
          @clip-action="(payload) => emit('clipAction', payload)"
          @open-speed-modal="
            (payload) => openSpeedModal(payload.trackId, payload.itemId, payload.speed)
          "
          @reset-volume="(tId, id) => resetVolume(tId, id)"
        />
      </template>
    </div>

    <!-- Empty clickable area to match TimelineTrackLabels.vue -->
    <div class="w-full flex-1 min-h-7" @click="timelineStore.selectTrack(null)" />

    <!-- Padding at the bottom for scroll space, matches TimelineTrackLabels.vue h-16 -->
    <div class="h-16 shrink-0" />
  </div>
</template>
