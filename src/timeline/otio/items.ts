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
import { TimelineClipFastCatMetaSchema } from './schemas';

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

  const fastcatMeta = TimelineClipFastCatMetaSchema.parse(safeFastCatMetadata(otio.metadata));

  const clipType = fastcatMeta.clipType ?? (isOtioPath(path) ? 'timeline' : 'media');

  const timelineStartUs = fallbackStartUs;

  const sourceDurationUsFromMeta = Math.max(0, Math.round(fastcatMeta.sourceDurationUs ?? 0));
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
      : Array.isArray(fastcatMeta.effects)
        ? (fastcatMeta.effects as ClipEffect[])
        : undefined;

  const base = {
    kind: 'clip' as const,
    clipType,
    id,
    trackId,
    name,
    disabled: otio.enabled === false ? true : undefined,
    locked: fastcatMeta.locked,
    sourceDurationUs,
    timelineRange: { startUs: timelineStartUs, durationUs: sourceRange.durationUs },
    sourceRange,
    speed: fastcatMeta.speed,
    audioGain: fastcatMeta.audioGain,
    audioBalance: fastcatMeta.audioBalance,
    audioFadeInUs:
      fastcatMeta.audioFadeInUs !== undefined ? Math.round(fastcatMeta.audioFadeInUs) : undefined,
    audioFadeOutUs:
      fastcatMeta.audioFadeOutUs !== undefined ? Math.round(fastcatMeta.audioFadeOutUs) : undefined,
    audioFadeInCurve: fastcatMeta.audioFadeInCurve,
    audioFadeOutCurve: fastcatMeta.audioFadeOutCurve,
    audioMuted: fastcatMeta.audioMuted,
    audioWaveformMode: fastcatMeta.audioWaveformMode,
    showWaveform: fastcatMeta.showWaveform,
    audioFromVideoDisabled: Boolean(fastcatMeta.audioFromVideoDisabled),
    freezeFrameSourceUs:
      clipType === 'media' && fastcatMeta.freezeFrameSourceUs !== undefined
        ? Math.round(fastcatMeta.freezeFrameSourceUs)
        : undefined,
    opacity: fastcatMeta.opacity,
    blendMode: coerceBlendMode(fastcatMeta.blendMode),
    effects: otioEffects,
    transitionIn: transitionIn ?? parseFastCatTransition(fastcatMeta.transitionIn),
    transitionOut: transitionOut ?? parseFastCatTransition(fastcatMeta.transitionOut),
    linkedGroupId: fastcatMeta.linkedGroupId,
    linkedVideoClipId: fastcatMeta.linkedVideoClipId,
    lockToLinkedVideo: fastcatMeta.lockToLinkedVideo,
    isImage: fastcatMeta.isImage,
    transform: coerceTransform(fastcatMeta.transform),
    mask: fastcatMeta.mask as any,
  };

  if (clipType === 'background') {
    return {
      ...base,
      clipType: 'background',
      backgroundColor: sanitizeTimelineColor(fastcatMeta.backgroundColor, '#000000'),
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
      timelineRange: { startUs: timelineStartUs, durationUs: sourceRange.durationUs },
      sourceRange,
      text: fastcatMeta.text ?? 'Text',
      style: fastcatMeta.style,
    };
  }

  if (clipType === 'shape') {
    return {
      ...base,
      clipType: 'shape',
      sourceDurationUs,
      timelineRange: { startUs: timelineStartUs, durationUs: sourceRange.durationUs },
      sourceRange,
      shapeType: fastcatMeta.shapeType ?? 'square',
      fillColor:
        fastcatMeta.fillColor && fastcatMeta.fillColor.trim().length > 0
          ? fastcatMeta.fillColor
          : '#ffffff',
      strokeColor:
        fastcatMeta.strokeColor && fastcatMeta.strokeColor.trim().length > 0
          ? fastcatMeta.strokeColor
          : '#000000',
      strokeWidth: fastcatMeta.strokeWidth ?? 0,
      shapeConfig: fastcatMeta.shapeConfig,
    };
  }

  if (clipType === 'hud') {
    return {
      ...base,
      clipType: 'hud',
      hudType: fastcatMeta.hudType ?? 'media_frame',
      background: fastcatMeta.background,
      content: fastcatMeta.content,
      frame: fastcatMeta.frame,
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
