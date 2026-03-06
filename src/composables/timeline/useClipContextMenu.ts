import { computed, type Ref } from 'vue';
import type {
  TimelineTrack,
  TimelineTrackItem,
  TimelineClipItem,
  TimelineDocument,
  ClipTransition,
} from '~/timeline/types';
import type { GranVideoEditorProjectSettings } from '~/utils/project-settings';
import type {
  TimelineCommand,
  UpdateClipPropertiesCommand,
  UpdateClipTransitionCommand,
} from '~/timeline/commands';

interface UseClipContextMenuOptions {
  track: Ref<TimelineTrack>;
  item: Ref<TimelineTrackItem>;
  timelineDoc: Ref<TimelineDocument | null>;
  projectSettings: Ref<GranVideoEditorProjectSettings>;
  selectedItemIds: Ref<string[]>;
  applyTimelineCommand: (cmd: TimelineCommand) => void;
  batchApplyTimeline: (cmds: TimelineCommand[]) => void;
  updateClipProperties: (
    trackId: string,
    itemId: string,
    props: UpdateClipPropertiesCommand['properties'],
  ) => void;
  updateClipTransition: (
    trackId: string,
    itemId: string,
    props: { transitionIn?: ClipTransition | null; transitionOut?: ClipTransition | null },
  ) => void;
  requestTimelineSave: (opts: { immediate: boolean }) => Promise<void>;
  selectTransition: (payload: { trackId: string; itemId: string; edge: 'in' | 'out' }) => void;
  clearSelection: () => void;
  selectTimelineTransition: (trackId: string, itemId: string, edge: 'in' | 'out') => void;
  emitOpenSpeedModal: (payload: { trackId: string; itemId: string; speed: number }) => void;
  emitClipAction: (payload: {
    action: 'extractAudio' | 'returnAudio' | 'freezeFrame' | 'resetFreezeFrame';
    trackId: string;
    itemId: string;
    videoItemId?: string;
  }) => void;
  t: (key: string, ...args: (string | number)[]) => string;
}

