<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { AudioClipEffect, TimelineTrack } from '~/timeline/types';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import DbSlider from './DbSlider.vue';
import { linearToDb, dbToLinear } from '~/utils/audio';
import { useAudioEffectCreation } from '~/composables/timeline/useAudioEffectCreation';
import SelectEffectModal from '~/components/effects/SelectEffectModal.vue';
import TrackAudioEffectsModal from './TrackAudioEffectsModal.vue';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';

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

// Rename
const isRenameModalOpen = ref(false);

function handleRenameTrack(name: string) {
  const trimmed = name.trim();
  if (trimmed && trimmed !== trackName.value) {
    timelineStore.renameTrack(props.track.id, trimmed);
  }
  isRenameModalOpen.value = false;
}

const audioEffects = computed(() =>
  (props.track.effects ?? []).filter((e): e is AudioClipEffect => e?.target === 'audio'),
);

const audioEffectsCount = computed(() => audioEffects.value.length);

const {
  isEffectsModalOpen,
  isSelectEffectModalOpen,
  openSelectEffect,
  openEffectsEditor,
  handleSelectEffect,
} = useAudioEffectCreation({
  effectIdPrefix: 'audio_effect',
  getEffects: () => audioEffects.value,
  applyEffects: (effects) => {
    const videoEffects = (props.track.effects ?? []).filter((e) => e?.target !== 'audio');
    timelineStore.updateTrackProperties(props.track.id, {
      effects: [...videoEffects, ...effects],
    });
  },
});
</script>

<template>
  <div
    class="flex flex-col items-center w-20 bg-ui-bg-muted border rounded-lg py-2 shrink-0 h-full transition-colors cursor-pointer"
    :class="[isSelected ? 'border-primary-500 bg-ui-bg-elevated' : 'border-ui-border']"
    @dblclick="timelineStore.selectAllClipsOnTrack(track.id)"
  >
    <!-- Pan -->
    <div class="w-full px-2 mb-2 flex flex-col items-center">
      <span class="text-2xs text-ui-text-muted mb-1">{{
        pan === 0 ? 'C' : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`
      }}</span>
      <UiWheelSlider
        v-model="pan"
        :min="-1"
        :max="1"
        :step="0.01"
        :default-value="0"
        :wheel-step-multiplier="5"
        wheel-without-focus
        class="w-full"
      />
    </div>

    <!-- Effects -->
    <div class="w-full px-1.5 mb-1.5 shrink-0">
      <div v-if="audioEffectsCount === 0" class="flex justify-center">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-plus-circle"
          class="w-full h-6 text-3xs px-1 py-0 justify-center whitespace-nowrap overflow-hidden hover:bg-primary-500/10 hover:text-primary-400 border border-transparent hover:border-primary-500/30"
          @click="openSelectEffect"
        >
          {{ t('fastcat.effects.addEffect') }}
        </UButton>
      </div>
      <div
        v-else
        class="w-full h-6 bg-primary-500/10 hover:bg-primary-500/20 text-primary-400 border border-primary-500/30 rounded flex items-center justify-center cursor-pointer transition-colors"
        @click="openEffectsEditor"
      >
        <span class="text-3xs font-bold uppercase truncate px-1">
          {{ t('fastcat.effects.effectsCount', { count: audioEffectsCount }) }}
        </span>
      </div>
    </div>

    <!-- Volume Slider (Vertical) -->
    <div class="flex-1 w-full flex justify-center relative my-2 min-h-25">
      <DbSlider
        v-model="volumeDb"
        wheel-without-focus
        :level-db="timelineStore.audioLevels?.[props.track.id]?.peakDb"
      />
    </div>

    <!-- DB Value -->
    <UiTooltip :text="t('common.actions.reset')">
      <div
        class="text-xs font-mono mb-2 text-ui-text cursor-default hover:text-primary-400 transition-colors"
        @click="volumeDb = 0"
      >
        {{ volumeDb <= -59.9 ? '-∞' : volumeDb.toFixed(1) }} dB
      </div>
    </UiTooltip>

    <!-- Controls -->
    <div class="flex gap-1 mb-2">
      <UiTooltip :text="t('fastcat.timeline.mute')">
        <UiToggleButton
          :model-value="isMuted"
          size="xs"
          label="M"
          active-color="error"
          inactive-color="neutral"
          inactive-variant="soft"
          active-variant="solid"
          :square="true"
          @click="toggleMute"
        />
      </UiTooltip>
      <UiTooltip :text="t('fastcat.timeline.solo')">
        <UiToggleButton
          :model-value="isSolo"
          size="xs"
          icon="i-heroicons-musical-note"
          active-color="primary"
          inactive-color="neutral"
          inactive-variant="soft"
          active-variant="solid"
          :square="true"
          @click="toggleSolo"
        />
      </UiTooltip>
    </div>

    <!-- Track Name -->
    <div
      class="w-full px-1 text-center py-1 mt-auto cursor-text border-t border-ui-border rounded-b-lg flex flex-col items-center overflow-hidden"
      @click="isRenameModalOpen = true"
    >
      <div class="max-w-full px-1 rounded transition-colors hover:bg-ui-bg-elevated">
        <div
          class="max-w-full text-2xs font-medium text-ui-text truncate px-0.5"
          :title="trackName"
        >
          {{ trackName }}
        </div>
      </div>
      <div class="text-3xs text-ui-text-muted">
        {{ t(`fastcat.audioMixer.${track.kind}`) }}
      </div>
    </div>

    <!-- Modals -->
    <SelectEffectModal
      v-model:open="isSelectEffectModalOpen"
      target="audio"
      @select="handleSelectEffect"
    />

    <TrackAudioEffectsModal v-model:open="isEffectsModalOpen" :track-id="track.id" />

    <UiRenameModal
      :open="isRenameModalOpen"
      :current-name="track.name || ''"
      :title="t('fastcat.timeline.renameTrack')"
      @update:open="isRenameModalOpen = $event"
      @rename="handleRenameTrack"
    />
  </div>
</template>
