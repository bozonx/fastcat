<script setup lang="ts">
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    originalSampleRate?: number | null;
    allowOriginalSampleRate?: boolean;
  }>(),
  {
    disabled: false,
    originalSampleRate: null,
    allowOriginalSampleRate: false,
  },
);

const audioBitrateKbps = defineModel<number>('audioBitrateKbps', { required: true });
const audioChannels = defineModel<'stereo' | 'mono'>('audioChannels', { required: true });
const audioSampleRate = defineModel<number>('audioSampleRate', { required: true });

const { t } = useI18n();

const audioChannelsOptions = [
  { value: 'stereo', label: t('videoEditor.audio.stereo', 'Stereo') },
  { value: 'mono', label: t('videoEditor.audio.mono', 'Mono') },
];

const sampleRateOptions = computed(() => {
  const originalRaw = props.originalSampleRate;
  const original = originalRaw === null || originalRaw === undefined ? null : Number(originalRaw);
  const originalLabel = original === null
    ? t('videoEditor.audio.original', 'Original')
    : `${t('videoEditor.audio.original', 'Original')} (${Math.round(original)})`;

  return [
    ...(props.allowOriginalSampleRate ? [{ value: 0, label: originalLabel }] : []),
    { value: 44100, label: '44.1 kHz' },
    { value: 48000, label: '48 kHz' },
  ];
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.audio.channels', 'Channels') }}
      </label>
      <UiAppButtonGroup
        v-model="audioChannels"
        :options="audioChannelsOptions"
        :disabled="props.disabled"
      />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.audioBitrate', 'Audio bitrate (Kbps)') }}
        </label>
        <WheelNumberInput
          v-model="audioBitrateKbps"
          :min="32"
          :step="16"
          :disabled="props.disabled"
        />
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.audio.sampleRate', 'Sample Rate') }}
        </label>
        <USelect
          v-model.number="audioSampleRate"
          :items="sampleRateOptions"
          :disabled="props.disabled"
          size="sm"
          class="w-full"
          value-key="value"
          label-key="label"
        />
      </div>
    </div>
  </div>
</template>
