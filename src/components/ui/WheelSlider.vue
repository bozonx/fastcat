<script setup lang="ts">
import { computed, ref } from 'vue';

interface WheelSliderProps {
  modelValue: number;
  min: number;
  max: number;
  step?: number;
  /** Extra CSS class forwarded to USlider */
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

function onWheel(event: Event) {
  const e = event as WheelEvent;
  (e as any).preventDefault?.();

  const deltaY = Number((e as any).deltaY ?? 0);
  const deltaX = Number((e as any).deltaX ?? 0);
  const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
  if (!Number.isFinite(delta) || delta === 0) return;

  const direction = delta < 0 ? 1 : -1;
  const baseStep = props.step > 0 ? props.step : 1;
  const wheelStep = baseStep * Math.max(1, props.wheelStepMultiplier);
  const precision = getStepPrecision(baseStep);

  const current = Number(props.modelValue);
  const safeCurrent = Number.isFinite(current) ? current : props.min;
  const next = safeCurrent + direction * wheelStep;
  const rounded = Number(next.toFixed(precision));
  const clamped = Math.min(props.max, Math.max(props.min, rounded));
  emit('update:modelValue', clamped);
}

function resetToDefault() {
  if (props.defaultValue !== undefined) {
    value.value = props.defaultValue;
  }
}

// Double-pointer-down detection — works with mouse, touch, stylus.
// We use capture so we catch the event even if USlider stops propagation.
const lastPointerDownTime = ref(0);
const DOUBLE_CLICK_MS = 350;

function onPointerDownCapture(event: PointerEvent) {
  // Only primary button / primary touch
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  const now = Date.now();
  if (now - lastPointerDownTime.value < DOUBLE_CLICK_MS) {
    resetToDefault();
    lastPointerDownTime.value = 0;
  } else {
    lastPointerDownTime.value = now;
  }
}
</script>

<template>
  <!--
    Outer wrapper captures wheel on the full height so the user doesn't
    need to aim at the slim slider track.
  -->
  <div
    class="relative py-3 -my-3"
    @wheel="onWheel"
    @pointerdown.capture="onPointerDownCapture"
    @dblclick.capture="resetToDefault"
  >
    <USlider v-model="value" :min="min" :max="max" :step="step" :class="sliderClass" />
  </div>
</template>
