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

  if (moved.clipType === 'media' && moved.linkedVideoClipId && moved.lockToLinkedVideo) {
    throw new Error('Locked audio clip');
  }

  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
  const deltaCandidate = Math.round(Number(cmd.deltaUs));
  const deltaUs = shouldQuantizeToFrames
    ? quantizeDeltaUsToFrames(deltaCandidate, fps, 'round')
    : deltaCandidate;
  const speed = typeof moved.speed === 'number' && Number.isFinite(moved.speed) ? moved.speed : 1;
  const sourceDeltaUs = shouldQuantizeToFrames
    ? quantizeDeltaUsToFrames(Math.round(deltaUs * speed), fps, 'round')
    : Math.round(deltaUs * speed);

  const prevTimelineStartUs = Math.max(0, Math.round(moved.timelineRange.startUs));
  const prevTimelineDurationUs = Math.max(0, Math.round(moved.timelineRange.durationUs));

  const prevSourceStartUs = Math.max(0, Math.round(moved.sourceRange.startUs));
  const prevSourceDurationUs = Math.max(0, Math.round(moved.sourceRange.durationUs));
  const prevSourceEndUs = prevSourceStartUs + prevSourceDurationUs;

  const hasFixedSourceDuration = moved.clipType === 'media' && !moved.isImage;
  const maxSourceDurationUs = hasFixedSourceDuration
    ? Math.max(0, Math.round(moved.sourceDurationUs))
    : Number.POSITIVE_INFINITY;

  const minSourceStartUs = hasFixedSourceDuration ? 0 : Number.NEGATIVE_INFINITY;
  const maxSourceEndUs = maxSourceDurationUs;

  let nextTimelineStartUs = prevTimelineStartUs;
  let nextTimelineDurationUs = prevTimelineDurationUs;
  let nextSourceStartUs = prevSourceStartUs;
  let nextSourceEndUs = prevSourceEndUs;

  if (cmd.edge === 'start') {
    const unclampedSourceStartUs = prevSourceStartUs + sourceDeltaUs;
    nextSourceStartUs = clampInt(unclampedSourceStartUs, minSourceStartUs, prevSourceEndUs);
    const appliedDeltaUs = nextSourceStartUs - prevSourceStartUs;

    const appliedTimelineDeltaUs = speed > 0 ? Math.round(appliedDeltaUs / speed) : 0;
    nextTimelineStartUs = Math.max(0, prevTimelineStartUs + appliedTimelineDeltaUs);
    nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs - appliedTimelineDeltaUs);
    nextSourceEndUs = prevSourceEndUs;
  } else {
    const unclampedSourceEndUs = prevSourceEndUs + sourceDeltaUs;
    nextSourceEndUs = clampInt(unclampedSourceEndUs, prevSourceStartUs, maxSourceEndUs);
    const appliedDeltaUs = nextSourceEndUs - prevSourceEndUs;

    const appliedTimelineDeltaUs = speed > 0 ? Math.round(appliedDeltaUs / speed) : 0;
    nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs + appliedTimelineDeltaUs);
    nextTimelineStartUs = prevTimelineStartUs;
    nextSourceStartUs = prevSourceStartUs;
  }

  const nextSourceDurationUs = Math.max(0, nextSourceEndUs - nextSourceStartUs);
  if (shouldQuantizeToFrames) {
    const qTimeline = quantizeRangeToFrames(
      { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
      fps,
    );
    nextTimelineStartUs = qTimeline.startUs;
    nextTimelineDurationUs = qTimeline.durationUs;
  }

  const movedNext: TimelineClipItem = {
    ...moved,
    timelineRange: { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
    sourceRange: { startUs: nextSourceStartUs, durationUs: nextSourceDurationUs },
  };

  const startUs = movedNext.timelineRange.startUs;
  const durationUs = Math.max(0, movedNext.timelineRange.durationUs);
  const endUs = startUs + durationUs;

  const nextItems: TimelineTrackItem[] = [];
  for (const it of track.items) {
    if (it.id === moved.id) {
      nextItems.push(movedNext);
      continue;
    }
    if (it.kind !== 'clip') {
      nextItems.push(it);
      continue;
    }

    if (it.locked) {
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

    // Existing clip fully contains the trimmed item range: split into two
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
          id: nextItemId(track.id, 'clip'),
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

  nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  const docWithMoved: TimelineDocument = {
    ...doc,
    tracks: doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t)),
  };
  const normalized = normalizeGaps(docWithMoved, track.id, nextItems, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: normalized } : t));

  if (track.kind === 'video' && movedNext.clipType === 'media') {
    const updatedMoved = findClipById({ ...doc, tracks: nextTracks }, movedNext.id);
    if (updatedMoved && updatedMoved.track.kind === 'video') {
      nextTracks = updateLinkedLockedAudio(
        { ...doc, tracks: nextTracks },
        updatedMoved.item.id,
        (audio) => ({
          ...audio,
          timelineRange: {
            ...audio.timelineRange,
            startUs: updatedMoved.item.timelineRange.startUs,
            durationUs: updatedMoved.item.timelineRange.durationUs,
          },
          sourceRange: {
            ...audio.sourceRange,
            startUs: updatedMoved.item.sourceRange.startUs,
            durationUs: updatedMoved.item.sourceRange.durationUs,
          },
        }),
      );
    }
  }

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
  const endUs = startUs + durationUs;

  const nextFromItemsRaw = fromTrack.items.filter((x) => x.id !== cmd.itemId);
  const isSameTrack = fromTrack.id === toTrack.id;
  const destItems: TimelineTrackItem[] = isSameTrack ? [...nextFromItemsRaw] : [...toTrack.items];

  const nextDestItems = sliceTrackItemsForOverlay(
    destItems,
    startUs,
    durationUs,
    fps,
    shouldQuantizeToFrames,
  );

  const movedItem: TimelineTrackItem = {
    ...item,
    trackId: toTrack.id,
    timelineRange: { ...item.timelineRange, startUs },
  };
  nextDestItems.push(movedItem);
  nextDestItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

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
  } else if (
    !cmd.ignoreLinks &&
    item.kind === 'clip' &&
    fromTrack.kind === 'video' &&
    toTrack.kind === 'video'
  ) {
    nextTracks = updateLinkedLockedAudio({ ...doc, tracks: nextTracks }, item.id, (audio) => ({
      ...audio,
      timelineRange: { ...audio.timelineRange, startUs },
    }));
  }

  return { next: { ...doc, tracks: nextTracks } };
}
