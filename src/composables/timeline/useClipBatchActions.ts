import { computed, type Ref } from 'vue';
import { sanitizeFps } from '~/timeline/commands/utils';
import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';
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

export interface ClipBatchActionsContext {
  timelineDoc: Ref<TimelineDocument | null>;
  mediaMetadata: Ref<Record<string, unknown>>;
  batchApplyTimeline: (cmds: unknown[], options?: { labelKey?: string }) => void;
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

  const hasLockedLinks = computed(() => {
    const doc = ctx.timelineDoc.value;
    if (!doc) return false;

    const selectedIds = new Set(items.value.map((x) => x.itemId));

    for (const track of doc.tracks) {
      for (const it of track.items) {
        if (!selectedIds.has(it.id)) continue;
        if (it.kind !== 'clip') continue;
        if (
          track.kind === 'audio' &&
          Boolean((it as TimelineClipItem).linkedVideoClipId) &&
          Boolean((it as TimelineClipItem).lockToLinkedVideo)
        ) {
          return true;
        }
        if (track.kind === 'video') {
          const videoId = it.id;
          const hasLinkedAudio = doc.tracks
            .filter((t) => t.kind === 'audio')
            .some((t) =>
              t.items.some(
                (a) =>
                  a.kind === 'clip' &&
                  Boolean((a as TimelineClipItem).linkedVideoClipId) &&
                  Boolean((a as TimelineClipItem).lockToLinkedVideo) &&
                  String((a as TimelineClipItem).linkedVideoClipId) === videoId,
              ),
            );
          if (hasLinkedAudio) return true;
        }
      }
    }
    return false;
  });

  const hasGroupedClip = computed(() =>
    selectedClips.value.some(
      (clip) => typeof clip.linkedGroupId === 'string' && clip.linkedGroupId.trim().length > 0,
    ),
  );

  const hasFreeClip = computed(() => {
    const doc = ctx.timelineDoc.value;
    if (!doc) return false;
    const fps = sanitizeFps(doc.timebase?.fps);
    return selectedClips.value.some((clip) => {
      const startFrame = (clip.timelineRange.startUs * fps) / 1_000_000;
      const durFrame = (clip.timelineRange.durationUs * fps) / 1_000_000;
      const isStartQuantized = Math.abs(startFrame - Math.round(startFrame)) < 0.001;
      const isDurationQuantized = Math.abs(durFrame - Math.round(durFrame)) < 0.001;
      return !isStartQuantized || !isDurationQuantized;
    });
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
    const doc = ctx.timelineDoc.value;
    if (!doc) return;

    const safeDeltaUs = Math.round(Number(deltaUs));
    if (!Number.isFinite(safeDeltaUs) || safeDeltaUs === 0) return;

    const cmds: unknown[] = [];

    for (const { trackId, itemId } of items.value) {
      const track = doc.tracks.find((t) => t.id === trackId);
      if (!track || track.locked) continue;
      const clip = track.items.find((it) => it.id === itemId);
      if (!clip || clip.kind !== 'clip') continue;
      if ((clip as TimelineClipItem).locked) continue;

      cmds.push({
        type: 'move_item',
        trackId,
        itemId,
        startUs: Math.max(0, clip.timelineRange.startUs + safeDeltaUs),
      });
    }

    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds, { labelKey: 'videoEditor.fileManager.history.entries.moveItems' });
  }

