import type { TimelineDocument, TimelineTrackItem, TrackKind } from './types';

export function selectTrack(doc: TimelineDocument, trackId: string) {
  return doc.tracks.find((t) => t.id === trackId) ?? null;
}

export function selectTracksByKind(doc: TimelineDocument, kind: TrackKind) {
  return doc.tracks.filter((t) => t.kind === kind);
}

export function selectAllItems(doc: TimelineDocument): TimelineTrackItem[] {
  return doc.tracks.flatMap((t) => t.items);
}

export function selectTimelineDurationUs(doc: TimelineDocument): number {
  let maxEnd = 0;
  for (const t of doc.tracks) {
    for (const it of t.items) {
      maxEnd = Math.max(maxEnd, it.timelineRange.startUs + it.timelineRange.durationUs);
    }
  }
  return maxEnd;
}
