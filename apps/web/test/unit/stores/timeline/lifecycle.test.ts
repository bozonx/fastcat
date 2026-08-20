/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { createTimelineLifecycleModule } from '~/stores/timeline/lifecycle';

const { computeMediaUsageByTimelineDocsMock } = vi.hoisted(() => ({
  computeMediaUsageByTimelineDocsMock: vi.fn(() => ({
    mediaPathToTimelines: {},
  })),
}));

vi.mock('~/utils/timeline-media-usage', () => ({
  computeMediaUsageByTimelineDocs: computeMediaUsageByTimelineDocsMock,
}));

vi.mock('~/timeline/timeline-thumbnail', () => ({
  generateTimelineThumbnail: vi.fn(() => Promise.resolve()),
}));

vi.mock('~/timeline/commands/utils', () => ({
  quantizeTicksToFrames: vi.fn((t: number) => t),
  sanitizeFps: vi.fn(() => 30),
}));

vi.mock('~/utils/constants', () => ({
  TIMELINE_DEFAULTS: { ZOOM: 1 },
}));

function makeDeps(overrides?: Partial<Record<string, unknown>>) {
  const base = {
    timelineDoc: ref(null),
    currentTimelinePath: ref(null),
    isTimelineDirty: ref(false),
    isSavingTimeline: ref(false),
    timelineSaveError: ref<string | null>(null),
    isPlaying: ref(false),
    currentTime: ref(0),
    duration: ref(0),
    masterGain: ref(1),
    audioMuted: ref(false),
    audioLevels: ref<Record<string, { rmsDb: number; peakDb: number }>>({}),
    timelineZoom: ref(1),
    trackHeights: ref<Record<string, number>>({}),
    mobileTrackHeightsEnlarged: ref<Record<string, boolean>>({}),
    selectionRange: ref(null),
    historyStore: { clear: vi.fn() },
    historyDebounce: { clearPendingDebouncedHistory: vi.fn() },
    selection: { clearSelection: vi.fn(), selectTrack: vi.fn() },
    persistence: {
      resetPersistenceState: vi.fn(),
      markCleanForCurrentRevision: vi.fn(),
      markDirty: vi.fn(),
      loadTimeline: vi.fn(),
      saveTimeline: vi.fn(),
      requestTimelineSave: vi.fn(),
      getLoadRequestId: vi.fn(() => 0),
    },
    timelineMediaUsageStore: {
      setLiveUsage: vi.fn(),
      refreshUsage: vi.fn(),
    },
    getOrFetchMetadataByPath: vi.fn(() => Promise.resolve()),
    uiStore: { notifyTimelineSave: vi.fn() },
    getProjectSettings: vi.fn(),
  };
  return { ...base, ...overrides } as any;
}

