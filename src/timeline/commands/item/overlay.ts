import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../../types';
import type {
  OverlayPlaceItemCommand,
  OverlayTrimItemCommand,
  TimelineCommandResult,
} from '../../commands';
import {
  getTrackById,
  getDocFps,
  quantizeTimeUsToFrames,
  assertNoOverlap,
  assertClipNotLocked,
  sliceTrackItemsForOverlay,
  normalizeGaps,
  findClipById,
  updateLinkedLockedAudio,
  quantizeDeltaUsToFrames,
  clampInt,
  quantizeRangeToFrames,
  autoAdaptChangedTracks,
} from '../utils';

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
  const absSpeed = Math.abs(speed) || 1;
  const sourceDeltaUs = shouldQuantizeToFrames
    ? quantizeDeltaUsToFrames(Math.round(deltaUs * absSpeed), fps, 'round')
    : Math.round(deltaUs * absSpeed);

  const prevTimelineStartUs = Math.max(0, Math.round(moved.timelineRange.startUs));
  const prevTimelineDurationUs = Math.max(0, Math.round(moved.timelineRange.durationUs));

  const prevSourceStartUs = Math.max(0, Math.round(moved.sourceRange.startUs));
  const prevSourceDurationUs = Math.max(0, Math.round(moved.sourceRange.durationUs));
  const prevSourceEndUs = prevSourceStartUs + prevSourceDurationUs;

  const hasFixedSourceDuration =
    (moved.clipType === 'media' && !moved.isImage) || moved.clipType === 'timeline';
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
    if (speed >= 0) {
      const unclampedSourceStartUs = prevSourceStartUs + sourceDeltaUs;
      nextSourceStartUs = clampInt(unclampedSourceStartUs, minSourceStartUs, prevSourceEndUs);
      const appliedDeltaUs = nextSourceStartUs - prevSourceStartUs;
      const appliedTimelineDeltaUs = Math.round(appliedDeltaUs / absSpeed);

      nextTimelineStartUs = Math.max(0, prevTimelineStartUs + appliedTimelineDeltaUs);
      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs - appliedTimelineDeltaUs);
      nextSourceEndUs = prevSourceEndUs;
    } else {
      const unclampedSourceEndUs = prevSourceEndUs - sourceDeltaUs;
      nextSourceEndUs = clampInt(unclampedSourceEndUs, prevSourceStartUs, maxSourceEndUs);
      const appliedDeltaUs = prevSourceEndUs - nextSourceEndUs;
      const appliedTimelineDeltaUs = Math.round(appliedDeltaUs / absSpeed);

      nextTimelineStartUs = Math.max(0, prevTimelineStartUs + appliedTimelineDeltaUs);
      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs - appliedTimelineDeltaUs);
      nextSourceStartUs = prevSourceStartUs;
    }
  } else {
    if (speed >= 0) {
      const unclampedSourceEndUs = prevSourceEndUs + sourceDeltaUs;
      nextSourceEndUs = clampInt(unclampedSourceEndUs, prevSourceStartUs, maxSourceEndUs);
      const appliedDeltaUs = nextSourceEndUs - prevSourceEndUs;
      const appliedTimelineDeltaUs = Math.round(appliedDeltaUs / absSpeed);

      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs + appliedTimelineDeltaUs);
      nextTimelineStartUs = prevTimelineStartUs;
      nextSourceStartUs = prevSourceStartUs;
    } else {
      const unclampedSourceStartUs = prevSourceStartUs - sourceDeltaUs;
      nextSourceStartUs = clampInt(unclampedSourceStartUs, minSourceStartUs, prevSourceEndUs);
      const appliedDeltaUs = prevSourceStartUs - nextSourceStartUs;
      const appliedTimelineDeltaUs = Math.round(appliedDeltaUs / absSpeed);

      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs + appliedTimelineDeltaUs);
      nextTimelineStartUs = prevTimelineStartUs;
      nextSourceEndUs = prevSourceEndUs;
    }
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

  const nextItems = sliceTrackItemsForOverlay(
    track.items,
    startUs,
    durationUs,
    fps,
    shouldQuantizeToFrames,
    moved.id,
  );
  nextItems.push(movedNext);

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
      // Linked-audio sync: shift the audio so its head still lines up with the
      // video, and mirror the *amount* of source consumption — never copy the
      // video's absolute sourceRange wholesale, because extract-audio clips can
      // point to a different file with its own range/duration.
      const videoBefore = moved;
      const videoAfter = updatedMoved.item;
      const startDeltaUs = videoAfter.timelineRange.startUs - videoBefore.timelineRange.startUs;
      const sourceStartDeltaUs = videoAfter.sourceRange.startUs - videoBefore.sourceRange.startUs;
      const newDurationUs = videoAfter.timelineRange.durationUs;
      nextTracks = updateLinkedLockedAudio(
        { ...doc, tracks: nextTracks },
        updatedMoved.item.id,
        (audio) => {
          const audioSpeed =
            typeof audio.speed === 'number' && Number.isFinite(audio.speed) ? audio.speed : 1;
          const audioAbsSpeed = Math.max(0.0001, Math.abs(audioSpeed));
          const audioSourceLimit = Math.max(0, Math.round(Number(audio.sourceDurationUs ?? 0)));
          const nextAudioSourceStartUs = Math.max(
            0,
            Math.round(audio.sourceRange.startUs + sourceStartDeltaUs),
          );
          const requestedAudioSourceDurationUs = Math.max(
            0,
            Math.round(newDurationUs * audioAbsSpeed),
          );
          const audioSourceDurationUs =
            audioSourceLimit > 0
              ? Math.min(
                  requestedAudioSourceDurationUs,
                  Math.max(0, audioSourceLimit - nextAudioSourceStartUs),
                )
              : requestedAudioSourceDurationUs;
          return {
            ...audio,
            timelineRange: {
              ...audio.timelineRange,
              startUs: Math.max(0, audio.timelineRange.startUs + startDeltaUs),
              durationUs: newDurationUs,
            },
            sourceRange: {
              ...audio.sourceRange,
              startUs: nextAudioSourceStartUs,
              durationUs: audioSourceDurationUs,
            },
          };
        },
      );
    }
  }

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

  nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);

  return { next: { ...doc, tracks: nextTracks } };
}
