import { computed, type Ref, type ComputedRef } from 'vue';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

export interface TimelineTracksDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  selectedTrackId: Ref<string | null>;
  applyTimeline: (
    cmd: TimelineCommand,
    options?: { historyMode?: 'immediate' | 'debounced' },
  ) => void;
  batchApplyTimeline: (
    cmds: TimelineCommand[],
    options?: { historyMode?: 'immediate' | 'debounced' },
  ) => void;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  getSelectedOrActiveTrackId: () => string | null;
  selectedItemIds: Ref<string[]>;
}

export interface TimelineTracksModule {
  addTrack: (
    kind: 'video' | 'audio',
    name: string,
    options?: { insertBeforeId?: string; insertAfterId?: string },
  ) => void;
  resolveTargetVideoTrackIdForInsert: () => string;
  resolveMobileTargetTrackId: (kind: 'video' | 'audio') => string;
  renameTrack: (trackId: string, name: string) => void;
  updateTrackProperties: (
    trackId: string,
    properties: Partial<
      Pick<
        TimelineTrack,
        | 'videoHidden'
        | 'opacity'
        | 'blendMode'
        | 'audioMuted'
        | 'audioSolo'
        | 'effects'
        | 'audioGain'
        | 'audioBalance'
        | 'color'
        | 'locked'
      >
    >,
  ) => void;
  toggleVideoHidden: (trackId: string) => void;
  toggleTrackAudioMuted: (trackId: string) => void;
  toggleTrackAudioSolo: (trackId: string) => void;
  deleteTrack: (trackId: string, options?: { allowNonEmpty?: boolean }) => void;
  reorderTracks: (trackIds: string[]) => void;
  toggleVisibilityTargetTrack: () => Promise<void>;
  toggleMuteTargetTrack: () => Promise<void>;
  toggleSoloTargetTrack: () => Promise<void>;
  moveTrackUp: (trackId: string) => void;
  moveTrackDown: (trackId: string) => void;
  isAnyTrackSoloed: ComputedRef<boolean>;
  unsoloAllTracks: () => void;
  unmuteAllTracks: () => void;
  unlockAllTracks: () => void;
  showAllTracks: () => void;
}

