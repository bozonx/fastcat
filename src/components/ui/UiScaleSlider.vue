<script setup lang="ts">
import { computed, ref } from 'vue';
import { clamp } from '~/utils/math';

interface UiScaleSliderProps {
  min?: number;
  max?: number;
}

const props = withDefaults(defineProps<UiScaleSliderProps>(), {
  min: 10,
  max: 20,
});

const modelValue = defineModel<number>({ required: true });

const trackRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);

const clampedValue = computed(() => clamp(modelValue.value, props.min, props.max));

// Percentage position of the thumb along the track
const thumbPercent = computed(() => {
  const range = props.max - props.min;
  if (range === 0) return 0;
  return ((clampedValue.value - props.min) / range) * 100;
});

const ticks = computed(() => {
  const result: number[] = [];
  for (let i = props.min; i <= props.max; i++) {
    result.push(i);
  }
  return result;
});

function valueFromPointer(event: PointerEvent): number {
  if (!trackRef.value) return modelValue.value;
  const rect = trackRef.value.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const raw = props.min + ratio * (props.max - props.min);
  return Math.round(raw);
}

function onTrackPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  isDragging.value = true;
  modelValue.value = valueFromPointer(event);
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!isDragging.value) return;
  modelValue.value = valueFromPointer(event);
}

function onPointerUp(event: PointerEvent) {
  if (!isDragging.value) return;
  isDragging.value = false;
  modelValue.value = valueFromPointer(event);
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
}
</script>

<template>
  <div class="flex flex-col gap-1 w-[22rem] select-none">
    <!-- Track area — captures all pointer events -->
    <div
      ref="trackRef"
      class="relative h-10 flex items-center cursor-pointer"
      role="slider"
      :aria-valuenow="clampedValue"
      :aria-valuemin="min"
      :aria-valuemax="max"
      @pointerdown="onTrackPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="isDragging = false"
    >
      <!-- Track line -->
      <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-ui-border" />

      <!-- Filled range -->
      <div
        class="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-primary-500 pointer-events-none transition-[width] duration-75"
        :style="{ width: `${thumbPercent}%` }"
      />

      <!-- Tick marks -->
      <div
        v-for="tick in ticks"
        :key="tick"
        class="absolute flex flex-col items-center gap-0.5 -translate-x-1/2"
        :style="{ left: `${((tick - min) / (max - min)) * 100}%` }"
      >
        <!-- Tick line -->
        <div
          class="w-px transition-colors duration-75"
          :class="[
            tick <= clampedValue ? 'bg-primary-500' : 'bg-ui-border',
            tick === min || tick === max ? 'h-3' : 'h-2',
          ]"
        />
        <!-- Tick label -->
        <span
          class="text-[9px] leading-none font-mono transition-colors duration-75 mt-0.5"
          :class="[tick === clampedValue ? 'text-primary-400 font-semibold' : 'text-ui-text-muted']"
        >
          {{ tick }}
        </span>
      </div>

      <!-- Thumb — pill body with downward-pointing triangle -->
      <div
        class="absolute -translate-x-1/2 pointer-events-none"
        :class="isDragging ? 'transition-none' : 'transition-[left] duration-75'"
        :style="{ left: `${thumbPercent}%` }"
      >
        <div class="flex flex-col items-center" style="margin-top: -26px">
          <!-- Rounded pill body showing current value -->
          <div
            class="w-6 h-4 rounded bg-primary-500 shadow-md flex items-center justify-center transition-transform duration-75"
            :class="isDragging ? 'scale-110' : ''"
          >
            <span class="text-[9px] font-mono font-bold text-white leading-none">
              {{ clampedValue }}
            </span>
          </div>
          <!-- Downward-pointing triangle (sharp end pointing at the value) -->
          <div
            class="w-0 h-0 transition-transform duration-75"
            :class="isDragging ? 'scale-110' : ''"
            style="
              border-left: 5px solid transparent;
              border-right: 5px solid transparent;
              border-top: 6px solid var(--color-primary-500);
            "
          />
        </div>
      </div>
    </div>
  </div>
</template>
