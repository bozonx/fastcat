import {
  ensureFastCatFileHandle,
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './fastcat-fs';

export interface ProjectUiSettings {
  version: number;
  monitor: {
    previewResolution: number;
    useProxy: boolean;
    previewEffectsEnabled: boolean;
    panX: number;
    panY: number;
    zoom: number;
    showGrid: boolean;
    toolbarPosition: 'top' | 'bottom' | 'left' | 'right';
  };
  timelines: {
    openPaths: string[];
    lastOpenedPath: string | null;
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
        monitor: raw.monitor || {},
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
