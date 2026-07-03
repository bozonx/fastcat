<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  isTransitionCreateHandleActive: boolean;
  clipWidthPx: number;
  /** Vertical insets (px) so handles cover only the content band, not the header/keyframes lane. */
  topInsetPx?: number;
  bottomInsetPx?: number;
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
    data-testid="clip-trim-start"
    class="absolute left-0 cursor-ew-resize bg-white/0 transition-colors group/trim flex items-center justify-start pl-0.5 touch-none"
    :style="{
      zIndex: 'var(--z-clip-trim)',
      width: `${handleWidth}px`,
      top: `${topInsetPx ?? 0}px`,
      bottom: `${bottomInsetPx ?? 0}px`,
    }"
    :class="isTransitionCreateHandleActive ? '' : 'hover:bg-white/15'"
    @pointerdown="(event) => emit('trimStart', event)"
  >
    <div
      class="coarse-reveal w-[3px] h-6 rounded-full bg-white opacity-0 group-hover/trim:opacity-75 transition-opacity duration-150"
    />
  </div>
  <div
    data-testid="clip-trim-end"
    class="absolute right-0 cursor-ew-resize bg-white/0 transition-colors group/trim flex items-center justify-end pr-0.5 touch-none"
    :style="{
      zIndex: 'var(--z-clip-trim)',
      width: `${handleWidth}px`,
      top: `${topInsetPx ?? 0}px`,
      bottom: `${bottomInsetPx ?? 0}px`,
    }"
    :class="isTransitionCreateHandleActive ? '' : 'hover:bg-white/15'"
    @pointerdown="(event) => emit('trimEnd', event)"
  >
    <div
      class="coarse-reveal w-[3px] h-6 rounded-full bg-white opacity-0 group-hover/trim:opacity-75 transition-opacity duration-150"
    />
  </div>
</template>
