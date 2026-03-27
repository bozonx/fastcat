<script setup lang="ts">
import { computed } from 'vue';

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
  const list = [
    { value: '#4a90e2', label: 'Blue' },
    { value: '#50e3c2', label: 'Teal' },
    { value: '#b8e986', label: 'Green' },
    { value: '#f8e71c', label: 'Yellow' },
    { value: '#f5a623', label: 'Orange' },
    { value: '#d0021b', label: 'Red' },
    { value: '#bd10e0', label: 'Purple' },
    { value: '#9013fe', label: 'Violet' },
    { value: '#f472b6', label: 'Pink' }, // Pink instead of black
  ];

  if (props.mode === 'track') {
    // For tracks, first is "transparent" (actually default dark grey)
    return [{ value: '#2a2a2a', label: t('common.default', 'Default') }, ...list];
  } else {
    // For markers, first is white
    return [{ value: '#ffffff', label: 'White' }, ...list];
  }
});

function selectColor(color: string) {
  emit('update:modelValue', color);
}
</script>

<template>
  <div class="grid grid-cols-5 gap-1.5 w-fit">
    <button
      v-for="c in COLORS"
      :key="c.value"
      type="button"
      class="w-6 h-6 rounded-full border border-ui-border-elevated transition-all hover:scale-110 active:scale-95 flex items-center justify-center relative shadow-sm"
      :class="{
        'ring-2 ring-ui-primary ring-offset-2 ring-offset-ui-bg z-10': modelValue === c.value,
      }"
      :style="{
        backgroundColor: c.value === '#2a2a2a' ? '#3f3f3f' : c.value,
        color: c.value === '#ffffff' ? '#000000' : '#ffffff',
      }"
      :title="c.label"
      @click.prevent="selectColor(c.value)"
    >
      <!-- Special indicator for "transparent/default" -->
      <div v-if="c.value === '#2a2a2a'" class="w-1.5 h-1.5 rounded-full bg-white/30" />
    </button>
  </div>
</template>
