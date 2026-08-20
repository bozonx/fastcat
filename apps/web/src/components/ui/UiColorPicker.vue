<script setup lang="ts">
import { computed } from 'vue';

import { TRACK_COLOR_PRESETS } from '~/utils/constants';

interface Props {
  modelValue: string | string[];
  mode?: 'track' | 'marker' | 'custom';
  colors?: string[];
  multiple?: boolean;
  size?: 'xs' | 'sm' | 'md';
  orientation?: 'grid' | 'horizontal' | 'vertical';
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'custom',
  colors: undefined,
  multiple: false,
  size: 'md',
  orientation: 'grid',
});

const emit = defineEmits<{
  'update:modelValue': [value: string | string[]];
}>();

/** Standard color set according to requirements */
const COLORS = computed(() => {
  if (props.colors) {
    return props.colors;
  }

  const commonColors = TRACK_COLOR_PRESETS.slice(1); // Skip default

  if (props.mode === 'track') {
    return [TRACK_COLOR_PRESETS[0]!, ...commonColors];
  } else {
    // For markers, we want to use the default marker color #eab308 instead of #f8e71c to stay consistent.
    const markerColors = commonColors.map((c) => (c === '#f8e71c' ? '#eab308' : c));
    return ['#ffffff', ...markerColors];
  }
});

const sizeClass = computed(() => {
  switch (props.size) {
    case 'xs':
      return 'w-4 h-4 text-[9px]';
    case 'sm':
      return 'w-5 h-5 text-[10px]';
    default:
      return 'w-6 h-6 text-xs';
  }
});

const wrapperClass = computed(() => {
  switch (props.orientation) {
    case 'horizontal':
      return 'flex items-center gap-1.5';
    case 'vertical':
      return 'flex flex-col items-center gap-1.5';
    default:
      return 'grid grid-cols-5 gap-1.5 w-fit';
  }
});

const selectedSet = computed(() => {
  if (props.multiple) {
    return new Set(Array.isArray(props.modelValue) ? props.modelValue : [props.modelValue]);
  }

  return new Set([String(props.modelValue)]);
});

function selectColor(color: string) {
  if (!props.multiple) {
    emit('update:modelValue', color);
    return;
  }

  const next = new Set(selectedSet.value);
  if (next.has(color)) {
    next.delete(color);
  } else {
    next.add(color);
  }

  emit('update:modelValue', Array.from(next));
}

function isSelected(color: string) {
  return selectedSet.value.has(color);
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
  <div class="ui-color-picker" :class="wrapperClass">
    <button
      v-for="colorValue in COLORS"
      :key="colorValue"
      type="button"
      class="ui-color-picker__swatch rounded-full border border-ui-border-elevated transition-all hover:scale-110 active:scale-95 flex items-center justify-center relative shadow-sm focus:outline-none focus-visible:outline-none outline-none"
      :class="[
        sizeClass,
        {
          'ui-color-picker__swatch--selected ring-2 z-10 opacity-100 scale-110':
            isSelected(colorValue),
          'opacity-40 hover:opacity-75': props.multiple && !isSelected(colorValue),
        },
      ]"
      :data-selected="isSelected(colorValue) ? 'true' : 'false'"
      :style="{
        backgroundColor: colorValue === '#2a2a2a' ? '#3f3f3f' : colorValue,
      }"
      @click.prevent="selectColor(colorValue)"
    >
      <!-- Special indicator for "transparent/default" when not selected -->
      <div
        v-if="colorValue === '#2a2a2a' && !isSelected(colorValue)"
        class="w-1.5 h-1.5 rounded-full bg-white/30"
      />

      <span
        v-if="isSelected(colorValue)"
        class="absolute inset-0 flex items-center justify-center font-bold leading-none select-none"
        :class="isLightColor(colorValue) ? 'text-black' : 'text-white'"
      >
        ✓
      </span>
    </button>
  </div>
</template>

<style scoped>
.ui-color-picker__swatch--selected {
  box-shadow:
    0 0 0 2px var(--ui-bg, #111827),
    0 0 0 4px var(--color-primary-500, #3b82f6);
}
</style>
