<script setup lang="ts">
import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import type { TimelineTrack } from '~/timeline/types';
import { timeUsToPx } from '~/composables/timeline/useTimelineInteraction';
import { useTimelineItemResize } from '~/composables/timeline/useTimelineItemResize';
import AppModal from '~/components/ui/AppModal.vue';
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

const {
  resizeTransition,
  resizeFade,
  resizeVolume,
  startResizeVolume,
  startResizeFade,
  startResizeTransition,
} = useTimelineItemResize(() => props.tracks);

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
          :is-dragging-current-item="Boolean(props.draggingMode && props.draggingItemId === item.id)"
          :is-move-preview-current-item="Boolean(props.movePreview?.itemId === item.id)"
          :selected-transition="selectedTransition"
          :resize-volume="resizeVolume"
          @select-item="(ev, id) => emit('selectItem', ev, id)"
          @start-move-item="(ev, tId, id, sUs) => emit('startMoveItem', ev, tId, id, sUs)"
          @start-trim-item="(ev: any, payload: any) => emit('startTrimItem', ev, payload)"
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
