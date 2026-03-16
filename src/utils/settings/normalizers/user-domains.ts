import { DEFAULT_USER_SETTINGS, type FastCatUserSettings } from '../defaults';
import {
  CLICK_ACTIONS,
  DRAG_ACTIONS,
  MONITOR_CLICK_ACTIONS,
  MONITOR_DRAG_ACTIONS,
  MONITOR_WHEEL_ACTIONS,
  MOUSE_HORIZONTAL_MOVEMENT_ACTIONS,
  RULER_WHEEL_ACTIONS,
  TIMELINE_WHEEL_ACTIONS,
  TRACK_HEADERS_WHEEL_ACTIONS,
} from '~/utils/mouse';
import { asRecord, normalizeTokenValue, normalizeUrlValue } from './shared';

export function normalizeOpenLastProjectOnStart(input: Record<string, unknown>): boolean {
  const openLastProjectOnStartRaw = input.openLastProjectOnStart;
  const openBehavior = input.openBehavior;

  if (typeof openLastProjectOnStartRaw === 'boolean') {
    return openLastProjectOnStartRaw;
  }

  if (openBehavior === 'show_project_picker') {
    return false;
  }

  return DEFAULT_USER_SETTINGS.openLastProjectOnStart;
}

export function normalizeTimelineSettings(
  input: Record<string, unknown>,
): FastCatUserSettings['timeline'] {
  const legacyTimelineSnapThresholdPx = Number(input.snapThresholdPx);
  const rawTimeline = asRecord(input.timeline);
  const timelineSnapThresholdPxRaw = Number(rawTimeline.snapThresholdPx);
  const timelineSnapThresholdPxCandidate = Number.isFinite(timelineSnapThresholdPxRaw)
    ? timelineSnapThresholdPxRaw
    : legacyTimelineSnapThresholdPx;

  return {
    snapThresholdPx:
      Number.isFinite(timelineSnapThresholdPxCandidate) && timelineSnapThresholdPxCandidate > 0
        ? Math.max(1, Math.round(timelineSnapThresholdPxCandidate))
        : DEFAULT_USER_SETTINGS.timeline.snapThresholdPx,
    defaultTransitionDurationUs: Number.isFinite(Number(rawTimeline.defaultTransitionDurationUs))
      ? Math.max(0, Math.round(Number(rawTimeline.defaultTransitionDurationUs)))
      : DEFAULT_USER_SETTINGS.timeline.defaultTransitionDurationUs,
    defaultStaticClipDurationUs: Number.isFinite(Number(rawTimeline.defaultStaticClipDurationUs))
      ? Math.max(0, Math.round(Number(rawTimeline.defaultStaticClipDurationUs)))
      : DEFAULT_USER_SETTINGS.timeline.defaultStaticClipDurationUs,
  };
}

export function normalizeStopFramesSettings(
  input: Record<string, unknown>,
): FastCatUserSettings['stopFrames'] {
  const stopFramesInput = asRecord(input.stopFrames);
  const qualityPercentRaw =
    stopFramesInput.qualityPercent ?? input.stopFrameQualityPercent ?? input.stopFramesQuality;
  const qualityPercentParsed = Number(qualityPercentRaw);

  return {
    qualityPercent:
      Number.isFinite(qualityPercentParsed) && qualityPercentParsed > 0
        ? Math.round(Math.min(100, Math.max(1, qualityPercentParsed)))
        : DEFAULT_USER_SETTINGS.stopFrames.qualityPercent,
  };
}

