import { defineStore, skipHydrate } from 'pinia';
import { ref, watch } from 'vue';
import { VARDATA_DIR_NAME, VARDATA_PROJECTS_DIR_NAME } from '~/utils/vardata-paths';
import {
  createWorkspaceSettingsRepository,
  type WorkspaceSettingsRepository,
} from '~/repositories/workspace-settings.repository';
import {
  createIndexedDbWorkspaceHandleStorage,
  type WorkspaceHandleStorage,
} from '~/repositories/workspace-handle.repository';

import { createWorkspaceSettingsModule } from '~/stores/workspace/workspaceSettings';
import { createWorkspaceProjectsModule } from '~/stores/workspace/workspaceProjects';

import { useProjectStore } from './project.store';
import { useMediaStore } from './media.store';
import { useTimelineStore } from './timeline.store';
import { useSelectionStore } from './selection.store';
import { useFilesPageStore } from './filesPage.store';
import { useHistoryStore } from './history.store';
import { useProxyStore } from './proxy.store';

function getErrorMessage(e: unknown, fallback: string): string {
  if (!e || typeof e !== 'object') return fallback;
  if (!('message' in e)) return fallback;
  const msg = (e as { message?: unknown }).message;
  return typeof msg === 'string' && msg.length > 0 ? msg : fallback;
}

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  if (!('name' in e)) return false;
  return (e as { name?: unknown }).name === 'AbortError';
}

function readLocalStorageString(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaceHandle = ref<FileSystemDirectoryHandle | null>(null);
  const projectsHandle = ref<FileSystemDirectoryHandle | null>(null);
  const settingsRepo = ref<WorkspaceSettingsRepository | null>(null);
  const workspaceHandleStorage = ref<WorkspaceHandleStorage<FileSystemDirectoryHandle> | null>(
    typeof window === 'undefined'
      ? null
      : window.indexedDB
        ? createIndexedDbWorkspaceHandleStorage({ indexedDB: window.indexedDB })
        : null,
  );

  const projects = ref<string[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const isInitializing = ref(true);
  const lastProjectName = ref<string | null>(readLocalStorageString('gran-editor-last-project'));

  const settingsModule = createWorkspaceSettingsModule({ settingsRepo });
  const {
    userSettings,
    workspaceSettings,
    isSavingUserSettings,
    userSettingsSaveError,
    isSavingWorkspaceSettings,
    workspaceSettingsSaveError,
    batchUpdateUserSettings,
    batchUpdateWorkspaceSettings,
    loadWorkspaceSettingsFromDisk,
    loadUserSettingsFromDisk,
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
  const { loadProjects, clearVardata, clearProjectVardata, deleteProject } = projectsModule;

  watch(lastProjectName, (v) => {
    if (typeof window === 'undefined') return;
    try {
      if (v === null) window.localStorage.removeItem('gran-editor-last-project');
      else window.localStorage.setItem('gran-editor-last-project', v);
    } catch {
      // ignore
    }
  });

  const isApiSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  async function setupWorkspace(handle: FileSystemDirectoryHandle) {
    workspaceHandle.value = handle;
    settingsRepo.value = createWorkspaceSettingsRepository({ workspaceDir: handle });

    const folders = ['projects', VARDATA_DIR_NAME];
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
    await loadWorkspaceSettingsFromDisk();
    await loadUserSettingsFromDisk();
    await saveWorkspaceSettingsToDisk();
    await saveUserSettingsToDisk();
  }

  async function openWorkspace() {
    if (!isApiSupported) return;

    error.value = null;
    isLoading.value = true;
    try {
      const picker = (
        window as unknown as {
          showDirectoryPicker?: (options: {
            mode: 'readwrite' | 'readonly';
          }) => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker;
      if (!picker) return;
      const handle = await picker({ mode: 'readwrite' });
      await setupWorkspace(handle);
      await workspaceHandleStorage.value?.set(handle);
    } catch (e: unknown) {
      if (!isAbortError(e)) {
        error.value = getErrorMessage(e, 'Failed to open workspace folder');
      }
    } finally {
      isLoading.value = false;
    }
  }

  function resetWorkspace() {
    workspaceHandle.value = null;
    projectsHandle.value = null;
    settingsRepo.value = null;
    projects.value = [];
    error.value = null;

    resetSettingsState();

    workspaceHandleStorage.value?.clear().catch(console.warn);

    // Reset dependent stores when workspace is closed
    const projectStore = useProjectStore();
    projectStore.closeProject();

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

  async function init() {
    if (!isApiSupported) {
      isInitializing.value = false;
      return;
    }

    try {
      const handle = await workspaceHandleStorage.value?.get();
      if (!handle) {
        isInitializing.value = false;
        return;
      }

      const handleWithPerm = handle as unknown as {
        queryPermission?: (options: {
          mode: 'readwrite' | 'readonly';
        }) => Promise<'granted' | 'denied' | 'prompt'>;
      };
      const options = { mode: 'readwrite' as const };
      if ((await handleWithPerm.queryPermission?.(options)) === 'granted') {
        await setupWorkspace(handle);
      }
    } catch (e) {
      console.warn('Failed to restore workspace handle:', e);
    } finally {
      isInitializing.value = false;
    }
  }

  return {
    workspaceHandle,
    projectsHandle,
    projects,
    isLoading,
    error,
    isApiSupported,
    lastProjectName: skipHydrate(lastProjectName),
    userSettings: skipHydrate(userSettings),
    workspaceSettings: skipHydrate(workspaceSettings),
    isSavingUserSettings,
    userSettingsSaveError,
    isSavingWorkspaceSettings,
    workspaceSettingsSaveError,
    batchUpdateUserSettings,
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
  };
});
