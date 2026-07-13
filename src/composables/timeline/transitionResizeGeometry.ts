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
  sourceDurationUs?: number;
  transitionIn?: ClipTransition | null;
  transitionOut?: ClipTransition | null;
};

/** Clips on a track, in start-time order (gaps and non-clips removed). */
export function getOrderedClipsOnTrack(track: TimelineTrack): TimelineClipItem[] {
  const clips = track.items.filter((it): it is TimelineClipItem => it.kind === 'clip');
  return [...clips].sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
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
export function getTransitionAdjacentHandleLimitUs(input: {
  edge: 'in' | 'out';
  adjacent: TimelineClipItem | null;
}): number {
  if (!input.adjacent) return Number.POSITIVE_INFINITY;

  if (input.edge === 'in') {
    const prev = input.adjacent as ClipWithResizeFields;
    const prevSourceEnd = (prev.sourceRange?.startUs ?? 0) + (prev.sourceRange?.durationUs ?? 0);
    const prevMaxEnd =
      (prev.clipType === 'media' || prev.clipType === 'timeline') && !prev.isImage
        ? (prev.sourceDurationUs ?? prevSourceEnd)
        : Number.POSITIVE_INFINITY;
    return Number.isFinite(prevMaxEnd)
      ? Math.max(0, Math.round(Number(prevMaxEnd)) - Math.round(prevSourceEnd))
      : Number.POSITIVE_INFINITY;
  }

  return input.adjacent.clipType === 'media' || input.adjacent.clipType === 'timeline'
    ? Math.max(0, Math.round(Number(input.adjacent.sourceRange?.startUs ?? 0)))
    : Number.POSITIVE_INFINITY;
}

/**
 * The largest duration a transition on `edge` may take, bounded by both the
 * clip's own length (minus the opposite-edge transition) and, in adjacent mode,
 * the neighbour's source headroom.
 */
export function computeMaxResizableTransitionDurationUs(input: {
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

  const clipDuration = clip.timelineRange.durationUs;
  const oppTransitionUs =
    input.edge === 'in'
      ? (clipFields.transitionOut?.durationUs ?? 0)
      : (clipFields.transitionIn?.durationUs ?? 0);
  const maxWithinClip = Math.max(0, clipDuration - oppTransitionUs);

  let limitByHandle = Number.POSITIVE_INFINITY;

  const mode = input.currentTransition.mode ?? DEFAULT_TRANSITION_MODE;
  if (mode === 'adjacent' && adjacent) {
    limitByHandle = getTransitionAdjacentHandleLimitUs({ edge: input.edge, adjacent });
  }

  return Math.min(maxWithinClip, limitByHandle);
}

/**
 * When an adjacent-mode handle is dragged near the boundary with its neighbour,
 * the duration it should snap to (the neighbour's source headroom), or null when
 * snapping does not apply.
 */
export function computeTransitionHandleSnapDurationUs(input: {
  tracks: TimelineTrack[];
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  currentTransition: ClipTransition;
  rawDurationUs: number;
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

  const clipEdgeUs =
    input.edge === 'in'
      ? clip.timelineRange.startUs
      : clip.timelineRange.startUs + clip.timelineRange.durationUs;
  const adjacentEdgeUs =
    input.edge === 'in'
      ? adjacent.timelineRange.startUs + adjacent.timelineRange.durationUs
      : adjacent.timelineRange.startUs;
  const gapUs = Math.abs(clipEdgeUs - adjacentEdgeUs);
  if (gapUs !== 0) return null;

  const handleLimitUs = getTransitionAdjacentHandleLimitUs({ edge: input.edge, adjacent });

  if (!Number.isFinite(handleLimitUs)) return null;
  return Math.max(0, Math.round(handleLimitUs));
}
