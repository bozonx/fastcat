import { createDevLogger } from '~/utils/dev-logger';
import type {
  TimelineTimebase,
  TimelineRange,
  TrackKind,
  ClipTransform,
  ClipAnimations,
  TimelineBlendMode,
  ClipAnchorPreset,
  KeyframeTrack,
} from '../types';
import { createTimelineTimebase, createTimelineTimebaseFromFps } from '../timebase';
import { sanitizeFrameRate } from '~/utils/time/ticks';
import { secondsToTicks, ticksToSeconds } from '~/utils/time/ticks';
import type { OtioRationalTime, OtioTimeRange, OtioColor } from './types';
import { isAnimatableParamPath, normalizeKeyframeTrack } from '../animation/evaluate';
const log = createDevLogger('utils');

export const TIME_RATE_US = 1_000_000;

export function toRationalTime(ticks: number, rate?: number): OtioRationalTime {
  const seconds = ticksToSeconds(ticks);
  if (rate && rate > 0) {
    return {
      OTIO_SCHEMA: 'RationalTime.1',
      value: Math.round(seconds * rate),
      rate,
    };
  }
  return {
    OTIO_SCHEMA: 'RationalTime.1',
    value: Math.round(seconds * TIME_RATE_US),
    rate: TIME_RATE_US,
  };
}

export function fromRationalTimeUs(rt: unknown): number {
  if (!rt || typeof rt !== 'object') return 0;
  const value = Number((rt as Record<string, unknown>).value);
  const rate = Number((rt as Record<string, unknown>).rate);
  if (!Number.isFinite(value) || !Number.isFinite(rate) || rate <= 0) return 0;
  return secondsToTicks({ seconds: value / rate });
}

export function toTimeRange(range: TimelineRange, rate?: number): OtioTimeRange {
  return {
    OTIO_SCHEMA: 'TimeRange.1',
    start_time: toRationalTime(range.startUs, rate),
    duration: toRationalTime(range.durationUs, rate),
  };
}

export function fromTimeRange(tr: unknown): TimelineRange {
  if (!tr || typeof tr !== 'object') return { startUs: 0, durationUs: 0 };
  return {
    startUs: fromRationalTimeUs((tr as Record<string, unknown>).start_time),
    durationUs: fromRationalTimeUs((tr as Record<string, unknown>).duration),
  };
}

export function trackKindToOtioKind(kind: TrackKind): 'Video' | 'Audio' {
  return kind === 'audio' ? 'Audio' : 'Video';
}

export function normalizeTrackKind(kind: unknown): TrackKind | null {
  if (kind === 'audio' || kind === 'video') return kind;
  if (typeof kind !== 'string') return null;

  const normalized = kind.trim().toLowerCase();
  if (normalized === 'audio' || normalized === 'video') return normalized;

  return null;
}

export function trackKindFromOtioKind(kind: unknown): TrackKind {
  return normalizeTrackKind(kind) ?? 'video';
}

export function assertTimelineTimebase(raw: unknown): TimelineTimebase {
  if (!raw || typeof raw !== 'object') return createTimelineTimebaseFromFps(25);
  return createTimelineTimebase(sanitizeFrameRate(raw, { num: 25, den: 1 }));
}

export function coerceId(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
}

export function coerceBlendMode(raw: unknown): TimelineBlendMode | undefined {
  return raw === 'add' ||
    raw === 'multiply' ||
    raw === 'screen' ||
    raw === 'overlay' ||
    raw === 'darken' ||
    raw === 'lighten' ||
    raw === 'color-dodge' ||
    raw === 'color-burn' ||
    raw === 'hard-light' ||
    raw === 'soft-light' ||
    raw === 'difference' ||
    raw === 'exclusion' ||
    raw === 'hue' ||
    raw === 'saturation' ||
    raw === 'color' ||
    raw === 'luminosity' ||
    raw === 'normal'
    ? raw
    : undefined;
}

export function coerceName(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(min, Math.min(max, n));
}

/**
 * Coerce a persisted `animations` bag: keep only the known param paths and
 * normalize each track (sort/dedup by time) so evaluators can trust the shape
 * even for hand-edited or legacy documents. Returns `undefined` when empty.
 */
export function coerceAnimations(raw: unknown): ClipAnimations | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rawObj = raw as Record<string, unknown>;
  const out: ClipAnimations = {};
  let count = 0;
  for (const path of Object.keys(rawObj)) {
    if (!isAnimatableParamPath(path)) continue;
    const track = rawObj[path];
    if (!track || typeof track !== 'object') continue;
    const keyframes = (track as Record<string, unknown>).keyframes;
    if (!Array.isArray(keyframes) || keyframes.length === 0) continue;
    out[path] = normalizeKeyframeTrack({ keyframes } as KeyframeTrack);
    count++;
  }
  return count > 0 ? out : undefined;
}

