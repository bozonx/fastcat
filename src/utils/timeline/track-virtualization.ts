import type { TimelineClipItem, TimelineTrackItem } from '~/timeline/types';

/**
 * Pure helpers behind the timeline track virtualization (see
 * `useTimelineTrackVirtualization`). Extracted from `TimelineTracks.vue` so the
 * windowing/memo logic can be unit-tested without mounting the component.
 */

/** Pixel geometry of a single item on the timeline. */
export interface ItemGeometry {
  startPx: number;
  widthPx: number;
  endPx: number;
}

/** Per-track index used to window items by horizontal viewport range. */
export interface TrackVisibilityIndexEntry {
  isSortedByStart: boolean;
  prefixMaxEndPositions: number[];
  startPositions: number[];
}

/**
 * A stable string that changes whenever any rendered property of an item
 * changes. Used as a `v-memo` key so a track only re-renders when one of its
 * visible items actually changes.
 */
export function buildClipRenderMemo(item: TimelineTrackItem): string {
  if (item.kind !== 'clip') {
    return [item.id, item.timelineRange.startUs, item.timelineRange.durationUs].join(':');
  }

  const clip = item as TimelineClipItem;
  return [
    clip.id,
    clip.timelineRange.startUs,
    clip.timelineRange.durationUs,
    clip.sourceRange?.startUs ?? '',
    clip.sourceRange?.durationUs ?? '',
    clip.name,
    clip.locked ? 1 : 0,
    clip.disabled ? 1 : 0,
    clip.audioMuted ? 1 : 0,
    clip.showWaveform !== false ? 1 : 0,
    clip.showThumbnails !== false ? 1 : 0,
    clip.audioWaveformMode ?? 'half',
    clip.audioGain ?? 1,
    clip.audioBalance ?? 0,
    clip.audioFadeInUs ?? 0,
    clip.audioFadeOutUs ?? 0,
    clip.audioFadeInCurve ?? 'linear',
    clip.audioFadeOutCurve ?? 'linear',
    clip.speed ?? 1,
    clip.freezeFrameSourceUs ?? '',
    clip.transitionIn?.type ?? '',
    clip.transitionIn?.durationUs ?? 0,
    clip.transitionIn?.curve ?? '',
    clip.transitionOut?.type ?? '',
    clip.transitionOut?.durationUs ?? 0,
    clip.transitionOut?.curve ?? '',
  ].join(':');
}

/** First index whose value is `>= target` (assumes ascending `values`). */
export function lowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid]! < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/** First index whose value is `> target` (assumes ascending `values`). */
export function upperBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid]! <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * Build the per-track visibility index from precomputed item geometries. When a
 * track's items are already sorted by start position we can binary-search the
 * visible window; otherwise the index is flagged so callers fall back to a full
 * filter.
 */
export function buildTrackVisibilityIndex(
  items: TimelineTrackItem[],
  geometries: Map<string, ItemGeometry>,
): TrackVisibilityIndexEntry {
  const startPositions: number[] = [];
  const prefixMaxEndPositions: number[] = [];
  let isSortedByStart = true;
  let lastStart = Number.NEGATIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const geo = geometries.get(item.id);
    if (!geo) {
      isSortedByStart = false;
      break;
    }

    startPositions.push(geo.startPx);
    if (geo.startPx < lastStart) {
      isSortedByStart = false;
    }
    lastStart = geo.startPx;
    maxEnd = Math.max(maxEnd, geo.endPx);
    prefixMaxEndPositions.push(maxEnd);
  }

  return { isSortedByStart, prefixMaxEndPositions, startPositions };
}

/**
 * Return the items of a track that intersect the `[visibleStartPx, visibleEndPx]`
 * range. Uses the binary-search window when the index is sorted, otherwise a
 * linear filter. Items without geometry are always kept (defensive).
 */
export function selectVisibleItems(input: {
  items: TimelineTrackItem[];
  geometries: Map<string, ItemGeometry>;
  index: TrackVisibilityIndexEntry | undefined;
  visibleStartPx: number;
  visibleEndPx: number;
}): TimelineTrackItem[] {
  const { items, geometries, index, visibleStartPx, visibleEndPx } = input;

  if (visibleEndPx === Infinity) return items;

  const intersects = (item: TimelineTrackItem): boolean => {
    const geo = geometries.get(item.id);
    if (!geo) return true;
    return geo.endPx >= visibleStartPx && geo.startPx <= visibleEndPx;
  };

  if (index?.isSortedByStart) {
    const startIndex = lowerBound(index.prefixMaxEndPositions, visibleStartPx);
    const endIndex = upperBound(index.startPositions, visibleEndPx);
    if (startIndex >= endIndex) return [];
    return items.slice(startIndex, endIndex).filter(intersects);
  }

  return items.filter(intersects);
}
