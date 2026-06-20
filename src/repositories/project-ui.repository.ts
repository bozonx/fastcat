import { createDevLogger } from '~/utils/dev-logger';
import { createAppFsJsonStore } from './app-fs.repository';
import { projectAppFilePath, type ProjectRepositoryDeps } from './project-repository-base';

import { z } from 'zod';
const log = createDevLogger('project-ui.repository');

// Per-view monitor (pan/zoom). Allows passthrough of legacy fields so they can
// be migrated upward into the project-wide block by `normalizeProjectSettings`.
const MonitorViewSchema = z
  .object({
    panX: z.coerce.number().catch(0),
    panY: z.coerce.number().catch(0),
    zoom: z.coerce.number().min(0.05).max(20).catch(1),
  })
  .passthrough();

const ProjectMonitorSchema = z.object({
  previewResolution: z.coerce.number().min(0.01).max(4320).catch(0.5),
  useProxy: z.coerce.boolean().catch(true),
  previewEffectsEnabled: z.coerce.boolean().catch(true),
  showGrid: z.coerce.boolean().catch(false),
  showTimecode: z.coerce.boolean().catch(true),
  toolbarPosition: z.enum(['top', 'bottom', 'left', 'right']).catch('bottom'),
  previewBlurQuality: z.enum(['low', 'medium', 'high', 'ultra', 'auto']).catch('auto'),
});

const TimelineSessionSchema = z.object({
  playheadUs: z.coerce.number().catch(0),
  masterGain: z.coerce.number().catch(1),
  masterMuted: z.coerce.boolean().catch(false),
  zoom: z.coerce.number().catch(1),
  trackHeights: z.record(z.string(), z.coerce.number()).catch({}),
  mobileTrackHeightsEnlarged: z.record(z.string(), z.coerce.boolean()).catch({}),
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

const ProjectUiExportSettingsSchema = z
  .object({
    exportType: z.enum(['video', 'audio']).catch('video'),
    outputFormat: z.enum(['mp4', 'webm', 'mkv']).catch('mp4'),
    videoCodec: z.string().catch('avc1.640032'),
    bitrateMbps: z.coerce.number().catch(5),
    excludeAudio: z.coerce.boolean().catch(false),
    audioCodec: z.enum(['aac', 'opus', 'flac', 'pcm', 'mp3']).catch('aac'),
    audioBitrateKbps: z.coerce.number().catch(128),
    audioSampleRate: z.coerce.number().catch(48000),
    bitrateMode: z.enum(['constant', 'variable']).catch('variable'),
    keyframeIntervalSec: z.coerce.number().catch(2),
    exportAlpha: z.coerce.boolean().catch(false),
    matchTimeline: z.coerce.boolean().catch(true),
    customWidth: z.coerce.number().catch(1920),
    customHeight: z.coerce.number().catch(1080),
    customFps: z.coerce.number().catch(30),
    customAudioSampleRate: z.coerce.number().catch(48000),
    includeMetadata: z.coerce.boolean().catch(false),
    metadataTitle: z.string().catch(''),
    metadataDescription: z.string().catch(''),
    metadataAuthor: z.string().catch(''),
    metadataTags: z.string().catch(''),
  })
  .optional();

export const ProjectUiSettingsSchema = z.object({
  version: z.coerce.number().catch(1),
  monitor: ProjectMonitorSchema.optional(),
  monitors: z.record(z.string(), MonitorViewSchema).catch({}),
  timelines: z
    .object({
      openPaths: z.array(z.string()).catch([]),
      sessions: z.record(z.string(), TimelineSessionSchema).catch({}),
    })
    .catch({ openPaths: [], sessions: {} }),
  ui: z
    .object({
      activeTabId: z.string().nullable().catch(null),
      fileTabs: z.array(ProjectFileTabSchema).catch([]),
      staticTabsOrder: z.array(z.string()).catch([]),
      tabOrder: z.array(z.string()).catch([]),
      hiddenStaticTabs: z.array(z.string()).catch([]),
      fileManagerPaths: z.record(z.string(), z.string().nullable()).catch({}),
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
      tabOrder: [],
      hiddenStaticTabs: [],
      fileManagerPaths: {},
      layout: {
        cutPanels: null,
        soundPanels: null,
        splitSizes: {},
        verticalSplitSizes: {},
        timelineHeights: {},
      },
    }),
  exportSettings: ProjectUiExportSettingsSchema,
});

export type ProjectUiSettings = z.infer<typeof ProjectUiSettingsSchema>;

export interface ProjectUiRepository {
  load(): Promise<ProjectUiSettings | null>;
  save(data: ProjectUiSettings): Promise<void>;
}

export function createProjectUiRepository(input: ProjectRepositoryDeps): ProjectUiRepository {
  const store = createAppFsJsonStore(input.vfs);
  const path = projectAppFilePath(input.projectPath, 'project.ui.json');

  return {
    async load() {
      const raw = await store.readJson<unknown>(path);
      if (!raw) return null;

      const parsed = ProjectUiSettingsSchema.safeParse({
        ...(raw as Record<string, unknown>),
        monitors: (raw as Record<string, unknown>).monitors ?? {},
      });

      if (!parsed.success) {
        log.warn(`[ProjectUi] Invalid UI settings`, parsed.error);
        return null;
      }
      return parsed.data;
    },

    async save(data) {
      await store.writeJson(path, { ...data, version: 1 });
    },
  };
}
