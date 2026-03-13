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
  usToFrame,
  frameToUs,
  computeTrackEndUs,
  assertNoOverlap,
  nextItemId,
  sliceTrackItemsForOverlay,
  normalizeGaps,
  findClipById,
  updateLinkedLockedAudio,
  getLinkedClipGroupItemIds,
  quantizeDeltaUsToFrames,
  clampInt,
  quantizeRangeToFrames,
} from '../utils';
import { normalizeBalance, normalizeGain } from '~/utils/audio/envelope';
import {
  normalizeTransitionCurve,
  normalizeTransitionMode,
  normalizeTransitionParams,
} from '~/transitions';
import type { TransitionCurve, TransitionMode } from '~/transitions';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';

function assertClipNotLocked(item: TimelineTrackItem, action: string) {
  if (item.kind !== 'clip') return;
  if (!item.locked) return;
  throw new Error(`Locked clip: ${action}`);
}

export function moveItems(doc: TimelineDocument, cmd: MoveItemsCommand): TimelineCommandResult {
  let currentDoc = doc;

  for (const move of cmd.moves) {
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
      const currentStartUs = Math.max(0, Math.round(Number(item.timelineRange.startUs)));
      const requestedStartUs = Math.max(0, Math.round(Number(cmd.startUs)));
      const deltaUs = requestedStartUs - currentStartUs;

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
            startUs: Math.max(0, Math.round(Number(trackItem.timelineRange.startUs)) + deltaUs),
          });
        }
      }

      if (moves.length > 1) {
        let currentDoc = doc;
        for (const move of moves) {
          const res = moveItemToTrack(currentDoc, {
            type: 'move_item_to_track',
            fromTrackId: move.fromTrackId,
            toTrackId: move.toTrackId,
            itemId: move.itemId,
            startUs: move.startUs,
            quantizeToFrames: cmd.quantizeToFrames,
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

  // Auto-adapt transitions after move: if the clip is no longer adjacent, fallback to 'transparent'
  nextTracks = nextTracks.map((t) => {
    return {
      ...t,
      items: t.items.map((it, idx, arr) => {
        if (it.kind !== 'clip') return it;

        let transitionIn = it.transitionIn;
        let transitionOut = it.transitionOut;

        if (transitionIn?.mode === 'adjacent') {
          const prev = idx > 0 ? arr[idx - 1] : null;
          if (
            !prev ||
            prev.kind !== 'clip' ||
            it.timelineRange.startUs -
              (prev.timelineRange.startUs + prev.timelineRange.durationUs) >
              1000
          ) {
            transitionIn = { ...transitionIn, mode: 'transparent' };
          }
        }

        if (transitionOut?.mode === 'adjacent') {
          const next = idx < arr.length - 1 ? arr[idx + 1] : null;
          if (
            !next ||
            next.kind !== 'clip' ||
            next.timelineRange.startUs - (it.timelineRange.startUs + it.timelineRange.durationUs) >
              1000
          ) {
            transitionOut = { ...transitionOut, mode: 'transparent' };
          }
        }

        if (transitionIn !== it.transitionIn || transitionOut !== it.transitionOut) {
          return { ...it, transitionIn, transitionOut };
        }
        return it;
      }),
    };
  });

  return { next: { ...doc, tracks: nextTracks } };
}
