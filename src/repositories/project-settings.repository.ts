import type { FastCatProjectSettings } from '~/utils/project-settings';
import { createAppFsJsonStore } from './app-fs.repository';
import { projectAppFilePath, type ProjectRepositoryDeps } from './project-repository-base';

export interface ProjectSettingsRepository {
  load(): Promise<unknown | null>;
  save(data: FastCatProjectSettings): Promise<void>;
}

export function createProjectSettingsRepository(
  input: ProjectRepositoryDeps,
): ProjectSettingsRepository {
  const store = createAppFsJsonStore(input.vfs);
  const path = projectAppFilePath(input.projectPath, 'project.settings.json');

  return {
    async load() {
      return await store.readJson(path);
    },

    async save(data) {
      // Strip UI/session state from technical settings file (persisted in project.ui.json)
      const { monitor, monitors, timelines, ui, timeline, ...technicalData } =
        data as unknown as Record<string, unknown>;
      await store.writeJson(path, technicalData);
    },
  };
}
