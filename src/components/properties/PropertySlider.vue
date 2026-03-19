<script setup lang="ts">
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';

const props = defineProps<{
  label: string;
  formattedValue: string;
  modelValue: number;
  min: number;
  max: number;
  step: number;
  defaultValue?: number;
  wheelStepMultiplier?: number;
}>();

const emit = defineEmits<{
  'update:modelValue': [val: number];
}>();
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex items-center justify-between">
      <span class="text-xs text-ui-text-muted">{{ props.label }}</span>
      <span class="text-xs font-mono text-ui-text-muted">{{ props.formattedValue }}</span>
    </div>
    <UiWheelSlider
      :model-value="props.modelValue"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      :default-value="props.defaultValue"
      :wheel-step-multiplier="props.wheelStepMultiplier"
      @update:model-value="(v: unknown) => emit('update:modelValue', Number(v))"
    />
  </div>
</template>
