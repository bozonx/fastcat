import type { TimelineRange } from '../../types';
import { clampInt, frameToUs, quantizeDeltaUsToFrames, quantizeRangeToFrames } from '../utils';

export interface TrimGeometryInput {
  edge: 'start' | 'end';
  /** Requested edge movement on the timeline, in microseconds (sign per edge). */
  deltaUs: number;
  /** Clip playback speed; negative values play the source in reverse. */
  speed: number | undefined;
  fps: number;
  quantizeToFrames: boolean;
  timelineRange: TimelineRange;
  sourceRange: TimelineRange;
  /** Total length of the underlying source material, if it is already known. */
  sourceDurationUs: number | undefined;
  /**
   * True for clips backed by finite source material (video/audio media and
   * nested timelines). Images and virtual clips (text/shape/background/...)
   * have no material limit and may be extended freely.
   */
  hasFixedSourceDuration: boolean;
}

export interface TrimGeometryResult {
  timelineRange: TimelineRange;
  sourceRange: TimelineRange;
  /** False when the trim would shrink the clip below one frame and must be rejected. */
  valid: boolean;
}

/**
 * Pure geometry for trimming a clip's start/end edge. Shared by `trim_item` and
 * `overlay_trim_item` so the two paths can never diverge.
 *
 * Material-backed clips (video/audio/nested timelines) can never grow past their
 * source: the furthest consumable source position is the known source duration,
 * or — when the duration has not been resolved yet (metadata still loading) —
 * the source the clip already consumes, so a clip is never extended into
 * material that does not exist.
 */
