import type {
  TimelineClipItem,
  TimelineDocument,
  TimelineGapItem,
  TimelineTrack,
  TimelineTrackItem,
} from '../types';
import { genUuid, genPrefixedIdBatch } from '~/utils/ids';
import { sanitizeFps } from '~/utils/time';
import { getTimelineFps } from '~/timeline/timebase';
import {
  framesToTicks,
  quantizeTicksToFrame,
  TICKS_PER_SECOND,
  sanitizeFrameRate,
  ticksToFrames,
  type QuantizeMode,
} from '~/utils/time/ticks';
import { isClipFrameAligned } from '~/utils/timeline/clip-capabilities';

export { sanitizeFps };
export type { QuantizeMode };

/**
 * Throws if the given item is a locked clip — single source of truth for the
 * lock check used across every mutating command. Gaps are exempt because they
 * are synthesised by normalizeGaps and never bear a user-facing lock.
 */
export function assertClipNotLocked(item: TimelineTrackItem, action: string) {
  if (item.kind !== 'clip') return;
  if (!item.locked) return;
  throw new Error(`Locked clip: ${action}`);
}

export function getDocFps(doc: TimelineDocument): number {
  return getTimelineFps(doc.timebase);
}

/** Frame rate of the doc, or a safe fallback when no document is loaded. */
export function getDocFpsOrDefault(
  doc: TimelineDocument | null | undefined,
  fallback = 30,
): number {
  return doc ? getDocFps(doc) : fallback;
}

export function ticksToFrame(timeTicks: number, fps: number, mode: QuantizeMode): number {
  const safeTimeTicks = Number.isFinite(timeTicks) ? Math.max(0, Math.round(timeTicks)) : 0;
  return Math.max(
    0,
    ticksToFrames({ ticks: safeTimeTicks, frameRate: sanitizeFrameRate(fps), mode }),
  );
}

export function deltaUsToFrames(deltaUs: number, fps: number, mode: QuantizeMode): number {
  const safeDeltaUs = Number.isFinite(deltaUs) ? Math.round(deltaUs) : 0;
  return ticksToFrames({ ticks: safeDeltaUs, frameRate: sanitizeFrameRate(fps), mode });
}

export function frameToUs(frameIndex: number, fps: number): number {
  const safeFrameIndex = Number.isFinite(frameIndex) ? Math.max(0, Math.round(frameIndex)) : 0;
  return Math.max(0, framesToTicks({ frames: safeFrameIndex, frameRate: sanitizeFrameRate(fps) }));
}

export function quantizeTimeUsToFrames(timeUs: number, fps: number, mode: QuantizeMode): number {
  return Math.max(
    0,
    quantizeTicksToFrame({
      ticks: Number.isFinite(timeUs) ? Math.max(0, Math.round(timeUs)) : 0,
      frameRate: sanitizeFrameRate(fps),
      mode,
    }),
  );
}

export function quantizeDeltaUsToFrames(deltaUs: number, fps: number, mode: QuantizeMode): number {
  return quantizeTicksToFrame({
    ticks: Number.isFinite(deltaUs) ? Math.round(deltaUs) : 0,
    frameRate: sanitizeFrameRate(fps),
    mode,
  });
}

export function quantizeRangeToFrames(
  range: { startUs: number; durationUs: number },
  fps: number,
): { startUs: number; durationUs: number } {
  const startFrame = ticksToFrame(range.startUs, fps, 'round');
  const startUs = frameToUs(startFrame, fps);

  const rawEndUs = Math.max(0, Math.round(range.startUs) + Math.round(range.durationUs));
  const endFrame = ticksToFrame(rawEndUs, fps, 'round');
  const endUs = frameToUs(Math.max(startFrame, endFrame), fps);

  return { startUs, durationUs: Math.max(0, endUs - startUs) };
}

export function findClipById(
  doc: TimelineDocument,
  itemId: string,
): { track: TimelineTrack; item: TimelineClipItem } | null {
  for (const t of doc.tracks) {
    const it = t.items.find((x) => x.id === itemId);
    if (it && it.kind === 'clip') {
      return { track: t, item: it };
    }
  }
  return null;
}

// WeakMap to cache linked clip group IDs per TimelineDocument instance
const groupCache = new WeakMap<TimelineDocument, Map<string, string[]>>();

