<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
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

interface PopupPosition {
  top: number;
  left: number;
}

const isHovered = ref(false);
const triggerEl = ref<HTMLElement | null>(null);
const closeTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const popupPosition = ref<PopupPosition>({ top: 0, left: 0 });

function clearCloseTimer() {
  if (!closeTimer.value) return;
  clearTimeout(closeTimer.value);
  closeTimer.value = null;
}

function updatePopupPosition() {
  if (!triggerEl.value) return;
  const rect = triggerEl.value.getBoundingClientRect();
  popupPosition.value = {
    top: rect.top + rect.height / 2,
    left: rect.left + rect.width / 2,
  };
}

function openPopup() {
  clearCloseTimer();
  isHovered.value = true;
  nextTick(updatePopupPosition);
}

function scheduleClosePopup() {
  clearCloseTimer();
  closeTimer.value = setTimeout(() => {
    isHovered.value = false;
  }, 90);
}

function onPopupMouseEnter() {
  clearCloseTimer();
}

function onPopupMouseLeave() {
  scheduleClosePopup();
}

onMounted(() => {
  window.addEventListener('resize', updatePopupPosition);
  window.addEventListener('scroll', updatePopupPosition, true);
});

onBeforeUnmount(() => {
  clearCloseTimer();
  window.removeEventListener('resize', updatePopupPosition);
  window.removeEventListener('scroll', updatePopupPosition, true);
});
</script>

<template>
  <div
    ref="triggerEl"
    class="relative flex items-center justify-center"
    @mouseenter="openPopup"
    @mouseleave="scheduleClosePopup"
  >
    <!-- Base component -->
    <div
      class="bg-ui-bg-muted hover:bg-ui-bg-elevated transition-colors text-xs font-mono px-2 py-1 rounded cursor-pointer min-w-14 text-center select-none"
    >
      x{{ zoomFactor }}
    </div>

    <!-- Popup -->
    <Teleport to="body">
      <Transition name="zoom-panel">
        <div
          v-if="isHovered"
          class="fixed z-99999 pointer-events-auto origin-top -translate-x-1/2 -translate-y-1/2"
          :style="{ top: `${popupPosition.top}px`, left: `${popupPosition.left}px` }"
          @mouseenter="onPopupMouseEnter"
          @mouseleave="onPopupMouseLeave"
        >
          <div class="relative">
            <!-- Value badge: floats above slider panel, not counted in centering -->
            <div class="absolute bottom-full left-1/2 -translate-x-1/2 -mb-2 bg-neutral-800 dark:bg-neutral-900 text-white border border-neutral-700/50 text-xs font-mono px-2.5 py-1 rounded-md shadow-lg select-none whitespace-nowrap">
              x{{ zoomFactor }}
            </div>

            <!-- Main panel with slider -->
            <div
              class="bg-ui-bg-elevated border border-ui-border rounded-lg shadow-xl px-3 py-2 flex items-center gap-2 w-60"
            >
              <UIcon name="i-heroicons-magnifying-glass-minus" class="w-4 h-4 shrink-0 text-ui-text-muted" />
              <div class="flex-1 min-w-30">
                <TimelineZoomLogSlider
                  :model-value="timelineStore.timelineZoom"
                  :min="0"
                  :max="100"
                  :step="1"
                  slider-class="w-full"
                  @update:model-value="(v) => timelineStore.setTimelineZoom(v ?? 50)"
                />
              </div>
              <UIcon name="i-heroicons-magnifying-glass-plus" class="w-4 h-4 shrink-0 text-ui-text-muted" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
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
  transform: translateY(4px) scale(0.95);
}
</style>
