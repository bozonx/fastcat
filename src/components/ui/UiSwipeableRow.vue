<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const emit = defineEmits<{
  (e: 'swipe-open'): void;
  (e: 'swipe-close'): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
const actionsRef = ref<HTMLElement | null>(null);

const isOpen = ref(false);
const translateX = ref(0);
const isDragging = ref(false);

let startX = 0;
let startY = 0;
let currentX = 0;
let maxTranslate = 0; // Actions container width (will be negative as we swipe left)
let isSwipeGesture = false;

function updateMaxTranslate() {
  if (actionsRef.value) {
    maxTranslate = -actionsRef.value.clientWidth;
  }
}

onMounted(() => {
  updateMaxTranslate();
  // We use a small delay or ResizeObserver to make sure layout is finished
  const resizeObserver = new ResizeObserver(updateMaxTranslate);
  if (actionsRef.value) {
    resizeObserver.observe(actionsRef.value);
  }

  onUnmounted(() => {
    resizeObserver.disconnect();
  });

  // Global click/touch listener to close row when tapping elsewhere
  document.addEventListener('pointerdown', handleGlobalPointerDown);
});

onUnmounted(() => {
  document.removeEventListener('pointerdown', handleGlobalPointerDown);
});

function handleGlobalPointerDown(e: PointerEvent) {
  if (!isOpen.value) return;
  // If tap is outside this component, close it
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    close();
  }
}

function onPointerDown(e: PointerEvent) {
  // Only handle primary button clicks (left mouse button or touch)
  if (e.button !== 0) return;

  startX = e.clientX;
  startY = e.clientY;
  currentX = translateX.value;
  isDragging.value = true;
  isSwipeGesture = false;
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value) return;

  const deltaX = e.clientX - startX;
  const deltaY = e.clientY - startY;

  if (!isSwipeGesture) {
    // Only capture gesture if X movement is significantly larger than Y and exceeds threshold
    if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY)) {
      isSwipeGesture = true;
      containerRef.value?.setPointerCapture(e.pointerId);
    } else if (Math.abs(deltaY) > 10) {
      // User is scrolling vertically, cancel swiping
      isDragging.value = false;
      return;
    }
  }

  if (isSwipeGesture) {
    let nextX = currentX + deltaX;

    // Constraint + elastic resistance
    if (nextX > 0) {
      // Swiping right (not supported, only add small rubber band effect)
      nextX = nextX * 0.15;
    } else if (nextX < maxTranslate) {
      // Swiping left past the action buttons (add resistance)
      nextX = maxTranslate + (nextX - maxTranslate) * 0.15;
    }

    translateX.value = nextX;
  }
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging.value) return;
  isDragging.value = false;

  if (isSwipeGesture) {
    containerRef.value?.releasePointerCapture(e.pointerId);

    // Threshold to snap open is half of actions width
    if (translateX.value < maxTranslate / 2) {
      open();
    } else {
      close();
    }
  }
}

function open() {
  isOpen.value = true;
  translateX.value = maxTranslate;
  emit('swipe-open');
}

function close() {
  isOpen.value = false;
  translateX.value = 0;
  emit('swipe-close');
}

defineExpose({
  close,
  open,
  isOpen,
});
</script>

<template>
  <div
    ref="containerRef"
    class="relative overflow-hidden w-full touch-pan-y select-none"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- Background Actions Layer -->
    <div
      ref="actionsRef"
      class="absolute right-0 top-0 bottom-0 flex h-full z-0 items-stretch transition-opacity duration-200"
      :style="{
        opacity: translateX !== 0 ? 1 : 0,
        pointerEvents: translateX !== 0 ? 'auto' : 'none',
      }"
    >
      <slot name="actions" :close="close"></slot>
    </div>

    <!-- Slidable Content Layer -->
    <div
      class="relative z-10 w-full h-full bg-ui-bg"
      :style="{
        transform: `translate3d(${translateX}px, 0, 0)`,
        transition: isDragging ? 'none' : 'transform 250ms cubic-bezier(0.16, 1, 0.3, 1)',
      }"
    >
      <slot :close="close"></slot>
    </div>
  </div>
</template>
