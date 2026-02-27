import { STORAGE_LIMITS } from './constants';
import { DEFAULT_HOTKEYS, type HotkeyCommandId, type HotkeyCombo } from './hotkeys/defaultHotkeys';
import { normalizeHotkeyCombo } from './hotkeys/hotkeyUtils';

export interface GranVideoEditorUserSettings {
  openLastProjectOnStart: boolean;
  hotkeys: {
    bindings: Partial<Record<HotkeyCommandId, HotkeyCombo[]>>;
  };
  optimization: {
    proxyResolution: '360p' | '480p' | '720p' | '1080p';
    proxyVideoBitrateMbps: number;
    proxyAudioBitrateKbps: number;
    proxyCopyOpusAudio: boolean;
  };
  exportDefaults: {
    width: number;
    height: number;
    fps: number;
    resolutionFormat: string;
    orientation: 'landscape' | 'portrait';
    aspectRatio: string;
    isCustomResolution: boolean;
    encoding: {
      format: 'mp4' | 'webm' | 'mkv';
      videoCodec: string;
      bitrateMbps: number;
      excludeAudio: boolean;
      audioCodec: 'aac' | 'opus';
      audioBitrateKbps: number;
    };
  };
  mouse: {
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
  openLastProjectOnStart: true,
  hotkeys: {
    bindings: {},
  },
  optimization: {
    proxyResolution: '720p',
    proxyVideoBitrateMbps: 2,
    proxyAudioBitrateKbps: 128,
    proxyCopyOpusAudio: true,
  },
  exportDefaults: {
    width: 1920,
    height: 1080,
    fps: 25,
    resolutionFormat: '1080p',
    orientation: 'landscape',
    aspectRatio: '16:9',
    isCustomResolution: false,
    encoding: {
      format: 'mp4',
      videoCodec: 'avc1.640032',
      bitrateMbps: 5,
      excludeAudio: false,
      audioCodec: 'aac',
      audioBitrateKbps: 128,
    },
  },
  mouse: {
    timeline: {
      wheel: 'scroll_vertical',
      wheelShift: 'scroll_horizontal',
      wheelSecondary: 'scroll_horizontal',
      wheelSecondaryShift: 'zoom_vertical',
      middleClick: 'pan',
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

export function getResolutionPreset(width: number, height: number) {
  const isPortrait = height > width;
  const w = isPortrait ? height : width;
  const h = isPortrait ? width : height;

  let format = '';
  if (w === 1280 && h === 720) format = '720p';
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

export function createDefaultExportDefaults(): GranVideoEditorUserSettings['exportDefaults'] {
  const preset = getResolutionPreset(
    DEFAULT_USER_SETTINGS.exportDefaults.width,
    DEFAULT_USER_SETTINGS.exportDefaults.height,
  );

  return {
    width: DEFAULT_USER_SETTINGS.exportDefaults.width,
    height: DEFAULT_USER_SETTINGS.exportDefaults.height,
    fps: DEFAULT_USER_SETTINGS.exportDefaults.fps,
    resolutionFormat: preset.resolutionFormat,
    orientation: preset.orientation as 'landscape' | 'portrait',
    aspectRatio: preset.aspectRatio,
    isCustomResolution: preset.isCustomResolution,
    encoding: { ...DEFAULT_USER_SETTINGS.exportDefaults.encoding },
  };
}

export function createDefaultUserSettings(): GranVideoEditorUserSettings {
  return {
    openLastProjectOnStart: DEFAULT_USER_SETTINGS.openLastProjectOnStart,
    hotkeys: {
      bindings: {},
    },
    optimization: { ...DEFAULT_USER_SETTINGS.optimization },
    exportDefaults: createDefaultExportDefaults(),
    mouse: {
      timeline: { ...DEFAULT_USER_SETTINGS.mouse.timeline },
      monitor: { ...DEFAULT_USER_SETTINGS.mouse.monitor },
    },
  };
}

function normalizeHotkeys(raw: unknown): GranVideoEditorUserSettings['hotkeys'] {
  if (!raw || typeof raw !== 'object') {
    return { bindings: {} };
  }

  const input = raw as Record<string, any>;
  const bindingsInput = input.bindings;
  if (!bindingsInput || typeof bindingsInput !== 'object') {
    return { bindings: {} };
  }

  const normalizedBindings: Partial<Record<HotkeyCommandId, HotkeyCombo[]>> = {};
  const allowedCommands = new Set<HotkeyCommandId>(DEFAULT_HOTKEYS.commands.map((c) => c.id));

  for (const [cmdIdRaw, combosRaw] of Object.entries(bindingsInput)) {
    const cmdId = cmdIdRaw as HotkeyCommandId;
    if (!allowedCommands.has(cmdId)) continue;

    const combos = Array.isArray(combosRaw) ? combosRaw : [];
    const normalizedCombos = combos
      .filter((c): c is string => typeof c === 'string')
      .map((c) => normalizeHotkeyCombo(c))
      .filter((c): c is string => Boolean(c));

    if (normalizedCombos.length > 0) {
      normalizedBindings[cmdId] = Array.from(new Set(normalizedCombos));
    } else if (Array.isArray(combosRaw)) {
      // Preserve explicit empty arrays to allow disabling a command.
      normalizedBindings[cmdId] = [];
    }
  }

  return { bindings: normalizedBindings };
}

export function normalizeUserSettings(raw: unknown): GranVideoEditorUserSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultUserSettings();
  }

  const input = raw as Record<string, any>;
  const exportInput = input.exportDefaults ?? input.export ?? null;
  const encodingInput = exportInput?.encoding ?? {};

  const width = Number(exportInput?.width);
  const height = Number(exportInput?.height);
  const fps = Number(exportInput?.fps);
  const bitrateMbps = Number(encodingInput?.bitrateMbps);
  const audioBitrateKbps = Number(encodingInput?.audioBitrateKbps);
  const format = encodingInput?.format;

  const normalizedWidth =
    Number.isFinite(width) && width > 0
      ? Math.round(width)
      : DEFAULT_USER_SETTINGS.exportDefaults.width;
  const normalizedHeight =
    Number.isFinite(height) && height > 0
      ? Math.round(height)
      : DEFAULT_USER_SETTINGS.exportDefaults.height;

  const preset = getResolutionPreset(normalizedWidth, normalizedHeight);
  const isWidthHeightCustom =
    normalizedWidth !== DEFAULT_USER_SETTINGS.exportDefaults.width ||
    normalizedHeight !== DEFAULT_USER_SETTINGS.exportDefaults.height;

  const resolutionFormat =
    typeof exportInput?.resolutionFormat === 'string' &&
    exportInput.resolutionFormat &&
    !isWidthHeightCustom
      ? exportInput.resolutionFormat
      : preset.resolutionFormat;
  const orientation =
    (exportInput?.orientation === 'portrait' || exportInput?.orientation === 'landscape') &&
    !isWidthHeightCustom
      ? exportInput.orientation
      : (preset.orientation as 'landscape' | 'portrait');
  const aspectRatio =
    typeof exportInput?.aspectRatio === 'string' && exportInput.aspectRatio && !isWidthHeightCustom
      ? exportInput.aspectRatio
      : preset.aspectRatio;
  const isCustomResolution =
    exportInput?.isCustomResolution !== undefined && !isWidthHeightCustom
      ? Boolean(exportInput.isCustomResolution)
      : preset.isCustomResolution;

  const openLastProjectOnStartRaw = input.openLastProjectOnStart;
  const openBehavior = input.openBehavior;
  const openLastProjectOnStart =
    typeof openLastProjectOnStartRaw === 'boolean'
      ? openLastProjectOnStartRaw
      : openBehavior === 'show_project_picker'
        ? false
        : DEFAULT_USER_SETTINGS.openLastProjectOnStart;

  const optimizationInput = input.optimization ?? {};
  const proxyResolution = optimizationInput.proxyResolution;
  const proxyVideoBitrateMbps = Number(optimizationInput.proxyVideoBitrateMbps);
  const proxyAudioBitrateKbps = Number(optimizationInput.proxyAudioBitrateKbps);
  const proxyCopyOpusAudio = optimizationInput.proxyCopyOpusAudio;

  const hotkeys = normalizeHotkeys(input.hotkeys);

  const rawMouse = (raw as any).mouse;
  const normalizedMouse: GranVideoEditorUserSettings['mouse'] = {
    timeline: { ...DEFAULT_USER_SETTINGS.mouse.timeline },
    monitor: { ...DEFAULT_USER_SETTINGS.mouse.monitor },
  };

  if (rawMouse && typeof rawMouse === 'object') {
    const rawTimeline = (rawMouse as any).timeline;
    if (rawTimeline && typeof rawTimeline === 'object') {
      const validTimelineActions = [
        'scroll_vertical',
        'scroll_horizontal',
        'zoom_horizontal',
        'zoom_vertical',
        'none',
      ];
      for (const k of ['wheel', 'wheelShift', 'wheelSecondary', 'wheelSecondaryShift']) {
        if (validTimelineActions.includes(rawTimeline[k])) {
          (normalizedMouse.timeline as any)[k] = rawTimeline[k];
        }
      }

      const validMiddleClickActions = ['pan', 'none'];
      if (validMiddleClickActions.includes(rawTimeline.middleClick)) {
        normalizedMouse.timeline.middleClick = rawTimeline.middleClick;
      }
    }

    const rawMonitor = (rawMouse as any).monitor;
    if (rawMonitor && typeof rawMonitor === 'object') {
      const validMonitorActions = ['zoom', 'scroll_vertical', 'scroll_horizontal', 'none'];
      for (const k of ['wheel', 'wheelShift']) {
        if (validMonitorActions.includes(rawMonitor[k])) {
          (normalizedMouse.monitor as any)[k] = rawMonitor[k];
        }
      }

      const validMiddleClickActions = ['pan', 'none'];
      if (validMiddleClickActions.includes(rawMonitor.middleClick)) {
        normalizedMouse.monitor.middleClick = rawMonitor.middleClick;
      }
    }
  }

  return {
    openLastProjectOnStart,
    hotkeys,
    optimization: {
      proxyResolution: ['360p', '480p', '720p', '1080p'].includes(proxyResolution)
        ? proxyResolution
        : DEFAULT_USER_SETTINGS.optimization.proxyResolution,
      proxyVideoBitrateMbps:
        Number.isFinite(proxyVideoBitrateMbps) && proxyVideoBitrateMbps > 0
          ? Math.min(50, Math.max(0.1, proxyVideoBitrateMbps))
          : DEFAULT_USER_SETTINGS.optimization.proxyVideoBitrateMbps,
      proxyAudioBitrateKbps:
        Number.isFinite(proxyAudioBitrateKbps) && proxyAudioBitrateKbps > 0
          ? Math.min(512, Math.max(32, proxyAudioBitrateKbps))
          : DEFAULT_USER_SETTINGS.optimization.proxyAudioBitrateKbps,
      proxyCopyOpusAudio:
        typeof proxyCopyOpusAudio === 'boolean'
          ? proxyCopyOpusAudio
          : DEFAULT_USER_SETTINGS.optimization.proxyCopyOpusAudio,
    },
    exportDefaults: {
      width: normalizedWidth,
      height: normalizedHeight,
      fps:
        Number.isFinite(fps) && fps > 0
          ? Math.round(Math.min(240, Math.max(1, fps)))
          : DEFAULT_USER_SETTINGS.exportDefaults.fps,
      resolutionFormat,
      orientation,
      aspectRatio,
      isCustomResolution,
      encoding: {
        format: format === 'webm' || format === 'mkv' ? format : 'mp4',
        videoCodec:
          typeof encodingInput?.videoCodec === 'string' &&
          encodingInput.videoCodec.trim().length > 0
            ? encodingInput.videoCodec
            : DEFAULT_USER_SETTINGS.exportDefaults.encoding.videoCodec,
        bitrateMbps:
          Number.isFinite(bitrateMbps) && bitrateMbps > 0
            ? Math.min(200, Math.max(0.2, bitrateMbps))
            : DEFAULT_USER_SETTINGS.exportDefaults.encoding.bitrateMbps,
        excludeAudio: Boolean(encodingInput?.excludeAudio),
        audioCodec: encodingInput?.audioCodec === 'opus' ? 'opus' : 'aac',
        audioBitrateKbps:
          Number.isFinite(audioBitrateKbps) && audioBitrateKbps > 0
            ? Math.round(Math.min(1024, Math.max(32, audioBitrateKbps)))
            : DEFAULT_USER_SETTINGS.exportDefaults.encoding.audioBitrateKbps,
      },
    },
    mouse: normalizedMouse,
  };
}

export function createDefaultWorkspaceSettings(): GranVideoEditorWorkspaceSettings {
  return {
    ...DEFAULT_WORKSPACE_SETTINGS,
  };
}

export function normalizeWorkspaceSettings(raw: unknown): GranVideoEditorWorkspaceSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultWorkspaceSettings();
  }

  const input = raw as Record<string, any>;

  const proxyStorageLimitBytes = Number(input.proxyStorageLimitBytes);
  const cacheStorageLimitBytes = Number(input.cacheStorageLimitBytes);
  const thumbnailsStorageLimitBytes = Number(input.thumbnailsStorageLimitBytes);

  return {
    proxyStorageLimitBytes:
      Number.isFinite(proxyStorageLimitBytes) && proxyStorageLimitBytes > 0
        ? Math.round(proxyStorageLimitBytes)
        : DEFAULT_WORKSPACE_SETTINGS.proxyStorageLimitBytes,
    cacheStorageLimitBytes:
      Number.isFinite(cacheStorageLimitBytes) && cacheStorageLimitBytes > 0
        ? Math.round(cacheStorageLimitBytes)
        : DEFAULT_WORKSPACE_SETTINGS.cacheStorageLimitBytes,
    thumbnailsStorageLimitBytes:
      Number.isFinite(thumbnailsStorageLimitBytes) && thumbnailsStorageLimitBytes > 0
        ? Math.round(thumbnailsStorageLimitBytes)
        : DEFAULT_WORKSPACE_SETTINGS.thumbnailsStorageLimitBytes,
  };
}
