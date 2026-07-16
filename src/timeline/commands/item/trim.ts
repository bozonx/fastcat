import type {
  TimelineDocument,
  TimelineTrackItem,
  TimelineTrack,
  TimelineRange,
  TimelineClipItem,
} from '../../types';
import type { TrimItemCommand, TrimItemsCommand, TimelineCommandResult } from '../../commands';
import {
  getTrackById,
  getDocFps,
  assertNoOverlap,
  assertClipNotLocked,
  normalizeGaps,
  autoAdaptChangedTracks,
  getLinkedClipGroupItemIds,
  findClipById,
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

  // If the clip is in a group, trim the entire group
  if (item.linkedGroupId) {
    const groupItemIds = getLinkedClipGroupItemIds(doc, item.id);

    const trimGeometries: Array<{
      track: TimelineTrack;
      clip: TimelineClipItem;
      timelineRange: TimelineRange;
      sourceRange: TimelineRange;
    }> = [];

    for (const gid of groupItemIds) {
      const found = findClipById(doc, gid);
      if (!found) continue;

      const { track: t, item: c } = found;
      assertClipNotLocked(c, 'trim');

      const hasFixedSourceDuration =
        (c.clipType === 'media' && !c.isImage) || c.clipType === 'timeline';

      const geom = computeTrimGeometry({
        edge: cmd.edge,
        deltaTicks: cmd.deltaTicks,
        speed: c.speed,
        fps,
        quantizeToFrames: shouldQuantizeToFrames,
        timelineRange: c.timelineRange,
        sourceRange: c.sourceRange,
        sourceDurationTicks: c.sourceDurationTicks,
        hasFixedSourceDuration,
      });

      if (!geom.valid) {
        return { next: doc };
      }

      trimGeometries.push({
        track: t,
        clip: c,
        timelineRange: geom.timelineRange,
        sourceRange: geom.sourceRange,
      });
    }

    // Check overlap for all group members before applying
    for (const geom of trimGeometries) {
      assertNoOverlap(
        geom.track,
        geom.clip.id,
        geom.timelineRange.startTicks,
        geom.timelineRange.durationTicks,
      );
    }

    // Group changes by track
    const trackIdToGeoms = new Map<string, typeof trimGeometries>();
    for (const geom of trimGeometries) {
      let list = trackIdToGeoms.get(geom.track.id);
      if (!list) {
        list = [];
        trackIdToGeoms.set(geom.track.id, list);
      }
      list.push(geom);
    }

    let nextTracks = doc.tracks.map((t) => {
      const geomsForTrack = trackIdToGeoms.get(t.id);
      if (!geomsForTrack || geomsForTrack.length === 0) return t;

      const nextItemsRaw = t.items.map((x) => {
        const geom = geomsForTrack.find((g) => g.clip.id === x.id);
        if (geom) {
          return {
            ...x,
            timelineRange: geom.timelineRange,
            sourceRange: geom.sourceRange,
          };
        }
        return x;
      });

      nextItemsRaw.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
      const nextItems = normalizeGaps(doc, t.id, nextItemsRaw, {
        quantizeToFrames: shouldQuantizeToFrames,
      });

      return { ...t, items: nextItems };
    });

    nextTracks = autoAdaptChangedTracks(doc.tracks, nextTracks);
    return { next: { ...doc, tracks: nextTracks } };
  }

  // Clips with fixed source duration (media and nested timelines) are limited to
  // their real material; images and virtual clips may be extended freely.
  const hasFixedSourceDuration =
    (item.clipType === 'media' && !item.isImage) || item.clipType === 'timeline';

  const { timelineRange, sourceRange, valid } = computeTrimGeometry({
    edge: cmd.edge,
    deltaTicks: cmd.deltaTicks,
    speed: item.speed,
    fps,
    quantizeToFrames: shouldQuantizeToFrames,
    timelineRange: item.timelineRange,
    sourceRange: item.sourceRange,
    sourceDurationTicks: item.sourceDurationTicks,
    hasFixedSourceDuration,
  });

  if (!valid) return { next: doc };

  assertNoOverlap(track, item.id, timelineRange.startTicks, timelineRange.durationTicks);

  const nextItemsRaw: TimelineTrackItem[] = track.items.map((x) =>
    x.id === item.id ? { ...x, timelineRange, sourceRange } : x,
  );

  nextItemsRaw.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
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
      deltaTicks: trim.deltaTicks,
      quantizeToFrames: cmd.quantizeToFrames,
    });
    currentDoc = result.next;
  }
  return { next: currentDoc };
}
