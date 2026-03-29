import type { ClipEffect, TimelineMarker, ClipTransition } from '../types';
import type { EffectTarget } from '../../effects/core/registry';
import type { OtioEffect, OtioMarker, OtioTransition } from './types';
import {
  toTimeRange,
  fromTimeRange,
  toRationalTime,
  fromRationalTimeUs,
  safeFastCatMetadata,
  coerceId,
} from './utils';
import { normalizeTransitionCurve, normalizeTransitionMode } from '~/transitions';

// ---------------------------------------------------------------------------
// Effects serialization helpers
// ---------------------------------------------------------------------------

export function serializeEffects(effects: ClipEffect[] | undefined): OtioEffect[] | undefined {
  if (!Array.isArray(effects) || effects.length === 0) return undefined;
  return effects.map((e) => ({
    OTIO_SCHEMA: 'Effect.1' as const,
    name: e.id,
    effect_name: e.type,
    enabled: e.enabled !== false,
    metadata: {
      fastcat: {
        id: e.id,
        type: e.type,
        target: e.target,
        params: Object.fromEntries(
          Object.entries(e).filter(([k]) => !['id', 'type', 'enabled', 'target'].includes(k)),
        ),
      },
    },
  }));
}

export function parseEffects(raw: unknown[]): ClipEffect[] {
  const result: ClipEffect[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (e.OTIO_SCHEMA !== 'Effect.1') continue;
    const fastcatMeta = safeFastCatMetadata(e.metadata);
    const id = coerceId(fastcatMeta?.id ?? e.name, '');
    const type =
      typeof fastcatMeta?.type === 'string'
        ? fastcatMeta.type
        : typeof e.effect_name === 'string'
          ? e.effect_name
          : '';
    if (!id || !type) continue;
    const params =
      fastcatMeta?.params && typeof fastcatMeta.params === 'object' ? fastcatMeta.params : {};
    result.push({
      id,
      type,
      enabled: e.enabled !== false,
      target: fastcatMeta?.target as EffectTarget | undefined,
      ...params,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Markers serialization helpers
// ---------------------------------------------------------------------------

function colorToOtioColor(color: string | undefined): string {
  if (!color) return 'WHITE';
  const map: Record<string, string> = {
    red: 'RED',
    '#ff0000': 'RED',
    green: 'GREEN',
    '#00ff00': 'GREEN',
    blue: 'BLUE',
    '#0000ff': 'BLUE',
    yellow: 'YELLOW',
    '#ffff00': 'YELLOW',
    cyan: 'CYAN',
    '#00ffff': 'CYAN',
    magenta: 'MAGENTA',
    '#ff00ff': 'MAGENTA',
    orange: 'ORANGE',
    pink: 'PINK',
    purple: 'PURPLE',
    black: 'BLACK',
    '#000000': 'BLACK',
    white: 'WHITE',
    '#ffffff': 'WHITE',
  };
  return map[color.toLowerCase()] ?? 'WHITE';
}

export function serializeMarker(marker: TimelineMarker, fps?: number): OtioMarker {
  return {
    OTIO_SCHEMA: 'Marker.2',
    name: marker.text,
    color: colorToOtioColor(marker.color),
    comment: marker.text,
    marked_range: toTimeRange({ startUs: marker.timeUs, durationUs: marker.durationUs ?? 0 }, fps),
    metadata: {
      fastcat: {
        id: marker.id,
        color: marker.color,
      },
    },
  };
}

export function parseOtioMarkers(raw: unknown): TimelineMarker[] {
  if (!Array.isArray(raw)) return [];
  const result: TimelineMarker[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    if (m.OTIO_SCHEMA !== 'Marker.2' && m.OTIO_SCHEMA !== 'Marker.1') continue;
    const fastcatMeta = safeFastCatMetadata(m.metadata);
    const range = fromTimeRange(m.marked_range);
    const id = coerceId(fastcatMeta?.id, '');
    if (!id) continue;
    const text =
      typeof m.comment === 'string' && m.comment.length > 0
        ? m.comment
        : typeof m.name === 'string'
          ? m.name
          : '';
    const color = typeof fastcatMeta?.color === 'string' ? fastcatMeta.color : undefined;
    const durationUs = range.durationUs > 0 ? range.durationUs : undefined;
    result.push({ id, timeUs: Math.max(0, range.startUs), durationUs, text, color });
  }
  result.sort((a, b) => a.timeUs - b.timeUs);
  return result;
}

// ---------------------------------------------------------------------------
// Transitions serialization helpers
// ---------------------------------------------------------------------------

function transitionTypeToOtio(type: string): string {
  if (type === 'dissolve') return 'SMPTE_Dissolve';
  return `fastcat:${type}`;
}

function transitionTypeFromOtio(otioType: string): string {
  if (otioType === 'SMPTE_Dissolve') return 'dissolve';
  if (otioType.startsWith('fastcat:')) return otioType.slice(5);
  return otioType;
}

export function buildOtioTransition(
  transition: ClipTransition,
  name: string,
  fps?: number,
  owner?: {
    itemId: string;
    edge: 'in' | 'out';
  },
): OtioTransition | null {
  if (!transition.type || !transition.durationUs) return null;
  const halfUs = Math.round(transition.durationUs / 2);
  return {
    OTIO_SCHEMA: 'Transition.1',
    name,
    transition_type: transitionTypeToOtio(transition.type),
    in_offset: toRationalTime(halfUs, fps),
    out_offset: toRationalTime(transition.durationUs - halfUs, fps),
    parameters: transition.params ?? {},
    metadata: {
      fastcat: {
        type: transition.type,
        durationUs: transition.durationUs,
        mode: transition.mode,
        curve: transition.curve,
        params: transition.params,
        isOverridden: transition.isOverridden,
        ownerItemId: owner?.itemId,
        edge: owner?.edge,
      },
    },
  };
}

export function parseOtioTransition(tRaw: unknown): ClipTransition | null {
  if (!tRaw || typeof tRaw !== 'object') return null;
  const t = tRaw as Record<string, unknown>;
  if (t.OTIO_SCHEMA !== 'Transition.1') return null;
  const inUs = fromRationalTimeUs(t.in_offset);
  const outUs = fromRationalTimeUs(t.out_offset);
  const durationUs = inUs + outUs;
  if (durationUs <= 0) return null;
  const fastcatMeta = safeFastCatMetadata(t.metadata);
  const transitionTypeStr = typeof t.transition_type === 'string' ? t.transition_type : '';
  const typeStr = typeof fastcatMeta?.type === 'string' ? fastcatMeta.type : undefined;
  const type = typeStr ?? transitionTypeFromOtio(transitionTypeStr);
  if (!type) return null;
  return {
    type,
    durationUs: typeof fastcatMeta?.durationUs === 'number' ? fastcatMeta.durationUs : durationUs,
    mode: normalizeTransitionMode(fastcatMeta?.mode),
    curve: normalizeTransitionCurve(fastcatMeta?.curve),
    params:
      fastcatMeta?.params && typeof fastcatMeta.params === 'object'
        ? (fastcatMeta.params as Record<string, unknown>)
        : t.parameters && typeof t.parameters === 'object' && Object.keys(t.parameters).length > 0
          ? (t.parameters as Record<string, unknown>)
          : undefined,
    isOverridden:
      fastcatMeta?.isOverridden !== undefined ? Boolean(fastcatMeta.isOverridden) : undefined,
  };
}

export function parseFastCatTransition(rawRaw: unknown): ClipTransition | undefined {
  if (!rawRaw || typeof rawRaw !== 'object') return undefined;
  const raw = rawRaw as Record<string, unknown>;
  if (typeof raw.type !== 'string' || typeof raw.durationUs !== 'number') return undefined;
  return {
    type: raw.type,
    durationUs: Math.max(0, Math.round(raw.durationUs)),
    mode: normalizeTransitionMode(raw.mode),
    curve: normalizeTransitionCurve(raw.curve),
    params:
      raw.params && typeof raw.params === 'object'
        ? (raw.params as Record<string, unknown>)
        : undefined,
    isOverridden: raw.isOverridden !== undefined ? Boolean(raw.isOverridden) : undefined,
  };
}
