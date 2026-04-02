import { defineStore, skipHydrate } from 'pinia';
import { computed, ref, watch } from 'vue';
import { createWorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';
import type { WorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';
import { getWorkspaceStorageTopology } from '~/utils/storage-roots';
import { resolveWorkspaceLocalStorageTopology } from '~/utils/storage-topology';

import { createWorkspaceSettingsModule } from '~/stores/workspace/workspaceSettings';
import { createWorkspaceProjectsModule } from '~/stores/workspace/workspaceProjects';
import { createWorkspaceInitModule } from '~/stores/workspace/workspaceInit';
import { createWorkspaceProvider } from '~/stores/workspace/provider';

import { useProjectStore } from './project.store';
import { useProxyStore } from './proxy.store';

import { getErrorMessage } from '~/utils/errors';

function readLocalStorageString(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export interface RecentProject {
  projectName: string;
  projectId: string;
  updatedAt: string;
  lastTimelinePath?: string;
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaceProvider = createWorkspaceProvider();
  const workspaceTopology = getWorkspaceStorageTopology();

  const workspaceHandle = ref<FileSystemDirectoryHandle | null>(null);
  const projectsHandle = ref<FileSystemDirectoryHandle | null>(null);
  const settingsRepo = ref<WorkspaceSettingsRepository | null>(null);

  const projects = ref<string[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const isInitializing = ref(true);
  const isEphemeral = ref(false);
  const lastProjectName = ref<string | null>(
    readLocalStorageString('fastcat:workspace:last-opened-project'),
  );

  const recentProjects = ref<RecentProject[]>([]);
  try {
    const raw = readLocalStorageString('fastcat:workspace:recent-projects');
    if (raw) {
      recentProjects.value = JSON.parse(raw);
    }
  } catch {
    // ignore
  }

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

  const resolvedStorageTopology = computed(() =>
    resolveWorkspaceLocalStorageTopology(appSettings.value.paths),
  );

  const projectsModule = createWorkspaceProjectsModule({
    workspaceHandle,
    projectsHandle,
    projects,
    error,
    lastProjectName,
    resolvedStorageTopology,
  });
  const { loadProjects, clearVardata, clearProjectVardata, deleteProject, renameProject } =
    projectsModule;

  watch(lastProjectName, (v) => {
    if (typeof window === 'undefined' || isEphemeral.value) return;
    try {
      if (v === null) {
        window.localStorage.removeItem('fastcat:workspace:last-opened-project');
      } else {
        window.localStorage.setItem('fastcat:workspace:last-opened-project', v);
      }
    } catch {
      // ignore
    }
  });

  watch(
    recentProjects,
    (v) => {
      if (typeof window === 'undefined' || isEphemeral.value) return;
      try {
        window.localStorage.setItem('fastcat:workspace:recent-projects', JSON.stringify(v));
      } catch {
        // ignore
      }
    },
    { deep: true },
  );

  function updateRecentProject(project: Omit<RecentProject, 'updatedAt'>) {
    const now = new Date().toISOString();
    const existingIndex = recentProjects.value.findIndex(
      (p) => p.projectName === project.projectName,
    );

    const updatedProject: RecentProject = {
      ...project,
      updatedAt: now,
    };

    if (existingIndex !== -1) {
      recentProjects.value.splice(existingIndex, 1);
    }

    recentProjects.value.unshift(updatedProject);

    // Limit to 20 projects
    if (recentProjects.value.length > 20) {
      recentProjects.value = recentProjects.value.slice(0, 20);
    }

    lastProjectName.value = project.projectName;
  }

  const isApiSupported = workspaceProvider.isSupported;
  const workspaceProviderId = workspaceProvider.id;

  async function setupWorkspace(handle: FileSystemDirectoryHandle) {
    workspaceHandle.value = handle;
    settingsRepo.value = createWorkspaceSettingsRepository({ workspaceDir: handle });

    const folders = [
      workspaceTopology.projectsDirName,
      workspaceTopology.commonDirName,
      workspaceTopology.tempRootDirName,
    ];
    for (const folder of folders) {
      if (folder === workspaceTopology.projectsDirName) {
        projectsHandle.value = await handle.getDirectoryHandle(folder, { create: true });
      } else {
        await handle.getDirectoryHandle(folder, { create: true });
      }
    }

    try {
      const tempRootDir = await handle.getDirectoryHandle(workspaceTopology.tempRootDirName, {
        create: true,
      });
      await tempRootDir.getDirectoryHandle(workspaceTopology.tempProjectsDirName, { create: true });
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
    proxyStore.proxyProgress.clear();
    for (const [key, controller] of proxyStore.proxyAbortControllers.entries()) {
      controller.abort();
    }
    proxyStore.proxyAbortControllers.clear();
    proxyStore.activeWorkerPaths.clear();
  }

  async function initAutomaticWorkspace() {
    if (typeof window === 'undefined' || !navigator.storage?.getDirectory) {
      error.value = 'OPFS is not supported';
      isInitializing.value = false;
      return;
    }

    isLoading.value = true;
    error.value = null;
    isEphemeral.value = true;
    try {
      const root = await navigator.storage.getDirectory();
      // Use a dedicated subfolder for the embedded editor to avoid conflicts
      const embeddedHandle = await root.getDirectoryHandle('embedded-editor', { create: true });
      await setupWorkspace(embeddedHandle);
    } catch (e) {
      error.value = getErrorMessage(e, 'Failed to initialize automatic workspace');
    } finally {
      isLoading.value = false;
      isInitializing.value = false;
    }
  }

  async function wipeWorkspace() {
    if (!workspaceHandle.value) return;
    const handle = workspaceHandle.value;
    isLoading.value = true;
    try {
      // Clear all entries in the workspace handle
      const entries = (handle as any).values();
      for await (const entry of entries) {
        await handle.removeEntry(entry.name, { recursive: entry.kind === 'directory' });
      }
      resetWorkspace();
    } catch (e) {
      console.warn('Failed to wipe workspace:', e);
    } finally {
      isLoading.value = false;
    }
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
    resolvedStorageTopology: skipHydrate(resolvedStorageTopology),
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
    initAutomaticWorkspace,
    wipeWorkspace,
    resetWorkspace,
    setupWorkspace,
    loadProjects,
    isInitializing,
    isEphemeral,
    clearVardata,
    clearProjectVardata,
    deleteProject,
    renameProject,
    recentProjects: skipHydrate(recentProjects),
    updateRecentProject,
  };
});
