<script setup lang="ts">
import UiWheelNumberInput from '~/components/ui/editor/UiWheelNumberInput.vue';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    originalSampleRate?: number | null;
    originalChannels?: number | null;
    allowOriginalSampleRate?: boolean;
    hideSampleRate?: boolean;
    showReverse?: boolean;
  }>(),
  {
    disabled: false,
    originalSampleRate: null,
    originalChannels: null,
    allowOriginalSampleRate: false,
    hideSampleRate: false,
    showReverse: false,
  },
);

const audioBitrateKbps = defineModel<number>('audioBitrateKbps', { required: true });
const audioChannels = defineModel<number>('audioChannels', { required: true });
const audioSampleRate = defineModel<number>('audioSampleRate', { required: true });
const audioReverse = defineModel<boolean>('audioReverse', { default: false });

const { t } = useI18n();

const audioChannelsOptions = computed(() => {
  const options = [{ value: 1, label: t('videoEditor.audio.mono', 'Mono') }];

  const original = props.originalChannels || 2;
  if (original === 1) return options;

  if (original === 2) {
    options.push({ value: 2, label: t('videoEditor.audio.stereo', 'Stereo') });
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
  const originalLabel =
    original === null
      ? t('videoEditor.audio.original', 'Original')
      : `${t('videoEditor.audio.original', 'Original')} (${Math.round(original)})`;

  return [
    ...(props.allowOriginalSampleRate ? [{ value: 0, label: originalLabel }] : []),
    { value: 44100, label: '44.1 kHz' },
    { value: 48000, label: '48 kHz' },
    { value: 96000, label: '96 kHz' },
  ];
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.audio.channels', 'Channels') }}
      </label>
      <UiButtonGroup
        v-model="audioChannels"
        :options="audioChannelsOptions"
        :disabled="props.disabled"
      />
    </div>

    <div :class="props.hideSampleRate ? 'flex flex-col gap-2' : 'grid grid-cols-2 gap-3'">
      <div class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.audioBitrate', 'Audio bitrate (Kbps)') }}
        </label>
        <UiWheelNumberInput
          v-model="audioBitrateKbps"
          :min="0"
          :step="16"
          :disabled="props.disabled"
          :class="{ 'ring-2 ring-error ring-inset': audioBitrateKbps <= 0 }"
        />
      </div>

      <div v-if="!props.hideSampleRate" class="flex flex-col gap-2">
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
    <div v-if="props.showReverse" class="flex items-center justify-between">
      <label
        class="text-xs text-ui-text-muted font-medium cursor-pointer"
        @click="!props.disabled && (audioReverse = !audioReverse)"
      >
        {{ t('videoEditor.audio.reverse', 'Reverse audio') }}
      </label>
      <USwitch v-model="audioReverse" :disabled="props.disabled" />
    </div>
  </div>
</template>
