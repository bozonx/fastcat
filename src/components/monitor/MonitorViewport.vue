<script setup lang="ts">
/**
 * MonitorViewport — virtual viewport (canvas stage) for the monitor panel.
 * Handles pan/zoom interactions and hosts the canvas container plus SVG overlay layers.
 * Additional SVG elements (grid, transform handles, etc.) should be added inside the svg-overlay slot.
 * Canvas content is placed via the default slot inside the canvas wrapper.
 */
import { toRef, ref, watchEffect, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useMonitorGestures } from '~/composables/monitor/useMonitorGestures';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineMarker } from '~/timeline/types';

const props = withDefaults(defineProps<{
  renderWidth: number;
  renderHeight: number;
  isIdle?: boolean;
  effectiveFullscreen?: boolean;
  uiCurrentTimeUs?: number;
  timecodeOffsetClass?: string;
  markersOffsetClass?: string;
}>(), {
  isIdle: false,
  effectiveFullscreen: false,
  uiCurrentTimeUs: 0,
  timecodeOffsetClass: '',
  markersOffsetClass: '',
});

const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const { timelineDoc } = storeToRefs(timelineStore);

const viewportEl = ref<HTMLElement | null>(null);
const timecodeEl = ref<HTMLElement | null>(null);

const {
  isPreviewSelected,
  zoom,
  zoomExact,
  zoomLabel,
  workspaceStyle,
  resetView,
  centerMonitor,
  resetZoom,
  fitMonitor,
  onPreviewPointerDown,
  onViewportPointerDown,
  onViewportPointerMove,
  onViewportAuxClick,
  onViewportDoubleClick,
  stopPan,
} = useMonitorGestures({
  projectStore,
  viewportEl,
  renderWidth: toRef(props, 'renderWidth'),
  renderHeight: toRef(props, 'renderHeight'),
});

const activeMarkers = ref<TimelineMarker[]>([]);

watchEffect(() => {
  const time = props.uiCurrentTimeUs;
  const markers = timelineDoc.value?.metadata?.fastcat?.markers;
  const filtered = Array.isArray(markers)
    ? (markers as TimelineMarker[]).filter((m) => {
        if (!m.text.trim()) return false;
        if (m.durationUs != null) return time >= m.timeUs && time < m.timeUs + m.durationUs;
        return Math.abs(time - m.timeUs) < 1000;
      })
    : [];
  activeMarkers.value = filtered;
});

defineExpose({
  viewportEl,
  timecodeEl,
  zoom,
  zoomExact,
  zoomLabel,
  resetView,
  centerMonitor,
  resetZoom,
  fitMonitor,
});
</script>

<template>
  <div
    ref="viewportEl"
    class="flex-1 min-h-0 min-w-0 overflow-hidden relative"
    @pointerdown="onViewportPointerDown"
    @pointermove="onViewportPointerMove"
    @pointerup="stopPan"
    @pointercancel="stopPan"
    @auxclick="onViewportAuxClick"
    @dblclick="onViewportDoubleClick"
  >
    <div class="absolute inset-0">
      <!-- Transformed workspace: pan + zoom applied here -->
      <div class="absolute inset-0" :style="workspaceStyle">
        <div class="absolute inset-0 flex items-center justify-center">
          <!-- Canvas wrapper at exact render resolution -->
          <div
            class="shrink-0 relative"
            :style="{ width: `${renderWidth}px`, height: `${renderHeight}px`, overflow: 'hidden' }"
            @pointerdown="onPreviewPointerDown"
          >
            <!-- Canvas content slot (WebGL container, placeholder div, etc.) -->
            <slot name="canvas" />

            <!-- SVG overlay: selection ring + slot for additional overlay elements -->
            <svg
              class="absolute inset-0 overflow-visible"
              :width="renderWidth"
              :height="renderHeight"
              style="pointer-events: none"
            >
              <!-- Slot for additional SVG overlay layers (grid, transform handles, etc.) -->
              <slot name="svg-overlay" />
            </svg>
          </div>
        </div>
      </div>

      <!-- Overlays (Timecode & Markers) -->
      <div class="absolute inset-0 pointer-events-none select-none">
        <!-- Active Markers -->
        <div
          v-if="activeMarkers.length"
          class="absolute flex flex-col items-end gap-1 transition-all duration-300 z-10"
          :class="[
            effectiveFullscreen ? 'bottom-32 right-8' : 'bottom-11 right-3',
            effectiveFullscreen && isIdle ? 'opacity-0' : 'opacity-100',
            markersOffsetClass
          ]"
        >
          <div
            v-for="marker in activeMarkers"
            :key="marker.id"
            class="text-[10px] text-ui-text-muted bg-ui-bg-elevated/85 backdrop-blur-sm px-2 py-0.5 rounded max-w-[240px] truncate shadow-sm border border-white/5"
          >
            {{ marker.text }}
          </div>
        </div>

        <!-- Timecode -->
        <span
          ref="timecodeEl"
          class="absolute text-xs text-ui-text-muted font-mono tabular-nums bg-ui-bg-elevated/85 backdrop-blur-sm px-2 py-1 rounded transition-all duration-300 select-none"
          :class="[
            effectiveFullscreen ? 'bottom-24 right-8' : 'bottom-3 right-3',
            effectiveFullscreen && isIdle ? 'opacity-0' : 'opacity-100',
            timecodeOffsetClass
          ]"
        >
          00:00:00:00 / 00:00:00:00
        </span>

        <!-- Slot for absolute-positioned overlays above the transformed workspace (empty state, loading) -->
        <slot />
      </div>
    </div>
  </div>
</template>
