<script setup lang="ts">
import { ref } from 'vue';
import UiWheelNumberInput from './UiWheelNumberInput.vue';

const props = defineProps<{
  modelValue: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: number];
}>();

const fpsPresets = [
  { label: '23.976', value: 23.976 },
  { label: '24', value: 24 },
  { label: '25', value: 25 },
  { label: '29.97', value: 29.97 },
  { label: '30', value: 30 },
  { label: '50', value: 50 },
  { label: '59.94', value: 59.94 },
  { label: '60', value: 60 },
];

function selectPreset(value: number) {
  emit('update:modelValue', value);
}
</script>

<template>
  <div class="flex items-center gap-1">
    <UiWheelNumberInput
      :model-value="props.modelValue"
      :min="1"
      :max="240"
      :step="0.001"
      :disabled="disabled"
      class="flex-1"
      @update:model-value="(v) => emit('update:modelValue', v)"
    />
    <UDropdownMenu
      :items="fpsPresets.map(p => ({ label: p.label, onSelect: () => selectPreset(p.value) }))"
      :disabled="disabled"
      :content="{ align: 'end' }"
    >
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-chevron-down"
        :disabled="disabled"
        class="px-1"
      />
    </UDropdownMenu>
  </div>
</template>
