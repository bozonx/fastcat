import type { TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import { mergeBalance, mergeGain } from '~/utils/audio/envelope';

export interface BuildEffectiveAudioClipItemsParams {
  audioTracks: TimelineTrack[];
  videoTracks: TimelineTrack[];
}

export function buildEffectiveAudioClipItems(
  params: BuildEffectiveAudioClipItemsParams,
): TimelineTrackItem[] {
  const allAudioTracks = params.audioTracks;
  const allVideoTracks = params.videoTracks;

  const hasSolo = [...allAudioTracks, ...allVideoTracks].some((t) => Boolean(t.audioSolo));

  const effectiveAudioTracks = hasSolo
    ? allAudioTracks.filter((t) => Boolean(t.audioSolo))
    : allAudioTracks.filter((t) => !t.audioMuted);

  const effectiveVideoTracksForAudio = hasSolo
    ? allVideoTracks.filter((t) => Boolean(t.audioSolo))
    : allVideoTracks.filter((t) => !t.audioMuted);

  const result: TimelineTrackItem[] = [];

  for (const track of effectiveAudioTracks) {
    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      if (item.disabled || item.audioMuted) continue;
      const clipType = item.clipType ?? 'media';
      if (clipType !== 'media' && clipType !== 'timeline') continue;
      const path = item.source?.path;
      if (!path) continue;

      result.push({
        ...item,
        clipType,
        source: { path },
        audioGain: mergeGain(track.audioGain, item.audioGain),
        audioBalance: mergeBalance(track.audioBalance, item.audioBalance),
      } as import('~/timeline/types').TimelineClipItem);
    }
  }

  const videoTrackIdsForAudio = new Set(effectiveVideoTracksForAudio.map((t) => t.id));
  for (const track of allVideoTracks) {
    if (!videoTrackIdsForAudio.has(track.id)) continue;

    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      if (item.disabled || item.audioMuted) continue;
      const clipType = item.clipType ?? 'media';
      if (clipType !== 'media' && clipType !== 'timeline') continue;
      if (item.audioFromVideoDisabled) continue;
      const path = item.source?.path;
      if (!path) continue;

      result.push({
        ...item,
        clipType,
        id: `${item.id}__audio`,
        source: { path },
        audioGain: mergeGain(track.audioGain, item.audioGain),
        audioBalance: mergeBalance(track.audioBalance, item.audioBalance),
      } as import('~/timeline/types').TimelineClipItem);
    }
  }

  return result;
}
