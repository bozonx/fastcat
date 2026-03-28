<script setup lang="ts">
import { ref } from 'vue';
import type { TimelineTrack, TimelineClipActionPayload, TimelineMoveItemPayload, TimelineTrimItemPayload } from '~/timeline/types';
import TimelineTrackLabels from '~/components/timeline/TimelineTrackLabels.vue';
import TimelineTracks from '~/components/timeline/TimelineTracks.vue';
import TimelineGrid from '~/components/timeline/TimelineGrid.vue';
import TimelinePlayheadOverlay from '~/components/timeline/TimelinePlayheadOverlay.vue';

const TRACK_LABELS_WIDTH = 220;

const props = defineProps<{
  kind: 'video' | 'audio';
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
  slipPreview?: { itemId: string; trackId: string; deltaUs: number; timecode: string } | null;
  draggingMode?: 'move' | 'slip' | 'trim_start' | 'trim_end' | null;
  draggingItemId?: string | null;
  scrollLeft?: number;
  viewportWidth?: number;
  onZoomToFit?: () => void;
}>();

const emit = defineEmits<{
  (e: 'drop', event: DragEvent, trackId: string): void;
  (e: 'dragover', event: DragEvent, trackId: string): void;
  (e: 'dragleave', event: DragEvent, trackId: string): void;
  (e: 'startMoveItem', event: PointerEvent, payload: TimelineMoveItemPayload): void;
  (e: 'selectItem', event: PointerEvent, itemId: string): void;
  (e: 'startTrimItem', event: PointerEvent, payload: TimelineTrimItemPayload): void;
  (e: 'clipAction', payload: TimelineClipActionPayload): void;
  (e: 'click', event: MouseEvent): void;
  (e: 'scroll'): void;
  (e: 'labelsScroll'): void;
  (e: 'updateTrackHeight', trackId: string, height: number): void;
}>();

const scrollEl = ref<HTMLElement | null>(null);
const labelsScrollEl = ref<HTMLElement | null>(null);

defineExpose({ scrollEl, labelsScrollEl });
</script>

<template>
  <div
    class="flex min-h-[60px] relative"
    :class="kind === 'video' ? 'shrink-0 border-b border-ui-border' : 'flex-1'"
  >
    <!-- Track Labels -->
    <div
      ref="labelsScrollEl"
      class="shrink-0 border-r border-ui-border overflow-y-auto overflow-x-hidden scroll-sync-hidden"
      :style="{ width: `${TRACK_LABELS_WIDTH}px` }"
      @scroll="emit('labelsScroll')"
    >
      <TimelineTrackLabels
        :tracks="tracks"
        :track-heights="trackHeights"
        :on-zoom-to-fit="onZoomToFit"
        @update:track-height="(id: string, h: number) => emit('updateTrackHeight', id, h)"
      />
    </div>

    <!-- Tracks Area -->
    <div class="flex-1 relative min-h-0 min-w-0">
      <TimelineGrid
        class="absolute inset-0 pointer-events-none z-0"
        :scroll-el="scrollEl"
      />
      <div
        ref="scrollEl"
        class="w-full h-full relative z-10"
        :class="
          kind === 'video'
            ? 'overflow-y-auto overflow-x-scroll scroll-sync-hidden video-tracks-scroll'
            : 'overflow-auto audio-tracks-scroll timeline-scroll-el'
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
          :dragging-mode="draggingMode"
          :dragging-item-id="draggingItemId"
          :scroll-left="scrollLeft"
          :viewport-width="viewportWidth"
          :on-zoom-to-fit="onZoomToFit"
          @drop="(ev, id) => emit('drop', ev, id)"
          @dragover="(ev, id) => emit('dragover', ev, id)"
          @dragleave="(ev, id) => emit('dragleave', ev, id)"
          @start-move-item="(ev, p) => emit('startMoveItem', ev, p)"
          @select-item="(ev, id) => emit('selectItem', ev, id)"
          @start-trim-item="(ev, p) => emit('startTrimItem', ev, p)"
          @clip-action="(p) => emit('clipAction', p)"
        />
      </div>
      <TimelinePlayheadOverlay
        class="absolute inset-0 pointer-events-none z-20"
        :scroll-el="scrollEl"
      />
    </div>
  </div>
</template>

<style scoped>
.scroll-sync-hidden {
  scrollbar-width: none;
}
.scroll-sync-hidden::-webkit-scrollbar {
  display: none;
}

.timeline-scroll-el {
  scrollbar-width: thin;
  scrollbar-color: var(--ui-border-accent, #666) transparent;
}
.timeline-scroll-el::-webkit-scrollbar {
  height: 10px;
  width: 10px;
}
.timeline-scroll-el::-webkit-scrollbar-track {
  background: transparent;
}
.timeline-scroll-el::-webkit-scrollbar-thumb {
  background: var(--ui-border, #444);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.timeline-scroll-el::-webkit-scrollbar-thumb:hover {
  background: var(--ui-border-accent, #666);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
</style>
