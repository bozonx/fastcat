<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import DbSlider from './DbSlider.vue';
import { linearToDb, dbToLinear } from '~/utils/audio';

const timelineStore = useTimelineStore();
const { t } = useI18n();

const volumeDb = computed({
  get: () => linearToDb(timelineStore.masterGain),
  set: (val: number) => {
    timelineStore.setMasterGain(dbToLinear(val));
  },
});

const isMuted = computed(() => timelineStore.audioMuted);

function toggleMute() {
  timelineStore.audioMuted = !timelineStore.audioMuted;
}
</script>

<template>
  <div
    class="flex flex-col items-center w-24 bg-ui-bg-accent border border-primary/30 rounded-lg py-2 shrink-0 h-full"
  >
    <div class="text-xs font-bold text-primary-400 mb-4 mt-2">
      {{ t('fastcat.audioMixer.main') }}
    </div>

    <!-- Volume Slider (Vertical) -->
    <div class="flex-1 w-full flex justify-center relative mb-4 min-h-25">
      <DbSlider v-model="volumeDb" :level-db="timelineStore.audioLevels?.['master']?.peakDb" />
    </div>

    <!-- DB Value -->
    <div
      class="text-xs font-mono mb-2 text-ui-text cursor-default hover:text-primary-400 transition-colors"
      :title="t('common.actions.reset')"
      @dblclick="volumeDb = 0"
    >
      {{ volumeDb <= -59.9 ? '-∞' : volumeDb.toFixed(1) }} dB
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
        {{ t('fastcat.audioMixer.mute') }}
      </UButton>
    </div>

    <!-- Label -->
    <div class="w-full px-1 text-center py-1 mt-auto">
      <div class="text-[10px] font-bold text-ui-text uppercase">
        {{ t('fastcat.audioMixer.master') }}
      </div>
    </div>
  </div>
</template>
