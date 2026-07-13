import type { TimelineDocument, TimelineFormat } from './types';
import { createTimelineTimebaseFromFps, getTimelineFps } from './timebase';
import { getResolutionPreset } from '~/utils/settings/helpers';

export const DEFAULT_TIMELINE_FORMAT: TimelineFormat = {
  width: 1920,
  height: 1080,
  fps: 25,
  resolutionFormat: '1080p',
  orientation: 'landscape',
  aspectRatio: '16:9',
  isCustomResolution: false,
  sampleRate: 48000,
  isAutoSettings: true,
  geometryResolved: false,
  sampleRateResolved: false,
  settingsSource: 'projectDefaults',
  useProjectSettings: false,
};

export interface TimelineFormatInput {
  width?: unknown;
  height?: unknown;
  fps?: unknown;
  resolutionFormat?: unknown;
  orientation?: unknown;
  aspectRatio?: unknown;
  isCustomResolution?: unknown;
  sampleRate?: unknown;
  isAutoSettings?: unknown;
  geometryResolved?: unknown;
  sampleRateResolved?: unknown;
  settingsSource?: unknown;
  useProjectSettings?: unknown;
}

function toNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(toNumber(value, fallback, min, max));
}

function toString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function normalizeTimelineFormat(
  input: TimelineFormatInput | null | undefined,
  fallback: TimelineFormat = DEFAULT_TIMELINE_FORMAT,
): TimelineFormat {
  const width = toInt(input?.width, fallback.width, 1, 7680);
  const height = toInt(input?.height, fallback.height, 1, 7680);
  const preset = getResolutionPreset(width, height);
  const fps = Math.round(toNumber(input?.fps, fallback.fps, 1, 240) * 1000) / 1000;
  const orientation =
    input?.orientation === 'portrait' || input?.orientation === 'landscape'
      ? input.orientation
      : (preset.orientation as 'landscape' | 'portrait');
  const settingsSource =
    input?.settingsSource === 'manual' || input?.settingsSource === 'firstClip'
      ? input.settingsSource
      : 'projectDefaults';
  const isAutoSettings =
    typeof input?.isAutoSettings === 'boolean' ? input.isAutoSettings : fallback.isAutoSettings;
  const geometryResolvedFallback =
    typeof input?.isAutoSettings === 'boolean'
      ? !isAutoSettings
      : (fallback.geometryResolved ?? !isAutoSettings);
  const sampleRateResolvedFallback =
    typeof input?.isAutoSettings === 'boolean'
      ? !isAutoSettings
      : (fallback.sampleRateResolved ?? !isAutoSettings);

  return {
    width,
    height,
    fps,
    resolutionFormat: toString(input?.resolutionFormat, preset.resolutionFormat),
    orientation,
    aspectRatio: toString(input?.aspectRatio, preset.aspectRatio),
    isCustomResolution:
      typeof input?.isCustomResolution === 'boolean'
        ? input.isCustomResolution
        : preset.isCustomResolution,
    sampleRate: toInt(input?.sampleRate, fallback.sampleRate, 8000, 192000),
    isAutoSettings,
    geometryResolved:
      typeof input?.geometryResolved === 'boolean'
        ? input.geometryResolved
        : geometryResolvedFallback,
    sampleRateResolved:
      typeof input?.sampleRateResolved === 'boolean'
        ? input.sampleRateResolved
        : sampleRateResolvedFallback,
    settingsSource,
    useProjectSettings:
      typeof input?.useProjectSettings === 'boolean'
        ? input.useProjectSettings
        : (fallback.useProjectSettings ?? true),
  };
}

export function createTimelineFormatFromProjectDefaults(project: TimelineFormatInput) {
  const isAutoSettings =
    typeof project.isAutoSettings === 'boolean' ? project.isAutoSettings : true;
  return normalizeTimelineFormat({
    ...project,
    isAutoSettings,
    geometryResolved: !isAutoSettings,
    sampleRateResolved: !isAutoSettings,
    settingsSource: 'projectDefaults',
    useProjectSettings: false,
  });
}

/** Geometry/audio fields a timeline inherits from the project when following it. */
export interface ProjectFormatSource {
  width: number;
  height: number;
  fps: number;
  resolutionFormat: string;
  orientation: 'landscape' | 'portrait';
  aspectRatio: string;
  isCustomResolution: boolean;
  sampleRate: number;
}

/**
 * Resolves the *effective* timeline format: when the timeline follows the
 * project (`useProjectSettings`, default true), its resolution/fps/sample-rate
 * are overridden by the live project settings. The doc's own stored format is a
 * stale snapshot taken at creation time and is NOT updated when project settings
 * change, so every renderer (monitor, export, thumbnails) must resolve through
 * here rather than reading `getTimelineFormat(doc)` directly — otherwise it
 * composes at the snapshot size while the project has moved on.
 */
export function resolveEffectiveTimelineFormat(
  format: TimelineFormat,
  project: Partial<ProjectFormatSource> | null | undefined,
): TimelineFormat {
  if ((format.useProjectSettings ?? true) && project) {
    return {
      ...format,
      width: project.width ?? format.width,
      height: project.height ?? format.height,
      fps: project.fps ?? format.fps,
      resolutionFormat: project.resolutionFormat ?? format.resolutionFormat,
      orientation: project.orientation ?? format.orientation,
      aspectRatio: project.aspectRatio ?? format.aspectRatio,
      isCustomResolution: project.isCustomResolution ?? format.isCustomResolution,
      sampleRate: project.sampleRate ?? format.sampleRate,
    };
  }
  return format;
}

export function getTimelineFormat(doc: TimelineDocument | null | undefined): TimelineFormat {
  return normalizeTimelineFormat(doc?.metadata?.fastcat?.format, {
    ...DEFAULT_TIMELINE_FORMAT,
    fps: getTimelineFps(doc?.timebase, { num: DEFAULT_TIMELINE_FORMAT.fps, den: 1 }),
  });
}

export function setTimelineFormat(
  doc: TimelineDocument,
  nextFormat: TimelineFormatInput,
): TimelineDocument {
  const format = normalizeTimelineFormat(nextFormat, getTimelineFormat(doc));
  const timebase = createTimelineTimebaseFromFps(format.fps);

  return {
    ...doc,
    timebase,
    metadata: {
      ...(doc.metadata ?? {}),
      fastcat: {
        ...(doc.metadata?.fastcat ?? {}),
        timebase,
        format,
      },
    },
  };
}
