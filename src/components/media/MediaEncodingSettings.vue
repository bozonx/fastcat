<script setup lang="ts">
import { computed, watch, ref } from 'vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import FileConversionAudioSettings from '~/components/file-manager/FileConversionAudioSettings.vue';
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
  showAudioAdvanced?: boolean;
  originalAudioSampleRate?: number | null;
  allowOriginalAudioSampleRate?: boolean;
  formatOptions: readonly FormatOption[];
  videoCodecOptions: readonly VideoCodecOptionResolved[];
  showMetadata?: boolean;
  originalAudioChannels?: number | null;
  hideAudioBitrate?: boolean;
  hideAudioSampleRate?: boolean;
  showBuiltinPresets?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  hasAudio: true,
  isLoadingCodecSupport: false,
  audioCodecLabel: 'AAC',
  showAudioAdvanced: false,
  originalAudioSampleRate: null,
  allowOriginalAudioSampleRate: false,
  showMetadata: false,
  originalAudioChannels: null,
  hideAudioBitrate: false,
  hideAudioSampleRate: false,
  showBuiltinPresets: true,
});

const outputFormat = defineModel<'mp4' | 'webm' | 'mkv'>('outputFormat', { required: true });
const videoCodec = defineModel<string>('videoCodec', { required: true });
const bitrateMbps = defineModel<number>('bitrateMbps', { required: true });
const excludeAudio = defineModel<boolean>('excludeAudio', { required: true });
const audioCodec = defineModel<'aac' | 'opus'>('audioCodec', { default: 'aac' });
const audioBitrateKbps = defineModel<number>('audioBitrateKbps', { required: true });
const audioChannels = defineModel<number>('audioChannels', { default: 2 });
const audioSampleRate = defineModel<number>('audioSampleRate', { default: 0 });
const preset = defineModel<'optimal' | 'social' | 'high' | 'lossless' | 'custom'>('preset', {
  default: 'custom',
});
const bitrateMode = defineModel<'constant' | 'variable'>('bitrateMode', { default: 'variable' });
const keyframeIntervalSec = defineModel<number>('keyframeIntervalSec', { default: 2 });
const exportAlpha = defineModel<boolean>('exportAlpha', { default: false });
const metadataTitle = defineModel<string>('metadataTitle', { default: '' });
const metadataAuthor = defineModel<string>('metadataAuthor', { default: '' });
const metadataTags = defineModel<string>('metadataTags', { default: '' });
const metadataDescription = defineModel<string>('metadataDescription', { default: '' });

const { t } = useI18n();

const isAudioDisabled = computed(() => props.disabled || !props.hasAudio);

const filteredVideoCodecOptions = computed(() => {
  return props.videoCodecOptions.filter((opt: VideoCodecOptionResolved) => {
    if (outputFormat.value === 'mp4') {
      const v = opt.value.toLowerCase();
      if (v.startsWith('hev1') || v.startsWith('hvc1')) {
        return false;
      }
    }
    return true;
  });
});

const isBitrateModeTouched = ref(false);

function getDefaultBitrateModeByCodec(codec: string): 'constant' | 'variable' {
  // Requirement: default to VBR
  return 'variable';
}

function getEffectiveVideoCodec(): string {
  if (outputFormat.value === 'webm') return 'vp09.00.10.08';
  if (outputFormat.value === 'mkv') return 'av01.0.05M.08';
  return videoCodec.value || '';
}

const codecHint = computed(() => {
  if (outputFormat.value === 'webm') {
    return t('videoEditor.export.codecHint', { video: 'VP9', audio: 'Opus' });
  }
  if (outputFormat.value === 'mkv') {
    return t('videoEditor.export.codecHint', { video: 'AV1', audio: 'Opus' });
  }
  return null;
});

watch(outputFormat, (fmt) => {
  if (fmt === 'mp4') {
    audioCodec.value = 'aac';
  }

  isBitrateModeTouched.value = false;
  if (!props.disabled) {
    bitrateMode.value = getDefaultBitrateModeByCodec(getEffectiveVideoCodec());
  }
});

watch(videoCodec, () => {
  if (outputFormat.value !== 'mp4') return;
  if (isBitrateModeTouched.value) return;
  if (!props.disabled) {
    bitrateMode.value = getDefaultBitrateModeByCodec(getEffectiveVideoCodec());
  }
});

const audioCodecOptions = [
  { value: 'aac', label: t('videoEditor.export.codec.aac', 'AAC') },
  { value: 'opus', label: t('videoEditor.export.codec.opus', 'Opus') },
];

const bitrateModeOptions = [
  { value: 'variable', label: t('videoEditor.export.bitrateModeVbr') },
  { value: 'constant', label: t('videoEditor.export.bitrateModeCbr') },
];

