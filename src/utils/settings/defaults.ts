import type { HotkeyCommandId, HotkeyCombo } from '../hotkeys/defaultHotkeys';
import type { StoragePathRegistry } from '../storage-roots';
import type { TimelineDragAction } from '../mouse';
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
  localModel: string;
  language: string;
  restorePunctuation: boolean;
  formatText: boolean;
  includeWords: boolean;
}

export interface VideoSettings {
  enableFfmpeg: boolean;
}

export interface ExternalIntegrationsSettings {
  fastcatAccount: FastCatPublicadorIntegrationSettings;
  fastcatPublicador: FastCatPublicadorIntegrationSettings;
  manualFilesApi: ManualExternalApiSettings;
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
      click: 'seek' | 'add_marker' | 'reset_zoom' | 'fit_zoom' | 'clear_selection' | 'none';
      middleClick: 'seek' | 'add_marker' | 'reset_zoom' | 'fit_zoom' | 'clear_selection' | 'none';
      doubleClick: 'seek' | 'add_marker' | 'reset_zoom' | 'fit_zoom' | 'clear_selection' | 'none';
      shiftClick: 'seek' | 'add_marker' | 'reset_zoom' | 'fit_zoom' | 'clear_selection' | 'none';
      drag: TimelineDragAction;
      middleDrag: TimelineDragAction;
      dragShift: TimelineDragAction;
      horizontalMovement: 'move_playhead' | 'none';
    };
    timeline: {
      wheel: string;
      wheelShift: string;
      wheelSecondary: string;
      wheelSecondaryShift: string;
      click:
        | 'seek'
        | 'add_marker'
        | 'reset_zoom'
        | 'fit_zoom'
        | 'clear_selection'
        | 'select_item'
        | 'select_multiple'
        | 'none';
      shiftClick:
        | 'seek'
        | 'add_marker'
        | 'reset_zoom'
        | 'fit_zoom'
        | 'clear_selection'
        | 'select_item'
        | 'select_multiple'
        | 'none';
      drag: TimelineDragAction;
      middleClick:
        | 'seek'
        | 'add_marker'
        | 'reset_zoom'
        | 'fit_zoom'
        | 'clear_selection'
        | 'select_item'
        | 'select_multiple'
        | 'none';
      middleDrag: TimelineDragAction;
      horizontalMovement: 'move_playhead' | 'none';
      clipDragShift: TimelineDragAction;
      clipDragCtrl: TimelineDragAction;
      clipDragRight: TimelineDragAction;
    };
    trackHeaders: {
      wheel: string;
      wheelShift: string;
      wheelSecondary: string;
      wheelSecondaryShift: string;
      click: 'select_track' | 'select_all_clips' | 'none';
      middleClick: 'select_track' | 'select_all_clips' | 'none';
      doubleClick: 'select_track' | 'select_all_clips' | 'none';
    };
    monitor: {
      wheel: string;
      wheelShift: string;
      wheelSecondary: string;
      wheelSecondaryShift: string;
      middleClick: 'fit' | 'reset_zoom' | 'reset_zoom_center' | 'center' | 'none';
      doubleClick: 'fit' | 'reset_zoom' | 'reset_zoom_center' | 'center' | 'none';
      middleDrag: 'pan' | 'none';
    };
  };
  deleteWithoutConfirmation: boolean;
  ui: {
    interfaceScale: number;
  };
  history: {
    maxEntries: number;
  };
  backup: {
    intervalMinutes: number;
    count: number;
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
    fastcatAccount: {
      enabled: false,
      bearerToken: '',
    },
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
    stt: {
      provider: '',
      models: [],
      localModel: 'Xenova/whisper-tiny',
      language: '',
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
      middleClick: 'fit_zoom',
      doubleClick: 'add_marker',
      shiftClick: 'clear_selection',
      drag: 'move_playhead',
      middleDrag: 'pan',
      dragShift: 'select_area',
      horizontalMovement: 'none',
    },
    timeline: {
      wheel: 'scroll_vertical',
      wheelShift: 'zoom_horizontal',
      wheelSecondary: 'scroll_horizontal',
      wheelSecondaryShift: 'zoom_vertical',
      click: 'select_item',
      shiftClick: 'select_multiple',
      drag: 'move_clips',
      middleClick: 'fit_zoom',
      middleDrag: 'pan',
      horizontalMovement: 'none',
      clipDragShift: 'toggle_clip_move_mode',
      clipDragCtrl: 'free_mode',
      clipDragRight: 'copy',
    },
    trackHeaders: {
      wheel: 'scroll_vertical',
      wheelShift: 'zoom_vertical',
      wheelSecondary: 'resize_track',
      wheelSecondaryShift: 'none',
      click: 'select_track',
      middleClick: 'select_all_clips',
      doubleClick: 'select_all_clips',
    },
    monitor: {
      wheel: 'zoom',
      wheelShift: 'scroll_horizontal',
      wheelSecondary: 'scroll_horizontal',
      wheelSecondaryShift: 'scroll_vertical',
      middleClick: 'fit',
      doubleClick: 'reset_zoom_center',
      middleDrag: 'pan',
    },
  },
  deleteWithoutConfirmation: false,
  ui: {
    interfaceScale: 14,
  },
  history: {
    maxEntries: 100,
  },
  backup: {
    intervalMinutes: 5,
    count: 5,
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

