<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack } from '~/timeline/types';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import DbSlider from './DbSlider.vue';
import { linearToDb, dbToLinear } from '~/utils/audio';

const props = defineProps<{
  track: TimelineTrack;
  isSelected?: boolean;
}>();

const timelineStore = useTimelineStore();
const { t } = useI18n();

const trackName = computed(() => props.track.name || props.track.id);
const isMuted = computed(() => Boolean(props.track.audioMuted));
const isSolo = computed(() => Boolean(props.track.audioSolo));

const volumeDb = computed({
  get: () => linearToDb(props.track.audioGain ?? 1),
  set: (val: number) => {
    timelineStore.updateTrackProperties(props.track.id, { audioGain: dbToLinear(val) });
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

// Renaming
const isRenaming = ref(false);
const renameValue = ref('');
const renameInput = ref<HTMLInputElement | null>(null);

function startRename() {
  renameValue.value = trackName.value;
  isRenaming.value = true;
  nextTick(() => {
    renameInput.value?.focus();
    renameInput.value?.select();
  });
}

function confirmRename() {
  const next = renameValue.value.trim();
  if (next && next !== trackName.value) {
    timelineStore.renameTrack(props.track.id, next);
  }
  isRenaming.value = false;
}

function cancelRename() {
  isRenaming.value = false;
}
</script>

<template>
  <div
    class="flex flex-col items-center w-20 bg-ui-bg-muted border rounded-lg py-2 shrink-0 h-full transition-colors"
    :class="[isSelected ? 'border-primary-500 bg-ui-bg-elevated' : 'border-ui-border']"
  >
    <!-- Pan -->
    <div class="w-full px-2 mb-2 flex flex-col items-center">
      <span class="text-[10px] text-ui-text-muted mb-1">{{
        pan === 0 ? 'C' : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`
      }}</span>
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
      <DbSlider v-model="volumeDb" :level-db="timelineStore.audioLevels?.[props.track.id]?.peakDb" />
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
        size="xs"
        :variant="isMuted ? 'solid' : 'soft'"
        :color="isMuted ? 'error' : 'neutral'"
        class="w-6 h-6 p-0 justify-center font-bold text-xs"
        @click="toggleMute"
      >
        {{ t('fastcat.audioMixer.mute') }}
      </UButton>
      <UButton
        size="xs"
        :variant="isSolo ? 'solid' : 'soft'"
        :color="isSolo ? 'primary' : 'neutral'"
        class="w-6 h-6 p-0 justify-center font-bold text-xs"
        @click="toggleSolo"
      >
        {{ t('fastcat.audioMixer.solo') }}
      </UButton>
    </div>

    <!-- Track Name -->
    <div
      class="w-full px-1 text-center bg-ui-bg-elevated py-1 mt-auto cursor-text border-t border-ui-border rounded-b-lg"
      @dblclick="startRename"
    >
      <div v-if="isRenaming" class="px-1">
        <input
          ref="renameInput"
          v-model="renameValue"
          class="w-full bg-ui-bg text-[10px] font-medium text-ui-text border border-primary-500 outline-none px-0.5"
          @keydown.enter="confirmRename"
          @keydown.esc="cancelRename"
          @blur="confirmRename"
        />
      </div>
      <div v-else class="text-[10px] font-medium text-ui-text truncate px-0.5" :title="trackName">
        {{ trackName }}
      </div>
      <div class="text-[9px] text-ui-text-muted">
        {{ t(`fastcat.audioMixer.${track.kind}`) }}
      </div>
    </div>
  </div>
</template>
