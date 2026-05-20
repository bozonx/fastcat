import type {
  TimelineClipItem,
  TimelineDocument,
  TimelineGapItem,
  TimelineTrack,
  TimelineTrackItem,
} from '../types';

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

export const FALLBACK_FPS = 30;
export const MIN_FPS = 1;
export const MAX_FPS = 240;

/**
 * Sanitize fps preserving non-integer rates required for NTSC (29.97, 23.976, 59.94, …).
 * We clamp to a reasonable range and quantize to 3 decimal places to keep the value finite
 * and free of float noise without forcing integer-only fps.
 */
export function sanitizeFps(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return FALLBACK_FPS;
  const clamped = Math.min(MAX_FPS, Math.max(MIN_FPS, parsed));
  return Math.round(clamped * 1000) / 1000;
}

export function getDocFps(doc: TimelineDocument): number {
  return sanitizeFps(doc.timebase.fps);
}

export type QuantizeMode = 'round' | 'floor' | 'ceil';

export function usToFrame(timeUs: number, fps: number, mode: QuantizeMode): number {
  const safeTimeUs = Number.isFinite(timeUs) ? Math.max(0, Math.round(timeUs)) : 0;
  const safeFps = sanitizeFps(fps);
  const framesFloat = (safeTimeUs * safeFps) / 1e6;
  if (mode === 'floor') return Math.max(0, Math.floor(framesFloat));
  if (mode === 'ceil') return Math.max(0, Math.ceil(framesFloat));
  return Math.max(0, Math.round(framesFloat));
}

export function deltaUsToFrames(deltaUs: number, fps: number, mode: QuantizeMode): number {
  const safeDeltaUs = Number.isFinite(deltaUs) ? Math.round(deltaUs) : 0;
  const safeFps = sanitizeFps(fps);
  const framesFloat = (safeDeltaUs * safeFps) / 1e6;
  if (mode === 'floor') return Math.floor(framesFloat);
  if (mode === 'ceil') return Math.ceil(framesFloat);
  return Math.round(framesFloat);
}

export function frameToUs(frameIndex: number, fps: number): number {
  const safeFrameIndex = Number.isFinite(frameIndex) ? Math.max(0, Math.round(frameIndex)) : 0;
  const safeFps = sanitizeFps(fps);
  return Math.max(0, Math.round((safeFrameIndex * 1e6) / safeFps));
}

export function quantizeTimeUsToFrames(timeUs: number, fps: number, mode: QuantizeMode): number {
  return frameToUs(usToFrame(timeUs, fps, mode), fps);
}

export function quantizeDeltaUsToFrames(deltaUs: number, fps: number, mode: QuantizeMode): number {
  const frames = deltaUsToFrames(deltaUs, fps, mode);
  return Math.round((frames * 1e6) / sanitizeFps(fps));
}

export function quantizeRangeToFrames(
  range: { startUs: number; durationUs: number },
  fps: number,
): { startUs: number; durationUs: number } {
  const startFrame = usToFrame(range.startUs, fps, 'round');
  const startUs = frameToUs(startFrame, fps);

  const rawEndUs = Math.max(0, Math.round(range.startUs) + Math.round(range.durationUs));
  const endFrame = usToFrame(rawEndUs, fps, 'round');
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

export function getLinkedClipGroupItemIds(doc: TimelineDocument, itemId: string): string[] {
  const origin = findClipById(doc, itemId);
  if (!origin) return [itemId];

  const result = new Set<string>([origin.item.id]);
  const linkedGroupId = String((origin.item as TimelineClipItem).linkedGroupId ?? '').trim();

  if (linkedGroupId) {
    for (const track of doc.tracks) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;
        if (String((item as TimelineClipItem).linkedGroupId ?? '').trim() !== linkedGroupId)
          continue;
        result.add(item.id);
      }
    }
  }

  const originLinkedVideoId = String(
    (origin.item as TimelineClipItem).linkedVideoClipId ?? '',
  ).trim();
  if (originLinkedVideoId) {
    result.add(originLinkedVideoId);
  }

  for (const track of doc.tracks) {
    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      const linkedVideoId = String((item as TimelineClipItem).linkedVideoClipId ?? '').trim();
      if (!linkedVideoId) continue;
      if (
        linkedVideoId === origin.item.id ||
        (originLinkedVideoId && linkedVideoId === originLinkedVideoId)
      ) {
        result.add(item.id);
      }
    }
  }

  return [...result];
}

