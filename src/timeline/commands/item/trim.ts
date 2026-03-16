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
  autoAdaptClipTransitions,
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

export function trimItem(doc: TimelineDocument, cmd: TrimItemCommand): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || !item.timelineRange) return { next: doc };
  if (item.kind !== 'clip') return { next: doc };

  assertClipNotLocked(item, 'trim');
  if (item.clipType === 'media' && item.linkedVideoClipId && item.lockToLinkedVideo) {
    throw new Error('Locked audio clip');
  }

  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;
  const deltaCandidate = Math.round(Number(cmd.deltaUs));
  const deltaUs = shouldQuantizeToFrames
    ? quantizeDeltaUsToFrames(deltaCandidate, fps, 'round')
    : deltaCandidate;

  const speed = typeof item.speed === 'number' && Number.isFinite(item.speed) ? item.speed : 1;
  const absSpeed = Math.abs(speed);
  const sourceDeltaUs = shouldQuantizeToFrames
    ? quantizeDeltaUsToFrames(Math.round(deltaUs * absSpeed), fps, 'round')
    : Math.round(deltaUs * absSpeed);

  const prevTimelineStartUs = Math.max(0, Math.round(item.timelineRange.startUs));
  const prevTimelineDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

  const prevSourceStartUs = Math.max(0, Math.round(item.sourceRange.startUs));
  const prevSourceDurationUs = Math.max(0, Math.round(item.sourceRange.durationUs));

  const prevSourceEndUs = prevSourceStartUs + prevSourceDurationUs;

  // For clips with fixed source duration (media and nested timelines), use actual source limits.
  // For infinite-source clips (images, virtual clips), allow unlimited expansion.
  const hasFixedSourceDuration =
    (item.clipType === 'media' && !item.isImage) || item.clipType === 'timeline';
  const maxSourceDurationUs = hasFixedSourceDuration
    ? Math.max(0, Math.round(item.sourceDurationUs))
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
      // Reversed: trim start of timeline means trim end of source range.
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
      // Reversed: trim end of timeline means trim start of source range.
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

  assertNoOverlap(track, item.id, nextTimelineStartUs, nextTimelineDurationUs);

  const nextItemsRaw: TimelineTrackItem[] = track.items.map((x) =>
    x.id === item.id
      ? {
          ...x,
          timelineRange: { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
          sourceRange: { startUs: nextSourceStartUs, durationUs: nextSourceDurationUs },
        }
      : x,
  );

  nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

  if (track.kind === 'video' && item.clipType === 'media') {
    nextTracks = updateLinkedLockedAudio({ ...doc, tracks: nextTracks }, item.id, (audio) => ({
      ...audio,
      timelineRange: { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
      sourceRange: { startUs: nextSourceStartUs, durationUs: nextSourceDurationUs },
      sourceDurationUs: item.sourceDurationUs,
    }));
  }

  // Auto-adapt transitions if the new clip duration is smaller than the transition duration
  nextTracks = nextTracks.map((t) => ({ ...t, items: autoAdaptClipTransitions(t.items) }));

  return { next: { ...doc, tracks: nextTracks } };
}
