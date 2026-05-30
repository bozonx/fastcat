import { createDevLogger } from '~/utils/dev-logger';
import { defineStore, skipHydrate } from 'pinia';
import { ref, watch } from 'vue';
import { createWorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';
import type { WorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';
import { getWorkspaceStorageTopology } from '~/utils/storage-roots';
import {
  resolveTauriSystemStorageTopology,
  resolveWorkspaceLocalStorageTopology,
  type ResolvedStorageTopology,
} from '~/utils/storage-topology';
import { resolveTauriAppPaths, type TauriAppPaths } from '~/utils/tauri-paths';
import { isModelDownloaded } from '~/utils/transcription/model-storage';

import { createWorkspaceSettingsModule } from '~/stores/workspace/workspaceSettings';
import { createWorkspaceProjectsModule } from '~/stores/workspace/workspaceProjects';
import { createWorkspaceInitModule } from '~/stores/workspace/workspaceInit';
import { useVfs } from '~/composables/useVfs';
import { createWorkspaceProvider } from '~/stores/workspace/provider';
import { createWorkspaceStateModule } from '~/stores/workspace/workspaceState';

import { useProjectStore } from './project.store';
import { useProxyStore } from './proxy.store';

import { getErrorMessage } from '~/utils/errors';
import { useRuntimeConfig } from 'nuxt/app';
const log = createDevLogger('workspace.store');

export interface RecentProject {
  projectName: string;
  projectId: string;
  updatedAt: string;
  lastTimelinePath?: string;
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const runtimeConfig = useRuntimeConfig();
  const workspaceProvider = createWorkspaceProvider(
    runtimeConfig.public.fastcatDevDir as string | undefined,
  );
  const workspaceTopology = getWorkspaceStorageTopology();

  const workspaceHandle = ref<FileSystemDirectoryHandle | null>(null);
  const projectsHandle = ref<FileSystemDirectoryHandle | null>(null);
  const settingsRepo = ref<WorkspaceSettingsRepository | null>(null);
  const tauriAppPaths = ref<TauriAppPaths | null>(null);

  const projects = ref<string[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const isInitializing = ref(true);
  const isEphemeral = ref(false);
  const lastProjectName = ref<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem('fastcat_last_project_name') : null,
  );

  const recentProjects = ref<RecentProject[]>([]);
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('fastcat_recent_projects');
    if (saved) {
      try {
        recentProjects.value = JSON.parse(saved);
      } catch {
        // ignore
      }
    }
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

  const stateModule = createWorkspaceStateModule({ settingsRepo });
  const {
    workspaceState,
    isSavingWorkspaceState,
    workspaceStateSaveError,
    batchUpdateWorkspaceState,
    loadWorkspaceStateFromDisk,
    saveWorkspaceStateToDisk,
    resetWorkspaceState,
  } = stateModule;

  const isSttModelDownloaded = ref(false);

  async function checkSttModelStatus() {
    if (!workspaceHandle.value) {
      isSttModelDownloaded.value = false;
      return;
    }
    const model = userSettings.value.integrations.stt.localModel;
    isSttModelDownloaded.value = await isModelDownloaded(workspaceHandle.value, model);
  }

  watch(
    [workspaceHandle, () => userSettings.value.integrations.stt.localModel],
    () => {
      checkSttModelStatus();
    },
    { immediate: true },
  );

  const resolvedStorageTopology = ref<ResolvedStorageTopology>(
    resolveWorkspaceLocalStorageTopology(appSettings.value.paths),
  );
  let storageTopologyRevision = 0;

  async function refreshResolvedStorageTopology() {
    const revision = ++storageTopologyRevision;
    const paths = appSettings.value.paths;
    if (workspaceProvider.id !== 'tauri' || paths.placementMode === 'portable') {
      resolvedStorageTopology.value = resolveWorkspaceLocalStorageTopology(paths);
      return;
    }

    tauriAppPaths.value ??= await resolveTauriAppPaths(
      runtimeConfig.public.fastcatDevDir as string | undefined,
    );
    if (!tauriAppPaths.value) {
      resolvedStorageTopology.value = resolveWorkspaceLocalStorageTopology(paths);
      return;
    }

    const resolved = await resolveTauriSystemStorageTopology({
      paths,
      appPaths: tauriAppPaths.value,
    });
    if (revision === storageTopologyRevision) {
      resolvedStorageTopology.value = resolved;
    }
  }

  watch(
    () => appSettings.value.paths,
    () => {
      void refreshResolvedStorageTopology();
    },
    { deep: true, immediate: true },
  );

  const projectsModule = createWorkspaceProjectsModule({
    workspaceHandle,
    projectsHandle,
    projects,
    error,
    lastProjectName,
    recentProjects,
    resolvedStorageTopology,
  });
  const { loadProjects, clearVardata, clearProjectVardata, deleteProject, renameProject } =
    projectsModule;

  watch(lastProjectName, (v) => {
    if (typeof window !== 'undefined') {
      if (v) {
        localStorage.setItem('fastcat_last_project_name', v);
      } else {
        localStorage.removeItem('fastcat_last_project_name');
      }
    }
    if (isEphemeral.value) return;
    void batchUpdateWorkspaceState((draft) => {
      draft.ui.lastProjectName = v;
    });
  });

  watch(
    recentProjects,
    (v) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('fastcat_recent_projects', JSON.stringify(v));
      }
      if (isEphemeral.value) return;
      void batchUpdateWorkspaceState((draft) => {
        draft.ui.recentProjects = [...v];
      });
    },
    { deep: true },
  );

  watch(
    [projects, recentProjects],
    ([newProjects, newRecent]) => {
      if (!workspaceHandle.value) return;
      const projectNames = new Set(newProjects);
      const filtered = newRecent.filter((p) => projectNames.has(p.projectName));
      if (filtered.length !== newRecent.length) {
        recentProjects.value = filtered;
      }
    },
    { immediate: true, deep: true },
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

    // Limit to 5 projects
    if (recentProjects.value.length > 5) {
      recentProjects.value = recentProjects.value.slice(0, 5);
    }

    lastProjectName.value = project.projectName;
  }

  const isApiSupported = workspaceProvider.isSupported;
  const workspaceProviderId = workspaceProvider.id;

  async function setupWorkspace(handle: FileSystemDirectoryHandle) {
    workspaceHandle.value = handle;
    settingsRepo.value = createWorkspaceSettingsRepository({ vfs: useVfs() });

    const folders = [
      workspaceTopology.projectsDirName,
      workspaceTopology.commonDirName,
      workspaceTopology.tempRootDirName,
      workspaceTopology.configDirName,
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
    await loadWorkspaceStateFromDisk();
    if (workspaceState.value.ui.lastProjectName !== null) {
      lastProjectName.value = workspaceState.value.ui.lastProjectName;
    } else if (lastProjectName.value !== null) {
      workspaceState.value.ui.lastProjectName = lastProjectName.value;
    }
    if (workspaceState.value.ui.recentProjects.length > 0) {
      recentProjects.value = workspaceState.value.ui.recentProjects;
    } else if (recentProjects.value.length > 0) {
      workspaceState.value.ui.recentProjects = recentProjects.value;
    }
    await saveAppSettingsToDisk();
    await saveUserSettingsToDisk();
    await saveWorkspaceStateToDisk();
  }

  const workspaceInitModule = createWorkspaceInitModule({
    workspaceHandle,
    projectsHandle,
    settingsRepo,
    workspaceProvider,
    isLoading,
    error,
    isInitializing,
    isEphemeral,
    getVfs: () => useVfs(),
    loadProjects,
    loadAppSettingsFromDisk,
    loadWorkspaceSettingsFromDisk,
    loadUserSettingsFromDisk,
    loadWorkspaceStateFromDisk,
    saveAppSettingsToDisk,
    saveWorkspaceSettingsToDisk,
    saveUserSettingsToDisk,
    saveWorkspaceStateToDisk,
    resetSettingsState,
  });

  const { init, openWorkspace } = workspaceInitModule;

  function resetWorkspace() {
    workspaceHandle.value = null;
    projectsHandle.value = null;
    settingsRepo.value = null;
    projects.value = [];
    recentProjects.value = [];
    lastProjectName.value = null;
    error.value = null;

    if (typeof window !== 'undefined') {
      localStorage.removeItem('fastcat_last_project_name');
      localStorage.removeItem('fastcat_recent_projects');
    }

    resetSettingsState();
    resetWorkspaceState();

    workspaceProvider.clearWorkspace().catch(log.warn);

    // Reset dependent stores when workspace is closed
    const projectStore = useProjectStore();
    void projectStore.closeProject();

    // Some stores are already reset by closeProject, but we do proxy here since it's workspace-level too
    const proxyStore = useProxyStore();
    proxyStore.generatingProxies.clear();
    proxyStore.existingProxies.clear();
    proxyStore.proxyProgress.clear();
    for (const [_key, controller] of proxyStore.proxyAbortControllers.entries()) {
      controller.abort();
    }
    proxyStore.proxyAbortControllers.clear();
    proxyStore.activeWorkerPaths.clear();
  }

  async function initAutomaticWorkspace(folderName: string = 'embedded-editor') {
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
      const embeddedHandle = await root.getDirectoryHandle(folderName, { create: true });
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = (handle as any).values();
      for await (const entry of entries) {
        await handle.removeEntry(entry.name, { recursive: entry.kind === 'directory' });
      }
      resetWorkspace();
    } catch (e) {
      log.warn('Failed to wipe workspace:', e);
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
    workspaceState: skipHydrate(workspaceState),
    isSavingUserSettings,
    userSettingsSaveError,
    isSavingAppSettings,
    appSettingsSaveError,
    isSavingWorkspaceSettings,
    workspaceSettingsSaveError,
    isSavingWorkspaceState,
    workspaceStateSaveError,
    batchUpdateUserSettings,
    batchUpdateAppSettings,
    batchUpdateWorkspaceSettings,
    batchUpdateWorkspaceState,
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
    isSttModelDownloaded,
    checkSttModelStatus,
  };
});
