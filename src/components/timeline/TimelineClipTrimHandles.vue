<script setup lang="ts">
defineProps<{
  isTransitionCreateHandleActive: boolean;
}>();

const emit = defineEmits<{
  trimStart: [event: PointerEvent];
  trimEnd: [event: PointerEvent];
}>();
</script>

<template>
  <div
    class="absolute left-0 top-0 bottom-0 cursor-ew-resize bg-white/0 transition-colors group/trim flex items-center justify-start pl-0.5 w-4"
    :style="{ zIndex: 'var(--z-clip-trim)' }"
    :class="isTransitionCreateHandleActive ? '' : 'hover:bg-white/15'"
    @pointerdown="(event) => emit('trimStart', event)"
  >
    <div
      class="w-[3px] h-6 rounded-full bg-white opacity-0 group-hover/trim:opacity-75 transition-opacity duration-150"
    />
  </div>
  <div
    class="absolute right-0 top-0 bottom-0 cursor-ew-resize bg-white/0 transition-colors group/trim flex items-center justify-end pr-0.5 w-4"
    :style="{ zIndex: 'var(--z-clip-trim)' }"
    :class="isTransitionCreateHandleActive ? '' : 'hover:bg-white/15'"
    @pointerdown="(event) => emit('trimEnd', event)"
  >
    <div
      class="w-[3px] h-6 rounded-full bg-white opacity-0 group-hover/trim:opacity-75 transition-opacity duration-150"
    />
  </div>
</template>
