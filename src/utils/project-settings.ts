import { z } from 'zod';
import type { FastCatUserSettings } from './settings/defaults';
import { DEFAULT_USER_SETTINGS } from './settings/defaults';
import { getResolutionPreset } from './settings/helpers';
import { resolveExportPreset, resolveProjectPreset } from './settings/presets';

interface ProjectSettingsUserDefaultsInput {
  projectDefaults: FastCatUserSettings['projectDefaults'];
  projectPresets: FastCatUserSettings['projectPresets'];
  exportPresets: FastCatUserSettings['exportPresets'];
}

/** Per-editor-view monitor state (pan & zoom of the preview viewport). */
export interface MonitorViewSettings {
  panX: number;
  panY: number;
  zoom: number;
}

/** Project-wide monitor settings, shared between all editor views (cut/sound/export). */
export interface ProjectMonitorSettings {
  previewResolution: number;
  useProxy: boolean;
  previewEffectsEnabled: boolean;
  showGrid: boolean;
  showTimecode: boolean;
  toolbarPosition: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * Combined monitor settings shape — kept as a facade for consumers that access
 * a single object. Per-view fields (pan/zoom) live in {@link MonitorViewSettings},
 * the rest in {@link ProjectMonitorSettings}.
 */
export interface MonitorSettings extends MonitorViewSettings, ProjectMonitorSettings {}

export interface TimelineSessionState {
  playheadUs: number;
  masterGain: number;
  masterMuted: boolean;
  zoom: number;
  trackHeights: Record<string, number>;
  selectionRange?: { startUs: number; endUs: number };
}

export interface ProjectUiDynamicPanel {
  id: string;
  type: string;
  title?: string;
  filePath?: string;
  mediaType?: string | null;
}

export interface ProjectUiPanelColumn {
  id: string;
  panels: ProjectUiDynamicPanel[];
}

export interface ProjectUiLayoutState {
  cutPanels: ProjectUiPanelColumn[] | null;
  soundPanels: ProjectUiPanelColumn[] | null;
  splitSizes: Record<string, number[]>;
  verticalSplitSizes: Record<string, Record<string, number[]>>;
  timelineHeights: Record<string, number>;
}

export interface FastCatProjectSettings {
  version: number;
  project: {
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
    sampleRate: number;
    audioDeclickDurationUs: number;
    isAutoSettings: boolean;
  };
  exportDefaults: {
    encoding: {
      format: 'mp4' | 'webm' | 'mkv';
      videoCodec: string;
      bitrateMbps: number;
      excludeAudio: boolean;
      audioCodec: 'aac' | 'opus';
      audioBitrateKbps: number;
      bitrateMode: 'constant' | 'variable';
      keyframeIntervalSec: number;
      exportAlpha: boolean;
    };
  };
  /** Project-wide monitor settings (effects, proxy, resolution, grid, timecode, toolbar position). */
  monitor: ProjectMonitorSettings;
  /** Per-view monitor pan/zoom (keys: `cut`, `sound`, `export`, plus `*-mobile` for platform). */
  monitors: Record<string, MonitorViewSettings>;
  timelines: {
    openPaths: string[];
    sessions: Record<string, TimelineSessionState>;
  };
  transitions: {
    defaultDurationUs: number;
  };
  ui: {
    activeTabId: string | null;
    fileTabs: import('~/types/project').ProjectFileTab[];
    staticTabsOrder: string[];
    fileManagerPaths: Record<string, string | null>;
    layout: ProjectUiLayoutState;
  };
}

export const DEFAULT_PROJECT_MONITOR_SETTINGS: ProjectMonitorSettings = {
  previewResolution: 0.5,
  useProxy: true,
  previewEffectsEnabled: true,
  showGrid: false,
  showTimecode: true,
  toolbarPosition: 'bottom',
};

export const DEFAULT_MONITOR_VIEW_SETTINGS: MonitorViewSettings = {
  panX: 0,
  panY: 0,
  zoom: 1,
};

/** @deprecated Use {@link DEFAULT_PROJECT_MONITOR_SETTINGS} / {@link DEFAULT_MONITOR_VIEW_SETTINGS}. */
export const DEFAULT_MONITOR_SETTINGS: MonitorSettings = {
  ...DEFAULT_PROJECT_MONITOR_SETTINGS,
  ...DEFAULT_MONITOR_VIEW_SETTINGS,
};

export const DEFAULT_PROJECT_SETTINGS: FastCatProjectSettings = {
  version: 1,
  project: {
    width: 1920,
    height: 1080,
    fps: 25,
    resolutionFormat: '1080p',
    orientation: 'landscape',
    aspectRatio: '16:9',
    isCustomResolution: false,
    sampleRate: 48000,
    audioDeclickDurationUs: 5_000,
    isAutoSettings: true,
  },
  exportDefaults: {
    encoding: {
      format: 'mp4',
      videoCodec: 'avc1.640032',
      bitrateMbps: 5,
      excludeAudio: false,
      audioCodec: 'aac',
      audioBitrateKbps: 128,
      bitrateMode: 'variable',
      keyframeIntervalSec: 2,
      exportAlpha: false,
    },
  },
  monitor: { ...DEFAULT_PROJECT_MONITOR_SETTINGS },
  monitors: {
    cut: { ...DEFAULT_MONITOR_VIEW_SETTINGS },
    sound: { ...DEFAULT_MONITOR_VIEW_SETTINGS },
    export: { ...DEFAULT_MONITOR_VIEW_SETTINGS },
  },
  timelines: {
    openPaths: [],
    sessions: {},
  },
  transitions: {
    defaultDurationUs: 2_000_000,
  },
  ui: {
    activeTabId: null,
    fileTabs: [],
    staticTabsOrder: [],
    fileManagerPaths: {},
    layout: {
      cutPanels: null,
      soundPanels: null,
      splitSizes: {},
      verticalSplitSizes: {},
      timelineHeights: {},
    },
  },
};

function getProjectSettingsFromUserDefaults(
  userSettings: ProjectSettingsUserDefaultsInput | undefined | null,
): Pick<FastCatProjectSettings, 'project' | 'exportDefaults'> {
  const settings = userSettings || DEFAULT_USER_SETTINGS;
  const projectPreset = resolveProjectPreset(
    settings.projectPresets || DEFAULT_USER_SETTINGS.projectPresets,
  );
  const exportPreset = resolveExportPreset(
    settings.exportPresets || DEFAULT_USER_SETTINGS.exportPresets,
  );

  return {
    project: {
      width: projectPreset.width,
      height: projectPreset.height,
      fps: projectPreset.fps,
      resolutionFormat: projectPreset.resolutionFormat,
      orientation: projectPreset.orientation,
      aspectRatio: projectPreset.aspectRatio,
      isCustomResolution: projectPreset.isCustomResolution,
      sampleRate: projectPreset.sampleRate,
      audioDeclickDurationUs: (settings.projectDefaults || DEFAULT_USER_SETTINGS.projectDefaults)
        .audioDeclickDurationUs,
      isAutoSettings: true,
    },
    exportDefaults: {
      encoding: {
        format: exportPreset.format,
        videoCodec: exportPreset.videoCodec,
        bitrateMbps: exportPreset.bitrateMbps,
        excludeAudio: exportPreset.excludeAudio,
        audioCodec: exportPreset.audioCodec,
        audioBitrateKbps: exportPreset.audioBitrateKbps,
        bitrateMode: exportPreset.bitrateMode,
        keyframeIntervalSec: exportPreset.keyframeIntervalSec,
        exportAlpha: exportPreset.exportAlpha,
      },
    },
  };
}

export function createDefaultProjectSettings(
  userSettings: ProjectSettingsUserDefaultsInput,
): FastCatProjectSettings {
  const base = getProjectSettingsFromUserDefaults(userSettings);
  return {
    ...base,
    version: 1,
    monitor: { ...DEFAULT_PROJECT_MONITOR_SETTINGS },
    monitors: {
      cut: { ...DEFAULT_MONITOR_VIEW_SETTINGS },
      sound: { ...DEFAULT_MONITOR_VIEW_SETTINGS },
      export: { ...DEFAULT_MONITOR_VIEW_SETTINGS },
    },
    timelines: {
      openPaths: [],
      sessions: {},
    },
    transitions: {
      defaultDurationUs: DEFAULT_PROJECT_SETTINGS.transitions.defaultDurationUs,
    },
    ui: {
      activeTabId: null,
      fileTabs: [],
      staticTabsOrder: [],
      fileManagerPaths: {},
      layout: {
        cutPanels: null,
        soundPanels: null,
        splitSizes: {},
        verticalSplitSizes: {},
        timelineHeights: {},
      },
    },
  };
}

function createProjectSettingsSchema(defaults: FastCatProjectSettings) {
  const dm = defaults.monitor;
  const dv = defaults.monitors.cut ?? DEFAULT_MONITOR_VIEW_SETTINGS;
  // Per-view shape kept lenient: legacy fields (resolution/effects/proxy/etc) are
  // accepted and stripped during normalization to populate the project-wide block.
  const monitorViewSchema = z
    .object({
      panX: z.coerce.number().catch(dv.panX),
      panY: z.coerce.number().catch(dv.panY),
      zoom: z.coerce.number().min(0.05).max(20).catch(dv.zoom),
    })
    .passthrough();
  const projectMonitorSchema = z.object({
    previewResolution: z.coerce.number().min(0.01).max(4320).catch(dm.previewResolution),
    useProxy: z.coerce.boolean().catch(dm.useProxy),
    previewEffectsEnabled: z.coerce.boolean().catch(dm.previewEffectsEnabled),
    showGrid: z.coerce.boolean().catch(dm.showGrid),
    showTimecode: z.coerce.boolean().catch(dm.showTimecode),
    toolbarPosition: z.enum(['top', 'bottom', 'left', 'right']).catch(dm.toolbarPosition),
  });

  const sessionSchema = z.object({
    playheadUs: z.coerce.number().catch(0),
    masterGain: z.coerce.number().catch(1),
    masterMuted: z.coerce.boolean().catch(false),
    zoom: z.coerce.number().catch(1),
    trackHeights: z.record(z.string(), z.coerce.number()).catch({}),
    selectionRange: z.object({ startUs: z.number(), endUs: z.number() }).optional(),
  });

  const dynamicPanelSchema = z
    .object({
      id: z.string(),
      type: z.string(),
      title: z.string().optional(),
      filePath: z.string().optional(),
      mediaType: z.string().nullable().optional(),
    })
    .catch({ id: '', type: '' });

  const panelColumnSchema = z.object({
    id: z.string(),
    panels: z.array(dynamicPanelSchema).catch([]),
  });

  const layoutSchema = z.object({
    cutPanels: z.array(panelColumnSchema).nullable().catch(null),
    soundPanels: z.array(panelColumnSchema).nullable().catch(null),
    splitSizes: z.record(z.string(), z.array(z.coerce.number())).catch({}),
    verticalSplitSizes: z
      .record(z.string(), z.record(z.string(), z.array(z.coerce.number())))
      .catch({}),
    timelineHeights: z.record(z.string(), z.coerce.number()).catch({}),
  });

  return z
    .object({
      version: z.coerce.number().catch(1),
      project: z
        .object({
          width: z.coerce.number().int().min(1).catch(defaults.project.width),
          height: z.coerce.number().int().min(1).catch(defaults.project.height),
          fps: z.coerce.number().min(1).max(240).catch(defaults.project.fps),
          resolutionFormat: z.string().catch(defaults.project.resolutionFormat),
          orientation: z.enum(['landscape', 'portrait']).catch(defaults.project.orientation),
          aspectRatio: z.string().catch(defaults.project.aspectRatio),
          isCustomResolution: z.coerce.boolean().catch(defaults.project.isCustomResolution),
          sampleRate: z.coerce.number().min(8000).max(192000).catch(defaults.project.sampleRate),
          audioDeclickDurationUs: z.coerce
            .number()
            .min(0)
            .max(1_000_000)
            .catch(defaults.project.audioDeclickDurationUs),
          isAutoSettings: z.coerce.boolean().catch(defaults.project.isAutoSettings),
        })
        .transform((val) => {
          const isWidthHeightCustom =
            val.width !== defaults.project.width || val.height !== defaults.project.height;
          if (!isWidthHeightCustom) {
            return val;
          }

          const preset = getResolutionPreset(val.width, val.height);
          return {
            ...val,
            resolutionFormat: preset.resolutionFormat,
            orientation: preset.orientation as 'landscape' | 'portrait',
            aspectRatio: preset.aspectRatio,
            isCustomResolution: preset.isCustomResolution,
          };
        })
        .catch(defaults.project),
      exportDefaults: z
        .object({
          encoding: z
            .object({
              format: z.enum(['mp4', 'webm', 'mkv']).catch(defaults.exportDefaults.encoding.format),
              videoCodec: z.string().min(1).catch(defaults.exportDefaults.encoding.videoCodec),
              bitrateMbps: z.coerce
                .number()
                .min(0.2)
                .max(200)
                .catch(defaults.exportDefaults.encoding.bitrateMbps),
              excludeAudio: z.coerce.boolean().catch(defaults.exportDefaults.encoding.excludeAudio),
              audioCodec: z
                .enum(['aac', 'opus'])
                .catch(defaults.exportDefaults.encoding.audioCodec),
              audioBitrateKbps: z.coerce
                .number()
                .min(32)
                .max(1024)
                .catch(defaults.exportDefaults.encoding.audioBitrateKbps),
              bitrateMode: z
                .enum(['constant', 'variable'])
                .catch(defaults.exportDefaults.encoding.bitrateMode),
              keyframeIntervalSec: z.coerce
                .number()
                .min(1)
                .max(60)
                .catch(defaults.exportDefaults.encoding.keyframeIntervalSec),
              exportAlpha: z.coerce.boolean().catch(defaults.exportDefaults.encoding.exportAlpha),
            })
            .catch(defaults.exportDefaults.encoding),
        })
        .catch(defaults.exportDefaults),
      monitor: projectMonitorSchema.catch(defaults.monitor),
      monitors: z.record(z.string(), monitorViewSchema).catch({}),
      timelines: z
        .object({
          openPaths: z.array(z.string()).catch([]),
          sessions: z.record(z.string(), sessionSchema).catch({}),
        })
        .catch(defaults.timelines),
      transitions: z
        .object({
          defaultDurationUs: z.coerce.number().min(1).catch(defaults.transitions.defaultDurationUs),
        })
        .catch(defaults.transitions),
      ui: z
        .object({
          activeTabId: z.string().nullable().catch(null),
          fileTabs: z.array(z.unknown()).catch([]),
          staticTabsOrder: z.array(z.string()).catch([]),
          fileManagerPaths: z.record(z.string(), z.string().nullable()).catch({}),
          layout: layoutSchema.catch(defaults.ui.layout as unknown),
        })
        .catch(defaults.ui as unknown),
    })
    .catch(defaults as unknown);
}

/** Picks project-wide monitor fields from a legacy per-monitor object. */
function pickProjectMonitorFields(source: Record<string, unknown>): Partial<ProjectMonitorSettings> {
  const out: Partial<ProjectMonitorSettings> = {};
  if (typeof source.previewResolution === 'number') out.previewResolution = source.previewResolution;
  if (typeof source.useProxy === 'boolean') out.useProxy = source.useProxy;
  if (typeof source.previewEffectsEnabled === 'boolean')
    out.previewEffectsEnabled = source.previewEffectsEnabled;
  if (typeof source.showGrid === 'boolean') out.showGrid = source.showGrid;
  if (typeof source.showTimecode === 'boolean') out.showTimecode = source.showTimecode;
  if (
    typeof source.toolbarPosition === 'string' &&
    ['top', 'bottom', 'left', 'right'].includes(source.toolbarPosition)
  ) {
    out.toolbarPosition = source.toolbarPosition as ProjectMonitorSettings['toolbarPosition'];
  }
  return out;
}

export function normalizeProjectSettings(
  raw: unknown,
  userSettings: ProjectSettingsUserDefaultsInput,
): FastCatProjectSettings {
  const defaults = createDefaultProjectSettings(userSettings);

  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  const input = raw as Record<string, unknown>;

  // Legacy migration: project-wide monitor settings used to live inside each
  // per-view entry of `monitors`. Promote them to the top-level `monitor` block
  // when missing, preferring `monitors.cut` as the source of truth.
  const inputMonitors = (input.monitors as Record<string, unknown> | undefined) ?? {};
  const legacySource =
    (inputMonitors.cut as Record<string, unknown> | undefined) ??
    (inputMonitors.sound as Record<string, unknown> | undefined) ??
    (inputMonitors.export as Record<string, unknown> | undefined) ??
    {};
  const migratedProjectMonitor = {
    ...defaults.monitor,
    ...pickProjectMonitorFields(legacySource),
    ...(input.monitor && typeof input.monitor === 'object'
      ? pickProjectMonitorFields(input.monitor as Record<string, unknown>)
      : {}),
  };

  const mappedInput: Record<string, unknown> = {
    ...input,
    project: typeof input.project === 'object' ? input.project : {},
    exportDefaults: {
      encoding:
        typeof input.exportDefaults?.encoding === 'object' ? input.exportDefaults.encoding : {},
    },
    monitor: migratedProjectMonitor,
    monitors: inputMonitors,
  };

  const schema = createProjectSettingsSchema(defaults);
  const parsed = schema.parse(mappedInput);

  const mergedMonitors: Record<string, MonitorViewSettings> = {};
  for (const view of ['cut', 'sound', 'export'] as const) {
    const base = defaults.monitors[view] ?? DEFAULT_MONITOR_VIEW_SETTINGS;
    const patch = (parsed.monitors[view] ?? {}) as Partial<MonitorViewSettings>;
    mergedMonitors[view] = {
      panX: typeof patch.panX === 'number' ? patch.panX : base.panX,
      panY: typeof patch.panY === 'number' ? patch.panY : base.panY,
      zoom: typeof patch.zoom === 'number' ? patch.zoom : base.zoom,
    };
  }
  for (const key of Object.keys(parsed.monitors)) {
    if (key === 'cut' || key === 'sound' || key === 'export') continue;
    const patch = (parsed.monitors[key] ?? {}) as Partial<MonitorViewSettings>;
    mergedMonitors[key] = {
      panX: typeof patch.panX === 'number' ? patch.panX : DEFAULT_MONITOR_VIEW_SETTINGS.panX,
      panY: typeof patch.panY === 'number' ? patch.panY : DEFAULT_MONITOR_VIEW_SETTINGS.panY,
      zoom: typeof patch.zoom === 'number' ? patch.zoom : DEFAULT_MONITOR_VIEW_SETTINGS.zoom,
    };
  }

  return { ...parsed, monitor: parsed.monitor, monitors: mergedMonitors };
}
