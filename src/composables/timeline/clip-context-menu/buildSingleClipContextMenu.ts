import type { TimelineClipItem, TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import type { ContextMenuGroup, UseClipContextMenuOptions } from './types';
import { isClipFreePosition } from './utils';

export function buildSingleClipMainGroup(
  options: UseClipContextMenuOptions,
): ContextMenuGroup {
  const track = options.track.value;
  const item = options.item.value;
  if (item.kind !== 'clip') return [];

  const clipItem = item as TimelineClipItem;
  const mainGroup: ContextMenuGroup = [];
  const isFree = isClipFreePosition(clipItem, options.timelineDoc.value);
  const doc = options.timelineDoc.value;
  const lockedLinkedAudioClips =
    doc?.tracks
      .filter((candidateTrack) => candidateTrack.kind === 'audio')
      .flatMap((candidateTrack) => candidateTrack.items)
      .filter(
        (candidateItem): candidateItem is TimelineClipItem =>
          candidateItem.kind === 'clip' &&
          Boolean((candidateItem as any).linkedVideoClipId) &&
          Boolean((candidateItem as any).lockToLinkedVideo),
      ) ?? [];

  const linkedAudioForThisVideo =
    track.kind === 'video'
      ? lockedLinkedAudioClips.filter(
          (audioClip) => String((audioClip as any).linkedVideoClipId) === clipItem.id,
        )
      : [];

  const isLockedAudioClip =
    track.kind === 'audio' &&
    Boolean((clipItem as any).linkedVideoClipId) &&
    Boolean((clipItem as any).lockToLinkedVideo);

  mainGroup.push({
    label: clipItem.disabled
      ? options.t('fastcat.timeline.enableClip', 'Enable clip')
      : options.t('fastcat.timeline.disableClip', 'Disable clip'),
    icon: clipItem.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
    onSelect: async () => {
      options.updateClipProperties(track.id, clipItem.id, {
        disabled: !clipItem.disabled,
      });
      await options.requestTimelineSave({ immediate: true });
    },
  });

  const hasAudio =
    track.kind === 'audio' || clipItem.clipType === 'media' || clipItem.clipType === 'timeline';
  if (hasAudio) {
    mainGroup.push({
      label: clipItem.audioMuted
        ? options.t('fastcat.timeline.unmuteClip', 'Unmute')
        : options.t('fastcat.timeline.muteClip', 'Mute'),
      icon: clipItem.audioMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark',
      onSelect: async () => {
        options.updateClipProperties(track.id, clipItem.id, {
          audioMuted: !clipItem.audioMuted,
        });
        await options.requestTimelineSave({ immediate: true });
      },
    });

    const currentMode = clipItem.audioWaveformMode || 'full';
    mainGroup.push({
      label:
        currentMode === 'half'
          ? options.t('fastcat.timeline.waveformFull', 'Full waveform')
          : options.t('fastcat.timeline.waveformHalf', 'Half waveform'),
      icon: 'i-heroicons-chart-bar',
      onSelect: async () => {
        options.updateClipProperties(track.id, clipItem.id, {
          audioWaveformMode: currentMode === 'half' ? 'full' : 'half',
        });
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  if (isFree && !clipItem.locked) {
    mainGroup.push({
      label: options.t('fastcat.timeline.quantize', 'Quantize to frames'),
      icon: 'i-heroicons-squares-2x2',
      onSelect: async () => {
        options.applyTimelineCommand({
          type: 'trim_item',
          trackId: track.id,
          itemId: clipItem.id,
          edge: 'end',
          deltaUs: 0,
          quantizeToFrames: true,
        } as any);
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  if (isLockedAudioClip) {
    mainGroup.push({
      label: options.t('fastcat.timeline.unlinkAudio', 'Unlink from video'),
      icon: 'i-heroicons-link-slash',
      onSelect: async () => {
        options.updateClipProperties(track.id, clipItem.id, {
          linkedVideoClipId: undefined,
          lockToLinkedVideo: false,
        } as any);
        await options.requestTimelineSave({ immediate: true });
      },
    });
  } else if (linkedAudioForThisVideo.length > 0) {
    mainGroup.push({
      label: options.t('fastcat.timeline.unlinkAudio', 'Unlink audio'),
      icon: 'i-heroicons-link-slash',
      onSelect: async () => {
        const cmds = linkedAudioForThisVideo.map((audioClip) => ({
          type: 'update_clip_properties' as const,
          trackId: audioClip.trackId,
          itemId: audioClip.id,
          properties: {
            linkedVideoClipId: undefined,
            lockToLinkedVideo: false,
          } as any,
        }));
        options.batchApplyTimeline(cmds as any);
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  mainGroup.push({
    label: clipItem.locked
      ? options.t('fastcat.timeline.unlockClip', 'Unlock clip')
      : options.t('fastcat.timeline.lockClip', 'Lock clip'),
    icon: clipItem.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
    onSelect: async () => {
      options.updateClipProperties(track.id, clipItem.id, {
        locked: !clipItem.locked,
      });
      await options.requestTimelineSave({ immediate: true });
    },
  });

  if (track.kind === 'video') {
    mainGroup.push({
      label:
        clipItem.showThumbnails === false
          ? options.t('fastcat.timeline.showThumbnails', 'Show thumbnails')
          : options.t('fastcat.timeline.hideThumbnails', 'Hide thumbnails'),
      icon: 'i-heroicons-photo',
      onSelect: async () => {
        options.updateClipProperties(track.id, clipItem.id, {
          showThumbnails: clipItem.showThumbnails === false,
        });
        await options.requestTimelineSave({ immediate: true });
      },
    });
  }

  const currentSpeed = clipItem.speed ?? 1;
  mainGroup.push({
    label: `${options.t('fastcat.timeline.speed', 'Speed')} (${currentSpeed.toFixed(2)})`,
    icon: 'i-heroicons-forward',
    onSelect: () =>
      options.emitOpenSpeedModal({
        trackId: track.id,
        itemId: clipItem.id,
        speed: currentSpeed,
      }),
  });

  const canExtract =
    track.kind === 'video' && clipItem.clipType === 'media' && !(clipItem as any).audioFromVideoDisabled;
  if (canExtract) {
    mainGroup.push({
      label: options.t('fastcat.timeline.extractAudio', 'Extract audio to audio track'),
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
    mainGroup.push({
      label: options.t('fastcat.timeline.returnAudio', 'Return audio to video clip'),
      icon: 'i-heroicons-arrow-uturn-left',
      onSelect: () =>
        options.emitClipAction({
          action: 'returnAudio',
          trackId: track.id,
          itemId: clipItem.id,
        }),
    });
  } else if (hasReturnFromLockedAudioClip) {
    mainGroup.push({
      label: options.t('fastcat.timeline.returnAudio', 'Return audio to video clip'),
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
    mainGroup.push({
      label: options.t('fastcat.timeline.freezeFrame', 'Freeze frame'),
      icon: 'i-heroicons-pause-circle',
      onSelect: () =>
        options.emitClipAction({
          action: 'freezeFrame',
          trackId: track.id,
          itemId: clipItem.id,
        }),
    });
  }

  if (isMediaVideoClip && hasFreezeFrame) {
    mainGroup.push({
      label: options.t('fastcat.timeline.resetFreezeFrame', 'Reset freeze frame'),
      icon: 'i-heroicons-play-circle',
      onSelect: () =>
        options.emitClipAction({
          action: 'resetFreezeFrame',
          trackId: track.id,
          itemId: clipItem.id,
        }),
    });
  }

  return mainGroup;
}

export function buildSingleItemActionGroup(
  options: UseClipContextMenuOptions,
): ContextMenuGroup {
  const track = options.track.value;
  const item = options.item.value;

  return [
    {
      label: options.t('fastcat.timeline.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      disabled: item.kind === 'clip' && Boolean((item as TimelineClipItem).locked),
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
}
