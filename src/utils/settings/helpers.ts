import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_WORKSPACE_SETTINGS,
  type GranVideoEditorUserSettings,
  type GranVideoEditorWorkspaceSettings,
} from './defaults';

export function getResolutionPreset(width: number, height: number) {
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

export function createDefaultProjectDefaults(): GranVideoEditorUserSettings['projectDefaults'] {
  const preset = getResolutionPreset(
    DEFAULT_USER_SETTINGS.projectDefaults.width,
    DEFAULT_USER_SETTINGS.projectDefaults.height,
  );

  return {
    width: DEFAULT_USER_SETTINGS.projectDefaults.width,
    height: DEFAULT_USER_SETTINGS.projectDefaults.height,
    fps: DEFAULT_USER_SETTINGS.projectDefaults.fps,
    resolutionFormat: preset.resolutionFormat,
    orientation: preset.orientation as 'landscape' | 'portrait',
    aspectRatio: preset.aspectRatio,
    isCustomResolution: preset.isCustomResolution,
    audioChannels: DEFAULT_USER_SETTINGS.projectDefaults.audioChannels,
    sampleRate: DEFAULT_USER_SETTINGS.projectDefaults.sampleRate,
    audioDeclickDurationUs: DEFAULT_USER_SETTINGS.projectDefaults.audioDeclickDurationUs,
    defaultAudioFadeCurve: DEFAULT_USER_SETTINGS.projectDefaults.defaultAudioFadeCurve,
  };
}

export function createDefaultUserSettings(): GranVideoEditorUserSettings {
  return {
    locale: DEFAULT_USER_SETTINGS.locale,
    openLastProjectOnStart: DEFAULT_USER_SETTINGS.openLastProjectOnStart,
    timeline: { ...DEFAULT_USER_SETTINGS.timeline },
    stopFrames: {
      qualityPercent: DEFAULT_USER_SETTINGS.stopFrames.qualityPercent,
    },
    hotkeys: {
      layer1: DEFAULT_USER_SETTINGS.hotkeys.layer1,
      layer2: DEFAULT_USER_SETTINGS.hotkeys.layer2,
      bindings: {},
    },
    optimization: { ...DEFAULT_USER_SETTINGS.optimization },
    projectDefaults: createDefaultProjectDefaults(),
    video: { ...DEFAULT_USER_SETTINGS.video },
    exportDefaults: {
      encoding: { ...DEFAULT_USER_SETTINGS.exportDefaults.encoding },
    },
    integrations: {
      granPublicador: { ...DEFAULT_USER_SETTINGS.integrations.granPublicador },
      manualFilesApi: { ...DEFAULT_USER_SETTINGS.integrations.manualFilesApi },
      manualSttApi: { ...DEFAULT_USER_SETTINGS.integrations.manualSttApi },
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
  };
}

export function createDefaultWorkspaceSettings(): GranVideoEditorWorkspaceSettings {
  return {
    ...DEFAULT_WORKSPACE_SETTINGS,
  };
}
