import {
  ensureFastCatFileHandle,
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './fastcat-fs.repository';

import { z } from 'zod';

export const ProjectMetaSchema = z.object({
  id: z.string().trim().min(1),
  version: z.coerce.number().catch(1),
  title: z.string().catch(''),
  description: z.string().catch(''),
  author: z.string().catch(''),
  tags: z.array(z.coerce.string()).catch([]),
  createdAt: z.string().catch(() => new Date().toISOString()),
  updatedAt: z.string().catch(() => new Date().toISOString()),
  lastOpenedTimelinePath: z.string().optional(),
});

export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

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
      if (!raw) return null;

      const parsed = ProjectMetaSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn(`[ProjectMeta] Invalid project metadata`, parsed.error);
        return null;
      }
      return parsed.data;
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
