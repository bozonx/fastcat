<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import { ref, computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { resolveExportPreset, resolveProjectPreset } from '~/utils/settings';

import ResolutionSettings from './project-settings/ResolutionSettings.vue';
import ExportSettings from './project-settings/ExportSettings.vue';
import AdvancedSettings from './project-settings/AdvancedSettings.vue';
import MetadataSettings from './project-settings/MetadataSettings.vue';
import StorageSettings from './project-settings/StorageSettings.vue';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

const isClearProjectVardataConfirmOpen = ref(false);
const isDeleteProjectConfirmOpen = ref(false);
const isResetConfirmOpen = ref(false);

async function confirmClearProjectVardata() {
  isClearProjectVardataConfirmOpen.value = false;
  if (!projectStore.currentProjectId) return;
  await workspaceStore.clearProjectVardata(projectStore.currentProjectId);
}

async function confirmDeleteProject() {
  isDeleteProjectConfirmOpen.value = false;
  await projectStore.deleteCurrentProject();
  // Closing the current project will automatically return the user to the projects list
  // because projectStore.currentProjectName becomes null and the view switches in index.vue
}

async function resetToDefaults() {
  if (!projectStore.projectSettings) return;

  // Reset project resolution and FPS to workspace defaults
  const pDefaults = resolveProjectPreset(workspaceStore.userSettings.projectPresets);
  projectStore.projectSettings.project.width = pDefaults.width;
  projectStore.projectSettings.project.height = pDefaults.height;
  projectStore.projectSettings.project.fps = pDefaults.fps;
  projectStore.projectSettings.project.resolutionFormat = pDefaults.resolutionFormat;
  projectStore.projectSettings.project.orientation = pDefaults.orientation;
  projectStore.projectSettings.project.aspectRatio = pDefaults.aspectRatio;
  projectStore.projectSettings.project.isCustomResolution = pDefaults.isCustomResolution;
  projectStore.projectSettings.project.sampleRate = pDefaults.sampleRate;

  // Reset export encoding settings to workspace defaults
  const eDefaults = resolveExportPreset(workspaceStore.userSettings.exportPresets);
  const exportEncoding = projectStore.projectSettings.exportDefaults.encoding;
  exportEncoding.format = eDefaults.format;
  exportEncoding.videoCodec = eDefaults.videoCodec;
  exportEncoding.bitrateMbps = eDefaults.bitrateMbps;
  exportEncoding.excludeAudio = eDefaults.excludeAudio;
  exportEncoding.audioCodec = eDefaults.audioCodec;
  exportEncoding.audioBitrateKbps = eDefaults.audioBitrateKbps;
  exportEncoding.bitrateMode = eDefaults.bitrateMode;
  exportEncoding.keyframeIntervalSec = eDefaults.keyframeIntervalSec;
  exportEncoding.exportAlpha = eDefaults.exportAlpha;

  await projectStore.saveProjectMeta({
    title: '',
    description: '',
    author: '',
    tags: [],
  });

  await projectStore.saveProjectSettings();
  isResetConfirmOpen.value = false;
}
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="
      t('videoEditor.projectSettings.title', 'Project Settings') +
      (projectStore.currentProjectName ? ': ' + projectStore.currentProjectName : '')
    "
    :ui="{ content: 'sm:max-w-lg max-h-[90vh]', body: 'overflow-y-auto' }"
  >
    <UiConfirmModal
      v-model:open="isClearProjectVardataConfirmOpen"
      :title="t('videoEditor.projectSettings.clearTempTitle', 'Clear temporary files')"
      :description="
        t(
          'videoEditor.projectSettings.clearTempDescription',
          'This will delete generated proxies, thumbnails and cached data for this project.',
        )
      "
      :confirm-text="t('videoEditor.projectSettings.clearTempConfirm', 'Clear')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-trash"
      @confirm="confirmClearProjectVardata"
    />

    <UiConfirmModal
      v-model:open="isDeleteProjectConfirmOpen"
      :title="t('videoEditor.projectSettings.deleteProjectConfirmTitle', 'Delete Project?')"
      :description="
        t(
          'videoEditor.projectSettings.deleteProjectConfirmDescription',
          'This will permanently delete the project folder and all its contents. This action cannot be undone.',
        )
      "
      :confirm-text="t('videoEditor.projectSettings.deleteProjectAction', 'Delete')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="error"
      icon="i-heroicons-trash"
      @confirm="confirmDeleteProject"
    />

    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.projectSettings.resetConfirmTitle', 'Reset to defaults?')"
      :description="
        t(
          'videoEditor.projectSettings.resetConfirmDescription',
          'This will restore all project settings to the default values from your workspace settings.',
        )
      "
      :confirm-text="t('videoEditor.projectSettings.reset', 'Reset to Defaults')"
      :cancel-text="t('common.cancel', 'Cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetToDefaults"
    />

    <div v-if="projectStore.projectSettings" class="space-y-6">
      <div class="h-px bg-ui-border"></div>

      <ResolutionSettings />

      <div class="h-px bg-ui-border"></div>

      <ExportSettings />

      <div class="h-px bg-ui-border"></div>

      <AdvancedSettings />

      <div class="h-px bg-ui-border"></div>

      <MetadataSettings />

      <div class="h-px bg-ui-border"></div>

      <StorageSettings
        @clear-temp="isClearProjectVardataConfirmOpen = true"
        @delete-project="isDeleteProjectConfirmOpen = true"
      />
    </div>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('videoEditor.projectSettings.reset', 'Reset to Defaults')"
          @click="isResetConfirmOpen = true"
        />
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('common.close', 'Close')"
          @click="isOpen = false"
        />
      </div>
    </template>
  </UiModal>
</template>
