import type { ContextMenuGroup, UseClipContextMenuOptions } from './types';

import {
  clipSupportsAudioControls,
  clipSupportsAutoMontage,
  clipSupportsReverseControls,
  clipSupportsSpeedControls,
  clipSupportsThumbnailControls,
} from '~/utils/timeline/clip-capabilities';
import {
  filterDevOnlyGroups,
  getApplicableClipParameterGroups,
} from '~/utils/timeline/clip-parameters';
import { useMediaStore, resolveMediaMetadata } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

export function buildSingleClipMainGroup(options: UseClipContextMenuOptions): ContextMenuGroup[] {
  const track = options.track.value;
  const item = options.item.value;
  if (item.kind !== 'clip') return [];

  const clipItem = item;
  const speedGroup: ContextMenuGroup = [];
  const montageGroup: ContextMenuGroup = [];
  const stateGroup: ContextMenuGroup = [];

  const mediaStore = useMediaStore();
  const meta = clipItem.source?.path
    ? resolveMediaMetadata(mediaStore.mediaMetadata, clipItem.source.path)
    : undefined;
  const hasAudioTrack = clipItem.isImage
    ? false
    : clipItem.clipType === 'media' && meta
      ? !!meta.audio
      : true;

  const isMediaVideoClip =
    track.kind === 'video' && clipItem.clipType === 'media' && !clipItem.isImage;
  const hasFreezeFrame = typeof clipItem.freezeFrameSourceTicks === 'number';

  const playheadTicks = options.currentTime.value;
  const clipStartTicks = clipItem.timelineRange.startTicks;
  const clipEndTicks = clipStartTicks + clipItem.timelineRange.durationTicks;
  const playheadOnClip = playheadTicks >= clipStartTicks && playheadTicks < clipEndTicks;

  // 1. speedGroup (Speed, Reverse, Freeze clip)
  const currentSpeed = clipItem.speed ?? 1;
  if (clipSupportsSpeedControls(track, clipItem)) {
    speedGroup.push({
      label: `${options.t('fastcat.timeline.speed')} (${currentSpeed.toFixed(2)})`,
      icon: 'i-heroicons-forward',
      kbds: options.getHotkeyKbds('timeline.openSpeedModal'),
      disabled: hasFreezeFrame,
      onSelect: () =>
        options.emitOpenSpeedModal({
          trackId: track.id,
          itemId: clipItem.id,
          speed: currentSpeed,
        }),
    });
    if (clipSupportsReverseControls(track, clipItem)) {
      speedGroup.push({
        label: options.t('videoEditor.audio.reverse'),
        icon: 'i-heroicons-arrow-path',
        kbds: options.getHotkeyKbds('timeline.reverseSpeed'),
        disabled: hasFreezeFrame,
        onSelect: async () => {
          options.updateClipProperties(track.id, clipItem.id, {
            speed: -currentSpeed,
          });
          await options.requestTimelineSave({ immediate: true });
        },
      });
    }
  }

  if (isMediaVideoClip) {
    if (!hasFreezeFrame) {
      speedGroup.push({
        label: options.t('fastcat.timeline.freezeFrame'),
        icon: 'i-heroicons-pause-circle',
        kbds: options.getHotkeyKbds('timeline.toggleFreezeFrame'),
        disabled: !playheadOnClip,
        onSelect: () =>
          options.emitClipAction({
            action: 'freezeFrame',
            trackId: track.id,
            itemId: clipItem.id,
          }),
      });
    } else {
      speedGroup.push({
        label: options.t('fastcat.timeline.resetFreezeFrame'),
        icon: 'i-heroicons-play-circle',
        kbds: options.getHotkeyKbds('timeline.toggleFreezeFrame'),
        onSelect: () =>
          options.emitClipAction({
            action: 'resetFreezeFrame',
            trackId: track.id,
            itemId: clipItem.id,
          }),
      });
    }
  }

  // 2. montageGroup (Auto montage, Extract audio)
  if (clipSupportsAutoMontage(track, clipItem)) {
    montageGroup.push({
      label: options.t('fastcat.timeline.autoMontage.title'),
      icon: 'i-heroicons-sparkles',
      onSelect: () =>
        options.emitClipAction({
          action: 'openAutoMontage',
          trackId: track.id,
          itemId: clipItem.id,
        }),
    });
  }

  const canExtract =
    track.kind === 'video' &&
    clipItem.clipType === 'media' &&
    !clipItem.isImage &&
    !clipItem.audioMuted &&
    hasAudioTrack;
  if (canExtract) {
    montageGroup.push({
      label: options.t('fastcat.timeline.extractAudio'),
      icon: 'i-heroicons-musical-note',
      onSelect: () =>
        options.emitClipAction({
          action: 'extractAudio',
          trackId: track.id,
          itemId: clipItem.id,
        }),
    });
  }

  // 3. stateGroup (Waveforms, thumbnails, Enable/disable, Lock, Snap to grid)
  const hasAudio = clipSupportsAudioControls(track, clipItem) && hasAudioTrack;
  if (hasAudio) {
    const currentMode = clipItem.audioWaveformMode || 'half';
    stateGroup.push({
      label:
        currentMode === 'half'
          ? options.t('fastcat.timeline.showFullWaveform')
          : options.t('fastcat.timeline.showHalfWaveform'),
      icon: 'i-heroicons-chart-bar',
      kbds: options.getHotkeyKbds('timeline.toggleWaveformMode'),
      onSelect: async () => {
        options.updateClipProperties(track.id, clipItem.id, {
          audioWaveformMode: currentMode === 'half' ? 'full' : 'half',
        });
        await options.requestTimelineSave({ immediate: true });
      },
    });

    stateGroup.push({
      label:
        clipItem.showWaveform === false
          ? options.t('fastcat.timeline.showWaveform')
          : options.t('fastcat.timeline.hideWaveform'),
      icon: clipItem.showWaveform === false ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
      kbds: options.getHotkeyKbds('timeline.toggleShowWaveform'),
      onSelect: async () => {
        options.updateClipProperties(track.id, clipItem.id, {
          showWaveform: clipItem.showWaveform === false,
        });
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  if (clipSupportsThumbnailControls(track, clipItem)) {
    stateGroup.push({
      label:
        clipItem.showThumbnails === false
          ? options.t('fastcat.timeline.showThumbnails')
          : options.t('fastcat.timeline.hideThumbnails'),
      icon: 'i-heroicons-photo',
      kbds: options.getHotkeyKbds('timeline.toggleShowThumbnails'),
      onSelect: async () => {
        options.updateClipProperties(track.id, clipItem.id, {
          showThumbnails: clipItem.showThumbnails === false,
        });
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  // Enable/disable clip
  if (track.kind !== 'audio') {
    stateGroup.push({
      label: clipItem.disabled
        ? options.t('fastcat.timeline.enableClip')
        : options.t('fastcat.timeline.disableClip'),
      icon: clipItem.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
      kbds: options.getHotkeyKbds('timeline.toggleDisableClip'),
      onSelect: async () => {
        options.updateClipProperties(track.id, clipItem.id, {
          disabled: !clipItem.disabled,
        });
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  // Mute/unmute clip audio
  if (hasAudio) {
    stateGroup.push({
      label: clipItem.audioMuted
        ? options.t('fastcat.timeline.unmuteClip')
        : options.t('fastcat.timeline.muteClip'),
      icon: clipItem.audioMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark',
      kbds: options.getHotkeyKbds('timeline.toggleMuteClip'),
      onSelect: async () => {
        options.updateClipProperties(track.id, clipItem.id, {
          audioMuted: !clipItem.audioMuted,
        });
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  // Lock/unlock clip
  stateGroup.push({
    label: clipItem.locked
      ? options.t('fastcat.timeline.unlockClip')
      : options.t('fastcat.timeline.lockClip'),
    icon: clipItem.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
    kbds: options.getHotkeyKbds('timeline.toggleLockClip'),
    onSelect: async () => {
      options.updateClipProperties(track.id, clipItem.id, {
        locked: !clipItem.locked,
      });
      await options.requestTimelineSave({ immediate: true });
    },
  });

  return [speedGroup, montageGroup, stateGroup].filter((group) => group.length > 0);
}

export function buildSingleItemActionGroup(options: UseClipContextMenuOptions): ContextMenuGroup {
  const track = options.track.value;
  const item = options.item.value;
  const isTrackLocked = Boolean(track.locked);
  const isLocked = item.kind === 'clip' && Boolean(item.locked);
  const clip = item.kind === 'clip' ? item : null;
  const clipParametersSnapshot = options.getClipParametersSnapshot();
  const workspaceStore = useWorkspaceStore();
  const hasApplicableClipParameters =
    clip !== null &&
    clipParametersSnapshot !== null &&
    filterDevOnlyGroups(
      getApplicableClipParameterGroups({
        snapshot: clipParametersSnapshot,
        targetClip: clip,
        targetTrackKind: track.kind,
      }),
      workspaceStore.inDevelopmentFeaturesEnabled,
    ).length > 0;

  const actions: ContextMenuGroup = [];

  if (clip) {
    // Rename
    actions.push({
      label: options.t('common.rename'),
      icon: 'i-heroicons-pencil',
      disabled: isTrackLocked || isLocked,
      kbds: options.getHotkeyKbds('general.rename'),
      onSelect: () =>
        options.requestRenameClip({
          trackId: track.id,
          itemId: clip.id,
          name: clip.name,
        }),
    });

    // Copy / Paste clip parameters — in-development feature, gated until stable.
    if (workspaceStore.inDevelopmentFeaturesEnabled) {
      // Copy parameters
      actions.push({
        label: options.t('fastcat.clip.parameters.copy'),
        icon: 'i-heroicons-clipboard-document',
        kbds: options.getHotkeyKbds('timeline.copyClipParameters'),
        onSelect: () => options.copyClipParameters(clip, track.kind),
      });

      // Paste parameters
      actions.push({
        label: options.t('fastcat.clip.parameters.paste'),
        icon: 'i-heroicons-clipboard-document-check',
        disabled: isTrackLocked || isLocked || !hasApplicableClipParameters,
        kbds: options.getHotkeyKbds('timeline.pasteClipParameters'),
        onSelect: () => options.pasteClipParameters(clip, track.kind),
      });
    }
  }

  // Copy
  actions.push({
    label: options.t('common.copy'),
    icon: 'i-heroicons-document-duplicate',
    kbds: options.getHotkeyKbds('general.copy'),
    onSelect: () => options.copySelectedClips(),
  });

  // Cut
  actions.push({
    label: options.t('common.cut'),
    icon: 'i-heroicons-scissors',
    disabled: isTrackLocked || isLocked,
    kbds: options.getHotkeyKbds('general.cut'),
    onSelect: () => options.cutSelectedClips(),
  });

  // Delete
  actions.push({
    label: options.t('fastcat.timeline.delete'),
    icon: 'i-heroicons-trash',
    disabled: isTrackLocked || isLocked,
    kbds: options.getHotkeyKbds('general.delete'),
    onSelect: () => {
      options.clearSelection();
      options.applyTimelineCommand({
        type: 'delete_items',
        trackId: track.id,
        itemIds: [item.id],
      });
    },
  });

  return actions;
}
