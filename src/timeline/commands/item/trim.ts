import type { TimelineDocument, TimelineTrackItem } from '../../types';
import type { TrimItemCommand, TrimItemsCommand, TimelineCommandResult } from '../../commands';
import {
  getTrackById,
  getDocFps,
  assertNoOverlap,
  assertClipNotLocked,
  normalizeGaps,
  autoAdaptChangedTracks,
} from '../utils';
import { computeTrimGeometry } from './trimGeometry';

export function trimItem(doc: TimelineDocument, cmd: TrimItemCommand): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || !item.timelineRange) return { next: doc };
  if (item.kind !== 'clip') return { next: doc };

  assertClipNotLocked(item, 'trim');


  const fps = getDocFps(doc);
  const shouldQuantizeToFrames = cmd.quantizeToFrames !== false;

  // Clips with fixed source duration (media and nested timelines) are limited to
  // their real material; images and virtual clips may be extended freely.
  const hasFixedSourceDuration =
    (item.clipType === 'media' && !item.isImage) || item.clipType === 'timeline';

  const { timelineRange, sourceRange, valid } = computeTrimGeometry({
    edge: cmd.edge,
    deltaUs: cmd.deltaUs,
    speed: item.speed,
    fps,
    quantizeToFrames: shouldQuantizeToFrames,
    timelineRange: item.timelineRange,
    sourceRange: item.sourceRange,
    sourceDurationUs: item.sourceDurationUs,
    hasFixedSourceDuration,
  });

  if (!valid) return { next: doc };

  assertNoOverlap(track, item.id, timelineRange.startUs, timelineRange.durationUs);

  const nextItemsRaw: TimelineTrackItem[] = track.items.map((x) =>
    x.id === item.id ? { ...x, timelineRange, sourceRange } : x,
  );

  nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  const nextItems = normalizeGaps(doc, track.id, nextItemsRaw, {
    quantizeToFrames: shouldQuantizeToFrames,
  });

  let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));



  // Auto-adapt transitions only on tracks whose items actually changed.
  nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);

  return { next: { ...doc, tracks: nextTracks } };
}

export function trimItems(doc: TimelineDocument, cmd: TrimItemsCommand): TimelineCommandResult {
  let currentDoc = doc;
  for (const trim of cmd.trims) {
    const result = trimItem(currentDoc, {
      type: 'trim_item',
      trackId: trim.trackId,
      itemId: trim.itemId,
      edge: trim.edge,
      deltaUs: trim.deltaUs,
      quantizeToFrames: cmd.quantizeToFrames,
    });
    currentDoc = result.next;
  }
  return { next: currentDoc };
}
