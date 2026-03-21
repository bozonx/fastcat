<script setup lang="ts">
import { computed } from 'vue';
import { useVideoCodecs } from '~/composables/useVideoCodecs';
import { useWorkspaceStore } from '~/stores/workspace.store';
import MediaEncodingSettings, {
  type FormatOption,
} from '~/components/media/MediaEncodingSettings.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import { resolveExportPreset } from '~/utils/settings/presets';

interface Props {
  disabled?: boolean;
  showMetadata?: boolean;
  showPresets?: boolean;
  showAudioAdvanced?: boolean;
  originalAudioSampleRate?: number | null;
  originalAudioChannels?: number | null;
  allowOriginalAudioSampleRate?: boolean;
  hideAudioBitrate?: boolean;
  hideAudioSampleRate?: boolean;
  hasAudio?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  showMetadata: false,
  showPresets: false,
  showAudioAdvanced: false,
  originalAudioSampleRate: null,
  originalAudioChannels: null,
  allowOriginalAudioSampleRate: false,
  hideAudioBitrate: false,
  hideAudioSampleRate: false,
  hasAudio: true,
});

const outputFormat = defineModel<'mp4' | 'webm' | 'mkv'>('outputFormat', { required: true });
const videoCodec = defineModel<string>('videoCodec', { required: true });
const bitrateMbps = defineModel<number>('bitrateMbps', { required: true });
const excludeAudio = defineModel<boolean>('excludeAudio', { required: true });
const audioCodec = defineModel<'aac' | 'opus'>('audioCodec', { default: 'aac' });
const audioBitrateKbps = defineModel<number>('audioBitrateKbps', { required: true });
const audioChannels = defineModel<number>('audioChannels', { default: 2 });
const audioSampleRate = defineModel<number>('audioSampleRate', { default: 0 });
const preset = defineModel<string>('preset', { default: 'custom' });
const bitrateMode = defineModel<'constant' | 'variable'>('bitrateMode', { default: 'variable' });
const keyframeIntervalSec = defineModel<number>('keyframeIntervalSec', { default: 2 });
const exportAlpha = defineModel<boolean>('exportAlpha', { default: false });
const metadataTitle = defineModel<string>('metadataTitle', { default: '' });
const metadataAuthor = defineModel<string>('metadataAuthor', { default: '' });
const metadataTags = defineModel<string>('metadataTags', { default: '' });
const metadataDescription = defineModel<string>('metadataDescription', { default: '' });

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const { isLoadingCodecSupport, videoCodecOptions } = useVideoCodecs();

const formatOptions: readonly FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WEBM' },
  { value: 'mkv', label: 'MKV (AV1)' },
];

const presetOptions = computed(() => {
  const items = workspaceStore.userSettings.exportPresets.items.map((p) => ({
    value: p.id,
    label: p.name,
  }));
  return [...items, { value: 'custom', label: t('videoEditor.export.preset.custom', 'Custom') }];
});

function applyPreset(presetId: string) {
  if (presetId === 'custom') return;

  const found = workspaceStore.userSettings.exportPresets.items.find((p) => p.id === presetId);
  if (!found) return;

  outputFormat.value = found.format;
  videoCodec.value = found.videoCodec;
  bitrateMbps.value = found.bitrateMbps;
  excludeAudio.value = found.excludeAudio;
  audioCodec.value = found.audioCodec;
  audioBitrateKbps.value = found.audioBitrateKbps;
  bitrateMode.value = found.bitrateMode;
  keyframeIntervalSec.value = found.keyframeIntervalSec;
  exportAlpha.value = found.exportAlpha;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div v-if="props.showPresets" class="flex flex-col gap-2">
      <label class="text-xs text-ui-text-muted font-medium">
        {{ t('videoEditor.export.presetLabel', 'Preset') }}
      </label>
      <div class="flex items-center gap-2">
        <UiSelect
          v-model="preset"
          :items="presetOptions"
          value-key="value"
          label-key="label"
          :disabled="props.disabled"
          size="sm"
          full-width
          @update:model-value="applyPreset"
        />
      </div>
    </div>

    <MediaEncodingSettings
      v-model:output-format="outputFormat"
      v-model:video-codec="videoCodec"
      v-model:bitrate-mbps="bitrateMbps"
      v-model:exclude-audio="excludeAudio"
      v-model:audio-codec="audioCodec"
      v-model:audio-bitrate-kbps="audioBitrateKbps"
      v-model:audio-channels="audioChannels"
      v-model:audio-sample-rate="audioSampleRate"
      v-model:preset="preset as any"
      v-model:bitrate-mode="bitrateMode"
      v-model:keyframe-interval-sec="keyframeIntervalSec"
      v-model:export-alpha="exportAlpha"
      v-model:metadata-title="metadataTitle"
      v-model:metadata-author="metadataAuthor"
      v-model:metadata-tags="metadataTags"
      v-model:metadata-description="metadataDescription"
      :disabled="props.disabled"
      :show-metadata="props.showMetadata"
      :show-audio-advanced="props.showAudioAdvanced"
      :original-audio-sample-rate="props.originalAudioSampleRate"
      :original-audio-channels="props.originalAudioChannels"
      :allow-original-audio-sample-rate="props.allowOriginalAudioSampleRate"
      :hide-audio-bitrate="props.hideAudioBitrate"
      :hide-audio-sample-rate="props.hideAudioSampleRate"
      :has-audio="props.hasAudio"
      :is-loading-codec-support="isLoadingCodecSupport"
      :format-options="formatOptions"
      :video-codec-options="videoCodecOptions"
      :show-builtin-presets="false"
    />
  </div>
</template>
