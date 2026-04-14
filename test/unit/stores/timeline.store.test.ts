/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { createTestTimeline } from '../utils/timeline-builder';

const projectStoreMock = {
  currentProjectName: 'test',
  currentTimelinePath: 'timeline.otio',
  getFileHandleByPath: vi.fn(),
  getProjectFileHandleByRelativePath: vi.fn(),
  getFileByPath: vi.fn(),
  getDirectoryHandleByPath: vi.fn(),
  saveProjectSettings: vi.fn(),
  projectSettings: {
    project: {},
    timelines: { sessions: {} },
  },
  isReadOnly: false,
  createFallbackTimelineDoc: () => ({
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc-1',
    name: 'Default',
    timebase: { fps: 30 },
    tracks: [
      {
        id: 'v1',
        kind: 'video',
        name: 'Video 1',
        items: [],
      },
      {
        id: 'a1',
        kind: 'audio',
        name: 'Audio 1',
        items: [],
      },
    ],
  }),
};

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => projectStoreMock,
}));

const mediaStoreMock = {
  mediaMetadata: { value: {} },
  getOrFetchMetadataByPath: vi.fn().mockResolvedValue({}),
  getOrFetchMetadata: vi.fn().mockResolvedValue({}),
};

vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => mediaStoreMock,
}));

const workspaceStoreMock = {
  userSettings: {
    timeline: { defaultStaticClipDurationUs: 5_000_000 },
    projectDefaults: { defaultAudioFadeCurve: 'linear' },
    backup: { intervalMinutes: 0, count: 5 },
    optimization: { autoCreateProxies: false },
  },
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => ({
    notifyTimelineSave: vi.fn(),
  }),
}));

const historyStoreMock = {
  canUndo: vi.fn().mockReturnValue(false),
  canRedo: vi.fn().mockReturnValue(false),
  push: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  clear: vi.fn(),
  registerStateGetter: vi.fn(),
};

vi.mock('~/stores/history.store', () => ({
  useHistoryStore: () => historyStoreMock,
}));

const mockVfs = {
  getFile: vi.fn().mockResolvedValue(new File([], 'test.mp4')),
};

vi.mock('#app', () => ({
  useNuxtApp: () => ({
    $notificationService: { add: vi.fn() },
    $i18nService: { t: (key: string) => key },
    $vfs: mockVfs,
  }),
}));

