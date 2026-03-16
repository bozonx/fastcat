import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

import { createAutoSave } from '~/utils/autoSave';
import {
  createDefaultProjectSettings,
  normalizeProjectSettings,
  type FastCatProjectSettings,
} from '~/utils/project-settings';
import { createProjectSettingsRepository } from '~/repositories/project-settings.repository';
import {
  createProjectUiRepository,
  type ProjectUiRepository,
} from '~/repositories/project-ui.repository';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { ProjectMeta } from '~/repositories/project-meta.repository';
import { useEditorViewStore } from '~/stores/editorView.store';

interface ProjectSettingsRepo {
  load(): Promise<unknown | null>;
  save(data: FastCatProjectSettings): Promise<void>;
}

export const useProjectSettingsStore = defineStore('projectSettings', () => {
  const workspaceStore = useWorkspaceStore();

  const projectSettingsRepo = ref<ProjectSettingsRepo | null>(null);
  const projectUiRepo = ref<ProjectUiRepository | null>(null);

  const projectSettings = ref<FastCatProjectSettings>(
    createDefaultProjectSettings(workspaceStore.userSettings),
  );
  const isLoadingProjectSettings = ref(false);
  const isSavingProjectSettings = ref(false);

  const editorViewStore = useEditorViewStore();

  const getProjectDirHandle = ref<(() => Promise<FileSystemDirectoryHandle | null>) | null>(null);
  const getCurrentProjectName = ref<(() => string | null) | null>(null);
  const getIsReadOnly = ref<(() => boolean) | null>(null);
  const getProjectMeta = ref<(() => ProjectMeta | null) | null>(null);
  const saveProjectMeta = ref<((updates: Partial<ProjectMeta>) => Promise<void>) | null>(null);

  const activeMonitor = computed(() => {
    const view = editorViewStore.currentView;
    const targetView =
      view === 'fullscreen' ? editorViewStore.lastViewBeforeFullscreen || 'cut' : view;
    const safeView = ['cut', 'sound', 'export'].includes(targetView) ? targetView : 'cut';
    return projectSettings.value.monitors[safeView] || projectSettings.value.monitor;
  });

  const autoSave = createAutoSave({
    doSave: async () => {
      if (!workspaceStore.projectsHandle) return false;
      if (!getCurrentProjectName.value?.()) return false;
      if (isLoadingProjectSettings.value) return false;
      if (getIsReadOnly.value?.()) return false;

      isSavingProjectSettings.value = true;
      try {
        await ensureRepo();

        // Save technical settings
        if (projectSettingsRepo.value) {
          await projectSettingsRepo.value.save(projectSettings.value);
        }

        // Save UI session settings
        if (projectUiRepo.value) {
          await projectUiRepo.value.save({
            version: 1,
            monitors: projectSettings.value.monitors,
            timelines: projectSettings.value.timelines,
          });
        }
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
    getProjectMeta: () => ProjectMeta | null;
    saveProjectMeta: (updates: Partial<ProjectMeta>) => Promise<void>;
  }) {
    getProjectDirHandle.value = input.getProjectDirHandle;
    getCurrentProjectName.value = input.getCurrentProjectName;
    getIsReadOnly.value = input.getIsReadOnly;
    getProjectMeta.value = input.getProjectMeta;
    saveProjectMeta.value = input.saveProjectMeta;
  }

  function closeProjectSettings() {
    autoSave.reset();
    isLoadingProjectSettings.value = false;
    isSavingProjectSettings.value = false;
    projectSettingsRepo.value = null;
    projectUiRepo.value = null;

    projectSettings.value = createDefaultProjectSettings(workspaceStore.userSettings);
  }

  function markProjectSettingsAsDirty() {
    autoSave.markDirty();
  }

  function markProjectSettingsAsCleanForCurrentRevision() {
    autoSave.markCleanForCurrentRevision();
  }

  async function ensureRepo(): Promise<void> {
    if (projectSettingsRepo.value && projectUiRepo.value) return;

    const dir = await getProjectDirHandle.value?.();
    if (dir) {
      if (!projectSettingsRepo.value) {
        projectSettingsRepo.value = createProjectSettingsRepository({ projectDir: dir });
      }
      if (!projectUiRepo.value) {
        projectUiRepo.value = createProjectUiRepository({ projectDir: dir });
      }
    }
  }

  async function loadProjectSettings() {
    isLoadingProjectSettings.value = true;

    projectSettingsRepo.value = null;
    projectUiRepo.value = null;
    await ensureRepo();

    try {
      const settings = createDefaultProjectSettings(workspaceStore.userSettings);

      // Load technical settings
      if (projectSettingsRepo.value) {
        const repo = projectSettingsRepo.value as ProjectSettingsRepo;
        const raw = await repo.load();
        if (raw) {
          const normalized = normalizeProjectSettings(raw, workspaceStore.userSettings);
          Object.assign(settings, normalized);
        }
      }

      // Load UI session settings
      if (projectUiRepo.value) {
        const repo = projectUiRepo.value as ProjectUiRepository;
        const uiRaw = await repo.load();
        if (uiRaw) {
          if (uiRaw.monitors) {
            settings.monitors = { ...settings.monitors, ...uiRaw.monitors };
          } else if ((uiRaw as any).monitor) {
            // Migration from legacy single monitor
            settings.monitors.cut = { ...settings.monitors.cut, ...(uiRaw as any).monitor };
          }

          if (uiRaw.timelines) settings.timelines = { ...settings.timelines, ...uiRaw.timelines };
        }
      }

      projectSettings.value = settings;
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
    projectUiRepo.value = createProjectUiRepository({ projectDir: options.projectDir });

    const initial = createDefaultProjectSettings(workspaceStore.userSettings);
    projectSettings.value = initial;

    try {
      await projectSettingsRepo.value.save(projectSettings.value);
      await projectUiRepo.value.save({
        version: 1,
        monitors: initial.monitors,
        timelines: initial.timelines,
      });
    } catch (e) {
      console.warn('Failed to create project settings/ui files', e);
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
    activeMonitor,
  };
});
