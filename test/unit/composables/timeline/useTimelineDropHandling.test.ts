/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { useTimelineDropHandling } from '~/composables/timeline/useTimelineDropHandling';
import { useDraggedFile } from '~/composables/useDraggedFile';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { timelineTicks } from '../../utils/timeline-time';

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    userSettings: {
      timeline: {
        defaultStaticClipDurationTicks: timelineTicks(5_000_000),
        snapThresholdPx: 8,
        snapping: {
          timelineEdges: true,
          clips: true,
          markers: true,
          selection: true,
          playhead: true,
          playheadClick: true,
        },
        frameSnapMode: 'frames',
        toolbarSnapMode: 'snap',
        toolbarDragMode: 'pseudo_overlap',
        toolbarDragModeEnabled: false,
      },
      hotkeys: {
        layer1: 'Shift',
      },
    },
    workspaceState: {
      fileBrowser: {
        instances: {},
      },
    },
  })),
}));

const {
  handleFilesMock,
  copyEntryMock,
  resolveDefaultTargetDirMock,
  crossVfsCopyMock,
  vfsGetFileMock,
  parseTimelineFromOtioMock,
} = vi.hoisted(() => ({
  handleFilesMock: vi.fn(),
  copyEntryMock: vi.fn(),
  resolveDefaultTargetDirMock: vi.fn(),
  crossVfsCopyMock: vi.fn(),
  vfsGetFileMock: vi.fn(),
  parseTimelineFromOtioMock: vi.fn(),
}));

const dragSourceVfsMock = { id: 'workspace-vfs' } as any;

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({
    handleFiles: handleFilesMock,
    copyEntry: copyEntryMock,
    resolveDefaultTargetDir: resolveDefaultTargetDirMock,
    vfs: { id: 'project-vfs', getFile: vfsGetFileMock },
  }),
}));

vi.mock('~/composables/useAppClipboard', () => ({
  useAppClipboard: () => ({
    dragSourceVfs: dragSourceVfsMock,
  }),
}));

vi.mock('~/file-manager/core/vfs/crossVfs', () => ({
  crossVfsCopy: crossVfsCopyMock,
}));

vi.mock('~/timeline/otio-serializer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/timeline/otio-serializer')>()),
  parseTimelineFromOtio: parseTimelineFromOtioMock,
}));

vi.stubGlobal('useToast', () => ({
  add: vi.fn(),
}));

