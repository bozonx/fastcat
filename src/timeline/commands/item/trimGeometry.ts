import type { TimelineRange } from '../../types';
import {
  clampInt,
  frameToTicks,
  quantizeDeltaTicksToFrames,
  quantizeRangeToFrames,
} from '../utils';
import { isClipFrameAligned } from '~/utils/timeline/clip-capabilities';

export interface TrimGeometryInput {
  edge: 'start' | 'end';
  /** Requested edge movement on the timeline, in canonical timeline ticks (sign per edge). */
  deltaTicks: number;
  /** Clip playback speed; negative values play the source in reverse. */
  speed: number | undefined;
  fps: number;
  quantizeToFrames: boolean;
  timelineRange: TimelineRange;
  sourceRange: TimelineRange;
  /** Total length of the underlying source material, if it is already known. */
  sourceDurationTicks: number | undefined;
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

  const deltaCandidate = Math.round(Number(input.deltaTicks));
  const deltaTicks = quantizeToFrames
    ? quantizeDeltaTicksToFrames(deltaCandidate, fps, 'round')
    : deltaCandidate;

  // A free (sub-frame) audio clip keeps its phase through a quantized trim: the
  // delta above is already whole-frame, so the moving edge shifts by whole frames
  // while the untrimmed edge (often a hand-dialed sync anchor) stays put. Snapping
  // the absolute range to the grid — as we do for already-aligned clips — would
  // re-grid that untrimmed edge. Only audio can be off-grid, so this never relaxes
  // the frame lock for video/virtual clips.
  const snapAbsoluteToGrid =
    quantizeToFrames && isClipFrameAligned({ timelineRange: input.timelineRange }, fps);
  const sourceDeltaTicks = Math.round(deltaTicks * absSpeed);

  const prevTimelineStartTicks = Math.max(0, Math.round(input.timelineRange.startTicks));
  const prevTimelineDurationTicks = Math.max(0, Math.round(input.timelineRange.durationTicks));
  const prevSourceStartTicks = Math.max(0, Math.round(input.sourceRange.startTicks));
  const prevSourceDurationTicks = Math.max(0, Math.round(input.sourceRange.durationTicks));
  const prevSourceEndTicks = prevSourceStartTicks + prevSourceDurationTicks;

  if (!hasFixedSourceDuration) {
    const prevTimelineEndTicks = prevTimelineStartTicks + prevTimelineDurationTicks;
    let nextTimelineStartTicks = prevTimelineStartTicks;
    let nextTimelineDurationTicks = prevTimelineDurationTicks;

    if (edge === 'start') {
      nextTimelineStartTicks = Math.max(
        0,
        Math.min(prevTimelineEndTicks, prevTimelineStartTicks + deltaTicks),
      );
      nextTimelineDurationTicks = Math.max(0, prevTimelineEndTicks - nextTimelineStartTicks);
    } else {
      nextTimelineDurationTicks = Math.max(0, prevTimelineDurationTicks + deltaTicks);
    }

    if (snapAbsoluteToGrid) {
      const qTimeline = quantizeRangeToFrames(
        { startTicks: nextTimelineStartTicks, durationTicks: nextTimelineDurationTicks },
        fps,
      );
      nextTimelineStartTicks = qTimeline.startTicks;
      nextTimelineDurationTicks = qTimeline.durationTicks;
    }

    const minFrameDurationTicks = frameToTicks(1, fps);
    const valid = nextTimelineDurationTicks >= minFrameDurationTicks;
    const nextSourceDurationTicks = Math.max(0, Math.round(nextTimelineDurationTicks * absSpeed));

    return {
      timelineRange: {
        startTicks: nextTimelineStartTicks,
        durationTicks: nextTimelineDurationTicks,
      },
      sourceRange: { startTicks: 0, durationTicks: nextSourceDurationTicks },
      valid,
    };
  }

