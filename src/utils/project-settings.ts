import type { FastCatUserSettings } from './settings/defaults';
import { getResolutionPreset } from './settings/helpers';
import { resolveExportPreset, resolveProjectPreset } from './settings/presets';

interface ProjectSettingsUserDefaultsInput {
  projectDefaults: FastCatUserSettings['projectDefaults'];
  projectPresets: FastCatUserSettings['projectPresets'];
  exportPresets: FastCatUserSettings['exportPresets'];
}

export interface FastCatProjectSettings {
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
      metadata: {
        title: string;
        author: string;
        tags: string;
      };
    };
  };
  monitor: {
    previewResolution: number;
    useProxy: boolean;
    previewEffectsEnabled: boolean;
    panX: number;
    panY: number;
    zoom: number;
    showGrid: boolean;
    toolbarPosition: 'top' | 'bottom' | 'left' | 'right';
  };
  timelines: {
    openPaths: string[];
    lastOpenedPath: string | null;
  };
  transitions: {
    defaultDurationUs: number;
  };
}

export const DEFAULT_PROJECT_SETTINGS: FastCatProjectSettings = {
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
      metadata: {
        title: '',
        author: '',
        tags: '',
      },
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
  timelines: {
    openPaths: [],
    lastOpenedPath: null,
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
        metadata: {
          title: '',
          author: '',
          tags: '',
        },
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
    monitor: { ...DEFAULT_PROJECT_SETTINGS.monitor },
    timelines: {
      openPaths: [],
      lastOpenedPath: null,
    },
    transitions: {
      defaultDurationUs: DEFAULT_PROJECT_SETTINGS.transitions.defaultDurationUs,
    },
  };
}