describe('createTimelineLifecycleModule', () => {
  it('resetTimelineState resets all reactive state', () => {
    const deps = makeDeps();
    const mod = createTimelineLifecycleModule(deps);
    deps.timelineDoc.value = { tracks: [] } as any;
    deps.isTimelineDirty.value = true;
    deps.isPlaying.value = true;
    deps.currentTime.value = 500;
    deps.duration.value = 1000;
    deps.masterGain.value = 0.5;
    deps.audioMuted.value = true;
    deps.timelineZoom.value = 5;
    deps.selectionRange.value = { start: 0, end: 100 } as any;

    mod.resetTimelineState();

    expect(deps.timelineDoc.value).toBeNull();
    expect(deps.isTimelineDirty.value).toBe(false);
    expect(deps.isSavingTimeline.value).toBe(false);
    expect(deps.timelineSaveError.value).toBeNull();
    expect(deps.isPlaying.value).toBe(false);
    expect(deps.currentTime.value).toBe(0);
    expect(deps.duration.value).toBe(0);
    expect(deps.masterGain.value).toBe(1);
    expect(deps.audioMuted.value).toBe(false);
    expect(deps.audioLevels.value).toEqual({});
    expect(deps.timelineZoom.value).toBe(1);
    expect(deps.selectionRange.value).toBeNull();
    expect(deps.selection.clearSelection).toHaveBeenCalled();
    expect(deps.selection.selectTrack).toHaveBeenCalledWith(null);
    expect(deps.historyStore.clear).toHaveBeenCalledWith('timeline');
    expect(deps.historyDebounce.clearPendingDebouncedHistory).toHaveBeenCalled();
  });

  it('resetTimelineZoom sets zoom to default', () => {
    const deps = makeDeps();
    const mod = createTimelineLifecycleModule(deps);
    deps.timelineZoom.value = 10;
    mod.resetTimelineZoom();
    expect(deps.timelineZoom.value).toBe(1);
  });

  it('setCurrentTimeTicks clamps to duration', () => {
    const deps = makeDeps();
    deps.duration.value = 1000;
    const mod = createTimelineLifecycleModule(deps);
    mod.setCurrentTimeTicks(2000);
    expect(deps.currentTime.value).toBe(1000);
  });

  it('setCurrentTimeTicks stays at 0 when the timeline is empty', () => {
    const deps = makeDeps();
    deps.duration.value = 0;
    const mod = createTimelineLifecycleModule(deps);
    mod.setCurrentTimeTicks(2000);
    expect(deps.currentTime.value).toBe(0);
  });

  it('setCurrentTimeTicks clamps to 0', () => {
    const deps = makeDeps();
    deps.duration.value = 1000;
    const mod = createTimelineLifecycleModule(deps);
    mod.setCurrentTimeTicks(-100);
    expect(deps.currentTime.value).toBe(0);
  });

  it('setCurrentTimeTicks allows value within range', () => {
    const deps = makeDeps();
    deps.duration.value = 1000;
    const mod = createTimelineLifecycleModule(deps);
    mod.setCurrentTimeTicks(500);
    expect(deps.currentTime.value).toBe(500);
  });

  it('markTimelineAsDirty delegates to persistence', () => {
    const deps = makeDeps();
    const mod = createTimelineLifecycleModule(deps);
    mod.markTimelineAsDirty();
    expect(deps.persistence.markDirty).toHaveBeenCalled();
  });

  it('markTimelineAsCleanForCurrentRevision delegates to persistence', () => {
    const deps = makeDeps();
    const mod = createTimelineLifecycleModule(deps);
    mod.markTimelineAsCleanForCurrentRevision();
    expect(deps.persistence.markCleanForCurrentRevision).toHaveBeenCalled();
  });

  it('loadTimeline clears selection and delegates to persistence', async () => {
    const deps = makeDeps();
    const mod = createTimelineLifecycleModule(deps);
    await mod.loadTimeline();
    expect(deps.selection.clearSelection).toHaveBeenCalled();
    expect(deps.selection.selectTrack).toHaveBeenCalledWith(null);
    expect(deps.isPlaying.value).toBe(false);
    expect(deps.persistence.loadTimeline).toHaveBeenCalled();
  });

  it('loadTimeline syncs live media usage immediately after loading a new timeline', async () => {
    const usage = {
      'media/video.mp4': [{ timelinePath: 'timelines/new.otio', timelineName: 'new.otio' }],
    };
    computeMediaUsageByTimelineDocsMock.mockReturnValueOnce({
      mediaPathToTimelines: usage,
    });
    const deps = makeDeps();
    const timelineDoc = {
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          items: [{ kind: 'clip', source: { path: 'media/video.mp4' } }],
        },
      ],
    };
    deps.persistence.loadTimeline = vi.fn(async () => {
      deps.currentTimelinePath.value = 'timelines/new.otio';
      deps.timelineDoc.value = timelineDoc;
    });

    const mod = createTimelineLifecycleModule(deps);
    deps.timelineMediaUsageStore.setLiveUsage.mockClear();

    await mod.loadTimeline();

    expect(computeMediaUsageByTimelineDocsMock).toHaveBeenCalledWith([
      {
        timelinePath: 'timelines/new.otio',
        timelineName: 'new.otio',
        timelineDoc,
      },
    ]);
    expect(deps.timelineMediaUsageStore.setLiveUsage).toHaveBeenCalledWith(
      'timelines/new.otio',
      usage,
    );
  });

  it('saveTimeline delegates to persistence', async () => {
    const deps = makeDeps();
    const mod = createTimelineLifecycleModule(deps);
    await mod.saveTimeline();
    expect(deps.persistence.saveTimeline).toHaveBeenCalled();
  });

  it('requestTimelineSave delegates to persistence', async () => {
    const deps = makeDeps();
    const mod = createTimelineLifecycleModule(deps);
    await mod.requestTimelineSave({ immediate: true });
    expect(deps.persistence.requestTimelineSave).toHaveBeenCalledWith({ immediate: true });
  });

  it('handleSaveSuccess notifies ui store and refreshes usage', async () => {
    const deps = makeDeps();
    deps.currentTimelinePath.value = 'timelines/test.otio';
    deps.timelineDoc.value = { tracks: [] } as any;
    const mod = createTimelineLifecycleModule(deps);
    await mod.handleSaveSuccess();
    expect(deps.uiStore.notifyTimelineSave).toHaveBeenCalled();
    expect(deps.timelineMediaUsageStore.refreshUsage).toHaveBeenCalled();
  });

  it('loadTimelineMetadata does nothing when no doc', async () => {
    const deps = makeDeps();
    const mod = createTimelineLifecycleModule(deps);
    await mod.loadTimelineMetadata();
    expect(deps.getOrFetchMetadataByPath).not.toHaveBeenCalled();
  });

  it('loadTimelineMetadata fetches metadata for clip source paths', async () => {
    const deps = makeDeps();
    deps.timelineDoc.value = {
      timebase: { fps: 30 },
      tracks: [
        {
          id: 't1',
          items: [
            { kind: 'clip', source: { path: 'media/video.mp4' } },
            { kind: 'clip', source: { path: 'media/audio.wav' } },
            { kind: 'gap', source: null },
          ],
        },
      ],
    } as any;
    deps.persistence.getLoadRequestId = vi.fn(() => 1);
    const mod = createTimelineLifecycleModule(deps);
    await mod.loadTimelineMetadata();
    expect(deps.getOrFetchMetadataByPath).toHaveBeenCalledWith('media/video.mp4');
    expect(deps.getOrFetchMetadataByPath).toHaveBeenCalledWith('media/audio.wav');
  });

  it('loadTimelineMetadata handles mask source paths', async () => {
    const deps = makeDeps();
    deps.timelineDoc.value = {
      timebase: { fps: 30 },
      tracks: [
        {
          id: 't1',
          items: [
            {
              kind: 'clip',
              source: { path: 'media/video.mp4' },
              mask: { source: { path: 'media/mask.png' } },
            },
          ],
        },
      ],
    } as any;
    deps.persistence.getLoadRequestId = vi.fn(() => 1);
    const mod = createTimelineLifecycleModule(deps);
    await mod.loadTimelineMetadata();
    expect(deps.getOrFetchMetadataByPath).toHaveBeenCalledWith('media/video.mp4');
    expect(deps.getOrFetchMetadataByPath).toHaveBeenCalledWith('media/mask.png');
  });
});