export function getLinkedClipGroupItemIds(doc: TimelineDocument, itemId: string): string[] {
  let docCache = groupCache.get(doc);
  if (!docCache) {
    docCache = new Map<string, string[]>();
    groupCache.set(doc, docCache);
  }

  const cached = docCache.get(itemId);
  if (cached) {
    return cached;
  }

  // First miss for this doc: build a full group index in a single pass
  // and populate the cache for every clip so subsequent lookups are O(1).
  const groupIndex = new Map<string, string[]>();
  for (const track of doc.tracks) {
    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      const gid = String(item.linkedGroupId ?? '').trim();
      if (gid) {
        const arr = groupIndex.get(gid) ?? [];
        arr.push(item.id);
        groupIndex.set(gid, arr);
      }
      if (!docCache.has(item.id)) {
        docCache.set(item.id, [item.id]);
      }
    }
  }

  for (const ids of groupIndex.values()) {
    for (const id of ids) {
      docCache.set(id, ids);
    }
  }

  const result = docCache.get(itemId);
  if (result) return result;
  return [itemId];
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Exact tick boundaries make any positive overlap a real overlap. */
export const OVERLAP_EPSILON_US = 0;

export function assertNoOverlap(
  track: TimelineTrack,
  movedItemId: string,
  startUs: number,
  durationUs: number,
) {
  const endUs = startUs + durationUs;

  for (const it of track.items) {
    if (it.id === movedItemId) continue;
    if (it.kind !== 'clip') continue;
    const itStart = it.timelineRange.startUs;
    const itEnd = itStart + it.timelineRange.durationUs;
    if (
      rangesOverlap(startUs, endUs, itStart, itEnd) &&
      Math.min(endUs, itEnd) - Math.max(startUs, itStart) > OVERLAP_EPSILON_US
    ) {
      throw new Error('Item overlaps with another item');
    }
  }
}

export function mergeAdjacentGaps(items: TimelineTrackItem[]): TimelineTrackItem[] {
  if (items.length < 2) return items;
  const result: TimelineTrackItem[] = [];
  let current: TimelineTrackItem | undefined = items[0];

  for (let i = 1; i < items.length; i++) {
    const next = items[i];
    if (current && next && current.kind === 'gap' && next.kind === 'gap') {
      current = {
        ...current,
        timelineRange: {
          ...current.timelineRange,
          durationUs:
            next.timelineRange.startUs +
            next.timelineRange.durationUs -
            current.timelineRange.startUs,
        },
      };
    } else {
      if (current) result.push(current);
      current = next;
    }
  }
  if (current) result.push(current);
  return result;
}

export function getClipSourceRangeForTimelineSegment(
  clip: TimelineClipItem,
  segmentStartUs: number,
  segmentDurationUs: number,
): { startUs: number; durationUs: number } {
  const clipStartUs = Math.max(0, Math.round(clip.timelineRange.startUs));
  const clipDurationUs = Math.max(0, Math.round(clip.timelineRange.durationUs));
  const clipEndUs = clipStartUs + clipDurationUs;
  const segmentStart = Math.max(clipStartUs, Math.round(segmentStartUs));
  const segmentEnd = Math.min(clipEndUs, segmentStart + Math.max(0, Math.round(segmentDurationUs)));
  const safeSegmentDurationUs = Math.max(0, segmentEnd - segmentStart);

  const speed = typeof clip.speed === 'number' && Number.isFinite(clip.speed) ? clip.speed : 1;
  const absSpeed = Math.abs(speed) || 1;
  const sourceStartUs = Math.round(clip.sourceRange.startUs);
  const sourceDurationUs = Math.max(0, Math.round(clip.sourceRange.durationUs));
  const sourceEndUs = sourceStartUs + sourceDurationUs;
  const localStartUs = Math.max(0, Math.round((segmentStart - clipStartUs) * absSpeed));
  const localDurationUs = Math.max(0, Math.round(safeSegmentDurationUs * absSpeed));

  if (speed >= 0) {
    const nextStartUs = Math.min(sourceEndUs, sourceStartUs + localStartUs);
    return {
      startUs: nextStartUs,
      durationUs: Math.max(0, Math.min(localDurationUs, sourceEndUs - nextStartUs)),
    };
  }

  const nextEndUs = Math.max(sourceStartUs, sourceEndUs - localStartUs);
  const nextStartUs = Math.max(sourceStartUs, nextEndUs - localDurationUs);
  return {
    startUs: nextStartUs,
    durationUs: Math.max(0, nextEndUs - nextStartUs),
  };
}

