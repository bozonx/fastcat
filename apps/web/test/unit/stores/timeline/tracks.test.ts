/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { createTimelineTracksModule } from '~/stores/timeline/tracks';

const mockDoc = {
  id: 'doc-1',
  tracks: [
    {
      id: 'v1',
      kind: 'video',
      name: 'Video 1',
      items: [
        { id: 'c1', kind: 'clip', timelineRange: { startTicks: 0, durationTicks: 1_000_000 } },
      ],
      videoHidden: false,
      audioMuted: false,
      audioSolo: false,
      locked: false,
    },
    {
      id: 'v2',
      kind: 'video',
      name: 'Video 2',
      items: [],
      videoHidden: true,
      audioMuted: true,
      audioSolo: true,
      locked: true,
    },
    {
      id: 'a1',
      kind: 'audio',
      name: 'Audio 1',
      items: [],
      videoHidden: false,
      audioMuted: false,
      audioSolo: false,
      locked: false,
    },
    {
      id: 'a2',
      kind: 'audio',
      name: 'Audio 2',
      items: [
        { id: 'c2', kind: 'clip', timelineRange: { startTicks: 0, durationTicks: 1_000_000 } },
      ],
      videoHidden: false,
      audioMuted: true,
      audioSolo: false,
      locked: false,
    },
  ],
};

function createMockDeps() {
  const applyTimeline = vi.fn();
  const batchApplyTimeline = vi.fn();
  return {
    timelineDoc: ref<any>(mockDoc),
    currentTime: ref(0),
    selectedTrackId: ref<string | null>(null),
    applyTimeline,
    batchApplyTimeline,
    requestTimelineSave: vi.fn().mockResolvedValue(undefined),
    getSelectedOrActiveTrackId: vi.fn(),
    selectedItemIds: ref<string[]>([]),
  };
}

