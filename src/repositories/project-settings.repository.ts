import type { FastCatProjectSettings } from '~/utils/project-settings';
import {
  ensureFastCatFileHandle,
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './fastcat-fs.repository';

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

      // Strip UI session state from technical settings file (persisted in project.ui.json)
      const { monitors, timelines, ...technicalData } = data as any;
      await writeJsonToFileHandle({ handle, data: technicalData });
    },
  };
}
