import type { ClipEffect, TimelineMarker, ClipTransition } from '../types';
import type { EffectTarget } from '../../effects/core/registry';
import type {
  OtioEffect,
  OtioMarker,
  OtioTransition,
  OtioLinearTimeWarp,
  OtioFreezeFrame,
} from './types';
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
  return effects.map((e) => {
    const { id, type, enabled, target, params: explicitParams, ...rest } = e;
    const params =
      explicitParams && typeof explicitParams === 'object' && Object.keys(explicitParams).length > 0
        ? explicitParams
        : Object.keys(rest).length > 0
          ? rest
          : undefined;
    return {
      OTIO_SCHEMA: 'Effect.1' as const,
      name: type,
      effect_name: `fastcat:${type}`,
      enabled: enabled !== false,
      metadata: {
        fastcat: {
          effect: {
            id,
            type,
            target,
            ...(params ? { params } : {}),
          },
        },
      },
    };
  });
}

export function parseEffects(raw: unknown[]): ClipEffect[] {
  const result: ClipEffect[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (e.OTIO_SCHEMA !== 'Effect.1') continue;
    const fastcatMeta = safeFastCatMetadata(e.metadata);
    const effectMeta =
      fastcatMeta.effect && typeof fastcatMeta.effect === 'object'
        ? (fastcatMeta.effect as Record<string, unknown>)
        : {};

    const id = coerceId(effectMeta.id ?? e.name, '');
    const type =
      typeof effectMeta.type === 'string'
        ? effectMeta.type
        : typeof e.effect_name === 'string'
          ? e.effect_name.replace(/^fastcat:/, '')
          : '';
    if (!id || !type) continue;

    const params =
      effectMeta.params && typeof effectMeta.params === 'object'
        ? (effectMeta.params as Record<string, unknown>)
        : {};

    result.push({
      id,
      type,
      enabled: e.enabled !== false,
      target: effectMeta.target as EffectTarget | undefined,
      ...(Object.keys(params).length > 0 ? params : {}),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Time effects serialization helpers
// ---------------------------------------------------------------------------

export function serializeTimeEffects(input: {
  speed?: number;
  speedActive?: boolean;
  freezeFrameSourceUs?: number;
  fps?: number;
}): (OtioLinearTimeWarp | OtioFreezeFrame)[] | undefined {
  const result: (OtioLinearTimeWarp | OtioFreezeFrame)[] = [];

  if (input.speedActive && input.speed !== undefined && input.speed !== 1) {
    result.push({
      OTIO_SCHEMA: 'LinearTimeWarp.1',
      name: 'speed',
      effect_name: 'LinearTimeWarp',
      time_scalar: input.speed,
      metadata: {
        fastcat: {
          effect: {
            id: 'speed',
            type: 'LinearTimeWarp',
            target: 'video' as const,
            params: { speed: input.speed },
          },
        },
      },
    });
  }

  if (input.freezeFrameSourceUs !== undefined && input.freezeFrameSourceUs >= 0) {
    result.push({
      OTIO_SCHEMA: 'FreezeFrame.1',
      name: 'freeze_frame',
      effect_name: 'FreezeFrame',
      metadata: {
        fastcat: {
          effect: {
            id: 'freezeFrame',
            type: 'FreezeFrame',
            target: 'video' as const,
            params: { freezeFrameSourceUs: input.freezeFrameSourceUs },
          },
        },
      },
    });
  }

  return result.length > 0 ? result : undefined;
}

export function parseTimeEffects(raw: unknown[]): {
  speed?: number;
  speedActive?: boolean;
  freezeFrameSourceUs?: number;
} {
  let speed: number | undefined;
  let speedActive = false;
  let freezeFrameSourceUs: number | undefined;

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const schema = e.OTIO_SCHEMA;

    if (schema === 'LinearTimeWarp.1') {
      const scalar = Number(e.time_scalar);
      if (Number.isFinite(scalar)) {
        speed = scalar;
        speedActive = true;
      }
      continue;
    }

    if (schema === 'FreezeFrame.1') {
      const fastcatMeta = safeFastCatMetadata(e.metadata);
      const effectMeta =
        fastcatMeta.effect && typeof fastcatMeta.effect === 'object'
          ? (fastcatMeta.effect as Record<string, unknown>)
          : {};
      const params =
        effectMeta.params && typeof effectMeta.params === 'object'
          ? (effectMeta.params as Record<string, unknown>)
          : {};
      const us = Number(params.freezeFrameSourceUs);
      if (Number.isFinite(us) && us >= 0) {
        freezeFrameSourceUs = Math.round(us);
      }
      continue;
    }
  }

  return { speed, speedActive, freezeFrameSourceUs };
}

// ---------------------------------------------------------------------------
// Markers serialization helpers
// ---------------------------------------------------------------------------

function colorToOtioColor(color: string | undefined): string {
  if (!color) return 'RED';
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
        marker: {
          id: marker.id,
          color: marker.color,
        },
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
    const markerMeta =
      fastcatMeta.marker && typeof fastcatMeta.marker === 'object'
        ? (fastcatMeta.marker as Record<string, unknown>)
        : {};
    const range = fromTimeRange(m.marked_range);
    const id = coerceId(markerMeta.id, '');
    if (!id) continue;
    const text =
      typeof m.comment === 'string' && m.comment.length > 0
        ? m.comment
        : typeof m.name === 'string'
          ? m.name
          : '';
    const color = typeof markerMeta.color === 'string' ? markerMeta.color : undefined;
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
  if (otioType.startsWith('fastcat:')) return otioType.slice(8);
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
  offsets?: {
    inOffsetUs: number;
    outOffsetUs: number;
  },
): OtioTransition | null {
  if (!transition.type || !transition.durationUs) return null;
  const inUs = offsets?.inOffsetUs ?? Math.round(transition.durationUs / 2);
  const outUs = offsets?.outOffsetUs ?? Math.round(transition.durationUs - inUs);
  return {
    OTIO_SCHEMA: 'Transition.1',
    name,
    transition_type: transitionTypeToOtio(transition.type),
    in_offset: toRationalTime(inUs, fps),
    out_offset: toRationalTime(outUs, fps),
    parameters: transition.params ?? {},
    metadata: {
      fastcat: {
        transition: {
          type: transition.type,
          durationUs: transition.durationUs,
          mode: transition.mode,
          curve: transition.curve,
          params: transition.params,
          isOverridden: transition.isOverridden,
        },
        owner: {
          itemId: owner?.itemId,
          edge: owner?.edge,
        },
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
  const transitionMeta =
    fastcatMeta.transition && typeof fastcatMeta.transition === 'object'
      ? (fastcatMeta.transition as Record<string, unknown>)
      : {};
  const transitionTypeStr = typeof t.transition_type === 'string' ? t.transition_type : '';
  const typeStr = typeof transitionMeta.type === 'string' ? transitionMeta.type : undefined;
  const type = typeStr ?? transitionTypeFromOtio(transitionTypeStr);
  if (!type) return null;
  return {
    type,
    durationUs:
      typeof transitionMeta.durationUs === 'number' ? transitionMeta.durationUs : durationUs,
    mode: normalizeTransitionMode(transitionMeta.mode),
    curve: normalizeTransitionCurve(transitionMeta.curve),
    params:
      transitionMeta.params && typeof transitionMeta.params === 'object'
        ? (transitionMeta.params as Record<string, unknown>)
        : t.parameters && typeof t.parameters === 'object' && Object.keys(t.parameters).length > 0
          ? (t.parameters as Record<string, unknown>)
          : undefined,
    isOverridden:
      transitionMeta.isOverridden !== undefined ? Boolean(transitionMeta.isOverridden) : undefined,
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
