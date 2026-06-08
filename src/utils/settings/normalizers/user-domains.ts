import { z } from 'zod';
import { DEFAULT_USER_SETTINGS, type FastCatUserSettings } from '../defaults';
import {
  CLICK_ACTIONS,
  MONITOR_CLICK_ACTIONS,
  MONITOR_DRAG_ACTIONS,
  MONITOR_WHEEL_ACTIONS,
  MOUSE_HORIZONTAL_MOVEMENT_ACTIONS,
  RULER_WHEEL_ACTIONS,
  RULER_DRAG_ACTIONS,
  TIMELINE_CLICK_ACTIONS,
  TIMELINE_DRAG_ACTIONS,
  TIMELINE_WHEEL_ACTIONS,
  TRACK_HEADERS_WHEEL_ACTIONS,
} from '~/utils/mouse';
import { normalizeTokenValue, normalizeUrlValue } from './shared';

export function normalizeUiSettings(raw: unknown): FastCatUserSettings['ui'] {
  const input = (raw as Record<string, unknown>)?.['ui'] as Record<string, unknown> | undefined;
  return {
    interfaceScale:
      typeof input?.interfaceScale === 'number'
        ? input.interfaceScale
        : typeof input?.baseFontSize === 'number'
          ? input.baseFontSize
          : DEFAULT_USER_SETTINGS.ui.interfaceScale,
    clipThumbnailMode: z
      .enum(['standard', 'edges', 'none'])
      .catch(DEFAULT_USER_SETTINGS.ui.clipThumbnailMode)
      .parse(input?.clipThumbnailMode),
    defaultAudioWaveformMode: z
      .enum(['half', 'full', 'none'])
      .catch(DEFAULT_USER_SETTINGS.ui.defaultAudioWaveformMode)
      .parse(input?.defaultAudioWaveformMode),
  };
}

export function normalizeOpenLastProjectOnStart(raw: unknown): boolean {
  return z
    .boolean()
    .catch(DEFAULT_USER_SETTINGS.openLastProjectOnStart)
    .parse(
      (raw as Record<string, unknown>)?.['openBehavior'] === 'show_project_picker'
        ? false
        : (raw as Record<string, unknown>)?.['openLastProjectOnStart'],
    );
}

export function normalizeDeleteWithoutConfirmation(raw: unknown): boolean {
  return z
    .boolean()
    .catch(DEFAULT_USER_SETTINGS.deleteWithoutConfirmation)
    .parse((raw as Record<string, unknown>)?.['deleteWithoutConfirmation']);
}

export function normalizeTimelineSettings(raw: unknown): FastCatUserSettings['timeline'] {
  const input = (raw as Record<string, unknown>)?.['timeline'];
  const snapSchema = z
    .object({
      timelineEdges: z.boolean().catch(DEFAULT_USER_SETTINGS.timeline.snapping.timelineEdges),
      clips: z.boolean().catch(DEFAULT_USER_SETTINGS.timeline.snapping.clips),
      markers: z.boolean().catch(DEFAULT_USER_SETTINGS.timeline.snapping.markers),
      selection: z.boolean().catch(DEFAULT_USER_SETTINGS.timeline.snapping.selection),
      playhead: z.boolean().catch(DEFAULT_USER_SETTINGS.timeline.snapping.playhead),
      playheadClick: z.boolean().catch(DEFAULT_USER_SETTINGS.timeline.snapping.playheadClick),
    })
    .catch(DEFAULT_USER_SETTINGS.timeline.snapping);

  const schema = z
    .object({
      snapThresholdPx: z.coerce
        .number()
        .min(1)
        .catch(DEFAULT_USER_SETTINGS.timeline.snapThresholdPx),
      defaultTransitionDurationUs: z.coerce
        .number()
        .min(0)
        .catch(DEFAULT_USER_SETTINGS.timeline.defaultTransitionDurationUs),
      defaultStaticClipDurationUs: z.coerce
        .number()
        .min(0)
        .catch(DEFAULT_USER_SETTINGS.timeline.defaultStaticClipDurationUs),
      snapping: snapSchema,
      frameSnapMode: z.enum(['free', 'frames']).catch(DEFAULT_USER_SETTINGS.timeline.frameSnapMode),
      toolbarSnapMode: z
        .enum(['snap', 'no_snap', 'free_mode'])
        .catch(DEFAULT_USER_SETTINGS.timeline.toolbarSnapMode),
      toolbarDragMode: z
        .enum(['pseudo_overlap', 'copy', 'slip'])
        .catch(DEFAULT_USER_SETTINGS.timeline.toolbarDragMode),
      toolbarDragModeEnabled: z.coerce
        .boolean()
        .catch(DEFAULT_USER_SETTINGS.timeline.toolbarDragModeEnabled),
    })
    .catch(DEFAULT_USER_SETTINGS.timeline);

  return schema.parse(input);
}

