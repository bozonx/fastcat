import { sanitizeFps } from '~/timeline/commands/utils';
import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';
import type { MultiSelectionItemRef, MultiSelectionState } from './types';

export function isClipFreePosition(clip: TimelineClipItem, doc: TimelineDocument | null): boolean {
  if (!doc) return false;

  const fps = sanitizeFps((doc as any)?.timebase?.fps);
  const startFrame = (clip.timelineRange.startUs * fps) / 1_000_000;
  const durFrame = (clip.timelineRange.durationUs * fps) / 1_000_000;
  const isStartQuantized = Math.abs(startFrame - Math.round(startFrame)) < 0.001;
  const isDurationQuantized = Math.abs(durFrame - Math.round(durFrame)) < 0.001;

  return !isStartQuantized || !isDurationQuantized;
}

export function collectMultiSelectionState(
  doc: TimelineDocument | null,
  selectedItemIds: string[],
): MultiSelectionState {
  const selectedClips: TimelineClipItem[] = [];
  const itemsToUpdate: MultiSelectionItemRef[] = [];

  if (doc) {
    for (const track of doc.tracks) {
      for (const item of track.items) {
        if (!selectedItemIds.includes(item.id)) continue;

        if (item.kind === 'clip') {
          selectedClips.push(item as TimelineClipItem);
        }

        itemsToUpdate.push({ trackId: track.id, itemId: item.id });
      }
    }
  }

  const selectedIds = new Set(selectedItemIds);
  const selectedVideoIds: string[] = [];

  if (doc) {
    for (const track of doc.tracks) {
      if (track.kind !== 'video') continue;

      for (const item of track.items) {
        if (item.kind !== 'clip') continue;
        if (!selectedIds.has(item.id)) continue;

        selectedVideoIds.push(item.id);
      }
    }
  }

  const hasLockedLinks = (() => {
    if (!doc) return false;

    for (const track of doc.tracks) {
      for (const item of track.items) {
        if (!selectedIds.has(item.id)) continue;
        if (item.kind !== 'clip') continue;

        if (
          track.kind === 'audio' &&
          Boolean((item as any).linkedVideoClipId) &&
          Boolean((item as any).lockToLinkedVideo)
        ) {
          return true;
        }

        if (track.kind !== 'video') continue;

        const videoId = item.id;
        const hasLinkedAudio = doc.tracks
          .filter((candidateTrack) => candidateTrack.kind === 'audio')
          .some((audioTrack) =>
            audioTrack.items.some(
              (audioItem) =>
                audioItem.kind === 'clip' &&
                Boolean((audioItem as any).linkedVideoClipId) &&
                Boolean((audioItem as any).lockToLinkedVideo) &&
                String((audioItem as any).linkedVideoClipId) === videoId,
            ),
          );

        if (hasLinkedAudio) return true;
      }
    }

    return false;
  })();

  let hasAudioOrVideoWithAudio = false;
  let hasVideo = false;
  let allMuted = true;
  let allShowWaveform = true;
  let allShowThumbnails = true;
  let allWaveformHalf = true;

  if (doc) {
    for (const { trackId, itemId } of itemsToUpdate) {
      const track = doc.tracks.find((candidateTrack) => candidateTrack.id === trackId);
      if (!track) continue;

      const clip = track.items.find((candidateItem) => candidateItem.id === itemId);
      if (!clip || clip.kind !== 'clip') continue;

      if (track.kind === 'video') hasVideo = true;

      const hasAudio =
        track.kind === 'audio' ||
        (track.kind === 'video' &&
          clip.clipType === 'media' &&
          (clip.linkedVideoClipId || (clip.source as any)?.hasAudio));
      if (hasAudio) hasAudioOrVideoWithAudio = true;

      if (!clip.audioMuted) allMuted = false;
      if (clip.showWaveform === false) allShowWaveform = false;
      if (clip.showThumbnails === false) allShowThumbnails = false;
      if (clip.audioWaveformMode === 'full') allWaveformHalf = false;
    }
  }

  return {
    doc,
    itemsToUpdate,
    selectedClips,
    selectedIds,
    selectedVideoIds,
    allDisabled: selectedClips.length > 0 && selectedClips.every((clip) => clip.disabled),
    hasFreeClip: selectedClips.some((clip) => isClipFreePosition(clip, doc)),
    hasLockedLinks,
    hasAudioOrVideoWithAudio,
    hasVideo,
    allMuted,
    allShowWaveform,
    allShowThumbnails,
    allWaveformHalf,
  };
}
