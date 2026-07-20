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
  overflowTail?: boolean;
}

const props = withDefaults(defineProps<UiScaleSliderProps>(), {
  min: 10,
  max: 20,
  options: undefined,
  withInput: false,
  defaultValue: undefined,
  overflowTail: undefined,
});

const modelValue = defineModel<number | string>({ required: true });

const trackRef = ref<HTMLElement | null>(null);
const innerTrackRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);

const isDiscreteMode = computed(() => !!props.options);

const hasOverflowTail = computed(() => props.overflowTail ?? props.withInput ?? false);

const scaleEndPercent = computed(() => (hasOverflowTail.value ? 88 : 100));

const clampedValue = computed(() => clamp(modelValue.value as number, props.min, props.max));

const currentIndex = computed(() => {
  if (!props.options) return 0;
  const idx = props.options.findIndex((o) => o.value === modelValue.value);
  return idx < 0 ? 0 : idx;
});

const isOverflow = computed(() => {
  const val = Number(modelValue.value);
  if (isNaN(val)) return false;

  if (isDiscreteMode.value) {
    const opts = props.options!;
    if (opts.length === 0) return false;
    const optNums = opts.map((o) => Number(o.value));
    if (optNums.every((n) => !isNaN(n))) {
      const maxOpt = optNums[optNums.length - 1]!;
      return val > maxOpt;
    }
    return false;
  }
  return val > props.max;
});

interface Tick {
  key: string | number;
  label: string;
  percent: number;
  isActive: boolean;
  isEdge: boolean;
}

