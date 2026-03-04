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

function onVolumeWheel(event: Event) {
  const e = event as WheelEvent;
  e.preventDefault();
  const deltaY = e.deltaY;
  if (!Number.isFinite(deltaY) || deltaY === 0) return;
  const direction = deltaY < 0 ? 1 : -1;
  const step = 0.05;
  const newValue = Math.min(3, Math.max(0, volume.value + direction * step));
  volume.value = Number(newValue.toFixed(2));
}
</script>

<template>
  <div class="flex flex-col items-center w-24 bg-ui-bg-accent border border-primary/30 rounded-lg py-2 shrink-0 h-full">
    <div class="text-xs font-bold text-primary-400 mb-4 mt-2">MAIN</div>

    <!-- Volume Slider (Vertical) -->
    <div class="flex-1 w-full flex justify-center relative mb-4 min-h-25" @wheel="onVolumeWheel">
      <USlider
        v-model="volume"
        orientation="vertical"
        :min="0"
        :max="3"
        :step="0.01"
        class="h-full"
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
