<script setup lang="ts">
import { computed } from 'vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';

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

const displayValue = computed(() => parseFloat(props.modelValue.toFixed(3)));

const dropdownItems = computed(() =>
  fpsPresets.map((p) => ({
    label: p.label,
    onSelect: () => emit('update:modelValue', p.value),
  })),
);
</script>

<template>
  <div class="flex items-center gap-1">
    <UiWheelNumberInput
      :model-value="displayValue"
      :min="1"
      :max="240"
      :step="0.001"
      :disabled="disabled"
      class="flex-1"
      full-width
      @update:model-value="(v) => emit('update:modelValue', v)"
    />
    <UDropdownMenu
      :items="dropdownItems"
      :disabled="disabled"
      :ui="{ content: 'min-w-20' }"
    >
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-chevron-down"
        :disabled="disabled"
        class="h-8 w-8 shrink-0"
      />
    </UDropdownMenu>
  </div>
</template>
