<script setup lang="ts">
import { computed } from 'vue';
import PropertyField from './PropertyField.vue';
import { formatTimecode } from '~/utils/time';

const props = defineProps<{
  label: string;
  modelValue: number;
  fps: number;
}>();

const durationText = computed(() => {
  return formatTimecode(Math.max(0, Math.round(Number(props.modelValue) || 0)), props.fps);
});
</script>

<template>
  <PropertyField :label="props.label" class="mt-2">
    <span class="text-sm font-mono tabular-nums text-ui-text">{{ durationText }}</span>
  </PropertyField>
</template>
