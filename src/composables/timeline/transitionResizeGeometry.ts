import type { TimelineTrack, TimelineClipItem, ClipTransition } from '~/timeline/types';
import { DEFAULT_TRANSITION_MODE } from '~/transitions';
import { TICKS_PER_SECOND } from '~/utils/time';

/**
 * Pure geometry helpers behind the timeline transition-resize handles.
 *
 * Extracted from `useTimelineClipHandleResize` (a large pointer-event
 * composable) so the math can be unit-tested without simulating pointer drags.
 * The composable delegates to these and keeps owning the DOM/store wiring.
 */

/** A clip plus the optional fields the resize logic reads off it. */
type ClipWithResizeFields = TimelineClipItem & {
  sourceDurationTicks?: number;
  transitionIn?: ClipTransition | null;
  transitionOut?: ClipTransition | null;
};

/** Clips on a track, in start-time order (gaps and non-clips removed). */
export function getOrderedClipsOnTrack(track: TimelineTrack): TimelineClipItem[] {
  const clips = track.items.filter((it): it is TimelineClipItem => it.kind === 'clip');
  return [...clips].sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
}

/**
 * Resolve a clip and its neighbour on the same track for the given transition
 * edge: the previous clip for an `in` edge, the next for an `out` edge.
 */
export function getAdjacentClipForTransitionEdge(input: {
  tracks: TimelineTrack[];
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
}): { clip: TimelineClipItem; adjacent: TimelineClipItem | null } | null {
  const track = input.tracks.find((t) => t.id === input.trackId);
  if (!track) return null;
  const ordered = getOrderedClipsOnTrack(track);
  const idx = ordered.findIndex((c) => c.id === input.itemId);
  if (idx === -1) return null;
  const clip = ordered[idx]!;
  const adjacent =
    input.edge === 'in'
      ? idx > 0
        ? ordered[idx - 1]!
        : null
      : idx < ordered.length - 1
        ? ordered[idx + 1]!
        : null;
  return { clip, adjacent };
}

/**
 * How far an `adjacent`-mode transition handle may extend before it would pull
 * media past the neighbouring clip's available source. Infinite when there is
 * no source-bound neighbour (e.g. text/image clips).
 */
export function getTransitionAdjacentHandleLimitTicks(input: {
  edge: 'in' | 'out';
  adjacent: TimelineClipItem | null;
}): number {
  if (!input.adjacent) return Number.POSITIVE_INFINITY;

  if (input.edge === 'in') {
    const prev = input.adjacent as ClipWithResizeFields;
    const prevSourceEnd = (prev.sourceRange?.startTicks ?? 0) + (prev.sourceRange?.durationTicks ?? 0);
    const prevMaxEnd =
      (prev.clipType === 'media' || prev.clipType === 'timeline') && !prev.isImage
        ? (prev.sourceDurationTicks ?? prevSourceEnd)
        : Number.POSITIVE_INFINITY;
    return Number.isFinite(prevMaxEnd)
      ? Math.max(0, Math.round(Number(prevMaxEnd)) - Math.round(prevSourceEnd))
      : Number.POSITIVE_INFINITY;
  }

  return input.adjacent.clipType === 'media' || input.adjacent.clipType === 'timeline'
    ? Math.max(0, Math.round(Number(input.adjacent.sourceRange?.startTicks ?? 0)))
    : Number.POSITIVE_INFINITY;
}

/**
 * The largest duration a transition on `edge` may take, bounded by both the
 * clip's own length (minus the opposite-edge transition) and, in adjacent mode,
 * the neighbour's source headroom.
 */
export function computeMaxResizableTransitionDurationTicks(input: {
  tracks: TimelineTrack[];
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  currentTransition: ClipTransition;
}): number {
  const resolved = getAdjacentClipForTransitionEdge({
    tracks: input.tracks,
    trackId: input.trackId,
    itemId: input.itemId,
    edge: input.edge,
  });
  if (!resolved) return 10 * TICKS_PER_SECOND;

  const { clip, adjacent } = resolved;
  const clipFields = clip as ClipWithResizeFields;

  const clipDuration = clip.timelineRange.durationTicks;
  const oppTransitionTicks =
    input.edge === 'in'
      ? (clipFields.transitionOut?.durationTicks ?? 0)
      : (clipFields.transitionIn?.durationTicks ?? 0);
  const maxWithinClip = Math.max(0, clipDuration - oppTransitionTicks);

  let limitByHandle = Number.POSITIVE_INFINITY;

  const mode = input.currentTransition.mode ?? DEFAULT_TRANSITION_MODE;
  if (mode === 'adjacent' && adjacent) {
    limitByHandle = getTransitionAdjacentHandleLimitTicks({ edge: input.edge, adjacent });
  }

  return Math.min(maxWithinClip, limitByHandle);
}

/**
 * When an adjacent-mode handle is dragged near the boundary with its neighbour,
 * the duration it should snap to (the neighbour's source headroom), or null when
 * snapping does not apply.
 */
export function computeTransitionHandleSnapDurationTicks(input: {
  tracks: TimelineTrack[];
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  currentTransition: ClipTransition;
  rawDurationTicks: number;
}): number | null {
  const resolved = getAdjacentClipForTransitionEdge({
    tracks: input.tracks,
    trackId: input.trackId,
    itemId: input.itemId,
    edge: input.edge,
  });
  if (!resolved) return null;

  const { clip, adjacent } = resolved;
  const mode = input.currentTransition.mode ?? DEFAULT_TRANSITION_MODE;
  if (mode !== 'adjacent' || !adjacent) return null;

  const clipEdgeTicks =
    input.edge === 'in'
      ? clip.timelineRange.startTicks
      : clip.timelineRange.startTicks + clip.timelineRange.durationTicks;
  const adjacentEdgeTicks =
    input.edge === 'in'
      ? adjacent.timelineRange.startTicks + adjacent.timelineRange.durationTicks
      : adjacent.timelineRange.startTicks;
  const gapTicks = Math.abs(clipEdgeTicks - adjacentEdgeTicks);
  if (gapTicks !== 0) return null;

  const handleLimitTicks = getTransitionAdjacentHandleLimitTicks({ edge: input.edge, adjacent });

  if (!Number.isFinite(handleLimitTicks)) return null;
  return Math.max(0, Math.round(handleLimitTicks));
}