export function sliceTrackItemsForOverlay(
  items: TimelineTrackItem[],
  startUs: number,
  durationUs: number,
  fps: number,
  shouldQuantizeToFrames: boolean,
  excludeItemId?: string,
): TimelineTrackItem[] {
  const endUs = startUs + durationUs;
  const nextItems: TimelineTrackItem[] = [];

  for (const it of items) {
    if (it.kind !== 'clip') {
      nextItems.push(it);
      continue;
    }
    if (excludeItemId && it.id === excludeItemId) {
      continue;
    }

    if (it.locked) {
      const itStartLocked = it.timelineRange.startUs;
      const itEndLocked = itStartLocked + it.timelineRange.durationUs;
      const overlapsLocked = itEndLocked > startUs && itStartLocked < endUs;
      if (overlapsLocked) {
        throw new Error('Locked clip');
      }
      nextItems.push(it);
      continue;
    }

    const itStart = it.timelineRange.startUs;
    const itEnd = itStart + it.timelineRange.durationUs;

    if (itEnd <= startUs || itStart >= endUs) {
      nextItems.push(it);
      continue;
    }

    // Fully covered: delete
    if (itStart >= startUs && itEnd <= endUs) {
      continue;
    }

    // Overlaps only on the left side: trim end of existing clip
    if (itStart < startUs && itEnd > startUs && itEnd <= endUs) {
      const newDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(startUs - itStart, fps, 'floor')
        : Math.max(0, Math.round(startUs - itStart));
      if (newDuration > 0) {
        nextItems.push({
          ...it,
          timelineRange: { startUs: itStart, durationUs: newDuration },
          sourceRange: getClipSourceRangeForTimelineSegment(it, itStart, newDuration),
        });
      }
      continue;
    }

    // Overlaps only on the right side: trim start of existing clip
    if (itStart >= startUs && itStart < endUs && itEnd > endUs) {
      const newStart = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(endUs, fps, 'ceil')
        : Math.max(0, Math.round(endUs));
      const newDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(itEnd - endUs, fps, 'floor')
        : Math.max(0, Math.round(itEnd - endUs));
      if (newDuration > 0) {
        nextItems.push({
          ...it,
          timelineRange: { startUs: newStart, durationUs: newDuration },
          sourceRange: getClipSourceRangeForTimelineSegment(it, newStart, newDuration),
        });
      }
      continue;
    }

    // Existing clip fully contains the new item: split into two
    if (itStart < startUs && itEnd > endUs) {
      const leftDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(startUs - itStart, fps, 'floor')
        : Math.max(0, Math.round(startUs - itStart));
      if (leftDuration > 0) {
        nextItems.push({
          ...it,
          timelineRange: { startUs: itStart, durationUs: leftDuration },
          sourceRange: getClipSourceRangeForTimelineSegment(it, itStart, leftDuration),
        });
      }
      const rightStart = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(endUs, fps, 'ceil')
        : Math.max(0, Math.round(endUs));
      const rightDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(itEnd - endUs, fps, 'floor')
        : Math.max(0, Math.round(itEnd - endUs));
      if (rightDuration > 0) {
        nextItems.push({
          ...it,
          id: nextItemId(it.trackId, 'clip'),
          timelineRange: { startUs: rightStart, durationUs: rightDuration },
          sourceRange: getClipSourceRangeForTimelineSegment(it, rightStart, rightDuration),
        });
      }
      continue;
    }

    nextItems.push(it);
  }

  return nextItems;
}

/**
 * Updates transitionIn/transitionOut modes on a sorted clip array based on
 * adjacency to neighbours. Non-overridden transitions become 'adjacent' when
 * touching a neighbour and 'transparent' otherwise.
 *
 * Mutates the input array's clip objects (they are already shallow copies).
 */
