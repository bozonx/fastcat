import type { HotkeyCommandId, HotkeyCombo } from '../hotkeys/defaultHotkeys';
import type { StoragePathRegistry } from '../storage-roots';
import type {
  CommonWheelAction,
  TimelineDragAction,
  TimelineClickAction,
  ClickAction,
  MonitorWheelAction,
  MonitorClickAction,
  MonitorLeftDoubleClickAction,
  MonitorDragAction,
  TrackHeadersWheelAction,
  RulerDragAction,
  ClipDragAction,
} from '../mouse';
import type {
  UserExportPresetsSettings,
  UserProjectPresetsSettings,
  CustomPreset,
} from './presets';
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

export interface ExternalIntegrationsSettings {
  fastcatAccount: FastCatPublicadorIntegrationSettings;
  fastcatPublicador: FastCatPublicadorIntegrationSettings;
  manualFilesApi: ManualExternalApiSettings;
  stt: SttIntegrationSettings;
}

export type AudioPluginFormat = 'clap' | 'lv2' | 'vst3';

export interface AudioPluginManagerSettings {
  enabled: boolean;
  scanOnStartup: boolean;
  enabledFormats: AudioPluginFormat[];
  customScanPaths: string[];
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
      playheadClick: boolean;
    };
    /** Per-user timeline snapping and drag modes (not project-specific). */
    frameSnapMode: 'free' | 'frames';
    toolbarSnapMode: 'snap' | 'no_snap' | 'free_mode';
    toolbarDragMode: 'pseudo_overlap' | 'copy' | 'slip';
    toolbarDragModeEnabled: boolean;
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
    pixiRenderer: 'webgl' | 'webgpu';
    videoFrameCacheMb: number;
    nativeFrameCacheMode: 'auto' | 'low' | 'balanced' | 'high' | 'custom';
    nativeFrameCacheCustomMb: number;
    ffmpegPath: string;
    ffprobePath: string;
    hardwareAccelerationMode: 'none' | 'vaapi' | 'nvdec' | 'auto';
    vaapiDevice: string;
    enableHardwareEncoding: boolean;
    nativeMonitorSyncMode: 'smooth' | 'balanced' | 'strict';
  };
  projectPresets: UserProjectPresetsSettings;
  exportPresets: UserExportPresetsSettings;
  presets: {
    custom: CustomPreset[];
    defaultTextPresetId: string;
    collapsed: Record<string, boolean>;
  };
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
  mouse: {
    ruler: {
      wheel: CommonWheelAction;
      wheelShift: CommonWheelAction;
      wheelSecondary: CommonWheelAction;
      wheelSecondaryShift: CommonWheelAction;
      click: ClickAction;
      middleClick: ClickAction;
      doubleClick: ClickAction;
      shiftClick: ClickAction;
      drag: RulerDragAction;
      middleDrag: RulerDragAction;
      dragShift: RulerDragAction;
      horizontalMovement: 'move_playhead' | 'none';
    };
    timeline: {
      wheel: CommonWheelAction;
      wheelShift: CommonWheelAction;
      wheelSecondary: CommonWheelAction;
      wheelSecondaryShift: CommonWheelAction;
      click: TimelineClickAction;
      drag: TimelineDragAction;
      middleClick: TimelineClickAction;
      middleDrag: TimelineDragAction;
      horizontalMovement: 'move_playhead' | 'none';
      clipDragShift: ClipDragAction;
      clipDragCtrl: ClipDragAction;
      clipDragRight: ClipDragAction;
    };
    trackHeaders: {
      wheel: TrackHeadersWheelAction;
      wheelShift: TrackHeadersWheelAction;
      wheelSecondary: TrackHeadersWheelAction;
      wheelSecondaryShift: TrackHeadersWheelAction;
      click: 'select_track' | 'select_all_clips' | 'none';
      middleClick: 'select_track' | 'select_all_clips' | 'none';
      doubleClick: 'select_track' | 'select_all_clips' | 'none';
    };
    monitor: {
      wheel: MonitorWheelAction;
      wheelShift: MonitorWheelAction;
      wheelSecondary: MonitorWheelAction;
      wheelSecondaryShift: MonitorWheelAction;
      middleClick: MonitorClickAction;
      leftDoubleClick: MonitorLeftDoubleClickAction;
      middleDoubleClick: MonitorClickAction;
      middleDrag: MonitorDragAction;
    };
  };
  deleteWithoutConfirmation: boolean;
  ui: {
    interfaceScale: number;
    clipThumbnailMode: 'standard' | 'edges' | 'none';
    defaultAudioWaveformMode: 'half' | 'full' | 'none';
  };
  history: {
    /** Number of undo steps kept (desktop only; the web build pins this
     *  internally). Total retained snapshot memory is additionally bounded by a
     *  non-configurable internal budget — see `history.store.ts`. */
    maxEntries: number;
  };
  backup: {
    enabled: boolean;
    /** How many backup versions of explicit saves to keep (rotation). */
    count: number;
  };
  autosave: {
    intervalMinutes: number;
  };
  experimentalFeatures: boolean;
  audioEngine: {
    bufferSize: 'default' | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096;
    backend: 'default' | 'alsa' | 'pulseaudio' | 'jack' | 'wasapi' | 'coreaudio';
  };
  audioPlugins: AudioPluginManagerSettings;
}

export interface FastCatAppSettings {
  paths: StoragePathRegistry;
}

export type FastCatWorkspaceSettings = FastCatAppSettings;

export const DEFAULT_USER_SETTINGS: FastCatUserSettings = {
  locale: 'en-US',
  openLastProjectOnStart: false,
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
      playheadClick: true,
    },
    frameSnapMode: 'frames',
    toolbarSnapMode: 'snap',
    toolbarDragMode: 'pseudo_overlap',
    toolbarDragModeEnabled: false,
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
    pixiRenderer: 'webgpu',
    videoFrameCacheMb: 256,
    nativeFrameCacheMode: 'auto',
    nativeFrameCacheCustomMb: 512,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    hardwareAccelerationMode: 'none',
    vaapiDevice: '/dev/dri/renderD128',
    enableHardwareEncoding: false,
    nativeMonitorSyncMode: 'balanced',
  },
  projectPresets: createDefaultProjectPresets(),
  exportPresets: createDefaultExportPresets(),
  presets: {
    custom: [],
    defaultTextPresetId: '',
    collapsed: {},
  },
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
  mouse: {
    ruler: {
      wheel: 'seek_frame',
      wheelShift: 'seek_second',
      wheelSecondary: 'scroll_horizontal',
      wheelSecondaryShift: 'zoom_horizontal_to_playhead',
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
      drag: 'move_clips',
      middleClick: 'fit_zoom',
      middleDrag: 'pan',
      horizontalMovement: 'none',
      clipDragShift: 'pseudo_overlap',
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
      middleClick: 'center',
      leftDoubleClick: 'fullscreen',
      middleDoubleClick: 'fit',
      middleDrag: 'pan',
    },
  },
  deleteWithoutConfirmation: false,
  ui: {
    interfaceScale: 14,
    clipThumbnailMode: 'standard',
    defaultAudioWaveformMode: 'half',
  },
  history: {
    maxEntries: 20,
  },
  backup: {
    enabled: true,
    count: 5,
  },
  autosave: {
    intervalMinutes: 2,
  },
  experimentalFeatures: false,
  audioEngine: {
    bufferSize: 'default',
    backend: 'default',
  },
  audioPlugins: {
    enabled: false,
    scanOnStartup: false,
    enabledFormats: ['clap'],
    customScanPaths: [],
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
