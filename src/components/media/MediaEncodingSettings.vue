<script setup lang="ts">
import { computed, watch, ref } from 'vue';
import { useAudioCodecOptions } from '~/composables/timeline/export/core/useAudioCodecOptions';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiTextarea from '~/components/ui/UiTextarea.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';
import UiTooltip from '~/components/ui/UiTooltip.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
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
  isApplyingPreset?: boolean;
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
  isApplyingPreset: false,
});

const outputFormat = defineModel<'mp4' | 'webm' | 'mkv'>('outputFormat', { required: true });
const videoCodec = defineModel<string>('videoCodec', { required: true });
const bitrateMbps = defineModel<number>('bitrateMbps', { required: true });
const excludeAudio = defineModel<boolean>('excludeAudio', { required: true });
const audioCodec = defineModel<'aac' | 'opus' | 'flac' | 'pcm' | 'mp3'>('audioCodec', {
  default: 'aac',
});
const audioBitrateKbps = defineModel<number>('audioBitrateKbps', { required: true });
const audioChannels = defineModel<number>('audioChannels', { default: 2 });
const audioSampleRate = defineModel<number | 'original'>('audioSampleRate', {
  default: 'original',
});
const preset = defineModel<'optimal' | 'social' | 'high' | 'lossless' | 'custom'>('preset', {
  default: 'custom',
});
const bitrateMode = defineModel<'constant' | 'variable'>('bitrateMode', { default: 'variable' });
const enableAdvancedSettings = defineModel<boolean>('enableAdvancedSettings', { default: false });
const maxBitrateMbps = defineModel<number | null>('maxBitrateMbps', { default: null });
const keyframeIntervalSec = defineModel<number>('keyframeIntervalSec', { default: 2 });
const exportAlpha = defineModel<boolean>('exportAlpha', { default: false });
const fastStart = defineModel<boolean>('fastStart', { default: true });
const metadataTitle = defineModel<string>('metadataTitle', { default: '' });
const metadataAuthor = defineModel<string>('metadataAuthor', { default: '' });
const metadataTags = defineModel<string>('metadataTags', { default: '' });
const metadataDescription = defineModel<string>('metadataDescription', { default: '' });

const { t } = useI18n();

const isAudioDisabled = computed(() => props.disabled || !props.hasAudio);

const filteredVideoCodecOptions = computed(() => {
  const format = outputFormat.value;
  return props.videoCodecOptions.filter((opt: VideoCodecOptionResolved) => {
    if (format === 'webm') {
      return opt.value === 'vp09.00.10.08';
    }

    if (opt.disabled) return false;

    if (format === 'mp4') {
      const v = opt.value.toLowerCase();
      if (v.startsWith('hev1') || v.startsWith('hvc1')) {
        return false;
      }
    }

    return true;
  });
});

const isBitrateModeTouched = ref(false);

function getDefaultBitrateModeByCodec(_codec: string): 'constant' | 'variable' {
  // Requirement: default to VBR
  return 'variable';
}

function getEffectiveVideoCodec(): string {
  if (outputFormat.value === 'webm') return videoCodec.value || 'vp09.00.10.08';
  if (outputFormat.value === 'mkv') return videoCodec.value || 'av01.0.05M.08';
  return videoCodec.value || '';
}

const includeAudio = computed({
  get: () => !excludeAudio.value,
  set: (val) => {
    excludeAudio.value = !val;
  },
});

const videoCodecHelp = computed(() => {
  const help = t('videoEditor.export.videoBitrateHelp');
  const option = filteredVideoCodecOptions.value.find(
    (o: VideoCodecOptionResolved) => o.value === videoCodec.value,
  );
  const label = option?.label || videoCodec.value;
  return `${help} (${label})`;
});

const canExportAlpha = computed(() => {
  if (outputFormat.value === 'webm') return true;
  if (outputFormat.value === 'mkv') {
    const alphaCodecs = ['vp09.00.10.08'];
    return alphaCodecs.includes(videoCodec.value);
  }
  return false;
});

