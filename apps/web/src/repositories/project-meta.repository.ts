import { createDevLogger } from '~/utils/dev-logger';
import { createAppFsJsonStore } from './app-fs.repository';
import { projectAppFilePath, type ProjectRepositoryDeps } from './project-repository-base';

import { z } from 'zod';
const log = createDevLogger('project-meta.repository');

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

export function createProjectMetaRepository(input: ProjectRepositoryDeps): ProjectMetaRepository {
  const store = createAppFsJsonStore(input.vfs);
  const path = projectAppFilePath(input.projectPath, 'project.meta.json');

  return {
    async load() {
      const raw = await store.readJson<unknown>(path);
      if (!raw) return null;

      const parsed = ProjectMetaSchema.safeParse(raw);
      if (!parsed.success) {
        log.warn(`[ProjectMeta] Invalid project metadata`, parsed.error);
        return null;
      }
      return parsed.data;
    },

    async save(data) {
      await store.writeJson(path, data);
    },
  };
}
