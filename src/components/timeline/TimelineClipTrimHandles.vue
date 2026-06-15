<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  isTransitionCreateHandleActive: boolean;
  clipWidthPx: number;
}>();

const emit = defineEmits<{
  trimStart: [event: PointerEvent];
  trimEnd: [event: PointerEvent];
}>();

const handleWidth = computed(() => {
  // Each handle takes up at most 25% of the clip width (leaving at least 50% for dragging).
  // Clamp it between 4px and 14px.
  return Math.min(14, Math.max(4, props.clipWidthPx * 0.25));
});
</script>

<template>
  <div
    class="absolute left-0 top-0 bottom-0 cursor-ew-resize bg-white/0 transition-colors group/trim flex items-center justify-start pl-0.5"
    :style="{ zIndex: 'var(--z-clip-trim)', width: `${handleWidth}px` }"
    :class="isTransitionCreateHandleActive ? '' : 'hover:bg-white/15'"
    @pointerdown="(event) => emit('trimStart', event)"
  >
    <div
      class="w-[3px] h-6 rounded-full bg-white opacity-0 group-hover/trim:opacity-75 transition-opacity duration-150"
    />
  </div>
  <div
    class="absolute right-0 top-0 bottom-0 cursor-ew-resize bg-white/0 transition-colors group/trim flex items-center justify-end pr-0.5"
    :style="{ zIndex: 'var(--z-clip-trim)', width: `${handleWidth}px` }"
    :class="isTransitionCreateHandleActive ? '' : 'hover:bg-white/15'"
    @pointerdown="(event) => emit('trimEnd', event)"
  >
    <div
      class="w-[3px] h-6 rounded-full bg-white opacity-0 group-hover/trim:opacity-75 transition-opacity duration-150"
    />
  </div>
</template>
