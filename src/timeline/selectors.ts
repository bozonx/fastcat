import type { TimelineDocument, TimelineTrackItem, TrackKind } from './types';

export function selectTrack(doc: TimelineDocument, trackId: string) {
  return doc.tracks.find((t) => t.id === trackId) ?? null;
}

export function selectTracksByKind(doc: TimelineDocument, kind: TrackKind) {
  return doc.tracks.filter((t) => t.kind === kind);
}

const allItemsCache = new WeakMap<TimelineDocument, TimelineTrackItem[]>();

export function selectAllItems(doc: TimelineDocument): TimelineTrackItem[] {
  const cached = allItemsCache.get(doc);
  if (cached !== undefined) return cached;
  const items = doc.tracks.flatMap((t) => t.items);
  allItemsCache.set(doc, items);
  return items;
}

const durationCache = new WeakMap<TimelineDocument, number>();

export function selectTimelineDurationTicks(doc: TimelineDocument): number {
  const cached = durationCache.get(doc);
  if (cached !== undefined) return cached;
  let maxEnd = 0;
  for (const t of doc.tracks) {
    for (const it of t.items) {
      maxEnd = Math.max(maxEnd, it.timelineRange.startTicks + it.timelineRange.durationTicks);
    }
  }
  durationCache.set(doc, maxEnd);
  return maxEnd;
}

const itemToTrackMapCache = new WeakMap<TimelineDocument, Map<string, string>>();

export function selectItemToTrackMap(doc: TimelineDocument): Map<string, string> {
  const cached = itemToTrackMapCache.get(doc);
  if (cached !== undefined) return cached;
  const map = new Map<string, string>();
  for (const t of doc.tracks) {
    for (const it of t.items) {
      map.set(it.id, t.id);
    }
  }
  itemToTrackMapCache.set(doc, map);
  return map;
}
