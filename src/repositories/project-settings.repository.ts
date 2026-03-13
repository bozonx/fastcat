import type { FastCatProjectSettings } from '~/utils/project-settings';
import {
  ensureFastCatFileHandle,
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './fastcat-fs';

export interface ProjectSettingsRepository {
  load(): Promise<unknown | null>;
  save(data: FastCatProjectSettings): Promise<void>;
}

export function createProjectSettingsRepository(input: {
  projectDir: DirectoryHandleLike;
}): ProjectSettingsRepository {
  return {
    async load() {
      const handle = await ensureFastCatFileHandle({
        baseDir: input.projectDir,
        filename: 'project.settings.json',
        create: false,
      });
      if (!handle) return null;
      return await readJsonFromFileHandle(handle);
    },

    async save(data) {
      const handle = await ensureFastCatFileHandle({
        baseDir: input.projectDir,
        filename: 'project.settings.json',
        create: true,
      });
      if (!handle) return;
      await writeJsonToFileHandle({ handle, data });
    },
  };
}
