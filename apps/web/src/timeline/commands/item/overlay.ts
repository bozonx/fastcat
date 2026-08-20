import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../../types';
import type {
  OverlayPlaceItemCommand,
  OverlayTrimItemCommand,
  TimelineCommandResult,
} from '../../commands';
import {
  getTrackById,
  getDocFps,
  quantizeTicksToFrames,
  assertClipNotLocked,
  sliceTrackItemsForOverlay,
  normalizeGaps,
  autoAdaptChangedTracks,
} from '../utils';
import { computeTrimGeometry } from './trimGeometry';

export function overlayTrimItem(
  doc: TimelineDocument,
  cmd: OverlayTrimItemCommand,
): TimelineCommandResult {
  const fps = getDocFps(doc);

  const track = getTrackById(doc, cmd.trackId);
  const movedPrev = track.items.find((x) => x.id === cmd.itemId);
  if (!movedPrev || movedPrev.kind !== 'clip') return { next: doc };
  const moved = movedPrev as TimelineClipItem;

  assertClipNotLocked(moved, 'trim');

  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;

  const hasFixedSourceDuration =
    (moved.clipType === 'media' && !moved.isImage) || moved.clipType === 'timeline';

  const { timelineRange, sourceRange, valid } = computeTrimGeometry({
    edge: cmd.edge,
    deltaTicks: cmd.deltaTicks,
    speed: moved.speed,
    fps,
    quantizeToFrames: shouldQuantizeToFrames,
    timelineRange: moved.timelineRange,
    sourceRange: moved.sourceRange,
    sourceDurationTicks: moved.sourceDurationTicks,
    hasFixedSourceDuration,
  });

  if (!valid) return { next: doc };

  const movedNext: TimelineClipItem = {
    ...moved,
    timelineRange,
    sourceRange,
  };

  const startTicks = movedNext.timelineRange.startTicks;
  const durationTicks = Math.max(0, movedNext.timelineRange.durationTicks);

  const nextItems = sliceTrackItemsForOverlay(
    track.items,
    startTicks,
    durationTicks,
    fps,
    shouldQuantizeToFrames,
    moved.id,
  );
  nextItems.push(movedNext);

  nextItems.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
  const docWithMoved: TimelineDocument = {
    ...doc,
    tracks: doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t)),
  };
  const normalized = normalizeGaps(docWithMoved, track.id, nextItems, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: normalized } : t));

  nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);

  return { next: { ...doc, tracks: nextTracks } };
}

export function overlayPlaceItem(
  doc: TimelineDocument,
  cmd: OverlayPlaceItemCommand,
): TimelineCommandResult {
  const fromTrack = getTrackById(doc, cmd.fromTrackId);
  const toTrack = getTrackById(doc, cmd.toTrackId);

  const itemIdx = fromTrack.items.findIndex((x) => x.id === cmd.itemId);
  if (itemIdx === -1) return { next: doc };
  const item = fromTrack.items[itemIdx];
  if (!item || !item.timelineRange) return { next: doc };

  if (!cmd.ignoreLocks) {
    assertClipNotLocked(item, 'move');
  }

  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
  const startCandidate = Math.max(0, Math.round(Number(cmd.startTicks)));
  const startTicks = shouldQuantizeToFrames
    ? quantizeTicksToFrames(startCandidate, fps, 'round')
    : startCandidate;
  const durationTicks = Math.max(0, item.timelineRange.durationTicks);
  const nextFromItemsRaw = fromTrack.items.filter((x) => x.id !== cmd.itemId);
  const isSameTrack = fromTrack.id === toTrack.id;
  const destItems: TimelineTrackItem[] = isSameTrack ? [...nextFromItemsRaw] : [...toTrack.items];

  const nextDestItems = sliceTrackItemsForOverlay(
    destItems,
    startTicks,
    durationTicks,
    fps,
    shouldQuantizeToFrames,
  );

  const movedItem: TimelineTrackItem = {
    ...item,
    trackId: toTrack.id,
    timelineRange: { ...item.timelineRange, startTicks },
  };
  nextDestItems.push(movedItem);
  nextDestItems.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);

  const normalizedDest = normalizeGaps(doc, toTrack.id, nextDestItems, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks: typeof doc.tracks;
  if (isSameTrack) {
    nextTracks = doc.tracks.map((t) => (t.id === toTrack.id ? { ...t, items: normalizedDest } : t));
  } else {
    const normalizedFrom = normalizeGaps(doc, fromTrack.id, nextFromItemsRaw, {
      quantizeToFrames: shouldQuantizeToFrames,
    });
    nextTracks = doc.tracks.map((t) => {
      if (t.id === fromTrack.id) return { ...t, items: normalizedFrom };
      if (t.id === toTrack.id) return { ...t, items: normalizedDest };
      return t;
    });
  }

  nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);

  return { next: { ...doc, tracks: nextTracks } };
}
