/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { useMonitorSnapshot } from '~/composables/monitor/useMonitorSnapshot';

const renderStopFrameWebpMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(new Blob(['test'], { type: 'image/webp' })),
);

// Separate mock objects to keep them stable
const mockToast = {
  add: vi.fn(),
};

mockNuxtImport('useToast', () => {
  return () => mockToast;
});

const mockUiStore = {
  notifyFileManagerUpdate: vi.fn(),
};

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({
    reloadDirectory: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('~/timeline/timeline-thumbnail', () => ({
  renderStopFrameWebp: renderStopFrameWebpMock,
}));

describe('useMonitorSnapshot', () => {
  const mockProjectStore = {
    currentProjectId: 'test-project',
    currentTimelinePath: 'timeline.otio',
    currentFileName: 'test-video',
    projectSettings: {
      project: { width: 1920, height: 1080, fps: 30 },
      monitor: { showTransparencyGrid: false },
    },
    getFileHandleByPath: vi.fn(),
    getFileByPath: vi.fn(),
    getProjectFileHandleByRelativePath: vi.fn(),
  };

  const mockWorkspaceStore = {
    workspaceHandle: {},
    resolvedStorageTopology: {},
    userSettings: {
      stopFrames: { qualityPercent: 90 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectStore.projectSettings.monitor.showTransparencyGrid = false;
    renderStopFrameWebpMock.mockResolvedValue(new Blob(['test'], { type: 'image/webp' }));
  });

  it('creates a stop frame snapshot successfully', async () => {
    const isLoading = ref(false);
    const loadError = ref(null);
    const uiCurrentTimeUs = ref(1000000);

    const timelineDoc = { id: 'test', name: 'test', tracks: [] };
    const { createStopFrameSnapshot } = useMonitorSnapshot({
      projectStore: mockProjectStore as any,
      timelineStore: { timelineDoc } as any,
      workspaceStore: mockWorkspaceStore as any,
      isLoading,
      loadError,
      uiCurrentTimeUs,
    });

    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const mockFileHandle = {
      createWritable: vi.fn().mockResolvedValue({
        write,
        close,
      }),
    };

    mockProjectStore.getProjectFileHandleByRelativePath
      .mockResolvedValueOnce(null) // Loop check
      .mockResolvedValueOnce(mockFileHandle); // Actual save

    await createStopFrameSnapshot();

    expect(renderStopFrameWebpMock).toHaveBeenCalledWith({
      timelineDoc,
      timeUs: 1000000,
      quality: 0.9,
      isTransparent: false,
    });
    expect(write).toHaveBeenCalledWith(expect.any(Blob));
    expect(close).toHaveBeenCalled();
    expect(mockProjectStore.getProjectFileHandleByRelativePath).toHaveBeenCalled();
    expect(mockToast.add).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'fastcat.monitor.snapshotCreated',
        color: 'success',
      }),
    );
  });

  it('creates a transparent stop frame when transparent monitor background is enabled', async () => {
    mockProjectStore.projectSettings.monitor.showTransparencyGrid = true;
    const timelineDoc = { id: 'test', name: 'test', tracks: [] };
    const { createStopFrameSnapshot } = useMonitorSnapshot({
      projectStore: mockProjectStore as any,
      timelineStore: { timelineDoc } as any,
      workspaceStore: mockWorkspaceStore as any,
      isLoading: ref(false),
      loadError: ref(null),
      uiCurrentTimeUs: ref(1000000),
    });

    mockProjectStore.getProjectFileHandleByRelativePath
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        createWritable: vi.fn().mockResolvedValue({
          write: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      });

    await createStopFrameSnapshot();

    expect(renderStopFrameWebpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isTransparent: true,
      }),
    );
  });

  it('handles name collisions', async () => {
    const { createStopFrameSnapshot } = useMonitorSnapshot({
      projectStore: mockProjectStore as any,
      timelineStore: { timelineDoc: { id: 'test', name: 'test', tracks: [] } } as any,
      workspaceStore: mockWorkspaceStore as any,
      isLoading: ref(false),
      loadError: ref(null),
      uiCurrentTimeUs: ref(1000000),
    });

    mockProjectStore.getProjectFileHandleByRelativePath
      .mockResolvedValueOnce({}) // original exists
      .mockResolvedValueOnce(null) // _001 doesn't exist
      .mockResolvedValueOnce({
        createWritable: vi.fn().mockResolvedValue({
          write: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      }); // Actual save (just mock something)

    await createStopFrameSnapshot();

    expect(mockProjectStore.getProjectFileHandleByRelativePath).toHaveBeenCalledTimes(3);
    const call0 = mockProjectStore.getProjectFileHandleByRelativePath.mock.calls[0][0];
    const call1 = mockProjectStore.getProjectFileHandleByRelativePath.mock.calls[1][0];
    expect(call0.relativePath).not.toContain('_001');
    expect(call1.relativePath).toContain('_001');
  });
});