  function handleRelativeEndShift(deltaUs: number) {
    const doc = ctx.timelineDoc.value;
    if (!doc) return;

    const safeDeltaUs = Math.round(Number(deltaUs));
    if (!Number.isFinite(safeDeltaUs) || safeDeltaUs === 0) return;

    const cmds: unknown[] = [];

    for (const { trackId, itemId } of items.value) {
      const track = doc.tracks.find((t) => t.id === trackId);
      if (!track || track.locked) continue;
      const clip = track.items.find((it) => it.id === itemId);
      if (!clip || clip.kind !== 'clip') continue;
      if ((clip as TimelineClipItem).locked) continue;

      cmds.push({
        type: 'trim_item',
        trackId,
        itemId,
        edge: 'end',
        deltaUs: safeDeltaUs,
      });
    }

    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds, { labelKey: 'videoEditor.fileManager.history.entries.trimClip' });
  }

  function toggleLocked() {
    const nextVal = !allLocked.value;
    const cmds = items.value.map(({ trackId, itemId }) => ({
      type: 'update_clip_properties' as const,
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
    const cmds = Array.from(trackIds).map((trackId) => ({
      type: 'update_track_properties' as const,
      trackId,
      properties: { audioSolo: nextVal },
    }));
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.toggleSolo',
    });
  }

  function handleUnlinkSelected() {
    const doc = ctx.timelineDoc.value;
    if (!doc) return;

    const selectedIds = new Set(items.value.map((x) => x.itemId));
    const videoIds: string[] = [];

    for (const track of doc.tracks) {
      for (const it of track.items) {
        if (!selectedIds.has(it.id)) continue;
        if (it.kind !== 'clip') continue;
        if (track.kind === 'video') videoIds.push(it.id);
      }
    }

    const cmds: Array<{
      type: 'unlink_audio_from_video';
      audioTrackId: string;
      audioItemId: string;
    }> = [];

    for (const track of doc.tracks) {
      if (track.kind !== 'audio') continue;
      for (const it of track.items) {
        if (it.kind !== 'clip') continue;
        const linked = String((it as TimelineClipItem).linkedVideoClipId ?? '');
        const isLocked = Boolean((it as TimelineClipItem).lockToLinkedVideo);

        const shouldUnlink =
          (selectedIds.has(it.id) &&
            Boolean((it as TimelineClipItem).linkedVideoClipId) &&
            isLocked) ||
          (videoIds.length > 0 && isLocked && linked && videoIds.includes(linked));

        if (!shouldUnlink) continue;

        cmds.push({
          type: 'unlink_audio_from_video',
          audioTrackId: track.id,
          audioItemId: it.id,
        });
      }
    }

    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.unlinkAudio',
    });
  }

  function handleGroupSelected() {
    if (items.value.length < 2) return;

    const nextGroupId = generatedGroupId();
    const cmds = items.value.map(({ trackId, itemId }) => ({
      type: 'update_clip_properties' as const,
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
    const cmds = items.value.map(({ trackId, itemId }) => ({
      type: 'update_clip_properties' as const,
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
    const cmds = items.value.map(({ trackId, itemId }) => ({
      type: 'delete_items' as const,
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
    const cmds = selectedClipRefs.value.map(({ track, clip }) => ({
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
    const cmds = audioClipRefs.value.map(({ track, clip }) => ({
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
    const cmds = waveformClipRefs.value.map(({ track, clip }) => ({
      type: 'update_clip_properties' as const,
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
    const cmds = waveformClipRefs.value.map(({ track, clip }) => ({
      type: 'update_clip_properties' as const,
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
    const cmds = thumbnailClipRefs.value.map(({ track, clip }) => ({
      type: 'update_clip_properties' as const,
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
    const doc = ctx.timelineDoc.value;
    if (!doc) return;

    const nextDurationUs = Math.max(1, Math.round(Number(durationUs)));
    if (!Number.isFinite(nextDurationUs)) return;

    const cmds: unknown[] = [];

    for (const { trackId, itemId } of items.value) {
      const track = doc.tracks.find((t) => t.id === trackId);
      if (!track || track.locked) continue;
      const clip = track.items.find((it) => it.id === itemId);
      if (!clip || clip.kind !== 'clip') continue;
      if ((clip as TimelineClipItem).locked) continue;

      const currentDurationUs = Math.max(0, Math.round(Number(clip.timelineRange.durationUs)));
      const deltaUs = nextDurationUs - currentDurationUs;
      if (deltaUs === 0) continue;

      cmds.push({
        type: 'trim_item',
        trackId,
        itemId,
        edge: 'end',
        deltaUs,
      });
    }

    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds, {
      labelKey: 'videoEditor.fileManager.history.entries.updateClip',
    });
  }

  function handleBatchUpdateProperties(
    properties: Partial<TimelineClipItem> | ((clip: TimelineClipItem) => Partial<TimelineClipItem>),
    targets: Array<{ trackId: string; itemId: string }> = items.value,
  ) {
    const doc = ctx.timelineDoc.value;
    const cmds = targets
      .map(({ trackId, itemId }) => {
        let props = properties;
        if (typeof properties === 'function') {
          const track = doc?.tracks.find((t) => t.id === trackId);
          const clip = track?.items.find((it) => it.id === itemId) as TimelineClipItem;
          props = clip ? properties(clip) : {};
        }
        return {
          type: 'update_clip_properties' as const,
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

  function handleQuantizeSelected() {
    const doc = ctx.timelineDoc.value;
    if (!doc) return;
    const fps = sanitizeFps(doc.timebase?.fps);

    const cmds: Array<{
      type: 'trim_item';
      trackId: string;
      itemId: string;
      edge: 'end';
      deltaUs: number;
      quantizeToFrames: true;
    }> = [];

    for (const { trackId, itemId } of items.value) {
      const track = doc.tracks.find((t) => t.id === trackId);
      if (!track || track.locked) continue;
      const clip = track.items.find((it) => it.id === itemId);
      if (!clip || clip.kind !== 'clip') continue;
      if ((clip as TimelineClipItem).locked) continue;

      const startFrame = (clip.timelineRange.startUs * fps) / 1_000_000;
      const durFrame = (clip.timelineRange.durationUs * fps) / 1_000_000;
      const isStartQuantized = Math.abs(startFrame - Math.round(startFrame)) < 0.001;
      const isDurationQuantized = Math.abs(durFrame - Math.round(durFrame)) < 0.001;
      const isFree = !isStartQuantized || !isDurationQuantized;
      if (!isFree) continue;

      cmds.push({
        type: 'trim_item',
        trackId,
        itemId,
        edge: 'end',
        deltaUs: 0,
        quantizeToFrames: true,
      });
    }

    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds);
  }

  return {
    selectedClips,
    hasLockedLinks,
    hasGroupedClip,
    hasFreeClip,
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
    handleUnlinkSelected,
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
    handleQuantizeSelected,
    handleBatchUpdateProperties,
    firstVideoClip,
    firstWaveformClip,
    firstSpeedClip,
    firstSourceOrientationClip,
  };
}
