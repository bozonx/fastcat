import type {
  TimelineClipItem,
  TimelineDocument,
  TimelineGapItem,
  TimelineTrack,
  TimelineTrackItem,
} from './types';

const FALLBACK_FPS = 30;
const MIN_FPS = 1;
const MAX_FPS = 240;

function sanitizeFps(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return FALLBACK_FPS;
  const rounded = Math.round(parsed);
  if (rounded < MIN_FPS) return MIN_FPS;
  if (rounded > MAX_FPS) return MAX_FPS;
  return rounded;
}

function getDocFps(doc: TimelineDocument): number {
  return sanitizeFps((doc as any)?.timebase?.fps);
}

type QuantizeMode = 'round' | 'floor' | 'ceil';

function usToFrame(timeUs: number, fps: number, mode: QuantizeMode): number {
  const safeTimeUs = Number.isFinite(timeUs) ? Math.max(0, Math.round(timeUs)) : 0;
  const safeFps = sanitizeFps(fps);
  const framesFloat = (safeTimeUs * safeFps) / 1e6;
  if (mode === 'floor') return Math.max(0, Math.floor(framesFloat));
  if (mode === 'ceil') return Math.max(0, Math.ceil(framesFloat));
  return Math.max(0, Math.round(framesFloat));
}

function deltaUsToFrames(deltaUs: number, fps: number, mode: QuantizeMode): number {
  const safeDeltaUs = Number.isFinite(deltaUs) ? Math.round(deltaUs) : 0;
  const safeFps = sanitizeFps(fps);
  const framesFloat = (safeDeltaUs * safeFps) / 1e6;
  if (mode === 'floor') return Math.floor(framesFloat);
  if (mode === 'ceil') return Math.ceil(framesFloat);
  return Math.round(framesFloat);
}

function frameToUs(frameIndex: number, fps: number): number {
  const safeFrameIndex = Number.isFinite(frameIndex) ? Math.max(0, Math.round(frameIndex)) : 0;
  const safeFps = sanitizeFps(fps);
  return Math.max(0, Math.round((safeFrameIndex * 1e6) / safeFps));
}

function quantizeTimeUsToFrames(timeUs: number, fps: number, mode: QuantizeMode): number {
  return frameToUs(usToFrame(timeUs, fps, mode), fps);
}

function quantizeDeltaUsToFrames(deltaUs: number, fps: number, mode: QuantizeMode): number {
  const frames = deltaUsToFrames(deltaUs, fps, mode);
  return Math.round((frames * 1e6) / sanitizeFps(fps));
}

function quantizeRangeToFrames(
  range: { startUs: number; durationUs: number },
  fps: number,
): { startUs: number; durationUs: number } {
  const startFrame = usToFrame(range.startUs, fps, 'round');
  const durationFrames = usToFrame(range.durationUs, fps, 'round');
  const startUs = frameToUs(startFrame, fps);
  const endUs = frameToUs(startFrame + durationFrames, fps);
  return { startUs, durationUs: Math.max(0, endUs - startUs) };
}

export interface TimelineCommandResult {
  next: TimelineDocument;
}

function findClipById(
  doc: TimelineDocument,
  itemId: string,
): { track: TimelineTrack; item: TimelineClipItem } | null {
  for (const t of doc.tracks) {
    const it = t.items.find((x) => x.id === itemId);
    if (it && it.kind === 'clip') {
      return { track: t, item: it };
    }
  }
  return null;
}

function updateLinkedLockedAudio(
  doc: TimelineDocument,
  videoItemId: string,
  patch: (audio: TimelineClipItem) => TimelineClipItem,
): TimelineTrack[] {
  return doc.tracks.map((t) => {
    if (t.kind !== 'audio') return t;
    let changed = false;
    const nextItems = t.items.map((it) => {
      if (it.kind !== 'clip') return it;
      if (it.linkedVideoClipId !== videoItemId) return it;
      if (!it.lockToLinkedVideo) return it;
      changed = true;
      return patch(it);
    });
    return changed ? { ...t, items: nextItems } : t;
  });
}

