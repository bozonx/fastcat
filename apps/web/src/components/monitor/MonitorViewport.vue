<script setup lang="ts">
/**
 * MonitorViewport — virtual viewport (canvas stage) for the monitor panel.
 * Handles pan/zoom interactions and hosts the canvas container plus SVG overlay layers.
 * Additional SVG elements (grid, transform handles, etc.) should be added inside the svg-overlay slot.
 * Canvas content is placed via the default slot inside the canvas wrapper.
 */
import { toRef, ref, watch, computed } from 'vue';
import { useMonitorGestures } from '~/composables/monitor/useMonitorGestures';
import { useMonitorSettings } from '~/composables/monitor/useMonitorSettings';
import { useNativeMonitorViewport } from '~/composables/monitor/useNativeMonitorViewport';
import { useMonitorMode, useNativeMonitorCanvas } from '~/composables/monitor/useNativeMonitorMode';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { formatTimecode } from '~/utils/time';
import type { TimelineMarker } from '~/timeline/types';

const props = withDefaults(
  defineProps<{
    renderWidth: number;
    renderHeight: number;
    isIdle?: boolean;
    effectiveFullscreen?: boolean;
    uiCurrentTimeTicks?: number;
    timecodeOffsetClass?: string;
    markersOffsetClass?: string;
    isMobile?: boolean;
  }>(),
  {
    isIdle: false,
    effectiveFullscreen: false,
    uiCurrentTimeTicks: 0,
    timecodeOffsetClass: '',
    markersOffsetClass: '',
    isMobile: false,
  },
);

const emit = defineEmits<{
  (e: 'toggle-fullscreen'): void;
}>();

const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const { showTimecode, showTransparencyGrid, showMarkerTexts } = useMonitorSettings();
const viewportEl = ref<HTMLElement | null>(null);
const timecodeEl = ref<HTMLElement | null>(null);
const nativeCanvasEl = ref<HTMLCanvasElement | null>(null);

const { mode: monitorMode } = useMonitorMode();

// Bind the native Tauri child monitor window to the panel's visible area. Vello internally
// letterboxes to the scene aspect ratio — here we provide a "canvas" ignoring workspace pan/zoom.
useNativeMonitorViewport(viewportEl);
// RGBA frame stream → <canvas> in canvas mode. No-op in embedded mode.
useNativeMonitorCanvas(nativeCanvasEl);

const {
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

watch(
  [() => props.uiCurrentTimeTicks, () => timelineStore.markers],
  ([time, markers]) => {
    activeMarkers.value = markers.filter((m) => {
      if (!m.text.trim()) return false;
      if (m.durationTicks != null)
        return time >= m.timeTicks && time < m.timeTicks + m.durationTicks;
      return Math.abs(time - m.timeTicks) < 1000;
    });
  },
  { immediate: true },
);

const hasActiveSelectionRange = computed(() => {
  return !!timelineStore.selectionRange;
});

const selectionRangeDurationText = computed(() => {
  const range = timelineStore.selectionRange;
  if (!range) return '';
  const fps = timelineStore.timelineFormat?.fps ?? timelineStore.fps;
  const durationTicks = range.endTicks - range.startTicks;
  return formatTimecode(durationTicks, fps);
});

function handleViewportDoubleClick(event: MouseEvent) {
  if (onViewportDoubleClick(event) === 'fullscreen') {
    emit('toggle-fullscreen');
  }
}

const markersBottomClass = computed(() => {
  if (props.effectiveFullscreen) {
    return hasActiveSelectionRange.value ? 'bottom-48 right-8' : 'bottom-32 right-8';
  }
  return hasActiveSelectionRange.value ? 'bottom-28 right-3' : 'bottom-11 right-3';
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
    class="flex-1 min-h-0 min-w-0 overflow-hidden relative touch-none"
    @pointerdown="onViewportPointerDown"
    @pointermove="onViewportPointerMove"
    @pointerup="stopPan"
    @pointercancel="stopPan"
    @auxclick="onViewportAuxClick"
    @dblclick="handleViewportDoubleClick"
  >
    <div class="absolute inset-0">
      <!-- Transformed workspace: pan + zoom applied here -->
      <div class="absolute inset-0" :style="workspaceStyle">
        <div class="absolute inset-0 flex items-center justify-center">
          <!-- Canvas wrapper at exact render resolution -->
          <div
            class="shrink-0 relative"
            :class="{ 'checkerboard-bg': showTransparencyGrid }"
            :style="{
              width: `${renderWidth}px`,
              height: `${renderHeight}px`,
              overflow: 'hidden',
              backgroundColor: showTransparencyGrid ? 'transparent' : 'black',
            }"
            @pointerdown="onPreviewPointerDown"
          >
            <!-- Canvas content slot (WebGL container, placeholder div, etc.) -->
            <slot name="canvas" />

            <!-- Tauri native monitor in 'canvas' mode: stream RGBA frames here -->
            <canvas
              v-if="monitorMode === 'canvas'"
              ref="nativeCanvasEl"
              class="absolute inset-0 w-full h-full"
              style="display: block; pointer-events: none"
            />

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
          v-if="showMarkerTexts && activeMarkers.length"
          class="absolute flex flex-col items-end gap-1 transition-all duration-300 z-10"
          :class="[
            markersBottomClass,
            effectiveFullscreen && isIdle ? 'opacity-0' : 'opacity-100',
            markersOffsetClass,
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

        <!-- Selection Range Timecode -->
        <div
          v-if="showTimecode && hasActiveSelectionRange"
          class="absolute flex flex-col items-end gap-0.5 text-xs font-mono tabular-nums bg-ui-bg-elevated/85 backdrop-blur-sm px-2 py-1 rounded transition-all duration-300 select-none"
          :class="[
            effectiveFullscreen ? 'bottom-28 right-8' : 'bottom-[2.25rem] right-3',
            effectiveFullscreen && isIdle ? 'opacity-0' : 'opacity-100',
            timecodeOffsetClass,
          ]"
        >
          <span class="text-blue-400">{{ selectionRangeDurationText }}</span>
        </div>

        <!-- Timecode -->
        <span
          v-show="showTimecode"
          ref="timecodeEl"
          class="absolute text-xs text-ui-text-muted font-mono tabular-nums bg-ui-bg-elevated/85 backdrop-blur-sm px-2 py-1 rounded transition-all duration-300 select-none min-h-7"
          :class="[
            effectiveFullscreen ? 'bottom-24 right-8' : 'bottom-3 right-3',
            effectiveFullscreen && isIdle ? 'opacity-0' : 'opacity-100',
            timecodeOffsetClass,
          ]"
        >
        </span>

        <!-- Slot for absolute-positioned overlays above the transformed workspace (empty state, loading) -->
        <slot />
      </div>
    </div>
  </div>
</template>
