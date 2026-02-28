import type {
  GranVideoEditorUserSettings,
  GranVideoEditorWorkspaceSettings,
} from '~/utils/settings';
import {
  ensureGranFileHandle,
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './gran-fs';

export interface WorkspaceSettingsRepository {
  loadUserSettings(): Promise<unknown | null>;
  saveUserSettings(data: GranVideoEditorUserSettings): Promise<void>;
  loadWorkspaceSettings(): Promise<unknown | null>;
  saveWorkspaceSettings(data: GranVideoEditorWorkspaceSettings): Promise<void>;
}

export function createWorkspaceSettingsRepository(input: {
  workspaceDir: DirectoryHandleLike;
}): WorkspaceSettingsRepository {
  return {
    async loadUserSettings() {
      const handle = await ensureGranFileHandle({
        baseDir: input.workspaceDir,
        filename: 'user.settings.json',
        create: false,
      });
      if (!handle) return null;
      return await readJsonFromFileHandle(handle);
    },

    async saveUserSettings(data) {
      const handle = await ensureGranFileHandle({
        baseDir: input.workspaceDir,
        filename: 'user.settings.json',
        create: true,
      });
      if (!handle) return;
      await writeJsonToFileHandle({ handle, data });
    },

    async loadWorkspaceSettings() {
      const handle = await ensureGranFileHandle({
        baseDir: input.workspaceDir,
        filename: 'workspace.settings.json',
        create: false,
      });
      if (!handle) return null;
      return await readJsonFromFileHandle(handle);
    },

    async saveWorkspaceSettings(data) {
      const handle = await ensureGranFileHandle({
        baseDir: input.workspaceDir,
        filename: 'workspace.settings.json',
        create: true,
      });
      if (!handle) return;
      await writeJsonToFileHandle({ handle, data });
    },
  };
}
