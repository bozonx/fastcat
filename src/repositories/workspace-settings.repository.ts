import type {
  FastCatAppSettings,
  FastCatUserSettings,
  FastCatWorkspaceSettings,
} from '~/utils/settings';
import {
  ensureFastCatFileHandle,
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './fastcat-fs';
import { FASTCAT_CONFIG_DIR_NAME, LEGACY_WORKSPACE_CONFIG_DIR_NAME } from '~/utils/storage-roots';

export interface WorkspaceSettingsRepository {
  loadUserSettings(): Promise<unknown | null>;
  saveUserSettings(data: FastCatUserSettings): Promise<void>;
  loadAppSettings(): Promise<unknown | null>;
  saveAppSettings(data: FastCatAppSettings): Promise<void>;
  loadWorkspaceSettings(): Promise<unknown | null>;
  saveWorkspaceSettings(data: FastCatWorkspaceSettings): Promise<void>;
}

async function readWorkspaceJson(input: {
  workspaceDir: DirectoryHandleLike;
  filename: string;
  folderName: string;
}): Promise<unknown | null> {
  const handle = await ensureFastCatFileHandle({
    baseDir: input.workspaceDir,
    filename: input.filename,
    create: false,
    folderName: input.folderName,
  });
  if (!handle) return null;
  return await readJsonFromFileHandle(handle);
}

async function writeWorkspaceJson(input: {
  workspaceDir: DirectoryHandleLike;
  filename: string;
  folderName: string;
  data: unknown;
}): Promise<void> {
  const handle = await ensureFastCatFileHandle({
    baseDir: input.workspaceDir,
    filename: input.filename,
    create: true,
    folderName: input.folderName,
  });
  if (!handle) return;
  await writeJsonToFileHandle({ handle, data: input.data });
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function readTauriConfigJson(filename: string): Promise<unknown | null> {
  const { BaseDirectory, exists, readTextFile } = await import('@tauri-apps/plugin-fs');
  const fileExists = await exists(filename, { baseDir: BaseDirectory.AppConfig });
  if (!fileExists) return null;
  const text = await readTextFile(filename, { baseDir: BaseDirectory.AppConfig });
  const trimmed = text.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as unknown;
}

async function writeTauriConfigJson(filename: string, data: unknown): Promise<void> {
  const { BaseDirectory, writeTextFile } = await import('@tauri-apps/plugin-fs');
  await writeTextFile(filename, `${JSON.stringify(data, null, 2)}\n`, {
    baseDir: BaseDirectory.AppConfig,
  });
}

export function createWorkspaceSettingsRepository(input: {
  workspaceDir: DirectoryHandleLike;
}): WorkspaceSettingsRepository {
  async function loadSettings(filename: string, legacyFilename?: string): Promise<unknown | null> {
    if (isTauriRuntime()) {
      return await readTauriConfigJson(filename);
    }

    const currentConfig = await readWorkspaceJson({
      workspaceDir: input.workspaceDir,
      filename,
      folderName: FASTCAT_CONFIG_DIR_NAME,
    });
    if (currentConfig) return currentConfig;

    if (legacyFilename) {
      return await readWorkspaceJson({
        workspaceDir: input.workspaceDir,
        filename: legacyFilename,
        folderName: LEGACY_WORKSPACE_CONFIG_DIR_NAME,
      });
    }

    return null;
  }

  async function saveSettings(filename: string, data: unknown): Promise<void> {
    if (isTauriRuntime()) {
      await writeTauriConfigJson(filename, data);
      return;
    }

    await writeWorkspaceJson({
      workspaceDir: input.workspaceDir,
      filename,
      folderName: FASTCAT_CONFIG_DIR_NAME,
      data,
    });
  }

  return {
    async loadUserSettings() {
      return await loadSettings('user.settings.json', 'user.settings.json');
    },

    async saveUserSettings(data) {
      await saveSettings('user.settings.json', data);
    },

    async loadAppSettings() {
      return await loadSettings('app.settings.json', 'workspace.settings.json');
    },

    async saveAppSettings(data) {
      await saveSettings('app.settings.json', data);
    },

    async loadWorkspaceSettings() {
      return await this.loadAppSettings();
    },

    async saveWorkspaceSettings(data) {
      await this.saveAppSettings(data);
    },
  };
}
