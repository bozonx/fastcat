import {
  ensureFastCatFileHandle,
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './fastcat-fs';

import type { MonitorSettings } from '~/utils/project-settings';

import { z } from 'zod';

const MonitorSettingsSchema = z.object({
  previewResolution: z.coerce.number().int().min(1).max(4320).catch(480),
  useProxy: z.coerce.boolean().catch(true),
  previewEffectsEnabled: z.coerce.boolean().catch(true),
  panX: z.coerce.number().catch(0),
  panY: z.coerce.number().catch(0),
  zoom: z.coerce.number().min(0.05).max(20).catch(1),
  showGrid: z.coerce.boolean().catch(false),
  toolbarPosition: z.enum(['top', 'bottom', 'left', 'right']).catch('bottom'),
});

export const ProjectUiSettingsSchema = z.object({
  version: z.coerce.number().catch(1),
  monitors: z.record(z.string(), MonitorSettingsSchema).catch({}),
  timelines: z.object({
    openPaths: z.array(z.string()).catch([]),
  }).catch({ openPaths: [] }),
});

export type ProjectUiSettings = z.infer<typeof ProjectUiSettingsSchema>;

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

      const parsed = ProjectUiSettingsSchema.safeParse({
        ...raw,
        monitors: raw.monitors || { cut: raw.monitor || {} },
      });

      if (!parsed.success) {
         console.warn(`[ProjectUi] Invalid UI settings`, parsed.error);
         return null;
      }
      return parsed.data;
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
