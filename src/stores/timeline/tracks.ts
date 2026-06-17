import { computed, type Ref, type ComputedRef } from 'vue';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

export interface TimelineTracksDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;
  selectedTrackId: Ref<string | null>;
  applyTimeline: (
    cmd: TimelineCommand,
    options?: { historyMode?: 'immediate' | 'debounced' },
  ) => void;
  batchApplyTimeline: (cmds: TimelineCommand[], options?: { labelKey?: string }) => void;
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
  resolveMobileTargetTrackId: (
    kind: 'video' | 'audio',
    options?: { durationUs?: number },
  ) => string;
  getMobileSelectionKind: () => 'video' | 'audio' | null;
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
  toggleLockTargetTrack: () => Promise<void>;
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
    if (!doc) return 'v1';

    const selected =
      typeof deps.selectedTrackId.value === 'string'
        ? (doc.tracks.find((t) => t.id === deps.selectedTrackId.value) ?? null)
        : null;

    if (selected?.kind === 'video') return selected.id;

    const topVideo = doc.tracks.find((t) => t.kind === 'video') ?? null;
    if (!topVideo) throw new Error('No video tracks');
    return topVideo.id;
  }

  function trackHasSpaceAtPlayhead(track: TimelineTrack, durationUs?: number): boolean {
    const startUs = Math.max(0, deps.currentTime.value);
    const safeDurationUs =
      typeof durationUs === 'number' && Number.isFinite(durationUs) && durationUs > 0
        ? durationUs
        : 1;
    const endUs = startUs + safeDurationUs;

    return !track.items.some((it) => {
      if (it.kind !== 'clip') return false;
      const itemStartUs = it.timelineRange.startUs;
      const itemEndUs = itemStartUs + it.timelineRange.durationUs;
      return startUs < itemEndUs && endUs > itemStartUs;
    });
  }

  function createMobileTargetTrack(kind: 'video' | 'audio'): string {
    const doc = deps.timelineDoc.value;
    const sameKindTracks = doc?.tracks.filter((t) => t.kind === kind) ?? [];
    const existingIds = new Set(doc?.tracks.map((track) => track.id) ?? []);
    const count = sameKindTracks.length + 1;
    const name = kind === 'video' ? `Video ${count}` : `Audio ${count}`;

    addTrack(kind, name);

    const createdTrack = deps.timelineDoc.value?.tracks.find(
      (track) => track.kind === kind && !existingIds.has(track.id),
    );

    return createdTrack?.id ?? (kind === 'video' ? `v${count}` : `a${count}`);
  }

  function resolveMobileTargetTrackId(
    kind: 'video' | 'audio',
    options?: { durationUs?: number },
  ): string {
    const doc = deps.timelineDoc.value;
    if (!doc) return kind === 'video' ? 'v1' : 'a1';

    const durationUs = options?.durationUs;

    // 1. If a clip or gap is selected, use its track only when the insertion range fits.
    if (deps.selectedItemIds.value.length > 0) {
      const selectedId = deps.selectedItemIds.value[0]!;
      const track = doc.tracks.find((t) => t.items.some((it) => it.id === selectedId));
      if (track?.kind === kind) {
        return trackHasSpaceAtPlayhead(track, durationUs)
          ? track.id
          : createMobileTargetTrack(kind);
      }
    }

    // 2. If a track is selected and its type matches, use it only when the insertion range fits.
    if (deps.selectedTrackId.value) {
      const selectedTrack = doc.tracks.find((t) => t.id === deps.selectedTrackId.value);
      if (selectedTrack?.kind === kind) {
        return trackHasSpaceAtPlayhead(selectedTrack, durationUs)
          ? selectedTrack.id
          : createMobileTargetTrack(kind);
      }
    }

    // 3. With no selected track, try the top track of the requested kind.
    const topTrack = doc.tracks.find((t) => t.kind === kind);
    if (topTrack && trackHasSpaceAtPlayhead(topTrack, durationUs)) return topTrack.id;

    // 4. Otherwise create a new track.
    return createMobileTargetTrack(kind);
  }

  // The kind of the user's current selection (selected clip's track, else selected track).
  // Used to detect when an added clip gets routed to a different track kind than the one the
  // user had focused, so the UI can explain the redirect with a non-blocking toast.
  function getMobileSelectionKind(): 'video' | 'audio' | null {
    const doc = deps.timelineDoc.value;
    if (!doc) return null;

    if (deps.selectedItemIds.value.length > 0) {
      const selectedId = deps.selectedItemIds.value[0]!;
      const track = doc.tracks.find((t) => t.items.some((it) => it.id === selectedId));
      if (track) return track.kind;
    }

    if (deps.selectedTrackId.value) {
      const track = doc.tracks.find((t) => t.id === deps.selectedTrackId.value);
      if (track) return track.kind;
    }

    return null;
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

  async function toggleLockTargetTrack() {
    const trackId = deps.getSelectedOrActiveTrackId();
    if (!trackId) return;
    const track = deps.timelineDoc.value?.tracks.find((t) => t.id === trackId);
    if (!track) return;

    updateTrackProperties(trackId, { locked: !track.locked });
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

  function batchToggleTracks<TKey extends keyof TimelineTrack>(
    predicate: (track: TimelineTrack) => boolean,
    property: TKey,
    value: TimelineTrack[TKey],
    labelKey: string,
  ) {
    const targets = deps.timelineDoc.value?.tracks.filter(predicate) ?? [];
    if (targets.length === 0) return;

    const cmds = targets.map((t) => ({
      type: 'update_track_properties' as const,
      trackId: t.id,
      properties: { [property]: value } as Pick<TimelineTrack, TKey>,
    }));

    deps.batchApplyTimeline(cmds, { labelKey });
    void deps.requestTimelineSave({ immediate: true });
  }

  function unsoloAllTracks() {
    batchToggleTracks(
      (t) => !!t.audioSolo,
      'audioSolo',
      false,
      'videoEditor.fileManager.history.entries.unsoloAllTracks',
    );
  }

  function unmuteAllTracks() {
    batchToggleTracks(
      (t) => !!t.audioMuted,
      'audioMuted',
      false,
      'videoEditor.fileManager.history.entries.unmuteAllTracks',
    );
  }

  function unlockAllTracks() {
    batchToggleTracks(
      (t) => !!t.locked,
      'locked',
      false,
      'videoEditor.fileManager.history.entries.unlockAllTracks',
    );
  }

  function showAllTracks() {
    batchToggleTracks(
      (t) => !!t.videoHidden,
      'videoHidden',
      false,
      'videoEditor.fileManager.history.entries.showAllTracks',
    );
  }

  return {
    addTrack,
    resolveTargetVideoTrackIdForInsert,
    resolveMobileTargetTrackId,
    getMobileSelectionKind,
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
    toggleLockTargetTrack,
    isAnyTrackSoloed,
    unsoloAllTracks,
    unmuteAllTracks,
    unlockAllTracks,
    showAllTracks,
  };
}
