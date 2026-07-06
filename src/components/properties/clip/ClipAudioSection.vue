<script setup lang="ts">
import { computed, ref } from 'vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
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
  updateAudioGain: [val: number, options?: { skipHistory?: boolean }];
  updateAudioBalance: [val: number];
  updateAudioFadeInSec: [val: number];
  updateAudioFadeOutSec: [val: number];
  updateAudioFadeInCurve: [val: AudioFadeCurve];
  updateAudioFadeOutCurve: [val: AudioFadeCurve];
  volumeDragStart: [];
  volumeDragEnd: [];
}>();

const { t } = useI18n();

const isEnabled = defineModel<boolean>('enabled', { default: true });

const audioGainDb = computed({
  get: () => linearToDb(props.audioGain),
  set: (db: number) => emit('updateAudioGain', dbToLinear(db)),
});

const isDragging = ref(false);

function onVolumeDragStart() {
  isDragging.value = true;
  emit('volumeDragStart');
}

function onVolumeDragEnd() {
  isDragging.value = false;
  emit('volumeDragEnd');
}

function onVolumeUpdate(db: number) {
  emit('updateAudioGain', dbToLinear(db), { skipHistory: isDragging.value });
}
</script>

<template>
  <PropertySection
    v-if="
      props.canEditAudioFades &&
      (props.selectedTrackKind === 'audio' || props.selectedTrackKind === 'video')
    "
    v-model:enabled="isEnabled"
    :title="t('fastcat.clip.audioFade.title')"
    has-toggle
    show-reset
    :on-reset="
      () => {
        emit('updateAudioBalance', 0);
        emit('updateAudioFadeInSec', 0);
        emit('updateAudioFadeOutSec', 0);
        emit('updateAudioGain', 1);
      }
    "
  >
    <div class="flex gap-4" :class="{ 'opacity-50 pointer-events-none': !isEnabled }">
      <!-- Left column: Balance and Fades -->
      <div class="flex-1 flex flex-col gap-4">
        <UiSliderInput
          v-if="props.canEditAudioBalance"
          :label="t('fastcat.clip.audio.balance')"
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
              t('fastcat.clip.audioFade.in')
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
              <div class="flex rounded bg-ui-bg border border-ui-border p-0.5 w-full">
                <button
                  type="button"
                  class="flex-1 flex items-center justify-center gap-1 px-1.5 py-0.5 text-[10px] rounded font-medium transition-all cursor-pointer border"
                  :class="
                    props.audioFadeInCurve === 'linear'
                      ? 'bg-ui-bg-hover text-ui-text shadow-xs border-ui-border/60'
                      : 'text-ui-text-muted hover:text-ui-text border-transparent'
                  "
                  :disabled="!isEnabled"
                  @click="emit('updateAudioFadeInCurve', 'linear')"
                >
                  <UIcon
                    name="i-heroicons-presentation-chart-line"
                    class="w-3.5 h-3.5 block shrink-0"
                  />
                  <span class="truncate">{{ t('fastcat.clip.audioFade.curve.linear') }}</span>
                </button>
                <button
                  type="button"
                  class="flex-1 flex items-center justify-center gap-1 px-1.5 py-0.5 text-[10px] rounded font-medium transition-all cursor-pointer border"
                  :class="
                    props.audioFadeInCurve === 'logarithmic'
                      ? 'bg-ui-bg-hover text-ui-text shadow-xs border-ui-border/60'
                      : 'text-ui-text-muted hover:text-ui-text border-transparent'
                  "
                  :disabled="!isEnabled"
                  @click="emit('updateAudioFadeInCurve', 'logarithmic')"
                >
                  <UIcon name="i-heroicons-variable" class="w-3.5 h-3.5 block shrink-0" />
                  <span class="truncate">{{ t('fastcat.clip.audioFade.curve.logarithmic') }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Fade Out -->
          <div class="flex flex-col gap-1">
            <span class="text-xs text-ui-text-muted font-medium">{{
              t('fastcat.clip.audioFade.out')
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
              <div class="flex rounded bg-ui-bg border border-ui-border p-0.5 w-full">
                <button
                  type="button"
                  class="flex-1 flex items-center justify-center gap-1 px-1.5 py-0.5 text-[10px] rounded font-medium transition-all cursor-pointer border"
                  :class="
                    props.audioFadeOutCurve === 'linear'
                      ? 'bg-ui-bg-hover text-ui-text shadow-xs border-ui-border/60'
                      : 'text-ui-text-muted hover:text-ui-text border-transparent'
                  "
                  :disabled="!isEnabled"
                  @click="emit('updateAudioFadeOutCurve', 'linear')"
                >
                  <UIcon
                    name="i-heroicons-presentation-chart-line"
                    class="w-3.5 h-3.5 block shrink-0"
                  />
                  <span class="truncate">{{ t('fastcat.clip.audioFade.curve.linear') }}</span>
                </button>
                <button
                  type="button"
                  class="flex-1 flex items-center justify-center gap-1 px-1.5 py-0.5 text-[10px] rounded font-medium transition-all cursor-pointer border"
                  :class="
                    props.audioFadeOutCurve === 'logarithmic'
                      ? 'bg-ui-bg-hover text-ui-text shadow-xs border-ui-border/60'
                      : 'text-ui-text-muted hover:text-ui-text border-transparent'
                  "
                  :disabled="!isEnabled"
                  @click="emit('updateAudioFadeOutCurve', 'logarithmic')"
                >
                  <UIcon name="i-heroicons-variable" class="w-3.5 h-3.5 block shrink-0" />
                  <span class="truncate">{{ t('fastcat.clip.audioFade.curve.logarithmic') }}</span>
                </button>
              </div>
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
          <span class="text-[10px] font-bold text-ui-text-muted/70 leading-tight line-clamp-1">{{
            t('fastcat.clip.audio.volume')
          }}</span>
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
          <DbSlider
            :model-value="audioGainDb"
            :level-db="props.audioLevelDb"
            :disabled="!isEnabled"
            :max-db="6.0206"
            :wheel-without-focus="true"
            @update:model-value="onVolumeUpdate"
            @drag-start="onVolumeDragStart"
            @drag-end="onVolumeDragEnd"
          />
        </div>
      </div>
    </div>
  </PropertySection>
</template>
