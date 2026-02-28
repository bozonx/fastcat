import type { GranVideoEditorProjectSettings } from '~/utils/project-settings';
import {
  ensureGranFileHandle,
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './gran-fs';

export interface ProjectSettingsRepository {
  load(): Promise<unknown | null>;
  save(data: GranVideoEditorProjectSettings): Promise<void>;
}

export function createProjectSettingsRepository(input: {
  projectDir: DirectoryHandleLike;
}): ProjectSettingsRepository {
  return {
    async load() {
      const handle = await ensureGranFileHandle({
        baseDir: input.projectDir,
        filename: 'project.settings.json',
        create: false,
      });
      if (!handle) return null;
      return await readJsonFromFileHandle(handle);
    },

    async save(data) {
      const handle = await ensureGranFileHandle({
        baseDir: input.projectDir,
        filename: 'project.settings.json',
        create: true,
      });
      if (!handle) return;
      await writeJsonToFileHandle({ handle, data });
    },
  };
}
