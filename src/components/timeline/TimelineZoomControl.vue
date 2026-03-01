<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import TimelineZoomLogSlider from '~/components/ui/TimelineZoomLogSlider.vue';

const timelineStore = useTimelineStore();

const zoomFactor = computed(() => {
  const zoom = timelineStore.timelineZoom;
  const pos = Math.min(100, Math.max(0, zoom));
  const exponent = (pos - 50) / 10;
  const factor = Math.pow(2, exponent);
  return factor.toFixed(2);
});

const isHovered = ref(false);
</script>

<template>
  <div
    class="relative flex items-center justify-center"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- Base component -->
    <div
      class="bg-ui-bg-muted hover:bg-ui-bg-elevated transition-colors text-xs font-mono px-2 py-1 rounded cursor-pointer min-w-14 text-center select-none"
    >
      x{{ zoomFactor }}
    </div>

    <!-- Popup -->
    <Transition name="zoom-panel">
      <div
        v-if="isHovered"
        class="absolute top-1/2 right-0 -translate-y-1/2 z-9999 pointer-events-auto origin-right flex items-center justify-end"
      >
        <!-- Main panel with slider -->
        <div
          class="relative bg-ui-bg-elevated border border-ui-border rounded-lg shadow-xl px-3 py-2 flex items-center gap-2"
          style="width: 240px"
        >
          <!-- Top small panel with zoom value -->
          <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-neutral-800 dark:bg-neutral-900 text-white border border-neutral-700/50 text-xs font-mono px-2.5 py-1 rounded-md shadow-lg select-none whitespace-nowrap">
            x{{ zoomFactor }}
          </div>

          <UIcon name="i-heroicons-magnifying-glass-minus" class="w-4 h-4 shrink-0 text-ui-text-muted" />
          <TimelineZoomLogSlider
            :model-value="timelineStore.timelineZoom"
            :min="0"
            :max="100"
            :step="1"
            slider-class="w-full flex-1"
            @update:model-value="(v) => timelineStore.setTimelineZoom(v ?? 50)"
          />
          <UIcon name="i-heroicons-magnifying-glass-plus" class="w-4 h-4 shrink-0 text-ui-text-muted" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.zoom-panel-enter-active,
.zoom-panel-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.zoom-panel-enter-from,
.zoom-panel-leave-to {
  opacity: 0;
  transform: translateY(-50%) scale(0.95) !important;
}
</style>
