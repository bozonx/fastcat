<script setup lang="ts">
import { computed } from 'vue';

import { TRACK_COLOR_PRESETS } from '~/utils/constants';

const props = defineProps<{
  modelValue: string;
  mode: 'track' | 'marker';
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

/** Standard color set according to requirements */
const COLORS = computed(() => {
  const commonColors = TRACK_COLOR_PRESETS.slice(1); // Skip default

  if (props.mode === 'track') {
    return [TRACK_COLOR_PRESETS[0]!, ...commonColors];
  } else {
    // For markers, we want to use the default marker color #eab308 instead of #f8e71c to stay consistent.
    const markerColors = commonColors.map((c) => (c === '#f8e71c' ? '#eab308' : c));
    return ['#ffffff', ...markerColors];
  }
});

function selectColor(color: string) {
  emit('update:modelValue', color);
}

function isLightColor(hex: string): boolean {
  const sanitized = hex.replace('#', '');
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}
</script>

<template>
  <div class="grid grid-cols-5 gap-1.5 w-fit">
    <button
      v-for="colorValue in COLORS"
      :key="colorValue"
      type="button"
      class="w-6 h-6 rounded-full border border-ui-border-elevated transition-all hover:scale-110 active:scale-95 flex items-center justify-center relative shadow-sm focus:outline-none focus-visible:outline-none outline-none"
      :class="{
        'ring-2 ring-ui-primary ring-offset-2 ring-offset-ui-bg z-10': modelValue === colorValue,
      }"
      :style="{
        backgroundColor: colorValue === '#2a2a2a' ? '#3f3f3f' : colorValue,
      }"
      @click.prevent="selectColor(colorValue)"
    >
      <!-- Special indicator for "transparent/default" when not selected -->
      <div
        v-if="colorValue === '#2a2a2a' && modelValue !== colorValue"
        class="w-1.5 h-1.5 rounded-full bg-white/30"
      />

      <span
        v-if="modelValue === colorValue"
        class="absolute inset-0 flex items-center justify-center text-xs font-bold leading-none select-none"
        :class="isLightColor(colorValue) ? 'text-black' : 'text-white'"
      >
        ✓
      </span>
    </button>
  </div>
</template>
