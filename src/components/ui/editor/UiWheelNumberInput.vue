<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

interface UiWheelNumberInputProps {
  modelValue: number;
  min?: number;
  max?: number;
  step?: number;
  wheelStepMultiplier?: number;
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
}

const props = withDefaults(defineProps<UiWheelNumberInputProps>(), {
  step: 1,
  wheelStepMultiplier: 1,
  size: 'sm',
  disabled: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

function clamp(val: number): number {
  let res = val;
  if (props.min !== undefined) res = Math.max(props.min, res);
  if (props.max !== undefined) res = Math.min(props.max, res);
  return res;
}

const value = computed({
  get: () => props.modelValue,
  set: (val: number | string) => {
    const num = Number(val);
    if (!Number.isNaN(num)) {
      emit('update:modelValue', clamp(num));
    }
  },
});

function getStepPrecision(step: number): number {
  const stepAsString = String(step);
  const dotIndex = stepAsString.indexOf('.');
  if (dotIndex === -1) return 0;
  return stepAsString.length - dotIndex - 1;
}

const wrapperRef = ref<HTMLElement | null>(null);

function onWheel(e: WheelEvent) {
  if (props.disabled) return;
  e.preventDefault();

  const deltaY = Number(e.deltaY ?? 0);
  const deltaX = Number(e.deltaX ?? 0);
  const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
  if (!Number.isFinite(delta) || delta === 0) return;

  const direction = delta < 0 ? 1 : -1;
  const baseStep = props.step > 0 ? props.step : 1;
  const wheelStep = baseStep * Math.max(1, props.wheelStepMultiplier);
  const precision = getStepPrecision(baseStep);

  const current = Number(props.modelValue);
  const safeCurrent = Number.isFinite(current) ? current : (props.min ?? 0);
  const next = safeCurrent + direction * wheelStep;
  const rounded = Number(next.toFixed(precision));
  const clamped = clamp(rounded);

  emit('update:modelValue', clamped);
}

onMounted(() => {
  wrapperRef.value?.addEventListener('wheel', onWheel, { passive: false });
});

onBeforeUnmount(() => {
  wrapperRef.value?.removeEventListener('wheel', onWheel);
});
</script>

<template>
  <div ref="wrapperRef" class="relative w-full">
    <UInput
      v-model.number="value"
      type="number"
      :min="min"
      :max="max"
      :step="step"
      :size="size"
      :disabled="disabled"
      class="w-full"
    />
  </div>
</template>
