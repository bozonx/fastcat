<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    decimals?: number;
    inputClass?: string;
    sliderClass?: string;
  }>(),
  {
    step: 0.01,
    unit: 's',
    decimals: 2,
    inputClass: 'w-20',
    sliderClass: '',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

const clampedValue = computed({
  get: () => {
    const v = Number(props.modelValue);
    if (!Number.isFinite(v)) return props.min;
    return Math.min(props.max, Math.max(props.min, v));
  },
  set: (val: number) => {
    const v = Number(val);
    if (!Number.isFinite(v)) return;
    const next = Math.min(props.max, Math.max(props.min, v));
    emit('update:modelValue', next);
  },
});

const displayValue = computed(() => clampedValue.value.toFixed(props.decimals));

function onInputUpdate(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return;
  clampedValue.value = num;
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center justify-between gap-2 text-ui-text-muted">
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
        <span class="text-[10px]">{{ unit }}</span>
      </div>
      <span class="font-mono text-[10px]">{{ displayValue }}{{ unit }}</span>
    </div>

    <USlider v-model="clampedValue" :min="min" :max="max" :step="step" :class="sliderClass" />
  </div>
</template>
