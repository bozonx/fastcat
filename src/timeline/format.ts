import type { TimelineDocument, TimelineFormat } from './types';
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
  settingsSource: 'projectDefaults',
  exportFormat: 'mp4',
  videoCodec: 'avc1.640032',
  videoBitrateMbps: 5,
  excludeAudio: false,
  audioCodec: 'aac',
  audioBitrateKbps: 128,
  audioChannels: 2,
  bitrateMode: 'variable',
  keyframeIntervalSec: 2,
  exportAlpha: false,
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
  settingsSource?: unknown;

  exportFormat?: unknown;
  videoCodec?: unknown;
  videoBitrateMbps?: unknown;
  excludeAudio?: unknown;
  audioCodec?: unknown;
  audioBitrateKbps?: unknown;
  audioChannels?: unknown;
  bitrateMode?: unknown;
  keyframeIntervalSec?: unknown;
  exportAlpha?: unknown;
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
    isAutoSettings:
      typeof input?.isAutoSettings === 'boolean' ? input.isAutoSettings : fallback.isAutoSettings,
    settingsSource,

    exportFormat: (input?.exportFormat as 'mp4' | 'webm' | 'mkv') ?? fallback.exportFormat ?? 'mp4',
    videoCodec: (input?.videoCodec as string) ?? fallback.videoCodec ?? 'avc1.640032',
    videoBitrateMbps: toNumber(input?.videoBitrateMbps, fallback.videoBitrateMbps ?? 5, 0.2, 200),
    excludeAudio: typeof input?.excludeAudio === 'boolean' ? input.excludeAudio : (fallback.excludeAudio ?? false),
    audioCodec: (input?.audioCodec as 'aac' | 'opus' | 'flac' | 'pcm' | 'mp3') ?? fallback.audioCodec ?? 'aac',
    audioBitrateKbps: toInt(input?.audioBitrateKbps, fallback.audioBitrateKbps ?? 128, 8, 512),
    audioChannels: toInt(input?.audioChannels, fallback.audioChannels ?? 2, 1, 8),
    bitrateMode: (input?.bitrateMode as 'constant' | 'variable') ?? fallback.bitrateMode ?? 'variable',
    keyframeIntervalSec: toInt(input?.keyframeIntervalSec, fallback.keyframeIntervalSec ?? 2, 1, 60),
    exportAlpha: typeof input?.exportAlpha === 'boolean' ? input.exportAlpha : (fallback.exportAlpha ?? false),
  };
}

export function createTimelineFormatFromProjectDefaults(project: TimelineFormatInput) {
  return normalizeTimelineFormat({
    ...project,
    isAutoSettings: typeof project.isAutoSettings === 'boolean' ? project.isAutoSettings : true,
    settingsSource: 'projectDefaults',
  });
}

export function getTimelineFormat(doc: TimelineDocument | null | undefined): TimelineFormat {
  return normalizeTimelineFormat(doc?.metadata?.fastcat?.format, {
    ...DEFAULT_TIMELINE_FORMAT,
    fps: doc?.timebase?.fps ?? DEFAULT_TIMELINE_FORMAT.fps,
  });
}

export function setTimelineFormat(
  doc: TimelineDocument,
  nextFormat: TimelineFormatInput,
): TimelineDocument {
  const format = normalizeTimelineFormat(nextFormat, getTimelineFormat(doc));

  return {
    ...doc,
    timebase: { fps: format.fps },
    metadata: {
      ...(doc.metadata ?? {}),
      fastcat: {
        ...(doc.metadata?.fastcat ?? {}),
        timebase: { fps: format.fps },
        format,
      },
    },
  };
}
