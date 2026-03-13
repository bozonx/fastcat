import type { TimelineClipItem, TimelineGapItem, ClipEffect, ClipTransition } from '../types';
import type { OtioClip, OtioGap } from './types';
import {
  fromTimeRange,
  safeFastCatMetadata,
  isOtioPath,
  resolveStableItemId,
  coerceName,
  fromRationalTimeUs,
  coerceTransform,
  coerceBlendMode,
} from './utils';
import { parseEffects, parseFastCatTransition } from './components';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';

// ---------------------------------------------------------------------------
// Sequence duration helper
// ---------------------------------------------------------------------------

export function parseItemSequenceDurationUs(child: any): number {
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

export function parseClipItem(input: {
  trackId: string;
  otio: OtioClip;
  index: number;
  occupiedIds: Set<string>;
  fallbackStartUs: number;
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
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

  const sourceDurationUsFromMeta = Math.max(
    0,
    Math.round(Number(fastcatMeta?.sourceDurationUs ?? 0)),
  );
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
      fastcatMeta?.audioFadeOutCurve === 'linear' ||
      fastcatMeta?.audioFadeOutCurve === 'logarithmic'
        ? fastcatMeta.audioFadeOutCurve
        : undefined,
    audioMuted: fastcatMeta?.audioMuted !== undefined ? Boolean(fastcatMeta.audioMuted) : undefined,
    audioWaveformMode:
      fastcatMeta?.audioWaveformMode === 'half' || fastcatMeta?.audioWaveformMode === 'full'
        ? fastcatMeta.audioWaveformMode
        : undefined,
    showWaveform:
      fastcatMeta?.showWaveform !== undefined ? Boolean(fastcatMeta.showWaveform) : undefined,
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
      fastcatMeta?.lockToLinkedVideo !== undefined
        ? Boolean(fastcatMeta.lockToLinkedVideo)
        : undefined,
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
        fastcatMeta?.content && typeof fastcatMeta.content === 'object'
          ? fastcatMeta.content
          : undefined,
    };
  }

  if (clipType === 'timeline') {
    return { ...base, clipType: 'timeline', source: { path } };
  }

  return { ...base, clipType: 'media', source: { path } };
}

export function parseGapItem(input: {
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
