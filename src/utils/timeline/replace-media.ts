import type { TimelineClipItem, TimelineRange } from '~/timeline/types';

/**
 * Property patch applied when a media clip's source is replaced with another
 * file. Always swaps `source.path`; additionally clamps the clip geometry so a
 * shorter replacement never leaves the clip pointing past the end of its new
 * source. When the replacement is longer, the clip keeps its current duration.
 */
export interface ReplaceMediaPatch {
  source: { path: string };
  sourceDurationTicks?: number;
  sourceRange?: TimelineRange;
  timelineRange?: TimelineRange;
}

/**
 * Builds the `updateClipProperties` patch for a media replacement.
 *
 * Range clamping rules (per the chosen "clamp to source" behaviour):
 *  - `sourceRange.startTicks` is kept when it still fits inside the new source,
 *    otherwise reset to `0` (the replacement is treated as starting fresh).
 *  - `sourceRange.durationTicks` is capped at `newSourceDurationTicks - startTicks`.
 *  - `timelineRange.durationTicks` follows via the clip's speed relationship
 *    (`sourceDurationTicks / |speed|`). Only `durationTicks` changes — the clip's
 *    timeline position is untouched, leaving a gap rather than rippling.
 *  - When the new source is longer (or equal), geometry is unchanged and only
 *    the `source` swap (plus `sourceDurationTicks`) is emitted.
 *
 * Only fields that actually differ from the current clip are included so the
 * history record stays minimal.
 */
export function buildReplaceMediaPatch(args: {
  clip: TimelineClipItem;
  newPath: string;
  newSourceDurationTicks: number;
}): ReplaceMediaPatch {
  const { clip, newPath, newSourceDurationTicks } = args;
  const patch: ReplaceMediaPatch = { source: { path: newPath } };

  if (!(newSourceDurationTicks > 0)) return patch;
  patch.sourceDurationTicks = newSourceDurationTicks;

  const currentStartTicks = Math.max(0, Math.round(clip.sourceRange.startTicks));
  const startTicks = currentStartTicks < newSourceDurationTicks ? currentStartTicks : 0;
  const availableTicks = Math.max(0, newSourceDurationTicks - startTicks);
  const sourceDurationTicks = Math.min(Math.round(clip.sourceRange.durationTicks), availableTicks);

  const speed = Math.abs(clip.speed ?? 1) || 1;
  const timelineDurationTicks = Math.floor(sourceDurationTicks / speed);

  if (
    startTicks !== clip.sourceRange.startTicks ||
    sourceDurationTicks !== clip.sourceRange.durationTicks
  ) {
    patch.sourceRange = { ...clip.sourceRange, startTicks, durationTicks: sourceDurationTicks };
  }
  if (timelineDurationTicks !== clip.timelineRange.durationTicks) {
    patch.timelineRange = { ...clip.timelineRange, durationTicks: timelineDurationTicks };
  }

  return patch;
}
