<script setup lang="ts">

interface UiWheelSliderProps {
  modelValue: number;
  min: number;
  max: number;
  step?: number;
  steps?: number[];
  /** Extra CSS class forwarded to USlider */
  sliderClass?: string;
  wheelStepMultiplier?: number;
  defaultValue?: number;
  disabled?: boolean;
  orientation?: 'horizontal' | 'vertical';
}

const props = withDefaults(defineProps<UiWheelSliderProps>(), {
  disabled: false,
  step: 1,
  sliderClass: '',
  wheelStepMultiplier: 1,
  orientation: 'horizontal',
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

function clampValue(value: number): number {
  return Math.min(props.max, Math.max(props.min, value));
}

function findNearestStep(value: number): number {
  const steps = props.steps ?? [];
  if (steps.length === 0) {
    return clampValue(value);
  }

  let nearest = steps[0] ?? props.min;
  let nearestDistance = Math.abs(value - nearest);

  for (const step of steps) {
    const distance = Math.abs(value - step);
    if (distance < nearestDistance) {
      nearest = step;
      nearestDistance = distance;
    }
  }

  return clampValue(nearest);
}

function findSteppedValue(params: { value: number; direction: 1 | -1 }): number {
  const steps = props.steps ?? [];
  if (steps.length === 0) {
    return clampValue(params.value);
  }

  if (params.direction > 0) {
    for (const step of steps) {
      if (step > params.value) {
        return clampValue(step);
      }
    }

    return clampValue(steps[steps.length - 1] ?? props.max);
  }

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step !== undefined && step < params.value) {
      return clampValue(step);
    }
  }

  return clampValue(steps[0] ?? props.min);
}

const value = computed({
  get: () => {
    const rawValue = Number(props.modelValue);
    if (!Number.isFinite(rawValue)) return props.min;
    return clampValue(rawValue);
  },
  set: (nextValue: number) => {
    const rawValue = Number(nextValue);
    if (!Number.isFinite(rawValue)) return;
    emit(
      'update:modelValue',
      props.steps?.length ? findNearestStep(rawValue) : clampValue(rawValue),
    );
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
  const safeCurrent = Number.isFinite(current) ? current : props.min;

  if (props.steps?.length) {
    emit('update:modelValue', findSteppedValue({ value: safeCurrent, direction }));
    return;
  }

  const next = safeCurrent + direction * wheelStep;
  const rounded = Number(next.toFixed(precision));
  const clamped = clampValue(rounded);
  emit('update:modelValue', clamped);
}

onMounted(() => {
  wrapperRef.value?.addEventListener('wheel', onWheel, { passive: false });
});

onBeforeUnmount(() => {
  wrapperRef.value?.removeEventListener('wheel', onWheel);
});

function resetToDefault() {
  if (props.disabled) return;
  if (props.defaultValue !== undefined) {
    value.value = props.defaultValue;
  }
}

// Double-pointer-down detection — works with mouse, touch, stylus.
// We use capture so we catch the event even if USlider stops propagation.
const lastPointerDownTime = ref(0);
const DOUBLE_CLICK_MS = 350;

function onPointerDownCapture(event: PointerEvent) {
  if (props.disabled) return;
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
    ref="wrapperRef"
    class="relative"
    :class="orientation === 'horizontal' ? 'py-3 -my-3' : 'px-3 -mx-3 h-full'"
    @pointerdown.capture="onPointerDownCapture"
    @dblclick.capture="resetToDefault"
  >
    <USlider
      v-model="value"
      :min="min"
      :max="max"
      :step="step"
      :orientation="orientation"
      :class="sliderClass"
      :disabled="disabled"
    />
  </div>
</template>
