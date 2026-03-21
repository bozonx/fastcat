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
    inputClass: 'w-16!',
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
  <div class="flex flex-col gap-1 w-full">
    <!-- Label with Unit in parentheses -->
    <div v-if="label" class="flex items-center justify-between gap-2 overflow-hidden">
      <span class="text-[10px] text-ui-text-muted font-bold uppercase truncate block tracking-wider" :title="label">
        {{ label }}{{ unit ? ` (${unit})` : '' }}
      </span>
      <span v-if="formattedValue" class="text-[10px] text-ui-text-muted font-mono leading-none">
        {{ formattedValue }}
      </span>
    </div>

    <!-- Controls row (Slider + Input) -->
    <div class="flex items-center gap-2">
      <div class="flex-1 min-w-0">
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
      </div>
    </div>
  </div>
</template>
