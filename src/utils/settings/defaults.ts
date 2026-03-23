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
    /** Default transition duration in microseconds */
    defaultTransitionDurationUs: number;
    /** Default duration for static clips (images, text, etc) in microseconds */
    defaultStaticClipDurationUs: number;
    snapping: {
      timelineEdges: boolean;
      clips: boolean;
      markers: boolean;
      selection: boolean;
      playhead: boolean;
    };
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
    proxyVideoCodec: 'h264' | 'av1';
    proxyCopyOpusAudio: boolean;
    autoCreateProxies: boolean;
    mediaTaskConcurrency: number;
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
    audioScrubbingEnabled: boolean;
  };
  integrations: ExternalIntegrationsSettings;
  video: VideoSettings;
  mouse: {
    ruler: {
      wheel: string;
      wheelShift: string;
      wheelSecondary: string;
      wheelSecondaryShift: string;
      click: 'seek' | 'add_marker' | 'reset_zoom' | 'clear_selection' | 'none';
      middleClick: 'seek' | 'add_marker' | 'reset_zoom' | 'clear_selection' | 'none';
      doubleClick: 'seek' | 'add_marker' | 'reset_zoom' | 'clear_selection' | 'none';
      shiftClick: 'seek' | 'add_marker' | 'reset_zoom' | 'clear_selection' | 'none';
      drag: 'pan' | 'move_playhead' | 'select_area' | 'none';
      middleDrag: 'pan' | 'move_playhead' | 'select_area' | 'none';
      dragShift: 'pan' | 'move_playhead' | 'select_area' | 'none';
      horizontalMovement: 'move_playhead' | 'none';
    };
    timeline: {
      wheel: string;
      wheelShift: string;
      wheelSecondary: string;
      wheelSecondaryShift: string;
      middleClick: 'seek' | 'add_marker' | 'reset_zoom' | 'clear_selection' | 'none';
      middleDrag: 'pan' | 'move_playhead' | 'select_area' | 'none';
      horizontalMovement: 'move_playhead' | 'none';
      clipDragShift:
        | 'pseudo_overlap'
        | 'free_mode'
        | 'copy'
        | 'toggle_snap'
        | 'toggle_clip_move_mode'
        | 'none';
      clipDragCtrl:
        | 'pseudo_overlap'
        | 'free_mode'
        | 'copy'
        | 'toggle_snap'
        | 'toggle_clip_move_mode'
        | 'none';
      clipDragRight:
        | 'pseudo_overlap'
        | 'free_mode'
        | 'copy'
        | 'toggle_snap'
        | 'toggle_clip_move_mode'
        | 'none';
    };
    trackHeaders: {
      wheel: string;
      wheelShift: string;
      wheelSecondary: string;
      wheelSecondaryShift: string;
    };
    monitor: {
      wheel: string;
      wheelShift: string;
      wheelSecondary: string;
      wheelSecondaryShift: string;
      middleClick: 'fit' | 'reset_zoom' | 'reset_zoom_center' | 'center' | 'none';
      middleDrag: 'pan' | 'none';
    };
  };
  deleteWithoutConfirmation: boolean;
  ui: {
    interfaceScale: number;
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
    defaultTransitionDurationUs: 2_000_000,
    defaultStaticClipDurationUs: 5_000_000,
    snapping: {
      timelineEdges: true,
      clips: true,
      markers: true,
      selection: true,
      playhead: true,
    },
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
    proxyVideoCodec: 'av1',
    proxyCopyOpusAudio: true,
    autoCreateProxies: false,
    mediaTaskConcurrency: 2,
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
    audioScrubbingEnabled: true,
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
      click: 'seek',
      middleClick: 'reset_zoom',
      doubleClick: 'add_marker',
      shiftClick: 'clear_selection',
      drag: 'move_playhead',
      middleDrag: 'pan',
      dragShift: 'select_area',
      horizontalMovement: 'none',
    },
    timeline: {
      wheel: 'zoom',
      wheelShift: 'scroll_horizontal',
      wheelSecondary: 'scroll_horizontal',
      wheelSecondaryShift: 'zoom',
      middleClick: 'reset_zoom',
      middleDrag: 'pan',
      horizontalMovement: 'move_playhead',
      clipDragShift: 'toggle_clip_move_mode',
      clipDragCtrl: 'copy',
      clipDragRight: 'copy',
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
      wheelSecondary: 'scroll_horizontal',
      wheelSecondaryShift: 'none',
      middleClick: 'fit',
      middleDrag: 'pan',
    },
  },
  deleteWithoutConfirmation: false,
  ui: {
    interfaceScale: 14,
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
