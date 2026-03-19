import { z } from 'zod';
import type { FastCatUserSettings } from './settings/defaults';
import { getResolutionPreset } from './settings/helpers';
import { resolveExportPreset, resolveProjectPreset } from './settings/presets';

interface ProjectSettingsUserDefaultsInput {
  projectDefaults: FastCatUserSettings['projectDefaults'];
  projectPresets: FastCatUserSettings['projectPresets'];
  exportPresets: FastCatUserSettings['exportPresets'];
}

export interface MonitorSettings {
  previewResolution: number;
  useProxy: boolean;
  previewEffectsEnabled: boolean;
  panX: number;
  panY: number;
  zoom: number;
  showGrid: boolean;
  toolbarPosition: 'top' | 'bottom' | 'left' | 'right';
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
  monitor: MonitorSettings;
  monitors: Record<string, MonitorSettings>;
  timelines: {
    openPaths: string[];
  };
  transitions: {
    defaultDurationUs: number;
  };
}

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
  monitor: {
    previewResolution: 480,
    useProxy: true,
    previewEffectsEnabled: true,
    panX: 0,
    panY: 0,
    zoom: 1,
    showGrid: false,
    toolbarPosition: 'bottom',
  },
  monitors: {},
  timelines: {
    openPaths: [],
  },
  transitions: {
    defaultDurationUs: 2_000_000,
  },
};

function getProjectSettingsFromUserDefaults(
  userSettings: ProjectSettingsUserDefaultsInput,
): Pick<FastCatProjectSettings, 'project' | 'exportDefaults'> {
  const projectPreset = resolveProjectPreset(userSettings.projectPresets);
  const exportPreset = resolveExportPreset(userSettings.exportPresets);

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
      audioDeclickDurationUs: userSettings.projectDefaults.audioDeclickDurationUs,
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
  const monitorBase = { ...DEFAULT_PROJECT_SETTINGS.monitor };
  return {
    ...base,
    version: 1,
    monitor: { ...monitorBase },
    monitors: {
      cut: { ...monitorBase },
      sound: { ...monitorBase },
      export: { ...monitorBase },
    },
    timelines: {
      openPaths: [],
    },
    transitions: {
      defaultDurationUs: DEFAULT_PROJECT_SETTINGS.transitions.defaultDurationUs,
    },
  };
}

function createProjectSettingsSchema(defaults: FastCatProjectSettings) {
  const monitorSchema = z.object({
    previewResolution: z.coerce
      .number()
      .int()
      .min(1)
      .max(4320)
      .catch(defaults.monitor.previewResolution),
    useProxy: z.coerce.boolean().catch(defaults.monitor.useProxy),
    previewEffectsEnabled: z.coerce.boolean().catch(defaults.monitor.previewEffectsEnabled),
    panX: z.coerce.number().catch(defaults.monitor.panX),
    panY: z.coerce.number().catch(defaults.monitor.panY),
    zoom: z.coerce.number().min(0.05).max(20).catch(defaults.monitor.zoom),
    showGrid: z.coerce.boolean().catch(defaults.monitor.showGrid),
    toolbarPosition: z
      .enum(['top', 'bottom', 'left', 'right'])
      .catch(defaults.monitor.toolbarPosition),
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
      monitor: monitorSchema.catch(defaults.monitor),
      monitors: z.record(z.string(), monitorSchema).catch({}),
      timelines: z
        .object({
          openPaths: z.array(z.string()).catch([]),
        })
        .catch(defaults.timelines),
      transitions: z
        .object({
          defaultDurationUs: z.coerce.number().min(1).catch(defaults.transitions.defaultDurationUs),
        })
        .catch(defaults.transitions),
    })
    .catch(defaults);
}

export function normalizeProjectSettings(
  raw: unknown,
  userSettings: ProjectSettingsUserDefaultsInput,
): FastCatProjectSettings {
  const defaults = createDefaultProjectSettings(userSettings);

  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  // Handle legacy mappings before passing to zod
  const input = raw as Record<string, any>;
  const legacyExportInput = input.exportDefaults ?? input.export ?? {};

  const mappedInput: Record<string, any> = {
    ...input,
    project:
      typeof input.project === 'object'
        ? input.project
        : typeof input.export === 'object'
          ? input.export
          : {},
    exportDefaults: {
      encoding: typeof legacyExportInput.encoding === 'object' ? legacyExportInput.encoding : {},
    },
  };

  // Handle monitors fallback logic
  const monitorsInput = mappedInput.monitors ?? {};
  const monitorInput = mappedInput.monitor ?? {};
  const resolvedMonitors: Record<string, any> = {};

  ['cut', 'sound', 'export'].forEach((view) => {
    resolvedMonitors[view] = monitorsInput[view] || (view === 'cut' ? monitorInput : {});
  });

  mappedInput.monitors = resolvedMonitors;

  const schema = createProjectSettingsSchema(defaults);
  return schema.parse(mappedInput);
}
