import type { TimelineDocument } from '../types';
import { selectTimelineDurationTicks } from '../selectors';

export function getBoundaryTimesTicks(
  doc: TimelineDocument,
  trackFilter: ((trackId: string) => boolean) | null,
): number[] {
  const boundaries: number[] = [];
  for (const track of doc.tracks) {
    if (trackFilter && !trackFilter(track.id)) continue;
    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      const startTicks = Math.max(0, Math.round(it.timelineRange.startTicks));
      const endTicks = Math.max(
        0,
        Math.round(it.timelineRange.startTicks + it.timelineRange.durationTicks),
      );
      boundaries.push(startTicks, endTicks);
    }
  }

  boundaries.sort((a, b) => a - b);
  return Array.from(new Set(boundaries));
}

export function calculatePrevClipBoundary(
  doc: TimelineDocument,
  currentTimeTicks: number,
  options?: { currentTrackOnly?: boolean; currentTrackId?: string | null },
): number | null {
  const currentTrackOnly = Boolean(options?.currentTrackOnly);
  const trackId = currentTrackOnly ? options?.currentTrackId : null;
  if (currentTrackOnly && !trackId) return null;

  const boundaries = getBoundaryTimesTicks(doc, trackId ? (id) => id === trackId : null);
  if (boundaries.length === 0) return null;

  let prev: number | null = null;
  for (const b of boundaries) {
    if (b >= currentTimeTicks) break;
    prev = b;
  }

  return prev;
}

export function calculateNextClipBoundary(
  doc: TimelineDocument,
  currentTimeTicks: number,
  durationTicks: number,
  options?: { currentTrackOnly?: boolean; currentTrackId?: string | null },
): number {
  const currentTrackOnly = Boolean(options?.currentTrackOnly);
  const trackId = currentTrackOnly ? options?.currentTrackId : null;
  if (currentTrackOnly && !trackId) return currentTimeTicks; // Do nothing if track missing

  const boundaries = getBoundaryTimesTicks(doc, trackId ? (id) => id === trackId : null);
  if (boundaries.length === 0) return currentTimeTicks; // Do nothing if no boundaries

  const next = boundaries.find((b) => b > currentTimeTicks) ?? null;

  if (next === null) {
    const endFromState =
      Number.isFinite(durationTicks) && durationTicks > 0
        ? Math.max(0, Math.round(durationTicks))
        : 0;
    const end =
      endFromState > 0 ? endFromState : Math.max(0, Math.round(selectTimelineDurationTicks(doc)));
    return end;
  }

  return next;
}
