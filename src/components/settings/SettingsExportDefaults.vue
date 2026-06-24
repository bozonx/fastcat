<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import VideoEncodingForm from '~/components/media/VideoEncodingForm.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import ExportPresetList from '~/components/settings/ExportPresetList.vue';

import {
  createExportPresetId,
  resolveExportPreset,
  type ExportSettingsPreset,
} from '~/utils/settings';

const props = defineProps<{
  isActive: boolean;
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const selectedPreset = computed(() =>
  resolveExportPreset(workspaceStore.userSettings.exportPresets),
);

const presetsModel = computed(() => workspaceStore.userSettings.exportPresets);

const isDeleteModalOpen = ref(false);
const presetIdToDelete = ref<string | null>(null);

function selectPreset(id: string) {
  workspaceStore.userSettings.exportPresets.selectedPresetId = id;
}

function createUniquePresetName(baseName: string): string {
  const names = new Set(workspaceStore.userSettings.exportPresets.items.map((p) => p.name));
  if (!names.has(baseName)) return baseName;

  let index = 2;
  while (names.has(`${baseName} ${index}`)) {
    index += 1;
  }
  return `${baseName} ${index}`;
}

function addPreset(basePreset: ExportSettingsPreset, namePrefix: string) {
  const preset = {
    ...basePreset,
    id: createExportPresetId(),
    name: createUniquePresetName(namePrefix),
  };

  workspaceStore.userSettings.exportPresets.items.push(preset);
  workspaceStore.userSettings.exportPresets.selectedPresetId = preset.id;
}

function createPreset() {
  addPreset(selectedPreset.value, t('common.newPreset'));
}

function duplicatePreset(id: string) {
  const preset = workspaceStore.userSettings.exportPresets.items.find((p) => p.id === id);
  if (!preset) return;

  addPreset(preset, `${preset.name} ${t('common.copy')}`);
}

function requestDeletePreset(id: string) {
  presetIdToDelete.value = id;
  isDeleteModalOpen.value = true;
}

function deletePreset() {
  const { items } = workspaceStore.userSettings.exportPresets;
  const id = presetIdToDelete.value;
  if (!id || items.length <= 1) return;

  const index = items.findIndex((preset) => preset.id === id);
  if (index === -1) return;

  items.splice(index, 1);

  const nextPreset = items[Math.max(0, index - 1)] ?? items[0];
  if (nextPreset) {
    workspaceStore.userSettings.exportPresets.selectedPresetId = nextPreset.id;
  }

  isDeleteModalOpen.value = false;
  presetIdToDelete.value = null;
}

const deleteModalTitle = computed(() => t('videoEditor.settings.presetDeleteTitle'));
const deleteModalDescription = computed(() => {
  const preset = workspaceStore.userSettings.exportPresets.items.find(
    (p) => p.id === presetIdToDelete.value,
  );
  return preset ? t('videoEditor.settings.presetDeleteDescription', { name: preset.name }) : '';
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <ExportPresetList
      :presets="presetsModel.items"
      :selected-id="presetsModel.selectedPresetId"
      :disabled="!props.isActive"
      @select="selectPreset"
      @create="createPreset"
      @duplicate="duplicatePreset"
      @delete="requestDeletePreset"
    />

    <div class="flex flex-col gap-6">
      <UiFormSectionHeader :title="t('videoEditor.settings.presetEditorTitle')" />

      <UiFormField :label="t('common.name')">
        <UiTextInput v-model="selectedPreset.name" full-width />
      </UiFormField>

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
        v-model:fast-start="selectedPreset.fastStart"
        :show-audio-advanced="true"
        :show-presets="false"
        :hide-audio-sample-rate="true"
        :disabled="false"
        :show-metadata="false"
        :has-audio="true"
      />
    </div>

    <UiConfirmModal
      v-model:open="isDeleteModalOpen"
      :title="deleteModalTitle"
      :description="deleteModalDescription"
      color="error"
      icon="i-heroicons-trash"
      @confirm="deletePreset"
    />
  </div>
</template>
