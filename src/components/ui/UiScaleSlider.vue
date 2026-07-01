<script setup lang="ts">
import { computed, ref } from 'vue';
import { clamp } from '~/utils/math';

interface ScaleSliderOption {
  label: string;
  value: string;
}

interface UiScaleSliderProps {
  min?: number;
  max?: number;
  options?: ScaleSliderOption[];
  withInput?: boolean;
  defaultValue?: number | string;
}

const props = withDefaults(defineProps<UiScaleSliderProps>(), {
  min: 10,
  max: 20,
  options: undefined,
  withInput: false,
  defaultValue: undefined,
});

const modelValue = defineModel<number | string>({ required: true });

const trackRef = ref<HTMLElement | null>(null);
const innerTrackRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);

const isDiscreteMode = computed(() => !!props.options);

const clampedValue = computed(() => clamp(modelValue.value as number, props.min, props.max));

const currentIndex = computed(() => {
  if (!props.options) return 0;
  const idx = props.options.findIndex((o) => o.value === modelValue.value);
  return idx < 0 ? 0 : idx;
});

interface Tick {
  key: string | number;
  label: string;
  percent: number;
  isActive: boolean;
  isEdge: boolean;
}

const ticks = computed<Tick[]>(() => {
  if (isDiscreteMode.value) {
    const opts = props.options!;
    const count = opts.length;
    const val = Number(modelValue.value);
    const optNums = opts.map((o) => Number(o.value));
    const useNumericComparison = !isNaN(val) && optNums.every((n) => !isNaN(n));

    return opts.map((opt, i) => {
      let isActive = false;
      if (useNumericComparison) {
        isActive = optNums[i] <= val;
      } else {
        isActive = i <= currentIndex.value;
      }
      return {
        key: opt.value,
        label: opt.label,
        percent: count <= 1 ? 0 : (i / (count - 1)) * 100,
        isActive,
        isEdge: i === 0 || i === count - 1,
      };
    });
  }
  const result: Tick[] = [];
  for (let i = props.min; i <= props.max; i++) {
    result.push({
      key: i,
      label: String(i),
      percent: ((i - props.min) / (props.max - props.min)) * 100,
      isActive: i <= clampedValue.value,
      isEdge: i === props.min || i === props.max,
    });
  }
  return result;
});

const thumbPercent = computed(() => {
  if (isDiscreteMode.value) {
    const opts = props.options!;
    const count = opts.length;
    if (count <= 1) return 0;

    // Try exact match first
    const idx = opts.findIndex((o) => o.value === modelValue.value);
    if (idx >= 0) {
      return (idx / (count - 1)) * 100;
    }

    // Interpolate if numeric values
    const val = Number(modelValue.value);
    if (!isNaN(val)) {
      const optNums = opts.map((o) => Number(o.value));
      const allValid = optNums.every((n) => !isNaN(n));
      if (allValid) {
        const minOpt = optNums[0];
        const maxOpt = optNums[count - 1];
        if (val <= minOpt) return 0;
        if (val >= maxOpt) return 100;

        for (let i = 0; i < count - 1; i++) {
          const low = optNums[i];
          const high = optNums[i + 1];
          if (val >= low && val <= high) {
            const pLow = (i / (count - 1)) * 100;
            const pHigh = ((i + 1) / (count - 1)) * 100;
            const t = (val - low) / (high - low);
            return pLow + t * (pHigh - pLow);
          }
        }
      }
    }

    return (currentIndex.value / (count - 1)) * 100;
  }
  const range = props.max - props.min;
  if (range === 0) return 0;
  return ((clampedValue.value - props.min) / range) * 100;
});

const thumbLabel = computed(() => {
  if (modelValue.value === undefined || modelValue.value === null || modelValue.value === '') {
    return '-';
  }
  if (isDiscreteMode.value) {
    const idx = props.options?.findIndex((o) => o.value === modelValue.value) ?? -1;
    if (idx >= 0) {
      return props.options?.[idx]?.label ?? '';
    }
    return String(modelValue.value);
  }
  return String(modelValue.value);
});

function valueFromPointer(event: PointerEvent): number | string {
  if (!innerTrackRef.value) return modelValue.value;
  const rect = innerTrackRef.value.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  if (isDiscreteMode.value) {
    const count = props.options!.length;
    const idx = Math.round(ratio * (count - 1));
    return props.options![idx]!.value;
  }
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

function resetToDefault() {
  if (props.defaultValue !== undefined) {
    modelValue.value = props.defaultValue;
  }
}
</script>

<template>
  <div class="flex flex-col gap-1 w-[22rem] select-none">
    <!-- Track area — captures all pointer events -->
    <div
      ref="trackRef"
      class="relative h-10 flex items-center px-4 slider-cursor-self"
      role="slider"
      :aria-valuenow="isDiscreteMode ? currentIndex + 1 : clampedValue"
      :aria-valuemin="isDiscreteMode ? 1 : min"
      :aria-valuemax="isDiscreteMode ? (options?.length ?? 1) : max"
      :aria-valuetext="thumbLabel"
      @pointerdown="onTrackPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="isDragging = false"
    >
      <!-- Inner track wrapper to prevent clipping of the thumb and ticks at the edges -->
      <div ref="innerTrackRef" class="relative w-full h-full flex items-center">
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
          :key="tick.key"
          class="absolute flex flex-col items-center -translate-x-1/2 top-1/2 h-6"
          :style="{ left: `${tick.percent}%` }"
        >
          <!-- Tick line -->
          <div
            class="w-px transition-colors duration-75"
            :class="[tick.isActive ? 'bg-primary-500' : 'bg-ui-border', tick.isEdge ? 'h-3' : 'h-2']"
          />
          <!-- Tick label -->
          <span
            class="text-[9px] leading-none transition-colors duration-75 mt-auto"
            :class="[
              isDiscreteMode ? '' : 'font-mono',
              tick.key === modelValue ? 'text-primary-400 font-semibold' : 'text-ui-text-muted',
            ]"
          >
            {{ tick.label }}
          </span>
        </div>

        <!-- Thumb — pill body with downward-pointing triangle -->
        <div
          class="absolute -translate-x-1/2 pointer-events-none"
          :class="isDragging ? 'transition-none' : 'transition-[left] duration-75'"
          :style="{ left: `${thumbPercent}%` }"
        >
          <div class="flex flex-col items-center" style="margin-top: -26px">
            <!-- Rounded pill body showing current value or drag handle bars -->
            <div
              class="h-4 rounded bg-primary-500 shadow-md flex items-center justify-center transition-transform duration-75 px-1 pointer-events-auto"
              :class="[
                isDragging ? 'scale-110 cursor-grabbing' : 'cursor-grab',
                withInput ? 'w-6' : (isDiscreteMode ? 'min-w-[3rem]' : 'w-6'),
              ]"
              @dblclick="resetToDefault"
            >
              <div v-if="withInput" class="flex flex-col gap-0.5 pointer-events-none">
                <div class="w-2.5 h-[1.5px] bg-white/70 rounded-full" />
                <div class="w-2.5 h-[1.5px] bg-white/70 rounded-full" />
              </div>
              <span v-else class="text-[9px] font-bold text-white leading-none whitespace-nowrap">
                {{ thumbLabel }}
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
  </div>
</template>
