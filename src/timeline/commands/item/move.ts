import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../../types';
import type {
  MoveItemCommand,
  MoveItemsCommand,
  MoveItemToTrackCommand,
  TimelineCommandResult,
} from '../../commands';
import {
  getTrackById,
  getDocFps,
  quantizeTicksToFrames,
  quantizeDeltaTicksToFrames,
  assertNoOverlap,
  assertClipNotLocked,
  normalizeGaps,
  getLinkedClipGroupItemIds,
  autoAdaptChangedTracks,
  rangesOverlap,
  OVERLAP_EPSILON_TICKS,
} from '../utils';

function assertTrackItemsDoNotOverlap(items: TimelineTrackItem[]) {
  const clips = items
    .filter((it): it is TimelineClipItem => it.kind === 'clip')
    .slice()
    .sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);

  for (let i = 1; i < clips.length; i++) {
    const prev = clips[i - 1];
    const current = clips[i];
    if (!prev || !current) continue;

    const prevStartTicks = prev.timelineRange.startTicks;
    const prevEndTicks = prevStartTicks + prev.timelineRange.durationTicks;
    const currentStartTicks = current.timelineRange.startTicks;
    const currentEndTicks = currentStartTicks + current.timelineRange.durationTicks;

    if (
      rangesOverlap(prevStartTicks, prevEndTicks, currentStartTicks, currentEndTicks) &&
      Math.min(prevEndTicks, currentEndTicks) - Math.max(prevStartTicks, currentStartTicks) >
        OVERLAP_EPSILON_TICKS
    ) {
      throw new Error('Item overlaps with another item');
    }
  }
}

function moveItemsWithinTracks(
  doc: TimelineDocument,
  cmd: MoveItemsCommand,
): TimelineCommandResult {
  const fps = getDocFps(doc);
  const preserveItemOffsets = cmd.preserveItemOffsets === true;
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false && !preserveItemOffsets;
  const movesByTrack = new Map<string, Map<string, number>>();
  const seenMoveKeys = new Set<string>();

  for (const move of cmd.moves) {
    if (move.fromTrackId !== move.toTrackId) return moveItemsSequentially(doc, cmd);

    const moveKey = `${move.fromTrackId}:${move.itemId}`;
    if (seenMoveKeys.has(moveKey)) return moveItemsSequentially(doc, cmd);
    seenMoveKeys.add(moveKey);

    const startCandidate = Math.max(0, Math.round(Number(move.startTicks)));
    const startTicks = shouldQuantizeToFrames
      ? quantizeTicksToFrames(startCandidate, fps, 'round')
      : startCandidate;

    let byItem = movesByTrack.get(move.fromTrackId);
    if (!byItem) {
      byItem = new Map<string, number>();
      movesByTrack.set(move.fromTrackId, byItem);
    }
    byItem.set(move.itemId, startTicks);
  }

  if (movesByTrack.size === 0) return { next: doc };

  let changed = false;
  let nextTracks = doc.tracks.map((track) => {
    const startsByItem = movesByTrack.get(track.id);
    if (!startsByItem) return track;

    let trackChanged = false;
    const nextItemsRaw = track.items.map((item) => {
      const startTicks = startsByItem.get(item.id);
      if (startTicks === undefined) return item;

      if (!cmd.ignoreLocks) {
        assertClipNotLocked(item, 'move');
      }

      trackChanged = true;
      return {
        ...item,
        timelineRange: { ...item.timelineRange, startTicks },
      };
    });

    if (!trackChanged) return track;

    nextItemsRaw.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
    assertTrackItemsDoNotOverlap(nextItemsRaw);
    changed = true;

    return {
      ...track,
      items: normalizeGaps(doc, track.id, nextItemsRaw, {
        quantizeToFrames: shouldQuantizeToFrames,
      }),
    };
  });

  if (!changed) return { next: doc };

  nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);
  return { next: { ...doc, tracks: nextTracks } };
}

