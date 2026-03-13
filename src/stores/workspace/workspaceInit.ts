import type { Ref } from 'vue';

import { createWorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';
import type { WorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';
import { getWorkspaceStorageTopology } from '~/utils/storage-roots';
import type { WorkspaceProvider } from './provider';

export interface WorkspaceInitDeps {
  workspaceHandle: Ref<FileSystemDirectoryHandle | null>;
  projectsHandle: Ref<FileSystemDirectoryHandle | null>;
  settingsRepo: Ref<WorkspaceSettingsRepository | null>;
  workspaceProvider: WorkspaceProvider;
  isLoading: Ref<boolean>;
  error: Ref<string | null>;
  isInitializing: Ref<boolean>;

  loadProjects: () => Promise<void>;
  loadAppSettingsFromDisk: () => Promise<void>;
  loadWorkspaceSettingsFromDisk: () => Promise<void>;
  loadUserSettingsFromDisk: () => Promise<void>;
  saveAppSettingsToDisk: () => Promise<void>;
  saveWorkspaceSettingsToDisk: () => Promise<void>;
  saveUserSettingsToDisk: () => Promise<void>;
  resetSettingsState: () => void;
}

export interface WorkspaceInitApi {
  init: () => Promise<void>;
  openWorkspace: () => Promise<void>;
  resetWorkspace: () => void;
  setupWorkspace: (handle: FileSystemDirectoryHandle) => Promise<void>;
}

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

export function createWorkspaceInitModule(deps: WorkspaceInitDeps): WorkspaceInitApi {
  let isOpeningWorkspace = false;
  const workspaceTopology = getWorkspaceStorageTopology();

  async function setupWorkspace(handle: FileSystemDirectoryHandle) {
    deps.workspaceHandle.value = handle;
    deps.settingsRepo.value = createWorkspaceSettingsRepository({ workspaceDir: handle });

    const folders = [workspaceTopology.projectsDirName, workspaceTopology.tempRootDirName];
    for (const folder of folders) {
      if (folder === workspaceTopology.projectsDirName) {
        deps.projectsHandle.value = await handle.getDirectoryHandle(folder, { create: true });
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

    await deps.loadProjects();
    await deps.loadAppSettingsFromDisk();
    await deps.loadUserSettingsFromDisk();
    await deps.saveAppSettingsToDisk();
    await deps.saveUserSettingsToDisk();
  }

  async function openWorkspace() {
    if (!deps.workspaceProvider.isSupported) return;
    if (isOpeningWorkspace || deps.isLoading.value) return;

    deps.error.value = null;
    isOpeningWorkspace = true;
    deps.isLoading.value = true;
    try {
      const handle = await deps.workspaceProvider.openWorkspace();
      if (!handle) return;
      await setupWorkspace(handle as unknown as FileSystemDirectoryHandle);
    } catch (e: unknown) {
      if (!isAbortError(e)) {
        deps.error.value = getErrorMessage(e, 'Failed to open workspace folder');
      }
    } finally {
      isOpeningWorkspace = false;
      deps.isLoading.value = false;
    }
  }

  function resetWorkspace() {
    deps.workspaceHandle.value = null;
    deps.projectsHandle.value = null;
    deps.settingsRepo.value = null;
    deps.error.value = null;

    deps.resetSettingsState();
    deps.workspaceProvider.clearWorkspace().catch(console.warn);
  }

  async function init() {
    if (!deps.workspaceProvider.isSupported) {
      deps.isInitializing.value = false;
      return;
    }

    try {
      const handle = await deps.workspaceProvider.restoreWorkspace();
      if (!handle) {
        deps.isInitializing.value = false;
        return;
      }

      await setupWorkspace(handle as unknown as FileSystemDirectoryHandle);
    } catch (e) {
      console.warn('Failed to restore workspace handle:', e);
    } finally {
      deps.isInitializing.value = false;
    }
  }

  return {
    init,
    openWorkspace,
    resetWorkspace,
    setupWorkspace,
  };
}
