import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

import { createAutoSave } from '~/utils/autoSave';
import {
  createDefaultProjectSettings,
  normalizeProjectSettings,
  type FastCatProjectSettings,
} from '~/utils/project-settings';
import { createProjectSettingsRepository } from '~/repositories/project-settings.repository';
import { useWorkspaceStore } from '~/stores/workspace.store';

interface ProjectSettingsRepo {
  load(): Promise<unknown | null>;
  save(data: FastCatProjectSettings): Promise<void>;
}

export const useProjectSettingsStore = defineStore('projectSettings', () => {
  const workspaceStore = useWorkspaceStore();

  const projectSettingsRepo = ref<ProjectSettingsRepo | null>(null);

  const projectSettings = ref<FastCatProjectSettings>(
    createDefaultProjectSettings(workspaceStore.userSettings),
  );
  const isLoadingProjectSettings = ref(false);
  const isSavingProjectSettings = ref(false);

  const getProjectDirHandle = ref<(() => Promise<FileSystemDirectoryHandle | null>) | null>(null);
  const getCurrentProjectName = ref<(() => string | null) | null>(null);
  const getIsReadOnly = ref<(() => boolean) | null>(null);

  const autoSave = createAutoSave({
    doSave: async () => {
      if (!workspaceStore.projectsHandle) return false;
      if (!getCurrentProjectName.value?.()) return false;
      if (isLoadingProjectSettings.value) return false;
      if (getIsReadOnly.value?.()) return false;

      isSavingProjectSettings.value = true;
      try {
        await ensureRepo();
        const repo: ProjectSettingsRepo | null = projectSettingsRepo.value;
        if (!repo) return false;

        await (repo as unknown as ProjectSettingsRepo).save(projectSettings.value);
      } finally {
        isSavingProjectSettings.value = false;
      }
    },
    onError: (e) => {
      const nuxtApp = useNuxtApp();
      const toast = (nuxtApp as any).$toast;
      if (toast) {
        toast.error('Failed to save project settings', {
          description: e instanceof Error ? e.message : 'Unknown error occurred',
        });
      } else {
        console.warn('Failed to save project settings', e);
      }
    },
  });
  function setContext(input: {
    getProjectDirHandle: () => Promise<FileSystemDirectoryHandle | null>;
    getCurrentProjectName: () => string | null;
    getIsReadOnly: () => boolean;
  }) {
    getProjectDirHandle.value = input.getProjectDirHandle;
    getCurrentProjectName.value = input.getCurrentProjectName;
    getIsReadOnly.value = input.getIsReadOnly;
  }

  function closeProjectSettings() {
    autoSave.reset();
    isLoadingProjectSettings.value = false;
    isSavingProjectSettings.value = false;
    projectSettingsRepo.value = null;

    projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
  }

  function markProjectSettingsAsDirty() {
    autoSave.markDirty();
  }

  function markProjectSettingsAsCleanForCurrentRevision() {
    autoSave.markCleanForCurrentRevision();
  }

  async function ensureRepo(): Promise<ProjectSettingsRepo | null> {
    if (projectSettingsRepo.value) return projectSettingsRepo.value;

    const dir = await getProjectDirHandle.value?.();
    projectSettingsRepo.value = dir ? createProjectSettingsRepository({ projectDir: dir }) : null;
    return projectSettingsRepo.value;
  }

  async function loadProjectSettings() {
    isLoadingProjectSettings.value = true;

    projectSettingsRepo.value = null;
    await ensureRepo();

    try {
      const repo: ProjectSettingsRepo | null = projectSettingsRepo.value;
      if (!repo) {
        projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
        return;
      }

      const raw = await (repo as unknown as ProjectSettingsRepo).load();
      projectSettings.value = normalizeProjectSettings(raw, workspaceStore.userSettings);
    } catch (e: unknown) {
      if ((e as { name?: unknown }).name === 'NotFoundError') {
        projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
        return;
      }

      console.warn('Failed to load project settings, fallback to defaults', e);
      projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
    } finally {
      isLoadingProjectSettings.value = false;
      autoSave.reset();
      markProjectSettingsAsCleanForCurrentRevision();
    }
  }

  async function requestProjectSettingsSave(options?: { immediate?: boolean }) {
    await autoSave.requestSave(options);
  }

  async function saveProjectSettings() {
    await requestProjectSettingsSave({ immediate: true });
  }

  async function saveInitialProjectSettingsForNewProject(options: {
    projectDir: FileSystemDirectoryHandle;
  }) {
    projectSettingsRepo.value = createProjectSettingsRepository({ projectDir: options.projectDir });

    const initial = createDefaultProjectSettings(workspaceStore.userSettings);
    projectSettings.value = initial;

    try {
      await projectSettingsRepo.value.save(projectSettings.value);
    } catch (e) {
      console.warn('Failed to create project settings file', e);
    }

    autoSave.reset();
    markProjectSettingsAsCleanForCurrentRevision();
  }

  watch(
    projectSettings,
    () => {
      if (isLoadingProjectSettings.value) return;
      markProjectSettingsAsDirty();
      void requestProjectSettingsSave();
    },
    { deep: true },
  );

  return {
    projectSettings,
    isLoadingProjectSettings,
    isSavingProjectSettings,
    setContext,
    closeProjectSettings,
    loadProjectSettings,
    saveProjectSettings,
    requestProjectSettingsSave,
    saveInitialProjectSettingsForNewProject,
  };
});