function moveItemsSequentially(
  doc: TimelineDocument,
  cmd: MoveItemsCommand,
): TimelineCommandResult {
  // Order moves so we never step on an item that hasn't moved yet. We compute
  // each item's current start, then apply moves in the direction of travel:
  // rightward moves go right-to-left (the rightmost item moves first), leftward
  // moves go left-to-right. Without this, a batch like [a:0→100, b:50→150]
  // throws mid-application because `a` collides with `b` before `b` moves.
  const annotated = cmd.moves.map((move) => {
    const track = doc.tracks.find((t) => t.id === move.fromTrackId);
    const item = track?.items.find((x) => x.id === move.itemId);
    const currentStartTicks = Math.max(0, Math.round(Number(item?.timelineRange?.startTicks ?? 0)));
    const targetStartTicks = Math.max(0, Math.round(Number(move.startTicks)));
    return { move, currentStartTicks, deltaTicks: targetStartTicks - currentStartTicks };
  });

  const totalDelta = annotated.reduce((acc, m) => acc + m.deltaTicks, 0);
  const movingRight = totalDelta >= 0;
  annotated.sort((a, b) =>
    movingRight
      ? b.currentStartTicks - a.currentStartTicks
      : a.currentStartTicks - b.currentStartTicks,
  );

  let currentDoc = doc;
  for (const { move } of annotated) {
    const res = moveItemToTrack(currentDoc, {
      type: 'move_item_to_track',
      fromTrackId: move.fromTrackId,
      toTrackId: move.toTrackId,
      itemId: move.itemId,
      startTicks: move.startTicks,
      quantizeToFrames: cmd.quantizeToFrames,
      ignoreLocks: cmd.ignoreLocks,
      ignoreLinks: true,
      preserveItemOffsets: cmd.preserveItemOffsets,
    });
    currentDoc = res.next;
  }

  return { next: currentDoc };
}

export function moveItems(doc: TimelineDocument, cmd: MoveItemsCommand): TimelineCommandResult {
  return moveItemsWithinTracks(doc, cmd);
}

export function moveItem(doc: TimelineDocument, cmd: MoveItemCommand): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || !item.timelineRange) return { next: doc };

  if (!cmd.ignoreLocks) {
    assertClipNotLocked(item, 'move');
  }

  if (!cmd.ignoreLinks && item.kind === 'clip') {
    const linkedIds = getLinkedClipGroupItemIds(doc, item.id).filter((id) => id !== item.id);
    if (linkedIds.length > 0) {
      const fps = getDocFps(doc);
      const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
      const currentStartTicks = Math.max(0, Math.round(Number(item.timelineRange.startTicks)));
      const requestedStartTicks = Math.max(0, Math.round(Number(cmd.startTicks)));
      // Quantize delta once so every group member shifts by the same number of
      // frames; per-member quantization rounds in different directions for
      // non-integer fps and drifts group geometry.
      const rawDeltaTicks = shouldQuantizeToFrames
        ? quantizeDeltaTicksToFrames(requestedStartTicks - currentStartTicks, fps, 'round')
        : requestedStartTicks - currentStartTicks;

      const memberStarts: number[] = [];
      for (const track of doc.tracks) {
        for (const trackItem of track.items) {
          if (!linkedIds.includes(trackItem.id) && trackItem.id !== item.id) continue;
          memberStarts.push(Math.max(0, Math.round(Number(trackItem.timelineRange.startTicks))));
        }
      }
      const minMemberStartTicks = memberStarts.length > 0 ? Math.min(...memberStarts) : 0;
      const deltaTicks =
        rawDeltaTicks < 0 ? Math.max(rawDeltaTicks, -minMemberStartTicks) : rawDeltaTicks;

      const moves: Array<{
        fromTrackId: string;
        toTrackId: string;
        itemId: string;
        startTicks: number;
      }> = [];

      for (const track of doc.tracks) {
        for (const trackItem of track.items) {
          if (!linkedIds.includes(trackItem.id) && trackItem.id !== item.id) continue;
          moves.push({
            fromTrackId: track.id,
            toTrackId: track.id,
            itemId: trackItem.id,
            startTicks: Math.max(
              0,
              Math.round(Number(trackItem.timelineRange.startTicks)) + deltaTicks,
            ),
          });
        }
      }

      if (moves.length > 1) {
        // Sort moves so we never collide with an item that hasn't moved yet:
        //   - if moving right (delta > 0): move the rightmost first
        //   - if moving left  (delta <= 0): move the leftmost first
        moves.sort((a, b) =>
          deltaTicks > 0 ? b.startTicks - a.startTicks : a.startTicks - b.startTicks,
        );

        let currentDoc = doc;
        for (const move of moves) {
          const res = moveItemToTrack(currentDoc, {
            type: 'move_item_to_track',
            fromTrackId: move.fromTrackId,
            toTrackId: move.toTrackId,
            itemId: move.itemId,
            startTicks: move.startTicks,
            // Delta was already quantized; skip per-member rounding to preserve
            // group geometry exactly.
            quantizeToFrames: false,
            ignoreLocks: cmd.ignoreLocks,
            ignoreLinks: true,
          });
          currentDoc = res.next;
        }
        return { next: currentDoc };
      }
    }
  }

  const fps = getDocFps(doc);
  const preserveItemOffsets = cmd.preserveItemOffsets === true;
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false && !preserveItemOffsets;
  const startCandidate = Math.max(0, Math.round(Number(cmd.startTicks)));
  const startTicks = shouldQuantizeToFrames
    ? quantizeTicksToFrames(startCandidate, fps, 'round')
    : startCandidate;
  const durationTicks = Math.max(0, item.timelineRange.durationTicks);

  assertNoOverlap(track, item.id, startTicks, durationTicks);

  const nextItemsRaw: TimelineTrackItem[] = track.items.map((x) =>
    x.id === item.id
      ? {
          ...x,
          timelineRange: { ...x.timelineRange, startTicks },
        }
      : x,
  );

  nextItemsRaw.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  const nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

  return { next: { ...doc, tracks: nextTracks } };
}