export function computeTrimGeometry(input: TrimGeometryInput): TrimGeometryResult {
  const { edge, fps, quantizeToFrames, hasFixedSourceDuration } = input;

  const speed = typeof input.speed === 'number' && Number.isFinite(input.speed) ? input.speed : 1;
  const absSpeed = Math.abs(speed) || 1;

  const deltaCandidate = Math.round(Number(input.deltaUs));
  const deltaUs = quantizeToFrames
    ? quantizeDeltaUsToFrames(deltaCandidate, fps, 'round')
    : deltaCandidate;
  const sourceDeltaUs = quantizeToFrames
    ? quantizeDeltaUsToFrames(Math.round(deltaUs * absSpeed), fps, 'round')
    : Math.round(deltaUs * absSpeed);

  const prevTimelineStartUs = Math.max(0, Math.round(input.timelineRange.startUs));
  const prevTimelineDurationUs = Math.max(0, Math.round(input.timelineRange.durationUs));
  const prevSourceStartUs = Math.max(0, Math.round(input.sourceRange.startUs));
  const prevSourceDurationUs = Math.max(0, Math.round(input.sourceRange.durationUs));
  const prevSourceEndUs = prevSourceStartUs + prevSourceDurationUs;

  // Furthest source position the clip may consume. For material-backed clips with
  // an unknown duration we refuse to extend past what is already consumed.
  const rawSourceDurationUs = Number(input.sourceDurationUs);
  const knownSourceDurationUs =
    Number.isFinite(rawSourceDurationUs) && rawSourceDurationUs > 0
      ? Math.round(rawSourceDurationUs)
      : null;
  const minSourceStartUs = hasFixedSourceDuration ? 0 : Number.NEGATIVE_INFINITY;
  const maxSourceEndUs = hasFixedSourceDuration
    ? (knownSourceDurationUs ?? prevSourceEndUs)
    : Number.POSITIVE_INFINITY;

  let nextTimelineStartUs = prevTimelineStartUs;
  let nextTimelineDurationUs = prevTimelineDurationUs;
  let nextSourceStartUs = prevSourceStartUs;
  let nextSourceEndUs = prevSourceEndUs;

  if (edge === 'start') {
    if (speed >= 0) {
      const unclampedSourceStartUs = prevSourceStartUs + sourceDeltaUs;
      if (unclampedSourceStartUs < minSourceStartUs) {
        const overshoot = minSourceStartUs - unclampedSourceStartUs;
        nextSourceStartUs = minSourceStartUs;
        nextSourceEndUs = clampInt(prevSourceEndUs + overshoot, prevSourceStartUs, maxSourceEndUs);
      } else {
        nextSourceStartUs = clampInt(unclampedSourceStartUs, minSourceStartUs, prevSourceEndUs);
        nextSourceEndUs = prevSourceEndUs;
      }
      const appliedDeltaUs = nextSourceStartUs - prevSourceStartUs;
      const appliedTimelineDeltaUs = Math.round(appliedDeltaUs / absSpeed);

      nextTimelineStartUs = Math.max(0, prevTimelineStartUs + appliedTimelineDeltaUs);
      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs - appliedTimelineDeltaUs);
    } else {
      // Reversed: trimming the timeline start moves the end of the source range.
      const unclampedSourceEndUs = prevSourceEndUs - sourceDeltaUs;
      if (unclampedSourceEndUs > maxSourceEndUs) {
        const overshoot = unclampedSourceEndUs - maxSourceEndUs;
        nextSourceEndUs = maxSourceEndUs;
        nextSourceStartUs = clampInt(prevSourceStartUs - overshoot, minSourceStartUs, prevSourceEndUs);
      } else {
        nextSourceEndUs = clampInt(unclampedSourceEndUs, prevSourceStartUs, maxSourceEndUs);
        nextSourceStartUs = prevSourceStartUs;
      }
      const appliedDeltaUs = prevSourceEndUs - nextSourceEndUs;
      const appliedTimelineDeltaUs = Math.round(appliedDeltaUs / absSpeed);

      nextTimelineStartUs = Math.max(0, prevTimelineStartUs + appliedTimelineDeltaUs);
      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs - appliedTimelineDeltaUs);
    }
  } else {
    if (speed >= 0) {
      const unclampedSourceEndUs = prevSourceEndUs + sourceDeltaUs;
      if (unclampedSourceEndUs > maxSourceEndUs) {
        const overshoot = unclampedSourceEndUs - maxSourceEndUs;
        nextSourceEndUs = maxSourceEndUs;
        nextSourceStartUs = clampInt(prevSourceStartUs - overshoot, minSourceStartUs, prevSourceEndUs);
      } else {
        nextSourceEndUs = clampInt(unclampedSourceEndUs, prevSourceStartUs, maxSourceEndUs);
        nextSourceStartUs = prevSourceStartUs;
      }
      const appliedDeltaUs = nextSourceEndUs - prevSourceEndUs;
      const appliedTimelineDeltaUs = Math.round(appliedDeltaUs / absSpeed);

      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs + appliedTimelineDeltaUs);
      nextTimelineStartUs = prevTimelineStartUs;
    } else {
      // Reversed: trimming the timeline end moves the start of the source range.
      const unclampedSourceStartUs = prevSourceStartUs - sourceDeltaUs;
      if (unclampedSourceStartUs < minSourceStartUs) {
        const overshoot = minSourceStartUs - unclampedSourceStartUs;
        nextSourceStartUs = minSourceStartUs;
        nextSourceEndUs = clampInt(prevSourceEndUs + overshoot, prevSourceStartUs, maxSourceEndUs);
      } else {
        nextSourceStartUs = clampInt(unclampedSourceStartUs, minSourceStartUs, prevSourceEndUs);
        nextSourceEndUs = prevSourceEndUs;
      }
      const appliedDeltaUs = prevSourceStartUs - nextSourceStartUs;
      const appliedTimelineDeltaUs = Math.round(appliedDeltaUs / absSpeed);

      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs + appliedTimelineDeltaUs);
      nextTimelineStartUs = prevTimelineStartUs;
    }
  }

  let nextSourceDurationUs = Math.max(0, nextSourceEndUs - nextSourceStartUs);

  if (quantizeToFrames) {
    const qTimeline = quantizeRangeToFrames(
      { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
      fps,
    );

    // Quantization may shift timeline start/end by up to one frame. Re-derive
    // sourceRange from the quantized timeline so the invariant
    // sourceDuration = timelineDuration * absSpeed holds — otherwise long edits
    // accumulate sub-frame source drift.
    const timelineDeltaStartUs = qTimeline.startUs - nextTimelineStartUs;
    const timelineDeltaDurationUs = qTimeline.durationUs - nextTimelineDurationUs;
    nextTimelineStartUs = qTimeline.startUs;
    nextTimelineDurationUs = qTimeline.durationUs;

    if (edge === 'start') {
      if (speed >= 0) {
        nextSourceStartUs = Math.max(
          0,
          nextSourceStartUs + Math.round(timelineDeltaStartUs * absSpeed),
        );
      } else {
        nextSourceEndUs = Math.max(
          nextSourceStartUs,
          nextSourceEndUs - Math.round(timelineDeltaStartUs * absSpeed),
        );
      }
    } else {
      if (speed >= 0) {
        nextSourceEndUs = Math.max(
          nextSourceStartUs,
          nextSourceEndUs + Math.round(timelineDeltaDurationUs * absSpeed),
        );
      } else {
        nextSourceStartUs = Math.max(
          0,
          nextSourceStartUs - Math.round(timelineDeltaDurationUs * absSpeed),
        );
      }
    }

    nextSourceDurationUs = Math.max(0, nextSourceEndUs - nextSourceStartUs);
  }

  // Refuse to shrink below one frame — a zero-duration clip is invisible in the
  // UI and a hazard for downstream calculations (Math.min(...) === 0 chains).
  const minFrameDurationUs = frameToUs(1, fps);
  const valid = nextTimelineDurationUs >= minFrameDurationUs;

  return {
    timelineRange: { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
    sourceRange: { startUs: nextSourceStartUs, durationUs: nextSourceDurationUs },
    valid,
  };
}