export function normalizeStopFramesSettings(raw: unknown): FastCatUserSettings['stopFrames'] {
  const stopFrames = (raw as Record<string, unknown>)?.['stopFrames'] as
    | Record<string, unknown>
    | undefined;
  const qp =
    stopFrames?.['qualityPercent'] ??
    (raw as Record<string, unknown>)?.['stopFrameQualityPercent'] ??
    (raw as Record<string, unknown>)?.['stopFramesQuality'];
  return z
    .object({
      qualityPercent: z.coerce
        .number()
        .min(1)
        .max(100)
        .catch(DEFAULT_USER_SETTINGS.stopFrames.qualityPercent),
    })
    .catch(DEFAULT_USER_SETTINGS.stopFrames)
    .parse({ qualityPercent: qp });
}

export function normalizeOptimizationSettings(raw: unknown): FastCatUserSettings['optimization'] {
  const opt = ((raw as Record<string, unknown>)?.['optimization'] ?? {}) as Record<string, unknown>;

  // Custom parsing step for proxyResolution string mapping
  let proxyMaxPixels = opt.proxyMaxPixels;
  if (proxyMaxPixels === undefined && opt.proxyResolution) {
    if (opt.proxyResolution === '360p') proxyMaxPixels = 400_000;
    else if (opt.proxyResolution === '480p') proxyMaxPixels = 700_000;
    else if (opt.proxyResolution === '720p') proxyMaxPixels = 1_500_000;
    else if (opt.proxyResolution === '1080p') proxyMaxPixels = 3_000_000;
  }

  const schema = z
    .object({
      proxyMaxPixels: z.coerce
        .number()
        .min(100_000)
        .max(10_000_000)
        .catch(DEFAULT_USER_SETTINGS.optimization.proxyMaxPixels),
      proxyVideoBitrateMbps: z.coerce
        .number()
        .min(0.1)
        .max(50)
        .catch(DEFAULT_USER_SETTINGS.optimization.proxyVideoBitrateMbps),
      proxyAudioBitrateKbps: z.coerce
        .number()
        .min(32)
        .max(512)
        .catch(DEFAULT_USER_SETTINGS.optimization.proxyAudioBitrateKbps),
      proxyVideoCodec: z
        .enum(['h264', 'av1'])
        .catch(DEFAULT_USER_SETTINGS.optimization.proxyVideoCodec),
      proxyCopyOpusAudio: z.boolean().catch(DEFAULT_USER_SETTINGS.optimization.proxyCopyOpusAudio),
      autoCreateProxies: z.boolean().catch(DEFAULT_USER_SETTINGS.optimization.autoCreateProxies),
      mediaTaskConcurrency: z.coerce
        .number()
        .min(1)
        .max(16)
        .catch(DEFAULT_USER_SETTINGS.optimization.mediaTaskConcurrency),
      pixiRenderer: z
        .enum(['webgl', 'webgpu'])
        .catch(DEFAULT_USER_SETTINGS.optimization.pixiRenderer),
      videoFrameCacheMb: z.coerce
        .number()
        .min(0)
        .max(4096)
        .catch(DEFAULT_USER_SETTINGS.optimization.videoFrameCacheMb),
      ffmpegPath: z.string().catch(DEFAULT_USER_SETTINGS.optimization.ffmpegPath),
      ffprobePath: z.string().catch(DEFAULT_USER_SETTINGS.optimization.ffprobePath),
      hardwareAccelerationMode: z
        .enum(['none', 'vaapi', 'nvdec', 'auto'])
        .catch(DEFAULT_USER_SETTINGS.optimization.hardwareAccelerationMode),
      vaapiDevice: z.string().catch(DEFAULT_USER_SETTINGS.optimization.vaapiDevice),
      enableHardwareEncoding: z
        .boolean()
        .catch(DEFAULT_USER_SETTINGS.optimization.enableHardwareEncoding),
      nativeMonitorSyncMode: z
        .enum(['smooth', 'balanced', 'strict'])
        .catch(DEFAULT_USER_SETTINGS.optimization.nativeMonitorSyncMode),
    })
    .catch(DEFAULT_USER_SETTINGS.optimization);

  return schema.parse({
    ...opt,
    proxyMaxPixels,
    mediaTaskConcurrency: opt.mediaTaskConcurrency ?? opt.proxyConcurrency,
  });
}

