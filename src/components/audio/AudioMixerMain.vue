<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';

const timelineStore = useTimelineStore();
const { t } = useI18n();

const volume = computed({
  get: () => timelineStore.audioVolume,
  set: (val: number) => {
    timelineStore.audioVolume = val;
  },
});

const isMuted = computed(() => timelineStore.audioMuted);

function toggleMute() {
  timelineStore.audioMuted = !timelineStore.audioMuted;
}
</script>

<template>
  <div class="flex flex-col items-center w-24 bg-ui-bg-accent border border-primary/30 rounded-lg py-2 shrink-0 h-full">
    <div class="text-xs font-bold text-primary-400 mb-4 mt-2">MAIN</div>

    <!-- Volume Slider (Vertical) -->
    <div class="flex-1 w-full flex justify-center relative mb-4 min-h-25">
      <input
        type="range"
        orient="vertical"
        v-model.number="volume"
        min="0"
        max="3"
        step="0.01"
        class="vertical-slider h-full w-4"
        @dblclick="volume = 1"
      />
    </div>

    <!-- DB Value -->
    <div class="text-xs font-mono mb-2 text-ui-text cursor-default" @dblclick="volume = 1">
      {{ volume.toFixed(2) }}
    </div>

    <!-- Controls -->
    <div class="flex gap-1 mb-2">
      <UButton
        size="sm"
        :variant="isMuted ? 'solid' : 'soft'"
        :color="isMuted ? 'error' : 'primary'"
        class="w-10 h-8 justify-center font-bold"
        @click="toggleMute"
      >
        M
      </UButton>
    </div>

    <!-- Label -->
    <div class="w-full px-1 text-center py-1 mt-auto">
      <div class="text-[10px] font-bold text-ui-text uppercase">
        Master
      </div>
    </div>
  </div>
</template>

<style scoped>
.vertical-slider {
  writing-mode: bt-lr; /* IE */
  -webkit-appearance: slider-vertical; /* WebKit */
  appearance: slider-vertical;
  width: 8px;
  cursor: pointer;
  outline: none;
}
.vertical-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: var(--color-primary-500);
  border-radius: 50%;
  cursor: pointer;
}
.vertical-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  background: var(--color-primary-500);
  border-radius: 50%;
  cursor: pointer;
}
</style>
