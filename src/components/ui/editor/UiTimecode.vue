<script setup lang="ts">
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useBlurOnPointerDownOutside } from '~/composables/useBlurOnPointerDownOutside';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';

import { formatTimecode, parseTimecodeToTicks, TICKS_PER_SECOND } from '~/utils/time';

const props = withDefaults(
  defineProps<{
    modelValue: number; // Time in canonical timeline ticks
    allowNegative?: boolean;
    wheelWithoutFocus?: boolean;
    /** Lower bound in ticks. Defaults to 0 when allowNegative is false. */
    min?: number;
    /** Upper bound in ticks. Infinity/undefined = no limit. */
    max?: number;
  }>(),
  {
    allowNegative: false,
    wheelWithoutFocus: false,
    min: undefined,
    max: undefined,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const fps = computed(() => timelineStore.timelineFormat.fps || 30);

const isFocused = ref(false);
const localValue = ref('');
const wrapperRef = ref<HTMLElement | null>(null);
useBlurOnPointerDownOutside(wrapperRef);

let lastCommittedValue = props.modelValue;

// Effective bounds. When allowNegative is false the lower bound is at least 0
// (unless an explicit, finite min is provided). max is only applied when finite.
const effectiveMin = computed(() => {
  if (Number.isFinite(props.min)) return props.min as number;
  return props.allowNegative ? Number.NEGATIVE_INFINITY : 0;
});
const effectiveMax = computed(() =>
  Number.isFinite(props.max) ? (props.max as number) : Number.POSITIVE_INFINITY,
);

// Clamp a tick value into [effectiveMin, effectiveMax].
function clampValue(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.min(effectiveMax.value, Math.max(effectiveMin.value, value));
}

// Parse HH:MM:SS:FF or MM:SS:FF or SS:FF or just SS to ticks
function parseTimecode(tc: string, fpsValue: number): number {
  return parseTimecodeToTicks({ timecode: tc, fps: fpsValue }) ?? NaN;
}

watch(
  () => props.modelValue,
  (newVal) => {
    lastCommittedValue = newVal;
    if (!isFocused.value) {
      localValue.value = formatTimecode(newVal, fps.value);
    }
  },
  { immediate: true },
);

function commitValue() {
  const parsed = parseTimecode(localValue.value, fps.value);
  if (!isNaN(parsed) && (props.allowNegative || parsed >= 0)) {
    // Clamp into the allowed [min, max] window before emitting so consumers
    // never receive out-of-range values from manual entry.
    const clamped = clampValue(parsed);
    if (clamped !== lastCommittedValue) {
      emit('update:modelValue', clamped);
      lastCommittedValue = clamped;
    }
    localValue.value = formatTimecode(clamped, fps.value);
  } else {
    // Revert to valid prop value
    localValue.value = formatTimecode(props.modelValue, fps.value);
  }
}

function handleFocus() {
  isFocused.value = true;
}

function handleBlur() {
  isFocused.value = false;
  commitValue();
  // Force reset if parent didn't update prop
  if (lastCommittedValue !== props.modelValue) {
    localValue.value = formatTimecode(props.modelValue, fps.value);
    lastCommittedValue = props.modelValue;
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitValue();
    (e.target as HTMLElement).blur();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    stepValue(1, true); // Arrows always frame-by-frame
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    stepValue(-1, true); // Arrows always frame-by-frame
  }
}

function handleWheel(e: WheelEvent) {
  if (!isFocused.value && !props.wheelWithoutFocus) return;

  e.preventDefault();
  const direction = e.deltaY < 0 ? 1 : -1;
  const isShift = isLayer1Active(e, workspaceStore.userSettings);
  stepValue(direction, !isShift);
}

onMounted(() => {
  wrapperRef.value?.addEventListener('wheel', handleWheel, { passive: false });
});

onBeforeUnmount(() => {
  wrapperRef.value?.removeEventListener('wheel', handleWheel);
});

function stepValue(direction: number, isFrame: boolean) {
  const currentTicks = isFocused.value
    ? parseTimecode(localValue.value, fps.value)
    : props.modelValue;
  const validTicks = isNaN(currentTicks) ? props.modelValue : currentTicks;

  const frameTicks = TICKS_PER_SECOND / fps.value;
  const stepTicks = isFrame ? frameTicks : TICKS_PER_SECOND; // frame or 1 second

  let newTicks = validTicks + direction * stepTicks;
  newTicks = clampValue(newTicks);

  if (isFocused.value) {
    localValue.value = formatTimecode(newTicks, fps.value);
    commitValue();
  } else {
    emit('update:modelValue', newTicks);
  }
}
</script>

<template>
  <div ref="wrapperRef" class="relative flex items-center max-w-32">
    <UInput
      v-model="localValue"
      size="xs"
      class="w-full font-mono"
      :ui="{ base: 'pr-7' }"
      @focus="handleFocus"
      @blur="handleBlur"
      @keydown="handleKeydown"
    >
      <template #trailing>
        <div class="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col">
          <button
            type="button"
            class="px-1 py-0.5 hover:bg-ui-bg-muted flex items-center justify-center text-ui-text-muted hover:text-ui-text transition-colors"
            tabindex="-1"
            @click="stepValue(1, true)"
          >
            <UIcon name="i-heroicons-chevron-up" class="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            class="px-1 py-0.5 hover:bg-ui-bg-muted flex items-center justify-center text-ui-text-muted hover:text-ui-text transition-colors"
            tabindex="-1"
            @click="stepValue(-1, true)"
          >
            <UIcon name="i-heroicons-chevron-down" class="w-2.5 h-2.5" />
          </button>
        </div>
      </template>
    </UInput>
  </div>
</template>
