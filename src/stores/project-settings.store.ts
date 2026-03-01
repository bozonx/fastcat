import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import PQueue from 'p-queue';

import {
  createDefaultProjectSettings,
  normalizeProjectSettings,
  type GranVideoEditorProjectSettings,
} from '~/utils/project-settings';
import { createProjectSettingsRepository } from '~/repositories/project-settings.repository';
import { useWorkspaceStore } from '~/stores/workspace.store';

interface ProjectSettingsRepo {
  load(): Promise<unknown | null>;
  save(data: GranVideoEditorProjectSettings): Promise<void>;
}

export const useProjectSettingsStore = defineStore('projectSettings', () => {
  const workspaceStore = useWorkspaceStore();

  const projectSettingsRepo = ref<ProjectSettingsRepo | null>(null);

  const projectSettings = ref<GranVideoEditorProjectSettings>(
    createDefaultProjectSettings(workspaceStore.userSettings),
  );
  const isLoadingProjectSettings = ref(false);
  const isSavingProjectSettings = ref(false);

  const getProjectDirHandle = ref<(() => Promise<FileSystemDirectoryHandle | null>) | null>(null);
  const getCurrentProjectName = ref<(() => string | null) | null>(null);

  let persistProjectSettingsTimeout: number | null = null;
  let projectSettingsRevision = 0;
  let savedProjectSettingsRevision = 0;

  const projectSettingsSaveQueue = new PQueue({ concurrency: 1 });

  function setContext(input: {
    getProjectDirHandle: () => Promise<FileSystemDirectoryHandle | null>;
    getCurrentProjectName: () => string | null;
  }) {
    getProjectDirHandle.value = input.getProjectDirHandle;
    getCurrentProjectName.value = input.getCurrentProjectName;
  }

  function clearPersistProjectSettingsTimeout() {
    if (typeof window === 'undefined') return;
    if (persistProjectSettingsTimeout === null) return;
    window.clearTimeout(persistProjectSettingsTimeout);
    persistProjectSettingsTimeout = null;
  }

  function closeProjectSettings() {
    clearPersistProjectSettingsTimeout();
    isLoadingProjectSettings.value = false;
    isSavingProjectSettings.value = false;
    projectSettingsRepo.value = null;

    projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
    projectSettingsRevision = 0;
    savedProjectSettingsRevision = 0;
  }

  function markProjectSettingsAsDirty() {
    projectSettingsRevision += 1;
  }

  function markProjectSettingsAsCleanForCurrentRevision() {
    savedProjectSettingsRevision = projectSettingsRevision;
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
      projectSettingsRevision = 0;
      markProjectSettingsAsCleanForCurrentRevision();
    }
  }

  async function persistProjectSettingsNow() {
    if (!workspaceStore.projectsHandle) return;
    if (!getCurrentProjectName.value?.()) return;
    if (isLoadingProjectSettings.value) return;

    if (savedProjectSettingsRevision >= projectSettingsRevision) return;

    isSavingProjectSettings.value = true;
    const revisionToSave = projectSettingsRevision;

    try {
      await ensureRepo();
      const repo: ProjectSettingsRepo | null = projectSettingsRepo.value;
      if (!repo) return;

      await (repo as unknown as ProjectSettingsRepo).save(projectSettings.value);

      if (savedProjectSettingsRevision < revisionToSave) {
        savedProjectSettingsRevision = revisionToSave;
      }
    } catch (e) {
      console.warn('Failed to save project settings', e);
    } finally {
      isSavingProjectSettings.value = false;
    }
  }

  async function enqueueProjectSettingsSave() {
    await projectSettingsSaveQueue.add(async () => {
      await persistProjectSettingsNow();
    });
  }

  async function requestProjectSettingsSave(options?: { immediate?: boolean }) {
    if (options?.immediate) {
      clearPersistProjectSettingsTimeout();
      await enqueueProjectSettingsSave();
      return;
    }

    if (typeof window === 'undefined') {
      await enqueueProjectSettingsSave();
      return;
    }

    clearPersistProjectSettingsTimeout();
    persistProjectSettingsTimeout = window.setTimeout(() => {
      persistProjectSettingsTimeout = null;
      void enqueueProjectSettingsSave();
    }, 500);
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

    projectSettingsRevision = 0;
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
