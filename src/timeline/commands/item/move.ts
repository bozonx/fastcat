import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../../types';
import type {
  AddClipToTrackCommand,
  AddVirtualClipToTrackCommand,
  RemoveItemCommand,
  DeleteItemsCommand,
  MoveItemCommand,
  MoveItemsCommand,
  TrimItemCommand,
  SplitItemCommand,
  MoveItemToTrackCommand,
  OverlayPlaceItemCommand,
  OverlayTrimItemCommand,
  RenameItemCommand,
  UpdateClipPropertiesCommand,
  UpdateClipTransitionCommand,
  TimelineCommandResult,
} from '../../commands';
import {
  getTrackById,
  getDocFps,
  quantizeTimeUsToFrames,
  quantizeDeltaUsToFrames,
  assertNoOverlap,
  assertClipNotLocked,
  normalizeGaps,
  findClipById,
  updateLinkedLockedAudio,
  getLinkedClipGroupItemIds,
  autoAdaptChangedTracks,
} from '../utils';

export function moveItems(doc: TimelineDocument, cmd: MoveItemsCommand): TimelineCommandResult {
  // Order moves so we never step on an item that hasn't moved yet. We compute
  // each item's current start, then apply moves in the direction of travel:
  // rightward moves go right-to-left (the rightmost item moves first), leftward
  // moves go left-to-right. Without this, a batch like [a:0→100, b:50→150]
  // throws mid-application because `a` collides with `b` before `b` moves.
  const annotated = cmd.moves.map((move) => {
    const track = doc.tracks.find((t) => t.id === move.fromTrackId);
    const item = track?.items.find((x) => x.id === move.itemId);
    const currentStartUs = Math.max(0, Math.round(Number(item?.timelineRange?.startUs ?? 0)));
    const targetStartUs = Math.max(0, Math.round(Number(move.startUs)));
    return { move, currentStartUs, deltaUs: targetStartUs - currentStartUs };
  });

  const totalDelta = annotated.reduce((acc, m) => acc + m.deltaUs, 0);
  const movingRight = totalDelta >= 0;
  annotated.sort((a, b) => (movingRight ? b.currentStartUs - a.currentStartUs : a.currentStartUs - b.currentStartUs));

  let currentDoc = doc;
  for (const { move } of annotated) {
    const res = moveItemToTrack(currentDoc, {
      type: 'move_item_to_track',
      fromTrackId: move.fromTrackId,
      toTrackId: move.toTrackId,
      itemId: move.itemId,
      startUs: move.startUs,
      quantizeToFrames: cmd.quantizeToFrames,
      ignoreLinks: true,
    });
    currentDoc = res.next;
  }

  return { next: currentDoc };
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
      const currentStartUs = Math.max(0, Math.round(Number(item.timelineRange.startUs)));
      const requestedStartUs = Math.max(0, Math.round(Number(cmd.startUs)));
      // Quantize delta once so every group member shifts by the same number of
      // frames; per-member quantization rounds in different directions for
      // non-integer fps and drifts group geometry.
      const rawDeltaUs = shouldQuantizeToFrames
        ? quantizeDeltaUsToFrames(requestedStartUs - currentStartUs, fps, 'round')
        : requestedStartUs - currentStartUs;

      const memberStarts: number[] = [];
      for (const track of doc.tracks) {
        for (const trackItem of track.items) {
          if (!linkedIds.includes(trackItem.id) && trackItem.id !== item.id) continue;
          memberStarts.push(Math.max(0, Math.round(Number(trackItem.timelineRange.startUs))));
        }
      }
      const minMemberStartUs = memberStarts.length > 0 ? Math.min(...memberStarts) : 0;
      const deltaUs = rawDeltaUs < 0 ? Math.max(rawDeltaUs, -minMemberStartUs) : rawDeltaUs;

      const moves: Array<{
        fromTrackId: string;
        toTrackId: string;
        itemId: string;
        startUs: number;
      }> = [];

      for (const track of doc.tracks) {
        for (const trackItem of track.items) {
          if (!linkedIds.includes(trackItem.id) && trackItem.id !== item.id) continue;
          moves.push({
            fromTrackId: track.id,
            toTrackId: track.id,
            itemId: trackItem.id,
            startUs: Math.max(
              0,
              Math.round(Number(trackItem.timelineRange.startUs)) + deltaUs,
            ),
          });
        }
      }

      if (moves.length > 1) {
        // Sort moves so we never collide with an item that hasn't moved yet:
        //   - if moving right (delta > 0): move the rightmost first
        //   - if moving left  (delta <= 0): move the leftmost first
        moves.sort((a, b) => (deltaUs > 0 ? b.startUs - a.startUs : a.startUs - b.startUs));

        let currentDoc = doc;
        for (const move of moves) {
          const res = moveItemToTrack(currentDoc, {
            type: 'move_item_to_track',
            fromTrackId: move.fromTrackId,
            toTrackId: move.toTrackId,
            itemId: move.itemId,
            startUs: move.startUs,
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

  if (
    !cmd.ignoreLinks &&
    item.kind === 'clip' &&
    item.clipType === 'media' &&
    item.linkedVideoClipId &&
    item.lockToLinkedVideo
  ) {
    const linked = findClipById(doc, item.linkedVideoClipId);
    if (!linked) return { next: doc };
    if (linked.track.kind !== 'video') return { next: doc };

    const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
    const startUs = shouldQuantizeToFrames
      ? quantizeTimeUsToFrames(cmd.startUs, getDocFps(doc), 'round')
      : Math.max(0, Math.round(cmd.startUs));
    const durationUs = Math.max(0, linked.item.timelineRange.durationUs);

    assertNoOverlap(linked.track, linked.item.id, startUs, durationUs);

    let nextTracks = doc.tracks.map((t) => {
      if (t.id !== linked.track.id) return t;
      const nextItems: TimelineTrackItem[] = t.items.map((x) =>
        x.id === linked.item.id
          ? {
              ...x,
              timelineRange: { ...x.timelineRange, startUs },
            }
          : x,
      );
      nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
      return {
        ...t,
        items: normalizeGaps(doc, t.id, nextItems, {
          quantizeToFrames: shouldQuantizeToFrames,
        }),
      };
    });

    nextTracks = updateLinkedLockedAudio(
      { ...doc, tracks: nextTracks },
      linked.item.id,
      (audio) => ({
        ...audio,
        timelineRange: { ...audio.timelineRange, startUs },
      }),
    );

    return { next: { ...doc, tracks: nextTracks } };
  }

  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
  const startCandidate = Math.max(0, Math.round(Number(cmd.startUs)));
  const startUs = shouldQuantizeToFrames
    ? quantizeTimeUsToFrames(startCandidate, fps, 'round')
    : startCandidate;
  const durationUs = Math.max(0, item.timelineRange.durationUs);

  assertNoOverlap(track, item.id, startUs, durationUs);

  const nextItemsRaw: TimelineTrackItem[] = track.items.map((x) =>
    x.id === item.id
      ? {
          ...x,
          timelineRange: { ...x.timelineRange, startUs },
        }
      : x,
  );

  nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

  if (!cmd.ignoreLinks && item.kind === 'clip' && track.kind === 'video') {
    nextTracks = updateLinkedLockedAudio({ ...doc, tracks: nextTracks }, item.id, (audio) => ({
      ...audio,
      timelineRange: { ...audio.timelineRange, startUs },
    }));
  }

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
      startUs: cmd.startUs,
      quantizeToFrames: cmd.quantizeToFrames,
      ignoreLocks: cmd.ignoreLocks,
      ignoreLinks: cmd.ignoreLinks,
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

  const isLockedLinkedAudio =
    !cmd.ignoreLinks &&
    item.kind === 'clip' &&
    item.clipType === 'media' &&
    Boolean(item.linkedVideoClipId) &&
    Boolean(item.lockToLinkedVideo);

  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
  const startCandidate = Math.max(0, Math.round(Number(cmd.startUs)));
  const startUs = shouldQuantizeToFrames
    ? quantizeTimeUsToFrames(startCandidate, fps, 'round')
    : startCandidate;
  const durationUs = Math.max(0, item.timelineRange.durationUs);

  assertNoOverlap(toTrack, item.id, startUs, durationUs);

  const nextFromItemsRaw = [...fromTrack.items];
  nextFromItemsRaw.splice(itemIdx, 1);
  const movedItem: TimelineTrackItem = {
    ...item,
    trackId: toTrack.id,
    timelineRange: { ...item.timelineRange, startUs },
  };
  const nextToItemsRaw = [...toTrack.items, movedItem];
  nextToItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

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

  if (
    isLockedLinkedAudio &&
    item.kind === 'clip' &&
    item.clipType === 'media' &&
    item.linkedVideoClipId
  ) {
    const linked = findClipById({ ...doc, tracks: nextTracks }, item.linkedVideoClipId);
    if (linked && linked.track.kind === 'video') {
      const linkedDurationUs = Math.max(0, linked.item.timelineRange.durationUs);
      assertNoOverlap(linked.track, linked.item.id, startUs, linkedDurationUs);

      nextTracks = nextTracks.map((t) => {
        if (t.id !== linked.track.id) return t;
        const nextItems: TimelineTrackItem[] = t.items.map((x) =>
          x.id === linked.item.id
            ? {
                ...x,
                timelineRange: { ...x.timelineRange, startUs },
              }
            : x,
        );
        nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
        return {
          ...t,
          items: normalizeGaps(doc, t.id, nextItems, {
            quantizeToFrames: shouldQuantizeToFrames,
          }),
        };
      });

      nextTracks = updateLinkedLockedAudio(
        { ...doc, tracks: nextTracks },
        linked.item.id,
        (audio) => ({
          ...audio,
          timelineRange: { ...audio.timelineRange, startUs },
        }),
      );
    }
  }

  // Auto-adapt transitions only on tracks that actually changed (from, to, and
  // any linked-audio track). Mapping over every track was O(total_items) per
  // move; for ripple operations on long timelines that compounded badly.
  nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);

  return { next: { ...doc, tracks: nextTracks } };
}
