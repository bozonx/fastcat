import type { TimelineDocument, TimelineClipItem, TimelineTrack } from '../types';
import type {
  ExtractAudioToTrackCommand,
  TimelineCommandResult,
} from '../commands';
import {
  getTrackById,
  nextItemId,
  rangesOverlap,
  nextTrackId,
  normalizeGaps,
  assertNoOverlap,
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

  const groupId = String(item.linkedGroupId ?? item.id);

  const existingLinked = doc.tracks.some((t) =>
    t.kind !== 'audio'
      ? false
      : t.items.some(
          (it) =>
            it.kind === 'clip' && it.linkedGroupId === groupId,
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
  const targetAudioTrack = nextTracks[targetAudioTrackIndex];
  if (!targetAudioTrack) throw new Error('Audio track not found');
  assertNoOverlap(targetAudioTrack, '', startUs, durationUs);

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
    linkedGroupId: groupId,
    effects: audioEffectsFromVideo.length > 0 ? [...audioEffectsFromVideo] : undefined,
    audioGain: item.audioGain,
    audioBalance: item.audioBalance,
    audioFadeInUs: item.audioFadeInUs,
    audioFadeOutUs: item.audioFadeOutUs,
    audioFadeInCurve: item.audioFadeInCurve,
    audioFadeOutCurve: item.audioFadeOutCurve,
    audioMuted: item.audioMuted,
    audioWaveformMode: item.audioWaveformMode,
    showWaveform: item.showWaveform,
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
            audioMuted: true,
            linkedGroupId: groupId,
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
