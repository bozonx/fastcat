import type { TimelineClipItem, TimelineGapItem, ClipTransition } from '../types';
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
import { parseEffects, parseFastCatTransition } from './serialization';
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

  // Source duration: prefer OTIO available_range, then fastcat metadata.
  const availableRange =
    ref?.OTIO_SCHEMA === 'ExternalReference.1' && ref.available_range
      ? fromTimeRange(ref.available_range)
      : null;

  const fastcatMeta = TimelineClipFastCatMetaSchema.parse(safeFastCatMetadata(otio.metadata));

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

  const base = {
    kind: 'clip' as const,
    clipType,
    id,
    trackId,
    name,
    disabled: otio.enabled === false ? true : undefined,
    locked: fastcatMeta.flags?.locked,
    sourceDurationUs,
    timelineRange: { startUs: timelineStartUs, durationUs: sourceRange.durationUs },
    sourceRange,
    speed: fastcatMeta.playback?.speed,
    speedActive: fastcatMeta.flags?.speedActive,
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
      clipType === 'media' && fastcatMeta.playback?.freezeFrameSourceUs !== undefined
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
    transform: coerceTransform(fastcatMeta.transform),
    transformActive: fastcatMeta.flags?.transformActive,
    mask: fastcatMeta.mask as any,
    maskActive: fastcatMeta.flags?.maskActive,
    ignored: fastcatMeta.flags?.ignored,
  };

  if (clipType === 'background') {
    return {
      ...base,
      clipType: 'background',
      backgroundColor: sanitizeTimelineColor(fastcatMeta.typeData?.background?.color, '#000000'),
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
      text: fastcatMeta.typeData?.text?.text ?? 'Text',
      style: fastcatMeta.typeData?.text?.style,
    };
  }

  if (clipType === 'shape') {
    return {
      ...base,
      clipType: 'shape',
      sourceDurationUs,
      timelineRange: { startUs: timelineStartUs, durationUs: sourceRange.durationUs },
      sourceRange,
      shapeType: fastcatMeta.typeData?.shape?.type ?? 'square',
      fillColor:
        fastcatMeta.typeData?.shape?.fillColor &&
        fastcatMeta.typeData.shape.fillColor.trim().length > 0
          ? fastcatMeta.typeData.shape.fillColor
          : '#ffffff',
      strokeColor:
        fastcatMeta.typeData?.shape?.strokeColor &&
        fastcatMeta.typeData.shape.strokeColor.trim().length > 0
          ? fastcatMeta.typeData.shape.strokeColor
          : '#000000',
      strokeWidth: fastcatMeta.typeData?.shape?.strokeWidth ?? 0,
      shapeConfig: fastcatMeta.typeData?.shape?.config,
    };
  }

  if (clipType === 'hud') {
    return {
      ...base,
      clipType: 'hud',
      hudType: fastcatMeta.typeData?.hud?.type ?? 'media_frame',
      background: fastcatMeta.typeData?.hud?.background,
      content: fastcatMeta.typeData?.hud?.content,
      frame: fastcatMeta.typeData?.hud?.frame,
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
