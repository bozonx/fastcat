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
import { formatTimecode } from '~/utils/timecode';
import type { TimelineMarker } from '~/timeline/types';

const props = withDefaults(
  defineProps<{
    renderWidth: number;
    renderHeight: number;
    isIdle?: boolean;
    effectiveFullscreen?: boolean;
    uiCurrentTimeUs?: number;
    timecodeOffsetClass?: string;
    markersOffsetClass?: string;
    isMobile?: boolean;
  }>(),
  {
    isIdle: false,
    effectiveFullscreen: false,
    uiCurrentTimeUs: 0,
    timecodeOffsetClass: '',
    markersOffsetClass: '',
    isMobile: false,
  },
);

const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const { showTimecode, showTransparencyGrid } = useMonitorSettings();
const viewportEl = ref<HTMLElement | null>(null);
const timecodeEl = ref<HTMLElement | null>(null);
const nativeCanvasEl = ref<HTMLCanvasElement | null>(null);

const { mode: monitorMode } = useMonitorMode();

// Бинд нативного child-окна Tauri-монитора к видимой области панели. Vello внутри
// сам делает letterbox под аспект сцены — здесь даём «холст» без учёта workspace pan/zoom.
useNativeMonitorViewport(viewportEl);
// Стрим RGBA-кадров → <canvas> в режиме canvas. В embedded режиме no-op.
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
  [() => props.uiCurrentTimeUs, () => timelineStore.markers],
  ([time, markers]) => {
    activeMarkers.value = markers.filter((m) => {
      if (!m.text.trim()) return false;
      if (m.durationUs != null) return time >= m.timeUs && time < m.timeUs + m.durationUs;
      return Math.abs(time - m.timeUs) < 1000;
    });
  },
  { immediate: true },
);

const hasActiveSelectionRange = computed(() => {
  return !!timelineStore.selectionRange;
});

const selectionRangeText = computed(() => {
  const range = timelineStore.selectionRange;
  if (!range) return '';
  const fps = timelineStore.timelineFormat?.fps ?? timelineStore.fps;
  const start = formatTimecode(range.startUs, fps);
  const end = formatTimecode(range.endUs, fps);
  return `${start} / ${end}`;
});

const markersBottomClass = computed(() => {
  if (props.effectiveFullscreen) {
    return hasActiveSelectionRange.value ? 'bottom-40 right-8' : 'bottom-32 right-8';
  }
  return hasActiveSelectionRange.value ? 'bottom-20 right-3' : 'bottom-11 right-3';
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
    @dblclick="onViewportDoubleClick"
  >
    <div class="absolute inset-0">
      <!-- Transformed workspace: pan + zoom applied here -->
      <div class="absolute inset-0" :style="workspaceStyle">
        <div class="absolute inset-0 flex items-center justify-center">
          <!-- Canvas wrapper at exact render resolution -->
          <div
            class="shrink-0 relative"
            :class="{ 'checkerboard-bg': showTransparencyGrid }"
            :style="{ width: `${renderWidth}px`, height: `${renderHeight}px`, overflow: 'hidden' }"
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
          v-if="activeMarkers.length"
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
        <span
          v-if="showTimecode && hasActiveSelectionRange"
          class="absolute text-xs text-blue-400 font-mono tabular-nums bg-ui-bg-elevated/85 backdrop-blur-sm px-2 py-1 rounded transition-all duration-300 select-none min-h-7"
          :class="[
            effectiveFullscreen ? 'bottom-28 right-8' : 'bottom-[2.25rem] right-3',
            effectiveFullscreen && isIdle ? 'opacity-0' : 'opacity-100',
          ]"
        >
          {{ selectionRangeText }}
        </span>

        <!-- Timecode -->
        <span
          v-if="showTimecode"
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
