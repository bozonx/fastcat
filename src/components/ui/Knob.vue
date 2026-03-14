<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

interface KnobProps {
  modelValue: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const props = withDefaults(defineProps<KnobProps>(), {
  step: 1,
  disabled: false,
  size: 'md',
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

function clampValue(value: number): number {
  return Math.min(props.max, Math.max(props.min, value));
}

const value = computed({
  get: () => clampValue(Number(props.modelValue) || 0),
  set: (nextValue: number) => {
    emit('update:modelValue', clampValue(nextValue));
  },
});

const percentage = computed(() => {
  const range = props.max - props.min;
  if (range <= 0) return 0;
  return (value.value - props.min) / range;
});

// Calculate rotation angle (from -135deg to +135deg)
const angle = computed(() => {
  return percentage.value * 270 - 135;
});

const knobRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);
let startY = 0;
let startValue = 0;

function getStepPrecision(step: number): number {
  const stepAsString = String(step);
  const dotIndex = stepAsString.indexOf('.');
  if (dotIndex === -1) return 0;
  return stepAsString.length - dotIndex - 1;
}

function onPointerDown(event: PointerEvent) {
  if (props.disabled) return;
  // Only primary button
  if (event.button !== 0 && event.pointerType === 'mouse') return;

  isDragging.value = true;
  startY = event.clientY;
  startValue = value.value;

  (event.target as Element)?.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!isDragging.value) return;

  const deltaY = startY - event.clientY; // Up is positive
  // 100 pixels = full range
  const range = props.max - props.min;
  const deltaValue = (deltaY / 100) * range;

  let nextValue = startValue + deltaValue;

  if (props.step > 0) {
    const precision = getStepPrecision(props.step);
    nextValue = Math.round(nextValue / props.step) * props.step;
    nextValue = Number(nextValue.toFixed(precision));
  }

  value.value = nextValue;
}

function onPointerUp(event: PointerEvent) {
  if (!isDragging.value) return;
  isDragging.value = false;
  (event.target as Element)?.releasePointerCapture(event.pointerId);
}

function onWheel(event: WheelEvent) {
  if (props.disabled) return;
  event.preventDefault();

  const deltaY = event.deltaY;
  const direction = deltaY < 0 ? 1 : -1;

  let nextValue = value.value + direction * props.step;
  const precision = getStepPrecision(props.step);
  nextValue = Number(nextValue.toFixed(precision));

  value.value = nextValue;
}

onMounted(() => {
  knobRef.value?.addEventListener('wheel', onWheel, { passive: false });
});

onBeforeUnmount(() => {
  knobRef.value?.removeEventListener('wheel', onWheel);
});

function onDoubleClick() {
  if (props.disabled || props.defaultValue === undefined) return;
  value.value = props.defaultValue;
}

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'w-6 h-6';
    case 'lg':
      return 'w-12 h-12';
    case 'md':
    default:
      return 'w-8 h-8';
  }
});
</script>

<template>
  <div
    ref="knobRef"
    class="relative rounded-full bg-ui-bg-muted border border-ui-border-muted shadow-inner cursor-ns-resize select-none flex items-center justify-center transition-colors"
    :class="[
      sizeClasses,
      disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary-500/50',
      isDragging ? 'border-primary-500 ring-1 ring-primary-500/20' : '',
    ]"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @dblclick="onDoubleClick"
  >
    <!-- Indicator dot/line -->
    <div class="absolute w-full h-full rounded-full" :style="{ transform: `rotate(${angle}deg)` }">
      <div
        class="absolute top-1 left-1/2 -translate-x-1/2 w-1 h-1.5 rounded-full bg-primary-400"
      ></div>
    </div>

    <!-- Inner circle for 3D effect -->
    <div class="absolute inset-1 rounded-full bg-ui-bg shadow-sm pointer-events-none"></div>
  </div>
</template>
