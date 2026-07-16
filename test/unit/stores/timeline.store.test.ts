/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { createTestTimeline } from '../utils/timeline-builder';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { TICKS_PER_SECOND } from '~/utils/time';

import { ref, nextTick, reactive } from 'vue';

global.Worker = class {
  postMessage(data: any) {
    this.onmessage?.({ data: { success: true, serialized: '{"schema":"otio"}' } } as any);
  }
  onmessage?: (e: any) => void;
  onerror?: (e: any) => void;
  terminate() {}
} as any;

vi.mock('~/timeline/otio-serializer', () => ({
  parseTimelineFromOtio: vi.fn(),
  serializeTimelineToOtio: vi.fn().mockReturnValue('{}'),
}));

const currentProjectNameRef = ref('test');
const currentTimelinePathRef = ref('timeline.otio');

const projectStoreMock = {
  get currentProjectName() {
    return currentProjectNameRef.value;
  },
  set currentProjectName(val) {
    currentProjectNameRef.value = val;
  },
  get currentTimelinePath() {
    return currentTimelinePathRef.value;
  },
  set currentTimelinePath(val) {
    currentTimelinePathRef.value = val;
  },
  getFileHandleByPath: vi.fn(),
  getProjectFileHandleByRelativePath: vi.fn(),
  getFileByPath: vi.fn(),
  getDirectoryHandleByPath: vi.fn(),
  getFileMetadata: vi.fn(),
  readTextByPath: vi.fn(),
  listEntryNames: vi.fn(),
  writeTextByPath: vi.fn(),
  openTimelineFile: vi.fn(),
  deleteByPath: vi.fn(),
  saveProjectSettings: vi.fn(),
  projectSettings: {
    project: {},
    timelines: { openPaths: [] as string[], sessions: {} },
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
  getCachedMetadata: vi.fn(),
};

vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => mediaStoreMock,
}));

const workspaceStoreMock = {
  userSettings: {
    timeline: { defaultStaticClipDurationTicks: 1_270_080_000_000 },
    projectDefaults: { defaultAudioFadeCurve: 'linear' },
    backup: { intervalMinutes: 0, count: 5 },
    optimization: { autoCreateProxies: false },
  },
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}));

const projectSettingsStoreMock = {
  projectSettings: {
    timelines: {
      openPaths: [] as string[],
      sessions: {} as Record<string, any>,
    },
  },
  markProjectSettingsAsDirty: vi.fn(),
  requestProjectSettingsSave: vi.fn(),
};

vi.mock('~/stores/project-settings.store', () => ({
  useProjectSettingsStore: () => projectSettingsStoreMock,
}));

const uiStoreMock = {
  notifyTimelineSave: vi.fn(),
  pendingRecoveryDialog: null as {
    timelinePath: string;
    resolve: (choice: 'open-saved' | 'restore-autosave') => void;
  } | null,
};

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => uiStoreMock,
}));

const historyStoreMock = {
  canUndo: vi.fn().mockReturnValue(false),
  canRedo: vi.fn().mockReturnValue(false),
  push: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  clear: vi.fn(),
  extractScope: vi.fn().mockReturnValue({ past: [], future: [] }),
  injectScope: vi.fn(),
  registerStateGetter: vi.fn(),
};

vi.mock('~/stores/history.store', () => ({
  useHistoryStore: () => historyStoreMock,
}));

const mockVfs = {
  getFile: vi.fn().mockResolvedValue(new File([], 'test.mp4')),
};

const mockRoute = reactive({ path: '/' });

vi.mock('#app/composables/router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    go: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock('#app', () => ({
  useNuxtApp: () => ({
    $notificationService: { add: vi.fn() },
    $i18nService: { t: (key: string) => key },
    $vfs: mockVfs,
  }),
  useRoute: () => mockRoute,
}));

