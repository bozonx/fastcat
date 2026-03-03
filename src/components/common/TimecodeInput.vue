<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';

const props = defineProps<{
  modelValue: number; // Time in microseconds
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

const projectStore = useProjectStore();
const fps = computed(() => projectStore.projectSettings.project.fps || 30);

const isFocused = ref(false);
const localValue = ref('');

// Format microseconds to HH:MM:SS:FF
function formatTimecode(us: number, fpsValue: number): string {
  const totalFrames = Math.round((us / 1_000_000) * fpsValue);
  const ff = totalFrames % fpsValue;
  const totalSeconds = Math.floor(us / 1_000_000);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

// Parse HH:MM:SS:FF to microseconds
function parseTimecode(tc: string, fpsValue: number): number {
  const parts = tc.split(':').map(Number);
  if (parts.length === 4 && !parts.some(isNaN)) {
    const hh = parts[0] || 0;
    const mm = parts[1] || 0;
    const ss = parts[2] || 0;
    const ff = parts[3] || 0;
    const totalSeconds = hh * 3600 + mm * 60 + ss;
    const totalFrames = totalSeconds * fpsValue + ff;
    return Math.round((totalFrames / fpsValue) * 1_000_000);
  }
  return NaN;
}

watch(
  () => props.modelValue,
  (newVal) => {
    if (!isFocused.value) {
      localValue.value = formatTimecode(newVal, fps.value);
    }
  },
  { immediate: true },
);

function commitValue() {
  const parsed = parseTimecode(localValue.value, fps.value);
  if (!isNaN(parsed) && parsed >= 0) {
    emit('update:modelValue', parsed);
    localValue.value = formatTimecode(parsed, fps.value);
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
  e.preventDefault();
  const direction = e.deltaY < 0 ? 1 : -1;
  stepValue(direction, e.shiftKey);
}

function stepValue(direction: number, isFrame: boolean) {
  const currentUs = isFocused.value ? parseTimecode(localValue.value, fps.value) : props.modelValue;
  const validUs = isNaN(currentUs) ? props.modelValue : currentUs;
  
  const frameUs = 1_000_000 / fps.value;
  const stepUs = isFrame ? frameUs : 1_000_000; // frame or 1 second
  
  const newUs = Math.max(0, validUs + direction * stepUs);
  
  if (isFocused.value) {
    localValue.value = formatTimecode(newUs, fps.value);
    commitValue();
  } else {
    emit('update:modelValue', newUs);
  }
}
</script>

<template>
  <div class="relative flex items-center w-full">
    <UInput
      v-model="localValue"
      size="sm"
      class="w-full font-mono"
      @focus="handleFocus"
      @blur="handleBlur"
      @keydown="handleKeydown"
      @wheel.prevent="handleWheel"
    >
      <template #trailing>
        <div class="flex flex-col border-l border-ui-border-muted h-full">
          <button
            type="button"
            class="flex-1 px-1 hover:bg-ui-bg-muted flex items-center justify-center text-ui-text-muted hover:text-ui-text transition-colors"
            @click="stepValue(1, true)"
            tabindex="-1"
          >
            <UIcon name="i-heroicons-chevron-up" class="w-3 h-3" />
          </button>
          <button
            type="button"
            class="flex-1 px-1 hover:bg-ui-bg-muted flex items-center justify-center text-ui-text-muted hover:text-ui-text transition-colors border-t border-ui-border-muted"
            @click="stepValue(-1, true)"
            tabindex="-1"
          >
            <UIcon name="i-heroicons-chevron-down" class="w-3 h-3" />
          </button>
        </div>
      </template>
    </UInput>
  </div>
</template>
