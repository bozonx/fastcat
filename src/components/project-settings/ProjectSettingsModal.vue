<script setup lang="ts">
import { createDevLogger } from '~/utils/dev-logger';

import UiModal from '~/components/ui/UiModal.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import { ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_PROJECT_SETTINGS, markProjectSettingsAuto } from '~/utils/project-settings';

import ResolutionSettings from './ResolutionSettings.vue';
import AdvancedSettings from './AdvancedSettings.vue';
import MetadataSettings from './MetadataSettings.vue';
import StorageSettings from './StorageSettings.vue';
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';
import { useModalOpenModel } from '~/composables/ui/useModalOpenModel';

const _log = createDevLogger('ProjectSettingsModal');
const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

const storageStatsKey = ref(0);

const isOpen = useModalOpenModel(props, emit);

const isClearProjectVardataConfirmOpen = ref(false);
const isDeleteProjectConfirmOpen = ref(false);
const isResetConfirmOpen = ref(false);

async function confirmClearProjectVardata() {
  isClearProjectVardataConfirmOpen.value = false;
  if (!projectStore.currentProjectId) return;
  await workspaceStore.clearProjectVardata(projectStore.currentProjectId);
  storageStatsKey.value++;
}

async function confirmDeleteProject() {
  isDeleteProjectConfirmOpen.value = false;
  await projectStore.deleteCurrentProject();
  // Closing the current project will automatically return the user to the projects list
  // because projectStore.currentProjectName becomes null and the view switches in index.vue
}

async function resetToDefaults() {
  if (!projectStore.projectSettings) return;

  // Reset project resolution and FPS to default project constants
  const pDefaults = DEFAULT_PROJECT_SETTINGS.project;
  projectStore.projectSettings.project.width = pDefaults.width;
  projectStore.projectSettings.project.height = pDefaults.height;
  projectStore.projectSettings.project.fps = pDefaults.fps;
  projectStore.projectSettings.project.resolutionFormat = pDefaults.resolutionFormat;
  projectStore.projectSettings.project.orientation = pDefaults.orientation;
  projectStore.projectSettings.project.aspectRatio = pDefaults.aspectRatio;
  projectStore.projectSettings.project.isCustomResolution = pDefaults.isCustomResolution;
  projectStore.projectSettings.project.sampleRate = pDefaults.sampleRate;
  // Re-enable auto-detection: clears resolved state so the next dropped clips
  // re-derive geometry/sample rate again.
  markProjectSettingsAuto(projectStore.projectSettings.project);

  // Reset advanced settings
  projectStore.projectSettings.project.audioDeclickDurationUs =
    workspaceStore.userSettings.projectDefaults.audioDeclickDurationUs;

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
      t('videoEditor.projectSettings.title') +
      (projectStore.currentProjectName ? ': ' + projectStore.currentProjectName : '')
    "
    :ui="{ content: 'sm:max-w-lg max-h-[90vh]', body: 'overflow-y-auto' }"
  >
    <UiConfirmModal
      v-model:open="isClearProjectVardataConfirmOpen"
      :title="t('videoEditor.projectSettings.clearTempTitle')"
      :description="
        t(
          'videoEditor.projectSettings.clearTempDescription',
          'This will delete generated proxies, thumbnails and cached data for this project.',
        )
      "
      :confirm-text="t('videoEditor.projectSettings.clearTempConfirm')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-trash"
      @confirm="confirmClearProjectVardata"
    />

    <UiConfirmModal
      v-model:open="isDeleteProjectConfirmOpen"
      :title="t('videoEditor.projectSettings.deleteProjectConfirmTitle')"
      :description="
        t(
          'videoEditor.projectSettings.deleteProjectConfirmDescription',
          'This will permanently delete the project folder and all its contents. This action cannot be undone.',
        )
      "
      :confirm-text="t('videoEditor.projectSettings.deleteProjectAction')"
      :cancel-text="t('common.cancel')"
      color="error"
      icon="i-heroicons-trash"
      @confirm="confirmDeleteProject"
    />

    <UiConfirmModal
      v-model:open="isResetConfirmOpen"
      :title="t('videoEditor.projectSettings.resetConfirmTitle')"
      :description="
        t(
          'videoEditor.projectSettings.resetConfirmDescription',
          'This will restore all project settings to the default values from your workspace settings.',
        )
      "
      :confirm-text="t('videoEditor.projectSettings.resetSettings')"
      :cancel-text="t('common.cancel')"
      color="warning"
      icon="i-heroicons-exclamation-triangle"
      @confirm="resetToDefaults"
    />

    <div v-if="projectStore.projectSettings" class="space-y-6">
      <ResolutionSettings />

      <div class="h-px bg-ui-border"></div>

      <AdvancedSettings />

      <div class="h-px bg-ui-border"></div>

      <div class="space-y-2 pt-2 px-0">
        <UiFormSectionHeader :title="t('videoEditor.projectSettings.metadata')" />
        <MetadataSettings />
      </div>

      <div class="h-px bg-ui-border"></div>

      <div class="space-y-2 pt-2 px-0">
        <UiFormSectionHeader :title="t('videoEditor.projectSettings.storage')" />
        <StorageSettings
          :key="storageStatsKey"
          @clear-temp="isClearProjectVardataConfirmOpen = true"
          @delete-project="isDeleteProjectConfirmOpen = true"
        />
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('videoEditor.projectSettings.resetSettings')"
          @click="isResetConfirmOpen = true"
        />
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('common.close')"
          @click="isOpen = false"
        />
      </div>
    </template>
  </UiModal>
</template>