export function coerceTransform(raw: unknown): ClipTransform | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rawObj = raw as Record<string, unknown>;

  const scaleRaw = rawObj.scale;
  const scale =
    scaleRaw && typeof scaleRaw === 'object'
      ? {
          x: clampNumber((scaleRaw as Record<string, unknown>).x, -1000, 1000),
          y: clampNumber((scaleRaw as Record<string, unknown>).y, -1000, 1000),
          linked:
            (scaleRaw as Record<string, unknown>).linked !== undefined
              ? Boolean((scaleRaw as Record<string, unknown>).linked)
              : undefined,
        }
      : undefined;

  const rotationDegRaw = rawObj.rotationDeg;
  const rotationDeg =
    typeof rotationDegRaw === 'number' && Number.isFinite(rotationDegRaw)
      ? Math.max(-36000, Math.min(36000, rotationDegRaw))
      : undefined;

  const positionRaw = rawObj.position;
  const position =
    positionRaw && typeof positionRaw === 'object'
      ? {
          x: clampNumber((positionRaw as Record<string, unknown>).x, -1_000_000, 1_000_000),
          y: clampNumber((positionRaw as Record<string, unknown>).y, -1_000_000, 1_000_000),
        }
      : undefined;

  const anchorRaw = rawObj.anchor;
  const preset =
    anchorRaw && typeof anchorRaw === 'object'
      ? String((anchorRaw as Record<string, unknown>).preset ?? '')
      : '';
  const safePreset =
    preset === 'center' ||
    preset === 'topLeft' ||
    preset === 'topRight' ||
    preset === 'bottomLeft' ||
    preset === 'bottomRight' ||
    preset === 'custom'
      ? (preset as ClipAnchorPreset)
      : undefined;
  const anchor =
    safePreset !== undefined
      ? {
          preset: safePreset,
          x:
            safePreset === 'custom'
              ? clampNumber((anchorRaw as Record<string, unknown>).x, -10, 10)
              : undefined,
          y:
            safePreset === 'custom'
              ? clampNumber((anchorRaw as Record<string, unknown>).y, -10, 10)
              : undefined,
        }
      : undefined;

  const cropRaw = rawObj.crop;
  const crop =
    cropRaw && typeof cropRaw === 'object'
      ? {
          top: clampNumber((cropRaw as Record<string, unknown>).top, 0, 100),
          bottom: clampNumber((cropRaw as Record<string, unknown>).bottom, 0, 100),
          left: clampNumber((cropRaw as Record<string, unknown>).left, 0, 100),
          right: clampNumber((cropRaw as Record<string, unknown>).right, 0, 100),
        }
      : undefined;

  if (!scale && rotationDeg === undefined && !position && !anchor && !crop) return undefined;
  return { scale, rotationDeg, position, anchor, crop };
}

export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
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
  metadata: unknown;
  occupiedIds: Set<string>;
}): string {
  const metadataObj =
    input.metadata && typeof input.metadata === 'object'
      ? (input.metadata as Record<string, unknown>)
      : undefined;
  const metadataId = coerceId(metadataObj?.id, '');
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

export function safeFastCatMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const fastcat = (raw as Record<string, unknown>).fastcat;
  if (!fastcat || typeof fastcat !== 'object') return {};
  return fastcat as Record<string, unknown>;
}

export function isOtioPath(value: unknown): value is string {
  return typeof value === 'string' && value.trim().toLowerCase().endsWith('.otio');
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export function hexToRgbNormalized(hex: string | undefined): [number, number, number] | null {
  if (!hex || typeof hex !== 'string') return null;
  const clean = hex.replace('#', '');
  if (clean.length !== 6 && clean.length !== 3) return null;
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean;
  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return [r / 255, g / 255, b / 255];
}

export function rgbNormalizedToHex(rgb: [number, number, number] | undefined): string | null {
  if (!rgb || !Array.isArray(rgb) || rgb.length < 3) return null;
  const toHex = (n: number) => {
    const v = Math.max(0, Math.min(1, n));
    const int = Math.round(v * 255);
    return int.toString(16).padStart(2, '0');
  };
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

export function toOtioColor(hex: string | undefined): OtioColor | undefined {
  const rgb = hexToRgbNormalized(hex);
  if (!rgb) return undefined;
  return { OTIO_SCHEMA: 'Color.1', rgb };
}

export function fromOtioColor(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.OTIO_SCHEMA !== 'Color.1') return undefined;
  const rgb = obj.rgb;
  if (!Array.isArray(rgb) || rgb.length < 3) return undefined;
  return rgbNormalizedToHex(rgb as [number, number, number]) ?? undefined;
}

// ---------------------------------------------------------------------------
// Validation report
// ---------------------------------------------------------------------------

export interface OtioValidationWarning {
  type: string;
  message: string;
  path?: string;
}

export class OtioValidationReport {
  warnings: OtioValidationWarning[] = [];

  warn(type: string, message: string, path?: string) {
    this.warnings.push({ type, message, path });
  }

  hasWarnings(): boolean {
    return this.warnings.length > 0;
  }

  log(): void {
    if (this.warnings.length === 0) return;

    log.warn(`[fastcat:otio] Import produced ${this.warnings.length} warning(s):`);
    for (const w of this.warnings) {
      log.warn(`  [${w.type}] ${w.message}${w.path ? ` at ${w.path}` : ''}`);
    }
  }
}
