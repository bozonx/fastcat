<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
  TimelineTrack,
  TimelineClipActionPayload,
  TimelineMoveItemPayload,
  TimelineOpenSpeedModalPayload,
  TimelineTrimItemPayload,
} from '~/timeline/types';
import TimelineTrackLabels from '~/components/timeline/TimelineTrackLabels.vue';
import TimelineTracks from '~/components/timeline/TimelineTracks.vue';
import TimelineGrid from '~/components/timeline/TimelineGrid.vue';
import TimelinePlayheadOverlay from '~/components/timeline/TimelinePlayheadOverlay.vue';
import { TIMELINE_TRACK_LABELS_WIDTH as TRACK_LABELS_WIDTH } from '~/utils/constants';

const props = defineProps<{
  kind: 'video' | 'audio';
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  canEditClipContent: boolean;
  horizontalScrollEl: HTMLElement | null;
  dragPreview?: {
    trackId: string;
    startTicks: number;
    label: string;
    durationTicks: number;
    kind: 'timeline-clip' | 'file';
    invalid?: boolean;
  } | null;
  movePreview?: { itemId: string; trackId: string; startTicks: number; isCollision?: boolean }[];
  slipPreview?: { itemId: string; trackId: string; deltaTicks: number; timecode: string } | null;
  trimPreview?:
    | {
        itemId: string;
        trackId: string;
        startTicks: number;
        durationTicks: number;
        edge: 'start' | 'end';
        deltaTicks: number;
      }[]
    | null;
  draggingMode?: 'move' | 'slip' | 'trim_start' | 'trim_end' | null;
  draggingItemId?: string | null;
  scrollLeft?: number;
  viewportWidth?: number;
  onZoomToFit?: () => void;
}>();

function onSectionDragLeave(e: DragEvent) {
  const relatedTarget = e.relatedTarget as Node | null;
  const sectionEl = e.currentTarget as HTMLElement;
  // If the mouse moved to another element inside this section (e.g. track labels,
  // another track, or empty space within the same section), keep the preview alive.
  if (relatedTarget && sectionEl.contains(relatedTarget)) return;
  if (props.dragPreview) {
    emit('dragleave', e, props.dragPreview.trackId);
  }
}

const emit = defineEmits<{
  (e: 'drop', event: DragEvent, trackId: string): void;
  (e: 'dragover', event: DragEvent, trackId: string): void;
  (e: 'dragleave', event: DragEvent, trackId: string): void;
  (e: 'startMoveItem', event: PointerEvent, payload: TimelineMoveItemPayload): void;
  (e: 'selectItem', event: PointerEvent, itemId: string): void;
  (e: 'startTrimItem', event: PointerEvent, payload: TimelineTrimItemPayload): void;
  (e: 'clipAction', payload: TimelineClipActionPayload): void;
  (e: 'open-speed-modal', payload: TimelineOpenSpeedModalPayload): void;
  (e: 'click', event: MouseEvent): void;
  (e: 'scroll'): void;
  (e: 'labelsScroll'): void;
  (e: 'updateTrackHeight', trackId: string, height: number): void;
}>();

const scrollEl = ref<HTMLElement | null>(null);
const labelsRef = ref<InstanceType<typeof TimelineTrackLabels> | null>(null);

defineExpose({
  scrollEl,
  labelsScrollEl: computed(() => labelsRef.value?.labelsScrollContainer ?? null),
});
</script>

<template>
  <div
    class="flex min-h-[60px] relative"
    :class="kind === 'video' ? 'shrink-0 border-b border-ui-border' : 'flex-1'"
    @dragleave.prevent="onSectionDragLeave"
  >
    <TimelineTrackLabels
      ref="labelsRef"
      class="shrink-0 border-r border-ui-border timeline-labels-container"
      :style="{ width: `${TRACK_LABELS_WIDTH}px` }"
      :tracks="tracks"
      :track-heights="trackHeights"
      :on-zoom-to-fit="onZoomToFit"
      @scroll="emit('labelsScroll')"
      @update:track-height="(id: string, h: number) => emit('updateTrackHeight', id, h)"
    />

    <!-- Tracks Area -->
    <div class="flex-1 relative min-h-0 min-w-0 overflow-hidden">
      <TimelineGrid
        class="absolute inset-0 pointer-events-none z-0"
        :scroll-el="horizontalScrollEl"
        :scroll-left="scrollLeft"
      />
      <div
        ref="scrollEl"
        class="w-full h-full relative z-10"
        :class="
          kind === 'video'
            ? 'overflow-y-auto overflow-x-hidden video-tracks-scroll'
            : 'overflow-y-auto overflow-x-hidden audio-tracks-scroll'
        "
        @click="emit('click', $event)"
        @scroll="emit('scroll')"
      >
        <TimelineTracks
          :tracks="tracks"
          :track-heights="trackHeights"
          :can-edit-clip-content="canEditClipContent"
          :drag-preview="dragPreview"
          :move-preview="movePreview"
          :slip-preview="slipPreview"
          :trim-preview="trimPreview"
          :dragging-mode="draggingMode"
          :dragging-item-id="draggingItemId"
          :scroll-left="scrollLeft"
          :viewport-width="viewportWidth"
          :on-zoom-to-fit="onZoomToFit"
          @drop="(ev, id) => emit('drop', ev, id)"
          @dragover="(ev, id) => emit('dragover', ev, id)"
          @start-move-item="(ev, p) => emit('startMoveItem', ev, p)"
          @select-item="(ev, id) => emit('selectItem', ev, id)"
          @start-trim-item="(ev, p) => emit('startTrimItem', ev, p)"
          @clip-action="(p) => emit('clipAction', p)"
          @open-speed-modal="(p: TimelineOpenSpeedModalPayload) => emit('open-speed-modal', p)"
        />
      </div>
      <TimelinePlayheadOverlay
        class="absolute inset-0 pointer-events-none z-20"
        :scroll-el="horizontalScrollEl"
        :scroll-left="scrollLeft"
      />
    </div>
  </div>
</template>

<style scoped>
.video-tracks-scroll,
.audio-tracks-scroll {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-border-accent, #666) transparent;
}

.video-tracks-scroll::-webkit-scrollbar,
.audio-tracks-scroll::-webkit-scrollbar {
  width: 10px;
}

.video-tracks-scroll::-webkit-scrollbar-track,
.audio-tracks-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.video-tracks-scroll::-webkit-scrollbar-thumb,
.audio-tracks-scroll::-webkit-scrollbar-thumb {
  background: var(--ui-border, #444);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.video-tracks-scroll::-webkit-scrollbar-thumb:hover,
.audio-tracks-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--ui-border-accent, #666);
}
</style>
