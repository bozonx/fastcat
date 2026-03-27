import type { TimelineDocument, TimelineClipItem, TimelineTrack } from '../types';
import type {
  ExtractAudioToTrackCommand,
  ReturnAudioToVideoCommand,
  TimelineCommandResult,
} from '../commands';
import {
  getTrackById,
  nextItemId,
  findClipById,
  rangesOverlap,
  nextTrackId,
  normalizeGaps,
} from './utils';

export function extractAudioToTrack(
  doc: TimelineDocument,
  cmd: ExtractAudioToTrackCommand,
): TimelineCommandResult {
  const videoTrack = getTrackById(doc, cmd.videoTrackId);
  if (videoTrack.kind !== 'video') throw new Error('Invalid video track');

  if (cmd.audioTrackId) {
    const audioTrack = getTrackById(doc, cmd.audioTrackId);
    if (audioTrack.kind !== 'audio') throw new Error('Invalid audio track');
  }

  const item = videoTrack.items.find((x) => x.id === cmd.videoItemId);
  if (!item || item.kind !== 'clip') throw new Error('Video clip not found');

  if (item.clipType !== 'media' && item.clipType !== 'timeline') {
    throw new Error('Invalid clip type');
  }

  if (!item.source) {
    throw new Error('Video clip source is missing');
  }

  const existingLinked = doc.tracks.some((t) =>
    t.kind !== 'audio'
      ? false
      : t.items.some(
          (it) =>
            it.kind === 'clip' && it.linkedVideoClipId === item.id && Boolean(it.lockToLinkedVideo),
        ),
  );
  if (existingLinked) return { next: doc };

  const audioEffectsFromVideo = (item.effects ?? []).filter((e) => e?.target === 'audio');

  const startUs = item.timelineRange.startUs;
  const durationUs = item.timelineRange.durationUs;
  const endUs = startUs + durationUs;

  let targetAudioTrackId: string | undefined = cmd.audioTrackId;

  if (!targetAudioTrackId) {
    for (const t of doc.tracks) {
      if (t.kind === 'audio') {
        let hasOverlap = false;
        for (const it of t.items) {
          if (it.kind !== 'clip') continue;
          const itStart = it.timelineRange.startUs;
          const itEnd = itStart + it.timelineRange.durationUs;
          if (rangesOverlap(startUs, endUs, itStart, itEnd)) {
            hasOverlap = true;
            break;
          }
        }
        if (!hasOverlap) {
          targetAudioTrackId = t.id;
          break;
        }
      }
    }
  }

  let nextTracks = [...doc.tracks];

  if (!targetAudioTrackId) {
    targetAudioTrackId = nextTrackId(doc, 'a');
    let numAudioTracks = 0;
    let lastAudioTrackIndex = -1;
    for (let i = 0; i < nextTracks.length; i++) {
      const tr = nextTracks[i];
      if (tr?.kind === 'audio') {
        numAudioTracks++;
        lastAudioTrackIndex = i;
      }
    }
    const newTrack: TimelineTrack = {
      id: targetAudioTrackId,
      kind: 'audio',
      name: `Audio ${numAudioTracks + 1}`,
      items: [],
    };
    if (lastAudioTrackIndex !== -1) {
      nextTracks.splice(lastAudioTrackIndex + 1, 0, newTrack);
    } else {
      nextTracks.push(newTrack);
    }
  }

  const targetAudioTrackIndex = nextTracks.findIndex((t) => t.id === targetAudioTrackId);
  if (targetAudioTrackIndex === -1) throw new Error('Audio track not found');

  const audioClip: TimelineClipItem = {
    kind: 'clip',
    id: nextItemId(targetAudioTrackId, 'clip'),
    trackId: targetAudioTrackId,
    clipType: item.clipType,
    name: item.name,
    source: { ...item.source },
    sourceDurationUs: item.sourceDurationUs,
    timelineRange: { ...item.timelineRange },
    sourceRange: { ...item.sourceRange },
    linkedGroupId: String((item as any).linkedGroupId ?? item.id),
    linkedVideoClipId: item.id,
    lockToLinkedVideo: true,
    effects: audioEffectsFromVideo.length > 0 ? [...audioEffectsFromVideo] : undefined,
  };

  nextTracks = nextTracks.map((t) => {
    if (t.id === videoTrack.id) {
      return {
        ...t,
        items: t.items.map((it) => {
          if (it.id !== item.id || it.kind !== 'clip') return it;
          const videoOnlyEffects = (it.effects ?? []).filter((e) => e?.target !== 'audio');
          return {
            ...it,
            audioFromVideoDisabled: true,
            linkedGroupId: String((it as any).linkedGroupId ?? it.id),
            effects: videoOnlyEffects.length > 0 ? videoOnlyEffects : undefined,
          };
        }),
      };
    }
    if (t.id === targetAudioTrackId) {
      const nextItems = [...t.items, audioClip];
      nextItems.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
      return { ...t, items: normalizeGaps(doc, t.id, nextItems, { quantizeToFrames: false }) };
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
    ) as TimelineClipItem | undefined;

  const audioEffectsToReturn = linkedAudio
    ? (linkedAudio.effects ?? []).filter((e) => e?.target === 'audio')
    : [];

  const nextTracks = doc.tracks.map((t) => {
    if (linkedAudio && t.kind === 'audio') {
      const nextItems = t.items.filter((it) => it.id !== linkedAudio.id);
      return nextItems.length === t.items.length ? t : { ...t, items: nextItems };
    }
    if (t.kind === 'video') {
      return {
        ...t,
        items: t.items.map((it) => {
          if (it.kind !== 'clip' || it.id !== cmd.videoItemId) return it;
          const existingVideoEffects = (it.effects ?? []).filter((e) => e?.target !== 'audio');
          const mergedEffects = [...existingVideoEffects, ...audioEffectsToReturn];
          return {
            ...it,
            audioFromVideoDisabled: false,
            effects: mergedEffects.length > 0 ? mergedEffects : undefined,
          };
        }),
      };
    }
    return t;
  });

  return { next: { ...doc, tracks: nextTracks } };
}
