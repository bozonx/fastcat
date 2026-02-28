<script setup lang="ts">
import { computed, watch } from 'vue';
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
  showMetadata?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  hasAudio: true,
  isLoadingCodecSupport: false,
  audioCodecLabel: 'AAC',
  showMetadata: false,
});

const outputFormat = defineModel<'mp4' | 'webm' | 'mkv'>('outputFormat', { required: true });
const videoCodec = defineModel<string>('videoCodec', { required: true });
const bitrateMbps = defineModel<number>('bitrateMbps', { required: true });
const excludeAudio = defineModel<boolean>('excludeAudio', { required: true });
const audioCodec = defineModel<'aac' | 'opus'>('audioCodec', { default: 'aac' });
const audioBitrateKbps = defineModel<number>('audioBitrateKbps', { required: true });
const preset = defineModel<'optimal' | 'social' | 'high' | 'lossless' | 'custom'>('preset', { default: 'custom' });
const bitrateMode = defineModel<'cbr' | 'vbr'>('bitrateMode', { default: 'vbr' });
const keyframeIntervalSec = defineModel<number>('keyframeIntervalSec', { default: 2 });
const multipassEncoding = defineModel<boolean>('multipassEncoding', { default: false });
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

watch(outputFormat, (fmt) => {
  if (fmt === 'mp4') {
    audioCodec.value = 'aac';
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
  { value: 'vbr', label: 'VBR' },
  { value: 'cbr', label: 'CBR' },
];

let isPresetApplying = false;

function onPresetChange(newPreset: string) {
  isPresetApplying = true;
  if (newPreset === 'optimal') {
    outputFormat.value = 'mkv';
    bitrateMode.value = 'vbr';
    bitrateMbps.value = 5;
    audioCodec.value = 'opus';
    audioBitrateKbps.value = 128;
    keyframeIntervalSec.value = 2;
    multipassEncoding.value = false;
    exportAlpha.value = false;
  } else if (newPreset === 'social') {
    outputFormat.value = 'mp4';
    bitrateMode.value = 'vbr';
    bitrateMbps.value = 8;
    audioCodec.value = 'aac';
    audioBitrateKbps.value = 128;
    keyframeIntervalSec.value = 2;
    multipassEncoding.value = false;
    exportAlpha.value = false;
  } else if (newPreset === 'high') {
    outputFormat.value = 'mkv';
    bitrateMode.value = 'vbr';
    bitrateMbps.value = 20;
    audioCodec.value = 'opus';
    audioBitrateKbps.value = 192;
    keyframeIntervalSec.value = 2;
    multipassEncoding.value = true;
  } else if (newPreset === 'lossless') {
    outputFormat.value = 'mkv';
    bitrateMode.value = 'cbr';
    bitrateMbps.value = 50;
    audioCodec.value = 'opus';
    audioBitrateKbps.value = 320;
    keyframeIntervalSec.value = 1;
    multipassEncoding.value = false;
  }
  setTimeout(() => {
    isPresetApplying = false;
  }, 50);
}

watch([outputFormat, videoCodec, bitrateMbps, excludeAudio, audioCodec, audioBitrateKbps, bitrateMode, keyframeIntervalSec, multipassEncoding, exportAlpha], () => {
  if (!isPresetApplying) {
    preset.value = 'custom';
  }
}, { deep: true });

</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="text-sm font-semibold text-ui-text uppercase tracking-wider">
      {{ t('videoEditor.export.encodingSettings', 'Encoding settings') }}
    </div>

    <div class="flex flex-col gap-2">
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
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.videoCodec', 'Video codec') }}
      </label>
      <div v-if="outputFormat === 'mp4'" class="w-full">
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
      <div v-else class="text-sm text-ui-text font-medium bg-ui-bg-accent px-3 py-2 rounded">
        {{ outputFormat === 'mkv' ? 'AV1' : 'VP9' }}
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.videoBitrate', 'Video bitrate (Mbps)') }}
      </label>
      <UInput
        v-model.number="bitrateMbps"
        type="number"
        inputmode="decimal"
        min="0.2"
        step="0.1"
        size="sm"
        :disabled="props.disabled"
        class="w-full"
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
      <UiAppButtonGroup
        v-model="bitrateMode"
        :options="bitrateModeOptions"
        :disabled="props.disabled"
      />
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.keyframeInterval', 'Keyframe Interval (GOP Size, sec)') }}
      </label>
      <UInput
        v-model.number="keyframeIntervalSec"
        type="number"
        inputmode="numeric"
        min="1"
        max="10"
        step="1"
        size="sm"
        :disabled="props.disabled"
        class="w-full"
      />
    </div>

    <label class="flex items-center gap-3 cursor-pointer">
      <UCheckbox v-model="multipassEncoding" :disabled="props.disabled" />
      <span class="text-sm text-ui-text">{{
        t('videoEditor.export.multipassEncoding', 'Multipass Encoding')
      }}</span>
    </label>

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

    <div v-if="!excludeAudio" class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.audioCodec', 'Audio codec') }}
      </label>
      <div v-if="outputFormat === 'mp4'" class="w-full">
        <UiAppButtonGroup
          v-model="audioCodec"
          :options="audioCodecOptions"
          :disabled="props.disabled"
        />
      </div>
      <div v-else class="text-sm text-ui-text font-medium bg-ui-bg-accent px-3 py-2 rounded">
        Opus
      </div>
    </div>

    <div v-if="!excludeAudio" class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.audioBitrate', 'Audio bitrate (Kbps)') }}
      </label>
      <UInput
        v-model.number="audioBitrateKbps"
        type="number"
        inputmode="numeric"
        min="32"
        step="16"
        size="sm"
        :disabled="props.disabled"
        class="w-full"
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

    <template v-if="props.showMetadata && outputFormat !== 'webm'">
      <div class="h-px bg-ui-border my-2"></div>
      
      <div class="text-sm font-semibold text-ui-text uppercase tracking-wider">
        {{ t('videoEditor.export.metadata', 'Metadata') }}
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.metadataTitle', 'Title') }}
        </label>
        <UInput
          v-model="metadataTitle"
          size="sm"
          :disabled="props.disabled"
          class="w-full"
        />
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.metadataAuthor', 'Author') }}
        </label>
        <UInput
          v-model="metadataAuthor"
          size="sm"
          :disabled="props.disabled"
          class="w-full"
        />
      </div>

      <div class="flex flex-col gap-2">
        <label class="text-xs text-ui-text-muted font-medium">
          {{ t('videoEditor.export.metadataTags', 'Tags') }}
        </label>
        <UInput
          v-model="metadataTags"
          size="sm"
          :disabled="props.disabled"
          class="w-full"
        />
      </div>
    </template>
  </div>
</template>