watch(outputFormat, (fmt) => {
  if (fmt === 'webm') {
    audioCodec.value = 'opus';
    videoCodec.value = 'vp09.00.10.08';
  } else if (fmt === 'mp4') {
    videoCodec.value = 'avc1.640032';
    if (audioCodec.value === 'flac' || audioCodec.value === 'pcm') {
      audioCodec.value = 'aac';
    }
  } else if (fmt === 'mkv') {
    const mkvAllowed = ['avc1.640032', 'vp09.00.10.08', 'av01.0.05M.08'];
    if (!mkvAllowed.includes(videoCodec.value)) {
      videoCodec.value = 'av01.0.05M.08';
    }
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

const { audioCodecOptions } = useAudioCodecOptions({
  format: outputFormat,
  disableByFormat: true,
  relabel: true,
});

const maxBitrate = computed({
  get: () => maxBitrateMbps.value !== null ? maxBitrateMbps.value : Math.round(bitrateMbps.value * 1.5 * 10) / 10,
  set: (val) => {
    maxBitrateMbps.value = val;
  }
});

watch(bitrateMbps, (newVal) => {
  if (maxBitrateMbps.value !== null && maxBitrateMbps.value < newVal) {
    maxBitrateMbps.value = newVal;
  }
});

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
    enableAdvancedSettings,
    maxBitrateMbps,
    keyframeIntervalSec,
    exportAlpha,
    fastStart,
  ],
  () => {
    if (props.isApplyingPreset) return;
    preset.value = 'custom';
  },
  { deep: true },
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <UiFormField :label="t('videoEditor.export.outputFormat')">
      <UiButtonGroup
        v-model="outputFormat"
        :options="props.formatOptions as any"
        :disabled="props.disabled"
      />
    </UiFormField>

    <UiFormField :label="t('videoEditor.export.videoCodec')">
      <UiSelect
        :model-value="
          filteredVideoCodecOptions.find((o: VideoCodecOptionResolved) => o.value === videoCodec) ||
          videoCodec
        "
        :items="filteredVideoCodecOptions"
        value-key="value"
        label-key="label"
        :disabled="props.disabled || props.isLoadingCodecSupport || outputFormat === 'webm'"
        size="sm"
        full-width
        :search-input="false"
        @update:model-value="
          (v: unknown) => (videoCodec = (v as { value: string })?.value ?? (v as string))
        "
      />
    </UiFormField>

    <div class="flex gap-4">
      <UiFormField class="flex-1">
        <template #label>
          <div class="flex items-center gap-1">
            {{ t('videoEditor.export.videoBitrate') }}
            <UiTooltip :text="videoCodecHelp">
              <UIcon name="i-heroicons-information-circle" class="h-4 w-4 text-ui-text-muted" />
            </UiTooltip>
          </div>
        </template>
        <UiSliderInput
          v-model="bitrateMbps"
          :min="0.2"
          :max="100"
          :step="0.1"
          :decimals="1"
          unit=" Mbps"
          :show-input="true"
          :disabled="props.disabled"
          input-class="w-20!"
        />
      </UiFormField>
    </div>

    <UCheckbox
      v-if="canExportAlpha"
      v-model="exportAlpha"
      :label="t('videoEditor.export.exportAlpha')"
      :disabled="props.disabled"
      :ui="{ label: 'text-sm text-ui-text-muted' }"
      class="cursor-pointer"
    />

    <UCheckbox
      v-model="enableAdvancedSettings"
      :label="t('videoEditor.export.advancedSettings')"
      :disabled="props.disabled"
      :ui="{ label: 'text-sm text-ui-text' }"
      class="cursor-pointer my-1"
    />

    <template v-if="enableAdvancedSettings">
      <div class="flex flex-col gap-4 pl-4 border-l border-ui-border">
        <UiFormField :label="t('videoEditor.export.bitrateMode')">
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
        </UiFormField>

        <!-- Max Bitrate field, visible only for VBR -->
        <UiFormField v-if="bitrateMode === 'variable'">
          <template #label>
            <div class="flex items-center gap-1">
              {{ t('videoEditor.export.maxBitrate') }}
              <UiTooltip :text="t('videoEditor.export.maxBitrateHelp')">
                <UIcon name="i-heroicons-information-circle" class="h-4 w-4 text-ui-text-muted" />
              </UiTooltip>
            </div>
          </template>
          <UiSliderInput
            v-model="maxBitrate"
            :min="bitrateMbps"
            :max="bitrateMbps * 4"
            :step="0.1"
            :decimals="1"
            unit=" Mbps"
            :show-input="true"
            :disabled="props.disabled"
            input-class="w-20!"
          />
        </UiFormField>

        <UiFormField :label="t('videoEditor.export.keyframeInterval')">
          <UiWheelNumberInput
            v-model="keyframeIntervalSec"
            :min="1"
            :max="1000"
            :step="1"
            :wheel-step-multiplier="10"
            :disabled="props.disabled"
          />
        </UiFormField>

        <UCheckbox
          v-if="outputFormat === 'mp4'"
          v-model="fastStart"
          :label="t('videoEditor.export.fastStart')"
          :disabled="props.disabled"
          :ui="{ label: 'text-sm text-ui-text-muted' }"
          class="cursor-pointer"
        />
      </div>
    </template>

    <div class="h-px bg-ui-border my-2"></div>

    <div class="flex items-center justify-between">
      <span class="text-sm text-ui-text-muted">
        {{ t('common.audio') }}
      </span>
      <USwitch v-model="includeAudio" :disabled="isAudioDisabled" />
    </div>

    <div v-if="includeAudio && !props.hideAudioBitrate" class="flex flex-col gap-4">
      <UiFormField v-if="!props.showAudioAdvanced" :label="t('videoEditor.export.audioCodec')">
        <UiButtonGroup
          v-model="audioCodec"
          :options="audioCodecOptions"
          :disabled="props.disabled"
        />
      </UiFormField>

      <FileConversionAudioSettings
        v-if="props.showAudioAdvanced"
        v-model:audio-codec="audioCodec"
        v-model:audio-bitrate-kbps="audioBitrateKbps"
        v-model:audio-channels="audioChannels"
        v-model:audio-sample-rate="audioSampleRate"
        :original-sample-rate="props.originalAudioSampleRate"
        :original-channels="props.originalAudioChannels"
        :allow-original-sample-rate="props.allowOriginalAudioSampleRate"
        :hide-sample-rate="props.hideAudioSampleRate"
        :disabled="props.disabled"
        :output-format="outputFormat"
      />

      <UiFormField
        v-else
        :label="t('videoEditor.export.audioBitrate')"
        :help="t('videoEditor.export.audioBitrateHelp')"
      >
        <UiSliderInput
          v-model="audioBitrateKbps"
          :min="32"
          :max="512"
          :step="16"
          :decimals="0"
          unit=" Kbps"
          :show-input="true"
          :disabled="props.disabled"
          input-class="w-20!"
        />
      </UiFormField>
    </div>

    <template v-if="props.showMetadata">
      <div class="h-px bg-ui-border my-2"></div>

      <UiFormSectionHeader :title="t('videoEditor.export.metadata')" />

      <UiFormField :label="t('videoEditor.export.metadataTitle')">
        <UiTextInput v-model="metadataTitle" size="sm" :disabled="props.disabled" full-width />
      </UiFormField>

      <UiFormField :label="t('videoEditor.export.metadataAuthor')">
        <UiTextInput v-model="metadataAuthor" size="sm" :disabled="props.disabled" full-width />
      </UiFormField>

      <UiFormField :label="t('videoEditor.export.metadataDescription')">
        <UiTextarea
          v-model="metadataDescription"
          size="sm"
          :disabled="props.disabled"
          :rows="3"
          full-width
        />
      </UiFormField>

      <UiFormField :label="t('videoEditor.export.metadataTags')">
        <UiTextInput v-model="metadataTags" size="sm" :disabled="props.disabled" full-width />
      </UiFormField>
    </template>
  </div>
</template>
