import {
  ensureFastCatFileHandle,
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './fastcat-fs';

export interface ProjectMeta {
  id: string;
  version: number;
  title: string;
  description: string;
  author: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastOpenedTimelinePath?: string;
}

export interface ProjectMetaRepository {
  load(): Promise<ProjectMeta | null>;
  save(data: Partial<ProjectMeta> & { id: string }): Promise<void>;
}

export function createProjectMetaRepository(input: {
  projectDir: DirectoryHandleLike;
}): ProjectMetaRepository {
  return {
    async load() {
      const handle = await ensureFastCatFileHandle({
        baseDir: input.projectDir,
        filename: 'project.meta.json',
        create: false,
      });
      if (!handle) return null;
      const raw = await readJsonFromFileHandle<any>(handle);
      if (!raw || typeof raw.id !== 'string' || !raw.id) return null;

      return {
        id: raw.id,
        version: Number(raw.version) || 1,
        title: String(raw.title || ''),
        description: String(raw.description || ''),
        author: String(raw.author || ''),
        tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
        createdAt: String(raw.createdAt || new Date().toISOString()),
        updatedAt: String(raw.updatedAt || new Date().toISOString()),
        lastOpenedTimelinePath: raw.lastOpenedTimelinePath ? String(raw.lastOpenedTimelinePath) : undefined,
      };
    },

    async save(data) {
      const handle = await ensureFastCatFileHandle({
        baseDir: input.projectDir,
        filename: 'project.meta.json',
        create: true,
      });
      if (!handle) return;
      
      // If we are updating, we should probably load existing first or assume data is complete
      // For now, let's just write what we have, but store/module should handle merging
      await writeJsonToFileHandle({ handle, data });
    },
  };
}
