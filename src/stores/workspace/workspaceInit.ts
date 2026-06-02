import { createDevLogger } from '~/utils/dev-logger';
import type { Ref } from 'vue';

import { createWorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';
import type { WorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { getErrorMessage, isAbortError } from '~/utils/errors';
import { getWorkspaceStorageTopology } from '~/utils/storage-roots';
import type { WorkspaceProvider } from './provider';
const log = createDevLogger('workspaceInit');

export interface WorkspaceInitDeps {
  workspaceHandle: Ref<FileSystemDirectoryHandle | null>;
  projectsHandle: Ref<FileSystemDirectoryHandle | null>;
  settingsRepo: Ref<WorkspaceSettingsRepository | null>;
  workspaceProvider: WorkspaceProvider;
  isLoading: Ref<boolean>;
  error: Ref<string | null>;
  isInitializing: Ref<boolean>;
  isEphemeral: Ref<boolean>;
  getVfs: () => IFileSystemAdapter;

  loadProjects: () => Promise<void>;
  loadAppSettingsFromDisk: () => Promise<void>;
  loadWorkspaceSettingsFromDisk: () => Promise<void>;
  loadUserSettingsFromDisk: () => Promise<void>;
  loadWorkspaceStateFromDisk: () => Promise<void>;
  saveAppSettingsToDisk: () => Promise<void>;
  saveWorkspaceSettingsToDisk: () => Promise<void>;
  saveUserSettingsToDisk: () => Promise<void>;
  saveWorkspaceStateToDisk: () => Promise<void>;
  resetSettingsState: () => void;
}

export interface WorkspaceInitApi {
  init: () => Promise<void>;
  openWorkspace: () => Promise<void>;
  resetWorkspace: () => void;
  setupWorkspace: (handle: FileSystemDirectoryHandle) => Promise<void>;
}

export function createWorkspaceInitModule(deps: WorkspaceInitDeps): WorkspaceInitApi {
  let isOpeningWorkspace = false;
  const workspaceTopology = getWorkspaceStorageTopology();

  async function ensureTauriDirectories() {
    try {
      const { resolveTauriAppPaths } = await import('~/utils/tauri-paths');
      const { join } = await import('@tauri-apps/api/path');
      const { mkdir, exists } = await import('@tauri-apps/plugin-fs');
      
      const runtimeConfig = useRuntimeConfig();
      const fastcatDevDir = runtimeConfig.public.fastcatDevDir as string | undefined;
      const appPaths = await resolveTauriAppPaths(fastcatDevDir);
      if (appPaths) {
        const fastcatDocsDir = await join(appPaths.documentsDir, 'FastCat');
        const commonDir = await join(fastcatDocsDir, 'common');
        const projectsDir = await join(fastcatDocsDir, 'projects');
        
        if (!(await exists(commonDir))) {
          await mkdir(commonDir, { recursive: true });
        }
        if (!(await exists(projectsDir))) {
          await mkdir(projectsDir, { recursive: true });
        }
      }
    } catch (e) {
      log.warn('Failed to ensure default Tauri directories', e);
    }
  }

  async function setupWorkspace(handle: FileSystemDirectoryHandle) {
    deps.workspaceHandle.value = handle;
    deps.settingsRepo.value = createWorkspaceSettingsRepository({ vfs: deps.getVfs() });

    const folders = [
      workspaceTopology.projectsDirName,
      workspaceTopology.commonDirName,
      workspaceTopology.tempRootDirName,
    ];
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
    } catch (e) {
      // Non-fatal: temp dirs are recreated lazily, but a failure here usually
      // signals a permissions/quota problem worth seeing in logs.
      log.warn('Failed to ensure temp directories during workspace init', e);
    }

    await deps.loadProjects();
    await deps.loadAppSettingsFromDisk();
    await deps.loadUserSettingsFromDisk();
    await deps.loadWorkspaceStateFromDisk();
    await deps.saveAppSettingsToDisk();
    await deps.saveUserSettingsToDisk();
    await deps.saveWorkspaceStateToDisk();
  }

  async function openWorkspace() {
    if (deps.workspaceProvider.id === 'tauri') {
      return;
    }
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
    if (deps.workspaceProvider.id !== 'tauri') {
      deps.workspaceProvider.clearWorkspace().catch(log.warn);
    }
  }

  async function init() {
    if (deps.isEphemeral.value) {
      deps.isInitializing.value = false;
      return;
    }

    if (!deps.workspaceProvider.isSupported) {
      deps.isInitializing.value = false;
      return;
    }

    try {
      if (deps.workspaceProvider.id === 'tauri') {
        await ensureTauriDirectories();
        const handle = await deps.workspaceProvider.restoreWorkspace();
        if (handle) {
          await setupWorkspace(handle as unknown as FileSystemDirectoryHandle);
        } else {
          deps.settingsRepo.value = createWorkspaceSettingsRepository({ vfs: deps.getVfs() });
          await deps.loadAppSettingsFromDisk();
          await deps.loadUserSettingsFromDisk();
          await deps.loadWorkspaceStateFromDisk();
        }
      } else {
        const handle = await deps.workspaceProvider.restoreWorkspace();
        if (!handle) {
          deps.isInitializing.value = false;
          return;
        }

        await setupWorkspace(handle as unknown as FileSystemDirectoryHandle);
      }
    } catch (e) {
      log.warn('Failed to restore workspace handle:', e);
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
