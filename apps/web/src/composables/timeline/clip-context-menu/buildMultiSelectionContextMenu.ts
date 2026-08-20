import type { ContextMenuGroup, UseClipContextMenuOptions } from './types';
import { collectMultiSelectionState } from './utils';
import { createLinkedGroupId } from '~/timeline/id';
import { useWorkspaceStore } from '~/stores/workspace.store';

export function buildMultiSelectionContextMenu(
  options: UseClipContextMenuOptions,
): ContextMenuGroup[] | null {
  const item = options.item.value;
  const selectedItemIds = options.selectedItemIds.value;
  const isMultiSelection = selectedItemIds.length > 1 && selectedItemIds.includes(item.id);

  if (!isMultiSelection) return null;

  const state = collectMultiSelectionState(options.timelineDoc.value, selectedItemIds);
  const workspaceStore = useWorkspaceStore();
  const mainGroup: ContextMenuGroup = [];

  mainGroup.push({
    label: state.allDisabled
      ? options.t('fastcat.timeline.enableClips')
      : options.t('fastcat.timeline.disableClips'),
    icon: state.allDisabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
    kbds: options.getHotkeyKbds('timeline.toggleDisableClip'),
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

  const allLocked = state.selectedClips.length > 0 && state.selectedClips.every((c) => c.locked);
  mainGroup.push({
    label: allLocked
      ? options.t('fastcat.timeline.unlockClips')
      : options.t('fastcat.timeline.lockClips'),
    icon: allLocked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
    kbds: options.getHotkeyKbds('timeline.toggleLockClip'),
    onSelect: async () => {
      const cmds = state.itemsToUpdate.map(({ trackId, itemId }) => ({
        type: 'update_clip_properties' as const,
        trackId,
        itemId,
        properties: { locked: !allLocked },
      }));
      options.batchApplyTimeline(cmds);
      await options.requestTimelineSave({ immediate: true });
    },
  });

  if (state.hasAudioOrVideoWithAudio) {
    mainGroup.push({
      label: state.allMuted
        ? options.t('fastcat.timeline.unmuteClips')
        : options.t('fastcat.timeline.muteClips'),
      icon: state.allMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark',
      kbds: options.getHotkeyKbds('timeline.toggleMuteClip'),
      onSelect: async () => {
        const cmds = state.audioItemsToUpdate.map(({ trackId, itemId }) => ({
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
        ? options.t('fastcat.timeline.showFullWaveform')
        : options.t('fastcat.timeline.showHalfWaveform'),
      icon: 'i-heroicons-chart-bar',
      kbds: options.getHotkeyKbds('timeline.toggleWaveformMode'),
      onSelect: async () => {
        const cmds = state.waveformItemsToUpdate.map(({ trackId, itemId }) => ({
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

  mainGroup.push({
    label: state.hasGroupedClip
      ? options.t('fastcat.timeline.ungroup')
      : options.t('fastcat.timeline.group'),
    icon: state.hasGroupedClip ? 'i-heroicons-rectangle-group' : 'i-heroicons-square-2-stack',
    onSelect: async () => {
      const isGrouping = !state.hasGroupedClip;
      const nextGroupId = isGrouping ? createLinkedGroupId() : undefined;

      const cmds = state.itemsToUpdate.map(({ trackId, itemId }) => ({
        type: 'update_clip_properties' as const,
        trackId,
        itemId,
        properties: { linkedGroupId: nextGroupId },
      }));

      options.batchApplyTimeline(cmds);
      await options.requestTimelineSave({ immediate: true });
    },
  });

  if (state.waveformItemsToUpdate.length > 0) {
    mainGroup.push({
      label: state.allShowWaveform
        ? options.t('fastcat.timeline.hideWaveform')
        : options.t('fastcat.timeline.showWaveform'),
      icon: state.allShowWaveform ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      kbds: options.getHotkeyKbds('timeline.toggleShowWaveform'),
      onSelect: async () => {
        const cmds = state.waveformItemsToUpdate.map(({ trackId, itemId }) => ({
          type: 'update_clip_properties' as const,
          trackId,
          itemId,
          properties: { showWaveform: !state.allShowWaveform },
        }));
        options.batchApplyTimeline(cmds);
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  if (state.hasVideo) {
    mainGroup.push({
      label: state.allShowThumbnails
        ? options.t('fastcat.timeline.hideThumbnails')
        : options.t('fastcat.timeline.showThumbnails'),
      icon: 'i-heroicons-photo',
      kbds: options.getHotkeyKbds('timeline.toggleShowThumbnails'),
      onSelect: async () => {
        const cmds = state.thumbnailItemsToUpdate.map(({ trackId, itemId }) => ({
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

  if (state.autoMontageItemsToUpdate.length > 0) {
    const first = state.autoMontageItemsToUpdate[0]!;
    mainGroup.push({
      label: options.t('fastcat.timeline.autoMontage.title'),
      icon: 'i-heroicons-sparkles',
      onSelect: () =>
        options.emitClipAction({
          action: 'openAutoMontage',
          trackId: first.trackId,
          itemId: first.itemId,
        }),
    });
  }

  // Paste parameters onto every selected clip. The right-clicked clip drives the
  // paste modal (which groups are applicable) and the paste then fans out across
  // the whole selection. Only offered when the clipboard holds copied parameters.
  // Gated behind the in-development flag — hidden from the menu until the feature
  // is stable.
  if (
    workspaceStore.inDevelopmentFeaturesEnabled &&
    item.kind === 'clip' &&
    options.getClipParametersSnapshot()
  ) {
    mainGroup.push({
      label: options.t('fastcat.clip.parameters.paste'),
      icon: 'i-heroicons-clipboard-document-check',
      disabled: state.hasLockedTrack,
      kbds: options.getHotkeyKbds('timeline.pasteClipParameters'),
      onSelect: () => options.pasteClipParameters(item, options.track.value.kind),
    });
  }

  const actionGroup: ContextMenuGroup = [
    {
      label: options.t('common.copy'),
      icon: 'i-heroicons-document-duplicate',
      kbds: options.getHotkeyKbds('general.copy'),
      onSelect: () => options.copySelectedClips(),
    },
    {
      label: options.t('common.cut'),
      icon: 'i-heroicons-scissors',
      disabled: state.hasLockedTrack,
      kbds: options.getHotkeyKbds('general.cut'),
      onSelect: () => options.cutSelectedClips(),
    },
    {
      label: options.t('fastcat.timeline.delete'),
      icon: 'i-heroicons-trash',
      disabled: state.hasLockedTrack,
      kbds: options.getHotkeyKbds('general.delete'),
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
