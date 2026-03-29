<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { storeToRefs } from 'pinia';

const uiStore = useUiStore();
const { monitorVolume, monitorMuted } = storeToRefs(uiStore);

const visible = ref(false);
const timer = ref<ReturnType<typeof setTimeout> | null>(null);

const volumePercent = computed(() => {
  if (monitorMuted.value) return 0;
  return Math.round(monitorVolume.value * 100);
});

const volumeIcon = computed(() => {
  if (monitorMuted.value || monitorVolume.value === 0) return 'i-heroicons-speaker-x-mark';
  if (monitorVolume.value < 0.5) return 'i-heroicons-speaker-wave'; // Small wave icon if available or just wave
  return 'i-heroicons-speaker-wave';
});

function show() {
  visible.value = true;
  if (timer.value) clearTimeout(timer.value);
  timer.value = setTimeout(() => {
    visible.value = false;
  }, 1500);
}

// Watch for volume changes to show HUD
watch([monitorVolume, monitorMuted], () => {
  show();
});

onBeforeUnmount(() => {
  if (timer.value) clearTimeout(timer.value);
});
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="opacity-0 scale-95 translate-x-4"
    enter-to-class="opacity-100 scale-100 translate-x-0"
    leave-active-class="transition duration-300 ease-in"
    leave-from-class="opacity-100 scale-100 translate-x-0"
    leave-to-class="opacity-0 scale-95 translate-x-4"
  >
    <div
      v-if="visible"
      class="absolute right-4 top-1/2 -translate-y-1/2 z-50 pointer-events-none"
    >
      <div
        class="flex flex-col items-center gap-3 bg-ui-bg-elevated/80 backdrop-blur-md border border-white/10 rounded-2xl p-3 shadow-2xl min-w-[48px]"
      >
        <div class="relative h-32 w-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            class="absolute bottom-0 left-0 right-0 bg-primary-500 transition-all duration-150 ease-out rounded-full"
            :style="{ height: `${Math.min(100, volumePercent / 2)}%` }"
          />
          <!-- If volume > 100% (max 2), show a different color or extension -->
          <div
            v-if="volumePercent > 200"
            class="absolute bottom-0 left-0 right-0 bg-orange-400 transition-all duration-150 ease-out rounded-full"
            :style="{ height: `${Math.min(100, (volumePercent - 200) / 2)}%` }"
          />
        </div>
        
        <div class="flex flex-col items-center gap-1">
          <UIcon :name="volumeIcon" class="w-5 h-5 text-ui-text" />
          <span class="text-[10px] font-mono font-bold text-ui-text-muted">
            {{ volumePercent }}%
          </span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Ensure smooth transitions for the volume bar */
.bg-primary-500 {
  filter: drop-shadow(0 0 4px rgba(var(--color-primary-500), 0.4));
}
</style>
