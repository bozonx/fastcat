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

export function deltaUsToFrames(deltaTicks: number, fps: number, mode: QuantizeMode): number {
  const safeDeltaTicks = Number.isFinite(deltaTicks) ? Math.round(deltaTicks) : 0;
  return ticksToFrames({ ticks: safeDeltaTicks, frameRate: sanitizeFrameRate(fps), mode });
}

export function frameToTicks(frameIndex: number, fps: number): number {
  const safeFrameIndex = Number.isFinite(frameIndex) ? Math.max(0, Math.round(frameIndex)) : 0;
  return Math.max(0, framesToTicks({ frames: safeFrameIndex, frameRate: sanitizeFrameRate(fps) }));
}

export function quantizeTimeUsToFrames(timeTicks: number, fps: number, mode: QuantizeMode): number {
  return Math.max(
    0,
    quantizeTicksToFrame({
      ticks: Number.isFinite(timeTicks) ? Math.max(0, Math.round(timeTicks)) : 0,
      frameRate: sanitizeFrameRate(fps),
      mode,
    }),
  );
}

export function quantizeDeltaUsToFrames(deltaTicks: number, fps: number, mode: QuantizeMode): number {
  return quantizeTicksToFrame({
    ticks: Number.isFinite(deltaTicks) ? Math.round(deltaTicks) : 0,
    frameRate: sanitizeFrameRate(fps),
    mode,
  });
}

