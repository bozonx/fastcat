import {
  ensureFastCatFileHandle,
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './fastcat-fs';

import type { MonitorSettings } from '~/utils/project-settings';

export interface ProjectUiSettings {
  version: number;
  monitors: Record<string, MonitorSettings>;
  timelines: {
    openPaths: string[];
  };
}

export interface ProjectUiRepository {
  load(): Promise<ProjectUiSettings | null>;
  save(data: ProjectUiSettings): Promise<void>;
}

export function createProjectUiRepository(input: {
  projectDir: DirectoryHandleLike;
}): ProjectUiRepository {
  return {
    async load() {
      const handle = await ensureFastCatFileHandle({
        baseDir: input.projectDir,
        filename: 'project.ui.json',
        create: false,
      });
      if (!handle) return null;
      const raw = await readJsonFromFileHandle<any>(handle);
      if (!raw) return null;

      return {
        version: Number(raw.version) || 1,
        monitors: raw.monitors || { cut: raw.monitor || {} },
        timelines: raw.timelines || {},
      } as ProjectUiSettings;
    },

    async save(data) {
      const handle = await ensureFastCatFileHandle({
        baseDir: input.projectDir,
        filename: 'project.ui.json',
        create: true,
      });
      if (!handle) return;
      await writeJsonToFileHandle({ handle, data: { ...data, version: 1 } });
    },
  };
}
