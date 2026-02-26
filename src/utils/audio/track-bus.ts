import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import { mergeBalance, mergeGain } from '~/utils/audio/envelope';

export interface BuildEffectiveAudioClipItemsParams {
  audioTracks: TimelineTrack[];
  videoTracks: TimelineTrack[];
}

export function buildEffectiveAudioClipItems(
  params: BuildEffectiveAudioClipItemsParams,
): TimelineClipItem[] {
  const allAudioTracks = params.audioTracks;
  const allVideoTracks = params.videoTracks;

  const hasSolo = [...allAudioTracks, ...allVideoTracks].some((t) => Boolean(t.audioSolo));

  const effectiveAudioTracks = hasSolo
    ? allAudioTracks.filter((t) => Boolean(t.audioSolo))
    : allAudioTracks.filter((t) => !t.audioMuted);

  const effectiveVideoTracksForAudio = hasSolo
    ? allVideoTracks.filter((t) => Boolean(t.audioSolo))
    : allVideoTracks.filter((t) => !t.audioMuted);

  const result: TimelineClipItem[] = [];

  for (const track of effectiveAudioTracks) {
    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      if (item.clipType !== 'media' && item.clipType !== 'timeline') continue;
      if (!item.source?.path) continue;

      result.push({
        ...item,
        audioGain: mergeGain(track.audioGain, item.audioGain),
        audioBalance: mergeBalance(track.audioBalance, item.audioBalance),
      });
    }
  }

  const videoTrackIdsForAudio = new Set(effectiveVideoTracksForAudio.map((t) => t.id));
  for (const track of allVideoTracks) {
    if (!videoTrackIdsForAudio.has(track.id)) continue;

    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      if (item.clipType !== 'media' && item.clipType !== 'timeline') continue;
      if (item.audioFromVideoDisabled) continue;
      if (!item.source?.path) continue;

      result.push({
        ...item,
        id: `${item.id}__audio`,
        audioGain: mergeGain(track.audioGain, item.audioGain),
        audioBalance: mergeBalance(track.audioBalance, item.audioBalance),
      });
    }
  }

  return result;
}
