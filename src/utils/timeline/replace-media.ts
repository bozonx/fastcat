import type { TimelineClipItem, TimelineRange } from '~/timeline/types';

/**
 * Property patch applied when a media clip's source is replaced with another
 * file. Always swaps `source.path`; additionally clamps the clip geometry so a
 * shorter replacement never leaves the clip pointing past the end of its new
 * source. When the replacement is longer, the clip keeps its current duration.
 */
export interface ReplaceMediaPatch {
  source: { path: string };
  sourceDurationUs?: number;
  sourceRange?: TimelineRange;
  timelineRange?: TimelineRange;
}

/**
 * Builds the `updateClipProperties` patch for a media replacement.
 *
 * Range clamping rules (per the chosen "clamp to source" behaviour):
 *  - `sourceRange.startUs` is kept when it still fits inside the new source,
 *    otherwise reset to `0` (the replacement is treated as starting fresh).
 *  - `sourceRange.durationUs` is capped at `newSourceDurationUs - startUs`.
 *  - `timelineRange.durationUs` follows via the clip's speed relationship
 *    (`sourceDurationUs / |speed|`). Only `durationUs` changes — the clip's
 *    timeline position is untouched, leaving a gap rather than rippling.
 *  - When the new source is longer (or equal), geometry is unchanged and only
 *    the `source` swap (plus `sourceDurationUs`) is emitted.
 *
 * Only fields that actually differ from the current clip are included so the
 * history record stays minimal.
 */
export function buildReplaceMediaPatch(args: {
  clip: TimelineClipItem;
  newPath: string;
  newSourceDurationUs: number;
}): ReplaceMediaPatch {
  const { clip, newPath, newSourceDurationUs } = args;
  const patch: ReplaceMediaPatch = { source: { path: newPath } };

  if (!(newSourceDurationUs > 0)) return patch;
  patch.sourceDurationUs = newSourceDurationUs;

  const currentStartUs = Math.max(0, Math.round(clip.sourceRange.startUs));
  const startUs = currentStartUs < newSourceDurationUs ? currentStartUs : 0;
  const availableUs = Math.max(0, newSourceDurationUs - startUs);
  const sourceDurationUs = Math.min(Math.round(clip.sourceRange.durationUs), availableUs);

  const speed = Math.abs(clip.speed ?? 1) || 1;
  const timelineDurationUs = Math.floor(sourceDurationUs / speed);

  if (startUs !== clip.sourceRange.startUs || sourceDurationUs !== clip.sourceRange.durationUs) {
    patch.sourceRange = { ...clip.sourceRange, startUs, durationUs: sourceDurationUs };
  }
  if (timelineDurationUs !== clip.timelineRange.durationUs) {
    patch.timelineRange = { ...clip.timelineRange, durationUs: timelineDurationUs };
  }

  return patch;
}