export function normalizeOptimizationSettings(
  input: Record<string, unknown>,
): FastCatUserSettings['optimization'] {
  const optimizationInput = asRecord(input.optimization);
  const proxyMaxPixels = Number(optimizationInput.proxyMaxPixels);
  const proxyResolutionRaw = optimizationInput.proxyResolution;
  const proxyVideoBitrateMbps = Number(optimizationInput.proxyVideoBitrateMbps);
  const proxyAudioBitrateKbps = Number(optimizationInput.proxyAudioBitrateKbps);
  const proxyVideoCodec = optimizationInput.proxyVideoCodec === 'av1' ? 'av1' : 'h264';
  const proxyCopyOpusAudio = optimizationInput.proxyCopyOpusAudio;
  const autoCreateProxies = optimizationInput.autoCreateProxies;
  const mediaTaskConcurrency = Number(
    optimizationInput.mediaTaskConcurrency ?? optimizationInput.proxyConcurrency,
  );
  const videoFrameCacheMb = Number(optimizationInput.videoFrameCacheMb);

  return {
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
    proxyVideoCodec,
    proxyCopyOpusAudio:
      typeof proxyCopyOpusAudio === 'boolean'
        ? proxyCopyOpusAudio
        : DEFAULT_USER_SETTINGS.optimization.proxyCopyOpusAudio,
    autoCreateProxies:
      typeof autoCreateProxies === 'boolean'
        ? autoCreateProxies
        : DEFAULT_USER_SETTINGS.optimization.autoCreateProxies,
    mediaTaskConcurrency:
      Number.isFinite(mediaTaskConcurrency) && mediaTaskConcurrency > 0
        ? Math.min(16, Math.max(1, Math.round(mediaTaskConcurrency)))
        : DEFAULT_USER_SETTINGS.optimization.mediaTaskConcurrency,
    videoFrameCacheMb:
      Number.isFinite(videoFrameCacheMb) && videoFrameCacheMb >= 0
        ? Math.min(4096, Math.max(0, Math.round(videoFrameCacheMb)))
        : DEFAULT_USER_SETTINGS.optimization.videoFrameCacheMb,
  };
}

export function normalizeIntegrationsSettings(
  input: Record<string, unknown>,
): FastCatUserSettings['integrations'] {
  const integrationsInput = asRecord(input.integrations);
  const fastcatPublicadorInput = asRecord(integrationsInput.fastcatPublicador);
  const manualFilesApiInput = asRecord(integrationsInput.manualFilesApi);
  const manualSttApiInput = asRecord(integrationsInput.manualSttApi);
  const sttInput = asRecord(integrationsInput.stt);

  return {
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
  };
}

export function normalizeVideoSettings(
  input: Record<string, unknown>,
): FastCatUserSettings['video'] {
  const videoInput = asRecord(input.video);

  return {
    enableFfmpeg:
      typeof videoInput.enableFfmpeg === 'boolean'
        ? videoInput.enableFfmpeg
        : DEFAULT_USER_SETTINGS.video.enableFfmpeg,
  };
}