describe('useTimelineDropHandling', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();

    const timelineStore = useTimelineStore() as any;
    const mediaStore = useMediaStore() as any;
    const workspaceStore = useWorkspaceStore() as any;
    const { clearDraggedFile } = useDraggedFile();

    handleFilesMock.mockReset();
    copyEntryMock.mockReset();
    resolveDefaultTargetDirMock.mockReset();
    crossVfsCopyMock.mockReset();
    vfsGetFileMock.mockReset();
    parseTimelineFromOtioMock.mockReset();
    resolveDefaultTargetDirMock.mockResolvedValue('_video');
    crossVfsCopyMock.mockResolvedValue('_video/copied.mp4');
    parseTimelineFromOtioMock.mockReturnValue({
      OTIO_SCHEMA: 'Timeline.1',
      id: 'nested',
      name: 'Nested',
      timebase: { fps: 30 },
      tracks: [],
    });

    clearDraggedFile();
    timelineStore.timelineZoom = 50;
    timelineStore.duration = timelineTicks(2_000_000);
    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc-1',
      name: 'Timeline',
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          items: [
            {
              kind: 'clip',
              id: 'clip-1',
              name: 'Existing',
              clipType: 'media',
              source: { path: '_video/existing.mp4' },
              sourceRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
              sourceDurationTicks: timelineTicks(2_000_000),
              timelineRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
            },
          ],
        },
        {
          id: 'a1',
          kind: 'audio',
          name: 'Audio 1',
          items: [
            {
              kind: 'clip',
              id: 'audio-clip-1',
              name: 'Existing audio',
              clipType: 'media',
              source: { path: '_audio/existing.mp3' },
              sourceRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
              sourceDurationTicks: timelineTicks(2_000_000),
              timelineRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
            },
          ],
        },
      ],
    } as any;
    mediaStore.mediaMetadata = {
      '_video/new.mp4': {
        source: { size: 1, lastModified: 1 },
        duration: 1.5,
        video: {
          width: 1920,
          height: 1080,
          displayWidth: 1920,
          displayHeight: 1080,
          rotation: 0,
          codec: 'h264',
          parsedCodec: 'h264',
          fps: 30,
        },
      },
      '_audio/new.mp3': {
        source: { size: 1, lastModified: 1 },
        duration: 1.5,
        audio: {
          codec: 'mp3',
          parsedCodec: 'mp3',
          sampleRate: 48_000,
          channels: 2,
        },
      },
    } as any;
    mediaStore.getOrFetchMetadataByPath = vi.fn().mockImplementation((path) => {
      return Promise.resolve(mediaStore.mediaMetadata[path] || null);
    });
    workspaceStore.userSettings = {
      ...workspaceStore.userSettings,
      timeline: {
        ...workspaceStore.userSettings.timeline,
        defaultStaticClipDurationTicks: timelineTicks(5_000_000),
      },
      hotkeys: {
        ...workspaceStore.userSettings.hotkeys,
        layer1: 'Shift',
      },
    };
  });

  it('builds an invalid drag preview at the hovered position when it overlaps in normal mode', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const api = useTimelineDropHandling({ scrollEl });

    await api.buildPointerDragPreview({
      payload: {
        name: 'new.mp4',
        kind: 'file',
        path: '_video/new.mp4',
      },
      trackId: 'v1',
      clientX: 10,
      trackRectLeft: 0,
      pointer: {
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      },
    });

    expect(api.dragPreview.value).not.toBeNull();
    expect(api.dragPreview.value?.trackId).toBe('v1');
    expect(api.dragPreview.value?.startTicks).toBe(timelineTicks(500_000));
    expect(api.dragPreview.value?.durationTicks).toBe(timelineTicks(1_500_000));
    expect(api.dragPreview.value?.invalid).toBe(true);
  });

  it('keeps overlap allowed while still snapping in pseudo overlay mode', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const api = useTimelineDropHandling({ scrollEl });

    await api.buildPointerDragPreview({
      payload: {
        name: 'new.mp4',
        kind: 'file',
        path: '_video/new.mp4',
      },
      trackId: 'v1',
      clientX: 10,
      trackRectLeft: 0,
      pointer: {
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      },
    });

    expect(api.dragPreview.value).not.toBeNull();
    expect(api.dragPreview.value?.startTicks).toBe(timelineTicks(500_000));
    expect(api.dragPreview.value?.invalid).toBe(false);
  });

  it('does not add a library clip when dropped on an invalid overlapping placement', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const timelineStore = useTimelineStore() as any;
    timelineStore.addClipToTimelineFromPath = vi.fn().mockResolvedValue({
      durationTicks: timelineTicks(1_500_000),
      itemId: 'clip-2',
    });
    const api = useTimelineDropHandling({ scrollEl });

    await api.handleLibraryDrop(
      JSON.stringify({
        name: 'new.mp4',
        kind: 'file',
        path: '_video/new.mp4',
      }),
      'v1',
      timelineTicks(200_000),
    );

    expect(timelineStore.addClipToTimelineFromPath).not.toHaveBeenCalled();
  });

  it('snaps file-manager drag preview to enabled timeline targets', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const api = useTimelineDropHandling({ scrollEl });

    await api.buildPointerDragPreview({
      payload: {
        name: 'new.mp4',
        kind: 'file',
        path: '_video/new.mp4',
      },
      trackId: 'v1',
      clientX: 24,
      trackRectLeft: 0,
      pointer: {
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      },
    });

    expect(api.dragPreview.value?.startTicks).toBe(timelineTicks(2_000_000));
    expect(api.dragPreview.value?.invalid).toBe(false);
  });

  it('uses transformed track coordinates for DnD preview without double-counting scrollLeft', async () => {
    const trackEl = document.createElement('div');
    trackEl.dataset.trackId = 'v1';
    trackEl.getBoundingClientRect = () => ({ left: -120 }) as DOMRect;

    const scrollEl = ref({
      scrollLeft: 120,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const api = useTimelineDropHandling({ scrollEl });

    await api.buildPointerDragPreview({
      payload: {
        name: 'new.mp4',
        kind: 'file',
        path: '_video/new.mp4',
      },
      trackId: 'v1',
      clientX: -96,
      trackRectLeft: trackEl.getBoundingClientRect().left,
      pointer: {
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      },
    });

    expect(api.dragPreview.value?.startTicks).toBe(timelineTicks(2_000_000));
    expect(api.dragPreview.value?.invalid).toBe(false);
  });

  it('imports external workspace file to project before creating clip on timeline', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const timelineStore = useTimelineStore() as any;
    timelineStore.addClipToTimelineFromPath = vi.fn().mockResolvedValue({
      durationTicks: timelineTicks(1_500_000),
      itemId: 'clip-2',
    });

    const api = useTimelineDropHandling({ scrollEl });

    await api.handleLibraryDrop(
      JSON.stringify({
        name: 'workspace.mp4',
        kind: 'file',
        path: '/workspace/workspace.mp4',
        isExternal: true,
      }),
      'v1',
      timelineTicks(2_000_000),
    );

    expect(crossVfsCopyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: '/workspace/workspace.mp4',
        targetDirPath: '_video',
      }),
    );
    expect(timelineStore.addClipToTimelineFromPath).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '_video/copied.mp4',
      }),
    );
  });

  it('builds an OS-file drag preview from DragEvent files only', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const api = useTimelineDropHandling({ scrollEl });

    const preventDefault = vi.fn();
    await api.onTrackDragOver(
      {
        clientX: 10,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        preventDefault,
        dataTransfer: {
          types: ['Files'],
          files: [new File(['image'], 'image.png', { type: 'image/png' })],
          dropEffect: 'none',
        },
      } as unknown as DragEvent,
      'v1',
    );

    expect(preventDefault).toHaveBeenCalled();
    expect(api.dragPreview.value?.label).toBe('image.png');
    expect(api.dragPreview.value?.trackId).toBe('v1');
  });

  it('imports OS files through the file manager before placing them on the timeline', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const timelineStore = useTimelineStore() as any;
    timelineStore.addClipToTimelineFromPath = vi.fn().mockResolvedValue({
      durationTicks: timelineTicks(5_000_000),
      itemId: 'clip-image',
    });
    handleFilesMock.mockResolvedValue([{ targetPath: '_images/image.png', fileName: 'image.png' }]);
    const api = useTimelineDropHandling({ scrollEl });

    await api.handleFileDrop(
      [new File(['image'], 'image.png', { type: 'image/png' })],
      'v1',
      timelineTicks(2_000_000),
    );

    expect(handleFilesMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'image.png' })]),
      expect.objectContaining({ selectInFileManager: false }),
    );
    expect(timelineStore.addClipToTimelineFromPath).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '_images/image.png',
      }),
    );
  });

  it('uses OTIO parsing for nested timeline drag preview duration', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const api = useTimelineDropHandling({ scrollEl });

    vfsGetFileMock.mockResolvedValue({
      text: vi.fn().mockResolvedValue('otio text'),
    });
    parseTimelineFromOtioMock.mockReturnValue({
      OTIO_SCHEMA: 'Timeline.1',
      id: 'nested',
      name: 'Nested',
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          items: [
            {
              id: 'nested-clip',
              kind: 'clip',
              timelineRange: { startTicks: 0, durationTicks: timelineTicks(4_000_000) },
            },
          ],
        },
      ],
    });

    await api.buildPointerDragPreview({
      payload: {
        name: 'nested.otio',
        kind: 'timeline',
        path: 'timelines/nested.otio',
      },
      trackId: 'v1',
      clientX: 10,
      trackRectLeft: 0,
      pointer: {
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      },
    });

    expect(parseTimelineFromOtioMock).toHaveBeenCalledWith(
      'otio text',
      expect.objectContaining({ name: 'nested.otio' }),
    );
    expect(api.dragPreview.value?.durationTicks).toBe(timelineTicks(4_000_000));
    expect(api.dragPreview.value?.startTicks).toBe(timelineTicks(1_000_000));
    expect(api.dragPreview.value?.invalid).toBe(true);
  });

  it('applies the same snap target when committing a raw audio file drop', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const timelineStore = useTimelineStore() as any;
    timelineStore.addClipToTimelineFromPath = vi.fn().mockResolvedValue({
      durationTicks: timelineTicks(1_500_000),
      itemId: 'audio-clip-2',
    });
    const api = useTimelineDropHandling({ scrollEl });

    await api.handleLibraryDrop(
      JSON.stringify({
        name: 'new.mp3',
        kind: 'file',
        path: '_audio/new.mp3',
      }),
      'a1',
      timelineTicks(2_120_000),
    );

    expect(timelineStore.addClipToTimelineFromPath).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: 'a1',
        path: '_audio/new.mp3',
        startTicks: timelineTicks(2_000_000),
      }),
    );
  });

  it('builds pointer-DnD preview from explicit payload without global draggedFile state', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const api = useTimelineDropHandling({ scrollEl });

    await api.buildPointerDragPreview({
      payload: {
        kind: 'adjustment',
        name: 'Adjustment',
        path: '',
      },
      trackId: 'v1',
      clientX: 60,
      trackRectLeft: 10,
      pointer: {
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      },
    });

    expect(api.dragPreview.value).toEqual(
      expect.objectContaining({
        trackId: 'v1',
        label: 'Adjustment',
        durationTicks: timelineTicks(5_000_000),
        startTicks: timelineTicks(5_000_000),
      }),
    );
  });
});
