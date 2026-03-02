import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_WORKSPACE_SETTINGS,
  type GranVideoEditorUserSettings,
  type GranVideoEditorWorkspaceSettings,
} from './defaults';
import { DEFAULT_HOTKEYS, type HotkeyCommandId, type HotkeyCombo } from '../hotkeys/defaultHotkeys';
import { normalizeHotkeyCombo } from '../hotkeys/hotkeyUtils';
import {
  getResolutionPreset,
  createDefaultUserSettings,
  createDefaultWorkspaceSettings,
} from './helpers';

function normalizeHotkeys(raw: unknown): GranVideoEditorUserSettings['hotkeys'] {
  if (!raw || typeof raw !== 'object') {
    return { bindings: {} };
  }

  const input = raw as Record<string, unknown>;
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
      normalizedBindings[cmdId] = [];
    }
  }

  return { bindings: normalizedBindings };
}

function getProjectInput(raw: unknown): Record<string, unknown> {
  const input = raw as Record<string, unknown>;
  const legacyExportInput = input.exportDefaults ?? input.export ?? null;
  return (input.projectDefaults ?? legacyExportInput ?? {}) as Record<string, unknown>;
}

function getExportEncodingInput(raw: unknown): Record<string, unknown> {
  const input = raw as Record<string, unknown>;
  const exportDefaults = input.exportDefaults as Record<string, unknown> | undefined;
  const legacyExport = input.export as Record<string, unknown> | undefined;
  const encoding = exportDefaults?.encoding ?? legacyExport?.encoding ?? {};
  return encoding as Record<string, unknown>;
}

