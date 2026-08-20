<script setup lang="ts">
import MonitorInteractiveOverlay from './MonitorInteractiveOverlay.vue';
import MonitorTextTransformBox from './MonitorTextTransformBox.vue';
import MonitorTransformBox from './MonitorTransformBox.vue';

interface MonitorOverlayLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const props = defineProps<{
  renderWidth: number;
  renderHeight: number;
  showGrid: boolean;
  getGridLines: (width: number, height: number) => MonitorOverlayLine[];
  isInteractiveEditEnabled: boolean;
  isReadonly: boolean;
  isTextClipSelected: boolean;
  isAdjustmentClipSelected: boolean;
}>();
</script>

<template>
  <g v-if="props.showGrid">
    <line
      v-for="(line, i) in props.getGridLines(props.renderWidth, props.renderHeight)"
      :key="i"
      :x1="line.x1"
      :y1="line.y1"
      :x2="line.x2"
      :y2="line.y2"
      stroke="rgba(255,255,255,0.5)"
      stroke-width="1"
    />
  </g>

  <MonitorInteractiveOverlay
    v-if="props.isInteractiveEditEnabled && !props.isReadonly"
    :render-width="props.renderWidth"
    :render-height="props.renderHeight"
  />

  <MonitorTextTransformBox
    v-if="props.isInteractiveEditEnabled && !props.isReadonly && props.isTextClipSelected"
    :render-width="props.renderWidth"
    :render-height="props.renderHeight"
  />

  <MonitorTransformBox
    v-else-if="
      props.isInteractiveEditEnabled && !props.isReadonly && !props.isAdjustmentClipSelected
    "
    :render-width="props.renderWidth"
    :render-height="props.renderHeight"
  />
</template>
