<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import DbSlider from './DbSlider.vue';
import { linearToDb, dbToLinear } from '~/utils/audio';
import { ref } from 'vue';
import { getAudioEffectManifest } from '~/effects';
import SelectEffectModal from '~/components/common/SelectEffectModal.vue';
import MasterAudioEffectsModal from './MasterAudioEffectsModal.vue';

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

// Effects
const isEffectsModalOpen = ref(false);
const isSelectEffectModalOpen = ref(false);

const masterEffectsCount = computed(() => {
  return (timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects ?? []).length;
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
    id: `master_effect_${Date.now()}`,
    type,
    enabled: true,
    target: 'audio',
    ...(manifest.defaultValues || {}),
  };

  const currentEffects = timelineStore.timelineDoc?.metadata?.fastcat?.masterEffects ?? [];
  timelineStore.applyTimeline({
    type: 'update_master_effects',
    effects: [...currentEffects, newEffect] as any,
  });

  isSelectEffectModalOpen.value = false;
  isEffectsModalOpen.value = true;
}
</script>

<template>
  <div
    class="flex flex-col items-center w-24 bg-ui-bg-accent border border-primary/30 rounded-lg py-2 shrink-0 h-full"
  >
    <div class="text-xs font-bold text-primary-400 mb-4 mt-2">
      {{ t('fastcat.audioMixer.main') }}
    </div>

    <!-- Effects -->
    <div class="w-full px-2 mb-2 shrink-0">
      <div v-if="masterEffectsCount === 0" class="flex justify-center">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-plus-circle"
          class="w-full h-8 text-[9px] px-1 py-0 justify-center whitespace-nowrap overflow-hidden border border-primary/20 hover:border-primary/50 hover:bg-primary/5 text-primary-400/80 hover:text-primary-400 transition-all"
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
        <span class="text-[9px] font-bold uppercase truncate px-1 tracking-wider">
          {{ t('fastcat.effects.effectsCount', { count: masterEffectsCount }) }}
        </span>
      </div>
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

    <!-- Modals -->
    <SelectEffectModal
      v-model:open="isSelectEffectModalOpen"
      target="audio"
      @select="handleSelectEffect"
    />

    <MasterAudioEffectsModal
      v-model:open="isEffectsModalOpen"
    />
  </div>
</template>
