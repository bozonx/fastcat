<script setup lang="ts">
import { computed, watch, ref } from 'vue';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
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
const audioChannels = defineModel<'stereo' | 'mono'>('audioChannels', { default: 'stereo' });
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

const { t } = useI18n();

const isAudioDisabled = computed(() => props.disabled || !props.hasAudio);

const filteredVideoCodecOptions = computed(() => {
  return props.videoCodecOptions.filter((opt) => {
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
  const value = String(codec || '').toLowerCase();
  if (value.startsWith('avc1')) return 'constant';
  return 'variable';
}

function getEffectiveVideoCodec(): string {
  if (outputFormat.value === 'webm') return 'vp09.00.10.08';
  if (outputFormat.value === 'mkv') return 'av01.0.05M.08';
  return String(videoCodec.value || '');
}

const codecHint = computed(() => {
  if (outputFormat.value === 'webm') {
    return 'Video: VP9 · Audio: Opus';
  }
  if (outputFormat.value === 'mkv') {
    return 'Video: AV1 · Audio: Opus';
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

const presetOptions = [
  { value: 'optimal', label: t('videoEditor.export.preset.optimal', 'Optimal') },
  { value: 'social', label: t('videoEditor.export.preset.social', 'Social Media') },
  { value: 'high', label: t('videoEditor.export.preset.high', 'High Quality') },
  { value: 'lossless', label: t('videoEditor.export.preset.lossless', 'Visually Lossless') },
  { value: 'custom', label: t('videoEditor.export.preset.custom', 'Custom') },
];

const bitrateModeOptions = [
  { value: 'variable', label: 'VBR' },
  { value: 'constant', label: 'CBR' },
];

let isPresetApplying = false;

function onPresetChange(newPreset: string) {
  isPresetApplying = true;
  if (newPreset === 'optimal') {
    outputFormat.value = 'mkv';
    bitrateMode.value = 'variable';
    bitrateMbps.value = 5;
    audioCodec.value = 'opus';
    audioBitrateKbps.value = 128;
    keyframeIntervalSec.value = 2;
    exportAlpha.value = false;
  } else if (newPreset === 'social') {
    outputFormat.value = 'mp4';
    bitrateMode.value = 'variable';
    bitrateMbps.value = 8;
    audioCodec.value = 'aac';
    audioBitrateKbps.value = 128;
    keyframeIntervalSec.value = 2;
    exportAlpha.value = false;
  } else if (newPreset === 'high') {
    outputFormat.value = 'mkv';
    bitrateMode.value = 'variable';
    bitrateMbps.value = 20;
    audioCodec.value = 'opus';
    audioBitrateKbps.value = 192;
    keyframeIntervalSec.value = 2;
  } else if (newPreset === 'lossless') {
    outputFormat.value = 'mkv';
    bitrateMode.value = 'constant';
    bitrateMbps.value = 50;
    audioCodec.value = 'opus';
    audioBitrateKbps.value = 320;
    keyframeIntervalSec.value = 1;
  }
  setTimeout(() => {
    isPresetApplying = false;
  }, 50);
}

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
    if (!isPresetApplying) {
      preset.value = 'custom';
    }
  },
  { deep: true },
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="text-sm font-semibold text-ui-text uppercase tracking-wider">
      {{ t('videoEditor.export.encodingSettings', 'Encoding settings') }}
    </div>

    <div v-if="props.showBuiltinPresets" class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.presetLabel', 'Preset') }}
      </label>
      <USelectMenu
        v-model="preset"
        :items="presetOptions"
        value-key="value"
        label-key="label"
        :disabled="props.disabled"
        size="sm"
        class="w-full"
        @update:model-value="onPresetChange"
      />
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.outputFormat', 'Output format') }}
      </label>
      <UiAppButtonGroup
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
        <USelectMenu
          :model-value="
            (filteredVideoCodecOptions.find((o) => o.value === videoCodec) || videoCodec) as any
          "
          :items="filteredVideoCodecOptions"
          value-key="value"
          label-key="label"
          :disabled="props.disabled || props.isLoadingCodecSupport"
          size="sm"
          class="w-full"
          @update:model-value="(v: any) => (videoCodec = v?.value ?? v)"
        />
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.videoBitrate', 'Video bitrate (Mbps)') }}
      </label>
      <WheelNumberInput v-model="bitrateMbps" :min="0.2" :step="0.1" />
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
      <UiAppButtonGroup
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
      <WheelNumberInput v-model="keyframeIntervalSec" :min="1" :max="10" :step="1" />
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

    <div
      v-if="!excludeAudio && outputFormat === 'mp4' && !props.hideAudioBitrate"
      class="flex flex-col gap-2"
    >
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.audioCodec', 'Audio codec') }}
      </label>
      <div class="w-full">
        <UiAppButtonGroup
          v-model="audioCodec"
          :options="audioCodecOptions"
          :disabled="props.disabled"
        />
      </div>
    </div>

    <FileConversionAudioSettings
      v-if="!excludeAudio && props.showAudioAdvanced"
      v-model:audio-bitrate-kbps="audioBitrateKbps"
      v-model:audio-channels="audioChannels"
      v-model:audio-sample-rate="audioSampleRate"
      :original-sample-rate="props.originalAudioSampleRate"
      :allow-original-audio-sample-rate="props.allowOriginalAudioSampleRate"
      :hide-sample-rate="props.hideAudioSampleRate"
      :disabled="props.disabled"
    />

    <div v-else-if="!excludeAudio && !props.hideAudioBitrate" class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.audioCodec', 'Audio codec') }}
      </label>
      <div class="w-full">
        <UiAppButtonGroup
          v-model="audioCodec"
          :options="audioCodecOptions"
          :disabled="props.disabled"
        />
      </div>
    </div>

    <div v-else-if="!excludeAudio && !props.hideAudioBitrate" class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.audioBitrate', 'Audio bitrate (Kbps)') }}
      </label>
      <WheelNumberInput v-model="audioBitrateKbps" :min="32" :step="16" />
      <span class="text-xs text-ui-text-muted">
        {{
          t(
            'videoEditor.export.audioBitrateHelp',
            'Higher bitrate = better quality and larger file',
          )
        }}
      </span>
    </div>

    <template v-if="props.showMetadata && outputFormat !== 'webm'">
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
          {{ t('videoEditor.export.metadataTags', 'Tags') }}
        </label>
        <UInput v-model="metadataTags" size="sm" :disabled="props.disabled" class="w-full" />
      </div>
    </template>
  </div>
</template>
