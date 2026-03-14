<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps<{
  modelValue: number; // dB value
  maxDb?: number; // default: +12
  minDb?: number; // default: -60
  levelDb?: number; // current audio level in dB
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

const maxDb = props.maxDb ?? 12;
const minDb = props.minDb ?? -60;

function dbToPercent(db: number): number {
  return Math.max(0, Math.min(100, ((db - minDb) / (maxDb - minDb)) * 100));
}

function percentToDb(percent: number): number {
  return minDb + (percent / 100) * (maxDb - minDb);
}

const fillPercent = computed(() => dbToPercent(props.modelValue));

// Clipping state
const hasClipped = ref(false);

watch(
  () => props.levelDb,
  (val) => {
    if (val !== undefined && val >= 0) {
      hasClipped.value = true;
    }
  },
);

function resetClip() {
  hasClipped.value = false;
}

// Performance-optimized VU meter level
const levelBarRef = ref<HTMLElement | null>(null);

watch(
  () => props.levelDb,
  (db) => {
    if (!levelBarRef.value) return;
    if (db === undefined || db <= minDb) {
      levelBarRef.value.style.height = '0%';
      return;
    }
    const percent = dbToPercent(db);
    levelBarRef.value.style.height = `${percent}%`;

    // Update color based on level
    if (db > 6) {
      levelBarRef.value.className =
        'absolute bottom-0 left-0 right-0 bg-red-500 transition-all duration-75';
    } else if (db > 0) {
      levelBarRef.value.className =
        'absolute bottom-0 left-0 right-0 bg-yellow-500 transition-all duration-75';
    } else {
      levelBarRef.value.className =
        'absolute bottom-0 left-0 right-0 bg-green-500 transition-all duration-75';
    }
  },
  { immediate: true },
);

// Color logic for the volume slider itself
const fillColor = computed(() => {
  const db = props.modelValue;
  if (db > 6) return 'bg-red-500';
  if (db > 0) return 'bg-yellow-500';
  return 'bg-green-500';
});

const sliderRef = ref<HTMLElement | null>(null);

function updateFromPointer(event: PointerEvent) {
  if (!sliderRef.value) return;
  const rect = sliderRef.value.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const percent = Math.max(0, Math.min(100, 100 - (y / rect.height) * 100));
  emit('update:modelValue', percentToDb(percent));
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
  updateFromPointer(event);
}

function onPointerMove(event: PointerEvent) {
  if (!event.buttons) return;
  updateFromPointer(event);
}

function onPointerUp(event: PointerEvent) {
  (event.currentTarget as HTMLElement | null)?.releasePointerCapture(event.pointerId);
}

function onDoubleClick() {
  emit('update:modelValue', 0); // Reset to 0 dB
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const direction = e.deltaY < 0 ? 1 : -1;
  const step = 1; // 1 dB per tick
  const nextDb = Math.min(maxDb, Math.max(minDb, props.modelValue + direction * step));
  emit('update:modelValue', nextDb);
}

const containerRef = ref<HTMLElement | null>(null);

onMounted(() => {
  containerRef.value?.addEventListener('wheel', onWheel, { passive: false });
});

onBeforeUnmount(() => {
  containerRef.value?.removeEventListener('wheel', onWheel);
});

const ticks = [12, 6, 0, -6, -12, -24, -36, -48, -60];
</script>

<template>
  <div ref="containerRef" class="flex h-full w-full justify-center py-2 select-none gap-1">
    <!-- Ticks -->
    <div class="relative h-full w-6">
      <div
        v-for="tick in ticks"
        :key="tick"
        class="absolute right-0 flex items-center justify-end w-full translate-y-[50%]"
        :style="{ bottom: `${dbToPercent(tick)}%` }"
      >
        <span
          class="text-[9px] font-mono leading-none mr-1"
          :class="{
            'text-green-500 font-bold': tick === 0,
            'text-yellow-500': tick > 0 && tick <= 6,
            'text-red-500': tick > 6,
            'text-ui-text-muted': tick < 0,
          }"
        >
          {{ tick > 0 ? '+' : '' }}{{ tick }}
        </span>
        <div
          class="w-1.5 h-px"
          :class="{
            'bg-green-500': tick === 0,
            'bg-yellow-500': tick > 0 && tick <= 6,
            'bg-red-500': tick > 6,
            'bg-ui-border': tick < 0,
          }"
        ></div>
      </div>
    </div>

    <!-- VU Meter & Clipping indicator -->
    <div class="flex flex-col gap-0.5 items-center">
      <!-- Clipping Light -->
      <div
        class="w-1.5 h-1.5 rounded-full border border-ui-border transition-colors cursor-pointer"
        :class="[hasClipped ? 'bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.8)]' : 'bg-ui-bg-dark']"
        :title="hasClipped ? 'Clipped! Click to reset' : ''"
        @click="resetClip"
      ></div>

      <div
        class="relative flex-1 w-1.5 bg-ui-bg-dark border border-ui-border rounded-sm overflow-hidden"
      >
        <div
          ref="levelBarRef"
          class="absolute bottom-0 left-0 right-0 transition-all duration-75"
        ></div>
      </div>
    </div>

    <!-- Slider track -->
    <div
      ref="sliderRef"
      class="relative w-4 h-full bg-ui-bg-muted border border-ui-border rounded-sm cursor-ns-resize"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick="onDoubleClick"
    >
      <!-- Volume Set Fill -->
      <div
        class="absolute bottom-0 left-0 right-0 transition-colors duration-200 rounded-b-sm"
        :class="[fillColor, fillPercent === 100 ? 'rounded-t-sm' : '']"
        :style="{ height: `${fillPercent}%` }"
      ></div>

      <!-- Thumb -->
      <div
        class="absolute left-1/2 -translate-x-1/2 w-6 h-3 bg-white border border-gray-300 shadow-sm rounded-sm z-20 pointer-events-none flex flex-col justify-center items-center gap-px"
        :style="{ bottom: `calc(${fillPercent}% - 6px)` }"
      >
        <div class="w-3 h-px bg-gray-400"></div>
        <div class="w-3 h-px bg-gray-400"></div>
      </div>

      <!-- 0 dB indicator line inside track -->
      <div
        class="absolute left-0 right-0 h-0.5 bg-green-500/50 z-10 pointer-events-none translate-y-[50%]"
        :style="{ bottom: `${dbToPercent(0)}%` }"
      ></div>
    </div>
  </div>
</template>
