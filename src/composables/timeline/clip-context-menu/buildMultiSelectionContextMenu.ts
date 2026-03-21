import type { TimelineCommand, UpdateClipPropertiesCommand } from '~/timeline/commands';
import type { ContextMenuGroup, UseClipContextMenuOptions } from './types';
import { collectMultiSelectionState, isClipFreePosition } from './utils';

export function buildMultiSelectionContextMenu(
  options: UseClipContextMenuOptions,
): ContextMenuGroup[] | null {
  const item = options.item.value;
  const selectedItemIds = options.selectedItemIds.value;
  const isMultiSelection = selectedItemIds.length > 1 && selectedItemIds.includes(item.id);

  if (!isMultiSelection) return null;

  const state = collectMultiSelectionState(options.timelineDoc.value, selectedItemIds);
  const mainGroup: ContextMenuGroup = [];

  mainGroup.push({
    label: state.allDisabled
      ? options.t('fastcat.timeline.enableClips', 'Enable clips')
      : options.t('fastcat.timeline.disableClips', 'Disable clips'),
    icon: state.allDisabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
    onSelect: async () => {
      const cmds = state.itemsToUpdate.map(({ trackId, itemId }) => ({
        type: 'update_clip_properties' as const,
        trackId,
        itemId,
        properties: { disabled: !state.allDisabled },
      }));
      options.batchApplyTimeline(cmds);
      await options.requestTimelineSave({ immediate: true });
    },
  });

  if (state.hasAudioOrVideoWithAudio) {
    mainGroup.push({
      label: state.allMuted
        ? options.t('fastcat.timeline.unmuteClips', 'Unmute clips')
        : options.t('fastcat.timeline.muteClips', 'Mute clips'),
      icon: state.allMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark',
      onSelect: async () => {
        const cmds = state.itemsToUpdate.map(({ trackId, itemId }) => ({
          type: 'update_clip_properties' as const,
          trackId,
          itemId,
          properties: { audioMuted: !state.allMuted },
        }));
        options.batchApplyTimeline(cmds);
        await options.requestTimelineSave({ immediate: true });
      },
    });

    mainGroup.push({
      label: state.allWaveformHalf
        ? options.t('fastcat.timeline.waveformFull', 'Waveform: Full')
        : options.t('fastcat.timeline.waveformHalf', 'Waveform: Half'),
      icon: 'i-heroicons-chart-bar',
      onSelect: async () => {
        const cmds = state.itemsToUpdate.map(({ trackId, itemId }) => ({
          type: 'update_clip_properties' as const,
          trackId,
          itemId,
          properties: {
            audioWaveformMode: (state.allWaveformHalf ? 'full' : 'half') as 'full' | 'half',
          },
        }));
        options.batchApplyTimeline(cmds);
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  if (state.hasFreeClip) {
    mainGroup.push({
      label: options.t('fastcat.timeline.quantize', 'Quantize to frames'),
      icon: 'i-heroicons-squares-2x2',
      onSelect: async () => {
        if (!state.doc) return;

        const cmds: TimelineCommand[] = [];
        for (const { trackId, itemId } of state.itemsToUpdate) {
          const track = state.doc.tracks.find((candidateTrack) => candidateTrack.id === trackId);
          const clip = track?.items.find((candidateItem) => candidateItem.id === itemId);
          if (!clip || clip.kind !== 'clip') continue;
          if ((clip as any).locked) continue;
          if (!isClipFreePosition(clip, state.doc)) continue;

          cmds.push({
            type: 'trim_item',
            trackId,
            itemId,
            edge: 'end',
            deltaUs: 0,
            quantizeToFrames: true,
          } as any);
        }

        if (cmds.length === 0) return;

        options.batchApplyTimeline(cmds);
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  if (state.hasLockedLinks) {
    mainGroup.push({
      label: options.t('fastcat.timeline.unlinkAudio', 'Unlink audio'),
      icon: 'i-heroicons-link-slash',
      onSelect: async () => {
        if (!state.doc) return;

        const cmds: UpdateClipPropertiesCommand[] = [];
        for (const track of state.doc.tracks) {
          if (track.kind !== 'audio') continue;

          for (const item of track.items) {
            if (item.kind !== 'clip') continue;

            const linked = String((item as any).linkedVideoClipId ?? '');
            const isLocked = Boolean((item as any).lockToLinkedVideo);
            const shouldUnlink =
              (state.selectedIds.has(item.id) && linked && isLocked) ||
              (state.selectedVideoIds.length > 0 &&
                linked &&
                isLocked &&
                state.selectedVideoIds.includes(linked));

            if (!shouldUnlink) continue;

            cmds.push({
              type: 'update_clip_properties',
              trackId: track.id,
              itemId: item.id,
              properties: {
                linkedVideoClipId: undefined,
                lockToLinkedVideo: false,
              },
            } as any);
          }
        }

        if (cmds.length === 0) return;

        options.batchApplyTimeline(cmds);
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  if (state.hasVideo) {
    mainGroup.push({
      label: state.allShowWaveform
        ? options.t('fastcat.timeline.hideWaveform', 'Hide Waveform')
        : options.t('fastcat.timeline.showWaveform', 'Show Waveform'),
      icon: state.allShowWaveform ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      onSelect: async () => {
        const cmds = state.itemsToUpdate.map(({ trackId, itemId }) => ({
          type: 'update_clip_properties' as const,
          trackId,
          itemId,
          properties: { showWaveform: !state.allShowWaveform },
        }));
        options.batchApplyTimeline(cmds);
        await options.requestTimelineSave({ immediate: true });
      },
    });

    mainGroup.push({
      label: state.allShowThumbnails
        ? options.t('fastcat.timeline.hideThumbnails', 'Hide Thumbnails')
        : options.t('fastcat.timeline.showThumbnails', 'Show Thumbnails'),
      icon: 'i-heroicons-photo',
      onSelect: async () => {
        const cmds = state.itemsToUpdate.map(({ trackId, itemId }) => ({
          type: 'update_clip_properties' as const,
          trackId,
          itemId,
          properties: { showThumbnails: !state.allShowThumbnails },
        }));
        options.batchApplyTimeline(cmds);
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  const actionGroup: ContextMenuGroup = [
    {
      label: options.t('fastcat.timeline.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      disabled: state.hasLockedTrack,
      onSelect: () => {
        options.clearSelection();
        const cmds = state.itemsToUpdate.map(({ trackId, itemId }) => ({
          type: 'delete_items' as const,
          trackId,
          itemIds: [itemId],
        }));
        options.batchApplyTimeline(cmds);
      },
    },
  ];

  return [mainGroup, actionGroup];
}
