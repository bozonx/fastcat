<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { timeUsToPx, zoomToPxPerSecond } from '~/utils/timeline/geometry';

const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();

const fps = computed(() => projectStore.projectSettings.project.fps || 30);

const playheadPx = computed(() =>
  timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom),
);

const playheadTransform = computed(
  () => `translate3d(${playheadPx.value}px, 0, 0) translateX(-50%)`,
);

const selectedMarker = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity?.kind !== 'marker') return null;
  return timelineStore.markers.find((m) => m.id === entity.markerId) ?? null;
});

const selectedMarkerPx = computed(() => {
  if (!selectedMarker.value) return null;
  return timeUsToPx(selectedMarker.value.timeUs, timelineStore.timelineZoom);
});

const currentFrameHighlightStyle = computed(() => {
  const pxPerFrame = zoomToPxPerSecond(timelineStore.timelineZoom) / fps.value;
  // Don't show frame highlights if zoom is too low
  if (pxPerFrame < 6) return null;

  const currentFrameIndex = Math.floor(((timelineStore.currentTime + 0.5) * fps.value) / 1_000_000);
  const currentFrameStartUs = Math.round((currentFrameIndex * 1_000_000) / fps.value);
  const nextFrameStartUs = Math.round(((currentFrameIndex + 1) * 1_000_000) / fps.value);

  const currentFrameStartPx = timeUsToPx(currentFrameStartUs, timelineStore.timelineZoom);
  const nextFrameStartPx = timeUsToPx(nextFrameStartUs, timelineStore.timelineZoom);

  return {
    transform: `translate3d(${currentFrameStartPx}px, 0, 0)`,
    width: `${Math.max(1, nextFrameStartPx - currentFrameStartPx)}px`,
  };
});
</script>

<template>
  <div class="absolute inset-0 pointer-events-none z-50">
    <!-- Selected marker line (full timeline height) -->
    <div
      v-if="selectedMarkerPx !== null"
      class="absolute inset-y-0 w-px"
      :style="{
        transform: `translate3d(${selectedMarkerPx}px, 0, 0) translateX(-50%)`,
        willChange: 'transform',
        backgroundColor: selectedMarker?.color ?? '#eab308',
        opacity: '0.8',
      }"
    />
    <!-- Playhead line -->
    <div
      class="absolute inset-y-0 w-px"
      :style="{
        transform: playheadTransform,
        willChange: 'transform',
        backgroundColor: '#ef4444',
      }"
    />
    <!-- Current frame highlight -->
    <div
      v-if="currentFrameHighlightStyle"
      class="absolute top-0 bottom-0"
      :style="{
        ...currentFrameHighlightStyle,
        zIndex: -1, /* Below the line */
        backgroundColor: '#888888',
        opacity: '0.15',
      }"
    />
  </div>
</template>
