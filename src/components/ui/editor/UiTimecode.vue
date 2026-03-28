<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: number; // Time in microseconds
    allowNegative?: boolean;
  }>(),
  {
    allowNegative: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
}>();

const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const fps = computed(() => projectStore.projectSettings.project.fps || 30);

const isFocused = ref(false);
const localValue = ref('');
const wrapperRef = ref<HTMLElement | null>(null);

let lastCommittedValue = props.modelValue;

// Format microseconds to HH:MM:SS:FF
function formatTimecode(us: number, fpsValue: number): string {
  const isNegative = us < 0;
  const absUs = Math.abs(us);
  const totalFrames = Math.round((absUs / 1_000_000) * fpsValue);
  const ff = totalFrames % fpsValue;
  const totalSeconds = Math.floor(absUs / 1_000_000);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatted = `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
  return isNegative ? `-${formatted}` : formatted;
}

// Parse HH:MM:SS:FF or MM:SS:FF or SS:FF or just SS to microseconds
function parseTimecode(tc: string, fpsValue: number): number {
  const trimmed = tc.trim();
  if (!trimmed) return NaN;

  const isNegative = trimmed.startsWith('-');
  const clean = trimmed.replace(/^-/, '');

  if (!/^[0-9:]+$/.test(clean)) return NaN;

  const parts = clean.split(':').map((p) => (p === '' ? 0 : Number(p)));

  let hh = 0;
  let mm = 0;
  let ss = 0;
  let ff = 0;

  if (parts.length === 4) {
    hh = parts[0] ?? 0;
    mm = parts[1] ?? 0;
    ss = parts[2] ?? 0;
    ff = parts[3] ?? 0;
  } else if (parts.length === 3) {
    mm = parts[0] ?? 0;
    ss = parts[1] ?? 0;
    ff = parts[2] ?? 0;
  } else if (parts.length === 2) {
    ss = parts[0] ?? 0;
    ff = parts[1] ?? 0;
  } else if (parts.length === 1) {
    ss = parts[0] ?? 0;
  } else {
    return NaN;
  }

  const totalSeconds = hh * 3600 + mm * 60 + ss;
  const totalFrames = totalSeconds * fpsValue + ff;
  const result = Math.round((totalFrames / fpsValue) * 1_000_000);
  return isNegative ? -result : result;
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
    if (parsed !== lastCommittedValue) {
      emit('update:modelValue', parsed);
      lastCommittedValue = parsed;
    }
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
  const currentUs = isFocused.value ? parseTimecode(localValue.value, fps.value) : props.modelValue;
  const validUs = isNaN(currentUs) ? props.modelValue : currentUs;

  const frameUs = 1_000_000 / fps.value;
  const stepUs = isFrame ? frameUs : 1_000_000; // frame or 1 second

  let newUs = validUs + direction * stepUs;
  if (!props.allowNegative) {
    newUs = Math.max(0, newUs);
  }

  if (isFocused.value) {
    localValue.value = formatTimecode(newUs, fps.value);
    commitValue();
  } else {
    emit('update:modelValue', newUs);
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