export function normalizeIntegrationsSettings(raw: unknown): FastCatUserSettings['integrations'] {
  const schema = z
    .object({
      fastcatAccount: z
        .object({
          enabled: z.coerce.boolean().catch(false),
          bearerToken: z.string().transform(normalizeTokenValue).catch(''),
        })
        .catch(DEFAULT_USER_SETTINGS.integrations.fastcatAccount),
      fastcatPublicador: z
        .object({
          enabled: z.coerce.boolean().catch(false),
          bearerToken: z.string().transform(normalizeTokenValue).catch(''),
        })
        .catch(DEFAULT_USER_SETTINGS.integrations.fastcatPublicador),
      manualFilesApi: z
        .object({
          enabled: z.coerce.boolean().catch(false),
          baseUrl: z.string().transform(normalizeUrlValue).catch(''),
          bearerToken: z.string().transform(normalizeTokenValue).catch(''),
          overrideFastCat: z.coerce.boolean().catch(false),
        })
        .catch(DEFAULT_USER_SETTINGS.integrations.manualFilesApi),
      stt: z
        .object({
          provider: z.string().trim().catch(DEFAULT_USER_SETTINGS.integrations.stt.provider),
          models: z
            .array(z.string().trim())
            .catch([...DEFAULT_USER_SETTINGS.integrations.stt.models]),
          localModel: z.string().trim().catch(DEFAULT_USER_SETTINGS.integrations.stt.localModel),
          language: z
            .string()
            .trim()
            .catch(DEFAULT_USER_SETTINGS.integrations.stt.language ?? ''),
          restorePunctuation: z
            .boolean()
            .catch(DEFAULT_USER_SETTINGS.integrations.stt.restorePunctuation),
          formatText: z.boolean().catch(DEFAULT_USER_SETTINGS.integrations.stt.formatText),
          includeWords: z.boolean().catch(DEFAULT_USER_SETTINGS.integrations.stt.includeWords),
        })
        .catch(DEFAULT_USER_SETTINGS.integrations.stt),
    })
    .catch(DEFAULT_USER_SETTINGS.integrations);

  return schema.parse((raw as Record<string, unknown>)?.['integrations'] ?? {});
}

export function normalizeProjectDefaults(raw: unknown): FastCatUserSettings['projectDefaults'] {
  const schema = z
    .object({
      width: z.coerce.number().min(1).catch(DEFAULT_USER_SETTINGS.projectDefaults.width),
      height: z.coerce.number().min(1).catch(DEFAULT_USER_SETTINGS.projectDefaults.height),
      fps: z.coerce.number().min(1).max(240).catch(DEFAULT_USER_SETTINGS.projectDefaults.fps),
      resolutionFormat: z.string().catch(DEFAULT_USER_SETTINGS.projectDefaults.resolutionFormat),
      orientation: z
        .enum(['landscape', 'portrait'])
        .catch(DEFAULT_USER_SETTINGS.projectDefaults.orientation),
      aspectRatio: z.string().catch(DEFAULT_USER_SETTINGS.projectDefaults.aspectRatio),
      isCustomResolution: z.coerce
        .boolean()
        .catch(DEFAULT_USER_SETTINGS.projectDefaults.isCustomResolution),
      sampleRate: z.coerce
        .number()
        .min(8000)
        .max(192000)
        .catch(DEFAULT_USER_SETTINGS.projectDefaults.sampleRate),
      audioDeclickDurationUs: z.coerce
        .number()
        .min(0)
        .catch(DEFAULT_USER_SETTINGS.projectDefaults.audioDeclickDurationUs),
      defaultAudioFadeCurve: z
        .enum(['linear', 'logarithmic'])
        .catch(DEFAULT_USER_SETTINGS.projectDefaults.defaultAudioFadeCurve),
      audioScrubbingEnabled: z
        .boolean()
        .catch(DEFAULT_USER_SETTINGS.projectDefaults.audioScrubbingEnabled),
    })
    .catch(DEFAULT_USER_SETTINGS.projectDefaults);

  return schema.parse(raw);
}

