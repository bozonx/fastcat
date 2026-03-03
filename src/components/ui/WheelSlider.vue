<script setup lang="ts">
import { computed, ref } from 'vue';

interface WheelSliderProps {
  modelValue: number;
  min: number;
  max: number;
  step?: number;
  sliderClass?: string;
  wheelStepMultiplier?: number;
  defaultValue?: number;
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

function resetToDefault() {
  if (props.defaultValue !== undefined) {
    value.value = props.defaultValue;
  }
}

// Track double pointer-down for both mouse and touch/stylus
const lastPointerDownTime = ref(0);
const DOUBLE_CLICK_THRESHOLD_MS = 350;

function onPointerDown(event: PointerEvent) {
  const now = Date.now();
  if (now - lastPointerDownTime.value < DOUBLE_CLICK_THRESHOLD_MS) {
    resetToDefault();
    lastPointerDownTime.value = 0;
  } else {
    lastPointerDownTime.value = now;
  }
}
</script>

<template>
  <div @wheel.prevent="onWheel" @dblclick="resetToDefault" @pointerdown="onPointerDown">
    <USlider
      v-model="value"
      :min="min"
      :max="max"
      :step="step"
      :class="sliderClass"
    />
  </div>
</template>
