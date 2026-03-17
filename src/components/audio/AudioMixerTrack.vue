<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack } from '~/timeline/types';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import DbSlider from './DbSlider.vue';
import { linearToDb, dbToLinear } from '~/utils/audio';
import { getAudioEffectManifest } from '~/effects';
import SelectEffectModal from '~/components/common/SelectEffectModal.vue';
import TrackAudioEffectsModal from './TrackAudioEffectsModal.vue';

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

// Effects
const isEffectsModalOpen = ref(false);
const isSelectEffectModalOpen = ref(false);

const audioEffectsCount = computed(() => {
  return (props.track.effects ?? []).filter((e) => e?.target === 'audio').length;
});

function openSelectEffect() {
  isSelectEffectModalOpen.value = true;
}

function openEffectsEditor() {
  isEffectsModalOpen.value = true;
}

function handleSelectEffect(type: string) {
  const manifest = getAudioEffectManifest(type);
  if (!manifest) return;

  const newEffect = {
    id: `audio_effect_${Date.now()}`,
    type,
    enabled: true,
    target: 'audio',
    ...(manifest.defaultValues || {}),
  };

  const currentEffects = props.track.effects ?? [];
  timelineStore.updateTrackProperties(props.track.id, {
    effects: [...currentEffects, newEffect] as any,
  });

  isSelectEffectModalOpen.value = false;
  isEffectsModalOpen.value = true;
}
</script>

<template>
  <div
    class="flex flex-col items-center w-20 bg-ui-bg-muted border rounded-lg py-2 shrink-0 h-full transition-colors cursor-pointer"
    :class="[isSelected ? 'border-primary-500 bg-ui-bg-elevated' : 'border-ui-border']"
    @dblclick="timelineStore.selectAllClipsOnTrack(track.id)"
  >
    <!-- Pan -->
    <div class="w-full px-2 mb-2 flex flex-col items-center">
      <span class="text-[10px] text-ui-text-muted mb-1">{{
        pan === 0 ? 'C' : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`
      }}</span>
      <UiWheelSlider
        v-model="pan"
        :min="-1"
        :max="1"
        :step="0.01"
        :default-value="0"
        :wheel-step-multiplier="5"
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
          class="w-full h-6 text-[8px] px-1 py-0 justify-center whitespace-nowrap overflow-hidden hover:bg-primary-500/10 hover:text-primary-400 border border-transparent hover:border-primary-500/30"
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
        <span class="text-[8px] font-bold uppercase truncate px-1">
          {{ t('fastcat.effects.effectsCount', { count: audioEffectsCount }) }}
        </span>
      </div>
    </div>

    <!-- Volume Slider (Vertical) -->
    <div class="flex-1 w-full flex justify-center relative my-2 min-h-25">
      <DbSlider
        v-model="volumeDb"
        :level-db="timelineStore.audioLevels?.[props.track.id]?.peakDb"
      />
    </div>

    <!-- DB Value -->
    <div
      class="text-xs font-mono mb-2 text-ui-text cursor-default hover:text-primary-400 transition-colors"
      :title="t('common.actions.reset')"
      @click="volumeDb = 0"
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
      class="w-full px-1 text-center py-1 mt-auto cursor-text border-t border-ui-border rounded-b-lg flex flex-col items-center overflow-hidden"
      @click="startRename"
    >
      <div
        class="max-w-full px-1 rounded transition-colors"
        :class="[isRenaming ? 'bg-primary-500/10' : 'hover:bg-ui-bg-elevated']"
      >
        <div v-if="isRenaming" class="w-full flex justify-center">
          <input
            ref="renameInput"
            v-model="renameValue"
            class="max-w-full bg-ui-bg text-[10px] font-medium text-ui-text border border-primary-500 outline-none px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis"
            :style="{ width: `${renameValue.length + 2}ch` }"
            @click.stop
            @keydown.enter.stop="confirmRename"
            @keydown.esc.stop="cancelRename"
            @blur="confirmRename"
          />
        </div>
        <div
          v-else
          class="max-w-full text-[10px] font-medium text-ui-text truncate px-0.5"
          :title="trackName"
        >
          {{ trackName }}
        </div>
      </div>
      <div class="text-[9px] text-ui-text-muted">
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
  </div>
</template>