export function createTimelineTracksModule(deps: TimelineTracksDeps): TimelineTracksModule {
  function addTrack(
    kind: 'video' | 'audio',
    name: string,
    options?: { insertBeforeId?: string; insertAfterId?: string },
  ) {
    deps.applyTimeline({
      type: 'add_track',
      kind,
      name,
      insertBeforeId: options?.insertBeforeId,
      insertAfterId: options?.insertAfterId,
    });
  }

  function resolveTargetVideoTrackIdForInsert(): string {
    const doc = deps.timelineDoc.value;
    if (!doc) throw new Error('Timeline not loaded');

    const selected =
      typeof deps.selectedTrackId.value === 'string'
        ? (doc.tracks.find((t) => t.id === deps.selectedTrackId.value) ?? null)
        : null;

    if (selected?.kind === 'video') return selected.id;

    const topVideo = doc.tracks.find((t) => t.kind === 'video') ?? null;
    if (!topVideo) throw new Error('No video tracks');
    return topVideo.id;
  }

  function resolveMobileTargetTrackId(kind: 'video' | 'audio'): string {
    const doc = deps.timelineDoc.value;
    if (!doc) throw new Error('Timeline not loaded');

    // 1. If a clip or gap is selected, use its track (if kind matches)
    if (deps.selectedItemIds.value.length > 0) {
      const selectedId = deps.selectedItemIds.value[0];
      const track = doc.tracks.find((t) => t.items.some((it) => it.id === selectedId));
      if (track && track.kind === kind) return track.id;
    }

    // 2. If a track is selected and its type matches, use it
    if (deps.selectedTrackId.value) {
      const selectedTrack = doc.tracks.find((t) => t.id === deps.selectedTrackId.value);
      if (selectedTrack && selectedTrack.kind === kind) return selectedTrack.id;
    }

    // 3. Search backwards for an empty track (no clips)
    const sameKindTracks = doc.tracks.filter((t) => t.kind === kind);
    for (let i = sameKindTracks.length - 1; i >= 0; i--) {
      const t = sameKindTracks[i]!;
      const hasClips = t.items.some((it) => it.kind === 'clip');
      if (!hasClips) return t.id;
    }

    // 4. If no empty track found or no tracks exist, create a new one
    const count = sameKindTracks.length + 1;
    const name = kind === 'video' ? `Video ${count}` : `Audio ${count}`;
    addTrack(kind, name);

    const created = deps.timelineDoc.value?.tracks?.filter((tr) => tr.kind === kind).pop();

    return created?.id ?? (kind === 'video' ? 'v1' : 'a1');
  }

  function renameTrack(trackId: string, name: string) {
    deps.applyTimeline({ type: 'rename_track', trackId, name });
  }

  function updateTrackProperties(
    trackId: string,
    properties: Partial<
      Pick<
        TimelineTrack,
        | 'videoHidden'
        | 'opacity'
        | 'blendMode'
        | 'audioMuted'
        | 'audioSolo'
        | 'effects'
        | 'audioGain'
        | 'audioBalance'
        | 'color'
        | 'locked'
      >
    >,
  ) {
    deps.applyTimeline(
      {
        type: 'update_track_properties',
        trackId,
        properties,
      },
      { historyMode: 'debounced' },
    );
  }

  function toggleVideoHidden(trackId: string) {
    const track = deps.timelineDoc.value?.tracks.find((t) => t.id === trackId);
    if (!track || track.kind !== 'video') return;
    updateTrackProperties(trackId, { videoHidden: !track.videoHidden });
  }

  function toggleTrackAudioMuted(trackId: string) {
    const track = deps.timelineDoc.value?.tracks.find((t) => t.id === trackId);
    if (!track) return;
    updateTrackProperties(trackId, { audioMuted: !track.audioMuted });
  }

  function toggleTrackAudioSolo(trackId: string) {
    const track = deps.timelineDoc.value?.tracks.find((t) => t.id === trackId);
    if (!track) return;
    updateTrackProperties(trackId, { audioSolo: !track.audioSolo });
  }

  function deleteTrack(trackId: string, options?: { allowNonEmpty?: boolean }) {
    deps.applyTimeline({ type: 'delete_track', trackId, allowNonEmpty: options?.allowNonEmpty });
    if (deps.selectedTrackId.value === trackId) {
      deps.selectedTrackId.value = null;
    }
  }

  function reorderTracks(trackIds: string[]) {
    deps.applyTimeline({ type: 'reorder_tracks', trackIds });
  }

  async function toggleVisibilityTargetTrack() {
    const trackId = deps.getSelectedOrActiveTrackId();
    if (!trackId) return;
    const track = deps.timelineDoc.value?.tracks.find((t) => t.id === trackId);
    if (!track) return;

    if (track.kind === 'video') {
      const nextHidden = !track.videoHidden;
      updateTrackProperties(trackId, {
        videoHidden: nextHidden,
        // Auto-mute if becoming hidden, but don't force unmute when becoming visible
        audioMuted: nextHidden ? true : track.audioMuted,
      });
    }
    await deps.requestTimelineSave({ immediate: true });
  }

  async function toggleMuteTargetTrack() {
    const trackId = deps.getSelectedOrActiveTrackId();
    if (!trackId) return;
    toggleTrackAudioMuted(trackId);
    await deps.requestTimelineSave({ immediate: true });
  }

  async function toggleSoloTargetTrack() {
    const trackId = deps.getSelectedOrActiveTrackId();
    if (!trackId) return;
    toggleTrackAudioSolo(trackId);
    await deps.requestTimelineSave({ immediate: true });
  }

  function moveTrackUp(trackId: string) {
    const doc = deps.timelineDoc.value;
    if (!doc) return;
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) return;

    const kind = track.kind;
    const sameKindTracks = doc.tracks.filter((t) => t.kind === kind);
    const idx = sameKindTracks.findIndex((t) => t.id === trackId);
    if (idx <= 0) return; // Already at the top of its kind

    const nextIds = doc.tracks.map((t) => t.id);
    const currentGlobalIdx = nextIds.indexOf(trackId);
    const prevTrackId = sameKindTracks[idx - 1]!.id;
    const prevGlobalIdx = nextIds.indexOf(prevTrackId);

    if (currentGlobalIdx === -1 || prevGlobalIdx === -1) return;

    // Swap
    [nextIds[currentGlobalIdx], nextIds[prevGlobalIdx]] = [
      nextIds[prevGlobalIdx]!,
      nextIds[currentGlobalIdx]!,
    ];

    reorderTracks(nextIds);
    deps.requestTimelineSave({ immediate: true });
  }

  function moveTrackDown(trackId: string) {
    const doc = deps.timelineDoc.value;
    if (!doc) return;
    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) return;

    const kind = track.kind;
    const sameKindTracks = doc.tracks.filter((t) => t.kind === kind);
    const idx = sameKindTracks.findIndex((t) => t.id === trackId);
    if (idx < 0 || idx >= sameKindTracks.length - 1) return; // Already at the bottom of its kind

    const nextIds = doc.tracks.map((t) => t.id);
    const currentGlobalIdx = nextIds.indexOf(trackId);
    const nextTrackId = sameKindTracks[idx + 1]!.id;
    const nextGlobalIdx = nextIds.indexOf(nextTrackId);

    if (currentGlobalIdx === -1 || nextGlobalIdx === -1) return;

    // Swap
    [nextIds[currentGlobalIdx], nextIds[nextGlobalIdx]] = [
      nextIds[nextGlobalIdx]!,
      nextIds[currentGlobalIdx]!,
    ];

    reorderTracks(nextIds);
    deps.requestTimelineSave({ immediate: true });
  }

  const isAnyTrackSoloed = computed(
    () => deps.timelineDoc.value?.tracks.some((t) => t.audioSolo) ?? false,
  );

  function unsoloAllTracks() {
    const tracksWithSolo = deps.timelineDoc.value?.tracks.filter((t) => t.audioSolo) ?? [];
    if (tracksWithSolo.length === 0) return;

    const cmds = tracksWithSolo.map((t) => ({
      type: 'update_track_properties' as const,
      trackId: t.id,
      properties: { audioSolo: false },
    }));

    deps.batchApplyTimeline(cmds, { historyMode: 'debounced' });
    void deps.requestTimelineSave({ immediate: true });
  }

  function unmuteAllTracks() {
    const tracksWithMute = deps.timelineDoc.value?.tracks.filter((t) => t.audioMuted) ?? [];
    if (tracksWithMute.length === 0) return;

    const cmds = tracksWithMute.map((t) => ({
      type: 'update_track_properties' as const,
      trackId: t.id,
      properties: { audioMuted: false },
    }));

    deps.batchApplyTimeline(cmds, { historyMode: 'debounced' });
    void deps.requestTimelineSave({ immediate: true });
  }

  function unlockAllTracks() {
    const tracksWithLock = deps.timelineDoc.value?.tracks.filter((t) => t.locked) ?? [];
    if (tracksWithLock.length === 0) return;

    const cmds = tracksWithLock.map((t) => ({
      type: 'update_track_properties' as const,
      trackId: t.id,
      properties: { locked: false },
    }));

    deps.batchApplyTimeline(cmds, { historyMode: 'debounced' });
    void deps.requestTimelineSave({ immediate: true });
  }

  function showAllTracks() {
    const hiddenTracks = deps.timelineDoc.value?.tracks.filter((t) => t.videoHidden) ?? [];
    if (hiddenTracks.length === 0) return;

    const cmds = hiddenTracks.map((t) => ({
      type: 'update_track_properties' as const,
      trackId: t.id,
      properties: { videoHidden: false },
    }));

    deps.batchApplyTimeline(cmds, { historyMode: 'debounced' });
    void deps.requestTimelineSave({ immediate: true });
  }

  return {
    addTrack,
    resolveTargetVideoTrackIdForInsert,
    resolveMobileTargetTrackId,
    renameTrack,
    updateTrackProperties,
    toggleVideoHidden,
    toggleTrackAudioMuted,
    toggleTrackAudioSolo,
    deleteTrack,
    reorderTracks,
    moveTrackUp,
    moveTrackDown,
    toggleVisibilityTargetTrack,
    toggleMuteTargetTrack,
    toggleSoloTargetTrack,
    isAnyTrackSoloed,
    unsoloAllTracks,
    unmuteAllTracks,
    unlockAllTracks,
    showAllTracks,
  };
}
