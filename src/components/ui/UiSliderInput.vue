<script setup lang="ts">
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
    inputClass: 'w-20',
    sliderClass: '',
  },
);

const modelValue = defineModel<number>({ required: true });

const displayValue = computed(() => {
  const v = Number(modelValue.value);
  return Number.isFinite(v) ? v.toFixed(props.decimals) : '0';
});

function onInputUpdate(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return;
  modelValue.value = num;
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center justify-between gap-2 text-ui-text-muted">
      <template v-if="label">
        <span class="text-xs">{{ label }}</span>
        <span class="text-xs font-mono">{{ formattedValue ?? displayValue + unit }}</span>
      </template>
      <template v-else>
        <div class="flex items-center gap-1">
          <UInput
            :model-value="displayValue"
            type="number"
            size="xs"
            :min="min"
            :max="max"
            :step="step"
            :class="inputClass"
            @update:model-value="onInputUpdate"
          />
          <span v-if="unit" class="text-[10px]">{{ unit }}</span>
        </div>
        <span class="font-mono text-[10px]">{{ formattedValue ?? displayValue + unit }}</span>
      </template>
    </div>

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
</template>
