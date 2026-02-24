import type { TimelineDocument, TimelineClipItem, TimelineTrack } from '../types';
import type {
  ExtractAudioToTrackCommand,
  ReturnAudioToVideoCommand,
  TimelineCommandResult,
} from '../commands';
import { getTrackById, nextItemId, findClipById } from './utils';

export function extractAudioToTrack(
  doc: TimelineDocument,
  cmd: ExtractAudioToTrackCommand,
): TimelineCommandResult {
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
            it.kind === 'clip' && it.linkedVideoClipId === item.id && Boolean(it.lockToLinkedVideo),
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

export function returnAudioToVideo(
  doc: TimelineDocument,
  cmd: ReturnAudioToVideoCommand,
): TimelineCommandResult {
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