export function updateLinkedLockedAudio(
  doc: TimelineDocument,
  videoItemId: string,
  patch: (audio: TimelineClipItem) => TimelineClipItem,
): TimelineTrack[] {
  return doc.tracks.map((t) => {
    if (t.kind !== 'audio') return t;
    let changed = false;
    const nextItems = t.items.map((it) => {
      if (it.kind !== 'clip') return it;
      if (it.linkedVideoClipId !== videoItemId) return it;
      if (!it.lockToLinkedVideo) return it;
      changed = true;
      return patch(it);
    });
    return changed ? { ...t, items: nextItems } : t;
  });
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Tolerance in microseconds for "touching" boundaries. Two clips whose ends differ by no more than
 * this amount are considered adjacent (not overlapping). Prevents spurious overlap errors from
 * sub-microsecond quantization drift on non-integer FPS or repeated round-trips.
 */
export const OVERLAP_EPSILON_US = 1;

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
    // Allow a tiny epsilon of overlap caused by quantization rounding.
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

  // Auto-adjust transitions based on adjacency before generating gaps. Always
  // produce *new* transition objects when changing mode so we don't mutate the
  // shared ref held by undo snapshots.
  for (let i = 0; i < clips.length; i++) {
    const current = clips[i];
    if (!current) continue;
    const prev = i > 0 ? clips[i - 1] : null;
    const next = i < clips.length - 1 ? clips[i + 1] : null;

    let isAdjacentLeft = false;
    if (prev) {
      const prevEnd = prev.timelineRange.startUs + prev.timelineRange.durationUs;
      if (Math.abs(prevEnd - current.timelineRange.startUs) <= TRANSITION_ADJACENCY_THRESHOLD_US) {
        isAdjacentLeft = true;
      }
    }

    let isAdjacentRight = false;
    if (next) {
      const currentEnd = current.timelineRange.startUs + current.timelineRange.durationUs;
      if (Math.abs(currentEnd - next.timelineRange.startUs) <= TRANSITION_ADJACENCY_THRESHOLD_US) {
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

  const result: TimelineTrackItem[] = [];
  let cursorUs = 0;

  for (const clip of clips) {
    const qTimeline = shouldQuantizeToFrames
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
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${prefix}_${trackId}_${cryptoObj.randomUUID()}`;
  }
  // Fallback for environments without crypto.randomUUID. 10 random base36 chars
  // (≈52 bits) avoids the burst-collisions the previous 3-char suffix allowed.
  const r1 = Math.random().toString(36).substring(2, 12);
  const r2 = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${trackId}_${Date.now().toString(36)}_${r1}${r2}`;
}

export function computeTrackEndUs(track: TimelineTrack): number {
  let end = 0;
  for (const it of track.items) {
    end = Math.max(end, it.timelineRange.startUs + it.timelineRange.durationUs);
  }
  return end;
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Minimum clip duration in microseconds below which transitions are removed entirely.
 * Used consistently across move/trim/split commands.
 */
export const TRANSITION_MIN_CLIP_DURATION_US = 100_000;

/**
 * Maximum gap in microseconds between two clips to still be considered "adjacent"
 * for transition mode purposes.
 */
export const TRANSITION_ADJACENCY_THRESHOLD_US = 1_000;

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
      if (!prev || prev.kind !== 'clip' || gap > TRANSITION_ADJACENCY_THRESHOLD_US) {
        transitionIn = { ...transitionIn, mode: 'transparent' };
      }
    }

    if (transitionOut?.mode === 'adjacent' && !transitionOut.isOverridden) {
      const gap = next
        ? next.timelineRange.startUs - (it.timelineRange.startUs + it.timelineRange.durationUs)
        : Infinity;
      if (!next || next.kind !== 'clip' || gap > TRANSITION_ADJACENCY_THRESHOLD_US) {
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
export function autoAdaptClipTransitions(items: TimelineTrackItem[]): TimelineTrackItem[] {
  return autoAdaptClipEdgeDurations(items);
}

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
    return { ...t, items: autoAdaptClipTransitions(t.items) };
  });
}
