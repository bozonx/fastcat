<script setup lang="ts">
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import DbSlider from '~/components/audio/DbSlider.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import type { AudioFadeCurve } from '~/utils/audio/envelope';
import { linearToDb, dbToLinear } from '~/utils/audio';

const props = defineProps<{
  canEditAudioFades: boolean;
  canEditAudioBalance: boolean;
  canEditAudioGain: boolean;
  selectedTrackKind: 'audio' | 'video' | null;
  audioGain: number;
  audioBalance: number;
  audioLevelDb?: number;
  audioFadeInSec: number;
  audioFadeOutSec: number;
  audioFadeInMaxSec: number;
  audioFadeOutMaxSec: number;
  audioFadeInCurve: AudioFadeCurve;
  audioFadeOutCurve: AudioFadeCurve;
}>();

const emit = defineEmits<{
  updateAudioGain: [val: number];
  updateAudioBalance: [val: number];
  updateAudioFadeInSec: [val: number];
  updateAudioFadeOutSec: [val: number];
  updateAudioFadeInCurve: [val: AudioFadeCurve];
  updateAudioFadeOutCurve: [val: AudioFadeCurve];
}>();

const { t } = useI18n();

const audioGainDb = computed({
  get: () => linearToDb(props.audioGain),
  set: (db: number) => emit('updateAudioGain', dbToLinear(db)),
});

const fadeCurveOptions = [
  {
    label: t('fastcat.clip.audioFade.curve.linear', 'Linear'),
    value: 'linear',
  },
  {
    label: t('fastcat.clip.audioFade.curve.logarithmic', 'Logarithmic'),
    value: 'logarithmic',
  },
];
</script>

<template>
  <PropertySection
    v-if="
      props.canEditAudioFades &&
      (props.selectedTrackKind === 'audio' || props.selectedTrackKind === 'video')
    "
    :title="t('fastcat.clip.audioFade.title', 'Audio fades')"
  >
    <div v-if="props.canEditAudioGain" class="space-y-1.5">
      <div class="flex items-center justify-between">
        <span class="text-xs text-ui-text-muted">{{
          t('fastcat.clip.audio.volume', 'Volume')
        }}</span>
        <span
          class="text-xs font-mono text-ui-text-muted cursor-pointer hover:text-primary-400"
          :title="t('common.actions.reset')"
          @click="audioGainDb = 0"
        >
          {{ audioGainDb <= -59.9 ? '-∞' : audioGainDb.toFixed(1) }} dB
        </span>
      </div>
      <div class="h-32">
        <DbSlider v-model="audioGainDb" :level-db="props.audioLevelDb" />
      </div>
    </div>

    <UiSliderInput
      v-if="props.canEditAudioBalance"
      :label="t('fastcat.clip.audio.balance', 'Balance')"
      :formatted-value="props.audioBalance.toFixed(2)"
      :model-value="props.audioBalance"
      :min="-1"
      :max="1"
      :step="0.01"
      :default-value="0"
      @update:model-value="(v: number) => emit('updateAudioBalance', v)"
    />

    <div class="grid grid-cols-2 gap-2">
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{
          t('fastcat.clip.audioFade.in', 'Fade in')
        }}</span>
        <UiWheelNumberInput
          :model-value="props.audioFadeInSec"
          size="sm"
          :step="0.1"
          :wheel-step-multiplier="10"
          :min="0"
          :max="props.audioFadeInMaxSec"
          @update:model-value="(v: any) => emit('updateAudioFadeInSec', Number(v))"
        />
        <UiSelect
          :model-value="props.audioFadeInCurve"
          :items="fadeCurveOptions"
          value-key="value"
          label-key="label"
          size="xs"
          @update:model-value="
            (v: unknown) => emit('updateAudioFadeInCurve', (v as { value: string })?.value ?? v)
          "
        />
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{
          t('fastcat.clip.audioFade.out', 'Fade out')
        }}</span>
        <UiWheelNumberInput
          :model-value="props.audioFadeOutSec"
          size="sm"
          :step="0.1"
          :wheel-step-multiplier="10"
          :min="0"
          :max="props.audioFadeOutMaxSec"
          @update:model-value="(v: any) => emit('updateAudioFadeOutSec', Number(v))"
        />
        <UiSelect
          :model-value="props.audioFadeOutCurve"
          :items="fadeCurveOptions"
          value-key="value"
          label-key="label"
          size="xs"
          @update:model-value="
            (v: unknown) => emit('updateAudioFadeOutCurve', (v as { value: string })?.value ?? v)
          "
        />
      </div>
    </div>
  </PropertySection>
</template>
