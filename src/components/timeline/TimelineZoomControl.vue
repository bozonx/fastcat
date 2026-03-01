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
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-ui-bg-elevated border border-ui-border rounded-lg shadow-xl p-3 z-50 flex flex-col items-center gap-2"
        style="width: 180px"
      >
        <div class="text-xs font-mono bg-ui-bg-muted px-2 py-1 rounded select-none">
          x{{ zoomFactor }}
        </div>
        <div class="flex items-center gap-2 w-full text-ui-text-muted">
          <UIcon name="i-heroicons-magnifying-glass-minus" class="w-4 h-4 shrink-0" />
          <TimelineZoomLogSlider
            :model-value="timelineStore.timelineZoom"
            :min="0"
            :max="100"
            :step="1"
            slider-class="flex-1"
            @update:model-value="(v) => timelineStore.setTimelineZoom(v ?? 50)"
          />
          <UIcon name="i-heroicons-magnifying-glass-plus" class="w-4 h-4 shrink-0" />
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
  /* Maintain the translation for centering while scaling down */
  transform: translate(-50%, -50%) scale(0.95) !important;
}
</style>