export function normalizeUserSettings(raw: unknown): GranVideoEditorUserSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultUserSettings();
  }

  const input = raw as Record<string, unknown>;

  const localeRaw = input.locale ?? input.language ?? input.lang;
  const normalizedLocale =
    localeRaw === 'ru-RU' || localeRaw === 'ru'
      ? 'ru-RU'
      : localeRaw === 'en-US' || localeRaw === 'en'
        ? 'en-US'
        : DEFAULT_USER_SETTINGS.locale;

  const legacyExportInput = input.exportDefaults ?? input.export ?? null;
  const projectInput = input.projectDefaults ?? legacyExportInput ?? {};
  const exportEncodingInput =
    (input.exportDefaults as Record<string, unknown>)?.encoding ??
    (legacyExportInput as Record<string, unknown>)?.encoding ??
    {};

  const width = Number(projectInput?.width);
  const height = Number(projectInput?.height);
  const fps = Number(projectInput?.fps);
  const bitrateMbps = Number(exportEncodingInput?.bitrateMbps);
  const audioBitrateKbps = Number(exportEncodingInput?.audioBitrateKbps);
  const format = exportEncodingInput?.format;
  const keyframeIntervalSecRaw = Number(exportEncodingInput?.keyframeIntervalSec);

  const normalizedWidth =
    Number.isFinite(width) && width > 0
      ? Math.round(width)
      : DEFAULT_USER_SETTINGS.projectDefaults.width;
  const normalizedHeight =
    Number.isFinite(height) && height > 0
      ? Math.round(height)
      : DEFAULT_USER_SETTINGS.projectDefaults.height;

  const preset = getResolutionPreset(normalizedWidth, normalizedHeight);
  const isWidthHeightCustom =
    normalizedWidth !== DEFAULT_USER_SETTINGS.projectDefaults.width ||
    normalizedHeight !== DEFAULT_USER_SETTINGS.projectDefaults.height;

  const resolutionFormat =
    typeof projectInput?.resolutionFormat === 'string' &&
    projectInput.resolutionFormat &&
    !isWidthHeightCustom
      ? projectInput.resolutionFormat
      : preset.resolutionFormat;
  const orientation =
    (projectInput?.orientation === 'portrait' || projectInput?.orientation === 'landscape') &&
    !isWidthHeightCustom
      ? projectInput.orientation
      : (preset.orientation as 'landscape' | 'portrait');
  const aspectRatio =
    typeof projectInput?.aspectRatio === 'string' &&
    projectInput.aspectRatio &&
    !isWidthHeightCustom
      ? projectInput.aspectRatio
      : preset.aspectRatio;
  const isCustomResolution =
    projectInput?.isCustomResolution !== undefined && !isWidthHeightCustom
      ? Boolean(projectInput.isCustomResolution)
      : preset.isCustomResolution;

  const audioChannels = projectInput?.audioChannels === 'mono' ? 'mono' : 'stereo';
  const sampleRateRaw = Number(projectInput?.sampleRate);
  const sampleRate =
    Number.isFinite(sampleRateRaw) && sampleRateRaw > 0
      ? Math.round(Math.min(192000, Math.max(8000, sampleRateRaw)))
      : DEFAULT_USER_SETTINGS.projectDefaults.sampleRate;

  const openLastProjectOnStartRaw = input.openLastProjectOnStart;
  const openBehavior = input.openBehavior;
  const openLastProjectOnStart =
    typeof openLastProjectOnStartRaw === 'boolean'
      ? openLastProjectOnStartRaw
      : openBehavior === 'show_project_picker'
        ? false
        : DEFAULT_USER_SETTINGS.openLastProjectOnStart;

  const stopFramesInput = input.stopFrames ?? {};
  const qualityPercentRaw =
    stopFramesInput?.qualityPercent ?? input.stopFrameQualityPercent ?? input.stopFramesQuality;
  const qualityPercentParsed = Number(qualityPercentRaw);
  const stopFramesQualityPercent =
    Number.isFinite(qualityPercentParsed) && qualityPercentParsed > 0
      ? Math.round(Math.min(100, Math.max(1, qualityPercentParsed)))
      : DEFAULT_USER_SETTINGS.stopFrames.qualityPercent;

  const optimizationInput = input.optimization ?? {};
  const proxyResolution = optimizationInput.proxyResolution;
  const proxyVideoBitrateMbps = Number(optimizationInput.proxyVideoBitrateMbps);
  const proxyAudioBitrateKbps = Number(optimizationInput.proxyAudioBitrateKbps);
  const proxyCopyOpusAudio = optimizationInput.proxyCopyOpusAudio;
  const autoCreateProxies = optimizationInput.autoCreateProxies;
  const proxyConcurrency = Number(optimizationInput.proxyConcurrency);

  const hotkeys = normalizeHotkeys(input.hotkeys);

  const rawMouse = (raw as Record<string, unknown>).mouse;
  const normalizedMouse: GranVideoEditorUserSettings['mouse'] = {
    timeline: { ...DEFAULT_USER_SETTINGS.mouse.timeline },
    monitor: { ...DEFAULT_USER_SETTINGS.mouse.monitor },
  };

  if (rawMouse && typeof rawMouse === 'object') {
    const rawTimeline = (rawMouse as Record<string, unknown>).timeline;
    if (rawTimeline && typeof rawTimeline === 'object') {
      const validTimelineActions = [
        'scroll_vertical',
        'scroll_horizontal',
        'zoom_horizontal',
        'zoom_vertical',
        'none',
      ];
      for (const k of ['wheel', 'wheelShift', 'wheelSecondary', 'wheelSecondaryShift']) {
        if (validTimelineActions.includes((rawTimeline as Record<string, unknown>)[k] as string)) {
          (normalizedMouse.timeline as Record<string, unknown>)[k] = (
            rawTimeline as Record<string, unknown>
          )[k];
        }
      }

      const validMiddleClickActions = ['pan', 'none'];
      if (validMiddleClickActions.includes(rawTimeline.middleClick)) {
        normalizedMouse.timeline.middleClick = rawTimeline.middleClick as 'pan' | 'none';
      }
    }

    const rawMonitor = (rawMouse as Record<string, unknown>).monitor;
    if (rawMonitor && typeof rawMonitor === 'object') {
      const validMonitorActions = ['zoom', 'scroll_vertical', 'scroll_horizontal', 'none'];
      for (const k of ['wheel', 'wheelShift']) {
        if (validMonitorActions.includes((rawMonitor as Record<string, unknown>)[k] as string)) {
          (normalizedMouse.monitor as Record<string, unknown>)[k] = (
            rawMonitor as Record<string, unknown>
          )[k];
        }
      }

      const validMiddleClickActions = ['pan', 'none'];
      if (validMiddleClickActions.includes(rawMonitor.middleClick)) {
        normalizedMouse.monitor.middleClick = rawMonitor.middleClick as 'pan' | 'none';
      }
    }
  }

  return {
    locale: normalizedLocale,
    openLastProjectOnStart,
    stopFrames: {
      qualityPercent: stopFramesQualityPercent,
    },
    hotkeys,
    optimization: {
      proxyResolution: ['360p', '480p', '720p', '1080p'].includes(proxyResolution as string)
        ? (proxyResolution as '360p' | '480p' | '720p' | '1080p')
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
      autoCreateProxies:
        typeof autoCreateProxies === 'boolean'
          ? autoCreateProxies
          : DEFAULT_USER_SETTINGS.optimization.autoCreateProxies,
      proxyConcurrency:
        Number.isFinite(proxyConcurrency) && proxyConcurrency > 0
          ? Math.min(16, Math.max(1, Math.round(proxyConcurrency)))
          : DEFAULT_USER_SETTINGS.optimization.proxyConcurrency,
    },
    projectDefaults: {
      width: normalizedWidth,
      height: normalizedHeight,
      fps:
        Number.isFinite(fps) && fps > 0
          ? Math.round(Math.min(240, Math.max(1, fps)))
          : DEFAULT_USER_SETTINGS.projectDefaults.fps,
      resolutionFormat,
      orientation,
      aspectRatio,
      isCustomResolution,
      audioChannels,
      sampleRate,
    },
    exportDefaults: {
      encoding: {
        format: format === 'webm' || format === 'mkv' ? format : 'mp4',
        videoCodec:
          typeof exportEncodingInput?.videoCodec === 'string' &&
          (exportEncodingInput.videoCodec as string).trim().length > 0
            ? exportEncodingInput.videoCodec
            : DEFAULT_USER_SETTINGS.exportDefaults.encoding.videoCodec,
        bitrateMbps:
          Number.isFinite(bitrateMbps) && bitrateMbps > 0
            ? Math.min(200, Math.max(0.2, bitrateMbps))
            : DEFAULT_USER_SETTINGS.exportDefaults.encoding.bitrateMbps,
        excludeAudio: Boolean(exportEncodingInput?.excludeAudio),
        audioCodec: exportEncodingInput?.audioCodec === 'opus' ? 'opus' : 'aac',
        audioBitrateKbps:
          Number.isFinite(audioBitrateKbps) && audioBitrateKbps > 0
            ? Math.round(Math.min(1024, Math.max(32, audioBitrateKbps)))
            : DEFAULT_USER_SETTINGS.exportDefaults.encoding.audioBitrateKbps,
        bitrateMode: exportEncodingInput?.bitrateMode === 'constant' ? 'constant' : 'variable',
        keyframeIntervalSec:
          Number.isFinite(keyframeIntervalSecRaw) && keyframeIntervalSecRaw > 0
            ? Math.round(Math.min(60, Math.max(1, keyframeIntervalSecRaw)))
            : DEFAULT_USER_SETTINGS.exportDefaults.encoding.keyframeIntervalSec,
        exportAlpha: Boolean(exportEncodingInput?.exportAlpha),
      },
    },
    mouse: normalizedMouse,
  };
}

