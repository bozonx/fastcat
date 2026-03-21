<script setup lang="ts">
import { computed, ref } from 'vue';
import { clamp } from '../../utils/math';
import { useWheelSupport } from '../../composables/useWheelSupport';

interface UiWheelNumberInputProps {
  modelValue: number;
  min?: number;
  max?: number;
  step?: number;
  wheelStepMultiplier?: number;
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
  defaultValue?: number;
}

const props = withDefaults(defineProps<UiWheelNumberInputProps>(), {
  min: undefined,
  max: undefined,
  step: 1,
  wheelStepMultiplier: 1,
  size: 'xs',
  disabled: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

function clampValue(val: number): number {
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
      emit('update:modelValue', clampValue(num));
    }
  },
});

const wrapperRef = ref<HTMLElement | null>(null);

useWheelSupport({
  wrapperRef,
  disabled: () => props.disabled,
  step: () => props.step,
  wheelStepMultiplier: () => props.wheelStepMultiplier,
  onWheelStep: (direction, wheelStep, precision) => {
    const current = Number(props.modelValue);
    const safeCurrent = Number.isFinite(current) ? current : (props.min ?? 0);

    // If step is small (e.g. 0.01), we want shift to jump significantly
    const next = safeCurrent + direction * wheelStep;
    const rounded = Number(next.toFixed(precision));
    const clamped = clampValue(rounded);

    emit('update:modelValue', clamped);
  },
});

function onAuxClick(e: MouseEvent) {
  if (e.button === 1 && props.defaultValue !== undefined && !props.disabled) {
    e.preventDefault();
    emit('update:modelValue', props.defaultValue);
  }
}
</script>

<template>
  <div ref="wrapperRef" class="relative group max-w-24" @auxclick="onAuxClick">
    <UInput
      v-model="value"
      type="number"
      :min="min"
      :max="max"
      :step="step"
      :size="size"
      :disabled="disabled"
      class="w-full"
      :ui="{
        base: 'font-mono transition-colors cursor-ns-resize',
      }"
    >
      <template v-for="(_, name) in $slots" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps" />
      </template>
    </UInput>
  </div>
</template>
