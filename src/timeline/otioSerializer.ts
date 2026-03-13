import type {
  TimelineClipItem,
  TimelineDocument,
  TimelineGapItem,
  TimelineMarker,
  TimelineRange,
  TimelineSelectionRange,
  TimelineTimebase,
  TimelineTrack,
  TimelineTrackItem,
  TrackKind,
  ClipEffect,
} from './types';
import { normalizeTransitionCurve, normalizeTransitionMode } from '~/transitions';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';

// ---------------------------------------------------------------------------
// OTIO schema types
// ---------------------------------------------------------------------------

interface OtioRationalTime {
  OTIO_SCHEMA: 'RationalTime.1';
  value: number;
  rate: number;
}

interface OtioTimeRange {
  OTIO_SCHEMA: 'TimeRange.1';
  start_time: OtioRationalTime;
  duration: OtioRationalTime;
}

interface OtioExternalReference {
  OTIO_SCHEMA: 'ExternalReference.1';
  target_url: string;
  available_range?: OtioTimeRange;
  metadata?: Record<string, unknown>;
}

interface OtioMissingReference {
  OTIO_SCHEMA: 'MissingReference.1';
  metadata?: Record<string, unknown>;
}

type OtioMediaReference = OtioExternalReference | OtioMissingReference;

interface OtioEffect {
  OTIO_SCHEMA: 'Effect.1';
  name: string;
  effect_name: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

interface OtioMarker {
  OTIO_SCHEMA: 'Marker.2';
  name: string;
  color: string;
  comment: string;
  marked_range: OtioTimeRange;
  metadata?: Record<string, unknown>;
}

interface OtioTransition {
  OTIO_SCHEMA: 'Transition.1';
  name: string;
  transition_type: string;
  in_offset: OtioRationalTime;
  out_offset: OtioRationalTime;
  parameters: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface OtioClip {
  OTIO_SCHEMA: 'Clip.1';
  name: string;
  media_reference: OtioMediaReference;
  source_range: OtioTimeRange;
  enabled?: boolean;
  effects?: OtioEffect[];
  markers?: OtioMarker[];
  metadata?: Record<string, unknown>;
}

interface OtioGap {
  OTIO_SCHEMA: 'Gap.1';
  name: string;
  source_range: OtioTimeRange;
  effects?: OtioEffect[];
  metadata?: Record<string, unknown>;
}

type OtioTrackChild = OtioClip | OtioGap | OtioTransition;

interface OtioTrack {
  OTIO_SCHEMA: 'Track.1';
  name: string;
  kind: 'Video' | 'Audio';
  children: OtioTrackChild[];
  effects?: OtioEffect[];
  markers?: OtioMarker[];
  metadata?: Record<string, unknown>;
}

interface OtioStack {
  OTIO_SCHEMA: 'Stack.1';
  name: string;
  children: OtioTrack[];
  markers?: OtioMarker[];
}

interface OtioTimeline {
  OTIO_SCHEMA: 'Timeline.1';
  name: string;
  tracks: OtioStack;
  markers?: OtioMarker[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Time conversion helpers
// ---------------------------------------------------------------------------

const TIME_RATE_US = 1_000_000;

/** Convert microseconds to RationalTime, using fps-aware rate when provided. */
function toRationalTime(us: number, fps?: number): OtioRationalTime {
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

/** Convert any RationalTime to microseconds. Supports any rate including fractional fps. */
function fromRationalTimeUs(rt: any): number {
  const value = Number(rt?.value);
  const rate = Number(rt?.rate);
  if (!Number.isFinite(value) || !Number.isFinite(rate) || rate <= 0) return 0;
  if (rate === TIME_RATE_US) return Math.round(value);
  return Math.round((value / rate) * TIME_RATE_US);
}

function toTimeRange(range: TimelineRange, fps?: number): OtioTimeRange {
  return {
    OTIO_SCHEMA: 'TimeRange.1',
    start_time: toRationalTime(range.startUs, fps),
    duration: toRationalTime(range.durationUs, fps),
  };
}

function fromTimeRange(tr: any): TimelineRange {
  return {
    startUs: fromRationalTimeUs(tr?.start_time),
    durationUs: fromRationalTimeUs(tr?.duration),
  };
}

function trackKindToOtioKind(kind: TrackKind): 'Video' | 'Audio' {
  return kind === 'audio' ? 'Audio' : 'Video';
}

function trackKindFromOtioKind(kind: any): TrackKind {
  return kind === 'Audio' ? 'audio' : 'video';
}

function assertTimelineTimebase(raw: any): TimelineTimebase {
  const fps = Number(raw?.fps);
  if (!Number.isFinite(fps) || fps <= 0) return { fps: 25 };
  // Preserve fractional fps (e.g. 23.976, 29.97) up to 3 decimal places.
  return { fps: Math.min(240, Math.max(1, Math.round(fps * 1000) / 1000)) };
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function coerceId(raw: any, fallback: string): string {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
}

function coerceBlendMode(raw: unknown): import('./types').TimelineBlendMode | undefined {
  return raw === 'add' ||
    raw === 'multiply' ||
    raw === 'screen' ||
    raw === 'darken' ||
    raw === 'lighten' ||
    raw === 'normal'
    ? raw
    : undefined;
}

function coerceName(raw: any, fallback: string): string {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
}

function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(min, Math.min(max, n));
}

function coerceTransform(raw: any): import('./types').ClipTransform | undefined {
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
      ? (preset as import('./types').ClipAnchorPreset)
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

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function buildFallbackItemId(input: {
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

function resolveStableItemId(input: {
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

function safeFastCatMetadata(raw: any): any {
  if (!raw || typeof raw !== 'object') return {};
  const fastcat = (raw as any).fastcat;
  if (!fastcat || typeof fastcat !== 'object') return {};
  return fastcat;
}

function isOtioPath(value: unknown): value is string {
  return typeof value === 'string' && value.trim().toLowerCase().endsWith('.otio');
}

// ---------------------------------------------------------------------------
// Effects serialization helpers
// ---------------------------------------------------------------------------

/** Serialize ClipEffect[] to standard OTIO Effect.1 array. Editor-specific params go to metadata.fastcat. */
function serializeEffects(effects: ClipEffect[] | undefined): OtioEffect[] | undefined {
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
        // All remaining custom params are serialized here.
        params: Object.fromEntries(
          Object.entries(e).filter(([k]) => !['id', 'type', 'enabled', 'target'].includes(k)),
        ),
      },
    },
  }));
}

/** Parse OTIO Effect.1[] back to ClipEffect[]. Falls back gracefully if effect_name is missing. */
function parseEffects(raw: any[]): ClipEffect[] {
  const result: ClipEffect[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
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
    const params = fastcatMeta?.params && typeof fastcatMeta.params === 'object' ? fastcatMeta.params : {};
    result.push({
      id,
      type,
      enabled: e.enabled !== false,
      target: fastcatMeta?.target,
      ...params,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Markers serialization helpers
// ---------------------------------------------------------------------------

/** Map internal color (hex string or named) to OTIO standard color name. Best-effort. */
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

/** Serialize TimelineMarker to OTIO Marker.2. */
function serializeMarker(marker: TimelineMarker, fps?: number): OtioMarker {
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

/** Parse OTIO markers array back to TimelineMarker[]. */
function parseOtioMarkers(raw: any): TimelineMarker[] {
  if (!Array.isArray(raw)) return [];
  const result: TimelineMarker[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
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
    // Use editor-specific color from fastcat if present; ignore canonical OTIO color enum string.
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

/**
 * Map our internal transition type to OTIO transition_type string.
 * Standard OTIO defines SMPTE_Dissolve; other types are vendor-namespaced.
 */
function transitionTypeToOtio(type: string): string {
  if (type === 'dissolve') return 'SMPTE_Dissolve';
  return `fastcat:${type}`;
}

/** Reverse: OTIO transition_type → our type. */
function transitionTypeFromOtio(otioType: string): string {
  if (otioType === 'SMPTE_Dissolve') return 'dissolve';
  if (otioType.startsWith('fastcat:')) return otioType.slice(5);
  return otioType;
}

/** Build OTIO Transition.1 from ClipTransition. Returns null if transition data is incomplete. */
function buildOtioTransition(
  transition: import('./types').ClipTransition,
  name: string,
  fps?: number,
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
      },
    },
  };
}

/** Parse OTIO Transition.1 back to ClipTransition. */
function parseOtioTransition(t: any): import('./types').ClipTransition | null {
  if (!t || t.OTIO_SCHEMA !== 'Transition.1') return null;
  const inUs = fromRationalTimeUs(t.in_offset);
  const outUs = fromRationalTimeUs(t.out_offset);
  const durationUs = inUs + outUs;
  if (durationUs <= 0) return null;
  const fastcatMeta = safeFastCatMetadata(t.metadata);
  const type = fastcatMeta?.type ?? transitionTypeFromOtio(t.transition_type ?? '');
  if (!type) return null;
  return {
    type,
    durationUs: fastcatMeta?.durationUs ?? durationUs,
    mode: normalizeTransitionMode(fastcatMeta?.mode),
    curve: normalizeTransitionCurve(fastcatMeta?.curve),
    params:
      fastcatMeta?.params && typeof fastcatMeta.params === 'object'
        ? (fastcatMeta.params as Record<string, unknown>)
        : Object.keys(t.parameters ?? {}).length > 0
          ? (t.parameters as Record<string, unknown>)
          : undefined,
    isOverridden: fastcatMeta?.isOverridden !== undefined ? Boolean(fastcatMeta.isOverridden) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Sequence duration helper
// ---------------------------------------------------------------------------

function parseItemSequenceDurationUs(child: any): number {
  if (!child || typeof child !== 'object') return 0;
  const schema = child.OTIO_SCHEMA;
  if (schema === 'Gap.1' || schema === 'Clip.1') {
    return Math.max(0, fromRationalTimeUs(child?.source_range?.duration));
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Clip / Gap parsers
// ---------------------------------------------------------------------------

function parseClipItem(input: {
  trackId: string;
  otio: OtioClip;
  index: number;
  occupiedIds: Set<string>;
  fallbackStartUs: number;
  transitionIn?: import('./types').ClipTransition;
  transitionOut?: import('./types').ClipTransition;
}): TimelineClipItem {
  const { trackId, otio, index, occupiedIds, fallbackStartUs, transitionIn, transitionOut } = input;
  const sourceRange = fromTimeRange(otio.source_range);
  const name = coerceName(otio.name, `clip_${index + 1}`);

  const ref = otio.media_reference as any;
  const path =
    ref?.OTIO_SCHEMA === 'ExternalReference.1' && typeof ref.target_url === 'string'
      ? ref.target_url
      : '';

  // Source duration: prefer available_range on media_reference, then metadata.
  const availableRange =
    ref?.OTIO_SCHEMA === 'ExternalReference.1' && ref.available_range
      ? fromTimeRange(ref.available_range)
      : null;

  const fastcatMeta = safeFastCatMetadata(otio.metadata);

  const clipTypeRaw = fastcatMeta?.clipType;
  const clipType =
    clipTypeRaw === 'background' ||
    clipTypeRaw === 'adjustment' ||
    clipTypeRaw === 'media' ||
    clipTypeRaw === 'timeline' ||
    clipTypeRaw === 'text' ||
    clipTypeRaw === 'shape' ||
    clipTypeRaw === 'hud'
      ? clipTypeRaw
      : isOtioPath(path)
        ? 'timeline'
        : 'media';

  const timelineStartUs = fallbackStartUs;

  const sourceDurationUsFromMeta = Math.max(0, Math.round(Number(fastcatMeta?.sourceDurationUs ?? 0)));
  const sourceDurationUs =
    sourceDurationUsFromMeta > 0
      ? sourceDurationUsFromMeta
      : (availableRange?.durationUs ?? sourceRange.durationUs);

  const id = resolveStableItemId({
    prefix: 'clip',
    trackId,
    fallbackFingerprint: JSON.stringify({
      path,
      sourceStartUs: sourceRange.startUs,
      sourceDurationUs: sourceRange.durationUs,
      timelineStartUs,
      name,
    }),
    metadata: fastcatMeta,
    occupiedIds,
  });

  // Effects: standard OTIO effects take priority; merge with fastcat-only effects if needed.
  const otioEffects =
    Array.isArray(otio.effects) && otio.effects.length > 0
      ? parseEffects(otio.effects)
      : Array.isArray(fastcatMeta?.effects)
        ? (fastcatMeta.effects as ClipEffect[])
        : undefined;

  const base = {
    kind: 'clip' as const,
    clipType,
    id,
    trackId,
    name,
    disabled: otio.enabled === false ? true : undefined,
    locked: fastcatMeta?.locked !== undefined ? Boolean(fastcatMeta.locked) : undefined,
    sourceDurationUs,
    timelineRange: { startUs: timelineStartUs, durationUs: sourceRange.durationUs },
    sourceRange,
    speed:
      typeof fastcatMeta?.speed === 'number' && Number.isFinite(fastcatMeta.speed)
        ? Math.max(-10, Math.min(10, Number(fastcatMeta.speed)))
        : undefined,
    audioGain:
      typeof fastcatMeta?.audioGain === 'number' && Number.isFinite(fastcatMeta.audioGain)
        ? Math.max(0, Math.min(10, Number(fastcatMeta.audioGain)))
        : undefined,
    audioBalance:
      typeof fastcatMeta?.audioBalance === 'number' && Number.isFinite(fastcatMeta.audioBalance)
        ? Math.max(-1, Math.min(1, Number(fastcatMeta.audioBalance)))
        : undefined,
    audioFadeInUs:
      typeof fastcatMeta?.audioFadeInUs === 'number' && Number.isFinite(fastcatMeta.audioFadeInUs)
        ? Math.max(0, Math.round(fastcatMeta.audioFadeInUs))
        : undefined,
    audioFadeOutUs:
      typeof fastcatMeta?.audioFadeOutUs === 'number' && Number.isFinite(fastcatMeta.audioFadeOutUs)
        ? Math.max(0, Math.round(fastcatMeta.audioFadeOutUs))
        : undefined,
    audioFadeInCurve:
      fastcatMeta?.audioFadeInCurve === 'linear' || fastcatMeta?.audioFadeInCurve === 'logarithmic'
        ? fastcatMeta.audioFadeInCurve
        : undefined,
    audioFadeOutCurve:
      fastcatMeta?.audioFadeOutCurve === 'linear' || fastcatMeta?.audioFadeOutCurve === 'logarithmic'
        ? fastcatMeta.audioFadeOutCurve
        : undefined,
    audioMuted: fastcatMeta?.audioMuted !== undefined ? Boolean(fastcatMeta.audioMuted) : undefined,
    audioWaveformMode:
      fastcatMeta?.audioWaveformMode === 'half' || fastcatMeta?.audioWaveformMode === 'full'
        ? fastcatMeta.audioWaveformMode
        : undefined,
    showWaveform: fastcatMeta?.showWaveform !== undefined ? Boolean(fastcatMeta.showWaveform) : undefined,
    audioFromVideoDisabled: Boolean(fastcatMeta?.audioFromVideoDisabled),
    freezeFrameSourceUs:
      clipType === 'media' &&
      typeof fastcatMeta?.freezeFrameSourceUs === 'number' &&
      Number.isFinite(fastcatMeta.freezeFrameSourceUs)
        ? Math.max(0, Math.round(fastcatMeta.freezeFrameSourceUs))
        : undefined,
    opacity:
      typeof fastcatMeta?.opacity === 'number' && Number.isFinite(fastcatMeta.opacity)
        ? Math.max(0, Math.min(1, fastcatMeta.opacity))
        : undefined,
    blendMode: coerceBlendMode(fastcatMeta?.blendMode),
    effects: otioEffects,
    // Transitions come from adjacent Transition.1 nodes (passed in from track parser),
    // falling back to metadata.fastcat for backward compat with external OTIO that has no fastcat transitions.
    transitionIn: transitionIn ?? parseFastCatTransition(fastcatMeta?.transitionIn),
    transitionOut: transitionOut ?? parseFastCatTransition(fastcatMeta?.transitionOut),
    linkedGroupId:
      typeof fastcatMeta?.linkedGroupId === 'string' && fastcatMeta.linkedGroupId.trim().length > 0
        ? fastcatMeta.linkedGroupId
        : undefined,
    linkedVideoClipId:
      typeof fastcatMeta?.linkedVideoClipId === 'string' &&
      fastcatMeta.linkedVideoClipId.trim().length > 0
        ? fastcatMeta.linkedVideoClipId
        : undefined,
    lockToLinkedVideo:
      fastcatMeta?.lockToLinkedVideo !== undefined ? Boolean(fastcatMeta.lockToLinkedVideo) : undefined,
    isImage: fastcatMeta?.isImage !== undefined ? Boolean(fastcatMeta.isImage) : undefined,
    transform: coerceTransform(fastcatMeta?.transform),
  };

  if (clipType === 'background') {
    return {
      ...base,
      clipType: 'background',
      backgroundColor: sanitizeTimelineColor(fastcatMeta?.backgroundColor, '#000000'),
    };
  }

  if (clipType === 'adjustment') {
    return { ...base, clipType: 'adjustment' };
  }

  if (clipType === 'text') {
    const text = typeof fastcatMeta?.text === 'string' ? fastcatMeta.text : 'Text';
    const style =
      fastcatMeta?.style && typeof fastcatMeta.style === 'object' ? fastcatMeta.style : undefined;
    return {
      ...base,
      clipType: 'text',
      sourceDurationUs,
      timelineRange: { startUs: timelineStartUs, durationUs: sourceRange.durationUs },
      sourceRange,
      text,
      style,
    };
  }

  if (clipType === 'shape') {
    const shapeType =
      fastcatMeta?.shapeType === 'square' ||
      fastcatMeta?.shapeType === 'circle' ||
      fastcatMeta?.shapeType === 'triangle' ||
      fastcatMeta?.shapeType === 'star' ||
      fastcatMeta?.shapeType === 'cloud' ||
      fastcatMeta?.shapeType === 'speech_bubble' ||
      fastcatMeta?.shapeType === 'bang'
        ? fastcatMeta.shapeType
        : 'square';

    return {
      ...base,
      clipType: 'shape',
      sourceDurationUs,
      timelineRange: { startUs: timelineStartUs, durationUs: sourceRange.durationUs },
      sourceRange,
      shapeType,
      fillColor:
        typeof fastcatMeta?.fillColor === 'string' && fastcatMeta.fillColor.trim().length > 0
          ? fastcatMeta.fillColor
          : '#ffffff',
      strokeColor:
        typeof fastcatMeta?.strokeColor === 'string' && fastcatMeta.strokeColor.trim().length > 0
          ? fastcatMeta.strokeColor
          : '#000000',
      strokeWidth:
        typeof fastcatMeta?.strokeWidth === 'number' && Number.isFinite(fastcatMeta.strokeWidth)
          ? Math.max(0, Number(fastcatMeta.strokeWidth))
          : 0,
      shapeConfig:
        fastcatMeta?.shapeConfig && typeof fastcatMeta.shapeConfig === 'object'
          ? fastcatMeta.shapeConfig
          : undefined,
    };
  }

  if (clipType === 'hud') {
    return {
      ...base,
      clipType: 'hud',
      hudType: fastcatMeta?.hudType === 'media_frame' ? fastcatMeta.hudType : 'media_frame',
      background:
        fastcatMeta?.background && typeof fastcatMeta.background === 'object'
          ? fastcatMeta.background
          : undefined,
      content:
        fastcatMeta?.content && typeof fastcatMeta.content === 'object' ? fastcatMeta.content : undefined,
    };
  }

  if (clipType === 'timeline') {
    return { ...base, clipType: 'timeline', source: { path } };
  }

  return { ...base, clipType: 'media', source: { path } };
}

/** Parse legacy fastcat-metadata transition object (for round-trip safety). */
function parseFastCatTransition(raw: any): import('./types').ClipTransition | undefined {
  if (!raw || typeof raw.type !== 'string' || typeof raw.durationUs !== 'number') return undefined;
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

function parseGapItem(input: {
  trackId: string;
  otio: OtioGap;
  index: number;
  occupiedIds: Set<string>;
  fallbackStartUs: number;
}): TimelineGapItem {
  const { trackId, otio, index, occupiedIds, fallbackStartUs } = input;
  const range = fromTimeRange(otio.source_range);
  const fastcatMeta = safeFastCatMetadata(otio.metadata);
  const timelineStartUs = fallbackStartUs;
  const id = resolveStableItemId({
    prefix: 'gap',
    trackId,
    fallbackFingerprint: JSON.stringify({
      durationUs: range.durationUs,
      timelineStartUs,
      index,
    }),
    metadata: fastcatMeta,
    occupiedIds,
  });

  return {
    kind: 'gap',
    id,
    trackId,
    timelineRange: { startUs: timelineStartUs, durationUs: range.durationUs },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createDefaultTimelineDocument(params: {
  id: string;
  name: string;
  fps: number;
}): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: params.id,
    name: params.name,
    timebase: { fps: params.fps },
    tracks: [
      { id: 'v1', kind: 'video', name: 'Video 1', videoHidden: false, items: [] },
      { id: 'v2', kind: 'video', name: 'Video 2', videoHidden: false, items: [] },
      { id: 'a1', kind: 'audio', name: 'Audio 1', audioMuted: false, audioSolo: false, items: [] },
      { id: 'a2', kind: 'audio', name: 'Audio 2', audioMuted: false, audioSolo: false, items: [] },
    ],
    metadata: {
      fastcat: {
        version: 1,
        docId: params.id,
        timebase: { fps: params.fps },
      },
    },
  };
}

function coerceSelectionRange(raw: unknown): TimelineSelectionRange | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const startUs = Number((raw as any).startUs);
  const endUs = Number((raw as any).endUs);
  if (!Number.isFinite(startUs) || !Number.isFinite(endUs)) return undefined;

  const nextStartUs = Math.max(0, Math.round(startUs));
  const nextEndUs = Math.max(nextStartUs, Math.round(endUs));

  if (nextEndUs <= nextStartUs) return undefined;

  return { startUs: nextStartUs, endUs: nextEndUs };
}

export function serializeTimelineToOtio(doc: TimelineDocument): string {
  const fps = doc.timebase?.fps;

  const tracks: OtioTrack[] = doc.tracks.map((t) => {
    const sortedItems = [...t.items].sort(
      (a, b) => a.timelineRange.startUs - b.timelineRange.startUs,
    );
    const children: OtioTrackChild[] = [];
    let cursorUs = 0;

    for (const item of sortedItems) {
      const startUs = Math.max(0, Math.round(item.timelineRange.startUs));
      const durationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

      if (startUs > cursorUs) {
        children.push({
          OTIO_SCHEMA: 'Gap.1',
          name: 'gap',
          source_range: toTimeRange({ startUs: 0, durationUs: startUs - cursorUs }, fps),
          metadata: { fastcat: { id: `gap_${t.id}_${cursorUs}` } },
        });
        cursorUs = startUs;
      }

      if (item.kind === 'gap') {
        children.push({
          OTIO_SCHEMA: 'Gap.1',
          name: 'gap',
          source_range: toTimeRange({ startUs: 0, durationUs }, fps),
          metadata: { fastcat: { id: item.id } },
        });
        cursorUs += durationUs;
        continue;
      }

      // Emit transitionIn as a Transition.1 *before* this clip.
      if (item.transitionIn) {
        const t1 = buildOtioTransition(item.transitionIn, `${item.name}_transition_in`, fps);
        if (t1) children.push(t1);
      }

      const path =
        item.clipType === 'media' || item.clipType === 'timeline' ? item.source.path : '';

      const mediaReference: OtioMediaReference = path
        ? {
            OTIO_SCHEMA: 'ExternalReference.1',
            target_url: path,
            available_range:
              item.clipType === 'media' || item.clipType === 'timeline'
                ? toTimeRange({ startUs: 0, durationUs: item.sourceDurationUs }, fps)
                : undefined,
          }
        : { OTIO_SCHEMA: 'MissingReference.1' };

      children.push({
        OTIO_SCHEMA: 'Clip.1',
        name: item.name,
        enabled: item.disabled ? false : undefined,
        media_reference: mediaReference,
        source_range: toTimeRange(item.sourceRange, fps),
        effects: serializeEffects(item.effects),
        metadata: {
          fastcat: {
            id: item.id,
            clipType: item.clipType,
            locked: item.locked ? true : undefined,
            speed: item.speed,
            audioGain: item.audioGain,
            audioBalance: item.audioBalance,
            audioFadeInUs: item.audioFadeInUs,
            audioFadeOutUs: item.audioFadeOutUs,
            audioFadeInCurve: item.audioFadeInCurve,
            audioFadeOutCurve: item.audioFadeOutCurve,
            audioMuted: item.audioMuted,
            audioWaveformMode: item.audioWaveformMode,
            showWaveform: item.showWaveform,
            audioFromVideoDisabled:
              item.clipType === 'media' ? Boolean(item.audioFromVideoDisabled) : undefined,
            freezeFrameSourceUs: item.clipType === 'media' ? item.freezeFrameSourceUs : undefined,
            opacity: item.opacity,
            blendMode: item.blendMode,
            transitionIn: item.transitionIn,
            transitionOut: item.transitionOut,
            linkedGroupId: item.linkedGroupId,
            linkedVideoClipId: item.clipType === 'media' ? item.linkedVideoClipId : undefined,
            lockToLinkedVideo: item.clipType === 'media' ? item.lockToLinkedVideo : undefined,
            backgroundColor:
              item.clipType === 'background' ? (item as any).backgroundColor : undefined,
            text: item.clipType === 'text' ? (item as any).text : undefined,
            style: item.clipType === 'text' ? (item as any).style : undefined,
            shapeType: item.clipType === 'shape' ? (item as any).shapeType : undefined,
            fillColor: item.clipType === 'shape' ? (item as any).fillColor : undefined,
            strokeColor: item.clipType === 'shape' ? (item as any).strokeColor : undefined,
            strokeWidth: item.clipType === 'shape' ? (item as any).strokeWidth : undefined,
            shapeConfig: item.clipType === 'shape' ? (item as any).shapeConfig : undefined,
            hudType: item.clipType === 'hud' ? (item as any).hudType : undefined,
            background: item.clipType === 'hud' ? (item as any).background : undefined,
            content: item.clipType === 'hud' ? (item as any).content : undefined,
            isImage: item.isImage,
            transform: item.transform,
          },
        },
      });

      // Emit transitionOut as a Transition.1 *after* this clip.
      if (item.transitionOut) {
        const t1 = buildOtioTransition(item.transitionOut, `${item.name}_transition_out`, fps);
        if (t1) children.push(t1);
      }

      cursorUs += durationUs;
    }

    return {
      OTIO_SCHEMA: 'Track.1',
      name: t.name,
      kind: trackKindToOtioKind(t.kind),
      children,
      effects: serializeEffects(t.effects),
      metadata: {
        fastcat: {
          id: t.id,
          kind: t.kind,
          videoHidden: t.kind === 'video' ? Boolean(t.videoHidden) : undefined,
          opacity: t.opacity,
          blendMode: t.blendMode,
          audioMuted: Boolean(t.audioMuted),
          audioSolo: Boolean(t.audioSolo),
          audioGain: t.audioGain,
          audioBalance: t.audioBalance,
        },
      },
    };
  });

  const fastcatMeta = doc.metadata?.fastcat;
  const markers = Array.isArray(fastcatMeta?.markers)
    ? [...(fastcatMeta.markers as TimelineMarker[])]
        .sort((a, b) => a.timeUs - b.timeUs)
        .map((m) => serializeMarker(m, fps))
    : [];

  const payload: OtioTimeline = {
    OTIO_SCHEMA: 'Timeline.1',
    name: doc.name,
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      children: tracks,
    },
    markers,
    metadata: {
      fastcat: {
        version: 1,
        docId: doc.id,
        timebase: doc.timebase,
        selectionRange: coerceSelectionRange(fastcatMeta?.selectionRange),
        snapThresholdPx: fastcatMeta?.snapThresholdPx,
        playheadUs: fastcatMeta?.playheadUs,
        masterGain: fastcatMeta?.masterGain,
        masterMuted: fastcatMeta?.masterMuted,
        masterEffects: Array.isArray(fastcatMeta?.masterEffects) ? fastcatMeta.masterEffects : undefined,
      },
    },
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function parseTimelineFromOtio(
  text: string,
  fallback: { id: string; name: string; fps: number },
): TimelineDocument {
  let parsed: OtioTimeline | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return createDefaultTimelineDocument({
      id: fallback.id,
      name: fallback.name,
      fps: fallback.fps,
    });
  }

  if (!parsed || parsed.OTIO_SCHEMA !== 'Timeline.1') {
    return createDefaultTimelineDocument({
      id: fallback.id,
      name: fallback.name,
      fps: fallback.fps,
    });
  }

  const fastcatMeta = (parsed.metadata as any)?.fastcat;
  const timebase = assertTimelineTimebase(fastcatMeta?.timebase ?? { fps: fallback.fps });

  const stackChildren = Array.isArray((parsed.tracks as any)?.children)
    ? (parsed.tracks as any).children
    : [];

  const tracks: TimelineTrack[] = stackChildren.map((otioTrack: OtioTrack, trackIndex: number) => {
    const trackFastCatMeta = safeFastCatMetadata(otioTrack.metadata);

    const id = coerceId(
      trackFastCatMeta?.id,
      `${otioTrack.kind === 'Audio' ? 'a' : 'v'}${trackIndex + 1}`,
    );
    const kind =
      trackFastCatMeta?.kind === 'audio' || trackFastCatMeta?.kind === 'video'
        ? trackFastCatMeta.kind
        : trackKindFromOtioKind(otioTrack.kind);
    const name = coerceName(
      trackFastCatMeta?.name ?? otioTrack.name,
      kind === 'audio' ? `Audio ${trackIndex + 1}` : `Video ${trackIndex + 1}`,
    );

    const children = Array.isArray(otioTrack.children) ? otioTrack.children : [];
    const occupiedIds = new Set<string>();
    let cursorUs = 0;

    // Pre-scan track children to associate adjacent Transition.1 nodes with clips.
    // A Transition.1 before a Clip becomes transitionIn; one after becomes transitionOut.
    const pendingTransition: { node: any } | null = null;
    let pendingTransitionIn: import('./types').ClipTransition | null = null;

    const rawItems: TimelineTrackItem[] = [];

    for (let i = 0; i < children.length; i += 1) {
      const child = children[i] as any;

      if (child?.OTIO_SCHEMA === 'Transition.1') {
        // A Transition between two clips: attribute to next clip as transitionIn
        // and previously parsed clip as transitionOut (if exists).
        const transition = parseOtioTransition(child);
        if (transition) {
          // Attribute as transitionOut of previous clip.
          const prev = rawItems[rawItems.length - 1];
          if (prev && prev.kind === 'clip') {
            (prev as any).transitionOut = transition;
          }
          // Remember for next clip as transitionIn.
          pendingTransitionIn = transition;
        }
        // Transitions don't advance the cursor.
        continue;
      }

      if (child?.OTIO_SCHEMA === 'Gap.1') {
        const item = parseGapItem({
          trackId: id,
          otio: child as OtioGap,
          index: i,
          occupiedIds,
          fallbackStartUs: cursorUs,
        });
        rawItems.push(item);
        cursorUs += parseItemSequenceDurationUs(child);
        pendingTransitionIn = null;
        continue;
      }

      if (child?.OTIO_SCHEMA === 'Clip.1') {
        const item = parseClipItem({
          trackId: id,
          otio: child as OtioClip,
          index: i,
          occupiedIds,
          fallbackStartUs: cursorUs,
          transitionIn: pendingTransitionIn ?? undefined,
        });
        rawItems.push(item);
        cursorUs += parseItemSequenceDurationUs(child);
        pendingTransitionIn = null;
        continue;
      }
    }

    // Suppress unused variable warning.
    void pendingTransition;

    const items = [...rawItems].sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

    const videoHidden = kind === 'video' ? Boolean(trackFastCatMeta?.videoHidden) : undefined;
    const opacity =
      typeof trackFastCatMeta?.opacity === 'number' && Number.isFinite(trackFastCatMeta.opacity)
        ? Math.max(0, Math.min(1, Number(trackFastCatMeta.opacity)))
        : undefined;
    const blendMode = coerceBlendMode(trackFastCatMeta?.blendMode);
    const audioMuted = Boolean(trackFastCatMeta?.audioMuted);
    const audioSolo = Boolean(trackFastCatMeta?.audioSolo);
    const audioGain =
      typeof trackFastCatMeta?.audioGain === 'number' && Number.isFinite(trackFastCatMeta.audioGain)
        ? Math.max(0, Math.min(10, Number(trackFastCatMeta.audioGain)))
        : undefined;
    const audioBalance =
      typeof trackFastCatMeta?.audioBalance === 'number' && Number.isFinite(trackFastCatMeta.audioBalance)
        ? Math.max(-1, Math.min(1, Number(trackFastCatMeta.audioBalance)))
        : undefined;

    // Track effects: prefer OTIO standard, fallback to fastcat metadata.
    const effects =
      Array.isArray(otioTrack.effects) && otioTrack.effects.length > 0
        ? parseEffects(otioTrack.effects)
        : Array.isArray(trackFastCatMeta?.effects)
          ? (trackFastCatMeta.effects as ClipEffect[])
          : undefined;

    // Track-level markers (e.g. from an external OTIO).
    const trackMarkers =
      Array.isArray((otioTrack as any).markers) && (otioTrack as any).markers.length > 0
        ? parseOtioMarkers((otioTrack as any).markers)
        : undefined;

    return {
      id,
      kind,
      name,
      videoHidden,
      opacity,
      blendMode,
      audioMuted,
      audioSolo,
      audioGain,
      audioBalance,
      effects,
      items,
      ...(trackMarkers && trackMarkers.length > 0 ? { markers: trackMarkers } : {}),
    };
  });

  const docId = coerceId(fastcatMeta?.docId, fallback.id);
  const version = typeof fastcatMeta?.version === 'number' ? fastcatMeta.version : 0;
  const name = coerceName(parsed.name, fallback.name);

  // Markers: prefer standard OTIO markers on Timeline, fallback to fastcat metadata for old files.
  const markers =
    Array.isArray(parsed.markers) && (parsed.markers as any[]).length > 0
      ? parseOtioMarkers(parsed.markers as any[])
      : Array.isArray(fastcatMeta?.markers)
        ? parseOtioMarkers(fastcatMeta.markers)
        : [];

  const selectionRange = coerceSelectionRange(fastcatMeta?.selectionRange);
  const playheadUs =
    typeof fastcatMeta?.playheadUs === 'number' && Number.isFinite(fastcatMeta.playheadUs)
      ? Math.max(0, Math.round(fastcatMeta.playheadUs))
      : undefined;
  const snapThresholdPx =
    typeof fastcatMeta?.snapThresholdPx === 'number' && Number.isFinite(fastcatMeta.snapThresholdPx)
      ? Math.max(1, Math.round(fastcatMeta.snapThresholdPx))
      : undefined;

  if (tracks.length === 0) {
    const base = createDefaultTimelineDocument({ id: docId, name, fps: timebase.fps });
    base.metadata = {
      ...(base.metadata ?? {}),
      fastcat: {
        ...(base.metadata?.fastcat ?? {}),
        version,
        docId,
        timebase,
        markers,
        selectionRange,
        playheadUs,
        snapThresholdPx,
      },
    };
    return base;
  }

  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: docId,
    name,
    timebase,
    tracks,
    metadata: {
      fastcat: {
        version,
        docId,
        timebase,
        markers,
        playheadUs,
        snapThresholdPx,
      },
    },
  };
}
