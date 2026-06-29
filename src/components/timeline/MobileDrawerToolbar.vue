<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface Props {
  /** Padding and other classes for the inner flex container */
  contentClass?: string;
  /**
   * Layout axis. `horizontal` is the portrait bottom-sheet toolbar (scrolls left
   * to right); `vertical` is the landscape side-drawer rail (scrolls top to bottom).
   */
  orientation?: 'horizontal' | 'vertical';
  /** Whether to show a fixed close button at the end of the toolbar (portrait mode only) */
  showClose?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  contentClass: 'gap-1 px-2 py-1.5',
  orientation: 'horizontal',
  showClose: false,
});

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const isVertical = computed(() => props.orientation === 'vertical');

const scrollContainer = ref<HTMLElement | null>(null);
const showStartShadow = ref(false);
const showEndShadow = ref(false);

function updateScrollState() {
  if (!scrollContainer.value) return;

  if (isVertical.value) {
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value;
    // Use a small threshold to avoid flickering
    showStartShadow.value = scrollTop > 4;
    showEndShadow.value = scrollTop < scrollHeight - clientHeight - 4;
    return;
  }

  const { scrollLeft, scrollWidth, clientWidth } = scrollContainer.value;
  showStartShadow.value = scrollLeft > 4;
  showEndShadow.value = scrollLeft < scrollWidth - clientWidth - 4;
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  updateScrollState();
  if (scrollContainer.value) {
    resizeObserver = new ResizeObserver(() => {
      updateScrollState();
    });
    resizeObserver.observe(scrollContainer.value);

    // Also observe the inner content to catch dynamic buttons
    const inner = scrollContainer.value.firstElementChild;
    if (inner) {
      resizeObserver.observe(inner);
    }
  }
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
});
</script>

<template>
  <div
    class="mobile-drawer-toolbar relative overflow-hidden flex"
    :class="
      isVertical
        ? 'h-full min-h-0 w-full mobile-drawer-toolbar--vertical flex-col'
        : 'flex-row items-center w-full h-14'
    "
  >
    <!-- Scrollable content container -->
    <div class="relative h-full" :class="isVertical ? 'w-full flex-1 min-h-0' : 'flex-1 min-w-0'">
      <!-- Start (left / top) fade shadow -->
      <div
        class="absolute z-10 pointer-events-none transition-opacity duration-300"
        :class="[
          showStartShadow ? 'opacity-100' : 'opacity-0',
          isVertical
            ? 'top-0 left-0 right-0 h-12 bg-linear-to-b from-ui-bg-elevated to-transparent'
            : 'left-0 top-0 bottom-0 w-12 bg-linear-to-r from-ui-bg-elevated to-transparent',
        ]"
      />

      <div
        ref="scrollContainer"
        class="scroll-smooth h-full"
        :class="isVertical ? 'w-full overflow-y-auto no-scrollbar' : 'overflow-x-auto no-scrollbar'"
        @scroll="updateScrollState"
      >
        <div
          class="flex h-full"
          :class="[
            isVertical
              ? 'flex-col items-stretch w-full h-max min-h-full'
              : 'items-center w-max min-w-full',
            props.contentClass,
          ]"
        >
          <slot />
        </div>
      </div>

      <!-- End (right / bottom) fade shadow -->
      <div
        class="absolute z-10 pointer-events-none transition-opacity duration-300"
        :class="[
          showEndShadow ? 'opacity-100' : 'opacity-0',
          isVertical
            ? 'bottom-0 left-0 right-0 h-12 bg-linear-to-t from-ui-bg-elevated to-transparent'
            : 'right-0 top-0 bottom-0 w-12 bg-linear-to-l from-ui-bg-elevated to-transparent',
        ]"
      />
    </div>

    <!-- Fixed Close Button (Portrait only) -->
    <div
      v-if="props.showClose && !isVertical"
      class="shrink-0 flex items-center h-full px-2 border-l border-white/5 bg-ui-bg-elevated/95 backdrop-blur-xs z-20"
    >
      <button
        class="flex items-center justify-center rounded-xl w-11 h-11 text-ui-text-muted hover:text-ui-text active:scale-95 transition-all bg-ui-bg-muted/50"
        @click="emit('close')"
      >
        <UIcon name="i-heroicons-x-mark" class="w-5 h-5 shrink-0" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* Landscape rail: buttons fill the rail width and stay square */
.mobile-drawer-toolbar--vertical :deep(.mobile-drawer-toolbar-button) {
  width: 100%;
  height: auto;
  aspect-ratio: 1 / 1;
}
</style>
