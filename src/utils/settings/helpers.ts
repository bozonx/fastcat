import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_APP_SETTINGS,
  type FastCatAppSettings,
  type FastCatUserSettings,
  type FastCatWorkspaceSettings,
} from './defaults';
import { createDefaultExportPresets, createDefaultProjectPresets } from './presets';

/** The geometry-derived display fields shared by every project/timeline format. */
export interface ResolutionPreset {
  isCustomResolution: boolean;
  resolutionFormat: string;
  orientation: 'landscape' | 'portrait';
  aspectRatio: string;
}

export function getResolutionPreset(width: number, height: number): ResolutionPreset {
  const isPortrait = height > width;
  const w = isPortrait ? height : width;
  const h = isPortrait ? width : height;

  let format = '';
  if (w === 854 && h === 480) format = '480p';
  else if (w === 1280 && h === 720) format = '720p';
  else if (w === 1920 && h === 1080) format = '1080p';
  else if (w === 2560 && h === 1440) format = '2.7k';
  else if (w === 3840 && h === 2160) format = '4k';

  let aspectRatio = '16:9';
  if (Math.abs(w / h - 16 / 9) < 0.01) aspectRatio = '16:9';
  else if (Math.abs(w / h - 4 / 3) < 0.01) aspectRatio = '4:3';
  else if (Math.abs(w / h - 1) < 0.01) aspectRatio = '1:1';
  else if (Math.abs(w / h - 21 / 9) < 0.01) aspectRatio = '21:9';

  return {
    isCustomResolution: !format,
    resolutionFormat: format || '1080p',
    orientation: isPortrait ? 'portrait' : 'landscape',
    aspectRatio,
  };
}

/**
 * Returns a copy of `format` with its geometry-derived display fields
 * (resolutionFormat/orientation/aspectRatio/isCustomResolution) recomputed from
 * the *current* width/height. This is the single, well-tested way to keep those
 * fields in sync with the geometry — every place that mutates width/height of a
 * format should funnel through here instead of re-deriving orientation by hand,
 * which is how stale `landscape`/`portrait` values used to leak in (notably for
 * vertical clips).
 */
export function applyResolutionPreset<T extends { width: number; height: number }>(
  format: T,
): T & ResolutionPreset {
  return { ...format, ...getResolutionPreset(format.width, format.height) };
}

export function createDefaultProjectDefaults(): FastCatUserSettings['projectDefaults'] {
  return {
    width: DEFAULT_USER_SETTINGS.projectDefaults.width,
    height: DEFAULT_USER_SETTINGS.projectDefaults.height,
    fps: DEFAULT_USER_SETTINGS.projectDefaults.fps,
    resolutionFormat: DEFAULT_USER_SETTINGS.projectDefaults.resolutionFormat,
    orientation: DEFAULT_USER_SETTINGS.projectDefaults.orientation,
    aspectRatio: DEFAULT_USER_SETTINGS.projectDefaults.aspectRatio,
    isCustomResolution: DEFAULT_USER_SETTINGS.projectDefaults.isCustomResolution,
    sampleRate: DEFAULT_USER_SETTINGS.projectDefaults.sampleRate,
    audioDeclickDurationUs: DEFAULT_USER_SETTINGS.projectDefaults.audioDeclickDurationUs,
    defaultAudioFadeCurve: DEFAULT_USER_SETTINGS.projectDefaults.defaultAudioFadeCurve,
    audioScrubbingEnabled: DEFAULT_USER_SETTINGS.projectDefaults.audioScrubbingEnabled,
  };
}

export function createDefaultUserSettings(): FastCatUserSettings {
  const projectPresets = createDefaultProjectPresets();
  const exportPresets = createDefaultExportPresets();

  return {
    locale: DEFAULT_USER_SETTINGS.locale,
    openLastProjectOnStart: DEFAULT_USER_SETTINGS.openLastProjectOnStart,
    deleteWithoutConfirmation: DEFAULT_USER_SETTINGS.deleteWithoutConfirmation,
    ui: { ...DEFAULT_USER_SETTINGS.ui },
    timeline: {
      ...DEFAULT_USER_SETTINGS.timeline,
      snapping: { ...DEFAULT_USER_SETTINGS.timeline.snapping },
    },
    stopFrames: {
      qualityPercent: DEFAULT_USER_SETTINGS.stopFrames.qualityPercent,
    },
    hotkeys: {
      layer1: DEFAULT_USER_SETTINGS.hotkeys.layer1,
      layer2: DEFAULT_USER_SETTINGS.hotkeys.layer2,
      bindings: {},
    },
    optimization: { ...DEFAULT_USER_SETTINGS.optimization },
    projectPresets: {
      selectedPresetId: projectPresets.selectedPresetId,
      lastUsedPresetId: projectPresets.lastUsedPresetId,
      items: projectPresets.items.map((preset) => ({ ...preset })),
    },
    exportPresets: {
      selectedPresetId: exportPresets.selectedPresetId,
      items: exportPresets.items.map((preset) => ({ ...preset })),
    },
    projectDefaults: createDefaultProjectDefaults(),
    integrations: {
      ...DEFAULT_USER_SETTINGS.integrations,
      fastcatAccount: { ...DEFAULT_USER_SETTINGS.integrations.fastcatAccount },
      fastcatPublicador: { ...DEFAULT_USER_SETTINGS.integrations.fastcatPublicador },
      manualFilesApi: { ...DEFAULT_USER_SETTINGS.integrations.manualFilesApi },
      stt: {
        ...DEFAULT_USER_SETTINGS.integrations.stt,
        models: [...DEFAULT_USER_SETTINGS.integrations.stt.models],
      },
    },
    mouse: {
      timeline: { ...DEFAULT_USER_SETTINGS.mouse.timeline },
      trackHeaders: { ...DEFAULT_USER_SETTINGS.mouse.trackHeaders },
      monitor: { ...DEFAULT_USER_SETTINGS.mouse.monitor },
      ruler: { ...DEFAULT_USER_SETTINGS.mouse.ruler },
    },
    history: { ...DEFAULT_USER_SETTINGS.history },
    backup: { ...DEFAULT_USER_SETTINGS.backup },
    presets: {
      ...DEFAULT_USER_SETTINGS.presets,
      custom: [...DEFAULT_USER_SETTINGS.presets.custom],
      collapsed: { ...DEFAULT_USER_SETTINGS.presets.collapsed },
    },
    autosave: { ...DEFAULT_USER_SETTINGS.autosave },
    experimentalFeatures: DEFAULT_USER_SETTINGS.experimentalFeatures,
    audioEngine: { ...DEFAULT_USER_SETTINGS.audioEngine },
  } as FastCatUserSettings;
}

export function createDefaultAppSettings(): FastCatAppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    paths: {
      ...DEFAULT_APP_SETTINGS.paths,
    },
  };
}

export function createDefaultWorkspaceSettings(): FastCatWorkspaceSettings {
  return createDefaultAppSettings();
}
