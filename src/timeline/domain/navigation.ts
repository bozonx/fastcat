import type { TimelineDocument } from '../types';
import { selectTimelineDurationUs } from '../selectors';

export function getBoundaryTimesUs(
  doc: TimelineDocument,
  trackFilter: ((trackId: string) => boolean) | null,
): number[] {
  const boundaries: number[] = [];
  for (const track of doc.tracks) {
    if (trackFilter && !trackFilter(track.id)) continue;
    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      const startUs = Math.max(0, Math.round(it.timelineRange.startUs));
      const endUs = Math.max(0, Math.round(it.timelineRange.startUs + it.timelineRange.durationUs));
      boundaries.push(startUs, endUs);
    }
  }

  boundaries.sort((a, b) => a - b);
  return Array.from(new Set(boundaries));
}

export function calculatePrevClipBoundary(
  doc: TimelineDocument,
  currentTimeUs: number,
  options?: { currentTrackOnly?: boolean; currentTrackId?: string | null },
): number | null {
  const currentTrackOnly = Boolean(options?.currentTrackOnly);
  const trackId = currentTrackOnly ? options?.currentTrackId : null;
  if (currentTrackOnly && !trackId) return null;

  const boundaries = getBoundaryTimesUs(doc, trackId ? (id) => id === trackId : null);
  if (boundaries.length === 0) return null;

  let prev: number | null = null;
  for (const b of boundaries) {
    if (b >= currentTimeUs) break;
    prev = b;
  }

  return prev;
}

export function calculateNextClipBoundary(
  doc: TimelineDocument,
  currentTimeUs: number,
  durationUs: number,
  options?: { currentTrackOnly?: boolean; currentTrackId?: string | null },
): number {
  const currentTrackOnly = Boolean(options?.currentTrackOnly);
  const trackId = currentTrackOnly ? options?.currentTrackId : null;
  if (currentTrackOnly && !trackId) return currentTimeUs; // Do nothing if track missing

  const boundaries = getBoundaryTimesUs(doc, trackId ? (id) => id === trackId : null);
  if (boundaries.length === 0) return currentTimeUs; // Do nothing if no boundaries

  const next = boundaries.find((b) => b > currentTimeUs) ?? null;

  if (next === null) {
    const endFromState = Number.isFinite(durationUs) && durationUs > 0 ? Math.max(0, Math.round(durationUs)) : 0;
    const end = endFromState > 0 ? endFromState : Math.max(0, Math.round(selectTimelineDurationUs(doc)));
    return end;
  }

  return next;
}
