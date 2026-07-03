import type { CustomPreset, ExportSettingsPreset } from '~/utils/settings/presets';
import type { FastCatUserSettings } from '~/utils/settings';
import { createAppFsJsonStore } from './app-fs.repository';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { VfsNotFoundError } from '~/file-manager/core/vfs/errors';
import { FASTCAT_CONFIG_DIR_NAME } from '~/utils/storage-roots';
import { isTauriRuntime } from '~/utils/runtime';
import { CONFIG_PATH_PREFIX, WORKSPACE_ROOT_PATH_PREFIX } from '~/utils/workspace-common';
import { isBuiltInExportPreset } from '~/utils/settings/presets';

export const PRESET_CATEGORIES = ['effect', 'transition', 'shape', 'hud', 'text'] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

export interface PresetRepository {
  loadCustomPresets(): Promise<CustomPreset[]>;
  saveCustomPreset(preset: CustomPreset): Promise<void>;
  deleteCustomPreset(id: string, category: string): Promise<void>;
  loadExportPresets(): Promise<ExportSettingsPreset[]>;
  saveExportPreset(preset: ExportSettingsPreset): Promise<void>;
  deleteExportPreset(id: string): Promise<void>;
  migrateLegacyPresets(userSettings: FastCatUserSettings): Promise<{
    migratedCustom: CustomPreset[];
    migratedExport: ExportSettingsPreset[];
  }>;
}

export function createPresetRepository(input: {
  vfs: IFileSystemAdapter;
}): PresetRepository {
  const store = createAppFsJsonStore(input.vfs);

  function getPresetRootDir(): string {
    if (isTauriRuntime()) {
      return `${CONFIG_PATH_PREFIX}/presets`;
    }
    return `${WORKSPACE_ROOT_PATH_PREFIX}/${FASTCAT_CONFIG_DIR_NAME}/presets`;
  }

  function customPresetPath(category: string, id: string): string {
    return `${getPresetRootDir()}/custom/${category}/${id}.json`;
  }

  function exportPresetPath(id: string): string {
    return `${getPresetRootDir()}/export/${id}.json`;
  }

  async function listJsonFilesInDir(dirPath: string): Promise<string[]> {
    try {
      const entries = await input.vfs.readDirectory(dirPath);
      return entries
        .filter((e) => e.kind === 'file' && e.name.endsWith('.json'))
        .map((e) => e.path);
    } catch (err) {
      if (err instanceof VfsNotFoundError) {
        return [];
      }
      throw err;
    }
  }

  return {
    async loadCustomPresets(): Promise<CustomPreset[]> {
      const presets: CustomPreset[] = [];

      for (const category of PRESET_CATEGORIES) {
        const dir = `${getPresetRootDir()}/custom/${category}`;
        const filePaths = await listJsonFilesInDir(dir);

        for (const filePath of filePaths) {
          const item = await store.readJson<CustomPreset>(filePath);
          if (item && item.id && item.category) {
            presets.push(item);
          }
        }
      }

      return presets;
    },

    async saveCustomPreset(preset: CustomPreset): Promise<void> {
      const category = preset.category || 'effect';
      const path = customPresetPath(category, preset.id);
      await store.writeJson(path, preset);
    },

    async deleteCustomPreset(id: string, category: string): Promise<void> {
      const path = customPresetPath(category, id);
      try {
        await input.vfs.deleteEntry(path);
      } catch (err) {
        if (!(err instanceof VfsNotFoundError)) {
          throw err;
        }
      }
    },

    async loadExportPresets(): Promise<ExportSettingsPreset[]> {
      const dir = `${getPresetRootDir()}/export`;
      const filePaths = await listJsonFilesInDir(dir);
      const presets: ExportSettingsPreset[] = [];

      for (const filePath of filePaths) {
        const item = await store.readJson<ExportSettingsPreset>(filePath);
        if (item && item.id) {
          presets.push(item);
        }
      }

      return presets;
    },

    async saveExportPreset(preset: ExportSettingsPreset): Promise<void> {
      const path = exportPresetPath(preset.id);
      await store.writeJson(path, preset);
    },

    async deleteExportPreset(id: string): Promise<void> {
      const path = exportPresetPath(id);
      try {
        await input.vfs.deleteEntry(path);
      } catch (err) {
        if (!(err instanceof VfsNotFoundError)) {
          throw err;
        }
      }
    },

    async migrateLegacyPresets(
      userSettings: FastCatUserSettings,
    ): Promise<{
      migratedCustom: CustomPreset[];
      migratedExport: ExportSettingsPreset[];
    }> {
      const migratedCustom: CustomPreset[] = [];
      const migratedExport: ExportSettingsPreset[] = [];

      // 1. Migrate custom clip presets from userSettings.presets.custom
      const rawCustom = userSettings?.presets?.custom;
      if (Array.isArray(rawCustom) && rawCustom.length > 0) {
        for (const preset of rawCustom) {
          if (preset && preset.id && preset.category) {
            await store.writeJson(customPresetPath(preset.category, preset.id), preset);
            migratedCustom.push(preset);
          }
        }
      }

      // 2. Migrate custom export presets from userSettings.exportPresets.items
      const rawExportItems = userSettings?.exportPresets?.items;
      if (Array.isArray(rawExportItems) && rawExportItems.length > 0) {
        for (const preset of rawExportItems) {
          if (preset && preset.id && !isBuiltInExportPreset(preset)) {
            await store.writeJson(exportPresetPath(preset.id), preset);
            migratedExport.push(preset);
          }
        }
      }

      return { migratedCustom, migratedExport };
    },
  };
}
