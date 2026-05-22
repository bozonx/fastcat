import type { TimelineClipItem, TimelineGapItem, ClipTransition } from '../types';
import type { OtioAnyClip } from './types';
import {
  fromTimeRange,
  safeFastCatMetadata,
  isOtioPath,
  resolveStableItemId,
  coerceName,
  fromRationalTimeUs,
  coerceTransform,
  coerceBlendMode,
  type OtioValidationReport,
} from './utils';
import { parseEffects, parseFastCatTransition, parseTimeEffects } from './serialization';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';
import { TimelineClipFastCatMetaSchema } from './schemas';

// ---------------------------------------------------------------------------
// Sequence duration helper
// ---------------------------------------------------------------------------

export function parseItemSequenceDurationUs(child: unknown): number {
  if (!child || typeof child !== 'object') return 0;
  const schema = child.OTIO_SCHEMA;
  if (schema === 'Gap.1' || schema === 'Clip.1' || schema === 'Clip.2') {
    return Math.max(0, fromRationalTimeUs(child?.source_range?.duration));
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Helpers for backward-compatible metadata reading
// ---------------------------------------------------------------------------

function parseDiscriminatedTypeData(raw: unknown):
  | { kind: 'background'; color?: string }
  | { kind: 'text'; text?: string; style?: unknown }
  | {
      kind: 'shape';
      type?: string;
      fillColor?: string;
      strokeColor?: string;
      strokeWidth?: number;
      config?: unknown;
    }
  | { kind: 'hud'; type?: string; background?: unknown; content?: unknown; frame?: unknown }
  | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;

  if (kind === 'background') {
    return { kind: 'background', color: typeof obj.color === 'string' ? obj.color : undefined };
  }
  if (kind === 'text') {
    return {
      kind: 'text',
      text: typeof obj.text === 'string' ? obj.text : undefined,
      style: obj.style,
    };
  }
  if (kind === 'shape') {
    return {
      kind: 'shape',
      type: typeof obj.type === 'string' ? obj.type : undefined,
      fillColor: typeof obj.fillColor === 'string' ? obj.fillColor : undefined,
      strokeColor: typeof obj.strokeColor === 'string' ? obj.strokeColor : undefined,
      strokeWidth: typeof obj.strokeWidth === 'number' ? obj.strokeWidth : undefined,
      config: obj.config,
    };
  }
  if (kind === 'hud') {
    return {
      kind: 'hud',
      type: typeof obj.type === 'string' ? obj.type : undefined,
      background: obj.background,
      content: obj.content,
      frame: obj.frame,
    };
  }

  // Legacy non-discriminated fallback
  if (obj.background && typeof obj.background === 'object') {
    return {
      kind: 'background',
      color: (obj.background as Record<string, unknown>).color as string | undefined,
    };
  }
  if (obj.text && typeof obj.text === 'object') {
    const textObj = obj.text as Record<string, unknown>;
    return { kind: 'text', text: textObj.text as string | undefined, style: textObj.style };
  }
  if (obj.shape && typeof obj.shape === 'object') {
    const shapeObj = obj.shape as Record<string, unknown>;
    return {
      kind: 'shape',
      type: shapeObj.type as string | undefined,
      fillColor: shapeObj.fillColor as string | undefined,
      strokeColor: shapeObj.strokeColor as string | undefined,
      strokeWidth: shapeObj.strokeWidth as number | undefined,
      config: shapeObj.config,
    };
  }
  if (obj.hud && typeof obj.hud === 'object') {
    const hudObj = obj.hud as Record<string, unknown>;
    return {
      kind: 'hud',
      type: hudObj.type as string | undefined,
      background: hudObj.background,
      content: hudObj.content,
      frame: hudObj.frame,
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Clip / Gap parsers
// ---------------------------------------------------------------------------

export function parseClipItem(input: {
  trackId: string;
  otio: OtioAnyClip;
  index: number;
  occupiedIds: Set<string>;
  fallbackStartUs: number;
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
  report?: OtioValidationReport;
}): TimelineClipItem {
  const {
    trackId,
    otio,
    index,
    occupiedIds,
    fallbackStartUs,
    transitionIn,
    transitionOut,
  } = input;
  const sourceRange = fromTimeRange(otio.source_range);
  const name = coerceName(otio.name, `clip_${index + 1}`);

  const ref = otio.media_reference as unknown as { OTIO_SCHEMA?: string; target_url?: string };
  const path =
    ref?.OTIO_SCHEMA === 'ExternalReference.1' && typeof ref.target_url === 'string'
      ? ref.target_url
      : '';

  // Source duration: prefer OTIO available_range, then fastcat metadata.
  const availableRange =
    ref?.OTIO_SCHEMA === 'ExternalReference.1' && ref.available_range
      ? fromTimeRange(ref.available_range)
      : null;

  const rawFastcat = safeFastCatMetadata(otio.metadata);

  // Try new grouped schema first, fallback to legacy flat schema
  const fastcatMeta = TimelineClipFastCatMetaSchema.parse(rawFastcat);

  // If the new schema returned empty but raw has data, it might be old flat format.
  // The schema already handles this because the structure is similar.
  // However, for the document-level grouping, we handle it separately in otio-serializer.ts.

  const clipType = fastcatMeta.clipType ?? (isOtioPath(path) ? 'timeline' : 'media');

  const timelineStartUs = fallbackStartUs;

  const sourceDurationUsFromMeta = Math.max(0, Math.round(fastcatMeta.source?.durationUs ?? 0));
  const sourceDurationUs =
    availableRange?.durationUs && availableRange.durationUs > 0
      ? availableRange.durationUs
      : sourceDurationUsFromMeta > 0
        ? sourceDurationUsFromMeta
        : sourceRange.durationUs;

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
    Array.isArray(otio.effects) && otio.effects.length > 0 ? parseEffects(otio.effects) : undefined;

  // Time effects: parse LinearTimeWarp / FreezeFrame if present
  const timeEffects = parseTimeEffects((otio.effects as unknown[]) ?? []);

  const isDisabled = otio.enabled === false;

  // Roundtrip ranges override source/timeline ranges if present
  const roundtripTimelineRange = fastcatMeta.roundtrip?.timelineRange;
  const roundtripSourceRange = fastcatMeta.roundtrip?.sourceRange;

  const finalTimelineRange = roundtripTimelineRange
    ? {
        startUs: Math.round(roundtripTimelineRange.startUs),
        durationUs: Math.round(roundtripTimelineRange.durationUs),
      }
    : { startUs: timelineStartUs, durationUs: sourceRange.durationUs };

  const finalSourceRange = roundtripSourceRange
    ? {
        startUs: Math.round(roundtripSourceRange.startUs),
        durationUs: Math.round(roundtripSourceRange.durationUs),
      }
    : sourceRange;

  const base = {
    kind: 'clip' as const,
    clipType,
    id,
    trackId,
    name,
    disabled: isDisabled ? true : undefined,
    locked: fastcatMeta.flags?.locked,
    sourceDurationUs,
    timelineRange: finalTimelineRange,
    sourceRange: finalSourceRange,
    speed: timeEffects.speed ?? fastcatMeta.playback?.speed,
    speedActive: timeEffects.speedActive ?? fastcatMeta.flags?.speedActive,
    audioGain: fastcatMeta.audio?.gain,
    audioBalance: fastcatMeta.audio?.balance,
    audioFadeInUs:
      fastcatMeta.audio?.fadeInUs !== undefined
        ? Math.round(fastcatMeta.audio.fadeInUs)
        : undefined,
    audioFadeOutUs:
      fastcatMeta.audio?.fadeOutUs !== undefined
        ? Math.round(fastcatMeta.audio.fadeOutUs)
        : undefined,
    audioFadeInCurve: fastcatMeta.audio?.fadeInCurve,
    audioFadeOutCurve: fastcatMeta.audio?.fadeOutCurve,
    audioFadesActive: fastcatMeta.flags?.audioFadesActive,
    audioMuted: fastcatMeta.audio?.muted,
    audioWaveformMode: fastcatMeta.audio?.waveformMode,
    showWaveform: fastcatMeta.audio?.showWaveform,
    audioFromVideoDisabled: Boolean(fastcatMeta.audio?.fromVideoDisabled),
    freezeFrameSourceUs:
      clipType === 'media' && timeEffects.freezeFrameSourceUs !== undefined
        ? Math.round(timeEffects.freezeFrameSourceUs)
        : fastcatMeta.playback?.freezeFrameSourceUs !== undefined
          ? Math.round(fastcatMeta.playback.freezeFrameSourceUs)
          : undefined,
    opacity: fastcatMeta.visual?.opacity,
    opacityActive: fastcatMeta.flags?.opacityActive,
    blendMode: coerceBlendMode(fastcatMeta.visual?.blendMode),
    blendModeActive: fastcatMeta.flags?.blendModeActive,
    effects: otioEffects,
    transitionIn: transitionIn ?? parseFastCatTransition(fastcatMeta.transitions?.in),
    transitionOut: transitionOut ?? parseFastCatTransition(fastcatMeta.transitions?.out),
    linkedGroupId: fastcatMeta.links?.linkedGroupId,
    linkedVideoClipId: fastcatMeta.links?.linkedVideoClipId,
    lockToLinkedVideo: fastcatMeta.links?.lockToLinkedVideo,
    isImage: fastcatMeta.visual?.isImage,
    showThumbnails: fastcatMeta.visual?.showThumbnails,
    sourceOrientation: fastcatMeta.visual?.sourceOrientation,
    transform: coerceTransform(fastcatMeta.transform),
    transformActive: fastcatMeta.flags?.transformActive,
    mask: fastcatMeta.mask as unknown,
    maskActive: fastcatMeta.flags?.maskActive,
  };

  const typeData = parseDiscriminatedTypeData(fastcatMeta.typeData);

  if (clipType === 'background') {
    const bgColor =
      typeData?.kind === 'background'
        ? sanitizeTimelineColor(typeData.color, '#000000')
        : sanitizeTimelineColor(
            (fastcatMeta.typeData as unknown as { background?: { color?: string } })?.background
              ?.color,
            '#000000',
          );
    return {
      ...base,
      clipType: 'background',
      backgroundColor: bgColor,
    };
  }

  if (clipType === 'adjustment') {
    return { ...base, clipType: 'adjustment' };
  }

  if (clipType === 'text') {
    return {
      ...base,
      clipType: 'text',
      sourceDurationUs,
      timelineRange: finalTimelineRange,
      sourceRange: finalSourceRange,
      text:
        typeData?.kind === 'text'
          ? (typeData.text ?? 'Text')
          : ((fastcatMeta.typeData as unknown as { text?: { text?: string } })?.text?.text ??
            'Text'),
      style:
        typeData?.kind === 'text'
          ? typeData.style
          : (
              fastcatMeta.typeData as unknown as {
                text?: { style?: import('~/timeline/types').TextClipStyle };
              }
            )?.text?.style,
    };
  }

  if (clipType === 'shape') {
    const shapeData =
      typeData?.kind === 'shape'
        ? typeData
        : (fastcatMeta.typeData as unknown as { shape?: unknown })?.shape;
    return {
      ...base,
      clipType: 'shape',
      sourceDurationUs,
      timelineRange: finalTimelineRange,
      sourceRange: finalSourceRange,
      shapeType: (shapeData?.type ?? 'square') as string,
      fillColor:
        shapeData?.fillColor && shapeData.fillColor.trim().length > 0
          ? shapeData.fillColor
          : '#ffffff',
      strokeColor:
        shapeData?.strokeColor && shapeData.strokeColor.trim().length > 0
          ? shapeData.strokeColor
          : '#000000',
      strokeWidth: shapeData?.strokeWidth ?? 0,
      shapeConfig: shapeData?.config as unknown,
    };
  }

  if (clipType === 'hud') {
    const hudData =
      typeData?.kind === 'hud'
        ? typeData
        : (fastcatMeta.typeData as unknown as { hud?: unknown })?.hud;
    return {
      ...base,
      clipType: 'hud',
      hudType: (hudData?.type ?? 'media_frame') as string,
      background: hudData?.background as unknown,
      content: hudData?.content as unknown,
      frame: hudData?.frame as unknown,
    };
  }

  if (clipType === 'timeline') {
    return { ...base, clipType: 'timeline', source: { path } };
  }

  return { ...base, clipType: 'media', source: { path } };
}

export function parseGapItem(input: {
  trackId: string;
  otio: { source_range: unknown; metadata?: unknown };
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
