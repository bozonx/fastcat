<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import DbSlider from './DbSlider.vue';
import { linearToDb, dbToLinear } from '~/utils/audio';
import { useAudioEffectCreation } from '~/composables/timeline/useAudioEffectCreation';
import SelectEffectModal from '~/components/effects/SelectEffectModal.vue';
import MasterAudioEffectsModal from './MasterAudioEffectsModal.vue';

defineProps<{
  isSelected?: boolean;
}>();

const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const { t } = useI18n();

const isAudioEffectsEnabled = computed(() => workspaceStore.inDevelopmentFeaturesEnabled);

const volumeDb = computed({
  get: () => linearToDb(timelineStore.masterGain),
  set: (val: number) => {
    timelineStore.setAudioVolume(dbToLinear(val));
  },
});

function onVolumeDragEnd() {
  timelineStore.applyTimeline({
    type: 'update_master_gain',
    gain: dbToLinear(volumeDb.value),
  });
}

const isMuted = computed(() => timelineStore.audioMuted);

function toggleMute() {
  timelineStore.audioMuted = !timelineStore.audioMuted;
}

const masterEffects = computed(
  () => timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects ?? [],
);

const masterEffectsCount = computed(() => masterEffects.value.length);

const {
  isSelectEffectModalOpen,
  isEffectsModalOpen,
  openSelectEffect,
  openEffectsEditor,
  handleSelectEffect,
} = useAudioEffectCreation({
  effectIdPrefix: 'master_effect',
  getEffects: () => masterEffects.value as import('~/timeline/types').ClipEffect[],
  applyEffects: (effects) => {
    timelineStore.applyTimeline({
      type: 'update_master_effects',
      effects,
    });
  },
});
</script>

<template>
  <div
    class="flex flex-col items-center w-24 bg-ui-bg-accent border rounded-lg py-2 shrink-0 h-full transition-colors cursor-pointer"
    :class="[isSelected ? 'border-primary-500 bg-ui-bg-elevated' : 'border-primary/30']"
  >
    <div class="text-xs font-bold text-primary-400 mb-4 mt-2">
      {{ t('fastcat.audioMixer.main') }}
    </div>

    <template v-if="isAudioEffectsEnabled">
      <!-- Effects -->
      <div class="w-full px-2 mb-2 shrink-0">
        <div v-if="masterEffectsCount === 0" class="flex justify-center">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-plus-circle"
            class="w-full h-8 text-3xs px-1 py-0 justify-center whitespace-nowrap overflow-hidden border border-primary/20 hover:border-primary/50 hover:bg-primary/5 text-primary-400/80 hover:text-primary-400 transition-all"
            @click="openSelectEffect"
          >
            {{ t('fastcat.effects.addEffect') }}
          </UButton>
        </div>
        <div
          v-else
          class="w-full h-8 bg-primary/10 hover:bg-primary/20 text-primary-400 border border-primary/40 rounded flex items-center justify-center cursor-pointer transition-all animate-in fade-in zoom-in-95 duration-200"
          @click="openEffectsEditor"
        >
          <span class="text-3xs font-bold truncate px-1 tracking-wider">
            {{ t('fastcat.effects.effectsCount', { count: masterEffectsCount }) }}
          </span>
        </div>
      </div>
    </template>

    <!-- Volume Slider (Vertical) -->
    <div class="flex-1 w-full flex justify-center relative mb-4 min-h-25">
      <DbSlider
        v-model="volumeDb"
        :level-db="timelineStore.audioLevels?.['master']?.peakDb"
        @drag-end="onVolumeDragEnd"
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
          size="sm"
          label="MUTE"
          active-color="error"
          inactive-color="primary"
          inactive-variant="soft"
          active-variant="solid"
          @click="toggleMute"
        />
      </UiTooltip>
    </div>

    <!-- Label -->
    <div class="w-full px-1 text-center py-1 mt-auto">
      <div class="text-2xs font-bold text-ui-text">
        {{ t('fastcat.audioMixer.master') }}
      </div>
    </div>

    <!-- Modals -->
    <template v-if="isAudioEffectsEnabled">
      <SelectEffectModal
        v-model:open="isSelectEffectModalOpen"
        target="audio"
        @select="handleSelectEffect"
      />

      <MasterAudioEffectsModal v-model:open="isEffectsModalOpen" />
    </template>
  </div>
</template>
