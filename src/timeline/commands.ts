import type { TimelineClipItem, TimelineDocument, TimelineTrack, TimelineTrackItem } from './types';

export interface TimelineCommandResult {
  next: TimelineDocument;
}

export interface AddClipToTrackCommand {
  type: 'add_clip_to_track';
  trackId: string;
  name: string;
  path: string;
  durationUs?: number;
  sourceDurationUs?: number;
}

export interface RemoveItemCommand {
  type: 'remove_item';
  trackId: string;
  itemId: string;
}

export interface MoveItemCommand {
  type: 'move_item';
  trackId: string;
  itemId: string;
  startUs: number;
}

export interface TrimItemCommand {
  type: 'trim_item';
  trackId: string;
  itemId: string;
  edge: 'start' | 'end';
  deltaUs: number;
}

export type TimelineCommand =
  | AddClipToTrackCommand
  | RemoveItemCommand
  | MoveItemCommand
  | TrimItemCommand;

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function assertNoOverlap(
  track: TimelineTrack,
  movedItemId: string,
  startUs: number,
  durationUs: number,
) {
  const endUs = startUs + durationUs;
  for (const it of track.items) {
    if (it.id === movedItemId) continue;
    const itStart = it.timelineRange.startUs;
    const itEnd = itStart + it.timelineRange.durationUs;
    if (rangesOverlap(startUs, endUs, itStart, itEnd)) {
      throw new Error('Item overlaps with another item');
    }
  }
}

function getTrackById(doc: TimelineDocument, trackId: string): TimelineTrack {
  const t = doc.tracks.find(x => x.id === trackId);
  if (!t) throw new Error('Track not found');
  return t;
}

function nextItemId(trackId: string, prefix: string): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${prefix}_${trackId}_${cryptoObj.randomUUID()}`;
  }
  return `${prefix}_${trackId}_${Date.now().toString(36)}`;
}

function computeTrackEndUs(track: TimelineTrack): number {
  let end = 0;
  for (const it of track.items) {
    end = Math.max(end, it.timelineRange.startUs + it.timelineRange.durationUs);
  }
  return end;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function applyTimelineCommand(
  doc: TimelineDocument,
  cmd: TimelineCommand,
): TimelineCommandResult {
  if (cmd.type === 'add_clip_to_track') {
    const track = getTrackById(doc, cmd.trackId);
    const durationUs = Math.max(0, Math.round(Number(cmd.durationUs ?? 0)));
    const sourceDurationUs = Math.max(
      0,
      Math.round(Number(cmd.sourceDurationUs ?? cmd.durationUs ?? 0)),
    );
    const startUs = computeTrackEndUs(track);

    assertNoOverlap(track, '', startUs, durationUs);

    const clip: TimelineClipItem = {
      kind: 'clip',
      id: nextItemId(track.id, 'clip'),
      trackId: track.id,
      name: cmd.name,
      source: { path: cmd.path },
      sourceDurationUs,
      timelineRange: { startUs, durationUs },
      sourceRange: { startUs: 0, durationUs },
    };

    const nextTracks = doc.tracks.map(t =>
      t.id === track.id ? { ...t, items: [...t.items, clip] } : t,
    );

    return {
      next: {
        ...doc,
        tracks: nextTracks,
      },
    };
  }

  if (cmd.type === 'remove_item') {
    const track = getTrackById(doc, cmd.trackId);
    const nextItems = track.items.filter(x => x.id !== cmd.itemId);
    if (nextItems.length === track.items.length) return { next: doc };

    const nextTracks = doc.tracks.map(t => (t.id === track.id ? { ...t, items: nextItems } : t));
    return { next: { ...doc, tracks: nextTracks } };
  }

  if (cmd.type === 'move_item') {
    const track = getTrackById(doc, cmd.trackId);
    const item = track.items.find(x => x.id === cmd.itemId);
    if (!item) return { next: doc };

    const startUs = Math.max(0, Math.round(cmd.startUs));
    const durationUs = Math.max(0, item.timelineRange.durationUs);

    assertNoOverlap(track, item.id, startUs, durationUs);

    const nextItems: TimelineTrackItem[] = track.items.map(x =>
      x.id === item.id
        ? {
            ...x,
            timelineRange: { ...x.timelineRange, startUs },
          }
        : x,
    );

    nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

    const nextTracks = doc.tracks.map(t => (t.id === track.id ? { ...t, items: nextItems } : t));
    return { next: { ...doc, tracks: nextTracks } };
  }

  if (cmd.type === 'trim_item') {
    const track = getTrackById(doc, cmd.trackId);
    const item = track.items.find(x => x.id === cmd.itemId);
    if (!item) return { next: doc };
    if (item.kind !== 'clip') return { next: doc };

    const deltaUs = Math.round(Number(cmd.deltaUs));

    const prevTimelineStartUs = Math.max(0, Math.round(item.timelineRange.startUs));
    const prevTimelineDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

    const prevSourceStartUs = Math.max(0, Math.round(item.sourceRange.startUs));
    const prevSourceDurationUs = Math.max(0, Math.round(item.sourceRange.durationUs));

    const prevSourceEndUs = prevSourceStartUs + prevSourceDurationUs;
    const maxSourceDurationUs = Math.max(0, Math.round(item.sourceDurationUs));

    const minSourceStartUs = 0;
    const maxSourceEndUs = maxSourceDurationUs;

    let nextTimelineStartUs = prevTimelineStartUs;
    let nextTimelineDurationUs = prevTimelineDurationUs;
    let nextSourceStartUs = prevSourceStartUs;
    let nextSourceEndUs = prevSourceEndUs;

    if (cmd.edge === 'start') {
      // deltaUs > 0 => move start right (trim in), deltaUs < 0 => move start left (extend)
      const unclampedSourceStartUs = prevSourceStartUs + deltaUs;
      nextSourceStartUs = clampInt(unclampedSourceStartUs, minSourceStartUs, prevSourceEndUs);
      const appliedDeltaUs = nextSourceStartUs - prevSourceStartUs;

      nextTimelineStartUs = Math.max(0, prevTimelineStartUs + appliedDeltaUs);
      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs - appliedDeltaUs);
      nextSourceEndUs = prevSourceEndUs;
    } else {
      // deltaUs > 0 => move end right (extend), deltaUs < 0 => move end left (trim out)
      const unclampedSourceEndUs = prevSourceEndUs + deltaUs;
      nextSourceEndUs = clampInt(unclampedSourceEndUs, prevSourceStartUs, maxSourceEndUs);
      const appliedDeltaUs = nextSourceEndUs - prevSourceEndUs;

      nextTimelineDurationUs = Math.max(0, prevTimelineDurationUs + appliedDeltaUs);
      nextTimelineStartUs = prevTimelineStartUs;
      nextSourceStartUs = prevSourceStartUs;
    }

    const nextSourceDurationUs = Math.max(0, nextSourceEndUs - nextSourceStartUs);

    assertNoOverlap(track, item.id, nextTimelineStartUs, nextTimelineDurationUs);

    const nextItems: TimelineTrackItem[] = track.items.map(x =>
      x.id === item.id
        ? {
            ...x,
            timelineRange: { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
            sourceRange: { startUs: nextSourceStartUs, durationUs: nextSourceDurationUs },
          }
        : x,
    );

    nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    const nextTracks = doc.tracks.map(t => (t.id === track.id ? { ...t, items: nextItems } : t));
    return { next: { ...doc, tracks: nextTracks } };
  }

  return { next: doc };
}
