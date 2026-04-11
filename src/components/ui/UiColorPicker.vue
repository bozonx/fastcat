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

const { t } = useI18n();

/** Standard color set according to requirements */
const COLORS = computed(() => {
  const commonColors = TRACK_COLOR_PRESETS.slice(1); // Skip default

  if (props.mode === 'track') {
    return [TRACK_COLOR_PRESETS[0], ...commonColors];
  } else {
    // For markers, we might want a different default, but let's keep it consistent
    return ['#ffffff', ...commonColors];
  }
});

function selectColor(color: string) {
  emit('update:modelValue', color);
}
</script>

<template>
  <div class="grid grid-cols-5 gap-1.5 w-fit">
    <button
      v-for="colorValue in COLORS"
      :key="colorValue"
      type="button"
      class="w-6 h-6 rounded-full border border-ui-border-elevated transition-all hover:scale-110 active:scale-95 flex items-center justify-center relative shadow-sm"
      :class="{
        'ring-2 ring-ui-primary ring-offset-2 ring-offset-ui-bg z-10': modelValue === colorValue,
      }"
      :style="{
        backgroundColor: colorValue === '#2a2a2a' ? '#3f3f3f' : colorValue,
        color: colorValue === '#ffffff' ? '#000000' : '#ffffff',
      }"
      @click.prevent="selectColor(colorValue)"
    >
      <!-- Special indicator for \"transparent/default\" -->
      <div v-if="colorValue === '#2a2a2a'" class="w-1.5 h-1.5 rounded-full bg-white/30" />
    </button>
  </div>
</template>