export function quantizeRangeToFrames(
  range: { startTicks: number; durationTicks: number },
  fps: number,
): { startTicks: number; durationTicks: number } {
  const startFrame = ticksToFrame(range.startTicks, fps, 'round');
  const startTicks = frameToTicks(startFrame, fps);

  const rawEndTicks = Math.max(0, Math.round(range.startTicks) + Math.round(range.durationTicks));
  const endFrame = ticksToFrame(rawEndTicks, fps, 'round');
  const endTicks = frameToTicks(Math.max(startFrame, endFrame), fps);

  return { startTicks, durationTicks: Math.max(0, endTicks - startTicks) };
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
export const OVERLAP_EPSILON_TICKS = 0;

export function assertNoOverlap(
  track: TimelineTrack,
  movedItemId: string,
  startTicks: number,
  durationTicks: number,
) {
  const endTicks = startTicks + durationTicks;

  for (const it of track.items) {
    if (it.id === movedItemId) continue;
    if (it.kind !== 'clip') continue;
    const itStart = it.timelineRange.startTicks;
    const itEnd = itStart + it.timelineRange.durationTicks;
    if (
      rangesOverlap(startTicks, endTicks, itStart, itEnd) &&
      Math.min(endTicks, itEnd) - Math.max(startTicks, itStart) > OVERLAP_EPSILON_TICKS
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
          durationTicks:
            next.timelineRange.startTicks +
            next.timelineRange.durationTicks -
            current.timelineRange.startTicks,
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
  segmentStartTicks: number,
  segmentDurationTicks: number,
): { startTicks: number; durationTicks: number } {
  const clipStartTicks = Math.max(0, Math.round(clip.timelineRange.startTicks));
  const clipDurationTicks = Math.max(0, Math.round(clip.timelineRange.durationTicks));
  const clipEndTicks = clipStartTicks + clipDurationTicks;
  const segmentStart = Math.max(clipStartTicks, Math.round(segmentStartTicks));
  const segmentEnd = Math.min(clipEndTicks, segmentStart + Math.max(0, Math.round(segmentDurationTicks)));
  const safeSegmentDurationTicks = Math.max(0, segmentEnd - segmentStart);

  const speed = typeof clip.speed === 'number' && Number.isFinite(clip.speed) ? clip.speed : 1;
  const absSpeed = Math.abs(speed) || 1;
  const sourceStartTicks = Math.round(clip.sourceRange.startTicks);
  const sourceDurationTicks = Math.max(0, Math.round(clip.sourceRange.durationTicks));
  const sourceEndTicks = sourceStartTicks + sourceDurationTicks;
  const localStartTicks = Math.max(0, Math.round((segmentStart - clipStartTicks) * absSpeed));
  const localDurationTicks = Math.max(0, Math.round(safeSegmentDurationTicks * absSpeed));

  if (speed >= 0) {
    const nextStartTicks = Math.min(sourceEndTicks, sourceStartTicks + localStartTicks);
    return {
      startTicks: nextStartTicks,
      durationTicks: Math.max(0, Math.min(localDurationTicks, sourceEndTicks - nextStartTicks)),
    };
  }

  const nextEndTicks = Math.max(sourceStartTicks, sourceEndTicks - localStartTicks);
  const nextStartTicks = Math.max(sourceStartTicks, nextEndTicks - localDurationTicks);
  return {
    startTicks: nextStartTicks,
    durationTicks: Math.max(0, nextEndTicks - nextStartTicks),
  };
}

export function sliceTrackItemsForOverlay(
  items: TimelineTrackItem[],
  startTicks: number,
  durationTicks: number,
  fps: number,
  shouldQuantizeToFrames: boolean,
  excludeItemId?: string,
): TimelineTrackItem[] {
  const endTicks = startTicks + durationTicks;
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
      const itStartLocked = it.timelineRange.startTicks;
      const itEndLocked = itStartLocked + it.timelineRange.durationTicks;
      const overlapsLocked = itEndLocked > startTicks && itStartLocked < endTicks;
      if (overlapsLocked) {
        throw new Error('Locked clip');
      }
      nextItems.push(it);
      continue;
    }

    const itStart = it.timelineRange.startTicks;
    const itEnd = itStart + it.timelineRange.durationTicks;

    if (itEnd <= startTicks || itStart >= endTicks) {
      nextItems.push(it);
      continue;
    }

    // Fully covered: delete
    if (itStart >= startTicks && itEnd <= endTicks) {
      continue;
    }

    // Overlaps only on the left side: trim end of existing clip
    if (itStart < startTicks && itEnd > startTicks && itEnd <= endTicks) {
      const newDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(startTicks - itStart, fps, 'floor')
        : Math.max(0, Math.round(startTicks - itStart));
      if (newDuration > 0) {
        nextItems.push({
          ...it,
          timelineRange: { startTicks: itStart, durationTicks: newDuration },
          sourceRange: getClipSourceRangeForTimelineSegment(it, itStart, newDuration),
        });
      }
      continue;
    }

    // Overlaps only on the right side: trim start of existing clip
    if (itStart >= startTicks && itStart < endTicks && itEnd > endTicks) {
      const newStart = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(endTicks, fps, 'ceil')
        : Math.max(0, Math.round(endTicks));
      const newDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(itEnd - endTicks, fps, 'floor')
        : Math.max(0, Math.round(itEnd - endTicks));
      if (newDuration > 0) {
        nextItems.push({
          ...it,
          timelineRange: { startTicks: newStart, durationTicks: newDuration },
          sourceRange: getClipSourceRangeForTimelineSegment(it, newStart, newDuration),
        });
      }
      continue;
    }

    // Existing clip fully contains the new item: split into two
    if (itStart < startTicks && itEnd > endTicks) {
      const leftDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(startTicks - itStart, fps, 'floor')
        : Math.max(0, Math.round(startTicks - itStart));
      if (leftDuration > 0) {
        nextItems.push({
          ...it,
          timelineRange: { startTicks: itStart, durationTicks: leftDuration },
          sourceRange: getClipSourceRangeForTimelineSegment(it, itStart, leftDuration),
        });
      }
      const rightStart = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(endTicks, fps, 'ceil')
        : Math.max(0, Math.round(endTicks));
      const rightDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(itEnd - endTicks, fps, 'floor')
        : Math.max(0, Math.round(itEnd - endTicks));
      if (rightDuration > 0) {
        nextItems.push({
          ...it,
          id: nextItemId(it.trackId, 'clip'),
          timelineRange: { startTicks: rightStart, durationTicks: rightDuration },
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
      const prevEnd = prev.timelineRange.startTicks + prev.timelineRange.durationTicks;
      if (prevEnd === current.timelineRange.startTicks) {
        isAdjacentLeft = true;
      }
    }

    let isAdjacentRight = false;
    if (next) {
      const currentEnd = current.timelineRange.startTicks + current.timelineRange.durationTicks;
      if (currentEnd === next.timelineRange.startTicks) {
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

  clips.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
  applyTransitionAdjacencyModes(clips);

  const result: TimelineTrackItem[] = [];
  let cursorTicks = 0;

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
    const startTicks = qTimeline
      ? qTimeline.startTicks
      : Math.max(0, Math.round(clip.timelineRange.startTicks));
    const durationTicks = qTimeline
      ? qTimeline.durationTicks
      : Math.max(0, Math.round(clip.timelineRange.durationTicks));
    const endTicks = startTicks + durationTicks;

    if (startTicks > cursorTicks) {
      const gapStartTicks = cursorTicks;
      const gapDurationTicks = startTicks - cursorTicks;
      const gap: TimelineGapItem = {
        kind: 'gap',
        id: `gap_${trackId}_${gapStartTicks}`,
        trackId,
        timelineRange: { startTicks: gapStartTicks, durationTicks: gapDurationTicks },
      };
      result.push(gap);
    }

    result.push({
      ...clip,
      timelineRange: { startTicks, durationTicks },
    });
    cursorTicks = Math.max(cursorTicks, endTicks);
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

export function computeTrackEndTicks(track: TimelineTrack): number {
  let end = 0;
  for (const it of track.items) {
    end = Math.max(end, it.timelineRange.startTicks + it.timelineRange.durationTicks);
  }
  return end;
}

export { clampInt } from '~/utils/math';

/**
 * Minimum clip duration below which transitions are removed entirely.
 * Used consistently across move/trim/split commands.
 */
export const TRANSITION_MIN_CLIP_DURATION_TICKS = TICKS_PER_SECOND / 10;

/** Transition adjacency is exact in the canonical tick base. */
export const TRANSITION_ADJACENCY_THRESHOLD_TICKS = 0;

function normalizeOpposingEdgeDurations(input: {
  clipDurationTicks: number;
  startDurationTicks?: number;
  endDurationTicks?: number;
}): { startDurationTicks: number; endDurationTicks: number } {
  const clipDurationTicks = Math.max(0, Math.round(input.clipDurationTicks));
  let startDurationTicks = Math.max(0, Math.round(input.startDurationTicks ?? 0));
  let endDurationTicks = Math.max(0, Math.round(input.endDurationTicks ?? 0));

  startDurationTicks = Math.min(startDurationTicks, clipDurationTicks);
  endDurationTicks = Math.min(endDurationTicks, clipDurationTicks);

  const totalDurationTicks = startDurationTicks + endDurationTicks;
  if (totalDurationTicks <= clipDurationTicks || totalDurationTicks <= 0) {
    return { startDurationTicks, endDurationTicks };
  }

  const ratio = clipDurationTicks / totalDurationTicks;
  const nextStartDurationTicks = Math.max(
    0,
    Math.min(clipDurationTicks, Math.round(startDurationTicks * ratio)),
  );
  const nextEndDurationTicks = Math.max(0, clipDurationTicks - nextStartDurationTicks);

  return {
    startDurationTicks: nextStartDurationTicks,
    endDurationTicks: nextEndDurationTicks,
  };
}

export function autoAdaptClipEdgeDurations(items: TimelineTrackItem[]): TimelineTrackItem[] {
  return items.map((it, idx, arr) => {
    if (it.kind !== 'clip') return it;

    const clipDurationTicks = Math.max(0, Math.round(it.timelineRange.durationTicks));
    const prev = idx > 0 ? arr[idx - 1] : null;
    const next = idx < arr.length - 1 ? arr[idx + 1] : null;

    let transitionIn = it.transitionIn;
    let transitionOut = it.transitionOut;

    if (clipDurationTicks < TRANSITION_MIN_CLIP_DURATION_TICKS) {
      transitionIn = undefined;
      transitionOut = undefined;
    } else {
      const normalizedTransitions = normalizeOpposingEdgeDurations({
        clipDurationTicks,
        startDurationTicks: transitionIn?.durationTicks,
        endDurationTicks: transitionOut?.durationTicks,
      });

      if (transitionIn && transitionIn.durationTicks !== normalizedTransitions.startDurationTicks) {
        transitionIn = {
          ...transitionIn,
          durationTicks: normalizedTransitions.startDurationTicks,
        };
      }

      if (transitionOut && transitionOut.durationTicks !== normalizedTransitions.endDurationTicks) {
        transitionOut = {
          ...transitionOut,
          durationTicks: normalizedTransitions.endDurationTicks,
        };
      }
    }

    // Downgrade 'adjacent' mode to 'transparent' when the neighbour gap is too
    // wide — but never override a user-overridden mode (otherwise the override
    // flag becomes meaningless).
    if (transitionIn?.mode === 'adjacent' && !transitionIn.isOverridden) {
      const gap = prev
        ? it.timelineRange.startTicks - (prev.timelineRange.startTicks + prev.timelineRange.durationTicks)
        : Infinity;
      if (!prev || prev.kind !== 'clip' || gap !== TRANSITION_ADJACENCY_THRESHOLD_TICKS) {
        transitionIn = { ...transitionIn, mode: 'transparent' };
      }
    }

    if (transitionOut?.mode === 'adjacent' && !transitionOut.isOverridden) {
      const gap = next
        ? next.timelineRange.startTicks - (it.timelineRange.startTicks + it.timelineRange.durationTicks)
        : Infinity;
      if (!next || next.kind !== 'clip' || gap !== TRANSITION_ADJACENCY_THRESHOLD_TICKS) {
        transitionOut = { ...transitionOut, mode: 'transparent' };
      }
    }

    const normalizedFades = normalizeOpposingEdgeDurations({
      clipDurationTicks,
      startDurationTicks: (it as TimelineClipItem).audioFadeInTicks,
      endDurationTicks: (it as TimelineClipItem).audioFadeOutTicks,
    });

    const audioFadeInTicks = normalizedFades.startDurationTicks;
    const audioFadeOutTicks = normalizedFades.endDurationTicks;
    const hadAudioFadeInTicks = typeof (it as TimelineClipItem).audioFadeInTicks === 'number';
    const hadAudioFadeOutTicks = typeof (it as TimelineClipItem).audioFadeOutTicks === 'number';

    if (
      transitionIn !== it.transitionIn ||
      transitionOut !== it.transitionOut ||
      (hadAudioFadeInTicks && audioFadeInTicks !== (it as TimelineClipItem).audioFadeInTicks) ||
      (hadAudioFadeOutTicks && audioFadeOutTicks !== (it as TimelineClipItem).audioFadeOutTicks)
    ) {
      return {
        ...it,
        transitionIn,
        transitionOut,
        ...(hadAudioFadeInTicks ? { audioFadeInTicks } : {}),
        ...(hadAudioFadeOutTicks ? { audioFadeOutTicks } : {}),
      };
    }

    return it;
  });
}

/**
 * After a geometry change (move/trim) auto-adjusts clip transitions in a track:
 * - Shrinks transition duration if it exceeds the clip duration.
 * - Removes transition entirely if clip is shorter than TRANSITION_MIN_CLIP_DURATION_TICKS.
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
 * Resolve a non-overlapping insertion start (ticks) on a track.
 *
 * The candidate start/duration are quantized to the track's frame grid — the
 * same grid `addClipToTrack` uses — so the collision search runs in the final
 * coordinate space and cannot leave the inserted clip overlapping a neighbour
 * due to post-quantization rounding. When the candidate would overlap an
 * existing clip, the start is pushed to that clip's (frame-ceiled) end.
 *
 * Shared by add-media and drop-handling so both stay in lockstep.
 */
export function resolveNonOverlappingStartTicks(
  track: { items: ReadonlyArray<TimelineTrackItem> },
  startTicks: number,
  durationTicks: number,
  fps: number,
): number {
  let nextStartTicks = quantizeTimeUsToFrames(Math.max(0, startTicks), fps, 'round');
  const dur = quantizeTimeUsToFrames(Math.max(0, durationTicks), fps, 'round');

  for (const item of track.items) {
    if (item.kind !== 'clip') continue;

    const itemStartTicks = item.timelineRange.startTicks;
    const itemEndTicks = itemStartTicks + item.timelineRange.durationTicks;
    const nextEndTicks = nextStartTicks + dur;

    if (nextEndTicks <= itemStartTicks || nextStartTicks >= itemEndTicks) {
      continue;
    }

    nextStartTicks = quantizeTimeUsToFrames(itemEndTicks, fps, 'ceil');
  }

  return nextStartTicks;
}