watch(
  [
    outputFormat,
    videoCodec,
    bitrateMbps,
    excludeAudio,
    audioCodec,
    audioBitrateKbps,
    bitrateMode,
    keyframeIntervalSec,
    exportAlpha,
  ],
  () => {
    preset.value = 'custom';
  },
  { deep: true },
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="text-sm font-semibold text-ui-text uppercase tracking-wider">
      {{ t('videoEditor.export.encodingSettings', 'Encoding settings') }}
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.outputFormat', 'Output format') }}
      </label>
      <UiButtonGroup
        v-model="outputFormat"
        :options="props.formatOptions as any"
        :disabled="props.disabled"
      />
      <div
        v-if="codecHint"
        class="text-xs text-ui-text-muted bg-ui-bg-accent/30 px-3 py-2 rounded border border-ui-border"
      >
        {{ codecHint }}
      </div>
    </div>

    <div v-if="outputFormat === 'mp4'" class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.videoCodec', 'Video codec') }}
      </label>
      <div class="w-full">
        <UiSelect
          :model-value="
            (filteredVideoCodecOptions.find(
              (o: VideoCodecOptionResolved) => o.value === videoCodec,
            ) || videoCodec) as any
          "
          :items="filteredVideoCodecOptions"
          value-key="value"
          label-key="label"
          :disabled="props.disabled || props.isLoadingCodecSupport"
          size="sm"
          full-width
          @update:model-value="
            (v: unknown) => (videoCodec = (v as { value: string })?.value ?? (v as string))
          "
        />
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.videoBitrate', 'Video bitrate (Mbps)') }}
      </label>
      <UiWheelNumberInput
        v-model="bitrateMbps"
        :min="0"
        :step="0.1"
        :class="{ 'ring-2 ring-error ring-inset': bitrateMbps <= 0 }"
      />
      <span class="text-xs text-ui-text-muted">
        {{
          t(
            'videoEditor.export.videoBitrateHelp',
            'Higher bitrate = better quality and larger file',
          )
        }}
      </span>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.bitrateMode', 'Bitrate Mode') }}
      </label>
      <UiButtonGroup
        v-model="bitrateMode"
        :options="bitrateModeOptions"
        :disabled="props.disabled"
        @change="
          () => {
            isBitrateModeTouched = true;
          }
        "
      />
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.keyframeInterval', 'Keyframe Interval (GOP Size, sec)') }}
      </label>
      <UiWheelNumberInput v-model="keyframeIntervalSec" :min="1" :max="10" :step="1" />
    </div>

    <label v-if="outputFormat === 'webm'" class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="exportAlpha" :disabled="props.disabled" />
      <span class="text-sm text-ui-text">{{
        t('videoEditor.export.exportAlpha', 'Export Alpha Channel')
      }}</span>
    </label>

    <div class="h-px bg-ui-border my-2"></div>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="excludeAudio" :disabled="isAudioDisabled" />
      <span class="text-sm text-ui-text">{{
        t('videoEditor.export.excludeAudio', 'Exclude audio')
      }}</span>
    </label>

    <div v-if="!excludeAudio && !props.hideAudioBitrate" class="flex flex-col gap-4">
      <div v-if="outputFormat === 'mp4' && !props.showAudioAdvanced" class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.audioCodec', 'Audio codec') }}
        </label>
        <div class="w-full">
          <UiButtonGroup
            v-model="audioCodec"
            :options="audioCodecOptions"
            :disabled="props.disabled"
          />
        </div>
      </div>

      <FileConversionAudioSettings
        v-if="props.showAudioAdvanced"
        v-model:audio-bitrate-kbps="audioBitrateKbps"
        v-model:audio-channels="audioChannels"
        v-model:audio-sample-rate="audioSampleRate"
        :original-sample-rate="props.originalAudioSampleRate"
        :original-channels="props.originalAudioChannels"
        :allow-original-audio-sample-rate="props.allowOriginalAudioSampleRate"
        :hide-sample-rate="props.hideAudioSampleRate"
        :disabled="props.disabled"
      />

      <div v-else class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.audioBitrate', 'Audio bitrate (Kbps)') }}
        </label>
        <UiWheelNumberInput
          v-model="audioBitrateKbps"
          :min="0"
          :step="16"
          :class="{ 'ring-2 ring-error ring-inset': audioBitrateKbps <= 0 }"
        />
        <span class="text-xs text-ui-text-muted">
          {{
            t(
              'videoEditor.export.audioBitrateHelp',
              'Higher bitrate = better quality and larger file',
            )
          }}
        </span>
      </div>
    </div>

    <template v-if="props.showMetadata">
      <div class="h-px bg-ui-border my-2"></div>

      <div class="text-sm font-semibold text-ui-text uppercase tracking-wider">
        {{ t('videoEditor.export.metadata', 'Metadata') }}
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.metadataTitle', 'Title') }}
        </label>
        <UInput v-model="metadataTitle" size="sm" :disabled="props.disabled" class="w-full" />
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.metadataAuthor', 'Author') }}
        </label>
        <UInput v-model="metadataAuthor" size="sm" :disabled="props.disabled" class="w-full" />
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.metadataDescription', 'Description') }}
        </label>
        <UTextarea
          v-model="metadataDescription"
          size="sm"
          :disabled="props.disabled"
          class="w-full"
          :rows="3"
        />
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.metadataTags', 'Tags') }}
        </label>
        <UInput v-model="metadataTags" size="sm" :disabled="props.disabled" class="w-full" />
      </div>
    </template>
  </div>
</template>