describe('TimelineTracksModule', () => {
  beforeEach(() => vi.clearAllMocks());

  it('addTrack delegates to applyTimeline', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    mod.addTrack('video', 'New Video');
    expect(deps.applyTimeline).toHaveBeenCalledWith({
      type: 'add_track',
      kind: 'video',
      name: 'New Video',
      insertBeforeId: undefined,
      insertAfterId: undefined,
    });
  });

  it('resolveTargetVideoTrackIdForInsert returns selected video track', () => {
    const deps = createMockDeps();
    deps.selectedTrackId.value = 'v2';
    const mod = createTimelineTracksModule(deps);
    expect(mod.resolveTargetVideoTrackIdForInsert()).toBe('v2');
  });

  it('resolveTargetVideoTrackIdForInsert falls back to first video track', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    expect(mod.resolveTargetVideoTrackIdForInsert()).toBe('v1');
  });

  it('resolveMobileTargetTrackId uses selected item track when kind matches and has room', () => {
    const deps = createMockDeps();
    deps.currentTime.value = 1_000_000;
    deps.selectedItemIds.value = ['c2'];
    const mod = createTimelineTracksModule(deps);
    expect(mod.resolveMobileTargetTrackId('audio', { durationTicks: 500_000 })).toBe('a2');
  });

  it('resolveMobileTargetTrackId uses selected track when the full insertion range fits', () => {
    const deps = createMockDeps();
    deps.currentTime.value = 1_000_000;
    deps.selectedTrackId.value = 'v1';
    const mod = createTimelineTracksModule(deps);
    expect(mod.resolveMobileTargetTrackId('video', { durationTicks: 500_000 })).toBe('v1');
    expect(deps.applyTimeline).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'add_track' }),
    );
  });

  it('resolveMobileTargetTrackId falls back from a selected occupied track to a free same-kind track', () => {
    const deps = createMockDeps();
    deps.currentTime.value = 500_000;
    deps.selectedTrackId.value = 'v1';
    const mod = createTimelineTracksModule(deps);

    expect(mod.resolveMobileTargetTrackId('video', { durationTicks: 500_000 })).toBe('v2');
    expect(deps.applyTimeline).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'add_track' }),
    );
  });

  it('resolveMobileTargetTrackId uses top track when no track is selected and it has room', () => {
    const deps = createMockDeps();
    deps.currentTime.value = 1_000_000;
    const mod = createTimelineTracksModule(deps);

    expect(mod.resolveMobileTargetTrackId('video', { durationTicks: 500_000 })).toBe('v1');
  });

  it('resolveMobileTargetTrackId uses the next free track when no track is selected and top track has no room', () => {
    const deps = createMockDeps();
    deps.currentTime.value = 500_000;
    const mod = createTimelineTracksModule(deps);

    expect(mod.resolveMobileTargetTrackId('video', { durationTicks: 500_000 })).toBe('v2');
    expect(deps.applyTimeline).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'add_track' }),
    );
  });

  it('resolveMobileTargetTrackId creates a track when every same-kind track is occupied', () => {
    const deps = createMockDeps();
    deps.currentTime.value = 500_000;
    deps.timelineDoc.value = {
      ...mockDoc,
      tracks: mockDoc.tracks.map((track) =>
        track.kind === 'video'
          ? {
              ...track,
              items: [
                {
                  id: `${track.id}-clip`,
                  kind: 'clip',
                  timelineRange: { startTicks: 0, durationTicks: 1_000_000 },
                },
              ],
            }
          : track,
      ),
    };
    const mod = createTimelineTracksModule(deps);

    expect(mod.resolveMobileTargetTrackId('video', { durationTicks: 500_000 })).toBe('v3');
    expect(deps.applyTimeline).toHaveBeenCalledWith({
      type: 'add_track',
      kind: 'video',
      name: 'Video 3',
      insertBeforeId: undefined,
      insertAfterId: undefined,
    });
  });

  it('renameTrack delegates to applyTimeline', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    mod.renameTrack('v1', 'Renamed');
    expect(deps.applyTimeline).toHaveBeenCalledWith({
      type: 'rename_track',
      trackId: 'v1',
      name: 'Renamed',
    });
  });

  it('toggleVideoHidden flips property', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    mod.toggleVideoHidden('v1');
    expect(deps.applyTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'update_track_properties',
        trackId: 'v1',
        properties: { videoHidden: true },
      }),
      { historyMode: 'debounced' },
    );
  });

  it('toggleVisibilityTargetTrack flips only videoHidden and leaves audioMuted untouched', () => {
    const deps = createMockDeps();
    deps.getSelectedOrActiveTrackId.mockReturnValue('v1');
    const mod = createTimelineTracksModule(deps);
    void mod.toggleVisibilityTargetTrack();
    expect(deps.applyTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'update_track_properties',
        trackId: 'v1',
        properties: { videoHidden: true },
      }),
      { historyMode: 'debounced' },
    );
    // Must not carry audioMuted — visibility hotkey controls only disabled state.
    const call = deps.applyTimeline.mock.calls.find(
      (c) => c[0]?.type === 'update_track_properties' && c[0]?.trackId === 'v1',
    );
    expect(call?.[0]?.properties).toEqual({ videoHidden: true });
  });

  it('toggleTrackAudioMuted flips property', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    mod.toggleTrackAudioMuted('a1');
    expect(deps.applyTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'update_track_properties',
        trackId: 'a1',
        properties: { audioMuted: true },
      }),
      { historyMode: 'debounced' },
    );
  });

  it('deleteTrack delegates and clears selectedTrackId', () => {
    const deps = createMockDeps();
    deps.selectedTrackId.value = 'v1';
    const mod = createTimelineTracksModule(deps);
    mod.deleteTrack('v1');
    expect(deps.applyTimeline).toHaveBeenCalledWith({
      type: 'delete_track',
      trackId: 'v1',
      allowNonEmpty: undefined,
    });
    expect(deps.selectedTrackId.value).toBeNull();
  });

  it('reorderTracks delegates to applyTimeline', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    mod.reorderTracks(['v2', 'v1', 'a1', 'a2']);
    expect(deps.applyTimeline).toHaveBeenCalledWith({
      type: 'reorder_tracks',
      trackIds: ['v2', 'v1', 'a1', 'a2'],
    });
  });

  it('isAnyTrackSoloed reflects doc state', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    expect(mod.isAnyTrackSoloed.value).toBe(true);

    deps.timelineDoc.value = {
      ...mockDoc,
      tracks: mockDoc.tracks.map((t) => ({ ...t, audioSolo: false })),
    };
    expect(mod.isAnyTrackSoloed.value).toBe(false);
  });

  it('unsoloAllTracks batches update for soloed tracks', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    mod.unsoloAllTracks();
    expect(deps.batchApplyTimeline).toHaveBeenCalled();
    const cmds = deps.batchApplyTimeline.mock.calls[0][0];
    expect(cmds).toHaveLength(1);
    expect(cmds[0].trackId).toBe('v2');
  });

  it('unmuteAllTracks batches update for muted tracks', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    mod.unmuteAllTracks();
    expect(deps.batchApplyTimeline).toHaveBeenCalled();
    const cmds = deps.batchApplyTimeline.mock.calls[0][0];
    expect(cmds).toHaveLength(2);
  });

  it('unlockAllTracks batches update for locked tracks', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    mod.unlockAllTracks();
    expect(deps.batchApplyTimeline).toHaveBeenCalled();
    const cmds = deps.batchApplyTimeline.mock.calls[0][0];
    expect(cmds).toHaveLength(1);
    expect(cmds[0].trackId).toBe('v2');
  });

  it('showAllTracks batches update for hidden tracks', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    mod.showAllTracks();
    expect(deps.batchApplyTimeline).toHaveBeenCalled();
    const cmds = deps.batchApplyTimeline.mock.calls[0][0];
    expect(cmds).toHaveLength(1);
    expect(cmds[0].trackId).toBe('v2');
  });

  it('moveTrackUp swaps with previous same-kind track', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    mod.moveTrackUp('v2');
    expect(deps.applyTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reorder_tracks',
        trackIds: ['v2', 'v1', 'a1', 'a2'],
      }),
    );
  });

  it('moveTrackDown swaps with next same-kind track', () => {
    const deps = createMockDeps();
    const mod = createTimelineTracksModule(deps);
    mod.moveTrackDown('v1');
    expect(deps.applyTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reorder_tracks',
        trackIds: ['v2', 'v1', 'a1', 'a2'],
      }),
    );
  });
});