export function normalizeMouseSettings(raw: unknown): FastCatUserSettings['mouse'] {
  const normalizedMouse: FastCatUserSettings['mouse'] = {
    ruler: { ...DEFAULT_USER_SETTINGS.mouse.ruler },
    timeline: { ...DEFAULT_USER_SETTINGS.mouse.timeline },
    trackHeaders: { ...DEFAULT_USER_SETTINGS.mouse.trackHeaders },
    monitor: { ...DEFAULT_USER_SETTINGS.mouse.monitor },
  };

  if (!raw || typeof raw !== 'object') {
    return normalizedMouse;
  }

  const rawMouse = asRecord(raw);
  const rawRuler = asRecord(rawMouse.ruler);

  const rulerWheelFallbacks = {
    wheel: DEFAULT_USER_SETTINGS.mouse.timeline.wheel,
    wheelSecondary: DEFAULT_USER_SETTINGS.mouse.timeline.wheel,
    wheelSecondaryShift: DEFAULT_USER_SETTINGS.mouse.ruler.wheel,
  } as const;

  for (const key of ['wheel', 'wheelShift', 'wheelSecondary', 'wheelSecondaryShift']) {
    const rawValue = rawRuler[key] as string | undefined;
    if ((RULER_WHEEL_ACTIONS as readonly string[]).includes(rawValue as string)) {
      (normalizedMouse.ruler as Record<string, unknown>)[key] = rawValue;
      continue;
    }

    const fallbackKey = key as keyof typeof rulerWheelFallbacks;
    if (fallbackKey in rulerWheelFallbacks) {
      (normalizedMouse.ruler as Record<string, unknown>)[key] = rulerWheelFallbacks[fallbackKey];
    }
  }

  for (const key of ['click', 'middleClick', 'doubleClick', 'shiftClick']) {
    if ((CLICK_ACTIONS as readonly string[]).includes(rawRuler[key] as string)) {
      (normalizedMouse.ruler as Record<string, unknown>)[key] = rawRuler[key];
    }
  }

  for (const key of ['drag', 'middleDrag', 'dragShift']) {
    if ((DRAG_ACTIONS as readonly string[]).includes(rawRuler[key] as string)) {
      (normalizedMouse.ruler as Record<string, unknown>)[key] = rawRuler[key];
    }
  }

  if (
    (MOUSE_HORIZONTAL_MOVEMENT_ACTIONS as readonly string[]).includes(
      rawRuler.horizontalMovement as string,
    )
  ) {
    normalizedMouse.ruler.horizontalMovement = rawRuler.horizontalMovement as
      | 'move_playhead'
      | 'none';
  }

  const rawTimeline = asRecord(rawMouse.timeline);
  const timelineWheelFallbacks = {
    wheelShift: DEFAULT_USER_SETTINGS.mouse.timeline.wheelShift,
    wheelSecondaryShift: 'none',
  } as const;

  for (const key of ['wheel', 'wheelShift', 'wheelSecondary', 'wheelSecondaryShift']) {
    const rawValue = rawTimeline[key] as string | undefined;
    if ((TIMELINE_WHEEL_ACTIONS as readonly string[]).includes(rawValue as string)) {
      (normalizedMouse.timeline as Record<string, unknown>)[key] = rawValue;
      continue;
    }

    const fallbackKey = key as keyof typeof timelineWheelFallbacks;
    if (fallbackKey in timelineWheelFallbacks) {
      (normalizedMouse.timeline as Record<string, unknown>)[key] =
        timelineWheelFallbacks[fallbackKey];
    }
  }

  for (const key of ['middleClick']) {
    if ((CLICK_ACTIONS as readonly string[]).includes(rawTimeline[key] as string)) {
      (normalizedMouse.timeline as Record<string, unknown>)[key] = rawTimeline[key];
      continue;
    }

    (normalizedMouse.timeline as Record<string, unknown>)[key] =
      DEFAULT_USER_SETTINGS.mouse.timeline.middleDrag;
  }

  for (const key of ['middleDrag']) {
    if ((DRAG_ACTIONS as readonly string[]).includes(rawTimeline[key] as string)) {
      (normalizedMouse.timeline as Record<string, unknown>)[key] = rawTimeline[key];
    }
  }

  if (
    (MOUSE_HORIZONTAL_MOVEMENT_ACTIONS as readonly string[]).includes(
      rawTimeline.horizontalMovement as string,
    )
  ) {
    normalizedMouse.timeline.horizontalMovement = rawTimeline.horizontalMovement as
      | 'move_playhead'
      | 'none';
  }

  const rawTrackHeaders = asRecord(rawMouse.trackHeaders);
  const trackHeadersWheelFallbacks = {
    wheel: 'seek_frame',
    wheelShift: DEFAULT_USER_SETTINGS.mouse.trackHeaders.wheelShift,
  } as const;

  for (const key of ['wheel', 'wheelShift', 'wheelSecondary', 'wheelSecondaryShift']) {
    const rawValue = rawTrackHeaders[key] as string | undefined;
    if ((TRACK_HEADERS_WHEEL_ACTIONS as readonly string[]).includes(rawValue as string)) {
      (normalizedMouse.trackHeaders as Record<string, unknown>)[key] = rawValue;
      continue;
    }

    const fallbackKey = key as keyof typeof trackHeadersWheelFallbacks;
    if (fallbackKey in trackHeadersWheelFallbacks) {
      (normalizedMouse.trackHeaders as Record<string, unknown>)[key] =
        trackHeadersWheelFallbacks[fallbackKey];
    }
  }

  const rawMonitor = asRecord(rawMouse.monitor);
  const monitorWheelFallbacks = {
    wheelShift: DEFAULT_USER_SETTINGS.mouse.monitor.wheelShift,
  } as const;

  for (const key of ['wheel', 'wheelShift', 'wheelSecondary', 'wheelSecondaryShift']) {
    const rawValue = rawMonitor[key] as string | undefined;
    if ((MONITOR_WHEEL_ACTIONS as readonly string[]).includes(rawValue as string)) {
      (normalizedMouse.monitor as Record<string, unknown>)[key] = rawValue;
      continue;
    }

    const fallbackKey = key as keyof typeof monitorWheelFallbacks;
    if (fallbackKey in monitorWheelFallbacks) {
      (normalizedMouse.monitor as Record<string, unknown>)[key] =
        monitorWheelFallbacks[fallbackKey];
    }
  }

  for (const key of ['middleClick']) {
    if ((MONITOR_CLICK_ACTIONS as readonly string[]).includes(rawMonitor[key] as string)) {
      (normalizedMouse.monitor as Record<string, unknown>)[key] = rawMonitor[key];
    }
  }

  for (const key of ['middleDrag']) {
    if ((MONITOR_DRAG_ACTIONS as readonly string[]).includes(rawMonitor[key] as string)) {
      (normalizedMouse.monitor as Record<string, unknown>)[key] = rawMonitor[key];
    }
  }

  return normalizedMouse;
}
