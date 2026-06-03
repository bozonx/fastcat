<script setup lang="ts">
import { computed, watch, ref, onMounted } from 'vue';
import { useExportCodecs } from '~/composables/timeline/export/core/useExportCodecs';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
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
const audioCodec = defineModel<'aac' | 'opus' | 'flac' | 'pcm' | 'mp3'>('audioCodec', { default: 'aac' });
const audioBitrateKbps = defineModel<number>('audioBitrateKbps', { required: true });
const audioChannels = defineModel<number>('audioChannels', { default: 2 });
const audioSampleRate = defineModel<number | 'original'>('audioSampleRate', {
  default: 'original',
});
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

function getDefaultBitrateModeByCodec(_codec: string): 'constant' | 'variable' {
  // Requirement: default to VBR
  return 'variable';
}

function getEffectiveVideoCodec(): string {
  if (outputFormat.value === 'webm') return 'vp09.00.10.08';
  if (outputFormat.value === 'mkv') return 'av01.0.05M.08';
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
  if (outputFormat.value === 'webm') {
    return `${help} (VP9)`;
  }
  if (outputFormat.value === 'mkv') {
    return `${help} (AV1)`;
  }
  const option = filteredVideoCodecOptions.value.find(
    (o: VideoCodecOptionResolved) => o.value === videoCodec.value,
  );
  const label = option?.label || videoCodec.value;
  return `${help} (${label})`;
});

watch(outputFormat, (fmt) => {
  if (fmt === 'webm') {
    audioCodec.value = 'opus';
  } else if (fmt === 'mp4' && (audioCodec.value === 'flac' || audioCodec.value === 'pcm')) {
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

const { audioCodecSupport, loadCodecSupport } = useExportCodecs();

onMounted(() => {
  loadCodecSupport();
});

const audioCodecOptions = computed(() => {
  const allOptions = [
    { value: 'aac', label: t('videoEditor.export.codec.aac') },
    { value: 'opus', label: t('videoEditor.export.codec.opus') },
    { value: 'flac', label: 'FLAC' },
    { value: 'pcm', label: 'PCM (WAV)' },
    { value: 'mp3', label: 'MP3' },
  ];

  return allOptions.map(opt => {
    let disabled = false;
    
    // Блокировка по формату контейнера
    if (outputFormat.value === 'webm') {
      disabled = opt.value !== 'opus';
    } else if (outputFormat.value === 'mp4') {
      // MP4 не поддерживает PCM и FLAC в нашем экспортере
      disabled = opt.value === 'pcm' || opt.value === 'flac';
    }
    
    // Блокировка по системе (браузер / ОС / Tauri)
    const isSupported = audioCodecSupport.value[opt.value as keyof typeof audioCodecSupport.value] !== false;
    
    return {
      ...opt,
      disabled: disabled || !isSupported
    };
  });
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
    <UiFormField :label="t('videoEditor.export.outputFormat')">
      <UiButtonGroup
        v-model="outputFormat"
        :options="props.formatOptions as any"
        :disabled="props.disabled"
      />
    </UiFormField>

    <UiFormField v-if="outputFormat === 'mp4'" :label="t('videoEditor.export.videoCodec')">
      <div class="w-full">
        <UiSelect
          :model-value="
            filteredVideoCodecOptions.find(
              (o: VideoCodecOptionResolved) => o.value === videoCodec,
            ) || videoCodec
          "
          :items="filteredVideoCodecOptions"
          value-key="value"
          label-key="label"
          :disabled="props.disabled || props.isLoadingCodecSupport"
          size="sm"
          full-width
          :search-input="false"
          @update:model-value="
            (v: unknown) => (videoCodec = (v as { value: string })?.value ?? (v as string))
          "
        />
      </div>
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
        <UiWheelNumberInput
          v-model="bitrateMbps"
          :min="0"
          :step="0.1"
          :wheel-step-multiplier="10"
          :class="{ 'ring-2 ring-error ring-inset': bitrateMbps <= 0 }"
        />
      </UiFormField>

      <UiFormField :label="t('videoEditor.export.keyframeInterval')" class="flex-1">
        <UiWheelNumberInput
          v-model="keyframeIntervalSec"
          :min="1"
          :max="1000"
          :step="1"
          :wheel-step-multiplier="10"
        />
      </UiFormField>
    </div>

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

    <UCheckbox
      v-if="outputFormat === 'webm'"
      v-model="exportAlpha"
      :label="t('videoEditor.export.exportAlpha')"
      :disabled="props.disabled"
      :ui="{ label: 'text-sm text-ui-text-muted' }"
      class="cursor-pointer"
    />

    <div class="h-px bg-ui-border my-2"></div>

    <div class="flex items-center justify-between">
      <span class="text-sm text-ui-text-muted">
        {{ t('common.audio') }} ({{ audioCodecOptions.find(o => o.value === audioCodec)?.label || audioCodec.toUpperCase() }})
      </span>
      <USwitch v-model="includeAudio" :disabled="isAudioDisabled" />
    </div>

    <div v-if="includeAudio && !props.hideAudioBitrate" class="flex flex-col gap-4">
      <UiFormField
        v-if="!props.showAudioAdvanced"
        :label="t('videoEditor.export.audioCodec')"
      >
        <div class="w-full">
          <UiButtonGroup
            v-model="audioCodec"
            :options="audioCodecOptions"
            :disabled="props.disabled"
          />
        </div>
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
        :help="
          t(
            'videoEditor.export.audioBitrateHelp',
            'Higher bitrate = better quality and larger file',
          )
        "
      >
        <UiWheelNumberInput
          v-model="audioBitrateKbps"
          :min="0"
          :step="16"
          :class="{ 'ring-2 ring-error ring-inset': audioBitrateKbps <= 0 }"
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