describe('TimelineStore', () => {
  let store: any;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(parseTimelineFromOtio).mockReset();
    projectStoreMock.getFileByPath.mockImplementation(
      async () =>
        ({
          type: 'image/jpeg',
          size: 100,
          lastModified: 1,
          text: async () => '{}',
        }) as any,
    );
    projectStoreMock.currentTimelinePath = 'timeline.otio';
    projectStoreMock.projectSettings.timelines.openPaths = [];
    projectStoreMock.getFileMetadata.mockReset();
    projectStoreMock.readTextByPath.mockReset();
    projectStoreMock.deleteByPath.mockReset();

    store = useTimelineStore();
    // Force initialization of timelineDoc and duration
    store.timelineDoc = projectStoreMock.createFallbackTimelineDoc();

    projectStoreMock.getFileHandleByPath.mockClear();
    mediaStoreMock.getOrFetchMetadataByPath.mockClear();
    mediaStoreMock.getOrFetchMetadata.mockClear();
    mockVfs.getFile.mockClear();
    historyStoreMock.push.mockClear();
    uiStoreMock.notifyTimelineSave.mockClear();
    uiStoreMock.pendingRecoveryDialog = null;

    projectSettingsStoreMock.projectSettings.timelines.sessions = {};
    projectSettingsStoreMock.markProjectSettingsAsDirty.mockClear();
    projectSettingsStoreMock.requestProjectSettingsSave.mockClear();
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

  it('clamps master gain to 200%', () => {
    store.setMasterGain(5);

    expect(store.masterGain).toBe(2);
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
    store.currentTime = 254_016_000_000;
    store.selectTimelineItems(['item-1']);
    store.dirtyPaths['stale.otio'] = true;
    store.resetTimelineState();
    expect(store.currentTime).toBe(0);
    expect(store.selectedItemIds).toHaveLength(0);
    expect(store.dirtyPaths).toEqual({});
  });

  it('marks background open tabs dirty when they have pending recovery', async () => {
    projectStoreMock.currentTimelinePath = 'active.otio';
    projectStoreMock.projectSettings.timelines.openPaths = [
      'active.otio',
      'background.otio',
      'clean.otio',
    ];
    projectStoreMock.getFileMetadata.mockImplementation(async (path: string) => {
      const metadata: Record<string, { lastModified: number; size: number }> = {
        'background.otio': { lastModified: 100, size: 4 },
        '.fastcat/autosave/background.otio': { lastModified: 200, size: 9 },
        'clean.otio': { lastModified: 200, size: 4 },
        '.fastcat/autosave/clean.otio': { lastModified: 100, size: 9 },
      };
      return metadata[path] ?? null;
    });

    await store.scanOpenPathsForRecovery();

    expect(store.dirtyPaths['background.otio']).toBe(true);
    expect(store.dirtyPaths['active.otio']).toBeUndefined();
    expect(store.dirtyPaths['clean.otio']).toBeUndefined();
  });

  it('settles an existing recovery dialog before opening a new one', async () => {
    const previousResolve = vi.fn();
    uiStoreMock.pendingRecoveryDialog = {
      timelinePath: 'old.otio',
      resolve: previousResolve,
    };
    projectStoreMock.currentTimelinePath = 'timeline.otio';
    projectStoreMock.getFileMetadata.mockImplementation(async (path: string) => {
      const metadata: Record<string, { lastModified: number; size: number }> = {
        'timeline.otio': { lastModified: 100, size: 13 },
        '.fastcat/autosave/timeline.otio': { lastModified: 200, size: 17 },
      };
      return metadata[path] ?? null;
    });
    projectStoreMock.readTextByPath.mockImplementation(async (path: string) => {
      const files: Record<string, string> = {
        'timeline.otio': '{"id":"main"}',
        '.fastcat/autosave/timeline.otio': '{"id":"autosave"}',
      };
      return files[path] ?? null;
    });
    vi.mocked(parseTimelineFromOtio).mockReturnValue(projectStoreMock.createFallbackTimelineDoc());

    const loadPromise = store.loadTimeline();

    await vi.waitFor(() => {
      expect(previousResolve).toHaveBeenCalledWith('open-saved');
      expect(uiStoreMock.pendingRecoveryDialog?.timelinePath).toBe('timeline.otio');
    });

    uiStoreMock.pendingRecoveryDialog?.resolve('open-saved');
    uiStoreMock.pendingRecoveryDialog = null;
    await loadPromise;
  });

  it('sets freeze frame from playhead when playhead is inside clip', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startTicks: 1_000_000, durationTicks: 5_000_000 }],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.currentTime = 762_048_000_000;

    await store.setClipFreezeFrameFromPlayhead({ trackId: 'v1', itemId: 'c1' });

    const clip = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    expect(clip.freezeFrameSourceTicks).toBe(508_032_000_000);
  });

  it('sets freeze frame from playhead with clip speed applied', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startTicks: 1_000_000, durationTicks: 2_500_000 }],
        },
      ],
    });
    const clip = timeline.tracks[0].items.find((it: any) => it.id === 'c1') as any;
    clip.sourceRange = {
      startTicks: 254_016_000_000,
      durationTicks: 1_270_080_000_000,
    };
    clip.speed = 2;

    store.timelineDoc = timeline;
    store.currentTime = 508_032_000_000;

    await store.setClipFreezeFrameFromPlayhead({ trackId: 'v1', itemId: 'c1' });

    const updated = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    expect(updated.freezeFrameSourceTicks).toBe(762_048_000_000);
  });

  it('sets freeze frame from playhead for reversed clips without passing the source range end', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startTicks: 1_000_000, durationTicks: 5_000_000 }],
        },
      ],
    });
    const clip = timeline.tracks[0].items.find((it: any) => it.id === 'c1') as any;
    clip.sourceRange = {
      startTicks: 254_016_000_000,
      durationTicks: 1_270_080_000_000,
    };
    clip.speed = -1;

    store.timelineDoc = timeline;
    store.currentTime = 254_016_000_000;

    await store.setClipFreezeFrameFromPlayhead({ trackId: 'v1', itemId: 'c1' });

    const updated = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    expect(updated.freezeFrameSourceTicks / TICKS_PER_SECOND).toBeCloseTo(5.966667, 5);
  });

  it('does not set freeze frame when playhead is outside clip', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startTicks: 1_000_000, durationTicks: 5_000_000 }],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.currentTime = 0;
    await store.setClipFreezeFrameFromPlayhead({ trackId: 'v1', itemId: 'c1' });

    const clip = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    expect(clip.freezeFrameSourceTicks).toBeUndefined();
  });

  it('resets freeze frame', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [
            {
              id: 'c1',
              startTicks: 1_000_000,
              durationTicks: 5_000_000,
              freezeFrameSourceTicks: 100,
            },
          ],
        },
      ],
    });
    store.timelineDoc = timeline;
    await store.resetClipFreezeFrame({ trackId: 'v1', itemId: 'c1' });
    const clip = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    expect(clip.freezeFrameSourceTicks).toBeUndefined();
  });

  it('jumps to previous/next clip boundary (all tracks)', () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [
            { id: 'c1', startTicks: 0, durationTicks: 5_000_000 },
            { id: 'c2', startTicks: 8_000_000, durationTicks: 2_000_000 },
          ],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.currentTime = 762_048_000_000;

    store.jumpToNextClipBoundary();
    expect(store.currentTime).toBe(1_270_080_000_000);

    store.jumpToNextClipBoundary();
    expect(store.currentTime).toBe(2_032_128_000_000);

    store.jumpToPrevClipBoundary();
    expect(store.currentTime).toBe(1_270_080_000_000);
  });

  it('splits selected clips at playhead', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startTicks: 0, durationTicks: 10_000_000 }],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.currentTime = 1_016_064_000_000;
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
          clips: [{ id: 'c1', startTicks: 0, durationTicks: 10_000_000 }],
        },
      ],
    });
    store.timelineDoc = timeline;

    store.currentTime = 508_032_000_000;
    let clip = store.timelineDoc.tracks[0].items.find((it: any) => it.kind === 'clip');
    await store.trimToPlayheadLeftNoRipple({ trackId: 'v1', itemId: clip.id });

    clip = store.timelineDoc.tracks[0].items.find((it: any) => it.kind === 'clip');
    expect(clip.timelineRange.startTicks).toBe(508_032_000_000);

    store.currentTime = 2_032_128_000_000;
    await store.trimToPlayheadRightNoRipple({ trackId: 'v1', itemId: clip.id });

    clip = store.timelineDoc.tracks[0].items.find((it: any) => it.kind === 'clip');
    expect(clip.timelineRange.durationTicks).toBe(1_524_096_000_000);
  });

  it('trims left/right to a specific time without ripple', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startTicks: 0, durationTicks: 10_000_000 }],
        },
      ],
    });
    store.timelineDoc = timeline;

    let clip = store.timelineDoc.tracks[0].items.find((it: any) => it.kind === 'clip');
    await store.trimToTimeLeftNoRipple({ trackId: 'v1', itemId: clip.id }, 762_048_000_000);

    clip = store.timelineDoc.tracks[0].items.find((it: any) => it.kind === 'clip');
    expect(clip.timelineRange.startTicks).toBe(762_048_000_000);

    await store.trimToTimeRightNoRipple({ trackId: 'v1', itemId: clip.id }, 1_778_112_000_000);

    clip = store.timelineDoc.tracks[0].items.find((it: any) => it.kind === 'clip');
    expect(clip.timelineRange.durationTicks).toBe(1_016_064_000_000);
  });

  it('adds image source to video track', async () => {
    // Rely on effect observation instead of spy if possible, or just check result
    const initialCount = store.timelineDoc.tracks[0].items.length;

    await store.addClipToTimelineFromPath({
      trackId: 'v1',
      name: 'image.jpg',
      path: 'image.jpg',
      startTicks: 0,
    });

    expect(store.timelineDoc.tracks[0].items.length).toBeGreaterThan(initialCount);
  });

  it('cuts the existing clip on a project file-manager pseudo drop', async () => {
    store.timelineDoc = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'existing', startTicks: 2_000_000, durationTicks: 4_000_000 }],
        },
      ],
    });

    await store.addClipToTimelineFromPath({
      trackId: 'v1',
      name: 'image.jpg',
      path: 'image.jpg',
      startTicks: 0,
      pseudo: true,
    });

    const clips = store.timelineDoc.tracks[0].items.filter((it: any) => it.kind === 'clip');
    const existing = clips.find((it: any) => it.id === 'existing');
    const dropped = clips.find((it: any) => it.name === 'image.jpg');

    expect(existing.timelineRange).toEqual({
      startTicks: 1_270_080_000_000,
      durationTicks: 254_016_000_000,
    });
    expect(dropped.timelineRange).toEqual({
      startTicks: 0,
      durationTicks: 1_270_080_000_000,
    });
    expect(dropped.sourceRange).toEqual({ startTicks: 0, durationTicks: 1_270_080_000_000 });
  });

  it('falls back to default timeline when otio parse throws', async () => {
    store.timelineDoc = null;

    vi.mocked(parseTimelineFromOtio).mockImplementation(() => {
      throw new Error('corrupted otio');
    });

    projectStoreMock.getFileHandleByPath.mockResolvedValue({
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue('corrupted otio'),
      }),
    });

    await store.loadTimeline();
    expect(store.timelineDoc).toBeDefined();
    expect(store.timelineDoc.name).toBe('Default');
  });

  it('selects timeline properties after loading on desktop layout', async () => {
    const selectionStore = useSelectionStore();
    selectionStore.clearSelection();

    await store.loadTimeline();

    expect(selectionStore.selectedEntity?.kind).toBe('timeline-properties');
  });

  it('does not select timeline properties after loading on mobile layout', async () => {
    mockRoute.path = '/m/editor/test';

    setActivePinia(createPinia());
    const mobileStore = useTimelineStore();
    mobileStore.timelineDoc = projectStoreMock.createFallbackTimelineDoc();

    try {
      const selectionStore = useSelectionStore();
      selectionStore.clearSelection();

      await mobileStore.loadTimeline();

      expect(selectionStore.selectedEntity).toBeNull();
    } finally {
      mockRoute.path = '/';
    }
  });

  it('toggles disabled state on multiple clips', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [
            { id: 'c1', startTicks: 0, durationTicks: 5_000_000 },
            { id: 'c2', startTicks: 6_000_000, durationTicks: 5_000_000 },
          ],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.selectedItemIds = ['c1', 'c2'];

    await store.toggleDisableTargetClip();

    let c1 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    let c2 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c2');
    expect(c1.disabled).toBe(true);
    expect(c2.disabled).toBe(true);

    await store.toggleDisableTargetClip();

    c1 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    c2 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c2');
    expect(c1.disabled).toBe(false);
    expect(c2.disabled).toBe(false);
  });

  it('toggles mute state on multiple clips', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'a1',
          kind: 'audio',
          clips: [
            { id: 'c1', startTicks: 0, durationTicks: 5_000_000 },
            { id: 'c2', startTicks: 6_000_000, durationTicks: 5_000_000 },
          ],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.selectedItemIds = ['c1', 'c2'];

    await store.toggleMuteTargetClip();

    let c1 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    let c2 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c2');
    expect(c1.audioMuted).toBe(true);
    expect(c2.audioMuted).toBe(true);

    await store.toggleMuteTargetClip();

    c1 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    c2 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c2');
    expect(c1.audioMuted).toBe(false);
    expect(c2.audioMuted).toBe(false);
  });

  it('adds marker at playhead', () => {
    store.currentTime = 254_016_000_000;
    const marker = store.addMarkerAtPlayhead();
    expect(marker).toBeDefined();
    expect(store.markers).toHaveLength(1);
    expect(store.markers[0].timeTicks).toBe(254_016_000_000);
  });

  it('prevents duplicate marker at same time', () => {
    store.currentTime = 254_016_000_000;
    store.addMarkerAtPlayhead();
    expect(store.markers).toHaveLength(1);

    const marker = store.addMarkerAtPlayhead();
    expect(marker).toBeUndefined();
    expect(store.markers).toHaveLength(1);
  });

  it('adjusts audio volume on multiple clips', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'a1',
          kind: 'audio',
          clips: [
            { id: 'c1', startTicks: 0, durationTicks: 5_000_000, audioGain: 0.5 },
            { id: 'c2', startTicks: 6_000_000, durationTicks: 5_000_000, audioGain: 0.8 },
          ],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.selectedItemIds = ['c1', 'c2'];

    store.adjustSelectedClipsVolume(0.1);

    let c1 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    let c2 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c2');
    expect(c1.audioGain).toBeCloseTo(0.6);
    expect(c2.audioGain).toBeCloseTo(0.9);

    store.adjustSelectedClipsVolume(-0.2);

    c1 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    c2 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c2');
    expect(c1.audioGain).toBeCloseTo(0.4);
    expect(c2.audioGain).toBeCloseTo(0.7);
  });

  it('synchronizes updateClipProperties across all selected clips when multiple clips are selected', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [
            { id: 'c1', startTicks: 0, durationTicks: 5_000_000 },
            { id: 'c2', startTicks: 6_000_000, durationTicks: 5_000_000 },
          ],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.selectedItemIds = ['c1', 'c2'];

    store.updateClipProperties('v1', 'c1', { opacity: 0.75 });

    const c1 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    const c2 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c2');
    expect(c1.opacity).toBe(0.75);
    expect(c2.opacity).toBe(0.75);
  });

  it('does not synchronize updateClipProperties to other group clips when the other clip is not selected', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startTicks: 0, durationTicks: 5_000_000, linkedGroupId: 'group-1' }],
        },
        {
          id: 'a1',
          kind: 'audio',
          clips: [{ id: 'c2', startTicks: 0, durationTicks: 5_000_000, linkedGroupId: 'group-1' }],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.selectedItemIds = ['c1']; // Only c1 is selected, even though it's grouped with c2

    store.updateClipProperties('v1', 'c1', { opacity: 0.5 });

    const c1 = store.timelineDoc.tracks[0].items.find((it: any) => it.id === 'c1');
    const c2 = store.timelineDoc.tracks[1].items.find((it: any) => it.id === 'c2');
    expect(c1.opacity).toBe(0.5);
    expect(c2.opacity).toBeUndefined(); // Should NOT sync to group member because it's not in selection
  });

  describe('Backup versioning', () => {
    beforeEach(() => {
      projectStoreMock.listEntryNames.mockReset();
      projectStoreMock.writeTextByPath.mockReset();
      projectStoreMock.openTimelineFile.mockReset();
    });

    it('calculates the next version name correctly', async () => {
      projectStoreMock.currentTimelinePath = 'folder/project.otio';
      vi.mocked(projectStoreMock.listEntryNames).mockResolvedValue([
        'project.otio',
        'project_001.otio',
        'project_002.otio',
        'unrelated.otio',
      ]);

      const nextName = await store.getNextVersionName();
      expect(nextName).toBe('project_003.otio');
    });

    it('calculates the next version name correctly and avoids conflicts when versions are skipped or custom', async () => {
      projectStoreMock.currentTimelinePath = 'folder/project.otio';
      vi.mocked(projectStoreMock.listEntryNames).mockResolvedValue([
        'project.otio',
        'project_001.otio',
        'project_005.otio',
        'project_006.otio',
      ]);

      const nextName = await store.getNextVersionName();
      expect(nextName).toBe('project_007.otio');
    });

    it('creates a new version from backup and opens it', async () => {
      projectStoreMock.currentTimelinePath = 'folder/project.otio';
      vi.mocked(projectStoreMock.readTextByPath).mockResolvedValue('{"schema":"otio"}');

      const mockBackup = {
        type: 'backup' as const,
        name: 'backup_1.otio',
        path: '.fastcat/backups/folder/project__bak001.otio',
        date: new Date(),
        size: 100,
        label: 'Backup #1',
      };

      await store.createVersionFromBackup(mockBackup, 'project_003.otio');

      expect(projectStoreMock.writeTextByPath).toHaveBeenCalledWith(
        'folder/project_003.otio',
        '{"schema":"otio"}',
      );
      expect(projectStoreMock.openTimelineFile).toHaveBeenCalledWith('folder/project_003.otio');
    });

    it('copies current session settings when duplicating timeline', async () => {
      projectStoreMock.currentTimelinePath = 'folder/project.otio';
      projectStoreMock.listEntryNames.mockResolvedValue(['project.otio']);

      store.currentTime = 1_270_080_000_000;
      store.timelineZoom = 3;
      store.trackHeights = { track1: 80 };
      store.createSelectionRange({ startTicks: 1000, endTicks: 2000 });

      await store.duplicateCurrentTimeline();

      expect(
        projectSettingsStoreMock.projectSettings.timelines.sessions['folder/project_001.otio'],
      ).toEqual({
        playheadTicks: 1_270_080_000_000,
        masterGain: 1,
        masterMuted: false,
        zoom: 3,
        trackHeights: { track1: 80 },
        mobileTrackHeightsEnlarged: {},
        selectionRange: { startTicks: 1000, endTicks: 2000 },
      });
      expect(projectSettingsStoreMock.markProjectSettingsAsDirty).toHaveBeenCalled();
      expect(projectSettingsStoreMock.requestProjectSettingsSave).toHaveBeenCalledWith({
        immediate: true,
      });
    });

    it('copies current session settings when creating version from backup', async () => {
      projectStoreMock.currentTimelinePath = 'folder/project.otio';
      vi.mocked(projectStoreMock.readTextByPath).mockResolvedValue('{"schema":"otio"}');

      store.currentTime = 762_048_000_000;
      store.timelineZoom = 1;
      store.trackHeights = { track2: 120 };

      const mockBackup = {
        type: 'backup' as const,
        name: 'backup_1.otio',
        path: '.fastcat/backups/folder/project__bak001.otio',
        date: new Date(),
        size: 100,
        label: 'Backup #1',
      };

      await store.createVersionFromBackup(mockBackup, 'project_003.otio');

      expect(
        projectSettingsStoreMock.projectSettings.timelines.sessions['folder/project_003.otio'],
      ).toEqual({
        playheadTicks: 762_048_000_000,
        masterGain: 1,
        masterMuted: false,
        zoom: 1,
        trackHeights: { track2: 120 },
        mobileTrackHeightsEnlarged: {},
        selectionRange: undefined,
      });
    });

    it('copies current session settings when saving timeline as', async () => {
      projectStoreMock.currentTimelinePath = 'folder/project.otio';
      store.currentTime = 1_016_064_000_000;
      store.timelineZoom = 1;
      store.trackHeights = { track3: 150 };

      await store.saveTimelineAs('project_new');

      expect(
        projectSettingsStoreMock.projectSettings.timelines.sessions['folder/project_new.otio'],
      ).toEqual({
        playheadTicks: 1_016_064_000_000,
        masterGain: 1,
        masterMuted: false,
        zoom: 1,
        trackHeights: { track3: 150 },
        mobileTrackHeightsEnlarged: {},
        selectionRange: undefined,
      });
    });
  });

  describe('Selection Range History Restore', () => {
    it('restores selection range when applying restored snapshot with selection range', async () => {
      const selectionStore = useSelectionStore();

      selectionStore.selectTimelineSelectionRange();
      expect(selectionStore.selectedEntity?.kind).toBe('selection-range');

      const snapWithRange = {
        ...store.timelineDoc,
        metadata: {
          fastcat: {
            selectionRange: { startTicks: 1000, endTicks: 2000 },
          },
        },
      };

      store.applyRestoredSnapshot(snapWithRange as any);
      await nextTick();

      expect(store.selectionRange).toEqual({ startTicks: 1000, endTicks: 2000 });
      expect(selectionStore.selectedEntity?.kind).toBe('selection-range');
    });

    it('clears selection in UI when applying restored snapshot without selection range', async () => {
      const selectionStore = useSelectionStore();

      store.createSelectionRange({ startTicks: 1000, endTicks: 2000 });
      await nextTick();
      expect(store.selectionRange).toEqual({ startTicks: 1000, endTicks: 2000 });
      expect(selectionStore.selectedEntity?.kind).toBe('selection-range');

      const snapWithoutRange = {
        ...store.timelineDoc,
        metadata: {
          fastcat: {
            selectionRange: null,
          },
        },
      };

      store.applyRestoredSnapshot(snapWithoutRange as any);
      await nextTick();

      expect(store.selectionRange).toBeNull();
      expect(selectionStore.selectedEntity).toBeNull();
    });
  });
});
