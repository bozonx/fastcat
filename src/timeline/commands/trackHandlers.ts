import type { TimelineDocument, TimelineTrack } from '../types';
import type {
  AddTrackCommand,
  RenameTrackCommand,
  DeleteTrackCommand,
  ReorderTracksCommand,
  UpdateTrackPropertiesCommand,
  TimelineCommandResult,
} from '../commands';
import { getTrackById, nextTrackId, normalizeTrackOrder } from './utils';

export function addTrack(doc: TimelineDocument, cmd: AddTrackCommand): TimelineCommandResult {
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

export function renameTrack(doc: TimelineDocument, cmd: RenameTrackCommand): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  if (track.name === cmd.name) return { next: doc };
  const nextTracks = doc.tracks.map((t) => (t.id === track.id ? { ...t, name: cmd.name } : t));
  return { next: { ...doc, tracks: nextTracks } };
}

export function deleteTrack(doc: TimelineDocument, cmd: DeleteTrackCommand): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  if (track.items.length > 0 && !cmd.allowNonEmpty) {
    throw new Error('Track is not empty');
  }
  const nextTracks = doc.tracks.filter((t) => t.id !== track.id);
  return { next: { ...doc, tracks: nextTracks } };
}

export function reorderTracks(
  doc: TimelineDocument,
  cmd: ReorderTracksCommand,
): TimelineCommandResult {
  const nextTracks = normalizeTrackOrder(doc, cmd.trackIds);
  return { next: { ...doc, tracks: nextTracks } };
}

export function updateTrackProperties(
  doc: TimelineDocument,
  cmd: UpdateTrackPropertiesCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);

  const nextTracks = doc.tracks.map((t) => {
    if (t.id !== track.id) return t;

    const next: TimelineTrack = {
      ...t,
      ...cmd.properties,
    };

    if (next.kind !== 'video') {
      next.videoHidden = undefined;
    }
    if (next.kind !== 'audio') {
      next.audioMuted = undefined;
      next.audioSolo = undefined;
    }

    return next;
  });

  return { next: { ...doc, tracks: nextTracks } };
}
