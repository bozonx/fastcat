import type { TimelineClipItem, TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import type { ContextMenuGroup, UseClipContextMenuOptions } from './types';
import { isClipFreePosition } from './utils';
import {
  clipSupportsAudioControls,
  clipSupportsAutoMontage,
  clipSupportsSpeedControls,
  clipSupportsThumbnailControls,
} from '~/utils/timeline/clip-capabilities';
import { getApplicableClipParameterGroups } from '~/utils/timeline/clip-parameters';

export function buildSingleClipMainGroup(options: UseClipContextMenuOptions): ContextMenuGroup[] {
  const track = options.track.value;
  const item = options.item.value;
  if (item.kind !== 'clip') return [];

  const clipItem = item;
  const stateGroup: ContextMenuGroup = [];
  const timingGroup: ContextMenuGroup = [];
  const relationGroup: ContextMenuGroup = [];
  const mediaGroup: ContextMenuGroup = [];
  const isFree = isClipFreePosition(clipItem, options.timelineDoc.value);
  const doc = options.timelineDoc.value;
  const lockedLinkedAudioClips =
    doc?.tracks
      .filter((candidateTrack) => candidateTrack.kind === 'audio')
      .flatMap((candidateTrack) => candidateTrack.items)
      .filter(
        (candidateItem): candidateItem is TimelineClipItem =>
          candidateItem.kind === 'clip' &&
          Boolean(candidateItem.linkedVideoClipId) &&
          Boolean(candidateItem.lockToLinkedVideo),
      ) ?? [];

  const linkedAudioForThisVideo =
    track.kind === 'video'
      ? lockedLinkedAudioClips.filter(
          (audioClip) => String(audioClip.linkedVideoClipId) === clipItem.id,
        )
      : [];

  const isLockedAudioClip =
    track.kind === 'audio' &&
    Boolean(clipItem.linkedVideoClipId) &&
    Boolean(clipItem.lockToLinkedVideo);

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

  const hasAudio = clipSupportsAudioControls(track, clipItem);
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

  if (isFree && !clipItem.locked) {
    timingGroup.push({
      label: options.t('fastcat.timeline.quantize'),
      icon: 'i-heroicons-squares-2x2',
      onSelect: async () => {
        options.emitClipAction({
          action: 'trim_item',
          trackId: track.id,
          itemId: clipItem.id,
          edge: 'end',
          deltaUs: 0,
          quantizeToFrames: true,
        });
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  if (isLockedAudioClip) {
    relationGroup.push({
      label: options.t('fastcat.timeline.unlinkAudio'),
      icon: 'i-heroicons-link-slash',
      onSelect: async () => {
        options.applyTimelineCommand({
          type: 'unlink_audio_from_video',
          audioTrackId: track.id,
          audioItemId: clipItem.id,
        });
        await options.requestTimelineSave({ immediate: true });
      },
    });
  } else if (linkedAudioForThisVideo.length > 0) {
    relationGroup.push({
      label: options.t('fastcat.timeline.unlinkAudio'),
      icon: 'i-heroicons-link-slash',
      onSelect: async () => {
        options.applyTimelineCommand({
          type: 'unlink_audio_from_video',
          videoItemId: clipItem.id,
        });
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  const currentSpeed = clipItem.speed ?? 1;
  if (clipSupportsSpeedControls(track, clipItem)) {
    timingGroup.push({
      label: `${options.t('fastcat.timeline.speed')} (${currentSpeed.toFixed(2)})`,
      icon: 'i-heroicons-forward',
      onSelect: () =>
        options.emitOpenSpeedModal({
          trackId: track.id,
          itemId: clipItem.id,
          speed: currentSpeed,
        }),
    });
  }

  const canExtract =
    track.kind === 'video' && clipItem.clipType === 'media' && !clipItem.audioFromVideoDisabled;
  if (canExtract) {
    relationGroup.push({
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

  const docTracks = options.timelineDoc.value?.tracks ?? [];
  const hasReturnFromVideoClip =
    track.kind === 'video' &&
    Boolean(clipItem.audioFromVideoDisabled) &&
    docTracks.some((candidateTrack: TimelineTrack) =>
      candidateTrack.kind !== 'audio'
        ? false
        : (candidateTrack.items ?? []).some(
            (candidateItem: TimelineTrackItem) =>
              candidateItem.kind === 'clip' &&
              candidateItem.linkedVideoClipId === clipItem.id &&
              Boolean(candidateItem.lockToLinkedVideo),
          ),
    );

  const hasReturnFromLockedAudioClip =
    track.kind === 'audio' &&
    Boolean(clipItem.linkedVideoClipId) &&
    Boolean(clipItem.lockToLinkedVideo);

  if (hasReturnFromVideoClip) {
    relationGroup.push({
      label: options.t('fastcat.timeline.returnAudio'),
      icon: 'i-heroicons-arrow-uturn-left',
      onSelect: () =>
        options.emitClipAction({
          action: 'returnAudio',
          trackId: track.id,
          itemId: clipItem.id,
        }),
    });
  } else if (hasReturnFromLockedAudioClip) {
    relationGroup.push({
      label: options.t('fastcat.timeline.returnAudio'),
      icon: 'i-heroicons-arrow-uturn-left',
      onSelect: () =>
        options.emitClipAction({
          action: 'returnAudio',
          trackId: track.id,
          itemId: clipItem.id,
          videoItemId: String(clipItem.linkedVideoClipId),
        }),
    });
  }

  const isMediaVideoClip = track.kind === 'video' && clipItem.clipType === 'media';
  const hasFreezeFrame = typeof clipItem.freezeFrameSourceUs === 'number';

  if (isMediaVideoClip && !hasFreezeFrame) {
    mediaGroup.push({
      label: options.t('fastcat.timeline.freezeFrame'),
      icon: 'i-heroicons-pause-circle',
      kbds: options.getHotkeyKbds('timeline.toggleFreezeFrame'),
      onSelect: () =>
        options.emitClipAction({
          action: 'freezeFrame',
          trackId: track.id,
          itemId: clipItem.id,
        }),
    });
  }

  if (isMediaVideoClip && hasFreezeFrame) {
    mediaGroup.push({
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

  if (clipSupportsAutoMontage(track, clipItem)) {
    mediaGroup.push({
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

  return [stateGroup, timingGroup, relationGroup, mediaGroup].filter((group) => group.length > 0);
}

export function buildSingleItemActionGroup(options: UseClipContextMenuOptions): ContextMenuGroup {
  const track = options.track.value;
  const item = options.item.value;
  const isTrackLocked = Boolean(track.locked);
  const isLocked = item.kind === 'clip' && Boolean(item.locked);
  const clip = item.kind === 'clip' ? item : null;
  const clipParametersSnapshot = options.getClipParametersSnapshot();
  const hasApplicableClipParameters =
    clip !== null &&
    clipParametersSnapshot !== null &&
    getApplicableClipParameterGroups({
      snapshot: clipParametersSnapshot,
      targetClip: clip,
      targetTrackKind: track.kind,
    }).length > 0;

  const actions: ContextMenuGroup = [
    ...(clip
      ? [
          {
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
          },
        ]
      : []),
    {
      label: options.t('common.copy'),
      icon: 'i-heroicons-document-duplicate',
      kbds: options.getHotkeyKbds('general.copy'),
      onSelect: () => options.copySelectedClips(),
    },
    {
      label: options.t('common.cut'),
      icon: 'i-heroicons-scissors',
      disabled: isTrackLocked || isLocked,
      kbds: options.getHotkeyKbds('general.cut'),
      onSelect: () => options.cutSelectedClips(),
    },
    {
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
    },
  ];

  if (clip) {
    actions.splice(
      1,
      0,
      {
        label: options.t('fastcat.clip.parameters.copy'),
        icon: 'i-heroicons-clipboard-document',
        kbds: options.getHotkeyKbds('timeline.copyClipParameters'),
        onSelect: () => options.copyClipParameters(clip, track.kind),
      },
      {
        label: options.t('fastcat.clip.parameters.paste'),
        icon: 'i-heroicons-clipboard-document-check',
        disabled: isTrackLocked || isLocked || !hasApplicableClipParameters,
        kbds: options.getHotkeyKbds('timeline.pasteClipParameters'),
        onSelect: () => options.pasteClipParameters(clip, track.kind),
      },
    );
  }

  return actions;
}