export function moveItemToTrack(
  doc: TimelineDocument,
  cmd: MoveItemToTrackCommand,
): TimelineCommandResult {
  const fromTrack = getTrackById(doc, cmd.fromTrackId);
  const toTrack = getTrackById(doc, cmd.toTrackId);

  if (fromTrack.id === toTrack.id) {
    return moveItem(doc, {
      type: 'move_item',
      trackId: fromTrack.id,
      itemId: cmd.itemId,
      startTicks: cmd.startTicks,
      quantizeToFrames: cmd.quantizeToFrames,
      ignoreLocks: cmd.ignoreLocks,
      ignoreLinks: cmd.ignoreLinks,
      preserveItemOffsets: cmd.preserveItemOffsets,
    });
  }

  const itemIdx = fromTrack.items.findIndex((x) => x.id === cmd.itemId);
  if (itemIdx === -1) return { next: doc };
  const item = fromTrack.items[itemIdx];
  if (!item) return { next: doc };
  if (!item.timelineRange) return { next: doc };

  if (!cmd.ignoreLocks) {
    assertClipNotLocked(item, 'move');
  }

  const fps = getDocFps(doc);
  const preserveItemOffsets = cmd.preserveItemOffsets === true;
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false && !preserveItemOffsets;
  const startCandidate = Math.max(0, Math.round(Number(cmd.startTicks)));
  const startTicks = shouldQuantizeToFrames
    ? quantizeTicksToFrames(startCandidate, fps, 'round')
    : startCandidate;
  const durationTicks = Math.max(0, item.timelineRange.durationTicks);

  assertNoOverlap(toTrack, item.id, startTicks, durationTicks);

  const nextFromItemsRaw = [...fromTrack.items];
  nextFromItemsRaw.splice(itemIdx, 1);
  const movedItem: TimelineTrackItem = {
    ...item,
    trackId: toTrack.id,
    timelineRange: { ...item.timelineRange, startTicks },
  };
  const nextToItemsRaw = [...toTrack.items, movedItem];
  nextToItemsRaw.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);

  const nextFromItems = normalizeGaps(doc, fromTrack.id, nextFromItemsRaw, {
    quantizeToFrames: shouldQuantizeToFrames,
  });
  const nextToItems = normalizeGaps(doc, toTrack.id, nextToItemsRaw, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks = doc.tracks.map((t) => {
    if (t.id === fromTrack.id) return { ...t, items: nextFromItems };
    if (t.id === toTrack.id) return { ...t, items: nextToItems };
    return t;
  });

  // Auto-adapt transitions only on tracks that actually changed (from, to, and
  // any linked-audio track). Mapping over every track was O(total_items) per
  // move; for ripple operations on long timelines that compounded badly.
  nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);

  return { next: { ...doc, tracks: nextTracks } };
}
