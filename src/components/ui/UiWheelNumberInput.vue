<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useBlurOnPointerDownOutside } from '~/composables/useBlurOnPointerDownOutside';
import { useWheelSupport } from '../../composables/useWheelSupport';
import { useWorkspaceStore } from '../../stores/workspace.store';
import { isLayer1Active } from '../../utils/hotkeys/layerUtils';

interface UiWheelNumberInputProps {
  modelValue: number;
  min?: number;
  max?: number;
  step?: number;
  wheelStepMultiplier?: number;
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
  defaultValue?: number;
  fullWidth?: boolean;
  debounceMs?: number;
}

const props = withDefaults(defineProps<UiWheelNumberInputProps>(), {
  min: undefined,
  max: undefined,
  step: 1,
  wheelStepMultiplier: 1,
  size: 'sm',
  disabled: false,
  fullWidth: false,
  defaultValue: undefined,
  debounceMs: 50,
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

const localValue = ref(props.modelValue);

watch(
  () => props.modelValue,
  (val) => {
    localValue.value = val;
  },
);

const inputValue = computed({
  get: () => localValue.value,
  set: (val: number | string) => {
    const num = Number(val);
    if (!Number.isNaN(num)) {
      localValue.value = clampValue(num);
      emit('update:modelValue', localValue.value);
    }
  },
});

let debounceTimer: number | null = null;
let pendingEmitValue: number | null = null;

function scheduleEmit(value: number) {
  pendingEmitValue = value;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    if (pendingEmitValue !== null && pendingEmitValue !== props.modelValue) {
      emit('update:modelValue', pendingEmitValue);
    }
    pendingEmitValue = null;
  }, props.debounceMs);
}

function flushDebounced() {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (pendingEmitValue !== null && pendingEmitValue !== props.modelValue) {
    emit('update:modelValue', pendingEmitValue);
  }
  pendingEmitValue = null;
}

const wrapperRef = ref<HTMLElement | null>(null);
const workspaceStore = useWorkspaceStore();

useBlurOnPointerDownOutside(wrapperRef);

useWheelSupport({
  wrapperRef,
  disabled: () => props.disabled,
  step: () => props.step,
  wheelStepMultiplier: () => props.wheelStepMultiplier,
  useWheelStepMultiplier: (e) => isLayer1Active(e, workspaceStore.userSettings),
  focusOnly: true,
  onWheelStep: (direction, wheelStep, precision) => {
    const current = Number(localValue.value);
    const safeCurrent = Number.isFinite(current) ? current : (props.min ?? 0);

    const next = safeCurrent + direction * wheelStep;
    const rounded = Number(next.toFixed(precision));
    const clamped = clampValue(rounded);

    localValue.value = clamped;
    scheduleEmit(clamped);
  },
});

function onPointerDown(e: PointerEvent) {
  if (e.button === 1 && props.defaultValue !== undefined && !props.disabled) {
    if (e.pointerType === 'mouse') {
      e.preventDefault();
    }
    flushDebounced();
    emit('update:modelValue', props.defaultValue);
  }
}

function onBlur() {
  flushDebounced();
}

onBeforeUnmount(() => {
  flushDebounced();
});
</script>

<template>
  <div
    ref="wrapperRef"
    class="relative group"
    :class="fullWidth ? 'w-full' : 'max-w-24'"
    @pointerdown.capture="onPointerDown"
    @blur="onBlur"
  >
    <UInput
      v-model="inputValue"
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
