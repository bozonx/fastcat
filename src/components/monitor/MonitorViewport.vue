<script setup lang="ts">
/**
 * MonitorViewport — virtual viewport (canvas stage) for the monitor panel.
 * Handles pan/zoom interactions and hosts the canvas container plus SVG overlay layers.
 * Additional SVG elements (grid, transform handles, etc.) should be added inside the svg-overlay slot.
 * Canvas content is placed via the default slot inside the canvas wrapper.
 */
import { useMonitorGestures } from '~/composables/monitor/useMonitorGestures';
import { useProjectStore } from '~/stores/project.store';

const props = defineProps<{
  renderWidth: number;
  renderHeight: number;
}>();

const projectStore = useProjectStore();

const viewportEl = ref<HTMLElement | null>(null);

const {
  isPreviewSelected,
  zoom,
  zoomExact,
  zoomLabel,
  workspaceStyle,
  resetView,
  centerMonitor,
  resetZoom,
  onPreviewPointerDown,
  onViewportPointerDown,
  onViewportPointerMove,
  onViewportAuxClick,
  stopPan,
  onViewportWheel,
} = useMonitorGestures({ projectStore, viewportEl });

defineExpose({ viewportEl, zoom, zoomExact, zoomLabel, resetView, centerMonitor, resetZoom });
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
    @wheel="onViewportWheel"
    @dblclick="resetView"
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
              <rect
                v-if="isPreviewSelected"
                x="0"
                y="0"
                :width="renderWidth"
                :height="renderHeight"
                fill="none"
                :stroke="'var(--selection-ring)'"
                stroke-width="2"
              />
              <!-- Slot for additional SVG overlay layers (grid, transform handles, etc.) -->
              <slot name="svg-overlay" />
            </svg>
          </div>
        </div>
      </div>

      <!-- Slot for absolute-positioned overlays above the transformed workspace (empty state, loading, timecode) -->
      <slot />
    </div>
  </div>
</template>
