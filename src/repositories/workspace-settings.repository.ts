import type {
  FastCatAppSettings,
  FastCatUserSettings,
  FastCatWorkspaceSettings,
} from '~/utils/settings';
import type { WorkspaceState } from '~/utils/workspace-state';
import { createAppFsJsonStore } from './app-fs.repository';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { FASTCAT_CONFIG_DIR_NAME } from '~/utils/storage-roots';
import { isTauriRuntime } from '~/utils/runtime';
import { CONFIG_PATH_PREFIX, WORKSPACE_ROOT_PATH_PREFIX } from '~/utils/workspace-common';

export interface WorkspaceSettingsRepository {
  loadUserSettings(): Promise<unknown | null>;
  saveUserSettings(data: FastCatUserSettings): Promise<void>;
  loadAppSettings(): Promise<unknown | null>;
  saveAppSettings(data: FastCatAppSettings): Promise<void>;
  loadWorkspaceSettings(): Promise<unknown | null>;
  saveWorkspaceSettings(data: FastCatWorkspaceSettings): Promise<void>;
  loadWorkspaceState(): Promise<WorkspaceState | null>;
  saveWorkspaceState(data: WorkspaceState): Promise<void>;
}

export function createWorkspaceSettingsRepository(input: {
  vfs: IFileSystemAdapter;
}): WorkspaceSettingsRepository {
  const store = createAppFsJsonStore(input.vfs);

  /**
   * Resolve the VFS path for a settings file.
   *
   * Global user/app settings on Tauri live in the OS config dir (`@config`);
   * everything else (workspace settings, workspace-state, and — in the browser —
   * user/app settings too) lives in the workspace's `.fastcat-config` dir.
   */
  function settingsPath(filename: string, isGlobal: boolean): string {
    const isAppOrUserSettings =
      filename === 'user.settings.json' || filename === 'app.settings.json';
    if (isTauriRuntime()) {
      if (isGlobal && isAppOrUserSettings) {
        return `${CONFIG_PATH_PREFIX}/${filename}`;
      }
      return `/vardata/${filename}`;
    }
    return `${WORKSPACE_ROOT_PATH_PREFIX}/${FASTCAT_CONFIG_DIR_NAME}/${filename}`;
  }

  function loadSettings(filename: string, isGlobal: boolean): Promise<unknown | null> {
    return store.readJson(settingsPath(filename, isGlobal));
  }

  function saveSettings(filename: string, isGlobal: boolean, data: unknown): Promise<void> {
    return store.writeJson(settingsPath(filename, isGlobal), data);
  }

  return {
    async loadUserSettings() {
      return await loadSettings('user.settings.json', true);
    },

    async saveUserSettings(data) {
      await saveSettings('user.settings.json', true, data);
    },

    async loadAppSettings() {
      return await loadSettings('app.settings.json', true);
    },

    async saveAppSettings(data) {
      await saveSettings('app.settings.json', true, data);
    },

    async loadWorkspaceSettings() {
      return await loadSettings('app.settings.json', false);
    },

    async saveWorkspaceSettings(data) {
      await saveSettings('app.settings.json', false, data);
    },
    async loadWorkspaceState() {
      return (await loadSettings('workspace-state.json', false)) as WorkspaceState | null;
    },
    async saveWorkspaceState(data) {
      await saveSettings('workspace-state.json', false, data);
    },
  };
}