export function useClipContextMenu(options: UseClipContextMenuOptions) {
  const contextMenuItems = computed(() => {
    const track = options.track.value;
    const item = options.item.value;

    if (!item) return [];

    const isMultiSelection =
      options.selectedItemIds.value.length > 1 && options.selectedItemIds.value.includes(item.id);

    if (isMultiSelection) {
      const doc = options.timelineDoc.value;
      const selectedClips: TimelineClipItem[] = [];
      const itemsToUpdate: { trackId: string; itemId: string }[] = [];

      if (doc) {
        for (const t of doc.tracks) {
          for (const it of t.items) {
            if (options.selectedItemIds.value.includes(it.id)) {
              if (it.kind === 'clip') {
                selectedClips.push(it as TimelineClipItem);
              }
              itemsToUpdate.push({ trackId: t.id, itemId: it.id });
            }
          }
        }
      }

      const allDisabled = selectedClips.length > 0 && selectedClips.every((c) => c.disabled);

      let hasAudioOrVideoWithAudio = false;
      let hasVideo = false;
      let allMuted = true;
      let allShowWaveform = true;
      let allShowThumbnails = true;
      let allWaveformHalf = true;

      if (doc) {
        for (const { trackId, itemId } of itemsToUpdate) {
          const tr = doc.tracks.find((t) => t.id === trackId);
          if (!tr) continue;
          const clip = tr.items.find((it) => it.id === itemId);
          if (!clip || clip.kind !== 'clip') continue;

          if (tr.kind === 'video') hasVideo = true;

          const hasAudio =
            tr.kind === 'audio' ||
            (tr.kind === 'video' &&
              clip.clipType === 'media' &&
              (clip.linkedVideoClipId || (clip.source as any)?.hasAudio));
          if (hasAudio) hasAudioOrVideoWithAudio = true;

          if (!clip.audioMuted) allMuted = false;
          if (clip.showWaveform === false) allShowWaveform = false;
          if (clip.showThumbnails === false) allShowThumbnails = false;
          if (clip.audioWaveformMode === 'full') allWaveformHalf = false;
        }
      }

      const mainGroup: { label: string; icon: string; onSelect: () => void; disabled?: boolean }[] =
        [];

      mainGroup.push({
        label: allDisabled
          ? options.t('granVideoEditor.timeline.enableClips', 'Enable clips')
          : options.t('granVideoEditor.timeline.disableClips', 'Disable clips'),
        icon: allDisabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
        onSelect: async () => {
          const cmds = itemsToUpdate.map(({ trackId, itemId }) => ({
            type: 'update_clip_properties' as const,
            trackId,
            itemId,
            properties: { disabled: !allDisabled },
          }));
          options.batchApplyTimeline(cmds);
          await options.requestTimelineSave({ immediate: true });
        },
      });

      if (hasAudioOrVideoWithAudio) {
        mainGroup.push({
          label: allMuted
            ? options.t('granVideoEditor.timeline.unmuteClips', 'Unmute clips')
            : options.t('granVideoEditor.timeline.muteClips', 'Mute clips'),
          icon: allMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark',
          onSelect: async () => {
            const cmds = itemsToUpdate.map(({ trackId, itemId }) => ({
              type: 'update_clip_properties' as const,
              trackId,
              itemId,
              properties: { audioMuted: !allMuted },
            }));
            options.batchApplyTimeline(cmds);
            await options.requestTimelineSave({ immediate: true });
          },
        });

        mainGroup.push({
          label: allWaveformHalf
            ? options.t('granVideoEditor.timeline.waveformFull', 'Waveform: Full')
            : options.t('granVideoEditor.timeline.waveformHalf', 'Waveform: Half'),
          icon: 'i-heroicons-chart-bar',
          onSelect: async () => {
            const cmds = itemsToUpdate.map(({ trackId, itemId }) => ({
              type: 'update_clip_properties' as const,
              trackId,
              itemId,
              properties: {
                audioWaveformMode: (allWaveformHalf ? 'full' : 'half') as 'full' | 'half',
              },
            }));
            options.batchApplyTimeline(cmds);
            await options.requestTimelineSave({ immediate: true });
          },
        });
      }

      if (hasVideo) {
        mainGroup.push({
          label: allShowWaveform
            ? options.t('granVideoEditor.timeline.hideWaveform', 'Hide Waveform')
            : options.t('granVideoEditor.timeline.showWaveform', 'Show Waveform'),
          icon: allShowWaveform ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
          onSelect: async () => {
            const cmds = itemsToUpdate.map(({ trackId, itemId }) => ({
              type: 'update_clip_properties' as const,
              trackId,
              itemId,
              properties: { showWaveform: !allShowWaveform },
            }));
            options.batchApplyTimeline(cmds);
            await options.requestTimelineSave({ immediate: true });
          },
        });
 
        mainGroup.push({
          label: allShowThumbnails
            ? options.t('granVideoEditor.timeline.hideThumbnails', 'Hide Thumbnails')
            : options.t('granVideoEditor.timeline.showThumbnails', 'Show Thumbnails'),
          icon: 'i-heroicons-photo',
          onSelect: async () => {
            const cmds = itemsToUpdate.map(({ trackId, itemId }) => ({
              type: 'update_clip_properties' as const,
              trackId,
              itemId,
              properties: { showThumbnails: !allShowThumbnails },
            }));
            options.batchApplyTimeline(cmds);
            await options.requestTimelineSave({ immediate: true });
          },
        });
      }

      const actionGroup = [
        {
          label: options.t('granVideoEditor.timeline.delete', 'Delete'),
          icon: 'i-heroicons-trash',
          onSelect: () => {
            options.clearSelection();
            const cmds = itemsToUpdate.map(({ trackId, itemId }) => ({
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

    if (item.kind === 'gap') {
      return [
        [
          {
            label: options.t('granVideoEditor.timeline.delete', 'Delete'),
            icon: 'i-heroicons-trash',
            onSelect: () => {
              options.applyTimelineCommand({
                type: 'delete_items',
                trackId: track.id,
                itemIds: [item.id],
              });
            },
          },
        ],
      ];
    }

    const mainGroup: { label: string; icon: string; onSelect: () => void; disabled?: boolean }[] =
      [];

    if (item.kind === 'clip') {
      const clipItem = item as TimelineClipItem;

      mainGroup.push({
        label: clipItem.disabled
          ? options.t('granVideoEditor.timeline.enableClip', 'Enable clip')
          : options.t('granVideoEditor.timeline.disableClip', 'Disable clip'),
        icon: clipItem.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
        onSelect: async () => {
          options.updateClipProperties(track.id, clipItem.id, {
            disabled: !clipItem.disabled,
          });
          await options.requestTimelineSave({ immediate: true });
        },
      });

      const hasAudio =
        options.track.value.kind === 'audio' ||
        clipItem.clipType === 'media' ||
        clipItem.clipType === 'timeline';
      if (hasAudio) {
        mainGroup.push({
          label: clipItem.audioMuted
            ? options.t('granVideoEditor.timeline.unmuteClip', 'Unmute')
            : options.t('granVideoEditor.timeline.muteClip', 'Mute'),
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
              ? options.t('granVideoEditor.timeline.waveformFull', 'Full waveform')
              : options.t('granVideoEditor.timeline.waveformHalf', 'Half waveform'),
          icon: 'i-heroicons-chart-bar',
          onSelect: async () => {
            options.updateClipProperties(track.id, clipItem.id, {
              audioWaveformMode: currentMode === 'half' ? 'full' : 'half',
            });
            await options.requestTimelineSave({ immediate: true });
          },
        });
      }

      mainGroup.push({
        label: clipItem.locked
          ? options.t('granVideoEditor.timeline.unlockClip', 'Unlock clip')
          : options.t('granVideoEditor.timeline.lockClip', 'Lock clip'),
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
          label: clipItem.showThumbnails === false
            ? options.t('granVideoEditor.timeline.showThumbnails', 'Show thumbnails')
            : options.t('granVideoEditor.timeline.hideThumbnails', 'Hide thumbnails'),
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
        label: `${options.t('granVideoEditor.timeline.speed', 'Speed')} (${currentSpeed.toFixed(2)})`,
        icon: 'i-heroicons-forward',
        onSelect: () =>
          options.emitOpenSpeedModal({
            trackId: track.id,
            itemId: clipItem.id,
            speed: currentSpeed,
          }),
      });

      const canExtract =
        track.kind === 'video' &&
        clipItem.clipType === 'media' &&
        !(clipItem as any).audioFromVideoDisabled;
      if (canExtract) {
        mainGroup.push({
          label: options.t('granVideoEditor.timeline.extractAudio', 'Extract audio to audio track'),
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
        docTracks.some((t: TimelineTrack) =>
          t.kind !== 'audio'
            ? false
            : (t.items ?? []).some(
                (it: TimelineTrackItem) =>
                  it.kind === 'clip' &&
                  it.linkedVideoClipId === clipItem.id &&
                  Boolean(it.lockToLinkedVideo),
              ),
        );

      const hasReturnFromLockedAudioClip =
        track.kind === 'audio' &&
        Boolean(clipItem.linkedVideoClipId) &&
        Boolean(clipItem.lockToLinkedVideo);

      if (hasReturnFromVideoClip) {
        mainGroup.push({
          label: options.t('granVideoEditor.timeline.returnAudio', 'Return audio to video clip'),
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
          label: options.t('granVideoEditor.timeline.returnAudio', 'Return audio to video clip'),
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
          label: options.t('granVideoEditor.timeline.freezeFrame', 'Freeze frame'),
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
          label: options.t('granVideoEditor.timeline.resetFreezeFrame', 'Reset freeze frame'),
          icon: 'i-heroicons-play-circle',
          onSelect: () =>
            options.emitClipAction({
              action: 'resetFreezeFrame',
              trackId: track.id,
              itemId: clipItem.id,
            }),
        });
      }
    }

    const actionGroup: { label: string; icon: string; onSelect: () => void; disabled?: boolean }[] =
      [
        {
          label: options.t('granVideoEditor.timeline.delete', 'Delete'),
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

    const result = [];
    if (mainGroup.length > 0) result.push(mainGroup);

    if (item.kind === 'clip' && track.kind === 'video') {
      const clipItem = item as TimelineClipItem;
      const hasIn = Boolean(clipItem.transitionIn);
      const hasOut = Boolean(clipItem.transitionOut);
      const transitionGroup: { label: string; icon: string; onSelect: () => void }[] = [];

      const defaultTransitionDurationUs = Math.max(
        0,
        Math.round(
          Number(options.projectSettings.value?.transitions?.defaultDurationUs ?? 2_000_000),
        ),
      );
      const clipDurationUs = Math.max(
        0,
        Math.round(Number((item as TimelineClipItem).timelineRange?.durationUs ?? 0)),
      );
      const suggestedDurationUs =
        clipDurationUs > 0 && clipDurationUs < defaultTransitionDurationUs
          ? Math.round(clipDurationUs * 0.3)
          : defaultTransitionDurationUs;

      transitionGroup.push({
        label: hasIn
          ? options.t('granVideoEditor.timeline.removeTransitionIn')
          : options.t('granVideoEditor.timeline.addTransitionIn'),
        icon: hasIn ? 'i-heroicons-x-circle' : 'i-heroicons-arrow-left-end-on-rectangle',
        onSelect: () => {
          if (hasIn) {
            options.updateClipTransition(track.id, item.id, { transitionIn: null });
            options.clearSelection();
          } else {
            const transition = {
              type: 'dissolve',
              durationUs: suggestedDurationUs,
              mode: 'blend' as const,
              curve: 'linear' as const,
            };
            options.updateClipTransition(track.id, item.id, { transitionIn: transition });
            options.selectTransition({ trackId: track.id, itemId: item.id, edge: 'in' });
            options.selectTimelineTransition(track.id, item.id, 'in');
          }
        },
      });

      transitionGroup.push({
        label: hasOut
          ? options.t('granVideoEditor.timeline.removeTransitionOut')
          : options.t('granVideoEditor.timeline.addTransitionOut'),
        icon: hasOut ? 'i-heroicons-x-circle' : 'i-heroicons-arrow-right-end-on-rectangle',
        onSelect: () => {
          if (hasOut) {
            options.updateClipTransition(track.id, item.id, { transitionOut: null });
            options.clearSelection();
          } else {
            const transition = {
              type: 'dissolve',
              durationUs: suggestedDurationUs,
              mode: 'blend' as const,
              curve: 'linear' as const,
            };
            options.updateClipTransition(track.id, item.id, { transitionOut: transition });
            options.selectTransition({ trackId: track.id, itemId: item.id, edge: 'out' });
            options.selectTimelineTransition(track.id, item.id, 'out');
          }
        },
      });

      if (transitionGroup.length > 0) result.push(transitionGroup);
    }

    result.push(actionGroup);

    return result;
  });

  return { contextMenuItems };
}