export interface AddClipToTrackCommand {
  type: 'add_clip_to_track';
  trackId: string;
  name: string;
  path: string;
  durationUs?: number;
  sourceDurationUs?: number;
  startUs?: number;
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

export interface AddTrackCommand {
  type: 'add_track';
  kind: 'video' | 'audio';
  name: string;
  trackId?: string;
}

export interface RenameTrackCommand {
  type: 'rename_track';
  trackId: string;
  name: string;
}

export interface DeleteTrackCommand {
  type: 'delete_track';
  trackId: string;
  allowNonEmpty?: boolean;
}

export interface ReorderTracksCommand {
  type: 'reorder_tracks';
  trackIds: string[];
}

export interface MoveItemToTrackCommand {
  type: 'move_item_to_track';
  fromTrackId: string;
  toTrackId: string;
  itemId: string;
  startUs: number;
}

export interface ExtractAudioToTrackCommand {
  type: 'extract_audio_to_track';
  videoTrackId: string;
  videoItemId: string;
  audioTrackId: string;
}

export interface ReturnAudioToVideoCommand {
  type: 'return_audio_to_video';
  videoItemId: string;
}

export interface RenameItemCommand {
  type: 'rename_item';
  trackId: string;
  itemId: string;
  name: string;
}

export type TimelineCommand =
  | AddClipToTrackCommand
  | RemoveItemCommand
  | MoveItemCommand
  | TrimItemCommand
  | DeleteItemsCommand
  | AddTrackCommand
  | RenameTrackCommand
  | DeleteTrackCommand
  | ReorderTracksCommand
  | MoveItemToTrackCommand
  | ExtractAudioToTrackCommand
  | ReturnAudioToVideoCommand
  | RenameItemCommand;

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
    if (it.kind !== 'clip') continue;
    const itStart = it.timelineRange.startUs;
    const itEnd = itStart + it.timelineRange.durationUs;
    if (rangesOverlap(startUs, endUs, itStart, itEnd)) {
      throw new Error('Item overlaps with another item');
    }
  }
}

function normalizeGaps(
  doc: TimelineDocument,
  trackId: string,
  items: TimelineTrackItem[],
): TimelineTrackItem[] {
  const fps = getDocFps(doc);
  const clips = items
    .filter((it): it is TimelineClipItem => it.kind === 'clip')
    .map((it) => ({ ...it, timelineRange: { ...it.timelineRange } }));

  clips.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

  const result: TimelineTrackItem[] = [];
  let cursorUs = 0;

  for (const clip of clips) {
    const qTimeline = quantizeRangeToFrames(clip.timelineRange, fps);
    const startUs = qTimeline.startUs;
    const durationUs = qTimeline.durationUs;
    const endUs = startUs + durationUs;

    if (startUs > cursorUs) {
      const gapStartUs = cursorUs;
      const gapDurationUs = startUs - cursorUs;
      const gap: TimelineGapItem = {
        kind: 'gap',
        id: `gap_${trackId}_${gapStartUs}`,
        trackId,
        timelineRange: { startUs: gapStartUs, durationUs: gapDurationUs },
      };
      result.push(gap);
    }

    result.push({
      ...clip,
      timelineRange: { startUs, durationUs },
    });
    cursorUs = Math.max(cursorUs, endUs);
  }

  return mergeAdjacentGaps(result);
}

function getTrackById(doc: TimelineDocument, trackId: string): TimelineTrack {
  const t = doc.tracks.find((x) => x.id === trackId);
  if (!t) throw new Error('Track not found');
  return t;
}

function nextTrackId(doc: TimelineDocument, prefix: 'v' | 'a'): string {
  const ids = new Set(doc.tracks.map((t) => t.id));
  let n = 1;
  while (n < 10_000) {
    const id = `${prefix}${n}`;
    if (!ids.has(id)) return id;
    n += 1;
  }
  return `${prefix}${Date.now().toString(36)}`;
}

