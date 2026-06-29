import { z } from 'zod';
import type { FastCatUserSettings } from './settings/defaults';
import { DEFAULT_USER_SETTINGS } from './settings/defaults';
import { applyResolutionPreset } from './settings/helpers';
import type { PreviewEffectQualitySetting } from './preview-effect-quality';

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
  showTransparencyGrid: boolean;
  showMarkerTexts: boolean;
  previewBlurQuality: PreviewEffectQualitySetting;
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
  mobileTrackHeightsEnlarged: Record<string, boolean>;
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
    /**
     * Intent flag: `true` = the project is in "auto" mode (the user did not pin
     * explicit settings), so geometry/sample-rate are detected from the first
     * dropped clips. `false` = the user configured the project manually.
     * This is *intent* — it does not track whether detection has happened yet;
     * that is `geometryResolved`/`sampleRateResolved` (state).
     */
    isAutoSettings: boolean;
    /** State: width/height/fps have been determined (auto-detected or set manually). */
    geometryResolved: boolean;
    /** State: sampleRate has been determined (auto-detected or set manually). */
    sampleRateResolved: boolean;
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
    fileTabs: import('~/stores/project-tabs.store').ProjectFileTab[];
    staticTabsOrder: string[];
    /** Unified display order of all tab IDs (static + file). */
    tabOrder: string[];
    /** Static tabs that are detached as panels (hidden from tab bar). */
    hiddenStaticTabs: string[];
    fileManagerPaths: Record<string, string | null>;
    layout: ProjectUiLayoutState;
  };
  exportSettings?: {
    exportType: 'video' | 'audio';
    outputFormat: 'mp4' | 'webm' | 'mkv';
    videoCodec: string;
    bitrateMbps: number;
    excludeAudio: boolean;
    audioCodec: 'aac' | 'opus' | 'flac' | 'pcm' | 'mp3';
    audioBitrateKbps: number;
    audioChannels: number;
    audioSampleRate: number;
    bitrateMode: 'constant' | 'variable';
    enableAdvancedSettings: boolean;
    maxBitrateMbps: number | null;
    keyframeIntervalSec: number;
    exportAlpha: boolean;
    fastStart: boolean;
    matchTimeline: boolean;
    customWidth: number;
    customHeight: number;
    customFps: number;
    customAudioSampleRate: number;
    includeMetadata: boolean;
    metadataTitle: string;
    metadataDescription: string;
    metadataAuthor: string;
    metadataTags: string;
    customExportPath?: string | null;
  };
}

export const DEFAULT_PROJECT_MONITOR_SETTINGS: ProjectMonitorSettings = {
  // 0 = "auto": derive the preview render scale from the quality tier (see
  // resolvePreviewRenderScale). A value > 0 pins a manual scale.
  previewResolution: 0,
  useProxy: true,
  previewEffectsEnabled: true,
  showGrid: false,
  showTimecode: true,
  toolbarPosition: 'bottom',
  showTransparencyGrid: false,
  showMarkerTexts: true,
  previewBlurQuality: 'auto',
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
    geometryResolved: false,
    sampleRateResolved: false,
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
  },
};

function getProjectSettingsFromUserDefaults(
  userSettings: ProjectSettingsUserDefaultsInput | undefined | null,
): Pick<FastCatProjectSettings, 'project'> {
  const settings = userSettings || DEFAULT_USER_SETTINGS;
  const baseProject = DEFAULT_PROJECT_SETTINGS.project;

  return {
    project: {
      width: baseProject.width,
      height: baseProject.height,
      fps: baseProject.fps,
      resolutionFormat: baseProject.resolutionFormat,
      orientation: baseProject.orientation,
      aspectRatio: baseProject.aspectRatio,
      isCustomResolution: baseProject.isCustomResolution,
      sampleRate: baseProject.sampleRate,
      audioDeclickDurationUs: (settings.projectDefaults || DEFAULT_USER_SETTINGS.projectDefaults)
        .audioDeclickDurationUs,
      isAutoSettings: true,
      geometryResolved: false,
      sampleRateResolved: false,
    },
  };
}

/** Project-format intent/state flags, mutated in place by the helpers below. */
export type ProjectAutoFlags = Pick<
  FastCatProjectSettings['project'],
  'isAutoSettings' | 'geometryResolved' | 'sampleRateResolved'
>;

/**
 * Marks the project as explicitly configured by the user: auto-detection is off
 * and both geometry and sample rate count as resolved. Use this for every manual
 * configuration path (create-with-settings, manual edits) so the "clear auto"
 * logic lives in one place.
 */
export function markProjectSettingsManual(project: ProjectAutoFlags): void {
  project.isAutoSettings = false;
  project.geometryResolved = true;
  project.sampleRateResolved = true;
}

