import type { TimelineTrack, TimelineTrackItem, ClipEffect } from '~/timeline/types';
import { mergeBalance, mergeGain } from '~/utils/audio/envelope';
import { cloneEffects } from '~/utils/video-editor/worker-clip-utils';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);
const SVG_EXT = new Set(['svg']);

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i + 1).toLowerCase() : '';
}

function isImageOrSvgPath(path: string): boolean {
  const ext = extOf(path);
  return IMAGE_EXT.has(ext) || SVG_EXT.has(ext);
}

export interface BuildEffectiveAudioClipItemsParams {
  audioTracks: TimelineTrack[];
  videoTracks: TimelineTrack[];
  masterEffects?: ClipEffect[];
}

export function buildEffectiveAudioClipItems(
  params: BuildEffectiveAudioClipItemsParams,
): TimelineTrackItem[] {
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

  const result: TimelineTrackItem[] = [];

  for (const track of effectiveAudioTracks) {
    const trackAudioEffects = (track.effects ?? []).filter((e) => e?.target === 'audio');

    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      if (item.disabled || item.audioMuted) continue;
      const clipType = item.clipType ?? 'media';
      if (clipType !== 'media' && clipType !== 'timeline') continue;
      const path = item.source?.path;
      if (!path) continue;
      if (isImageOrSvgPath(path)) continue;

      const itemEffects = Array.isArray(item.effects) ? cloneEffects(item.effects) : [];
      const combinedEffects = [...itemEffects];
      if (trackAudioEffects.length > 0) combinedEffects.push(...cloneEffects(trackAudioEffects));
      if (masterAudioEffects.length > 0) combinedEffects.push(...cloneEffects(masterAudioEffects));

      result.push({
        ...item,
        clipType,
        source: { path },
        audioGain: mergeGain(track.audioGain, item.audioGain),
        audioBalance: mergeBalance(track.audioBalance, item.audioBalance),
        originalAudioGain: item.audioGain,
        originalAudioBalance: item.audioBalance,
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
      if (isImageOrSvgPath(path)) continue;

      const itemEffects = Array.isArray(item.effects) ? cloneEffects(item.effects) : [];
      const combinedEffects = [...itemEffects];
      if (trackAudioEffects.length > 0) combinedEffects.push(...cloneEffects(trackAudioEffects));
      if (masterAudioEffects.length > 0) combinedEffects.push(...cloneEffects(masterAudioEffects));

      result.push({
        ...item,
        clipType,
        id: `${item.id}__audio`,
        source: { path },
        audioGain: mergeGain(track.audioGain, item.audioGain),
        audioBalance: mergeBalance(track.audioBalance, item.audioBalance),
        originalAudioGain: item.audioGain,
        originalAudioBalance: item.audioBalance,
        effects: combinedEffects.length > 0 ? combinedEffects : undefined,
      } as import('~/timeline/types').TimelineClipItem);
    }
  }

  return result;
}
