import {
  ensureGranFileHandle,
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './gran-fs';

export interface ProjectMeta {
  id: string;
}

export interface ProjectMetaRepository {
  load(): Promise<ProjectMeta | null>;
  save(data: ProjectMeta): Promise<void>;
}

export function createProjectMetaRepository(input: {
  projectDir: DirectoryHandleLike;
}): ProjectMetaRepository {
  return {
    async load() {
      const handle = await ensureGranFileHandle({
        baseDir: input.projectDir,
        filename: 'project.meta.json',
        create: false,
      });
      if (!handle) return null;
      const raw = await readJsonFromFileHandle<ProjectMeta>(handle);
      if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
      return { id: raw.id };
    },

    async save(data) {
      const handle = await ensureGranFileHandle({
        baseDir: input.projectDir,
        filename: 'project.meta.json',
        create: true,
      });
      if (!handle) return;
      await writeJsonToFileHandle({ handle, data });
    },
  };
}
