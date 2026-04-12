/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { useTimelineDropHandling } from '~/composables/timeline/useTimelineDropHandling';
import { useDraggedFile } from '~/composables/useDraggedFile';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    userSettings: {
      timeline: {
        defaultStaticClipDurationUs: 5_000_000,
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
} = vi.hoisted(() => ({
  handleFilesMock: vi.fn(),
  copyEntryMock: vi.fn(),
  resolveDefaultTargetDirMock: vi.fn(),
  crossVfsCopyMock: vi.fn(),
}));

const dragSourceVfsMock = { id: 'workspace-vfs' } as any;

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({
    handleFiles: handleFilesMock,
    copyEntry: copyEntryMock,
    resolveDefaultTargetDir: resolveDefaultTargetDirMock,
    vfs: { id: 'project-vfs' },
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
    resolveDefaultTargetDirMock.mockResolvedValue('_video');
    crossVfsCopyMock.mockResolvedValue('_video/copied.mp4');

    clearDraggedFile();
    timelineStore.timelineZoom = 50;
    timelineStore.duration = 2_000_000;
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
              sourceRange: { startUs: 0, durationUs: 2_000_000 },
              sourceDurationUs: 2_000_000,
              timelineRange: { startUs: 0, durationUs: 2_000_000 },
            },
          ],
        },
        {
          id: 'a1',
          kind: 'audio',
          name: 'Audio 1',
          items: [],
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
    } as any;
    mediaStore.getOrFetchMetadataByPath = vi.fn().mockImplementation((path) => {
      return Promise.resolve(mediaStore.mediaMetadata[path] || null);
    });
    workspaceStore.userSettings = {
      ...workspaceStore.userSettings,
      timeline: {
        ...workspaceStore.userSettings.timeline,
        defaultStaticClipDurationUs: 5_000_000,
      },
      hotkeys: {
        ...workspaceStore.userSettings.hotkeys,
        layer1: 'Shift',
      },
    };
  });

  it('builds drag preview on dragover and shifts insert position in normal mode to avoid overlap', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const { setDraggedFile } = useDraggedFile();
    const api = useTimelineDropHandling({ scrollEl });

    setDraggedFile({
      name: 'new.mp4',
      kind: 'file',
      path: '_video/new.mp4',
    });

    await api.onTrackDragOver(
      {
        clientX: 10,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        dataTransfer: {
          types: ['application/json'],
        },
      } as unknown as DragEvent,
      'v1',
    );

    expect(api.dragPreview.value).not.toBeNull();
    expect(api.dragPreview.value?.trackId).toBe('v1');
    expect(api.dragPreview.value?.startUs).toBe(2_000_000);
    expect(api.dragPreview.value?.durationUs).toBe(1_500_000);
  });

  it('keeps original drop position when pseudo overlay modifier is active', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const { setDraggedFile } = useDraggedFile();
    const api = useTimelineDropHandling({ scrollEl });

    setDraggedFile({
      name: 'new.mp4',
      kind: 'file',
      path: '_video/new.mp4',
    });

    await api.onTrackDragOver(
      {
        clientX: 10,
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        dataTransfer: {
          types: ['application/json'],
        },
      } as unknown as DragEvent,
      'v1',
    );

    expect(api.dragPreview.value).not.toBeNull();
    expect(api.dragPreview.value?.startUs).toBe(1_000_000);
  });

  it('imports external workspace file to project before creating clip on timeline', async () => {
    const scrollEl = ref({
      scrollLeft: 0,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement);
    const { setDraggedFile } = useDraggedFile();
    const timelineStore = useTimelineStore() as any;
    timelineStore.addClipToTimelineFromPath = vi.fn().mockResolvedValue({
      durationUs: 1_500_000,
      itemId: 'clip-2',
    });

    const api = useTimelineDropHandling({ scrollEl });

    setDraggedFile({
      name: 'workspace.mp4',
      kind: 'file',
      path: '/workspace/workspace.mp4',
      isExternal: true,
    });

    await api.handleLibraryDrop(
      JSON.stringify({
        name: 'workspace.mp4',
        kind: 'file',
        path: '/workspace/workspace.mp4',
        isExternal: true,
      }),
      'v1',
      0,
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
});
