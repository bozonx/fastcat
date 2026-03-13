import { defineStore, skipHydrate } from 'pinia';
import { ref, watch } from 'vue';
import { VARDATA_DIR_NAME, VARDATA_PROJECTS_DIR_NAME } from '~/utils/vardata-paths';
import { WORKSPACE_COMMON_DIR_NAME } from '~/utils/workspace-common';
import { createWorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';
import type { WorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';

import { createWorkspaceSettingsModule } from '~/stores/workspace/workspaceSettings';
import { createWorkspaceProjectsModule } from '~/stores/workspace/workspaceProjects';
import { createWorkspaceInitModule } from '~/stores/workspace/workspaceInit';
import { createWorkspaceProvider } from '~/stores/workspace/provider';

import { useProjectStore } from './project.store';
import { useProxyStore } from './proxy.store';

function readLocalStorageString(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaceProvider = createWorkspaceProvider();

  const workspaceHandle = ref<FileSystemDirectoryHandle | null>(null);
  const projectsHandle = ref<FileSystemDirectoryHandle | null>(null);
  const settingsRepo = ref<WorkspaceSettingsRepository | null>(null);

  const projects = ref<string[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const isInitializing = ref(true);
  const lastProjectName = ref<string | null>(
    readLocalStorageString('fastcat-last-opened-project') ??
      readLocalStorageString('gran-editor-last-opened-project'),
  );

  const settingsModule = createWorkspaceSettingsModule({ settingsRepo });
  const {
    userSettings,
    appSettings,
    workspaceSettings,
    isSavingUserSettings,
    userSettingsSaveError,
    isSavingAppSettings,
    appSettingsSaveError,
    isSavingWorkspaceSettings,
    workspaceSettingsSaveError,
    batchUpdateUserSettings,
    batchUpdateAppSettings,
    batchUpdateWorkspaceSettings,
    loadAppSettingsFromDisk,
    loadWorkspaceSettingsFromDisk,
    loadUserSettingsFromDisk,
    saveAppSettingsToDisk,
    saveWorkspaceSettingsToDisk,
    saveUserSettingsToDisk,
    flushSettingsSaves,
    resetSettingsState,
  } = settingsModule;

  const projectsModule = createWorkspaceProjectsModule({
    workspaceHandle,
    projectsHandle,
    projects,
    error,
    lastProjectName,
  });
  const { loadProjects, clearVardata, clearProjectVardata, deleteProject, renameProject } =
    projectsModule;

  watch(lastProjectName, (v) => {
    if (typeof window === 'undefined') return;
    try {
      if (v === null) {
        window.localStorage.removeItem('fastcat-last-opened-project');
        window.localStorage.removeItem('gran-editor-last-opened-project');
      } else {
        window.localStorage.setItem('fastcat-last-opened-project', v);
        window.localStorage.removeItem('gran-editor-last-opened-project');
      }
    } catch {
      // ignore
    }
  });

  const isApiSupported = workspaceProvider.isSupported;
  const workspaceProviderId = workspaceProvider.id;

  async function setupWorkspace(handle: FileSystemDirectoryHandle) {
    workspaceHandle.value = handle;
    settingsRepo.value = createWorkspaceSettingsRepository({ workspaceDir: handle });

    const folders = ['projects', WORKSPACE_COMMON_DIR_NAME, VARDATA_DIR_NAME];
    for (const folder of folders) {
      if (folder === 'projects') {
        projectsHandle.value = await handle.getDirectoryHandle(folder, { create: true });
      } else {
        await handle.getDirectoryHandle(folder, { create: true });
      }
    }

    try {
      const vardataDir = await handle.getDirectoryHandle(VARDATA_DIR_NAME, { create: true });
      await vardataDir.getDirectoryHandle(VARDATA_PROJECTS_DIR_NAME, { create: true });
    } catch {
      // ignore
    }

    await loadProjects();
    await loadAppSettingsFromDisk();
    await loadUserSettingsFromDisk();
    await saveAppSettingsToDisk();
    await saveUserSettingsToDisk();
  }

  const workspaceInitModule = createWorkspaceInitModule({
    workspaceHandle,
    projectsHandle,
    settingsRepo,
    workspaceProvider,
    isLoading,
    error,
    isInitializing,
    loadProjects,
    loadAppSettingsFromDisk,
    loadWorkspaceSettingsFromDisk,
    loadUserSettingsFromDisk,
    saveAppSettingsToDisk,
    saveWorkspaceSettingsToDisk,
    saveUserSettingsToDisk,
    resetSettingsState,
  });

  const { init, openWorkspace } = workspaceInitModule;

  function resetWorkspace() {
    workspaceHandle.value = null;
    projectsHandle.value = null;
    settingsRepo.value = null;
    projects.value = [];
    error.value = null;

    resetSettingsState();

    workspaceProvider.clearWorkspace().catch(console.warn);

    // Reset dependent stores when workspace is closed
    const projectStore = useProjectStore();
    void projectStore.closeProject();

    // Some stores are already reset by closeProject, but we do proxy here since it's workspace-level too
    const proxyStore = useProxyStore();
    proxyStore.generatingProxies.clear();
    proxyStore.existingProxies.clear();
    proxyStore.proxyProgress = {};
    for (const [key, controller] of Object.entries(proxyStore.proxyAbortControllers)) {
      controller.abort();
    }
    proxyStore.proxyAbortControllers = {};
    proxyStore.activeWorkerPaths.clear();
  }

  return {
    workspaceHandle,
    projectsHandle,
    projects,
    isLoading,
    error,
    isApiSupported,
    workspaceProviderId,
    lastProjectName: skipHydrate(lastProjectName),
    userSettings: skipHydrate(userSettings),
    appSettings: skipHydrate(appSettings),
    workspaceSettings: skipHydrate(workspaceSettings),
    isSavingUserSettings,
    userSettingsSaveError,
    isSavingAppSettings,
    appSettingsSaveError,
    isSavingWorkspaceSettings,
    workspaceSettingsSaveError,
    batchUpdateUserSettings,
    batchUpdateAppSettings,
    batchUpdateWorkspaceSettings,
    flushSettingsSaves,
    init,
    openWorkspace,
    resetWorkspace,
    setupWorkspace,
    loadProjects,
    isInitializing,
    clearVardata,
    clearProjectVardata,
    deleteProject,
    renameProject,
  };
});
