<script setup lang="ts">
import { computed, onMounted } from 'vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import { useExportCodecs } from '~/composables/timeline/export/core/useExportCodecs';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    originalSampleRate?: number | null;
    originalChannels?: number | null;
    allowOriginalSampleRate?: boolean;
    hideSampleRate?: boolean;
    showReverse?: boolean;
    outputFormat?: 'mp4' | 'webm' | 'mkv' | string;
  }>(),
  {
    disabled: false,
    originalSampleRate: null,
    originalChannels: null,
    allowOriginalSampleRate: false,
    hideSampleRate: false,
    showReverse: false,
    outputFormat: undefined,
  },
);

const audioBitrateKbps = defineModel<number>('audioBitrateKbps', { required: true });
const audioChannels = defineModel<number>('audioChannels', { required: true });
const audioSampleRate = defineModel<number | 'original'>('audioSampleRate', { required: true });
const audioReverse = defineModel<boolean>('audioReverse', { default: false });
const audioCodec = defineModel<'aac' | 'opus' | 'flac' | 'pcm' | 'mp3' | undefined>('audioCodec');

const { t } = useI18n();
const { audioCodecSupport, loadCodecSupport } = useExportCodecs();

onMounted(async () => {
  await loadCodecSupport();
});

const audioCodecOptions = computed(() => {
  const opts = [
    { value: 'aac', label: t('videoEditor.export.codec.aac', 'AAC') },
    { value: 'opus', label: t('videoEditor.export.codec.opus', 'Opus') },
    { value: 'flac', label: 'FLAC' },
    { value: 'pcm', label: 'PCM (WAV)' },
    { value: 'mp3', label: 'MP3' },
  ];

  const format = props.outputFormat;
  return opts.map((opt) => {
    let disabled = false;
    if (format === 'webm' && opt.value !== 'opus') {
      disabled = true;
    } else if (format === 'mp4' && (opt.value === 'flac' || opt.value === 'pcm')) {
      disabled = true;
    }
    const isSupported =
      audioCodecSupport.value[opt.value as keyof typeof audioCodecSupport.value] !== false;
    return {
      ...opt,
      disabled: disabled || !isSupported,
    };
  });
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
</script>

<template>
  <div class="space-y-4">
    <!-- Audio Codec Select -->
    <div v-if="audioCodec !== undefined" class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.audioCodec') }}
      </label>
      <UiButtonGroup
        v-model="audioCodec"
        :options="audioCodecOptions"
        :disabled="props.disabled"
      />
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

    <div :class="props.hideSampleRate && (audioCodec === 'flac' || audioCodec === 'pcm') ? 'hidden' : props.hideSampleRate || (audioCodec === 'flac' || audioCodec === 'pcm') ? 'flex flex-col gap-2' : 'grid grid-cols-2 gap-3'">
      <!-- Audio Bitrate Select -->
      <div v-if="audioCodec !== 'flac' && audioCodec !== 'pcm'" class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.audioBitrate') }}
        </label>
        <UiWheelNumberInput
          v-model="audioBitrateKbps"
          :min="0"
          :step="16"
          :disabled="props.disabled"
          :class="{ 'ring-2 ring-error ring-inset': audioBitrateKbps <= 0 }"
        />
      </div>

      <!-- Sample Rate Select -->
      <div v-if="!props.hideSampleRate" class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.audio.sampleRate') }}
        </label>
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
    <div v-if="props.showReverse" class="flex items-center justify-between">
      <label
        class="text-xs text-ui-text-muted font-medium cursor-pointer"
        @click="!props.disabled && (audioReverse = !audioReverse)"
      >
        {{ t('videoEditor.audio.reverse') }}
      </label>
      <USwitch v-model="audioReverse" :disabled="props.disabled" />
    </div>
  </div>
</template>
