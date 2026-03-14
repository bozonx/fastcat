import { DEFAULT_USER_SETTINGS, DEFAULT_WORKSPACE_SETTINGS } from './defaults';
import type { FastCatAppSettings, FastCatUserSettings, FastCatWorkspaceSettings } from './defaults';
import {
  createDefaultExportPresets,
  createDefaultProjectPresets,
  resolveExportPreset,
  resolveProjectPreset,
  type ExportSettingsPreset,
  type ProjectSettingsPreset,
} from './presets';
import { STORAGE_ROOT_IDS } from '../storage-roots';
import { TIMELINE_WHEEL_ACTIONS, MONITOR_WHEEL_ACTIONS, MIDDLE_CLICK_ACTIONS } from '~/utils/mouse';
import { DEFAULT_HOTKEYS, type HotkeyCommandId, type HotkeyCombo } from '../hotkeys/defaultHotkeys';
import { normalizeHotkeyCombo } from '../hotkeys/hotkeyUtils';
import {
  createDefaultAppSettings,
  getResolutionPreset,
  createDefaultUserSettings,
  createDefaultWorkspaceSettings,
} from './helpers';

function normalizeUrlValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function normalizeTokenValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStoragePathValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHotkeys(raw: unknown): FastCatUserSettings['hotkeys'] {
  if (!raw || typeof raw !== 'object') {
    return {
      layer1: DEFAULT_USER_SETTINGS.hotkeys.layer1,
      layer2: DEFAULT_USER_SETTINGS.hotkeys.layer2,
      bindings: {},
    };
  }

  const input = raw as Record<string, unknown>;
  const layer1 =
    typeof input.layer1 === 'string' &&
    input.layer1 in { [DEFAULT_USER_SETTINGS.hotkeys.layer1]: true }
      ? (input.layer1 as FastCatUserSettings['hotkeys']['layer1'])
      : DEFAULT_USER_SETTINGS.hotkeys.layer1;
  const layer2 =
    typeof input.layer2 === 'string' &&
    input.layer2 in { [DEFAULT_USER_SETTINGS.hotkeys.layer2]: true }
      ? (input.layer2 as FastCatUserSettings['hotkeys']['layer2'])
      : DEFAULT_USER_SETTINGS.hotkeys.layer2;
  const bindingsInput = input.bindings;
  if (!bindingsInput || typeof bindingsInput !== 'object') {
    return {
      layer1,
      layer2,
      bindings: {},
    };
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

  return {
    layer1,
    layer2,
    bindings: normalizedBindings,
  };
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

function normalizeProjectPresetItem(
  raw: unknown,
  fallback: ProjectSettingsPreset,
): ProjectSettingsPreset {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const width = Number(input.width);
  const height = Number(input.height);
  const fps = Number(input.fps);
  const sampleRateRaw = Number(input.sampleRate);
  const normalizedWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : fallback.width;
  const normalizedHeight =
    Number.isFinite(height) && height > 0 ? Math.round(height) : fallback.height;
  const preset = getResolutionPreset(normalizedWidth, normalizedHeight);
  const isWidthHeightCustom =
    normalizedWidth !== fallback.width || normalizedHeight !== fallback.height;

  return {
    id: typeof input.id === 'string' && input.id.trim().length > 0 ? input.id.trim() : fallback.id,
    name:
      typeof input.name === 'string' && input.name.trim().length > 0
        ? input.name.trim()
        : fallback.name,
    width: normalizedWidth,
    height: normalizedHeight,
    fps:
      Number.isFinite(fps) && fps > 0 ? Math.round(Math.min(240, Math.max(1, fps))) : fallback.fps,
    resolutionFormat:
      typeof input.resolutionFormat === 'string' && input.resolutionFormat && !isWidthHeightCustom
        ? input.resolutionFormat
        : preset.resolutionFormat,
    orientation:
      (input.orientation === 'portrait' || input.orientation === 'landscape') &&
      !isWidthHeightCustom
        ? input.orientation
        : (preset.orientation as 'landscape' | 'portrait'),
    aspectRatio:
      typeof input.aspectRatio === 'string' && input.aspectRatio && !isWidthHeightCustom
        ? input.aspectRatio
        : preset.aspectRatio,
    isCustomResolution:
      input.isCustomResolution !== undefined && !isWidthHeightCustom
        ? Boolean(input.isCustomResolution)
        : preset.isCustomResolution,
    sampleRate:
      Number.isFinite(sampleRateRaw) && sampleRateRaw > 0
        ? Math.round(Math.min(192000, Math.max(8000, sampleRateRaw)))
        : fallback.sampleRate,
  };
}

function normalizeExportPresetItem(
  raw: unknown,
  fallback: ExportSettingsPreset,
): ExportSettingsPreset {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bitrateMbps = Number(input.bitrateMbps);
  const audioBitrateKbps = Number(input.audioBitrateKbps);
  const keyframeIntervalSec = Number(input.keyframeIntervalSec);

  return {
    id: typeof input.id === 'string' && input.id.trim().length > 0 ? input.id.trim() : fallback.id,
    name:
      typeof input.name === 'string' && input.name.trim().length > 0
        ? input.name.trim()
        : fallback.name,
    format: input.format === 'webm' || input.format === 'mkv' ? input.format : 'mp4',
    videoCodec:
      typeof input.videoCodec === 'string' && input.videoCodec.trim().length > 0
        ? input.videoCodec
        : fallback.videoCodec,
    bitrateMbps:
      Number.isFinite(bitrateMbps) && bitrateMbps > 0
        ? Math.min(200, Math.max(0.2, bitrateMbps))
        : fallback.bitrateMbps,
    excludeAudio: Boolean(input.excludeAudio),
    audioCodec: input.audioCodec === 'opus' ? 'opus' : 'aac',
    audioBitrateKbps:
      Number.isFinite(audioBitrateKbps) && audioBitrateKbps > 0
        ? Math.round(Math.min(1024, Math.max(32, audioBitrateKbps)))
        : fallback.audioBitrateKbps,
    bitrateMode: input.bitrateMode === 'constant' ? 'constant' : 'variable',
    keyframeIntervalSec:
      Number.isFinite(keyframeIntervalSec) && keyframeIntervalSec > 0
        ? Math.round(Math.min(60, Math.max(1, keyframeIntervalSec)))
        : fallback.keyframeIntervalSec,
    exportAlpha: Boolean(input.exportAlpha),
  };
}

export function normalizeUserSettings(raw: unknown): FastCatUserSettings {
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

  const projectInputRec = projectInput as Record<string, unknown>;
  const exportEncodingInputRec = exportEncodingInput as Record<string, unknown>;

  const defaultProjectPresets = createDefaultProjectPresets();
  const defaultExportPresets = createDefaultExportPresets();
  const legacyProjectPreset = normalizeProjectPresetItem(
    {
      id: defaultProjectPresets.selectedPresetId,
      name:
        defaultProjectPresets.items.find(
          (item) => item.id === defaultProjectPresets.selectedPresetId,
        )?.name ?? 'Project Preset',
      ...projectInputRec,
    },
    defaultProjectPresets.items[0]!,
  );
  const legacyExportPreset = normalizeExportPresetItem(
    {
      id: defaultExportPresets.selectedPresetId,
      name:
        defaultExportPresets.items.find((item) => item.id === defaultExportPresets.selectedPresetId)
          ?.name ?? 'Export Preset',
      ...exportEncodingInputRec,
    },
    defaultExportPresets.items[0]!,
  );

  const rawProjectPresets = input.projectPresets as Record<string, unknown> | undefined;
  const rawProjectPresetItems = Array.isArray(rawProjectPresets?.items)
    ? rawProjectPresets.items
    : null;
  const projectPresetFallbacks = defaultProjectPresets.items;
  const normalizedProjectPresetItems = rawProjectPresetItems?.map((item, index) =>
    normalizeProjectPresetItem(item, projectPresetFallbacks[index] ?? projectPresetFallbacks[0]!),
  ) ?? [legacyProjectPreset, ...projectPresetFallbacks.slice(1).map((preset) => ({ ...preset }))];

  const rawExportPresets = input.exportPresets as Record<string, unknown> | undefined;
  const rawExportPresetItems = Array.isArray(rawExportPresets?.items)
    ? rawExportPresets.items
    : null;
  const exportPresetFallbacks = defaultExportPresets.items;
  const normalizedExportPresetItems = rawExportPresetItems?.map((item, index) =>
    normalizeExportPresetItem(item, exportPresetFallbacks[index] ?? exportPresetFallbacks[0]!),
  ) ?? [legacyExportPreset, ...exportPresetFallbacks.slice(1).map((preset) => ({ ...preset }))];

  const normalizedProjectPresets = {
    selectedPresetId:
      typeof rawProjectPresets?.selectedPresetId === 'string' &&
      normalizedProjectPresetItems.some(
        (preset) => preset.id === rawProjectPresets.selectedPresetId,
      )
        ? rawProjectPresets.selectedPresetId
        : normalizedProjectPresetItems[0]!.id,
    lastUsedPresetId:
      typeof rawProjectPresets?.lastUsedPresetId === 'string' &&
      normalizedProjectPresetItems.some(
        (preset) => preset.id === rawProjectPresets.lastUsedPresetId,
      )
        ? rawProjectPresets.lastUsedPresetId
        : normalizedProjectPresetItems[0]!.id,
    items: normalizedProjectPresetItems,
  };

  const normalizedExportPresets = {
    selectedPresetId:
      typeof rawExportPresets?.selectedPresetId === 'string' &&
      normalizedExportPresetItems.some((preset) => preset.id === rawExportPresets.selectedPresetId)
        ? rawExportPresets.selectedPresetId
        : normalizedExportPresetItems[0]!.id,
    items: normalizedExportPresetItems,
  };

  const selectedProjectPreset = resolveProjectPreset(normalizedProjectPresets);
  const selectedExportPreset = resolveExportPreset(normalizedExportPresets);

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
    (stopFramesInput as Record<string, unknown>).qualityPercent ??
    input.stopFrameQualityPercent ??
    input.stopFramesQuality;
  const qualityPercentParsed = Number(qualityPercentRaw);
  const stopFramesQualityPercent =
    Number.isFinite(qualityPercentParsed) && qualityPercentParsed > 0
      ? Math.round(Math.min(100, Math.max(1, qualityPercentParsed)))
      : DEFAULT_USER_SETTINGS.stopFrames.qualityPercent;

  const optimizationInput = input.optimization ?? {};
  const proxyMaxPixels = Number((optimizationInput as Record<string, unknown>).proxyMaxPixels);
  const proxyResolutionRaw = (optimizationInput as Record<string, unknown>).proxyResolution;
  const proxyVideoBitrateMbps = Number(
    (optimizationInput as Record<string, unknown>).proxyVideoBitrateMbps,
  );
  const proxyAudioBitrateKbps = Number(
    (optimizationInput as Record<string, unknown>).proxyAudioBitrateKbps,
  );
  const proxyCopyOpusAudio = (optimizationInput as Record<string, unknown>).proxyCopyOpusAudio;
  const autoCreateProxies = (optimizationInput as Record<string, unknown>).autoCreateProxies;
  const proxyConcurrency = Number((optimizationInput as Record<string, unknown>).proxyConcurrency);
  const videoFrameCacheMb = Number(
    (optimizationInput as Record<string, unknown>).videoFrameCacheMb,
  );
  const integrationsInput = (input.integrations ?? {}) as Record<string, unknown>;
  const fastcatPublicadorInput = (integrationsInput.fastcatPublicador ?? {}) as Record<
    string,
    unknown
  >;
  const manualFilesApiInput = (integrationsInput.manualFilesApi ?? {}) as Record<string, unknown>;
  const manualSttApiInput = (integrationsInput.manualSttApi ?? {}) as Record<string, unknown>;
  const sttInput = (integrationsInput.stt ?? {}) as Record<string, unknown>;
  const videoInput = (input.video ?? {}) as Record<string, unknown>;

  const hotkeys = normalizeHotkeys(input.hotkeys);

  const legacyTimelineSnapThresholdPx = Number((input as Record<string, unknown>).snapThresholdPx);
  const rawTimeline = (input as Record<string, unknown>).timeline as Record<string, unknown> | null;
  const timelineSnapThresholdPxRaw = rawTimeline ? Number(rawTimeline.snapThresholdPx) : NaN;
  const timelineSnapThresholdPxCandidate = Number.isFinite(timelineSnapThresholdPxRaw)
    ? timelineSnapThresholdPxRaw
    : legacyTimelineSnapThresholdPx;
  const timelineSnapThresholdPx =
    Number.isFinite(timelineSnapThresholdPxCandidate) && timelineSnapThresholdPxCandidate > 0
      ? Math.max(1, Math.round(timelineSnapThresholdPxCandidate))
      : DEFAULT_USER_SETTINGS.timeline.snapThresholdPx;

  const rawMouse = (raw as Record<string, unknown>).mouse;
  const normalizedMouse: FastCatUserSettings['mouse'] = {
    ruler: { ...DEFAULT_USER_SETTINGS.mouse.ruler },
    timeline: { ...DEFAULT_USER_SETTINGS.mouse.timeline },
    trackHeaders: { ...DEFAULT_USER_SETTINGS.mouse.trackHeaders },
    monitor: { ...DEFAULT_USER_SETTINGS.mouse.monitor },
  };

  if (rawMouse && typeof rawMouse === 'object') {
    const rawRuler = (rawMouse as Record<string, unknown>).ruler as
      | Record<string, unknown>
      | undefined;
    if (rawRuler && typeof rawRuler === 'object') {
      for (const k of ['wheel', 'wheelShift', 'wheelSecondary', 'wheelSecondaryShift']) {
        if ((RULER_WHEEL_ACTIONS as readonly string[]).includes(rawRuler[k] as string)) {
          (normalizedMouse.ruler as Record<string, unknown>)[k] = rawRuler[k];
        }
      }

      const rulerMiddleClick = rawRuler.middleClick;
      if ((MIDDLE_CLICK_ACTIONS as readonly string[]).includes(rulerMiddleClick as string)) {
        (normalizedMouse.ruler as Record<string, unknown>).middleClick = rulerMiddleClick as
          | 'add_marker'
          | 'reset_zoom'
          | 'select_area'
          | 'none';
      }

      const rulerDoubleClick = rawRuler.doubleClick;
      if ((RULER_DOUBLE_CLICK_ACTIONS as readonly string[]).includes(rulerDoubleClick as string)) {
        (normalizedMouse.ruler as Record<string, unknown>).doubleClick = rulerDoubleClick as
          | 'add_marker'
          | 'reset_zoom'
          | 'select_area'
          | 'none';
      }

      const rulerDrag = rawRuler.drag;
      if ((DRAG_ACTIONS as readonly string[]).includes(rulerDrag as string)) {
        (normalizedMouse.ruler as Record<string, unknown>).drag = rulerDrag as
          | 'pan'
          | 'move_playhead'
          | 'select_area'
          | 'none';
      }

      const rulerMiddleDrag = rawRuler.middleDrag;
      if ((DRAG_ACTIONS as readonly string[]).includes(rulerMiddleDrag as string)) {
        (normalizedMouse.ruler as Record<string, unknown>).middleDrag = rulerMiddleDrag as
          | 'pan'
          | 'move_playhead'
          | 'select_area'
          | 'none';
      }

      const rulerDragShift = rawRuler.dragShift;
      if ((DRAG_ACTIONS as readonly string[]).includes(rulerDragShift as string)) {
        (normalizedMouse.ruler as Record<string, unknown>).dragShift = rulerDragShift as
          | 'pan'
          | 'move_playhead'
          | 'select_area'
          | 'none';
      }

      const rulerShiftClick = rawRuler.shiftClick;
      if ((SHIFT_CLICK_ACTIONS as readonly string[]).includes(rulerShiftClick as string)) {
        (normalizedMouse.ruler as Record<string, unknown>).shiftClick = rulerShiftClick as
          | 'add_marker'
          | 'reset_zoom'
          | 'select_area'
          | 'none';
      }
    }

    const rawTimeline = (rawMouse as Record<string, unknown>).timeline as
      | Record<string, unknown>
      | undefined;
    if (rawTimeline && typeof rawTimeline === 'object') {
      for (const k of ['wheel', 'wheelShift', 'wheelSecondary', 'wheelSecondaryShift']) {
        if (
          (TIMELINE_WHEEL_ACTIONS as readonly string[]).includes(
            (rawTimeline as Record<string, unknown>)[k] as string,
          )
        ) {
          (normalizedMouse.timeline as Record<string, unknown>)[k] = (
            rawTimeline as Record<string, unknown>
          )[k];
        }
      }

      const timelineMiddleClick = (rawTimeline as Record<string, unknown>).middleClick;
      if ((MIDDLE_CLICK_ACTIONS as readonly string[]).includes(timelineMiddleClick as string)) {
        (normalizedMouse.timeline as Record<string, unknown>).middleClick = timelineMiddleClick as
          | 'pan'
          | 'move_playhead'
          | 'reset_zoom'
          | 'select_area'
          | 'none';
      }

      const timelineMiddleDrag = (rawTimeline as Record<string, unknown>).middleDrag;
      if ((DRAG_ACTIONS as readonly string[]).includes(timelineMiddleDrag as string)) {
        (normalizedMouse.timeline as Record<string, unknown>).middleDrag = timelineMiddleDrag as
          | 'pan'
          | 'move_playhead'
          | 'select_area'
          | 'none';
      }
    }

    const rawTrackHeaders = (rawMouse as Record<string, unknown>).trackHeaders as
      | Record<string, unknown>
      | undefined;
    if (rawTrackHeaders && typeof rawTrackHeaders === 'object') {
      for (const k of ['wheel', 'wheelShift', 'wheelSecondary', 'wheelSecondaryShift']) {
        if (
          (TRACK_HEADERS_WHEEL_ACTIONS as readonly string[]).includes(
            (rawTrackHeaders as Record<string, unknown>)[k] as string,
          )
        ) {
          (normalizedMouse.trackHeaders as Record<string, unknown>)[k] = (
            rawTrackHeaders as Record<string, unknown>
          )[k];
        }
      }
    }

    const rawMonitor = (rawMouse as Record<string, unknown>).monitor as
      | Record<string, unknown>
      | undefined;
    if (rawMonitor && typeof rawMonitor === 'object') {
      for (const k of ['wheel', 'wheelShift']) {
        if (
          (MONITOR_WHEEL_ACTIONS as readonly string[]).includes(
            (rawMonitor as Record<string, unknown>)[k] as string,
          )
        ) {
          (normalizedMouse.monitor as Record<string, unknown>)[k] = (
            rawMonitor as Record<string, unknown>
          )[k];
        }
      }

      const monitorMiddleClick = (rawMonitor as Record<string, unknown>).middleClick;
      if ((MIDDLE_CLICK_ACTIONS as readonly string[]).includes(monitorMiddleClick as string)) {
        (normalizedMouse.monitor as Record<string, unknown>).middleClick = monitorMiddleClick as
          | 'pan'
          | 'none';
      }
    }
  }

  return {
    locale: normalizedLocale,
    openLastProjectOnStart,
    timeline: {
      snapThresholdPx: timelineSnapThresholdPx,
    },
    stopFrames: {
      qualityPercent: stopFramesQualityPercent,
    },
    hotkeys,
    optimization: {
      proxyMaxPixels:
        Number.isFinite(proxyMaxPixels) && proxyMaxPixels > 0
          ? Math.min(10_000_000, Math.max(100_000, proxyMaxPixels))
          : proxyResolutionRaw === '360p'
            ? 400_000
            : proxyResolutionRaw === '480p'
              ? 700_000
              : proxyResolutionRaw === '720p'
                ? 1_500_000
                : proxyResolutionRaw === '1080p'
                  ? 3_000_000
                  : DEFAULT_USER_SETTINGS.optimization.proxyMaxPixels,
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
      videoFrameCacheMb:
        Number.isFinite(videoFrameCacheMb) && videoFrameCacheMb >= 0
          ? Math.min(4096, Math.max(0, Math.round(videoFrameCacheMb)))
          : DEFAULT_USER_SETTINGS.optimization.videoFrameCacheMb,
    },
    projectPresets: normalizedProjectPresets,
    exportPresets: normalizedExportPresets,
    projectDefaults: {
      width: selectedProjectPreset.width,
      height: selectedProjectPreset.height,
      fps: selectedProjectPreset.fps,
      resolutionFormat: selectedProjectPreset.resolutionFormat,
      orientation: selectedProjectPreset.orientation,
      aspectRatio: selectedProjectPreset.aspectRatio,
      isCustomResolution: selectedProjectPreset.isCustomResolution,
      sampleRate: selectedProjectPreset.sampleRate,
      audioDeclickDurationUs:
        Number.isFinite(Number(projectInputRec.audioDeclickDurationUs)) &&
        Number(projectInputRec.audioDeclickDurationUs) >= 0
          ? Number(projectInputRec.audioDeclickDurationUs)
          : DEFAULT_USER_SETTINGS.projectDefaults.audioDeclickDurationUs,
      defaultAudioFadeCurve:
        projectInputRec.defaultAudioFadeCurve === 'linear' ||
        projectInputRec.defaultAudioFadeCurve === 'logarithmic'
          ? projectInputRec.defaultAudioFadeCurve
          : DEFAULT_USER_SETTINGS.projectDefaults.defaultAudioFadeCurve,
    },
    integrations: {
      fastcatPublicador: {
        enabled: Boolean(fastcatPublicadorInput.enabled),
        bearerToken: normalizeTokenValue(fastcatPublicadorInput.bearerToken),
      },
      manualFilesApi: {
        enabled: Boolean(manualFilesApiInput.enabled),
        baseUrl: normalizeUrlValue(manualFilesApiInput.baseUrl),
        bearerToken: normalizeTokenValue(manualFilesApiInput.bearerToken),
        overrideFastCat: Boolean(manualFilesApiInput.overrideFastCat),
      },
      manualSttApi: {
        enabled: Boolean(manualSttApiInput.enabled),
        baseUrl: normalizeUrlValue(manualSttApiInput.baseUrl),
        bearerToken: normalizeTokenValue(manualSttApiInput.bearerToken),
        overrideFastCat: Boolean(manualSttApiInput.overrideFastCat),
      },
      stt: {
        provider:
          typeof sttInput.provider === 'string'
            ? sttInput.provider.trim()
            : DEFAULT_USER_SETTINGS.integrations.stt.provider,
        models: Array.isArray(sttInput.models)
          ? sttInput.models
              .filter((model): model is string => typeof model === 'string')
              .map((model) => model.trim())
              .filter(Boolean)
          : [...DEFAULT_USER_SETTINGS.integrations.stt.models],
        restorePunctuation:
          typeof sttInput.restorePunctuation === 'boolean'
            ? sttInput.restorePunctuation
            : DEFAULT_USER_SETTINGS.integrations.stt.restorePunctuation,
        formatText:
          typeof sttInput.formatText === 'boolean'
            ? sttInput.formatText
            : DEFAULT_USER_SETTINGS.integrations.stt.formatText,
        includeWords:
          typeof sttInput.includeWords === 'boolean'
            ? sttInput.includeWords
            : DEFAULT_USER_SETTINGS.integrations.stt.includeWords,
      },
    },
    video: {
      enableFfmpeg:
        typeof videoInput.enableFfmpeg === 'boolean'
          ? videoInput.enableFfmpeg
          : DEFAULT_USER_SETTINGS.video.enableFfmpeg,
    },
    mouse: normalizedMouse,
  };
}

export function normalizeAppSettings(raw: unknown): FastCatAppSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultAppSettings();
  }

  const input = raw as Record<string, unknown>;
  const pathsInput =
    input.paths && typeof input.paths === 'object'
      ? (input.paths as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const defaultSettings = createDefaultAppSettings();
  const placementMode =
    pathsInput.placementMode === 'portable' ? 'portable' : defaultSettings.paths.placementMode;

  return {
    paths: {
      contentRootPath: normalizeStoragePathValue(pathsInput.contentRootPath),
      dataRootPath: normalizeStoragePathValue(pathsInput.dataRootPath),
      tempRootPath: normalizeStoragePathValue(pathsInput.tempRootPath),
      proxiesRootPath: normalizeStoragePathValue(pathsInput.proxiesRootPath),
      ephemeralTmpRootPath: normalizeStoragePathValue(pathsInput.ephemeralTmpRootPath),
      placementMode,
    },
  };
}

export function normalizeWorkspaceSettings(raw: unknown): FastCatWorkspaceSettings {
  return normalizeAppSettings(raw);
}
