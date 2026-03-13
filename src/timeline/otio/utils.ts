import type {
  TimelineTimebase,
  TimelineRange,
  TrackKind,
  ClipTransform,
  TimelineBlendMode,
} from '../types';
import type { OtioRationalTime, OtioTimeRange } from './types';

export const TIME_RATE_US = 1_000_000;

export function toRationalTime(us: number, fps?: number): OtioRationalTime {
  if (fps && fps > 0) {
    return {
      OTIO_SCHEMA: 'RationalTime.1',
      value: Math.round((us / TIME_RATE_US) * fps),
      rate: fps,
    };
  }
  return {
    OTIO_SCHEMA: 'RationalTime.1',
    value: Math.round(us),
    rate: TIME_RATE_US,
  };
}

export function fromRationalTimeUs(rt: any): number {
  const value = Number(rt?.value);
  const rate = Number(rt?.rate);
  if (!Number.isFinite(value) || !Number.isFinite(rate) || rate <= 0) return 0;
  if (rate === TIME_RATE_US) return Math.round(value);
  return Math.round((value / rate) * TIME_RATE_US);
}

export function toTimeRange(range: TimelineRange, fps?: number): OtioTimeRange {
  return {
    OTIO_SCHEMA: 'TimeRange.1',
    start_time: toRationalTime(range.startUs, fps),
    duration: toRationalTime(range.durationUs, fps),
  };
}

export function fromTimeRange(tr: any): TimelineRange {
  return {
    startUs: fromRationalTimeUs(tr?.start_time),
    durationUs: fromRationalTimeUs(tr?.duration),
  };
}

export function trackKindToOtioKind(kind: TrackKind): 'Video' | 'Audio' {
  return kind === 'audio' ? 'Audio' : 'Video';
}

export function trackKindFromOtioKind(kind: any): TrackKind {
  return kind === 'Audio' ? 'audio' : 'video';
}

export function assertTimelineTimebase(raw: any): TimelineTimebase {
  const fps = Number(raw?.fps);
  if (!Number.isFinite(fps) || fps <= 0) return { fps: 25 };
  return { fps: Math.min(240, Math.max(1, Math.round(fps * 1000) / 1000)) };
}

export function coerceId(raw: any, fallback: string): string {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
}

export function coerceBlendMode(raw: unknown): TimelineBlendMode | undefined {
  return raw === 'add' ||
    raw === 'multiply' ||
    raw === 'screen' ||
    raw === 'darken' ||
    raw === 'lighten' ||
    raw === 'normal'
    ? raw
    : undefined;
}

export function coerceName(raw: any, fallback: string): string {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(min, Math.min(max, n));
}

export function coerceTransform(raw: any): ClipTransform | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const scaleRaw = (raw as any).scale;
  const scale =
    scaleRaw && typeof scaleRaw === 'object'
      ? {
          x: clampNumber((scaleRaw as any).x, -1000, 1000),
          y: clampNumber((scaleRaw as any).y, -1000, 1000),
          linked:
            (scaleRaw as any).linked !== undefined ? Boolean((scaleRaw as any).linked) : undefined,
        }
      : undefined;

  const rotationDegRaw = (raw as any).rotationDeg;
  const rotationDeg =
    typeof rotationDegRaw === 'number' && Number.isFinite(rotationDegRaw)
      ? Math.max(-36000, Math.min(36000, rotationDegRaw))
      : undefined;

  const positionRaw = (raw as any).position;
  const position =
    positionRaw && typeof positionRaw === 'object'
      ? {
          x: clampNumber((positionRaw as any).x, -1_000_000, 1_000_000),
          y: clampNumber((positionRaw as any).y, -1_000_000, 1_000_000),
        }
      : undefined;

  const anchorRaw = (raw as any).anchor;
  const preset =
    anchorRaw && typeof anchorRaw === 'object' ? String((anchorRaw as any).preset ?? '') : '';
  const safePreset =
    preset === 'center' ||
    preset === 'topLeft' ||
    preset === 'topRight' ||
    preset === 'bottomLeft' ||
    preset === 'bottomRight' ||
    preset === 'custom'
      ? (preset as import('../types').ClipAnchorPreset)
      : undefined;
  const anchor =
    safePreset !== undefined
      ? {
          preset: safePreset,
          x: safePreset === 'custom' ? clampNumber((anchorRaw as any).x, -10, 10) : undefined,
          y: safePreset === 'custom' ? clampNumber((anchorRaw as any).y, -10, 10) : undefined,
        }
      : undefined;

  if (!scale && rotationDeg === undefined && !position && !anchor) return undefined;
  return { scale, rotationDeg, position, anchor };
}

export function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function buildFallbackItemId(input: {
  prefix: 'clip' | 'gap';
  trackId: string;
  fingerprint: string;
  occupiedIds: Set<string>;
}): string {
  const base = `${input.prefix}_${input.trackId}_${hashString(input.fingerprint)}`;
  if (!input.occupiedIds.has(base)) {
    input.occupiedIds.add(base);
    return base;
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${base}_${suffix}`;
    if (!input.occupiedIds.has(candidate)) {
      input.occupiedIds.add(candidate);
      return candidate;
    }
    suffix += 1;
  }

  const emergency = `${base}_${Date.now()}`;
  input.occupiedIds.add(emergency);
  return emergency;
}

export function resolveStableItemId(input: {
  prefix: 'clip' | 'gap';
  trackId: string;
  fallbackFingerprint: string;
  metadata: any;
  occupiedIds: Set<string>;
}): string {
  const metadataId = coerceId(input.metadata?.id, '');
  if (metadataId && !input.occupiedIds.has(metadataId)) {
    input.occupiedIds.add(metadataId);
    return metadataId;
  }

  return buildFallbackItemId({
    prefix: input.prefix,
    trackId: input.trackId,
    fingerprint: input.fallbackFingerprint,
    occupiedIds: input.occupiedIds,
  });
}

export function safeFastCatMetadata(raw: any): any {
  if (!raw || typeof raw !== 'object') return {};
  const fastcat = (raw as any).fastcat;
  if (!fastcat || typeof fastcat !== 'object') return {};
  return fastcat;
}

export function isOtioPath(value: unknown): value is string {
  return typeof value === 'string' && value.trim().toLowerCase().endsWith('.otio');
}
