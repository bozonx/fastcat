import { computed, type Ref } from 'vue';
import { sanitizeFps } from '~/timeline/commands/utils';
import type { TimelineClipItem, TimelineDocument } from '~/timeline/types';

export interface ClipBatchActionsContext {
  timelineDoc: Ref<TimelineDocument | null>;
  mediaMetadata: Ref<Record<string, any>>;
  batchApplyTimeline: (cmds: any[]) => void;
  clearSelection: () => void;
}

export function useClipBatchActions(
  items: Ref<{ trackId: string; itemId: string }[]>,
  ctx: ClipBatchActionsContext
) {
  const generatedGroupId = () =>
    `linked-group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const selectedClips = computed(() => {
    const clips: TimelineClipItem[] = [];
    const doc = ctx.timelineDoc.value;
    if (!doc) return clips;

    for (const { trackId, itemId } of items.value) {
      const track = doc.tracks.find((t) => t.id === trackId);
      if (!track) continue;
      const clip = track.items.find((it) => it.id === itemId);
      if (clip && clip.kind === 'clip') {
        clips.push(clip as TimelineClipItem);
      }
    }
    return clips;
  });

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
          Boolean((it as any).linkedVideoClipId) &&
          Boolean((it as any).lockToLinkedVideo)
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
                  Boolean((a as any).linkedVideoClipId) &&
                  Boolean((a as any).lockToLinkedVideo) &&
                  String((a as any).linkedVideoClipId) === videoId,
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

  const allDisabled = computed(() => selectedClips.value.every((c) => c.disabled));
  const allMuted = computed(() => selectedClips.value.every((c) => c.audioMuted));
  
  const firstWaveformClip = computed(() => {
    const doc = ctx.timelineDoc.value;
    if (!doc) return undefined;
    for (const { trackId, itemId } of items.value) {
      const track = doc.tracks.find((t) => t.id === trackId);
      if (!track) continue;
      const clip = track.items.find((it) => it.id === itemId);
      if (!clip || clip.kind !== 'clip') continue;

      const isAudioTrack = track.kind === 'audio';
      const isVideoWithAudio =
        track.kind === 'video' &&
        clip.clipType === 'media' &&
        (Boolean((clip as any).linkedVideoClipId) ||
          Boolean(ctx.mediaMetadata.value[clip.source?.path ?? '']?.audio));

      if (isAudioTrack || isVideoWithAudio) return clip as TimelineClipItem;
    }
    return undefined;
  });

  const firstVideoClip = computed(() => {
    const doc = ctx.timelineDoc.value;
    if (!doc) return undefined;
    for (const { trackId, itemId } of items.value) {
      const track = doc.tracks.find((t) => t.id === trackId);
      if (!track) continue;
      const clip = track.items.find((it) => it.id === itemId);
      if (!clip || clip.kind !== 'clip') continue;

      if (track.kind === 'video') return clip as TimelineClipItem;
    }
    return undefined;
  });

  const isWaveformShown = computed(() => firstWaveformClip.value?.showWaveform !== false);
  const isWaveformFull = computed(() => firstWaveformClip.value?.audioWaveformMode !== 'half');
  const isThumbnailsShown = computed(() => firstVideoClip.value?.showThumbnails !== false);

  const hasAudioOrVideoWithAudio = computed(() => Boolean(firstWaveformClip.value));
  const hasVideo = computed(() => Boolean(firstVideoClip.value));

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
      type: 'update_clip_properties';
      trackId: string;
      itemId: string;
      properties: { linkedVideoClipId: undefined; lockToLinkedVideo: false };
    }> = [];

    for (const track of doc.tracks) {
      if (track.kind !== 'audio') continue;
      for (const it of track.items) {
        if (it.kind !== 'clip') continue;
        const linked = String((it as any).linkedVideoClipId ?? '');
        const isLocked = Boolean((it as any).lockToLinkedVideo);

        const shouldUnlink =
          (selectedIds.has(it.id) && Boolean((it as any).linkedVideoClipId) && isLocked) ||
          (videoIds.length > 0 && isLocked && linked && videoIds.includes(linked));

        if (!shouldUnlink) continue;

        cmds.push({
          type: 'update_clip_properties',
          trackId: track.id,
          itemId: it.id,
          properties: { linkedVideoClipId: undefined, lockToLinkedVideo: false },
        });
      }
    }

    if (cmds.length === 0) return;
    ctx.batchApplyTimeline(cmds as any);
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

    ctx.batchApplyTimeline(cmds as any);
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

    ctx.batchApplyTimeline(cmds as any);
  }

  function handleDelete() {
    const cmds = items.value.map(({ trackId, itemId }) => ({
      type: 'delete_items' as const,
      trackId,
      itemIds: [itemId],
    }));
    ctx.batchApplyTimeline(cmds);
    ctx.clearSelection();
  }

  function toggleDisabled() {
    const nextVal = !allDisabled.value;
    const cmds = items.value.map(({ trackId, itemId }) => ({
      type: 'update_clip_properties' as const,
      trackId,
      itemId,
      properties: { disabled: nextVal },
    }));
    ctx.batchApplyTimeline(cmds);
  }

  function toggleMuted() {
    const nextVal = !allMuted.value;
    const cmds = items.value.map(({ trackId, itemId }) => ({
      type: 'update_clip_properties' as const,
      trackId,
      itemId,
      properties: { audioMuted: nextVal },
    }));
    ctx.batchApplyTimeline(cmds);
  }

  function toggleShowWaveform() {
    const nextVal = !isWaveformShown.value;
    const cmds = items.value.map(({ trackId, itemId }) => ({
      type: 'update_clip_properties' as const,
      trackId,
      itemId,
      properties: { showWaveform: nextVal },
    }));
    ctx.batchApplyTimeline(cmds);
  }

  function toggleWaveformMode() {
    const nextVal: 'full' | 'half' = isWaveformFull.value ? 'half' : 'full';
    const cmds = items.value.map(({ trackId, itemId }) => ({
      type: 'update_clip_properties' as const,
      trackId,
      itemId,
      properties: { audioWaveformMode: nextVal },
    }));
    ctx.batchApplyTimeline(cmds);
  }

  function toggleShowThumbnails() {
    const nextVal = !isThumbnailsShown.value;
    const cmds = items.value.map(({ trackId, itemId }) => ({
      type: 'update_clip_properties' as const,
      trackId,
      itemId,
      properties: { showThumbnails: nextVal },
    }));
    ctx.batchApplyTimeline(cmds);
  }

  function handleSetUniformDuration(durationUs: number) {
    const doc = ctx.timelineDoc.value;
    if (!doc) return;

    const nextDurationUs = Math.max(1, Math.round(Number(durationUs)));
    if (!Number.isFinite(nextDurationUs)) return;

    const cmds: Array<{
      type: 'trim_item';
      trackId: string;
      itemId: string;
      edge: 'end';
      deltaUs: number;
    }> = [];

    for (const { trackId, itemId } of items.value) {
      const track = doc.tracks.find((t) => t.id === trackId);
      if (!track) continue;
      const clip = track.items.find((it) => it.id === itemId);
      if (!clip || clip.kind !== 'clip') continue;
      if ((clip as any).locked) continue;

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
    ctx.batchApplyTimeline(cmds);
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
      if (!track) continue;
      const clip = track.items.find((it) => it.id === itemId);
      if (!clip || clip.kind !== 'clip') continue;
      if ((clip as any).locked) continue;

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
    isWaveformShown,
    isWaveformFull,
    isThumbnailsShown,
    hasAudioOrVideoWithAudio,
    hasVideo,
    handleUnlinkSelected,
    handleGroupSelected,
    handleUngroupSelected,
    handleDelete,
    toggleDisabled,
    toggleMuted,
    toggleShowWaveform,
    toggleWaveformMode,
    toggleShowThumbnails,
    handleSetUniformDuration,
    handleQuantizeSelected,
  };
}
