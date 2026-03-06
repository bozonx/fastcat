import { STORAGE_LIMITS } from '../constants';
import type { HotkeyCommandId, HotkeyCombo } from '../hotkeys/defaultHotkeys';

export interface GranVideoEditorUserSettings {
  locale: 'en-US' | 'ru-RU';
  openLastProjectOnStart: boolean;
  stopFrames: {
    qualityPercent: number;
  };
  hotkeys: {
    bindings: Partial<Record<HotkeyCommandId, HotkeyCombo[]>>;
  };
  optimization: {
    proxyResolution: '360p' | '480p' | '720p' | '1080p';
    proxyVideoBitrateMbps: number;
    proxyAudioBitrateKbps: number;
    proxyCopyOpusAudio: boolean;
    autoCreateProxies: boolean;
    proxyConcurrency: number;
  };
  projectDefaults: {
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
    audioChannels: 'stereo' | 'mono';
    sampleRate: number;
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
  mouse: {
    ruler: {
      wheel: 'zoom_horizontal' | 'scroll_horizontal' | 'none';
      wheelSecondary: 'zoom_horizontal' | 'scroll_horizontal' | 'none';
      middleClick: 'pan' | 'move_playhead' | 'none';
      doubleClick: 'add_marker' | 'none';
      drag: 'pan' | 'move_playhead' | 'none';
      shiftClick: 'add_marker_and_edit' | 'none';
    };
    timeline: {
      wheel: 'scroll_vertical' | 'scroll_horizontal' | 'zoom_horizontal' | 'zoom_vertical' | 'none';
      wheelShift:
        | 'scroll_vertical'
        | 'scroll_horizontal'
        | 'zoom_horizontal'
        | 'zoom_vertical'
        | 'none';
      wheelSecondary:
        | 'scroll_vertical'
        | 'scroll_horizontal'
        | 'zoom_horizontal'
        | 'zoom_vertical'
        | 'none';
      wheelSecondaryShift:
        | 'scroll_vertical'
        | 'scroll_horizontal'
        | 'zoom_horizontal'
        | 'zoom_vertical'
        | 'none';
      middleClick: 'pan' | 'none';
    };
    trackHeaders: {
      wheel: 'scroll_vertical' | 'resize_track' | 'zoom_vertical' | 'none';
      wheelSecondary: 'scroll_vertical' | 'resize_track' | 'zoom_vertical' | 'none';
    };
    monitor: {
      wheel: 'zoom' | 'scroll_vertical' | 'scroll_horizontal' | 'none';
      wheelShift: 'zoom' | 'scroll_vertical' | 'scroll_horizontal' | 'none';
      middleClick: 'pan' | 'none';
    };
  };
}

export interface GranVideoEditorWorkspaceSettings {
  proxyStorageLimitBytes: number;
  cacheStorageLimitBytes: number;
  thumbnailsStorageLimitBytes: number;
}

export const DEFAULT_USER_SETTINGS: GranVideoEditorUserSettings = {
  locale: 'en-US',
  openLastProjectOnStart: true,
  stopFrames: {
    qualityPercent: 85,
  },
  hotkeys: {
    bindings: {},
  },
  optimization: {
    proxyResolution: '720p',
    proxyVideoBitrateMbps: 2,
    proxyAudioBitrateKbps: 128,
    proxyCopyOpusAudio: true,
    autoCreateProxies: false,
    proxyConcurrency: 2,
  },
  projectDefaults: {
    width: 1920,
    height: 1080,
    fps: 25,
    resolutionFormat: '1080p',
    orientation: 'landscape',
    aspectRatio: '16:9',
    isCustomResolution: false,
    audioChannels: 'stereo',
    sampleRate: 48000,
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
  mouse: {
    ruler: {
      wheel: 'zoom_horizontal',
      wheelSecondary: 'scroll_horizontal',
      middleClick: 'pan',
      doubleClick: 'add_marker',
      drag: 'move_playhead',
      shiftClick: 'add_marker_and_edit',
    },
    timeline: {
      wheel: 'scroll_vertical',
      wheelShift: 'scroll_horizontal',
      wheelSecondary: 'scroll_horizontal',
      wheelSecondaryShift: 'zoom_vertical',
      middleClick: 'pan',
    },
    trackHeaders: {
      wheel: 'scroll_vertical',
      wheelSecondary: 'resize_track',
    },
    monitor: {
      wheel: 'zoom',
      wheelShift: 'scroll_horizontal',
      middleClick: 'pan',
    },
  },
};

export const DEFAULT_WORKSPACE_SETTINGS: GranVideoEditorWorkspaceSettings = {
  proxyStorageLimitBytes: STORAGE_LIMITS.PROXY_BYTES,
  cacheStorageLimitBytes: STORAGE_LIMITS.CACHE_BYTES,
  thumbnailsStorageLimitBytes: STORAGE_LIMITS.THUMBNAILS_BYTES,
};
