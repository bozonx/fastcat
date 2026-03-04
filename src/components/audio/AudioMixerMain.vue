<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import DbSlider from './DbSlider.vue';

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
      <DbSlider v-model="volume" />
    </div>

    <!-- DB Value -->
    <div class="text-xs font-mono mb-2 text-ui-text cursor-default" @dblclick="volume = 1">
      {{ volume <= 0.001 ? '-∞' : (20 * Math.log10(volume)).toFixed(1) }} dB
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