export function normalizeMouseSettings(raw: unknown): FastCatUserSettings['mouse'] {
  const rWheelEnum = z.enum(RULER_WHEEL_ACTIONS);
  const clickEnum = z.enum(CLICK_ACTIONS);
  const timelineClickEnum = z.enum(TIMELINE_CLICK_ACTIONS);
  const dragEnum = z.enum(TIMELINE_DRAG_ACTIONS);
  const rulerDragEnum = z.enum(RULER_DRAG_ACTIONS);
  const horizEnum = z.enum(MOUSE_HORIZONTAL_MOVEMENT_ACTIONS);
  const tWheelEnum = z.enum(TIMELINE_WHEEL_ACTIONS);
  const thWheelEnum = z.enum(TRACK_HEADERS_WHEEL_ACTIONS);
  const mWheelEnum = z.enum(MONITOR_WHEEL_ACTIONS);
  const mClickEnum = z.enum(MONITOR_CLICK_ACTIONS);
  const mDragEnum = z.enum(MONITOR_DRAG_ACTIONS);

  const rulerWheelFallbacks = {
    wheel: DEFAULT_USER_SETTINGS.mouse.ruler.wheel,
    wheelSecondary: DEFAULT_USER_SETTINGS.mouse.ruler.wheelSecondary,
    wheelSecondaryShift: DEFAULT_USER_SETTINGS.mouse.ruler.wheelSecondaryShift,
  };

  const schema = z
    .object({
      ruler: z
        .object({
          wheel: rWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.wheel),
          wheelShift: rWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.wheelShift),
          wheelSecondary: rWheelEnum.catch(rulerWheelFallbacks.wheelSecondary),
          wheelSecondaryShift: rWheelEnum.catch(rulerWheelFallbacks.wheelSecondaryShift),
          click: clickEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.click),
          middleClick: clickEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.middleClick),
          doubleClick: clickEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.doubleClick),
          shiftClick: clickEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.shiftClick),
          drag: rulerDragEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.drag),
          middleDrag: rulerDragEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.middleDrag),
          dragShift: rulerDragEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.dragShift),
          horizontalMovement: horizEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.horizontalMovement),
        })
        .catch(DEFAULT_USER_SETTINGS.mouse.ruler),

      timeline: z
        .object({
          wheel: tWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.wheel),
          wheelShift: tWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.wheelShift),
          wheelSecondary: tWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.wheelSecondary),
          wheelSecondaryShift: tWheelEnum.catch(
            DEFAULT_USER_SETTINGS.mouse.timeline.wheelSecondaryShift,
          ),
          click: timelineClickEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.click),
          drag: dragEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.drag),
          middleClick: timelineClickEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.middleClick),
          middleDrag: dragEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.middleDrag),
          horizontalMovement: horizEnum.catch(
            DEFAULT_USER_SETTINGS.mouse.timeline.horizontalMovement,
          ),
          clipDragShift: dragEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.clipDragShift),
          clipDragCtrl: dragEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.clipDragCtrl),
          clipDragRight: dragEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.clipDragRight),
        })
        .catch(DEFAULT_USER_SETTINGS.mouse.timeline),

      trackHeaders: z
        .object({
          wheel: thWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.trackHeaders.wheel),
          wheelShift: thWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.trackHeaders.wheelShift),
          wheelSecondary: thWheelEnum.catch(
            DEFAULT_USER_SETTINGS.mouse.trackHeaders.wheelSecondary,
          ),
          wheelSecondaryShift: thWheelEnum.catch(
            DEFAULT_USER_SETTINGS.mouse.trackHeaders.wheelSecondaryShift,
          ),
          click: z
            .enum(['select_track', 'select_all_clips', 'none'])
            .catch(DEFAULT_USER_SETTINGS.mouse.trackHeaders.click),
          middleClick: z
            .enum(['select_track', 'select_all_clips', 'none'])
            .catch(DEFAULT_USER_SETTINGS.mouse.trackHeaders.middleClick),
          doubleClick: z
            .enum(['select_track', 'select_all_clips', 'none'])
            .catch(DEFAULT_USER_SETTINGS.mouse.trackHeaders.doubleClick),
        })
        .catch(DEFAULT_USER_SETTINGS.mouse.trackHeaders),

      monitor: z
        .object({
          wheel: mWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.monitor.wheel),
          wheelShift: mWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.monitor.wheelShift),
          wheelSecondary: mWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.monitor.wheelSecondary),
          wheelSecondaryShift: mWheelEnum.catch(
            DEFAULT_USER_SETTINGS.mouse.monitor.wheelSecondaryShift,
          ),
          middleClick: mClickEnum.catch(DEFAULT_USER_SETTINGS.mouse.monitor.middleClick),
          doubleClick: mClickEnum.catch(DEFAULT_USER_SETTINGS.mouse.monitor.doubleClick),
          middleDrag: mDragEnum.catch(DEFAULT_USER_SETTINGS.mouse.monitor.middleDrag),
        })
        .catch(DEFAULT_USER_SETTINGS.mouse.monitor),
    })
    .catch(DEFAULT_USER_SETTINGS.mouse);

  return schema.parse(raw ?? {});
}