/**
 * Marks the project as "auto": detection is on and nothing is resolved yet, so
 * the next dropped video/audio clips re-derive geometry/sample rate. Use this for
 * create-without-settings and "reset to defaults".
 */
export function markProjectSettingsAuto(project: ProjectAutoFlags): void {
  project.isAutoSettings = true;
  project.geometryResolved = false;
  project.sampleRateResolved = false;
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
    previewResolution: z.coerce.number().min(0).max(4320).catch(dm.previewResolution),
    useProxy: z.coerce.boolean().catch(dm.useProxy),
    previewEffectsEnabled: z.coerce.boolean().catch(dm.previewEffectsEnabled),
    showGrid: z.coerce.boolean().catch(dm.showGrid),
    showTimecode: z.coerce.boolean().catch(dm.showTimecode),
    toolbarPosition: z.enum(['top', 'bottom', 'left', 'right']).catch(dm.toolbarPosition),
    showTransparencyGrid: z.coerce.boolean().catch(dm.showTransparencyGrid),
    showMarkerTexts: z.coerce.boolean().catch(dm.showMarkerTexts),
    // `ultra` is no longer a user-selectable tier; migrate any persisted 'ultra' to the
    // highest remaining manual tier ('high') instead of resetting it to the default.
    previewBlurQuality: z
      .preprocess((v) => (v === 'ultra' ? 'high' : v), z.enum(['low', 'medium', 'high', 'auto']))
      .catch(dm.previewBlurQuality ?? 'auto'),
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

  return (
    z
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
            geometryResolved: z.coerce.boolean().optional(),
            sampleRateResolved: z.coerce.boolean().optional(),
          })
          .transform((val) => {
            // Backward compat: projects saved before these flags existed only
            // had `isAutoSettings`. A manually-configured legacy project
            // (isAutoSettings=false) is fully resolved; an auto one is not.
            const resolvedFallback = !val.isAutoSettings;
            const normalized = {
              ...val,
              geometryResolved: val.geometryResolved ?? resolvedFallback,
              sampleRateResolved: val.sampleRateResolved ?? resolvedFallback,
            };
            const isWidthHeightCustom =
              normalized.width !== defaults.project.width ||
              normalized.height !== defaults.project.height;
            // Only re-derive the preset when the geometry diverges from the
            // default, so an intentional custom-resolution flag on the default
            // size isn't clobbered. The derivation itself is the shared helper.
            if (!isWidthHeightCustom) {
              return normalized;
            }
            return applyResolutionPreset(normalized);
          })
          .catch(defaults.project),
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
            defaultDurationUs: z.coerce
              .number()
              .min(1)
              .catch(defaults.transitions.defaultDurationUs),
          })
          .catch(defaults.transitions),
        ui: z
          .object({
            activeTabId: z.string().nullable().catch(null),
            fileTabs: z.array(z.unknown()).catch([]),
            staticTabsOrder: z.array(z.string()).catch([]),
            tabOrder: z.array(z.string()).catch([]),
            hiddenStaticTabs: z.array(z.string()).catch([]),
            fileManagerPaths: z.record(z.string(), z.string().nullable()).catch({}),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            layout: layoutSchema.catch(defaults.ui.layout as any),
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .catch(defaults.ui as any),
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .catch(defaults as any)
  );
}

/** Picks project-wide monitor fields from a legacy per-monitor object. */
function pickProjectMonitorFields(
  source: Record<string, unknown>,
): Partial<ProjectMonitorSettings> {
  const out: Partial<ProjectMonitorSettings> = {};
  if (typeof source.previewResolution === 'number')
    out.previewResolution = source.previewResolution;
  if (typeof source.useProxy === 'boolean') out.useProxy = source.useProxy;
  if (typeof source.previewEffectsEnabled === 'boolean')
    out.previewEffectsEnabled = source.previewEffectsEnabled;
  // Raw pass-through; the schema validates the enum and migrates the retired 'ultra' → 'high'.
  if (typeof source.previewBlurQuality === 'string')
    out.previewBlurQuality =
      source.previewBlurQuality as ProjectMonitorSettings['previewBlurQuality'];
  if (typeof source.showGrid === 'boolean') out.showGrid = source.showGrid;
  if (typeof source.showTimecode === 'boolean') out.showTimecode = source.showTimecode;
  if (typeof source.showTransparencyGrid === 'boolean')
    out.showTransparencyGrid = source.showTransparencyGrid;
  if (typeof source.showMarkerTexts === 'boolean') out.showMarkerTexts = source.showMarkerTexts;
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

  return { ...parsed, monitor: parsed.monitor, monitors: mergedMonitors } as FastCatProjectSettings;
}
