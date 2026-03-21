<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import VideoEncodingForm from '~/components/media/VideoEncodingForm.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs';
import {
  createDefaultExportPresets,
  createExportPresetId,
  resolveExportPreset,
} from '~/utils/settings';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

const props = defineProps<{
  isActive: boolean;
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const toast = useToast();

const selectedPreset = computed(() =>
  resolveExportPreset(workspaceStore.userSettings.exportPresets),
);

const presetOptions = computed(() =>
  workspaceStore.userSettings.exportPresets.items.map((preset) => ({
    value: preset.id,
    label: preset.name,
  })),
);

// No explicit codec check needed here as it's handled in the form

function addPreset() {
  const basePreset = selectedPreset.value;
  const preset = {
    ...basePreset,
    id: createExportPresetId(),
    name: `${basePreset.name} Copy`,
  };

  workspaceStore.userSettings.exportPresets.items.push(preset);
  workspaceStore.userSettings.exportPresets.selectedPresetId = preset.id;
}

function removePreset() {
  const { items, selectedPresetId } = workspaceStore.userSettings.exportPresets;
  if (items.length <= 1) return;

  const index = items.findIndex((preset) => preset.id === selectedPresetId);
  if (index === -1) return;

  items.splice(index, 1);
  const nextPreset = items[Math.max(0, index - 1)] ?? items[0];
  if (!nextPreset) return;

  workspaceStore.userSettings.exportPresets.selectedPresetId = nextPreset.id;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-medium text-ui-text">
        {{ t('videoEditor.settings.userExport', 'Export presets') }}
      </div>
      <div class="flex items-center gap-2">
        <UButton size="xs" color="neutral" variant="ghost" @click="addPreset">
          {{ t('common.create', 'Create') }}
        </UButton>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="workspaceStore.userSettings.exportPresets.items.length <= 1"
          @click="removePreset"
        >
          {{ t('common.delete', 'Delete') }}
        </UButton>
      </div>
    </div>

    <UFormField :label="t('videoEditor.export.presetLabel', 'Preset')">
      <UiSelect
        v-model="workspaceStore.userSettings.exportPresets.selectedPresetId"
        :items="presetOptions"
        value-key="value"
        label-key="label"
        full-width
      />
    </UFormField>

    <UFormField :label="t('common.name', 'Name')">
      <UiTextInput v-model="selectedPreset.name" full-width />
    </UFormField>

    <VideoEncodingForm
      v-model:output-format="selectedPreset.format"
      v-model:video-codec="selectedPreset.videoCodec"
      v-model:bitrate-mbps="selectedPreset.bitrateMbps"
      v-model:exclude-audio="selectedPreset.excludeAudio"
      v-model:audio-codec="selectedPreset.audioCodec"
      v-model:audio-bitrate-kbps="selectedPreset.audioBitrateKbps"
      v-model:bitrate-mode="selectedPreset.bitrateMode"
      v-model:keyframe-interval-sec="selectedPreset.keyframeIntervalSec"
      v-model:export-alpha="selectedPreset.exportAlpha"
      :show-audio-advanced="true"
      :show-presets="false"
      :hide-audio-sample-rate="true"
      :disabled="false"
      :show-metadata="false"
      :has-audio="true"
    />
  </div>
</template>
