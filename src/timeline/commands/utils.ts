import type {
  TimelineClipItem,
  TimelineDocument,
  TimelineGapItem,
  TimelineTrack,
  TimelineTrackItem,
} from '../types';

export const FALLBACK_FPS = 30;
export const MIN_FPS = 1;
export const MAX_FPS = 240;

export function sanitizeFps(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return FALLBACK_FPS;
  const rounded = Math.round(parsed);
  if (rounded < MIN_FPS) return MIN_FPS;
  if (rounded > MAX_FPS) return MAX_FPS;
  return rounded;
}

export function getDocFps(doc: TimelineDocument): number {
  return sanitizeFps((doc as any)?.timebase?.fps);
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
  const linkedGroupId = String((origin.item as any).linkedGroupId ?? '').trim();

  if (linkedGroupId) {
    for (const track of doc.tracks) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;
        if (String((item as any).linkedGroupId ?? '').trim() !== linkedGroupId) continue;
        result.add(item.id);
      }
    }
  }

  const originLinkedVideoId = String((origin.item as any).linkedVideoClipId ?? '').trim();
  if (originLinkedVideoId) {
    result.add(originLinkedVideoId);
  }

  for (const track of doc.tracks) {
    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      const linkedVideoId = String((item as any).linkedVideoClipId ?? '').trim();
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

export function assertNoOverlap(
  track: TimelineTrack,
  movedItemId: string,
  startUs: number,
  durationUs: number,
) {
  const endUs = startUs + durationUs;
  const movedItem =
    track.items.find((x): x is TimelineClipItem => x.id === movedItemId && x.kind === 'clip') ??
    null;

  for (const it of track.items) {
    if (it.id === movedItemId) continue;
    if (it.kind !== 'clip') continue;
    const itStart = it.timelineRange.startUs;
    const itEnd = itStart + it.timelineRange.durationUs;
    if (rangesOverlap(startUs, endUs, itStart, itEnd)) {
      // Allow overlap when it is a transition crossfade area.
      // The overlap must be exactly at the end of the left clip and the start of the right clip
      // and must be fully covered by transitionOut/transitionIn durations.
      const overlapStart = Math.max(startUs, itStart);
      const overlapEnd = Math.min(endUs, itEnd);
      const overlapUs = Math.max(0, overlapEnd - overlapStart);
      if (overlapUs > 0 && movedItem) {
        const movedStartUs = startUs;
        const movedEndUs = endUs;

        const itIsRight = movedStartUs <= itStart;
        const left = itIsRight ? movedItem : it;
        const right = itIsRight ? it : movedItem;

        const leftStartUs = itIsRight ? movedStartUs : itStart;
        const leftEndUs = itIsRight ? movedEndUs : itEnd;
        const rightStartUs = itIsRight ? itStart : movedStartUs;

        const isCutOverlap = overlapStart === rightStartUs && overlapEnd === leftEndUs;
        const leftOutDur = Number((left as any).transitionOut?.durationUs);
        const rightInDur = Number((right as any).transitionIn?.durationUs);

        if (
          isCutOverlap &&
          Number.isFinite(leftOutDur) &&
          Number.isFinite(rightInDur) &&
          leftOutDur >= overlapUs &&
          rightInDur >= overlapUs
        ) {
          continue;
        }
      }
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

export function sliceTrackItemsForOverlay(
  items: import('../types').TimelineTrackItem[],
  startUs: number,
  durationUs: number,
  fps: number,
  shouldQuantizeToFrames: boolean,
  excludeItemId?: string,
): import('../types').TimelineTrackItem[] {
  const endUs = startUs + durationUs;
  const nextItems: import('../types').TimelineTrackItem[] = [];

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
          sourceRange: { ...it.sourceRange, durationUs: newDuration },
        });
      }
      continue;
    }

    // Overlaps only on the right side: trim start of existing clip
    if (itStart >= startUs && itStart < endUs && itEnd > endUs) {
      const trimDelta = endUs - itStart;
      const newStart = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(endUs, fps, 'ceil')
        : Math.max(0, Math.round(endUs));
      const newDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(itEnd - endUs, fps, 'floor')
        : Math.max(0, Math.round(itEnd - endUs));
      if (newDuration > 0) {
        const newSourceStartUs = Math.min(
          it.sourceRange.startUs + trimDelta,
          it.sourceRange.startUs + it.sourceRange.durationUs,
        );
        nextItems.push({
          ...it,
          timelineRange: { startUs: newStart, durationUs: newDuration },
          sourceRange: {
            startUs: newSourceStartUs,
            durationUs: Math.max(0, it.sourceRange.durationUs - trimDelta),
          },
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
          sourceRange: { ...it.sourceRange, durationUs: leftDuration },
        });
      }
      const rightTrimDelta = endUs - itStart;
      const rightStart = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(endUs, fps, 'ceil')
        : Math.max(0, Math.round(endUs));
      const rightDuration = shouldQuantizeToFrames
        ? quantizeTimeUsToFrames(itEnd - endUs, fps, 'floor')
        : Math.max(0, Math.round(itEnd - endUs));
      if (rightDuration > 0) {
        const rightSourceStartUs = Math.min(
          it.sourceRange.startUs + rightTrimDelta,
          it.sourceRange.startUs + it.sourceRange.durationUs,
        );
        nextItems.push({
          ...it,
          id: nextItemId(it.trackId, 'clip'),
          timelineRange: { startUs: rightStart, durationUs: rightDuration },
          sourceRange: {
            startUs: rightSourceStartUs,
            durationUs: Math.max(0, it.sourceRange.durationUs - rightTrimDelta),
          },
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

  // Auto-adjust transitions based on adjacency before generating gaps
  for (let i = 0; i < clips.length; i++) {
    const current = clips[i];
    if (!current) continue;
    const prev = i > 0 ? clips[i - 1] : null;
    const next = i < clips.length - 1 ? clips[i + 1] : null;

    // Check left adjacency
    let isAdjacentLeft = false;
    if (prev) {
      const prevEnd = prev.timelineRange.startUs + prev.timelineRange.durationUs;
      if (Math.abs(prevEnd - current.timelineRange.startUs) <= 1_000) {
        isAdjacentLeft = true;
      }
    }

    // Check right adjacency
    let isAdjacentRight = false;
    if (next) {
      const currentEnd = current.timelineRange.startUs + current.timelineRange.durationUs;
      if (Math.abs(currentEnd - next.timelineRange.startUs) <= 1_000) {
        isAdjacentRight = true;
      }
    }

    if (current.transitionIn && !current.transitionIn.isOverridden) {
      current.transitionIn.mode = isAdjacentLeft ? 'adjacent' : 'transparent';
    } else if (current.transitionIn) {
      const expectedMode = isAdjacentLeft ? 'adjacent' : 'transparent';
      const actualMode = current.transitionIn.mode ?? 'transparent';
      if (actualMode === expectedMode) {
        current.transitionIn.isOverridden = false;
        current.transitionIn.mode = expectedMode;
      }
    }

    if (current.transitionOut && !current.transitionOut.isOverridden) {
      current.transitionOut.mode = isAdjacentRight ? 'adjacent' : 'transparent';
    } else if (current.transitionOut) {
      const expectedMode = isAdjacentRight ? 'adjacent' : 'transparent';
      const actualMode = current.transitionOut.mode ?? 'transparent';
      if (actualMode === expectedMode) {
        current.transitionOut.isOverridden = false;
        current.transitionOut.mode = expectedMode;
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
  return `${prefix}_${trackId}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
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
