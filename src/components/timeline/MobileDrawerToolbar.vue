<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

interface Props {
  /** Padding and other classes for the inner flex container */
  contentClass?: string;
  /** Background gradient color variant */
  variant?: 'drawer' | 'toolbar';
}

const props = withDefaults(defineProps<Props>(), {
  contentClass: 'gap-1 px-2 py-1.5',
  variant: 'drawer',
});

const scrollContainer = ref<HTMLElement | null>(null);
const showLeftShadow = ref(false);
const showRightShadow = ref(false);

function updateScrollState() {
  if (!scrollContainer.value) return;
  
  const { scrollLeft, scrollWidth, clientWidth } = scrollContainer.value;
  
  // Use a small threshold to avoid flickering
  showLeftShadow.value = scrollLeft > 4;
  showRightShadow.value = scrollLeft < scrollWidth - clientWidth - 4;
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
  <div class="relative flex-1 min-w-0 overflow-hidden">
    <!-- Left shadow -->
    <div
      class="absolute left-0 top-0 bottom-0 w-12 z-10 pointer-events-none transition-opacity duration-300"
      :class="[
        showLeftShadow ? 'opacity-100' : 'opacity-0',
        variant === 'drawer' ? 'bg-linear-to-r from-zinc-900 to-transparent' : 'bg-linear-to-r from-ui-bg-elevated to-transparent'
      ]"
    />
    
    <div
      ref="scrollContainer"
      data-vaul-no-drag
      class="overflow-x-auto no-scrollbar scroll-smooth"
      @scroll="updateScrollState"
    >
      <div class="flex items-center w-max min-w-full" :class="contentClass">
        <slot />
      </div>
    </div>

    <!-- Right shadow -->
    <div
      class="absolute right-0 top-0 bottom-0 w-12 z-10 pointer-events-none transition-opacity duration-300"
      :class="[
        showRightShadow ? 'opacity-100' : 'opacity-0',
        variant === 'drawer' ? 'bg-linear-to-l from-zinc-900 to-transparent' : 'bg-linear-to-l from-ui-bg-elevated to-transparent'
      ]"
    />
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
</style>
