import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';
import {
  clipSupportsAudioControls,
  clipSupportsAutoMontage,
  clipSupportsThumbnailControls,
} from '~/utils/timeline/clip-capabilities';
import type { MultiSelectionItemRef, MultiSelectionState } from './types';



export function collectMultiSelectionState(
  doc: TimelineDocument | null,
  selectedItemIds: string[],
): MultiSelectionState {
  const selectedClips: TimelineClipItem[] = [];
  const itemsToUpdate: MultiSelectionItemRef[] = [];
  const audioItemsToUpdate: MultiSelectionItemRef[] = [];
  const waveformItemsToUpdate: MultiSelectionItemRef[] = [];
  const thumbnailItemsToUpdate: MultiSelectionItemRef[] = [];
  const autoMontageItemsToUpdate: MultiSelectionItemRef[] = [];
  const lockedTrackIds = new Set<string>();

  if (doc) {
    for (const track of doc.tracks) {
      if (track.locked) {
        lockedTrackIds.add(track.id);
      }
      for (const item of track.items) {
        if (!selectedItemIds.includes(item.id)) continue;

        if (item.kind === 'clip') {
          selectedClips.push(item);
        }

        itemsToUpdate.push({ trackId: track.id, itemId: item.id });
      }
    }
  }

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

      if (clipSupportsThumbnailControls(track, clip)) {
        hasVideo = true;
        thumbnailItemsToUpdate.push({ trackId, itemId });
      }

      const hasAudio = clipSupportsAudioControls(track, clip);
      if (hasAudio) {
        hasAudioOrVideoWithAudio = true;
        audioItemsToUpdate.push({ trackId, itemId });
        waveformItemsToUpdate.push({ trackId, itemId });

        if (!clip.audioMuted) allMuted = false;
        if (clip.showWaveform === false) allShowWaveform = false;
        if (clip.audioWaveformMode === 'full') allWaveformHalf = false;
      }

      if (clipSupportsThumbnailControls(track, clip) && clip.showThumbnails === false) {
        allShowThumbnails = false;
      }

      if (clipSupportsAutoMontage(track, clip)) {
        autoMontageItemsToUpdate.push({ trackId, itemId });
      }
    }
  }

  return {
    doc,
    itemsToUpdate,
    audioItemsToUpdate,
    waveformItemsToUpdate,
    thumbnailItemsToUpdate,
    autoMontageItemsToUpdate,
    selectedClips,
    selectedIds: new Set(selectedItemIds),
    allDisabled: selectedClips.length > 0 && selectedClips.every((clip) => clip.disabled),
    hasLockedTrack: lockedTrackIds.size > 0,
    hasAudioOrVideoWithAudio,
    hasVideo,
    hasGroupedClip: selectedClips.some(
      (clip) => typeof clip.linkedGroupId === 'string' && clip.linkedGroupId.trim().length > 0,
    ),
    allMuted,
    allShowWaveform,
    allShowThumbnails,
    allWaveformHalf,
  };
}
