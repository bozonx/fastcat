import type { TimelineClipItem, TimelineDocument, TimelineGapItem, TimelineTrack, TimelineTrackItem } from './types';

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

export interface DeleteItemsCommand {
  type: 'delete_items';
  trackId: string;
  itemIds: string[];
}

export type TimelineCommand =
  | AddClipToTrackCommand
  | RemoveItemCommand
  | MoveItemCommand
  | TrimItemCommand
  | DeleteItemsCommand;

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
  return `${prefix}_${trackId}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
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

function mergeAdjacentGaps(items: TimelineTrackItem[]): TimelineTrackItem[] {
  if (items.length < 2) return items;
  const result: TimelineTrackItem[] = [];
  let current: TimelineTrackItem | undefined = items[0];

  for (let i = 1; i < items.length; i++) {
    const next = items[i];
    if (current && next && current.kind === 'gap' && next.kind === 'gap') {
      current = {
        ...current,
        timelineRange: {
          ...current.timelineRange,
          durationUs: (next.timelineRange.startUs + next.timelineRange.durationUs) - current.timelineRange.startUs
        }
      };
    } else {
      if (current) result.push(current);
      current = next;
    }
  }
  if (current) result.push(current);
  return result;
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

  if (cmd.type === 'remove_item' || cmd.type === 'delete_items') {
    const track = getTrackById(doc, cmd.trackId);
    const idsToRemove = cmd.type === 'delete_items' ? cmd.itemIds : [cmd.itemId];
    
    let nextItems = [...track.items];
    let itemsRemoved = false;

    for (const itemId of idsToRemove) {
      const idx = nextItems.findIndex(x => x.id === itemId);
      if (idx === -1) continue;

      const item = nextItems[idx];
      itemsRemoved = true;

      if (item.kind === 'clip') {
        // If it's a clip, check if there's anything after it
        const hasSomethingAfter = nextItems.some(it => it.timelineRange.startUs > item.timelineRange.startUs);
        if (hasSomethingAfter) {
          // Create Gap
          const gap: TimelineGapItem = {
            kind: 'gap',
            id: nextItemId(track.id, 'gap'),
            trackId: track.id,
            timelineRange: { ...item.timelineRange }
          };
          nextItems[idx] = gap;
        } else {
          // Last item, just remove
          nextItems.splice(idx, 1);
        }
      } else if (item.kind === 'gap') {
        // For gap - ripple delete: remove it and shift everything after it to the left
        const gapDuration = item.timelineRange.durationUs;
        nextItems.splice(idx, 1);
        nextItems = nextItems.map(it => {
          if (it.timelineRange.startUs > item.timelineRange.startUs) {
            return {
              ...it,
              timelineRange: {
                ...it.timelineRange,
                startUs: it.timelineRange.startUs - gapDuration
              }
            };
          }
          return it;
        });
      }
    }

    if (!itemsRemoved) return { next: doc };

    nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    nextItems = mergeAdjacentGaps(nextItems);

    const nextTracks = doc.tracks.map(t => (t.id === track.id ? { ...t, items: nextItems } : t));
    return { next: { ...doc, tracks: nextTracks } };
  }

  if (cmd.type === 'move_item') {
    const track = getTrackById(doc, cmd.trackId);
    const item = track.items.find(x => x.id === cmd.itemId);
    if (!item || !item.timelineRange) return { next: doc };

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
    if (!item || !item.timelineRange) return { next: doc };
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