describe('TimelineStore', () => {
  let store: any;

  beforeEach(() => {
    setActivePinia(createPinia());
    projectStoreMock.getFileByPath.mockImplementation(async () => ({
      type: 'image/jpeg',
      size: 100,
      lastModified: 1,
      text: async () => '{}',
    } as any));
    
    store = useTimelineStore();
    // Force initialization of timelineDoc and duration
    store.timelineDoc = projectStoreMock.createFallbackTimelineDoc();
    
    projectStoreMock.getFileHandleByPath.mockClear();
    mediaStoreMock.getOrFetchMetadataByPath.mockClear();
    mediaStoreMock.getOrFetchMetadata.mockClear();
    mockVfs.getFile.mockClear();
    historyStoreMock.push.mockClear();
  });

  it('initializes with default state', () => {
    expect(store.timelineDoc).toBeDefined();
    expect(store.selectedItemIds).toHaveLength(0);
    expect(store.currentTime).toBe(0);
  });

  it('manages item selection', () => {
    store.selectTimelineItems(['item-1', 'item-2']);
    expect(store.selectedItemIds).toContain('item-1');
    expect(store.selectedItemIds).toContain('item-2');

    store.toggleSelection('item-1');
    expect(store.selectedItemIds).toEqual(['item-1']);

    store.toggleSelection('item-1', { multi: true });
    expect(store.selectedItemIds).not.toContain('item-1');

    store.clearSelection();
    expect(store.selectedItemIds).toHaveLength(0);
  });

  it('sets audio volume and unmutes when positive', () => {
    store.audioVolume = 0.5;
    store.audioMuted = true;
    store.setAudioVolume(0.8);
    expect(store.audioVolume).toBe(0.8);
    expect(store.audioMuted).toBe(false);
  });

  it('toggles playback', () => {
    expect(store.isPlaying).toBe(false);
    store.togglePlayback();
    expect(store.isPlaying).toBe(true);
    store.togglePlayback();
    expect(store.isPlaying).toBe(false);
  });

  it('allows negative playback speed and clamps magnitude', () => {
    store.setPlaybackSpeed(-2);
    expect(store.playbackSpeed).toBe(-2);
    store.setPlaybackSpeed(12);
    expect(store.playbackSpeed).toBe(10); // Clamped to 10
    store.setPlaybackSpeed(-15);
    expect(store.playbackSpeed).toBe(-10);
  });

  it('resets state correctly', () => {
    store.currentTime = 1_000_000;
    store.selectTimelineItems(['item-1']);
    store.resetTimelineState();
    expect(store.currentTime).toBe(0);
    expect(store.selectedItemIds).toHaveLength(0);
  });

  it('sets freeze frame from playhead when playhead is inside clip', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startUs: 1_000_000, durationUs: 5_000_000 }],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.currentTime = 3_000_000;
    
    await store.setClipFreezeFrameFromPlayhead({ trackId: 'v1', itemId: 'c1' });

    const clip = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    expect(clip.freezeFrameSourceUs).toBe(2_000_000);
  });

  it('sets freeze frame to first frame when playhead is outside clip', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startUs: 1_000_000, durationUs: 5_000_000 }],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.currentTime = 0;
    await store.setClipFreezeFrameFromPlayhead({ trackId: 'v1', itemId: 'c1' });

    const clip = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    expect(clip.freezeFrameSourceUs).toBe(0);
  });

  it('resets freeze frame', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startUs: 1_000_000, durationUs: 5_000_000, freezeFrameSourceUs: 100 }],
        },
      ],
    });
    store.timelineDoc = timeline;
    await store.resetClipFreezeFrame({ trackId: 'v1', itemId: 'c1' });
    const clip = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    expect(clip.freezeFrameSourceUs).toBeUndefined();
  });

  it('jumps to previous/next clip boundary (all tracks)', () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [
            { id: 'c1', startUs: 0, durationUs: 5_000_000 },
            { id: 'c2', startUs: 8_000_000, durationUs: 2_000_000 },
          ],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.currentTime = 3_000_000;

    store.jumpToNextClipBoundary();
    expect(store.currentTime).toBe(5_000_000);

    store.jumpToNextClipBoundary();
    expect(store.currentTime).toBe(8_000_000);

    store.jumpToPrevClipBoundary();
    expect(store.currentTime).toBe(5_000_000);
  });

  it('splits selected clips at playhead', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startUs: 0, durationUs: 10_000_000 }],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.currentTime = 4_000_000;
    store.selectTimelineItems(['c1']);

    await store.splitClipsAtPlayhead();
    const track = store.timelineDoc.tracks[0];
    expect(track.items).toHaveLength(2);
  });

  it('trims left/right to playhead without ripple', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startUs: 0, durationUs: 10_000_000 }],
        },
      ],
    });
    store.timelineDoc = timeline;

    store.currentTime = 2_000_000;
    let clip = store.timelineDoc.tracks[0].items.find((it: any) => it.kind === 'clip');
    await store.trimToPlayheadLeftNoRipple({ trackId: 'v1', itemId: clip.id });
    
    clip = store.timelineDoc.tracks[0].items.find((it: any) => it.kind === 'clip');
    expect(clip.timelineRange.startUs).toBe(2_000_000);

    store.currentTime = 8_000_000;
    await store.trimToPlayheadRightNoRipple({ trackId: 'v1', itemId: clip.id });
    
    clip = store.timelineDoc.tracks[0].items.find((it: any) => it.kind === 'clip');
    expect(clip.timelineRange.durationUs).toBe(6_000_000);
  });

  it('adds image source to video track', async () => {
    // Rely on effect observation instead of spy if possible, or just check result
    const initialCount = store.timelineDoc.tracks[0].items.length;
    
    await store.addClipToTimelineFromPath({
      trackId: 'v1',
      name: 'image.jpg',
      path: 'image.jpg',
      startUs: 0,
    });

    expect(store.timelineDoc.tracks[0].items.length).toBeGreaterThan(initialCount);
  });
});
