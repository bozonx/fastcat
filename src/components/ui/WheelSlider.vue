<script setup lang="ts">
import { computed } from 'vue';

interface WheelSliderProps {
  modelValue: number;
  min: number;
  max: number;
  step?: number;
  sliderClass?: string;
  wheelStepMultiplier?: number;
}

const props = withDefaults(defineProps<WheelSliderProps>(), {
  step: 1,
  sliderClass: '',
  wheelStepMultiplier: 1,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

const value = computed({
  get: () => {
    const rawValue = Number(props.modelValue);
    if (!Number.isFinite(rawValue)) return props.min;
    return Math.min(props.max, Math.max(props.min, rawValue));
  },
  set: (nextValue: number) => {
    const rawValue = Number(nextValue);
    if (!Number.isFinite(rawValue)) return;
    emit('update:modelValue', Math.min(props.max, Math.max(props.min, rawValue)));
  },
});

function getStepPrecision(step: number): number {
  const stepAsString = String(step);
  const dotIndex = stepAsString.indexOf('.');
  if (dotIndex === -1) return 0;
  return stepAsString.length - dotIndex - 1;
}

function onWheel(event: WheelEvent) {
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (!Number.isFinite(delta) || delta === 0) return;

  const direction = delta < 0 ? 1 : -1;
  const baseStep = props.step > 0 ? props.step : 1;
  const wheelStep = baseStep * Math.max(1, props.wheelStepMultiplier);
  const precision = getStepPrecision(baseStep);

  const next = value.value + direction * wheelStep;
  const rounded = Number(next.toFixed(precision));
  value.value = rounded;
}
</script>

<template>
  <div @wheel.prevent="onWheel">
    <USlider v-model="value" :min="min" :max="max" :step="step" :class="sliderClass" />
  </div>
</template>