export function normalizeWorkspaceSettings(raw: unknown): GranVideoEditorWorkspaceSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultWorkspaceSettings();
  }

  const input = raw as Record<string, unknown>;

  const proxyStorageLimitBytes = Number(input.proxyStorageLimitBytes);
  const cacheStorageLimitBytes = Number(input.cacheStorageLimitBytes);
  const thumbnailsStorageLimitBytes = Number(input.thumbnailsStorageLimitBytes);

  const MAX_LIMIT_BYTES = 1024 * 1024 * 1024 * 1024;

  return {
    proxyStorageLimitBytes:
      Number.isFinite(proxyStorageLimitBytes) && proxyStorageLimitBytes > 0
        ? Math.round(Math.min(MAX_LIMIT_BYTES, proxyStorageLimitBytes))
        : DEFAULT_WORKSPACE_SETTINGS.proxyStorageLimitBytes,
    cacheStorageLimitBytes:
      Number.isFinite(cacheStorageLimitBytes) && cacheStorageLimitBytes > 0
        ? Math.round(Math.min(MAX_LIMIT_BYTES, cacheStorageLimitBytes))
        : DEFAULT_WORKSPACE_SETTINGS.cacheStorageLimitBytes,
    thumbnailsStorageLimitBytes:
      Number.isFinite(thumbnailsStorageLimitBytes) && thumbnailsStorageLimitBytes > 0
        ? Math.round(Math.min(MAX_LIMIT_BYTES, thumbnailsStorageLimitBytes))
        : DEFAULT_WORKSPACE_SETTINGS.thumbnailsStorageLimitBytes,
  };
}
