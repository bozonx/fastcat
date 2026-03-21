<script setup lang="ts">
import { computed } from 'vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    formattedValue?: string;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    decimals?: number;
    defaultValue?: number;
    wheelStepMultiplier?: number;
    inputClass?: string;
    sliderClass?: string;
  }>(),
  {
    label: undefined,
    formattedValue: undefined,
    step: 0.01,
    unit: '',
    decimals: 2,
    defaultValue: undefined,
    wheelStepMultiplier: undefined,
    inputClass: 'w-18!',
    sliderClass: '',
  },
);

const modelValue = defineModel<number>({ required: true });

function onInputUpdate(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return;
  modelValue.value = num;
}
</script>

<template>
  <div class="flex flex-col gap-1.5 w-full">
    <div class="flex items-center justify-between gap-2 overflow-hidden">
      <div v-if="label" class="flex-1 min-w-0">
        <span class="text-xs text-ui-text-muted font-medium truncate block leading-tight">
          {{ label }}
        </span>
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        <UiWheelNumberInput
          :model-value="modelValue"
          size="2xs"
          :min="min"
          :max="max"
          :step="step"
          :class="inputClass"
          :default-value="defaultValue"
          :wheel-step-multiplier="wheelStepMultiplier"
          @update:model-value="onInputUpdate"
        />
        <span v-if="unit || formattedValue" class="text-[10px] text-ui-text-muted font-mono leading-none">
          {{ formattedValue ?? unit }}
        </span>
      </div>
    </div>

    <div class="px-0.5">
      <UiWheelSlider
        v-model="modelValue"
        :min="min"
        :max="max"
        :step="step"
        :default-value="defaultValue"
        :wheel-step-multiplier="wheelStepMultiplier"
        :slider-class="sliderClass"
      />
    </div>
  </div>
</template>
