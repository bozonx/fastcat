<script setup lang="ts">
import { computed } from 'vue';
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

const isEnabled = defineModel<boolean>('enabled', { default: true });

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
    v-model:toggle-value="isEnabled"
    :title="t('fastcat.clip.audioFade.title', 'Audio fades')"
    has-toggle
  >
    <div class="flex gap-4" :class="{ 'opacity-50 pointer-events-none': !isEnabled }">
      <!-- Left column: Balance and Fades -->
      <div class="flex-1 flex flex-col gap-4">
        <UiSliderInput
          v-if="props.canEditAudioBalance"
          :label="t('fastcat.clip.audio.balance', 'Balance')"
          :model-value="props.audioBalance"
          :min="-1"
          :max="1"
          :step="0.01"
          :default-value="0"
          :disabled="!isEnabled"
          @update:model-value="(v: number) => emit('updateAudioBalance', v)"
        />

        <div class="flex flex-col gap-3">
          <!-- Fade In -->
          <div class="flex flex-col gap-1">
            <span class="text-xs text-ui-text-muted font-medium">{{
              t('fastcat.clip.audioFade.in', 'Fade in')
            }}</span>
            <div class="flex flex-col gap-1.5">
              <UiWheelNumberInput
                :model-value="props.audioFadeInSec"
                size="sm"
                full-width
                :step="0.1"
                :wheel-step-multiplier="10"
                :min="0"
                :max="props.audioFadeInMaxSec"
                :disabled="!isEnabled"
                @update:model-value="(v: any) => emit('updateAudioFadeInSec', Number(v))"
              />
              <UiSelect
                :model-value="props.audioFadeInCurve"
                :items="fadeCurveOptions"
                value-key="value"
                label-key="label"
                size="xs"
                :disabled="!isEnabled"
                @update:model-value="
                  (v: unknown) =>
                    emit(
                      'updateAudioFadeInCurve',
                      ((v as { value: string })?.value ?? v) as AudioFadeCurve,
                    )
                "
              />
            </div>
          </div>

          <!-- Fade Out -->
          <div class="flex flex-col gap-1">
            <span class="text-xs text-ui-text-muted font-medium">{{
              t('fastcat.clip.audioFade.out', 'Fade out')
            }}</span>
            <div class="flex flex-col gap-1.5">
              <UiWheelNumberInput
                :model-value="props.audioFadeOutSec"
                size="sm"
                full-width
                :step="0.1"
                :wheel-step-multiplier="10"
                :min="0"
                :max="props.audioFadeOutMaxSec"
                :disabled="!isEnabled"
                @update:model-value="(v: any) => emit('updateAudioFadeOutSec', Number(v))"
              />
              <UiSelect
                :model-value="props.audioFadeOutCurve"
                :items="fadeCurveOptions"
                value-key="value"
                label-key="label"
                size="xs"
                :disabled="!isEnabled"
                @update:model-value="
                  (v: unknown) =>
                    emit(
                      'updateAudioFadeOutCurve',
                      ((v as { value: string })?.value ?? v) as AudioFadeCurve,
                    )
                "
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Right column: Volume -->
      <div
        v-if="props.canEditAudioGain"
        class="w-20 shrink-0 flex flex-col gap-2 border-l border-ui-border/30 pl-3"
      >
        <div class="flex flex-col items-end px-1 h-8 justify-center">
          <span
            class="text-[10px] uppercase font-bold text-ui-text-muted/70 leading-tight line-clamp-1"
            >{{ t('fastcat.clip.audio.volume', 'Volume') }}</span
          >
          <span
            class="text-xs font-mono text-ui-text-muted cursor-pointer hover:text-primary-400 tabular-nums whitespace-nowrap"
            :title="t('common.actions.reset')"
            @click="if (isEnabled) audioGainDb = 0;"
          >
            {{ audioGainDb <= -59.9 ? '-∞' : audioGainDb.toFixed(1)
            }}<span class="text-[10px] ml-0.5 opacity-50">dB</span>
          </span>
        </div>
        <div class="flex-1 min-h-[160px]">
          <DbSlider v-model="audioGainDb" :level-db="props.audioLevelDb" :disabled="!isEnabled" />
        </div>
      </div>
    </div>
  </PropertySection>
</template>
