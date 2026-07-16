import type {
  TimelineTrack,
  TimelineTrackItem,
  TimelineClipItem,
  ClipEffect,
} from '~/timeline/types';
import { mergeBalance, mergeGain } from '~/utils/audio/envelope';
import { cloneEffects } from '~/utils/video-editor/worker-clip-utils';
import { isImagePath } from '~/utils/media-types';

export interface BuildEffectiveAudioClipItemsParams {
  audioTracks: TimelineTrack[];
  videoTracks: TimelineTrack[];
  masterEffects?: ClipEffect[];
}

export interface EffectiveAudioClipItemsResult {
  items: TimelineTrackItem[];
  masterAudioEffects: ClipEffect[];
}

function getEffectiveClipAudioGain(item: TimelineClipItem): number {
  return item.audioFadesActive === false ? 1 : (item.audioGain ?? 1);
}

function getEffectiveClipAudioBalance(item: TimelineClipItem): number {
  return item.audioFadesActive === false ? 0 : (item.audioBalance ?? 0);
}

function getEffectiveClipAudioFadeProps(item: TimelineClipItem) {
  return item.audioFadesActive === false
    ? {
        audioFadeInTicks: undefined,
        audioFadeOutTicks: undefined,
        audioFadeInCurve: undefined,
        audioFadeOutCurve: undefined,
      }
    : {
        audioFadeInTicks: item.audioFadeInTicks,
        audioFadeOutTicks: item.audioFadeOutTicks,
        audioFadeInCurve: item.audioFadeInCurve,
        audioFadeOutCurve: item.audioFadeOutCurve,
      };
}

export function buildEffectiveAudioClipItems(
  params: BuildEffectiveAudioClipItemsParams,
): EffectiveAudioClipItemsResult {
  const allAudioTracks = params.audioTracks;
  const allVideoTracks = params.videoTracks;
  const masterAudioEffects = (params.masterEffects ?? []).filter((e) => e?.target === 'audio');

  const hasSolo = [...allAudioTracks, ...allVideoTracks].some((t) => Boolean(t.audioSolo));

  const effectiveAudioTracks = hasSolo
    ? allAudioTracks.filter((t) => Boolean(t.audioSolo))
    : allAudioTracks.filter((t) => !t.audioMuted);

  const effectiveVideoTracksForAudio = hasSolo
    ? allVideoTracks.filter((t) => Boolean(t.audioSolo))
    : allVideoTracks.filter((t) => !t.audioMuted);

  const items: TimelineTrackItem[] = [];

  for (const track of effectiveAudioTracks) {
    const trackAudioEffects = (track.effects ?? []).filter((e) => e?.target === 'audio');

    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      if (item.disabled || item.audioMuted) continue;
      const clipType = item.clipType ?? 'media';
      if (clipType !== 'media' && clipType !== 'timeline') continue;
      const path = item.source?.path;
      if (!path) continue;
      if (isImagePath(path)) continue;

      const itemEffects = Array.isArray(item.effects) ? cloneEffects(item.effects) : [];
      const combinedEffects = [...itemEffects];
      if (trackAudioEffects.length > 0) combinedEffects.push(...cloneEffects(trackAudioEffects));

      items.push({
        ...item,
        ...getEffectiveClipAudioFadeProps(item),
        clipType,
        source: { path },
        audioGain: mergeGain(track.audioGain, getEffectiveClipAudioGain(item)),
        audioBalance: mergeBalance(track.audioBalance, getEffectiveClipAudioBalance(item)),
        originalAudioGain: getEffectiveClipAudioGain(item),
        originalAudioBalance: getEffectiveClipAudioBalance(item),
        effects: combinedEffects.length > 0 ? combinedEffects : undefined,
      } as import('~/timeline/types').TimelineClipItem);
    }
  }

  const videoTrackIdsForAudio = new Set(effectiveVideoTracksForAudio.map((t) => t.id));
  for (const track of allVideoTracks) {
    if (!videoTrackIdsForAudio.has(track.id)) continue;

    const trackAudioEffects = (track.effects ?? []).filter((e) => e?.target === 'audio');

    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      if (item.disabled || item.audioMuted) continue;
      const clipType = item.clipType ?? 'media';
      if (clipType !== 'media' && clipType !== 'timeline') continue;
      const path = item.source?.path;
      if (!path) continue;
      if (isImagePath(path)) continue;

      const itemEffects = Array.isArray(item.effects) ? cloneEffects(item.effects) : [];
      const combinedEffects = [...itemEffects];
      if (trackAudioEffects.length > 0) combinedEffects.push(...cloneEffects(trackAudioEffects));

      items.push({
        ...item,
        ...getEffectiveClipAudioFadeProps(item),
        clipType,
        id: `${item.id}__audio`,
        source: { path },
        audioGain: mergeGain(track.audioGain, getEffectiveClipAudioGain(item)),
        audioBalance: mergeBalance(track.audioBalance, getEffectiveClipAudioBalance(item)),
        originalAudioGain: getEffectiveClipAudioGain(item),
        originalAudioBalance: getEffectiveClipAudioBalance(item),
        effects: combinedEffects.length > 0 ? combinedEffects : undefined,
      } as import('~/timeline/types').TimelineClipItem);
    }
  }

  return { items, masterAudioEffects: cloneEffects(masterAudioEffects) };
}