function applyTransitionAdjacencyModes(clips: TimelineClipItem[]) {
  for (let i = 0; i < clips.length; i++) {
    const current = clips[i];
    if (!current) continue;
    const prev = i > 0 ? clips[i - 1] : null;
    const next = i < clips.length - 1 ? clips[i + 1] : null;

    let isAdjacentLeft = false;
    if (prev) {
      const prevEnd = prev.timelineRange.startUs + prev.timelineRange.durationUs;
      if (prevEnd === current.timelineRange.startUs) {
        isAdjacentLeft = true;
      }
    }

    let isAdjacentRight = false;
    if (next) {
      const currentEnd = current.timelineRange.startUs + current.timelineRange.durationUs;
      if (currentEnd === next.timelineRange.startUs) {
        isAdjacentRight = true;
      }
    }

    if (current.transitionIn && !current.transitionIn.isOverridden) {
      const nextMode = isAdjacentLeft ? 'adjacent' : 'transparent';
      if (current.transitionIn.mode !== nextMode) {
        current.transitionIn = { ...current.transitionIn, mode: nextMode };
      }
    }

    if (current.transitionOut && !current.transitionOut.isOverridden) {
      const nextMode = isAdjacentRight ? 'adjacent' : 'transparent';
      if (current.transitionOut.mode !== nextMode) {
        current.transitionOut = { ...current.transitionOut, mode: nextMode };
      }
    }
  }
}

export function normalizeGaps(
  doc: TimelineDocument,
  trackId: string,
  items: TimelineTrackItem[],
  options?: { quantizeToFrames?: boolean },
): TimelineTrackItem[] {
  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = options?.quantizeToFrames !== false;
  const clips = items
    .filter((it): it is TimelineClipItem => it.kind === 'clip')
    .map((it) => ({ ...it, timelineRange: { ...it.timelineRange } }));

  clips.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  applyTransitionAdjacencyModes(clips);

  const result: TimelineTrackItem[] = [];
  let cursorUs = 0;

  for (const clip of clips) {
    // A free (sub-frame) audio clip must keep its phase even during a quantized
    // operation on the same track — snapping it here would re-grid a hand-dialed
    // sync. Only clips that are already frame-aligned are quantized (a no-op that
    // just scrubs float noise); genuinely off-grid clips are left untouched. Only
    // audio can be off-grid, so video/virtual clips are always quantized.
    const qTimeline =
      shouldQuantizeToFrames && isClipFrameAligned(clip, fps)
        ? quantizeRangeToFrames(clip.timelineRange, fps)
        : null;
    const startUs = qTimeline
      ? qTimeline.startUs
      : Math.max(0, Math.round(clip.timelineRange.startUs));
    const durationUs = qTimeline
      ? qTimeline.durationUs
      : Math.max(0, Math.round(clip.timelineRange.durationUs));
    const endUs = startUs + durationUs;

    if (startUs > cursorUs) {
      const gapStartUs = cursorUs;
      const gapDurationUs = startUs - cursorUs;
      const gap: TimelineGapItem = {
        kind: 'gap',
        id: `gap_${trackId}_${gapStartUs}`,
        trackId,
        timelineRange: { startUs: gapStartUs, durationUs: gapDurationUs },
      };
      result.push(gap);
    }

    result.push({
      ...clip,
      timelineRange: { startUs, durationUs },
    });
    cursorUs = Math.max(cursorUs, endUs);
  }

  return mergeAdjacentGaps(result);
}

export function getTrackById(doc: TimelineDocument, trackId: string): TimelineTrack {
  const t = doc.tracks.find((x) => x.id === trackId);
  if (!t) throw new Error('Track not found');
  return t;
}

export function nextTrackId(doc: TimelineDocument, prefix: 'v' | 'a'): string {
  const ids = new Set(doc.tracks.map((t) => t.id));
  let n = 1;
  while (n < 10_000) {
    const id = `${prefix}${n}`;
    if (!ids.has(id)) return id;
    n += 1;
  }
  return `${prefix}${Date.now().toString(36)}`;
}

