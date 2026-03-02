import type { Ref } from 'vue';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

export interface TimelineTracksDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  selectedTrackId: Ref<string | null>;
  applyTimeline: (
    cmd: TimelineCommand,
    options?: { historyMode?: 'immediate' | 'debounced' },
  ) => void;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  getSelectedOrActiveTrackId: () => string | null;
}

export interface TimelineTracksApi {
  addTrack: (
    kind: 'video' | 'audio',
    name: string,
    options?: { insertBeforeId?: string; insertAfterId?: string },
  ) => void;
  resolveTargetVideoTrackIdForInsert: () => string;
  renameTrack: (trackId: string, name: string) => void;
  updateTrackProperties: (
    trackId: string,
    properties: Partial<
      Pick<
        TimelineTrack,
        'videoHidden' | 'audioMuted' | 'audioSolo' | 'effects' | 'audioGain' | 'audioBalance'
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
}

export function createTimelineTracks(deps: TimelineTracksDeps): TimelineTracksApi {
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

  function renameTrack(trackId: string, name: string) {
    deps.applyTimeline({ type: 'rename_track', trackId, name });
  }

  function updateTrackProperties(
    trackId: string,
    properties: Partial<
      Pick<
        TimelineTrack,
        'videoHidden' | 'audioMuted' | 'audioSolo' | 'effects' | 'audioGain' | 'audioBalance'
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

  return {
    addTrack,
    resolveTargetVideoTrackIdForInsert,
    renameTrack,
    updateTrackProperties,
    toggleVideoHidden,
    toggleTrackAudioMuted,
    toggleTrackAudioSolo,
    deleteTrack,
    reorderTracks,
    toggleVisibilityTargetTrack,
    toggleMuteTargetTrack,
    toggleSoloTargetTrack,
  };
}