export function normalizeProjectSettings(
  raw: unknown,
  userSettings: ProjectSettingsUserDefaultsInput,
): FastCatProjectSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultProjectSettings(userSettings);
  }

  const input = raw as Record<string, any>;

  const legacyExportInput = input.exportDefaults ?? input.export ?? {};
  const projectInput = input.project ?? (input.export ? input.export : {}) ?? {};
  const encodingInput = legacyExportInput?.encoding ?? {};

  const monitorInput = input.monitor ?? {};
  const transitionsInput = input.transitions ?? {};

  const defaultSettings = createDefaultProjectSettings(userSettings);

  const width = Number(projectInput.width);
  const height = Number(projectInput.height);
  const fps = Number(projectInput.fps);

  const bitrateMbps = Number(encodingInput.bitrateMbps);
  const audioBitrateKbps = Number(encodingInput.audioBitrateKbps);
  const format = encodingInput.format;

  const sampleRateRaw = Number(projectInput.sampleRate);
  const sampleRate =
    Number.isFinite(sampleRateRaw) && sampleRateRaw > 0
      ? Math.round(Math.min(192000, Math.max(8000, sampleRateRaw)))
      : defaultSettings.project.sampleRate;
  const audioDeclickDurationUsRaw = Number(projectInput.audioDeclickDurationUs);
  const audioDeclickDurationUs =
    Number.isFinite(audioDeclickDurationUsRaw) && audioDeclickDurationUsRaw >= 0
      ? Math.round(Math.min(1_000_000, Math.max(0, audioDeclickDurationUsRaw)))
      : defaultSettings.project.audioDeclickDurationUs;

  const previewResolution = Number(monitorInput.previewResolution);
  const useProxy = monitorInput.useProxy;
  const previewEffectsEnabled = monitorInput.previewEffectsEnabled;
  const panX = Number(monitorInput.panX);
  const panY = Number(monitorInput.panY);
  const zoom = Number(monitorInput.zoom);
  const defaultTransitionDurationUs = Number(transitionsInput.defaultDurationUs);

  const finalWidth =
    Number.isFinite(width) && width > 0 ? Math.round(width) : defaultSettings.project.width;
  const finalHeight =
    Number.isFinite(height) && height > 0 ? Math.round(height) : defaultSettings.project.height;

  const isWidthHeightCustom =
    finalWidth !== defaultSettings.project.width || finalHeight !== defaultSettings.project.height;

  const preset = isWidthHeightCustom
    ? getResolutionPreset(finalWidth, finalHeight)
    : {
        resolutionFormat: projectInput.resolutionFormat || defaultSettings.project.resolutionFormat,
        orientation: projectInput.orientation || defaultSettings.project.orientation,
        aspectRatio: projectInput.aspectRatio || defaultSettings.project.aspectRatio,
        isCustomResolution:
          projectInput.isCustomResolution !== undefined
            ? projectInput.isCustomResolution
            : defaultSettings.project.isCustomResolution,
      };

  return {
    project: {
      width: finalWidth,
      height: finalHeight,
      fps:
        Number.isFinite(fps) && fps > 0
          ? Math.round(Math.min(240, Math.max(1, fps)))
          : defaultSettings.project.fps,
      resolutionFormat:
        typeof projectInput.resolutionFormat === 'string' &&
        projectInput.resolutionFormat &&
        !isWidthHeightCustom
          ? projectInput.resolutionFormat
          : preset.resolutionFormat,
      orientation:
        (projectInput.orientation === 'portrait' || projectInput.orientation === 'landscape') &&
        !isWidthHeightCustom
          ? projectInput.orientation
          : (preset.orientation as 'landscape' | 'portrait'),
      aspectRatio:
        typeof projectInput.aspectRatio === 'string' &&
        projectInput.aspectRatio &&
        !isWidthHeightCustom
          ? projectInput.aspectRatio
          : preset.aspectRatio,
      isCustomResolution:
        projectInput.isCustomResolution !== undefined && !isWidthHeightCustom
          ? Boolean(projectInput.isCustomResolution)
          : preset.isCustomResolution,
      sampleRate,
      audioDeclickDurationUs,
      isAutoSettings:
        input.project?.isAutoSettings !== undefined
          ? Boolean(input.project.isAutoSettings)
          : defaultSettings.project.isAutoSettings,
    },
    exportDefaults: {
      encoding: {
        format: format === 'webm' || format === 'mkv' ? format : 'mp4',
        videoCodec:
          typeof encodingInput.videoCodec === 'string' && encodingInput.videoCodec.trim().length > 0
            ? encodingInput.videoCodec
            : DEFAULT_PROJECT_SETTINGS.exportDefaults.encoding.videoCodec,
        bitrateMbps:
          Number.isFinite(bitrateMbps) && bitrateMbps > 0
            ? Math.min(200, Math.max(0.2, bitrateMbps))
            : DEFAULT_PROJECT_SETTINGS.exportDefaults.encoding.bitrateMbps,
        excludeAudio: Boolean(encodingInput.excludeAudio),
        audioCodec: encodingInput.audioCodec === 'opus' ? 'opus' : 'aac',
        audioBitrateKbps:
          Number.isFinite(audioBitrateKbps) && audioBitrateKbps > 0
            ? Math.round(Math.min(1024, Math.max(32, audioBitrateKbps)))
            : DEFAULT_PROJECT_SETTINGS.exportDefaults.encoding.audioBitrateKbps,
        bitrateMode: encodingInput.bitrateMode === 'constant' ? 'constant' : 'variable',
        keyframeIntervalSec: (() => {
          const v = Number(encodingInput.keyframeIntervalSec);
          if (!Number.isFinite(v) || v <= 0) {
            return DEFAULT_PROJECT_SETTINGS.exportDefaults.encoding.keyframeIntervalSec;
          }
          return Math.round(Math.min(60, Math.max(1, v)));
        })(),
        exportAlpha: Boolean(encodingInput.exportAlpha),
        metadata: {
          title:
            typeof encodingInput.metadata?.title === 'string' ? encodingInput.metadata.title : '',
          author:
            typeof encodingInput.metadata?.author === 'string' ? encodingInput.metadata.author : '',
          tags: typeof encodingInput.metadata?.tags === 'string' ? encodingInput.metadata.tags : '',
        },
      },
    },
    monitor: {
      previewResolution:
        Number.isFinite(previewResolution) && previewResolution > 0
          ? Math.round(Math.min(4320, Math.max(1, previewResolution)))
          : DEFAULT_PROJECT_SETTINGS.monitor.previewResolution,
      useProxy:
        useProxy === undefined ? DEFAULT_PROJECT_SETTINGS.monitor.useProxy : Boolean(useProxy),
      previewEffectsEnabled:
        previewEffectsEnabled === undefined
          ? DEFAULT_PROJECT_SETTINGS.monitor.previewEffectsEnabled
          : Boolean(previewEffectsEnabled),
      panX: Number.isFinite(panX) ? panX : DEFAULT_PROJECT_SETTINGS.monitor.panX,
      panY: Number.isFinite(panY) ? panY : DEFAULT_PROJECT_SETTINGS.monitor.panY,
      zoom:
        Number.isFinite(zoom) && zoom > 0
          ? Math.min(20, Math.max(0.05, zoom))
          : DEFAULT_PROJECT_SETTINGS.monitor.zoom,
      showGrid:
        monitorInput.showGrid !== undefined
          ? Boolean(monitorInput.showGrid)
          : DEFAULT_PROJECT_SETTINGS.monitor.showGrid,
      toolbarPosition: ['top', 'bottom', 'left', 'right'].includes(monitorInput.toolbarPosition)
        ? monitorInput.toolbarPosition
        : DEFAULT_PROJECT_SETTINGS.monitor.toolbarPosition,
    },
    timelines: {
      openPaths: Array.isArray(input.timelines?.openPaths)
        ? input.timelines.openPaths.filter((p: any) => typeof p === 'string')
        : [],
      lastOpenedPath:
        typeof input.timelines?.lastOpenedPath === 'string' ? input.timelines.lastOpenedPath : null,
    },
    transitions: {
      defaultDurationUs:
        Number.isFinite(defaultTransitionDurationUs) && defaultTransitionDurationUs > 0
          ? Math.round(defaultTransitionDurationUs)
          : defaultSettings.transitions.defaultDurationUs,
    },
  };
}
