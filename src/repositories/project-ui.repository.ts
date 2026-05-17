import {
  ensureAppFileHandle,
  readJsonFromFileHandle,
  writeJsonToFileHandle,
  type DirectoryHandleLike,
} from './app-fs.repository';

import type { MonitorSettings } from '~/utils/project-settings';

import { z } from 'zod';

const MonitorSettingsSchema = z.object({
  previewResolution: z.coerce.number().min(0.01).max(4320).catch(0.5),
  useProxy: z.coerce.boolean().catch(true),
  previewEffectsEnabled: z.coerce.boolean().catch(true),
  panX: z.coerce.number().catch(0),
  panY: z.coerce.number().catch(0),
  zoom: z.coerce.number().min(0.05).max(20).catch(1),
  showGrid: z.coerce.boolean().catch(false),
  showTimecode: z.coerce.boolean().catch(true),
  toolbarPosition: z.enum(['top', 'bottom', 'left', 'right']).catch('bottom'),
});

const TimelineSessionSchema = z.object({
  playheadUs: z.coerce.number().catch(0),
  masterGain: z.coerce.number().catch(1),
  masterMuted: z.coerce.boolean().catch(false),
  zoom: z.coerce.number().catch(1),
  trackHeights: z.record(z.string(), z.coerce.number()).catch({}),
  selectionRange: z
    .object({
      startUs: z.number(),
      endUs: z.number(),
    })
    .optional()
    .catch(undefined),
});

const ProjectFileTabSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  fileName: z.string(),
  mediaType: z.enum(['video', 'audio', 'image', 'text', 'unknown']).nullable().catch(null),
  icon: z.string(),
});

const DynamicPanelSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    title: z.string().optional(),
    filePath: z.string().optional(),
    mediaType: z.string().nullable().optional(),
  })
  .passthrough();

const PanelColumnSchema = z.object({
  id: z.string(),
  panels: z.array(DynamicPanelSchema).catch([]),
});

const ProjectUiLayoutSchema = z.object({
  cutPanels: z.array(PanelColumnSchema).nullable().catch(null),
  soundPanels: z.array(PanelColumnSchema).nullable().catch(null),
  splitSizes: z.record(z.string(), z.array(z.coerce.number())).catch({}),
  verticalSplitSizes: z
    .record(z.string(), z.record(z.string(), z.array(z.coerce.number())))
    .catch({}),
  timelineHeights: z.record(z.string(), z.coerce.number()).catch({}),
});

export const ProjectUiSettingsSchema = z.object({
  version: z.coerce.number().catch(1),
  monitors: z.record(z.string(), MonitorSettingsSchema).catch({}),
  timelines: z
    .object({
      openPaths: z.array(z.string()).catch([]),
      sessions: z.record(z.string(), TimelineSessionSchema).catch({}),
    })
    .catch({ openPaths: [], sessions: {} }),
  timeline: z
    .object({
      frameSnapMode: z.enum(['free', 'frames']).catch('frames'),
      clipSnapMode: z.enum(['none', 'clips']).catch('clips'),
      toolbarSnapMode: z.enum(['snap', 'no_snap', 'free_mode']).catch('snap'),
      toolbarDragMode: z.enum(['pseudo_overlap', 'copy', 'slip']).catch('pseudo_overlap'),
      toolbarDragModeEnabled: z.boolean().catch(false),
    })
    .optional(),
  ui: z
    .object({
      activeTabId: z.string().nullable().catch(null),
      fileTabs: z.array(ProjectFileTabSchema).catch([]),
      staticTabsOrder: z.array(z.string()).catch([]),
      fileManagerPaths: z.record(z.string(), z.string().nullable()).catch({}),
      fileTreeExpandedPaths: z.array(z.string()).catch([]),
      layout: ProjectUiLayoutSchema.catch({
        cutPanels: null,
        soundPanels: null,
        splitSizes: {},
        verticalSplitSizes: {},
        timelineHeights: {},
      }),
    })
    .catch({
      activeTabId: null,
      fileTabs: [],
      staticTabsOrder: [],
      fileManagerPaths: {},
      fileTreeExpandedPaths: [],
      layout: {
        cutPanels: null,
        soundPanels: null,
        splitSizes: {},
        verticalSplitSizes: {},
        timelineHeights: {},
      },
    }),
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
      const handle = await ensureAppFileHandle({
        baseDir: input.projectDir,
        filename: 'project.ui.json',
        create: false,
      });
      if (!handle) return null;
      const raw = await readJsonFromFileHandle<any>(handle);
      if (!raw) return null;

      const parsed = ProjectUiSettingsSchema.safeParse({
        ...raw,
        monitors: raw.monitors ?? {},
      });

      if (!parsed.success) {
        console.warn(`[ProjectUi] Invalid UI settings`, parsed.error);
        return null;
      }
      return parsed.data;
    },

    async save(data) {
      const handle = await ensureAppFileHandle({
        baseDir: input.projectDir,
        filename: 'project.ui.json',
        create: true,
      });
      if (!handle) return;
      await writeJsonToFileHandle({ handle, data: { ...data, version: 1 } });
    },
  };
}