export function normalizeHistorySettings(raw: unknown): FastCatUserSettings['history'] {
  return z
    .object({
      maxEntries: z.coerce
        .number()
        .min(1)
        .max(1000)
        .catch(DEFAULT_USER_SETTINGS.history.maxEntries),
    })
    .catch(DEFAULT_USER_SETTINGS.history)
    .parse((raw as Record<string, unknown>)?.['history'] ?? {});
}

export function normalizeBackupSettings(raw: unknown): FastCatUserSettings['backup'] {
  const input = ((raw as Record<string, unknown>)?.['backup'] ?? {}) as Record<string, unknown>;
  // Migrate the legacy `intervalMinutes` field (where `<= 0` meant disabled) to
  // the `enabled` toggle when an explicit `enabled` value is not present.
  const legacyInterval = input['intervalMinutes'];
  const enabled =
    typeof input['enabled'] === 'boolean'
      ? (input['enabled'] as boolean)
      : legacyInterval !== undefined
        ? Number(legacyInterval) > 0
        : DEFAULT_USER_SETTINGS.backup.enabled;

  return z
    .object({
      enabled: z.boolean().catch(DEFAULT_USER_SETTINGS.backup.enabled),
      count: z.coerce.number().min(1).max(50).catch(DEFAULT_USER_SETTINGS.backup.count),
    })
    .catch(DEFAULT_USER_SETTINGS.backup)
    .parse({ enabled, count: input['count'] });
}

export function normalizeAutosaveSettings(raw: unknown): FastCatUserSettings['autosave'] {
  return z
    .object({
      intervalMinutes: z.coerce
        .number()
        .min(1)
        .max(60)
        .catch(DEFAULT_USER_SETTINGS.autosave.intervalMinutes),
    })
    .catch(DEFAULT_USER_SETTINGS.autosave)
    .parse((raw as Record<string, unknown>)?.['autosave'] ?? {});
}

export function normalizeAudioEngineSettings(raw: unknown): FastCatUserSettings['audioEngine'] {
  const input = ((raw as Record<string, unknown>)?.['audioEngine'] ?? {}) as Record<
    string,
    unknown
  >;

  const bufferSizeSchema = z
    .union([
      z.literal('default'),
      z.literal(64),
      z.literal(128),
      z.literal(256),
      z.literal(512),
      z.literal(1024),
      z.literal(2048),
      z.literal(4096),
    ])
    .catch(DEFAULT_USER_SETTINGS.audioEngine.bufferSize);

  const backendSchema = z
    .union([
      z.literal('default'),
      z.literal('alsa'),
      z.literal('pulseaudio'),
      z.literal('jack'),
      z.literal('wasapi'),
      z.literal('coreaudio'),
    ])
    .catch(DEFAULT_USER_SETTINGS.audioEngine.backend);

  return z
    .object({
      bufferSize: bufferSizeSchema,
      backend: backendSchema,
    })
    .catch(DEFAULT_USER_SETTINGS.audioEngine)
    .parse(input);
}

export function normalizePresetsSettings(raw: unknown): FastCatUserSettings['presets'] {
  const input = (raw as Record<string, unknown>)?.['presets'];
  const defaults = DEFAULT_USER_SETTINGS.presets;
  if (!input || typeof input !== 'object') {
    return {
      custom: [...defaults.custom],
      defaultTextPresetId: defaults.defaultTextPresetId,
      collapsed: { ...defaults.collapsed },
    };
  }
  const d = input as Record<string, unknown>;
  return {
    custom: Array.isArray(d.custom) ? d.custom : [...defaults.custom],
    defaultTextPresetId:
      typeof d.defaultTextPresetId === 'string'
        ? d.defaultTextPresetId
        : defaults.defaultTextPresetId,
    collapsed:
      d.collapsed && typeof d.collapsed === 'object'
        ? (d.collapsed as Record<string, boolean>)
        : { ...defaults.collapsed },
  };
}
