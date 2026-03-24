<script setup lang="ts">
import { computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { resolveExportPreset } from '~/utils/settings';
import {
  BASE_AUDIO_CODEC_OPTIONS,
  BASE_VIDEO_CODEC_OPTIONS,
  VIDEO_FORMAT_OPTIONS,
} from '~/utils/webcodecs';
import VideoEncodingForm from '~/components/media/VideoEncodingForm.vue';
import SettingsSection from './SettingsSection.vue';
import UiSelect from '~/components/ui/UiSelect.vue';

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

const exportSummary = computed(() => {
  const e = projectStore.projectSettings?.exportDefaults?.encoding;
  if (!e) return '';

  const formatLabel =
    VIDEO_FORMAT_OPTIONS.find((f) => f.value === e.format)?.label || e.format || '';
  const format = formatLabel.split(' ')[0]?.toUpperCase() || '';

  const vCodecLabel =
    BASE_VIDEO_CODEC_OPTIONS.find((o) => o.value === e.videoCodec)?.label || e.videoCodec || '';
  const vCodec = vCodecLabel.split(' ')[0]?.toUpperCase() || '';

  const vBitrate = `${e.bitrateMbps || 0}Mb/s`;

  const aCodecLabel =
    BASE_AUDIO_CODEC_OPTIONS.find((o) => o.value === e.audioCodec)?.label || e.audioCodec || '';
  const aCodec = aCodecLabel.split(' ')[0]?.toUpperCase() || '';

  const aBitrate = `${e.audioBitrateKbps || 0} Kb/s`;

  return `${t('videoEditor.projectSettings.export', 'Export')}: ${format} ${vCodec} ${vBitrate} | ${aCodec} ${aBitrate}`;
});

const exportPresetOptions = computed(() =>
  workspaceStore.userSettings.exportPresets.items.map((preset) => ({
    value: preset.id,
    label: preset.name,
  })),
);

function applyExportPreset(presetId: string) {
  if (!projectStore.projectSettings) return;

  const preset =
    workspaceStore.userSettings.exportPresets.items.find((item) => item.id === presetId) ??
    resolveExportPreset(workspaceStore.userSettings.exportPresets);

  const exportEncoding = projectStore.projectSettings.exportDefaults.encoding;
  exportEncoding.format = preset.format;
  exportEncoding.videoCodec = preset.videoCodec;
  exportEncoding.bitrateMbps = preset.bitrateMbps;
  exportEncoding.excludeAudio = preset.excludeAudio;
  exportEncoding.audioCodec = preset.audioCodec;
  exportEncoding.audioBitrateKbps = preset.audioBitrateKbps;
  exportEncoding.bitrateMode = preset.bitrateMode;
  exportEncoding.keyframeIntervalSec = preset.keyframeIntervalSec;
  exportEncoding.exportAlpha = preset.exportAlpha;
}
</script>

<template>
  <SettingsSection
    v-if="projectStore.projectSettings"
    :title="t('videoEditor.projectSettings.export', 'Export')"
    :summary="exportSummary"
  >
    <UFormField :label="t('videoEditor.export.presetLabel', 'Preset')">
      <UiSelect
        v-model="workspaceStore.userSettings.exportPresets.selectedPresetId"
        :items="exportPresetOptions"
        value-key="value"
        label-key="label"
        full-width
        :search-input="false"
        @update:model-value="(val) => applyExportPreset(val as string)"
      />
    </UFormField>

    <VideoEncodingForm
      v-model:output-format="projectStore.projectSettings.exportDefaults.encoding.format"
      v-model:video-codec="projectStore.projectSettings.exportDefaults.encoding.videoCodec"
      v-model:bitrate-mbps="projectStore.projectSettings.exportDefaults.encoding.bitrateMbps"
      v-model:exclude-audio="projectStore.projectSettings.exportDefaults.encoding.excludeAudio"
      v-model:audio-codec="projectStore.projectSettings.exportDefaults.encoding.audioCodec"
      v-model:audio-bitrate-kbps="
        projectStore.projectSettings.exportDefaults.encoding.audioBitrateKbps
      "
      v-model:bitrate-mode="projectStore.projectSettings.exportDefaults.encoding.bitrateMode"
      v-model:keyframe-interval-sec="
        projectStore.projectSettings.exportDefaults.encoding.keyframeIntervalSec
      "
      v-model:export-alpha="projectStore.projectSettings.exportDefaults.encoding.exportAlpha"
      :show-audio-advanced="true"
      :show-presets="false"
      :hide-audio-sample-rate="true"
      :show-metadata="false"
      :disabled="false"
      :has-audio="true"
    />
  </SettingsSection>
</template>
