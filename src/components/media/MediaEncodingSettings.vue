<script setup lang="ts">
import { computed } from 'vue';
import type { VideoCodecOptionResolved } from '~/utils/webcodecs';

export interface FormatOption {
  value: 'mp4' | 'webm' | 'mkv';
  label: string;
}

interface Props {
  disabled?: boolean;
  hasAudio?: boolean;
  isLoadingCodecSupport?: boolean;
  audioCodecLabel?: string;
  formatOptions: readonly FormatOption[];
  videoCodecOptions: readonly VideoCodecOptionResolved[];
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  hasAudio: true,
  isLoadingCodecSupport: false,
  audioCodecLabel: 'AAC',
});

const outputFormat = defineModel<'mp4' | 'webm' | 'mkv'>('outputFormat', { required: true });
const videoCodec = defineModel<string>('videoCodec', { required: true });
const bitrateMbps = defineModel<number>('bitrateMbps', { required: true });
const excludeAudio = defineModel<boolean>('excludeAudio', { required: true });
const audioBitrateKbps = defineModel<number>('audioBitrateKbps', { required: true });

const { t } = useI18n();

const isAudioDisabled = computed(() => props.disabled || !props.hasAudio);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="text-sm font-medium text-gray-700 dark:text-gray-200">
      {{ t('videoEditor.export.encodingSettings', 'Encoding settings') }}
    </div>

    <UFormField :label="t('videoEditor.export.outputFormat', 'Output format')">
      <UiAppButtonGroup
        v-model="outputFormat"
        :options="props.formatOptions"
        :disabled="props.disabled"
      />
    </UFormField>

    <UFormField
      v-if="outputFormat === 'mp4'"
      :label="t('videoEditor.export.videoCodec', 'Video codec')"
    >
      <USelectMenu
        :model-value="
          (props.videoCodecOptions.find((o) => o.value === videoCodec) || videoCodec) as any
        "
        :items="props.videoCodecOptions"
        value-key="value"
        label-key="label"
        :disabled="props.disabled || props.isLoadingCodecSupport"
        class="w-full"
        @update:model-value="(v: any) => (videoCodec = v?.value ?? v)"
      />
    </UFormField>
    <UFormField v-else :label="t('videoEditor.export.videoCodec', 'Video codec')">
      <UInput disabled :model-value="outputFormat === 'mkv' ? 'AV1' : 'VP9'" class="w-full" />
    </UFormField>

    <UFormField
      :label="t('videoEditor.export.videoBitrate', 'Video bitrate (Mbps)')"
      :help="
        t('videoEditor.export.videoBitrateHelp', 'Higher bitrate = better quality and larger file')
      "
    >
      <UInput
        v-model.number="bitrateMbps"
        type="number"
        inputmode="decimal"
        min="0.2"
        step="0.1"
        :disabled="props.disabled"
        class="w-full"
      />
    </UFormField>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="excludeAudio" :disabled="isAudioDisabled" />
      <span class="text-sm text-gray-700 dark:text-gray-200">{{
        t('videoEditor.export.excludeAudio', 'Exclude audio')
      }}</span>
    </label>

    <UFormField
      v-if="!excludeAudio"
      :label="t('videoEditor.export.audioCodecStatic', 'Audio codec')"
      :help="
        t(
          'videoEditor.export.audioCodecStaticHelp',
          'Codec is selected automatically based on container format',
        )
      "
    >
      <UInput
        disabled
        :model-value="
          outputFormat === 'webm' || outputFormat === 'mkv' ? 'Opus' : props.audioCodecLabel
        "
        class="w-full"
      />
    </UFormField>

    <UFormField
      v-if="!excludeAudio"
      :label="t('videoEditor.export.audioBitrate', 'Audio bitrate (Kbps)')"
      :help="
        t('videoEditor.export.audioBitrateHelp', 'Higher bitrate = better quality and larger file')
      "
    >
      <UInput
        v-model.number="audioBitrateKbps"
        type="number"
        inputmode="numeric"
        min="32"
        step="16"
        :disabled="props.disabled"
        class="w-full"
      />
    </UFormField>
  </div>
</template>