  // Furthest source position the clip may consume. For material-backed clips with
  // an unknown duration we refuse to extend past what is already consumed.
  const rawSourceDurationTicks = Number(input.sourceDurationTicks);
  const knownSourceDurationTicks =
    Number.isFinite(rawSourceDurationTicks) && rawSourceDurationTicks > 0
      ? Math.round(rawSourceDurationTicks)
      : null;
  const minSourceStartTicks = hasFixedSourceDuration ? 0 : Number.NEGATIVE_INFINITY;
  const maxSourceEndTicks = hasFixedSourceDuration
    ? (knownSourceDurationTicks ?? prevSourceEndTicks)
    : Number.POSITIVE_INFINITY;

  let nextTimelineStartTicks = prevTimelineStartTicks;
  let nextTimelineDurationTicks = prevTimelineDurationTicks;
  let nextSourceStartTicks = prevSourceStartTicks;
  let nextSourceEndTicks = prevSourceEndTicks;

  if (edge === 'start') {
    if (speed >= 0) {
      const unclampedSourceStartTicks = prevSourceStartTicks + sourceDeltaTicks;
      if (unclampedSourceStartTicks < minSourceStartTicks) {
        const overshoot = minSourceStartTicks - unclampedSourceStartTicks;
        nextSourceStartTicks = minSourceStartTicks;
        nextSourceEndTicks = clampInt(
          prevSourceEndTicks + overshoot,
          prevSourceStartTicks,
          maxSourceEndTicks,
        );
      } else {
        nextSourceStartTicks = clampInt(
          unclampedSourceStartTicks,
          minSourceStartTicks,
          prevSourceEndTicks,
        );
        nextSourceEndTicks = prevSourceEndTicks;
      }
      const appliedDeltaTicks = nextSourceStartTicks - prevSourceStartTicks;
      const appliedTimelineDeltaTicks = Math.round(appliedDeltaTicks / absSpeed);

      nextTimelineStartTicks = Math.max(0, prevTimelineStartTicks + appliedTimelineDeltaTicks);
      nextTimelineDurationTicks = Math.max(
        0,
        prevTimelineDurationTicks - appliedTimelineDeltaTicks,
      );
    } else {
      // Reversed: trimming the timeline start moves the end of the source range.
      const unclampedSourceEndTicks = prevSourceEndTicks - sourceDeltaTicks;
      if (unclampedSourceEndTicks > maxSourceEndTicks) {
        const overshoot = unclampedSourceEndTicks - maxSourceEndTicks;
        nextSourceEndTicks = maxSourceEndTicks;
        nextSourceStartTicks = clampInt(
          prevSourceStartTicks - overshoot,
          minSourceStartTicks,
          prevSourceEndTicks,
        );
      } else {
        nextSourceEndTicks = clampInt(
          unclampedSourceEndTicks,
          prevSourceStartTicks,
          maxSourceEndTicks,
        );
        nextSourceStartTicks = prevSourceStartTicks;
      }
      const appliedDeltaTicks = prevSourceEndTicks - nextSourceEndTicks;
      const appliedTimelineDeltaTicks = Math.round(appliedDeltaTicks / absSpeed);

      nextTimelineStartTicks = Math.max(0, prevTimelineStartTicks + appliedTimelineDeltaTicks);
      nextTimelineDurationTicks = Math.max(
        0,
        prevTimelineDurationTicks - appliedTimelineDeltaTicks,
      );
    }
  } else {
    if (speed >= 0) {
      const unclampedSourceEndTicks = prevSourceEndTicks + sourceDeltaTicks;
      if (unclampedSourceEndTicks > maxSourceEndTicks) {
        const overshoot = unclampedSourceEndTicks - maxSourceEndTicks;
        nextSourceEndTicks = maxSourceEndTicks;
        nextSourceStartTicks = clampInt(
          prevSourceStartTicks - overshoot,
          minSourceStartTicks,
          prevSourceEndTicks,
        );
      } else {
        nextSourceEndTicks = clampInt(
          unclampedSourceEndTicks,
          prevSourceStartTicks,
          maxSourceEndTicks,
        );
        nextSourceStartTicks = prevSourceStartTicks;
      }
      const appliedDeltaTicks = nextSourceEndTicks - prevSourceEndTicks;
      const appliedTimelineDeltaTicks = Math.round(appliedDeltaTicks / absSpeed);

      nextTimelineDurationTicks = Math.max(
        0,
        prevTimelineDurationTicks + appliedTimelineDeltaTicks,
      );
      nextTimelineStartTicks = prevTimelineStartTicks;
    } else {
      // Reversed: trimming the timeline end moves the start of the source range.
      const unclampedSourceStartTicks = prevSourceStartTicks - sourceDeltaTicks;
      if (unclampedSourceStartTicks < minSourceStartTicks) {
        const overshoot = minSourceStartTicks - unclampedSourceStartTicks;
        nextSourceStartTicks = minSourceStartTicks;
        nextSourceEndTicks = clampInt(
          prevSourceEndTicks + overshoot,
          prevSourceStartTicks,
          maxSourceEndTicks,
        );
      } else {
        nextSourceStartTicks = clampInt(
          unclampedSourceStartTicks,
          minSourceStartTicks,
          prevSourceEndTicks,
        );
        nextSourceEndTicks = prevSourceEndTicks;
      }
      const appliedDeltaTicks = prevSourceStartTicks - nextSourceStartTicks;
      const appliedTimelineDeltaTicks = Math.round(appliedDeltaTicks / absSpeed);

      nextTimelineDurationTicks = Math.max(
        0,
        prevTimelineDurationTicks + appliedTimelineDeltaTicks,
      );
      nextTimelineStartTicks = prevTimelineStartTicks;
    }
  }

