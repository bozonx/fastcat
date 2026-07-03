<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { usePresetsStore } from '~/stores/presets.store';
import VideoEncodingForm from '~/components/media/VideoEncodingForm.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import ExportPresetList from '~/components/settings/ExportPresetList.vue';
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';

import {
  createExportPresetId,
  isBuiltInExportPreset,
  resolveExportPreset,
  type ExportSettingsPreset,
} from '~/utils/settings';

const props = defineProps<{
  isActive: boolean;
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const presetsStore = usePresetsStore();

const selectedPreset = computed(() =>
  resolveExportPreset(workspaceStore.userSettings.exportPresets),
);
const isBuiltIn = computed(() => isBuiltInExportPreset(selectedPreset.value));

const presetsModel = computed(() => workspaceStore.userSettings.exportPresets);

const draftPreset = ref<ExportSettingsPreset>({ ...selectedPreset.value });

watch(
  () => selectedPreset.value,
  (newPreset) => {
    draftPreset.value = { ...newPreset };
  },
  { deep: true, immediate: true },
);

const isDirty = computed(() => {
  const orig = selectedPreset.value;
  const draft = draftPreset.value;
  return (
    orig.name !== draft.name ||
    orig.format !== draft.format ||
    orig.videoCodec !== draft.videoCodec ||
    orig.bitrateMbps !== draft.bitrateMbps ||
    orig.excludeAudio !== draft.excludeAudio ||
    orig.audioCodec !== draft.audioCodec ||
    orig.audioBitrateKbps !== draft.audioBitrateKbps ||
    orig.bitrateMode !== draft.bitrateMode ||
    orig.keyframeIntervalSec !== draft.keyframeIntervalSec ||
    orig.exportAlpha !== draft.exportAlpha ||
    orig.fastStart !== draft.fastStart
  );
});

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

async function addPreset(basePreset: ExportSettingsPreset, namePrefix: string) {
  const preset = {
    ...basePreset,
    id: createExportPresetId(),
    name: createUniquePresetName(namePrefix),
  };

  await presetsStore.saveExportPreset(preset);
  workspaceStore.userSettings.exportPresets.selectedPresetId = preset.id;
}

function createPreset() {
  void addPreset(selectedPreset.value, t('common.newPreset'));
}

function duplicatePreset(id: string) {
  const preset = workspaceStore.userSettings.exportPresets.items.find((p) => p.id === id);
  if (!preset) return;

  void addPreset(preset, `${preset.name} ${t('common.copy')}`);
}

function saveChanges() {
  if (isBuiltIn.value) {
    saveAsNewPreset();
    return;
  }

  void presetsStore.saveExportPreset({ ...draftPreset.value });
}

function revertChanges() {
  draftPreset.value = { ...selectedPreset.value };
}

function saveAsNewPreset() {
  const baseName =
    isDirty.value && !isBuiltIn.value
      ? draftPreset.value.name
      : `${selectedPreset.value.name} ${t('common.copy')}`;

  void addPreset(draftPreset.value, baseName);
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

  void presetsStore.removeExportPreset(id);

  const remaining = workspaceStore.userSettings.exportPresets.items.filter((p) => p.id !== id);
  const nextPreset = remaining[Math.max(0, index - 1)] ?? remaining[0];
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
      :items="presetsModel.items"
      :selected-id="presetsModel.selectedPresetId"
      @select="selectPreset"
      @create="createPreset"
      @duplicate="duplicatePreset"
      @delete="requestDeletePreset"
    />

    <!-- Editing Form for Selected Preset -->
    <div class="border-t border-gray-700/50 pt-6">
      <div class="mb-4 flex items-center justify-between">
        <UiFormSectionHeader
          :title="draftPreset.name"
          :subtitle="
            isBuiltIn
              ? t('videoEditor.settings.presetBuiltInNotice')
              : t('videoEditor.settings.presetCustomNotice')
          "
        />
        <div class="flex items-center gap-2">
          <UButton
            v-if="isDirty"
            size="sm"
            color="gray"
            variant="ghost"
            @click="revertChanges"
          >
            {{ t('common.reset') }}
          </UButton>
          <UButton
            v-if="isDirty || isBuiltIn"
            size="sm"
            color="primary"
            @click="saveChanges"
          >
            {{ isBuiltIn ? t('common.saveAsCopy') : t('common.save') }}
          </UButton>
        </div>
      </div>

      <div class="space-y-4">
        <UiFormField
          :label="t('videoEditor.export.presetName')"
          :disabled="isBuiltIn"
        >
          <UiTextInput
            v-model="draftPreset.name"
            :disabled="isBuiltIn"
          />
        </UiFormField>

        <VideoEncodingForm
          v-model:format="draftPreset.format"
          v-model:video-codec="draftPreset.videoCodec"
          v-model:bitrate-mbps="draftPreset.bitrateMbps"
          v-model:exclude-audio="draftPreset.excludeAudio"
          v-model:audio-codec="draftPreset.audioCodec"
          v-model:audio-bitrate-kbps="draftPreset.audioBitrateKbps"
          v-model:bitrate-mode="draftPreset.bitrateMode"
          v-model:keyframe-interval-sec="draftPreset.keyframeIntervalSec"
          v-model:export-alpha="draftPreset.exportAlpha"
          v-model:fast-start="draftPreset.fastStart"
          :disabled="isBuiltIn"
        />
      </div>
    </div>

    <UiConfirmModal
      v-model:open="isDeleteModalOpen"
      :title="deleteModalTitle"
      :description="deleteModalDescription"
      :confirm-label="t('common.delete')"
      confirm-color="red"
      @confirm="deletePreset"
    />
  </div>
</template>
