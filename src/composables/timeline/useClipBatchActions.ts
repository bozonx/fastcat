import { computed, type Ref } from 'vue';
import { sanitizeFps } from '~/timeline/commands/utils';
import type { TimelineCommand, UpdateClipPropertiesCommand } from '~/timeline/commands';
import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';
import { isClipItem } from '~/timeline/types';
import { createLinkedGroupId } from '~/timeline/id';
import {
  clipSupportsAudioControls,
  clipSupportsAutoMontage,
  clipSupportsSourceOrientation,
  clipSupportsSpeedControls,
  clipSupportsThumbnailControls,
  clipSupportsVisualControls,
  clipSupportsWaveformControls,
  getSelectedClipRefs,
} from '~/utils/timeline/clip-capabilities';

type ClipPropertiesPatch = UpdateClipPropertiesCommand['properties'];

export interface ClipBatchActionsContext {
  timelineDoc: Ref<TimelineDocument | null>;
  mediaMetadata: Ref<Record<string, unknown>>;
  batchApplyTimeline: (
    cmds: TimelineCommand[],
    options?: { labelKey?: string; historyMode?: 'immediate' | 'debounced' },
  ) => void;
  clearSelection: () => void;
}

export function useClipBatchActions(
  items: Ref<{ trackId: string; itemId: string }[]>,
  ctx: ClipBatchActionsContext,
) {
  const generatedGroupId = () => createLinkedGroupId();

  const selectedClipRefs = computed(() => getSelectedClipRefs(ctx.timelineDoc.value, items.value));
  const selectedClips = computed(() => {
    return selectedClipRefs.value.map(({ clip }) => clip);
  });

  // Selected clips whose track and clip are both unlocked — the only ones that
  // timing edits (move/trim/quantize) are allowed to touch.
  const editableClipRefs = computed(() =>
    selectedClipRefs.value.filter(({ track, clip }) => !track.locked && !clip.locked),
  );

  const audioClipRefs = computed(() =>
    selectedClipRefs.value.filter(({ track, clip }) => clipSupportsAudioControls(track, clip)),
  );
  const waveformClipRefs = computed(() =>
    selectedClipRefs.value.filter(({ track, clip }) => clipSupportsWaveformControls(track, clip)),
  );
  const thumbnailClipRefs = computed(() =>
    selectedClipRefs.value.filter(({ track, clip }) => clipSupportsThumbnailControls(track, clip)),
  );
  const visualClipRefs = computed(() =>
    selectedClipRefs.value.filter(({ track }) => clipSupportsVisualControls(track)),
  );
  const speedClipRefs = computed(() =>
    selectedClipRefs.value.filter(({ track, clip }) => clipSupportsSpeedControls(track, clip)),
  );
  const sourceOrientationClipRefs = computed(() =>
    selectedClipRefs.value.filter(({ track, clip }) => clipSupportsSourceOrientation(track, clip)),
  );
  const autoMontageClipRefs = computed(() =>
    selectedClipRefs.value.filter(({ track, clip }) => clipSupportsAutoMontage(track, clip)),
  );

  const hasGroupedClip = computed(() =>
    selectedClips.value.some(
      (clip) => typeof clip.linkedGroupId === 'string' && clip.linkedGroupId.trim().length > 0,
    ),
  );

  const isSingleGroupSelection = computed(() => {
    if (selectedClips.value.length < 2) return false;
    const firstGroupId = String(selectedClips.value[0]?.linkedGroupId ?? '').trim();
    if (!firstGroupId) return false;
    return selectedClips.value.every(
      (clip) => String(clip.linkedGroupId ?? '').trim() === firstGroupId,
    );
  });

  const allDisabled = computed(() => {
    if (selectedClips.value.length === 0) return false;
    return selectedClips.value.every((c) => c.disabled);
  });

  const allMuted = computed(() => {
    if (audioClipRefs.value.length === 0) return false;
    return audioClipRefs.value.every(({ clip }) => clip.audioMuted);
  });

  const allLocked = computed(() => selectedClips.value.every((c) => c.locked));

  const allSoloed = computed(() => {
    const doc = ctx.timelineDoc.value;
    if (!doc) return false;
    const trackIds = new Set(items.value.map((x) => x.trackId));
    const tracks = doc.tracks.filter((t) => trackIds.has(t.id));
    if (tracks.length === 0) return false;
    return tracks.every((t) => t.audioSolo);
  });

  const firstWaveformClip = computed(() => {
    return waveformClipRefs.value[0]?.clip;
  });

  const firstVideoClip = computed(() => {
    return visualClipRefs.value[0]?.clip;
  });

  const firstSpeedClip = computed(() => speedClipRefs.value[0]?.clip);
  const firstSourceOrientationClip = computed(() => sourceOrientationClipRefs.value[0]?.clip);

  const isWaveformShown = computed(() => firstWaveformClip.value?.showWaveform !== false);
  const isWaveformFull = computed(() => firstWaveformClip.value?.audioWaveformMode !== 'half');
  const isThumbnailsShown = computed(() => firstVideoClip.value?.showThumbnails !== false);

  const hasAudioOrVideoWithAudio = computed(() => audioClipRefs.value.length > 0);
  const hasVideo = computed(() => thumbnailClipRefs.value.length > 0);
  const hasVisual = computed(() => visualClipRefs.value.length > 0);
  const hasSpeedControls = computed(() => speedClipRefs.value.length > 0);
  const hasSourceOrientationControls = computed(() => sourceOrientationClipRefs.value.length > 0);
  const hasAutoMontageControls = computed(() => autoMontageClipRefs.value.length > 0);

  function handleRelativeStartShift(deltaUs: number) {
    const safeDeltaUs = Math.round(Number(deltaUs));
    if (!Number.isFinite(safeDeltaUs) || safeDeltaUs === 0) return;

    const cmds: TimelineCommand[] = [];
    for (const { track, clip } of editableClipRefs.value) {
      cmds.push({
        type: 'move_item',
        trackId: track.id,
        itemId: clip.id,
        startUs: Math.max(0, clip.timelineRange.startUs + safeDeltaUs),
      });
    }

    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.moveItems',
      historyMode: 'debounced',
    });
  }

  function handleRelativeEndShift(deltaUs: number) {
    const safeDeltaUs = Math.round(Number(deltaUs));
    if (!Number.isFinite(safeDeltaUs) || safeDeltaUs === 0) return;

    const cmds: TimelineCommand[] = [];
    for (const { track, clip } of editableClipRefs.value) {
      cmds.push({
        type: 'trim_item',
        trackId: track.id,
        itemId: clip.id,
        edge: 'end',
        deltaUs: safeDeltaUs,
      });
    }

    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.trimClip',
      historyMode: 'debounced',
    });
  }

  function toggleLocked() {
    const nextVal = !allLocked.value;
    const cmds: TimelineCommand[] = items.value.map(({ trackId, itemId }) => ({
      type: 'update_clip_properties',
      trackId,
      itemId,
      properties: { locked: nextVal },
    }));
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.toggleLock',
    });
  }

  function toggleSolo() {
    const doc = ctx.timelineDoc.value;
    if (!doc) return;
    const nextVal = !allSoloed.value;
    const trackIds = new Set(items.value.map((x) => x.trackId));
    const cmds: TimelineCommand[] = Array.from(trackIds).map((trackId) => ({
      type: 'update_track_properties',
      trackId,
      properties: { audioSolo: nextVal },
    }));
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.toggleSolo',
    });
  }

  function handleGroupSelected() {
    if (items.value.length < 2) return;

    const nextGroupId = generatedGroupId();
    const cmds: TimelineCommand[] = items.value.map(({ trackId, itemId }) => ({
      type: 'update_clip_properties',
      trackId,
      itemId,
      properties: {
        linkedGroupId: nextGroupId,
      },
    }));

    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.groupClips',
    });
  }

  function handleUngroupSelected() {
    const cmds: TimelineCommand[] = items.value.map(({ trackId, itemId }) => ({
      type: 'update_clip_properties',
      trackId,
      itemId,
      properties: {
        linkedGroupId: undefined,
      },
    }));

    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.ungroupClips',
    });
  }

  function handleDelete() {
    const cmds: TimelineCommand[] = items.value.map(({ trackId, itemId }) => ({
      type: 'delete_items',
      trackId,
      itemIds: [itemId],
    }));
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.deleteItems',
    });
    ctx.clearSelection();
  }

  function toggleDisabled() {
    const nextVal = !allDisabled.value;
    const cmds: TimelineCommand[] = selectedClipRefs.value.map(({ track, clip }) => ({
      type: 'update_clip_properties',
      trackId: track.id,
      itemId: clip.id,
      properties: { disabled: nextVal },
    }));
    if (cmds.length > 0) {
      ctx.batchApplyTimeline(cmds, {
        labelKey: 'videoEditor.fileManager.history.entries.toggleDisabled',
      });
    }
  }

  function toggleMuted() {
    const nextVal = !allMuted.value;
    const cmds: TimelineCommand[] = audioClipRefs.value.map(({ track, clip }) => ({
      type: 'update_clip_properties',
      trackId: track.id,
      itemId: clip.id,
      properties: { audioMuted: nextVal },
    }));
    if (cmds.length > 0) {
      ctx.batchApplyTimeline(cmds, {
        labelKey: 'videoEditor.fileManager.history.entries.toggleMute',
      });
    }
  }

  function toggleShowWaveform() {
    const nextVal = !isWaveformShown.value;
    const cmds: TimelineCommand[] = waveformClipRefs.value.map(({ track, clip }) => ({
      type: 'update_clip_properties',
      trackId: track.id,
      itemId: clip.id,
      properties: { showWaveform: nextVal },
    }));
    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.toggleWaveform',
    });
  }

  function toggleWaveformMode() {
    const nextVal: 'full' | 'half' = isWaveformFull.value ? 'half' : 'full';
    const cmds: TimelineCommand[] = waveformClipRefs.value.map(({ track, clip }) => ({
      type: 'update_clip_properties',
      trackId: track.id,
      itemId: clip.id,
      properties: { audioWaveformMode: nextVal },
    }));
    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.toggleWaveformMode',
    });
  }

  function toggleShowThumbnails() {
    const nextVal = !isThumbnailsShown.value;
    const cmds: TimelineCommand[] = thumbnailClipRefs.value.map(({ track, clip }) => ({
      type: 'update_clip_properties',
      trackId: track.id,
      itemId: clip.id,
      properties: { showThumbnails: nextVal },
    }));
    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.toggleThumbnails',
    });
  }

  function handleSetUniformDuration(durationUs: number) {
    const nextDurationUs = Math.max(1, Math.round(Number(durationUs)));
    if (!Number.isFinite(nextDurationUs)) return;

    const cmds: TimelineCommand[] = [];
    for (const { track, clip } of editableClipRefs.value) {
      const currentDurationUs = Math.max(0, Math.round(Number(clip.timelineRange.durationUs)));
      const deltaUs = nextDurationUs - currentDurationUs;
      if (deltaUs === 0) continue;

      cmds.push({
        type: 'trim_item',
        trackId: track.id,
        itemId: clip.id,
        edge: 'end',
        deltaUs,
      });
    }

    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.updateClip',
      historyMode: 'debounced',
    });
  }

  function handleBatchUpdateProperties(
    properties: ClipPropertiesPatch | ((clip: TimelineClipItem) => ClipPropertiesPatch),
    targets: Array<{ trackId: string; itemId: string }> = items.value,
  ) {
    const doc = ctx.timelineDoc.value;
    const cmds: TimelineCommand[] = targets
      .map(({ trackId, itemId }): UpdateClipPropertiesCommand => {
        let props: ClipPropertiesPatch;
        if (typeof properties === 'function') {
          const track = doc?.tracks.find((t) => t.id === trackId);
          const clip = track?.items.find((it) => it.id === itemId);
          props = clip && isClipItem(clip) ? properties(clip) : {};
        } else {
          props = properties;
        }
        return {
          type: 'update_clip_properties',
          trackId,
          itemId,
          properties: props,
        };
      })
      .filter((cmd) => Object.keys(cmd.properties).length > 0);
    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.updateClipProperties',
    });
  }

  return {
    selectedClips,
    hasGroupedClip,
    isSingleGroupSelection,
    allDisabled,
    allMuted,
    allLocked,
    allSoloed,
    isWaveformShown,
    isWaveformFull,
    isThumbnailsShown,
    hasAudioOrVideoWithAudio,
    hasVideo,
    hasVisual,
    hasSpeedControls,
    hasSourceOrientationControls,
    hasAutoMontageControls,
    audioClipRefs,
    waveformClipRefs,
    thumbnailClipRefs,
    visualClipRefs,
    speedClipRefs,
    sourceOrientationClipRefs,
    autoMontageClipRefs,
    handleGroupSelected,
    handleUngroupSelected,
    handleDelete,
    toggleDisabled,
    toggleMuted,
    toggleLocked,
    toggleSolo,
    toggleShowWaveform,
    toggleWaveformMode,
    toggleShowThumbnails,
    handleSetUniformDuration,
    handleRelativeStartShift,
    handleRelativeEndShift,
    handleBatchUpdateProperties,
    firstVideoClip,
    firstWaveformClip,
    firstSpeedClip,
    firstSourceOrientationClip,
  };
}
