<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineHoverState } from '~/composables/timeline/useTimelineHoverState';
import { absolutePxToViewportPx, timeUsToPx, zoomToPxPerSecond } from '~/utils/timeline/geometry';

const props = defineProps<{ scrollEl?: HTMLElement | null; scrollLeft?: number }>();

const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const { hoveredMarkerId } = useTimelineHoverState();

const fps = computed(() => timelineStore.timelineFormat.fps || 30);

function viewportX(absolutePx: number): number {
  return absolutePxToViewportPx(absolutePx, props.scrollLeft ?? timelineStore.timelineScrollLeftPx);
}

const playheadTransform = computed(() => {
  const px = viewportX(timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom));
  return `translate3d(${px}px, 0, 0)`;
});

/** Lines for active markers (hovered + selected simultaneously). Zone markers show both pins. */
const activeMarkerLines = computed(() => {
  const entity = selectionStore.selectedEntity;
  const selectedIds =
    entity?.source === 'timeline' && entity?.kind === 'marker'
      ? [entity.markerId]
      : entity?.source === 'timeline' && entity?.kind === 'markers'
        ? entity.markerIds
        : [];

  const ids = new Set<string>(selectedIds);
  if (hoveredMarkerId.value) ids.add(hoveredMarkerId.value);
  if (ids.size === 0) return [];

  const zoom = timelineStore.timelineZoom;
  const lines: Array<{ px: number; color: string }> = [];

  const markerById = new Map(timelineStore.markers.map((m) => [m.id, m]));
  for (const id of ids) {
    const marker = markerById.get(id);
    if (!marker) continue;
    const color = marker.color ?? '#eab308';
    lines.push({ px: viewportX(timeUsToPx(marker.timeUs, zoom)), color });
    if (marker.durationUs !== undefined) {
      lines.push({ px: viewportX(timeUsToPx(marker.timeUs + marker.durationUs, zoom)), color });
    }
  }
  return lines;
});

const currentFrameHighlightStyle = computed(() => {
  const pxPerFrame = zoomToPxPerSecond(timelineStore.timelineZoom) / fps.value;
  if (pxPerFrame < 6) return null;

  const currentFrameIndex = Math.floor(((timelineStore.currentTime + 0.5) * fps.value) / 1_000_000);
  const currentFrameStartUs = Math.round((currentFrameIndex * 1_000_000) / fps.value);
  const nextFrameStartUs = Math.round(((currentFrameIndex + 1) * 1_000_000) / fps.value);

  const currentFrameStartPx = viewportX(
    timeUsToPx(currentFrameStartUs, timelineStore.timelineZoom),
  );
  const nextFrameStartPx = viewportX(timeUsToPx(nextFrameStartUs, timelineStore.timelineZoom));

  return {
    transform: `translate3d(${currentFrameStartPx}px, 0, 0)`,
    width: `${Math.max(1, nextFrameStartPx - currentFrameStartPx)}px`,
  };
});
</script>

<template>
  <div class="absolute inset-0 pointer-events-none">
    <!-- Active marker lines (hovered or selected; both pins for zone markers) -->
    <div
      v-for="(line, i) in activeMarkerLines"
      :key="i"
      class="absolute inset-y-0 w-px"
      :style="{
        transform: `translate3d(${line.px}px, 0, 0)`,
        willChange: 'transform',
        backgroundColor: line.color,
        opacity: '0.8',
      }"
    />
    <!-- Playhead line: 1px, pixel-aligned -->
    <div
      data-testid="timeline-playhead"
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
        zIndex: -1,
        backgroundColor: '#888888',
        opacity: '0.08',
      }"
    />
  </div>
</template>