function normalizeTrackOrder(doc: TimelineDocument, trackIds: string[]): TimelineTrack[] {
  const byId = new Map(doc.tracks.map((t) => [t.id, t] as const));
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of trackIds) {
    if (!byId.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  for (const t of doc.tracks) {
    if (!seen.has(t.id)) {
      unique.push(t.id);
    }
  }

  const ordered = unique.map((id) => byId.get(id)!).filter(Boolean);
  const video = ordered.filter((t) => t.kind === 'video');
  const audio = ordered.filter((t) => t.kind === 'audio');
  return [...video, ...audio];
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
          durationUs:
            next.timelineRange.startUs +
            next.timelineRange.durationUs -
            current.timelineRange.startUs,
        },
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
  if (cmd.type === 'extract_audio_to_track') {
    const videoTrack = getTrackById(doc, cmd.videoTrackId);
    if (videoTrack.kind !== 'video') throw new Error('Invalid video track');
    const audioTrack = getTrackById(doc, cmd.audioTrackId);
    if (audioTrack.kind !== 'audio') throw new Error('Invalid audio track');

    const item = videoTrack.items.find((x) => x.id === cmd.videoItemId);
    if (!item || item.kind !== 'clip') throw new Error('Video clip not found');

    const existingLinked = doc.tracks.some((t) =>
      t.kind !== 'audio'
        ? false
        : t.items.some(
            (it) =>
              it.kind === 'clip' &&
              it.linkedVideoClipId === item.id &&
              Boolean(it.lockToLinkedVideo),
          ),
    );
    if (existingLinked) return { next: doc };

    const audioClip: TimelineClipItem = {
      kind: 'clip',
      id: nextItemId(audioTrack.id, 'clip'),
      trackId: audioTrack.id,
      name: item.name,
      source: { ...item.source },
      sourceDurationUs: item.sourceDurationUs,
      timelineRange: { ...item.timelineRange },
      sourceRange: { ...item.sourceRange },
      linkedVideoClipId: item.id,
      lockToLinkedVideo: true,
    };

    const nextTracks = doc.tracks.map((t) => {
      if (t.id === videoTrack.id) {
        return {
          ...t,
          items: t.items.map((it) =>
            it.id === item.id && it.kind === 'clip' ? { ...it, audioFromVideoDisabled: true } : it,
          ),
        };
      }
      if (t.id === audioTrack.id) {
        return { ...t, items: [...t.items, audioClip] };
      }
      return t;
    });

    return { next: { ...doc, tracks: nextTracks } };
  }

  if (cmd.type === 'return_audio_to_video') {
    const videoLoc = findClipById(doc, cmd.videoItemId);
    if (!videoLoc) throw new Error('Video clip not found');
    if (videoLoc.track.kind !== 'video') throw new Error('Video clip must be on a video track');

    const linkedAudio = doc.tracks
      .filter((t) => t.kind === 'audio')
      .flatMap((t) => t.items)
      .find(
        (it) =>
          it.kind === 'clip' &&
          it.linkedVideoClipId === cmd.videoItemId &&
          Boolean(it.lockToLinkedVideo),
      );
    if (!linkedAudio || linkedAudio.kind !== 'clip') return { next: doc };

    const nextTracks = doc.tracks.map((t) => {
      if (t.kind === 'audio') {
        const nextItems = t.items.filter((it) => it.id !== linkedAudio.id);
        return nextItems.length === t.items.length ? t : { ...t, items: nextItems };
      }
      if (t.kind === 'video') {
        return {
          ...t,
          items: t.items.map((it) =>
            it.kind === 'clip' && it.id === cmd.videoItemId
              ? { ...it, audioFromVideoDisabled: false }
              : it,
          ),
        };
      }
      return t;
    });

    return { next: { ...doc, tracks: nextTracks } };
  }

  if (cmd.type === 'add_track') {
    const idPrefix = cmd.kind === 'audio' ? 'a' : 'v';
    const id =
      typeof cmd.trackId === 'string' && cmd.trackId.trim().length > 0
        ? cmd.trackId.trim()
        : nextTrackId(doc, idPrefix);

    if (doc.tracks.some((t) => t.id === id)) {
      throw new Error('Track already exists');
    }

    const track: TimelineTrack = {
      id,
      kind: cmd.kind,
      name: cmd.name,
      items: [],
    };

    const existingVideo = doc.tracks.filter((t) => t.kind === 'video');
    const existingAudio = doc.tracks.filter((t) => t.kind === 'audio');

    let nextTracks: TimelineTrack[];
    if (cmd.kind === 'video') {
      nextTracks = [track, ...existingVideo, ...existingAudio];
    } else {
      nextTracks = [...existingVideo, ...existingAudio, track];
    }

    return {
      next: {
        ...doc,
        tracks: nextTracks,
      },
    };
  }

  if (cmd.type === 'rename_track') {
    const track = getTrackById(doc, cmd.trackId);
    if (track.name === cmd.name) return { next: doc };
    const nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, name: cmd.name } : t));
    return { next: { ...doc, tracks: nextTracks } };
  }

  if (cmd.type === 'rename_item') {
    const track = getTrackById(doc, cmd.trackId);
    const item = track.items.find((x) => x.id === cmd.itemId);
    if (!item || item.kind !== 'clip') throw new Error('Item not found or not a clip');
    if (item.name === cmd.name) return { next: doc };

    const nextTracks = doc.tracks.map((t) => {
      if (t.id === track.id) {
        return {
          ...t,
          items: t.items.map((it) =>
            it.id === cmd.itemId && it.kind === 'clip' ? { ...it, name: cmd.name } : it,
          ),
        };
      }
      return t;
    });
    return { next: { ...doc, tracks: nextTracks } };
  }

  if (cmd.type === 'delete_track') {
    const track = getTrackById(doc, cmd.trackId);
    if (track.items.length > 0 && !cmd.allowNonEmpty) {
      throw new Error('Track is not empty');
    }
    const nextTracks = doc.tracks.filter((t) => t.id !== track.id);
    return { next: { ...doc, tracks: nextTracks } };
  }

  if (cmd.type === 'reorder_tracks') {
    const nextTracks = normalizeTrackOrder(doc, cmd.trackIds);
    return { next: { ...doc, tracks: nextTracks } };
  }

  if (cmd.type === 'move_item_to_track') {
    const fromTrack = getTrackById(doc, cmd.fromTrackId);
    const toTrack = getTrackById(doc, cmd.toTrackId);

    if (fromTrack.id === toTrack.id) {
      return applyTimelineCommand(doc, {
        type: 'move_item',
        trackId: fromTrack.id,
        itemId: cmd.itemId,
        startUs: cmd.startUs,
      });
    }

    const itemIdx = fromTrack.items.findIndex((x) => x.id === cmd.itemId);
    if (itemIdx === -1) return { next: doc };
    const item = fromTrack.items[itemIdx];
    if (!item) return { next: doc };
    if (!item.timelineRange) return { next: doc };
    const isLockedLinkedAudio =
      item.kind === 'clip' && Boolean(item.linkedVideoClipId) && Boolean(item.lockToLinkedVideo);

    const startUs = quantizeTimeUsToFrames(cmd.startUs, getDocFps(doc), 'round');
    const durationUs = Math.max(0, item.timelineRange.durationUs);

    assertNoOverlap(toTrack, item.id, startUs, durationUs);

    const nextFromItemsRaw = [...fromTrack.items];
    nextFromItemsRaw.splice(itemIdx, 1);
    const movedItem: TimelineTrackItem = {
      ...item,
      trackId: toTrack.id,
      timelineRange: { ...item.timelineRange, startUs },
    };
    const nextToItemsRaw = [...toTrack.items, movedItem];
    nextToItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

    const nextFromItems = normalizeGaps(doc, fromTrack.id, nextFromItemsRaw);
    const nextToItems = normalizeGaps(doc, toTrack.id, nextToItemsRaw);

    let nextTracks = doc.tracks.map((t) => {
      if (t.id === fromTrack.id) return { ...t, items: nextFromItems };
      if (t.id === toTrack.id) return { ...t, items: nextToItems };
      return t;
    });

    if (isLockedLinkedAudio && item.kind === 'clip' && item.linkedVideoClipId) {
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
          return { ...t, items: normalizeGaps(doc, t.id, nextItems) };
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
    }

    return { next: { ...doc, tracks: nextTracks } };
  }

  if (cmd.type === 'add_clip_to_track') {
    const track = getTrackById(doc, cmd.trackId);
    const fps = getDocFps(doc);
    const durationUs = quantizeTimeUsToFrames(Number(cmd.durationUs ?? 0), fps, 'round');
    const sourceDurationUs = Math.max(
      0,
      Math.round(Number(cmd.sourceDurationUs ?? cmd.durationUs ?? 0)),
    );
    const startCandidate =
      cmd.startUs === undefined ? computeTrackEndUs(track) : Math.max(0, Number(cmd.startUs));
    const startUs = quantizeTimeUsToFrames(startCandidate, fps, 'round');

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

    const nextItemsRaw: TimelineTrackItem[] = [...track.items, clip];
    nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    const nextItems = normalizeGaps(doc, track.id, nextItemsRaw);

    const nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

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
      const idx = nextItems.findIndex((x) => x.id === itemId);
      if (idx === -1) continue;

      const item = nextItems[idx];
      if (!item) continue;
      itemsRemoved = true;

      if (item.kind === 'clip') {
        nextItems.splice(idx, 1);
      } else if (item.kind === 'gap') {
        // For gap - ripple delete: remove it and shift everything after it to the left
        const gapDuration = item.timelineRange.durationUs;
        const gapEndUs = item.timelineRange.startUs + gapDuration;
        nextItems.splice(idx, 1);
        nextItems = nextItems.map((it) => {
          if (it.timelineRange.startUs >= gapEndUs) {
            return {
              ...it,
              timelineRange: {
                ...it.timelineRange,
                startUs: it.timelineRange.startUs - gapDuration,
              },
            };
          }
          return it;
        });
      }
    }

    if (!itemsRemoved) return { next: doc };

    nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    nextItems = normalizeGaps(doc, track.id, nextItems);

    const nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));
    return { next: { ...doc, tracks: nextTracks } };
  }

  if (cmd.type === 'move_item') {
    const track = getTrackById(doc, cmd.trackId);
    const item = track.items.find((x) => x.id === cmd.itemId);
    if (!item || !item.timelineRange) return { next: doc };

    if (item.kind === 'clip' && item.linkedVideoClipId && item.lockToLinkedVideo) {
      const linked = findClipById(doc, item.linkedVideoClipId);
      if (!linked) return { next: doc };
      if (linked.track.kind !== 'video') return { next: doc };

      const startUs = quantizeTimeUsToFrames(cmd.startUs, getDocFps(doc), 'round');
      const durationUs = Math.max(0, linked.item.timelineRange.durationUs);

      assertNoOverlap(linked.track, linked.item.id, startUs, durationUs);

      let nextTracks = doc.tracks.map((t) => {
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
        return { ...t, items: normalizeGaps(doc, t.id, nextItems) };
      });

      nextTracks = updateLinkedLockedAudio(
        { ...doc, tracks: nextTracks },
        linked.item.id,
        (audio) => ({
          ...audio,
          timelineRange: { ...audio.timelineRange, startUs },
        }),
      );

      return { next: { ...doc, tracks: nextTracks } };
    }

    const startUs = quantizeTimeUsToFrames(cmd.startUs, getDocFps(doc), 'round');
    const durationUs = Math.max(0, item.timelineRange.durationUs);

    assertNoOverlap(track, item.id, startUs, durationUs);

    const nextItemsRaw: TimelineTrackItem[] = track.items.map((x) =>
      x.id === item.id
        ? {
            ...x,
            timelineRange: { ...x.timelineRange, startUs },
          }
        : x,
    );

    nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    const nextItems = normalizeGaps(doc, track.id, nextItemsRaw);

    let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

    if (item.kind === 'clip' && track.kind === 'video') {
      nextTracks = updateLinkedLockedAudio({ ...doc, tracks: nextTracks }, item.id, (audio) => ({
        ...audio,
        timelineRange: { ...audio.timelineRange, startUs },
      }));
    }

    return { next: { ...doc, tracks: nextTracks } };
  }

  if (cmd.type === 'trim_item') {
    const track = getTrackById(doc, cmd.trackId);
    const item = track.items.find((x) => x.id === cmd.itemId);
    if (!item || !item.timelineRange) return { next: doc };
    if (item.kind !== 'clip') return { next: doc };
    if (item.linkedVideoClipId && item.lockToLinkedVideo) {
      throw new Error('Locked audio clip');
    }

    const fps = getDocFps(doc);
    const deltaUs = quantizeDeltaUsToFrames(Number(cmd.deltaUs), fps, 'round');

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

    const qTimeline = quantizeRangeToFrames(
      { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
      fps,
    );

    nextTimelineStartUs = qTimeline.startUs;
    nextTimelineDurationUs = qTimeline.durationUs;

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
    const nextItems = normalizeGaps(doc, track.id, nextItemsRaw);

    let nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, items: nextItems } : t));

    if (track.kind === 'video') {
      nextTracks = updateLinkedLockedAudio({ ...doc, tracks: nextTracks }, item.id, (audio) => ({
        ...audio,
        timelineRange: { startUs: nextTimelineStartUs, durationUs: nextTimelineDurationUs },
        sourceRange: { startUs: nextSourceStartUs, durationUs: nextSourceDurationUs },
        sourceDurationUs: item.sourceDurationUs,
      }));
    }

    return { next: { ...doc, tracks: nextTracks } };
  }

  return { next: doc };
}
