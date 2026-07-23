<script setup lang="ts">
import { computed } from 'vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiScaleSlider from '~/components/ui/UiScaleSlider.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import { useAudioCodecOptions } from '~/composables/timeline/export/core/useAudioCodecOptions';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    originalSampleRate?: number | null;
    originalChannels?: number | null;
    allowOriginalSampleRate?: boolean;
    hideSampleRate?: boolean;
    showReverse?: boolean;
    outputFormat?: 'mp4' | 'webm' | 'mkv' | string;
    timelineSampleRate?: number | null;
  }>(),
  {
    disabled: false,
    originalSampleRate: null,
    originalChannels: null,
    allowOriginalSampleRate: false,
    hideSampleRate: false,
    showReverse: false,
    outputFormat: undefined,
    timelineSampleRate: null,
  },
);

const audioBitrateKbps = defineModel<number>('audioBitrateKbps', { required: true });
const audioChannels = defineModel<number>('audioChannels', { required: true });
const audioSampleRate = defineModel<number | 'original'>('audioSampleRate', { required: true });
const audioReverse = defineModel<boolean>('audioReverse', { default: false });
const audioCodec = defineModel<'aac' | 'opus' | 'flac' | 'pcm' | 'mp3' | undefined>('audioCodec');

const { t } = useI18n();

const audioBitrateOptions = [
  { label: '96', value: '96' },
  { label: '128', value: '128' },
  { label: '160', value: '160' },
  { label: '192', value: '192' },
  { label: '256', value: '256' },
  { label: '320', value: '320' },
];

const { audioCodecOptions } = useAudioCodecOptions({
  format: () => props.outputFormat,
  disableByFormat: true,
  relabel: true,
});

function formatSampleRateLabel(sampleRate: number | null) {
  const kilohertz = sampleRate === null ? null : sampleRate / 1000;
  const formattedKilohertz =
    kilohertz === null
      ? '—'
      : Number.isInteger(kilohertz)
        ? String(kilohertz)
        : kilohertz.toFixed(1).replace(/\.0$/, '');

  return `${t('videoEditor.audio.original')} (${formattedKilohertz} kHz)`;
}

const audioChannelsOptions = computed(() => {
  const options = [{ value: 1, label: t('videoEditor.audio.mono') }];

  const original = props.originalChannels || 2;
  if (original === 1) return options;

  if (original === 2) {
    options.push({ value: 2, label: t('videoEditor.audio.stereo') });
  } else {
    options.push({
      value: original,
      label: t('videoEditor.audio.channelsCount', { n: original }),
    });
  }

  return options;
});

const sampleRateOptions = computed(() => {
  const originalRaw = props.originalSampleRate;
  const original = originalRaw === null || originalRaw === undefined ? null : Number(originalRaw);

  return [
    ...(props.allowOriginalSampleRate
      ? [{ value: 'original' as const, label: formatSampleRateLabel(original) }]
      : []),
    { value: 44100, label: '44.1 kHz' },
    { value: 48000, label: '48 kHz' },
    { value: 96000, label: '96 kHz' },
  ];
});

const selectedSampleRate = computed({
  get: () => audioSampleRate.value,
  set: (value: unknown) => {
    if (typeof value === 'object' && value !== null && 'value' in value) {
      audioSampleRate.value = value.value as number | 'original';
      return;
    }

    audioSampleRate.value = value as number | 'original';
  },
});

const showSampleRateReset = computed(() => {
  if (props.timelineSampleRate === null || props.timelineSampleRate === undefined) return false;
  const current =
    audioSampleRate.value === 'original' ? props.originalSampleRate : audioSampleRate.value;
  if (current === null || current === undefined) {
    return audioSampleRate.value !== props.timelineSampleRate;
  }
  return Number(current) !== Number(props.timelineSampleRate);
});

function resetSampleRate() {
  if (props.timelineSampleRate !== null && props.timelineSampleRate !== undefined) {
    audioSampleRate.value = props.timelineSampleRate;
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Audio Codec Select -->
    <div v-if="audioCodec !== undefined" class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.audioCodec') }}
      </label>
      <UiButtonGroup v-model="audioCodec" :options="audioCodecOptions" :disabled="props.disabled" />
    </div>

    <!-- Audio Channels Select -->
    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.audio.channels') }}
      </label>
      <UiButtonGroup
        v-model="audioChannels"
        :options="audioChannelsOptions"
        :disabled="props.disabled"
      />
    </div>

    <div
      :class="
        props.hideSampleRate && (audioCodec === 'flac' || audioCodec === 'pcm')
          ? 'hidden'
          : props.hideSampleRate || audioCodec === 'flac' || audioCodec === 'pcm'
            ? 'flex flex-col gap-2'
            : 'grid grid-cols-2 gap-3'
      "
    >
      <!-- Audio Bitrate Select -->
      <div v-if="audioCodec !== 'flac' && audioCodec !== 'pcm'" class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.audioBitrate') }}
        </label>
        <UiScaleSlider
          :model-value="String(audioBitrateKbps)"
          :options="audioBitrateOptions"
          :disabled="props.disabled"
          unit="Kbps"
          @update:model-value="audioBitrateKbps = Number($event)"
        />
      </div>

      <!-- Sample Rate Select -->
      <div v-if="!props.hideSampleRate" class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <label class="text-xs text-ui-text-muted font-medium">
            {{ t('videoEditor.audio.sampleRate') }}
          </label>
          <button
            v-if="showSampleRateReset"
            type="button"
            class="text-[10px] text-primary-400 hover:text-primary-300 font-medium underline cursor-pointer focus:outline-none"
            @click="resetSampleRate"
          >
            {{ t('common.reset') }}
          </button>
        </div>
        <UiSelect
          v-model="selectedSampleRate"
          :items="sampleRateOptions"
          :disabled="props.disabled"
          :searchable="false"
          size="sm"
          full-width
          value-key="value"
          label-key="label"
        />
      </div>
    </div>

    <!-- Audio Reverse -->
    <div v-if="props.showReverse" class="flex items-center justify-between gap-3">
      <span class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.audio.reverse') }}
      </span>
      <USwitch v-model="audioReverse" :disabled="props.disabled" size="sm" />
    </div>
  </div>
</template>
