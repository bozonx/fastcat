<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  modelValue: number; // linear amplitude
  maxDb?: number; // default: +12
  minDb?: number; // default: -60
  levelDb?: number; // current audio level in dB
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

const maxDb = props.maxDb ?? 12;
const minDb = props.minDb ?? -60;

// Convert linear to dB
function linearToDb(linear: number): number {
  if (linear <= 0.001) return minDb;
  return 20 * Math.log10(linear);
}

// Convert dB to linear
function dbToLinear(db: number): number {
  if (db <= minDb) return 0;
  return Math.pow(10, db / 20);
}

const currentDb = computed({
  get: () => linearToDb(props.modelValue),
  set: (db: number) => emit('update:modelValue', dbToLinear(db))
});

function dbToPercent(db: number): number {
  return Math.max(0, Math.min(100, ((db - minDb) / (maxDb - minDb)) * 100));
}

function percentToDb(percent: number): number {
  return minDb + (percent / 100) * (maxDb - minDb);
}

const fillPercent = computed(() => dbToPercent(currentDb.value));
const levelPercent = computed(() => props.levelDb !== undefined ? dbToPercent(props.levelDb) : 0);

// Color logic:
// Green: <= 0 dB
// Yellow: 0 to 6 dB
// Red: > 6 dB
const fillColor = computed(() => {
  const db = currentDb.value;
  if (db > 6) return 'bg-red-500/50';
  if (db > 0) return 'bg-yellow-500/50';
  return 'bg-green-500/50';
});

const levelColor = computed(() => {
  const db = props.levelDb ?? -60;
  if (db > 6) return 'bg-red-500';
  if (db > 0) return 'bg-yellow-500';
  return 'bg-green-500';
});

const isDragging = ref(false);
const sliderRef = ref<HTMLElement | null>(null);

function updateFromMouse(event: MouseEvent) {
  if (!sliderRef.value) return;
  const rect = sliderRef.value.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const percent = Math.max(0, Math.min(100, 100 - (y / rect.height) * 100));
  currentDb.value = percentToDb(percent);
}

function onMouseDown(event: MouseEvent) {
  isDragging.value = true;
  updateFromMouse(event);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(event: MouseEvent) {
  if (isDragging.value) {
    updateFromMouse(event);
  }
}

function onMouseUp() {
  isDragging.value = false;
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
}

function onDoubleClick() {
  currentDb.value = 0; // Reset to 0 dB
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const direction = e.deltaY < 0 ? 1 : -1;
  const step = 1; // 1 dB per tick
  currentDb.value = Math.min(maxDb, Math.max(minDb, currentDb.value + direction * step));
}

const ticks = [12, 6, 0, -6, -12, -24, -36, -48, -60];
</script>

<template>
  <div class="flex h-full w-full justify-center py-2 select-none" @wheel="onWheel">
    <!-- Ticks -->
    <div class="relative h-full w-8 mr-1">
      <div 
        v-for="tick in ticks" 
        :key="tick"
        class="absolute right-0 flex items-center justify-end w-full translate-y-[-50%]"
        :style="{ bottom: `${dbToPercent(tick)}%` }"
      >
        <span 
          class="text-[9px] font-mono leading-none mr-1"
          :class="{
            'text-green-500 font-bold': tick === 0, 
            'text-yellow-500': tick > 0 && tick <= 6, 
            'text-red-500': tick > 6,
            'text-ui-text-muted': tick < 0
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
            'bg-ui-border': tick < 0
          }"
        ></div>
      </div>
    </div>

    <!-- Slider track -->
    <div 
      ref="sliderRef"
      class="relative w-4 h-full bg-ui-bg-muted border border-ui-border rounded-full cursor-ns-resize overflow-hidden"
      @mousedown="onMouseDown"
      @dblclick="onDoubleClick"
    >
      <!-- Real-time Level Indicator -->
      <div 
        v-if="levelDb !== undefined"
        class="absolute bottom-0 left-0 right-0 transition-all duration-75"
        :class="[levelColor]"
        :style="{ height: `${levelPercent}%` }"
      ></div>

      <!-- Volume Set Fill -->
      <div 
        class="absolute bottom-0 left-0 right-0 transition-colors duration-200"
        :class="[fillColor]"
        :style="{ height: `${fillPercent}%` }"
      ></div>
      
      <!-- Thumb -->
      <div 
        class="absolute left-1/2 -translate-x-1/2 w-6 h-3 bg-white border border-gray-300 shadow-sm rounded-sm z-20 pointer-events-none"
        :style="{ bottom: `calc(${fillPercent}% - 6px)` }"
      >
        <div class="w-full h-full flex flex-col justify-center items-center gap-px">
          <div class="w-3 h-px bg-gray-400"></div>
          <div class="w-3 h-px bg-gray-400"></div>
        </div>
      </div>
      
      <!-- 0 dB indicator line inside track -->
      <div 
        class="absolute left-0 right-0 h-0.5 bg-green-500/50 z-10 pointer-events-none translate-y-[50%]"
        :style="{ bottom: `${dbToPercent(0)}%` }"
      ></div>
    </div>
  </div>
</template>