  let nextSourceDurationTicks = Math.max(0, nextSourceEndTicks - nextSourceStartTicks);

  if (snapAbsoluteToGrid) {
    const qTimeline = quantizeRangeToFrames(
      { startTicks: nextTimelineStartTicks, durationTicks: nextTimelineDurationTicks },
      fps,
    );

    // Quantization may shift timeline start/end by up to one frame. Re-derive
    // sourceRange from the quantized timeline so the invariant
    // sourceDuration = timelineDuration * absSpeed holds — otherwise long edits
    // accumulate sub-frame source drift.
    const deltaLeftTicks = qTimeline.startTicks - nextTimelineStartTicks;
    const deltaRightTicks =
      qTimeline.startTicks +
      qTimeline.durationTicks -
      (nextTimelineStartTicks + nextTimelineDurationTicks);

    nextTimelineStartTicks = qTimeline.startTicks;
    nextTimelineDurationTicks = qTimeline.durationTicks;

    if (speed >= 0) {
      nextSourceStartTicks = Math.max(
        0,
        nextSourceStartTicks + Math.round(deltaLeftTicks * absSpeed),
      );
      nextSourceEndTicks = Math.max(
        nextSourceStartTicks,
        nextSourceEndTicks + Math.round(deltaRightTicks * absSpeed),
      );
    } else {
      nextSourceStartTicks = Math.max(
        0,
        nextSourceStartTicks - Math.round(deltaRightTicks * absSpeed),
      );
      nextSourceEndTicks = Math.max(
        nextSourceStartTicks,
        nextSourceEndTicks - Math.round(deltaLeftTicks * absSpeed),
      );
    }

    // Frame quantization can nudge the re-derived source end up to a sub-frame
    // past the real material (a clip pulled flush to EOF). Reading past the end
    // freezes the last video frame and zero-pads audio (an end-of-clip click),
    // so pin the source back inside the material bounds. The timeline range stays
    // frame-quantized; only the source edge is clamped (a sub-frame correction).
    nextSourceEndTicks = Math.min(nextSourceEndTicks, maxSourceEndTicks);
    nextSourceStartTicks = Math.max(
      minSourceStartTicks,
      Math.min(nextSourceStartTicks, nextSourceEndTicks),
    );

    nextSourceDurationTicks = Math.max(0, nextSourceEndTicks - nextSourceStartTicks);
  }

  // Refuse to shrink below one frame — a zero-duration clip is invisible in the
  // UI and a hazard for downstream calculations (Math.min(...) === 0 chains).
  const minFrameDurationTicks = frameToTicks(1, fps);
  const valid = nextTimelineDurationTicks >= minFrameDurationTicks;

  return {
    timelineRange: { startTicks: nextTimelineStartTicks, durationTicks: nextTimelineDurationTicks },
    sourceRange: { startTicks: nextSourceStartTicks, durationTicks: nextSourceDurationTicks },
    valid,
  };
}