export function normalizeTrackOrder(doc: TimelineDocument, trackIds: string[]): TimelineTrack[] {
  const byId = new Map(doc.tracks.map((t) => [t.id, t] as const));
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of trackIds) {
    if (!byId.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  for (const t of doc.tracks) {
    if (!seen.has(t.id)) {
      unique.push(t.id);
    }
  }

  const ordered = unique.map((id) => byId.get(id)!).filter(Boolean);
  const video = ordered.filter((t) => t.kind === 'video');
  const audio = ordered.filter((t) => t.kind === 'audio');
  return [...video, ...audio];
}

export function nextItemId(trackId: string, prefix: string): string {
  return `${prefix}_${trackId}_${genUuid()}`;
}

export function nextItemIds(trackId: string, prefix: string, count: number): string[] {
  return genPrefixedIdBatch(`${prefix}_${trackId}_`, count);
}

export function computeTrackEndUs(track: TimelineTrack): number {
  let end = 0;
  for (const it of track.items) {
    end = Math.max(end, it.timelineRange.startUs + it.timelineRange.durationUs);
  }
  return end;
}

export { clampInt } from '~/utils/math';

/**
 * Minimum clip duration below which transitions are removed entirely.
 * Used consistently across move/trim/split commands.
 */
export const TRANSITION_MIN_CLIP_DURATION_US = TICKS_PER_SECOND / 10;

/** Transition adjacency is exact in the canonical tick base. */
export const TRANSITION_ADJACENCY_THRESHOLD_US = 0;

function normalizeOpposingEdgeDurations(input: {
  clipDurationUs: number;
  startDurationUs?: number;
  endDurationUs?: number;
}): { startDurationUs: number; endDurationUs: number } {
  const clipDurationUs = Math.max(0, Math.round(input.clipDurationUs));
  let startDurationUs = Math.max(0, Math.round(input.startDurationUs ?? 0));
  let endDurationUs = Math.max(0, Math.round(input.endDurationUs ?? 0));

  startDurationUs = Math.min(startDurationUs, clipDurationUs);
  endDurationUs = Math.min(endDurationUs, clipDurationUs);

  const totalDurationUs = startDurationUs + endDurationUs;
  if (totalDurationUs <= clipDurationUs || totalDurationUs <= 0) {
    return { startDurationUs, endDurationUs };
  }

  const ratio = clipDurationUs / totalDurationUs;
  const nextStartDurationUs = Math.max(
    0,
    Math.min(clipDurationUs, Math.round(startDurationUs * ratio)),
  );
  const nextEndDurationUs = Math.max(0, clipDurationUs - nextStartDurationUs);

  return {
    startDurationUs: nextStartDurationUs,
    endDurationUs: nextEndDurationUs,
  };
}

export function autoAdaptClipEdgeDurations(items: TimelineTrackItem[]): TimelineTrackItem[] {
  return items.map((it, idx, arr) => {
    if (it.kind !== 'clip') return it;

    const clipDurationUs = Math.max(0, Math.round(it.timelineRange.durationUs));
    const prev = idx > 0 ? arr[idx - 1] : null;
    const next = idx < arr.length - 1 ? arr[idx + 1] : null;

    let transitionIn = it.transitionIn;
    let transitionOut = it.transitionOut;

    if (clipDurationUs < TRANSITION_MIN_CLIP_DURATION_US) {
      transitionIn = undefined;
      transitionOut = undefined;
    } else {
      const normalizedTransitions = normalizeOpposingEdgeDurations({
        clipDurationUs,
        startDurationUs: transitionIn?.durationUs,
        endDurationUs: transitionOut?.durationUs,
      });

      if (transitionIn && transitionIn.durationUs !== normalizedTransitions.startDurationUs) {
        transitionIn = {
          ...transitionIn,
          durationUs: normalizedTransitions.startDurationUs,
        };
      }

      if (transitionOut && transitionOut.durationUs !== normalizedTransitions.endDurationUs) {
        transitionOut = {
          ...transitionOut,
          durationUs: normalizedTransitions.endDurationUs,
        };
      }
    }

    // Downgrade 'adjacent' mode to 'transparent' when the neighbour gap is too
    // wide — but never override a user-overridden mode (otherwise the override
    // flag becomes meaningless).
    if (transitionIn?.mode === 'adjacent' && !transitionIn.isOverridden) {
      const gap = prev
        ? it.timelineRange.startUs - (prev.timelineRange.startUs + prev.timelineRange.durationUs)
        : Infinity;
      if (!prev || prev.kind !== 'clip' || gap !== TRANSITION_ADJACENCY_THRESHOLD_US) {
        transitionIn = { ...transitionIn, mode: 'transparent' };
      }
    }

    if (transitionOut?.mode === 'adjacent' && !transitionOut.isOverridden) {
      const gap = next
        ? next.timelineRange.startUs - (it.timelineRange.startUs + it.timelineRange.durationUs)
        : Infinity;
      if (!next || next.kind !== 'clip' || gap !== TRANSITION_ADJACENCY_THRESHOLD_US) {
        transitionOut = { ...transitionOut, mode: 'transparent' };
      }
    }

    const normalizedFades = normalizeOpposingEdgeDurations({
      clipDurationUs,
      startDurationUs: (it as TimelineClipItem).audioFadeInUs,
      endDurationUs: (it as TimelineClipItem).audioFadeOutUs,
    });

    const audioFadeInUs = normalizedFades.startDurationUs;
    const audioFadeOutUs = normalizedFades.endDurationUs;
    const hadAudioFadeInUs = typeof (it as TimelineClipItem).audioFadeInUs === 'number';
    const hadAudioFadeOutUs = typeof (it as TimelineClipItem).audioFadeOutUs === 'number';

    if (
      transitionIn !== it.transitionIn ||
      transitionOut !== it.transitionOut ||
      (hadAudioFadeInUs && audioFadeInUs !== (it as TimelineClipItem).audioFadeInUs) ||
      (hadAudioFadeOutUs && audioFadeOutUs !== (it as TimelineClipItem).audioFadeOutUs)
    ) {
      return {
        ...it,
        transitionIn,
        transitionOut,
        ...(hadAudioFadeInUs ? { audioFadeInUs } : {}),
        ...(hadAudioFadeOutUs ? { audioFadeOutUs } : {}),
      };
    }

    return it;
  });
}

/**
 * After a geometry change (move/trim) auto-adjusts clip transitions in a track:
 * - Shrinks transition duration if it exceeds the clip duration.
 * - Removes transition entirely if clip is shorter than TRANSITION_MIN_CLIP_DURATION_US.
 * - Downgrades 'adjacent' mode to 'transparent' if the neighbor clip is no longer adjacent.
 *
 * Returns a new items array (immutable). Does not modify the input.
 */

/**
 * Applies `autoAdaptClipTransitions` only to tracks whose `items` reference
 * has actually changed between `originalTracks` and `nextTracks`. Untouched
 * tracks are returned as-is, avoiding O(total_items) work per command when
 * only one or two tracks were modified.
 */
export function autoAdaptChangedTracks(
  originalTracks: TimelineTrack[],
  nextTracks: TimelineTrack[],
): TimelineTrack[] {
  const byId = new Map(originalTracks.map((t) => [t.id, t] as const));
  return nextTracks.map((t) => {
    const orig = byId.get(t.id);
    if (orig && orig.items === t.items) return t;
    return { ...t, items: autoAdaptClipEdgeDurations(t.items) };
  });
}

/**
 * Resolve a non-overlapping insertion start (µs) on a track.
 *
 * The candidate start/duration are quantized to the track's frame grid — the
 * same grid `addClipToTrack` uses — so the collision search runs in the final
 * coordinate space and cannot leave the inserted clip overlapping a neighbour
 * due to post-quantization rounding. When the candidate would overlap an
 * existing clip, the start is pushed to that clip's (frame-ceiled) end.
 *
 * Shared by add-media and drop-handling so both stay in lockstep.
 */
export function resolveNonOverlappingStartUs(
  track: { items: ReadonlyArray<TimelineTrackItem> },
  startUs: number,
  durationUs: number,
  fps: number,
): number {
  let nextStartUs = quantizeTimeUsToFrames(Math.max(0, startUs), fps, 'round');
  const dur = quantizeTimeUsToFrames(Math.max(0, durationUs), fps, 'round');

  for (const item of track.items) {
    if (item.kind !== 'clip') continue;

    const itemStartUs = item.timelineRange.startUs;
    const itemEndUs = itemStartUs + item.timelineRange.durationUs;
    const nextEndUs = nextStartUs + dur;

    if (nextEndUs <= itemStartUs || nextStartUs >= itemEndUs) {
      continue;
    }

    nextStartUs = quantizeTimeUsToFrames(itemEndUs, fps, 'ceil');
  }

  return nextStartUs;
}