const ticks = computed<Tick[]>(() => {
  const maxP = scaleEndPercent.value;
  if (isDiscreteMode.value) {
    const opts = props.options!;
    const count = opts.length;
    const val = Number(modelValue.value);
    const optNums = opts.map((o) => Number(o.value));
    const useNumericComparison = !isNaN(val) && optNums.every((n) => !isNaN(n));

    return opts.map((opt, i) => {
      let isActive = false;
      if (useNumericComparison) {
        isActive = optNums[i]! <= val;
      } else {
        isActive = i <= currentIndex.value;
      }
      return {
        key: opt.value,
        label: opt.label,
        percent: count <= 1 ? 0 : (i / (count - 1)) * maxP,
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
      percent: ((i - props.min) / (props.max - props.min)) * maxP,
      isActive: i <= clampedValue.value,
      isEdge: i === props.min || i === props.max,
    });
  }
  return result;
});

const thumbPercent = computed(() => {
  const maxP = scaleEndPercent.value;

  if (isDiscreteMode.value) {
    const opts = props.options!;
    const count = opts.length;
    if (count <= 1) return 0;

    const val = Number(modelValue.value);
    const optNums = opts.map((o) => Number(o.value));
    const allValid = !isNaN(val) && optNums.every((n) => !isNaN(n));

    if (allValid) {
      const minOpt = optNums[0]!;
      const maxOpt = optNums[count - 1]!;

      if (val <= minOpt) return 0;
      if (val > maxOpt) {
        if (!hasOverflowTail.value) return 100;
        const delta = val - maxOpt;
        const progress = clamp(delta / Math.max(1, (maxOpt - minOpt) * 0.2), 0.3, 1.0);
        return maxP + progress * (98 - maxP);
      }

      // Try exact match first
      const idx = opts.findIndex((o) => o.value === modelValue.value);
      if (idx >= 0) {
        return (idx / (count - 1)) * maxP;
      }

      // Interpolate if numeric values
      for (let i = 0; i < count - 1; i++) {
        const low = optNums[i]!;
        const high = optNums[i + 1]!;
        if (val >= low && val <= high) {
          const pLow = (i / (count - 1)) * maxP;
          const pHigh = ((i + 1) / (count - 1)) * maxP;
          const t = (val - low) / (high - low);
          return pLow + t * (pHigh - pLow);
        }
      }
    } else {
      const idx = opts.findIndex((o) => o.value === modelValue.value);
      if (idx >= 0) {
        return (idx / (count - 1)) * maxP;
      }
      return (currentIndex.value / (count - 1)) * maxP;
    }

    return (currentIndex.value / (count - 1)) * maxP;
  }

  // Numeric mode
  const val = Number(modelValue.value);
  if (!isNaN(val) && val > props.max) {
    if (!hasOverflowTail.value) return 100;
    const delta = val - props.max;
    const range = props.max - props.min;
    const progress = clamp(delta / Math.max(1, range * 0.2), 0.3, 1.0);
    return maxP + progress * (98 - maxP);
  }

  const range = props.max - props.min;
  if (range === 0) return 0;
  return ((clampedValue.value - props.min) / range) * maxP;
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
  const maxP = scaleEndPercent.value;
  const rawRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const ratio = clamp(rawRatio / (maxP / 100), 0, 1);

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
      class="relative h-10 flex items-center px-4 slider-cursor-self cursor-pointer touch-none"
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
        <!-- Main track line -->
        <div
          class="absolute top-1/2 -translate-y-1/2 h-0.5 rounded-l-full bg-ui-border"
          :style="{ left: '0%', width: `${scaleEndPercent}%` }"
        />

        <!-- Dashed Overflow Tail track line (Right extension) -->
        <div
          v-if="hasOverflowTail"
          class="absolute top-1/2 -translate-y-1/2 h-0 border-b-2 border-dashed border-ui-border"
          :style="{ left: `${scaleEndPercent}%`, width: `${100 - scaleEndPercent}%` }"
        />

        <!-- Filled range (Main solid track) -->
        <div
          class="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 rounded-l-full bg-primary-500 pointer-events-none transition-[width] duration-75"
          :style="{ width: `${Math.min(thumbPercent, scaleEndPercent)}%` }"
        />

        <!-- Filled range (Active overflow dashed tail highlight when value > max) -->
        <div
          v-if="hasOverflowTail && thumbPercent > scaleEndPercent"
          class="absolute top-1/2 -translate-y-1/2 h-0 border-b-2 border-dashed border-primary-500 pointer-events-none transition-[width] duration-75"
          :style="{
            left: `${scaleEndPercent}%`,
            width: `${thumbPercent - scaleEndPercent}%`,
          }"
        />

        <!-- Plus / Overflow end indicator at 100% -->
        <div
          v-if="hasOverflowTail"
          class="absolute flex flex-col items-center -translate-x-1/2 top-1/2 h-6"
          style="left: 100%"
        >
          <div class="w-px h-2 bg-ui-border border-dashed" />
          <span class="text-[9px] leading-none text-ui-text-muted mt-auto font-mono font-bold">+</span>
        </div>

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
            :class="[
              tick.isActive ? 'bg-primary-500' : 'bg-ui-border',
              tick.isEdge ? 'h-3' : 'h-2',
            ]"
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
              class="h-4 rounded bg-primary-500 shadow-md flex items-center justify-center transition-transform duration-75 px-1 pointer-events-auto touch-none"
              :class="[
                isDragging ? 'scale-110 cursor-grabbing' : 'cursor-grab',
                withInput ? 'w-6' : isDiscreteMode ? 'min-w-[3rem]' : 'w-6',
                isOverflow ? 'ring-2 ring-primary-400/80' : '',
              ]"
              @dblclick="resetToDefault"
            >
              <div v-if="withInput" class="flex items-center justify-center pointer-events-none">
                <template v-if="isOverflow">
                  <UIcon name="i-heroicons-chevron-right" class="w-3 h-3 text-white" />
                </template>
                <template v-else>
                  <div class="flex flex-col gap-0.5">
                    <div class="w-2.5 h-[1.5px] bg-white/70 rounded-full" />
                    <div class="w-2.5 h-[1.5px] bg-white/70 rounded-full" />
                  </div>
                </template>
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

