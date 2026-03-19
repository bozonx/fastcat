<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { getAudioMeterColorClass, getAudioMeterPercent, isAudioClipping } from '~/utils/audio';

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
let clipResetTimeoutId: ReturnType<typeof setTimeout> | null = null;

watch(
  () => props.levelDb,
  (val) => {
    if (isAudioClipping(val)) {
      hasClipped.value = true;

      if (clipResetTimeoutId) {
        clearTimeout(clipResetTimeoutId);
      }

      clipResetTimeoutId = setTimeout(() => {
        hasClipped.value = false;
        clipResetTimeoutId = null;
      }, 1400);
    }
  },
);

function resetClip() {
  hasClipped.value = false;

  if (clipResetTimeoutId) {
    clearTimeout(clipResetTimeoutId);
    clipResetTimeoutId = null;
  }
}

// Performance-optimized VU meter level
const levelBarRef = ref<HTMLElement | null>(null);

watch(
  () => props.levelDb,
  (db) => {
    if (!levelBarRef.value) return;
    if (db === undefined || db <= minDb) {
      levelBarRef.value.style.height = '0%';
      levelBarRef.value.className =
        'absolute bottom-0 left-0 right-0 bg-green-500 transition-all duration-75';
      return;
    }

    const percent = getAudioMeterPercent(db, minDb, maxDb);
    levelBarRef.value.style.height = `${percent}%`;
    levelBarRef.value.className = `absolute bottom-0 left-0 right-0 ${getAudioMeterColorClass(db)} transition-all duration-75`;
  },
  { immediate: true },
);

// Color logic for the volume slider itself
const fillColor = computed(() => {
  return getAudioMeterColorClass(props.modelValue);
});

const sliderRef = ref<HTMLElement | null>(null);
const activePointerId = ref<number | null>(null);

function updateFromY(clientY: number) {
  if (!sliderRef.value) return;
  const rect = sliderRef.value.getBoundingClientRect();
  const y = clientY - rect.top;
  const percent = Math.max(0, Math.min(100, 100 - (y / rect.height) * 100));
  emit('update:modelValue', percentToDb(percent));
}

function onDocPointerMove(event: PointerEvent) {
  if (activePointerId.value !== null && event.pointerId !== activePointerId.value) return;
  updateFromY(event.clientY);
}

function onDocMouseMove(event: MouseEvent) {
  if (activePointerId.value === null) return;
  updateFromY(event.clientY);
}

function clearDragListeners() {
  document.removeEventListener('pointermove', onDocPointerMove);
  document.removeEventListener('pointerup', onDocPointerUp);
  document.removeEventListener('pointercancel', onDocPointerUp);
  document.removeEventListener('mousemove', onDocMouseMove);
  document.removeEventListener('mouseup', onDocMouseUp);
}

function onDocPointerUp(event: PointerEvent) {
  if (activePointerId.value !== null && event.pointerId !== activePointerId.value) return;
  activePointerId.value = null;
  clearDragListeners();
}

function onDocMouseUp() {
  activePointerId.value = null;
  clearDragListeners();
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  activePointerId.value = event.pointerId;
  sliderRef.value?.setPointerCapture?.(event.pointerId);
  updateFromY(event.clientY);
  document.addEventListener('pointermove', onDocPointerMove);
  document.addEventListener('pointerup', onDocPointerUp);
  document.addEventListener('pointercancel', onDocPointerUp);
  document.addEventListener('mousemove', onDocMouseMove);
  document.addEventListener('mouseup', onDocMouseUp);
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
  clearDragListeners();

  if (clipResetTimeoutId) {
    clearTimeout(clipResetTimeoutId);
    clipResetTimeoutId = null;
  }
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
        class="w-2.5 h-1.5 rounded-[2px] border border-ui-border transition-colors cursor-pointer"
        :class="[hasClipped ? 'bg-red-600 shadow-[0_0_6px_rgba(220,38,38,0.75)]' : 'bg-ui-bg-dark']"
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
