<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack } from '~/timeline/types';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import DbSlider from './DbSlider.vue';

const props = defineProps<{
  track: TimelineTrack;
  isSelected?: boolean;
}>();

const timelineStore = useTimelineStore();
const { t } = useI18n();

const trackName = computed(() => props.track.name || props.track.id);
const isMuted = computed(() => Boolean(props.track.audioMuted));
const isSolo = computed(() => Boolean(props.track.audioSolo));

const volume = computed({
  get: () => {
    const gain = props.track.audioGain;
    return typeof gain === 'number' ? gain : 1;
  },
  set: (val: number) => {
    timelineStore.updateTrackProperties(props.track.id, { audioGain: val });
  },
});

const pan = computed({
  get: () => {
    const bal = props.track.audioBalance;
    return typeof bal === 'number' ? bal : 0;
  },
  set: (val: number) => {
    timelineStore.updateTrackProperties(props.track.id, { audioBalance: val });
  },
});

function toggleMute() {
  timelineStore.toggleTrackAudioMuted(props.track.id);
}

function toggleSolo() {
  timelineStore.toggleTrackAudioSolo(props.track.id);
}
</script>

<template>
  <div 
    class="flex flex-col items-center w-20 bg-ui-bg-muted border rounded-lg py-2 shrink-0 h-full transition-colors"
    :class="[
      isSelected ? 'border-primary-500 bg-ui-bg-elevated' : 'border-ui-border'
    ]"
  >
    <!-- Pan -->
    <div class="w-full px-2 mb-2 flex flex-col items-center">
      <span class="text-[10px] text-ui-text-muted mb-1">{{ pan === 0 ? 'C' : (pan < 0 ? `L${Math.round(-pan*100)}` : `R${Math.round(pan*100)}`) }}</span>
      <WheelSlider
        v-model="pan"
        :min="-1"
        :max="1"
        :step="0.01"
        :default-value="0"
        :wheel-step-multiplier="5"
        class="w-full"
      />
    </div>

    <!-- Volume Slider (Vertical) -->
    <div class="flex-1 w-full flex justify-center relative my-2 min-h-25">
      <DbSlider 
        v-model="volume"
        :level-db="timelineStore.audioLevels?.[props.track.id]?.peakDb"
      />
    </div>

    <!-- DB Value -->
    <div class="text-xs font-mono mb-2 text-ui-text cursor-default" @dblclick="volume = 1">
      {{ volume <= 0.001 ? '-∞' : (20 * Math.log10(volume)).toFixed(1) }} dB
    </div>

    <!-- Controls -->
    <div class="flex gap-1 mb-2">
      <UButton
        size="xs"
        :variant="isMuted ? 'solid' : 'soft'"
        :color="isMuted ? 'error' : 'neutral'"
        class="w-6 h-6 p-0 justify-center font-bold text-xs"
        @click="toggleMute"
      >
        M
      </UButton>
      <UButton
        size="xs"
        :variant="isSolo ? 'solid' : 'soft'"
        :color="isSolo ? 'primary' : 'neutral'"
        class="w-6 h-6 p-0 justify-center font-bold text-xs"
        @click="toggleSolo"
      >
        S
      </UButton>
    </div>

    <!-- Track Name -->
    <div class="w-full px-1 text-center bg-ui-bg-elevated py-1 mt-auto">
      <div class="text-[10px] font-medium text-ui-text truncate" :title="trackName">
        {{ trackName }}
      </div>
      <div class="text-[9px] text-ui-text-muted">
        {{ track.kind === 'video' ? 'Video' : 'Audio' }}
      </div>
    </div>
  </div>
</template>
