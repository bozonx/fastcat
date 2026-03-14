import type { HotkeyCommandId, HotkeyCombo } from '../hotkeys/defaultHotkeys';
import type { StoragePathRegistry } from '../storage-roots';
import type { UserExportPresetsSettings, UserProjectPresetsSettings } from './presets';
import { createDefaultExportPresets, createDefaultProjectPresets } from './presets';

export interface FastCatPublicadorIntegrationSettings {
  enabled: boolean;
  bearerToken: string;
}

export interface ManualExternalApiSettings {
  enabled: boolean;
  baseUrl: string;
  bearerToken: string;
  overrideFastCat: boolean;
}

export interface SttIntegrationSettings {
  provider: string;
  models: string[];
  restorePunctuation: boolean;
  formatText: boolean;
  includeWords: boolean;
}

export interface VideoSettings {
  enableFfmpeg: boolean;
}

export interface ExternalIntegrationsSettings {
  fastcatPublicador: FastCatPublicadorIntegrationSettings;
  manualFilesApi: ManualExternalApiSettings;
  manualSttApi: ManualExternalApiSettings;
  stt: SttIntegrationSettings;
}

export interface FastCatUserSettings {
  locale: 'en-US' | 'ru-RU';
  openLastProjectOnStart: boolean;
  timeline: {
    /** Snap threshold in pixels. Used as snapping area size for clips/playhead/markers. */
    snapThresholdPx: number;
  };
  stopFrames: {
    qualityPercent: number;
  };
  hotkeys: {
    layer1:
      | 'Shift'
      | 'Control'
      | 'Alt'
      | 'Meta'
      | 'ShiftLeft'
      | 'ShiftRight'
      | 'ControlLeft'
      | 'ControlRight'
      | 'AltLeft'
      | 'AltRight'
      | 'MetaLeft'
      | 'MetaRight';
    layer2:
      | 'Shift'
      | 'Control'
      | 'Alt'
      | 'Meta'
      | 'ShiftLeft'
      | 'ShiftRight'
      | 'ControlLeft'
      | 'ControlRight'
      | 'AltLeft'
      | 'AltRight'
      | 'MetaLeft'
      | 'MetaRight';
    bindings: Partial<Record<HotkeyCommandId, HotkeyCombo[]>>;
  };
  optimization: {
    proxyMaxPixels: number;
    proxyVideoBitrateMbps: number;
    proxyAudioBitrateKbps: number;
    proxyCopyOpusAudio: boolean;
    autoCreateProxies: boolean;
    proxyConcurrency: number;
    videoFrameCacheMb: number;
  };
  projectPresets: UserProjectPresetsSettings;
  exportPresets: UserExportPresetsSettings;
  projectDefaults: {
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
    sampleRate: number;
    audioDeclickDurationUs: number;
    defaultAudioFadeCurve: 'linear' | 'logarithmic';
  };
  integrations: ExternalIntegrationsSettings;
  video: VideoSettings;
  mouse: {
    ruler: {
      wheel: string;
      wheelShift: string;
      wheelSecondary: string;
      wheelSecondaryShift: string;
      middleClick: 'add_marker' | 'reset_zoom' | 'none';
      doubleClick: 'add_marker' | 'reset_zoom' | 'none';
      shiftClick: 'add_marker' | 'reset_zoom' | 'none';
      drag: 'pan' | 'move_playhead' | 'none';
      middleDrag: 'pan' | 'move_playhead' | 'none';
    };
    timeline: {
      wheel: string;
      wheelShift: string;
      wheelSecondary: string;
      wheelSecondaryShift: string;
      middleClick: 'pan' | 'move_playhead' | 'none';
      middleDrag: 'pan' | 'move_playhead' | 'none';
    };
    trackHeaders: {
      wheel: string;
      wheelShift: string;
      wheelSecondary: string;
      wheelSecondaryShift: string;
    };
    monitor: {
      wheel: 'zoom' | 'scroll_vertical' | 'scroll_horizontal' | 'none';
      wheelShift: 'zoom' | 'scroll_vertical' | 'scroll_horizontal' | 'none';
      middleClick: 'pan' | 'none';
    };
  };
}

export interface FastCatAppSettings {
  paths: StoragePathRegistry;
}

export type FastCatWorkspaceSettings = FastCatAppSettings;

export const DEFAULT_USER_SETTINGS: FastCatUserSettings = {
  locale: 'en-US',
  openLastProjectOnStart: true,
  timeline: {
    snapThresholdPx: 8,
  },
  stopFrames: {
    qualityPercent: 85,
  },
  hotkeys: {
    layer1: 'Shift',
    layer2: 'Control',
    bindings: {},
  },
  optimization: {
    proxyMaxPixels: 1_500_000,
    proxyVideoBitrateMbps: 2,
    proxyAudioBitrateKbps: 128,
    proxyCopyOpusAudio: true,
    autoCreateProxies: false,
    proxyConcurrency: 2,
    videoFrameCacheMb: 256,
  },
  projectPresets: createDefaultProjectPresets(),
  exportPresets: createDefaultExportPresets(),
  projectDefaults: {
    width: 1920,
    height: 1080,
    fps: 25,
    resolutionFormat: '1080p',
    orientation: 'landscape',
    aspectRatio: '16:9',
    isCustomResolution: false,
    sampleRate: 48000,
    audioDeclickDurationUs: 5_000,
    defaultAudioFadeCurve: 'logarithmic',
  },
  integrations: {
    fastcatPublicador: {
      enabled: false,
      bearerToken: '',
    },
    manualFilesApi: {
      enabled: false,
      baseUrl: '',
      bearerToken: '',
      overrideFastCat: false,
    },
    manualSttApi: {
      enabled: false,
      baseUrl: '',
      bearerToken: '',
      overrideFastCat: false,
    },
    stt: {
      provider: '',
      models: [],
      restorePunctuation: true,
      formatText: false,
      includeWords: true,
    },
  },
  video: {
    enableFfmpeg: false,
  },
  mouse: {
    ruler: {
      wheel: 'seek_frame',
      wheelShift: 'seek_second',
      wheelSecondary: 'scroll_horizontal',
      wheelSecondaryShift: 'zoom_horizontal',
      middleClick: 'none',
      doubleClick: 'add_marker',
      shiftClick: 'none',
      drag: 'move_playhead',
      middleDrag: 'pan',
    },
    timeline: {
      wheel: 'zoom_horizontal',
      wheelShift: 'scroll_horizontal',
      wheelSecondary: 'scroll_horizontal',
      wheelSecondaryShift: 'zoom_vertical',
      middleClick: 'none',
      middleDrag: 'pan',
    },
    trackHeaders: {
      wheel: 'scroll_vertical',
      wheelShift: 'zoom_vertical',
      wheelSecondary: 'resize_track',
      wheelSecondaryShift: 'none',
    },
    monitor: {
      wheel: 'zoom',
      wheelShift: 'scroll_horizontal',
      middleClick: 'pan',
    },
  },
};

export const DEFAULT_APP_SETTINGS: FastCatAppSettings = {
  paths: {
    contentRootPath: '',
    dataRootPath: '',
    tempRootPath: '',
    proxiesRootPath: '',
    ephemeralTmpRootPath: '',
    placementMode: 'system-default',
  },
};

export const DEFAULT_WORKSPACE_SETTINGS: FastCatWorkspaceSettings = DEFAULT_APP_SETTINGS;
