<script setup lang="ts">
import WheelSlider from '~/components/ui/WheelSlider.vue';

const props = defineProps<{
  canEditAudioFades: boolean;
  canEditAudioBalance: boolean;
  canEditAudioGain: boolean;
  selectedTrackKind: 'audio' | 'video' | null;
  audioGain: number;
  audioBalance: number;
  audioFadeInSec: number;
  audioFadeOutSec: number;
  audioFadeInMaxSec: number;
  audioFadeOutMaxSec: number;
}>();

const emit = defineEmits<{
  updateAudioGain: [val: number];
  updateAudioBalance: [val: number];
  updateAudioFadeInSec: [val: number];
  updateAudioFadeOutSec: [val: number];
}>();

const { t } = useI18n();
</script>

<template>
  <div
    v-if="
      props.canEditAudioFades &&
      (props.selectedTrackKind === 'audio' || props.selectedTrackKind === 'video')
    "
    class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border"
  >
    <div class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1">
      {{ t('granVideoEditor.clip.audioFade.title', 'Audio fades') }}
    </div>

    <div v-if="props.canEditAudioGain" class="space-y-1.5">
      <div class="flex items-center justify-between">
        <span class="text-xs text-ui-text-muted">{{ t('granVideoEditor.clip.audio.volume', 'Volume') }}</span>
        <span class="text-xs font-mono text-ui-text-muted">{{ props.audioGain.toFixed(3) }}x</span>
      </div>
      <WheelSlider
        :model-value="props.audioGain"
        :min="0"
        :max="2"
        :step="0.001"
        @update:model-value="(v: unknown) => emit('updateAudioGain', Number(v))"
      />
    </div>

    <div v-if="props.canEditAudioBalance" class="space-y-1.5">
      <div class="flex items-center justify-between">
        <span class="text-xs text-ui-text-muted">{{ t('granVideoEditor.clip.audio.balance', 'Balance') }}</span>
        <span class="text-xs font-mono text-ui-text-muted">{{ props.audioBalance.toFixed(2) }}</span>
      </div>
      <WheelSlider
        :model-value="props.audioBalance"
        :min="-1"
        :max="1"
        :step="0.01"
        @update:model-value="(v: unknown) => emit('updateAudioBalance', Number(v))"
      />
    </div>

    <div class="grid grid-cols-2 gap-2">
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{ t('granVideoEditor.clip.audioFade.in', 'Fade in') }}</span>
        <UInput
          :model-value="props.audioFadeInSec"
          size="sm"
          type="number"
          step="0.01"
          :min="0"
          :max="props.audioFadeInMaxSec"
          @update:model-value="(v: unknown) => emit('updateAudioFadeInSec', Number(v))"
        />
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{ t('granVideoEditor.clip.audioFade.out', 'Fade out') }}</span>
        <UInput
          :model-value="props.audioFadeOutSec"
          size="sm"
          type="number"
          step="0.01"
          :min="0"
          :max="props.audioFadeOutMaxSec"
          @update:model-value="(v: unknown) => emit('updateAudioFadeOutSec', Number(v))"
        />
      </div>
    </div>
  </div>
</template>
