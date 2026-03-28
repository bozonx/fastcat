import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { useMonitorSnapshot } from '~/composables/monitor/useMonitorSnapshot';

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

const mockWorkerClient = {
  extractFrameToBlob: vi.fn().mockResolvedValue(new Blob(['test'], { type: 'image/webp' })),
};

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

vi.mock('~/utils/video-editor/worker-client', () => ({
  getThumbnailWorkerClient: () => ({
    client: mockWorkerClient,
  }),
  setThumbnailHostApi: vi.fn(),
}));

vi.mock('~/utils/video-editor/createVideoCoreHostApi', () => ({
  createVideoCoreHostApi: vi.fn().mockReturnValue({}),
}));

describe('useMonitorSnapshot', () => {
  const mockProjectStore = {
    currentProjectId: 'test-project',
    currentTimelinePath: 'timeline.otio',
    currentFileName: 'test-video',
    projectSettings: {
      project: { width: 1920, height: 1080, fps: 30 },
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
  });

  it('creates a stop frame snapshot successfully', async () => {
    const isLoading = ref(false);
    const loadError = ref(null);
    const uiCurrentTimeUs = ref(1000000);
    const workerTimelineClips = ref([]);
    const workerTimelinePayload = ref([]);

    const { createStopFrameSnapshot } = useMonitorSnapshot({
      projectStore: mockProjectStore as any,
      timelineStore: {} as any,
      workspaceStore: mockWorkspaceStore as any,
      isLoading,
      loadError,
      uiCurrentTimeUs,
      workerTimelineClips,
      rawWorkerTimelineClips: ref(undefined),
      workerTimelinePayload,
    });

    const mockFileHandle = {
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    };

    mockProjectStore.getProjectFileHandleByRelativePath
      .mockResolvedValueOnce(null) // Loop check
      .mockResolvedValueOnce(mockFileHandle); // Actual save

    await createStopFrameSnapshot();

    expect(mockProjectStore.getProjectFileHandleByRelativePath).toHaveBeenCalled();
    expect(mockWorkerClient.extractFrameToBlob).toHaveBeenCalled();
    expect(mockToast.add).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Snapshot created',
        color: 'primary',
      }),
    );
  });

  it('handles name collisions', async () => {
    const { createStopFrameSnapshot } = useMonitorSnapshot({
      projectStore: mockProjectStore as any,
      timelineStore: {} as any,
      workspaceStore: mockWorkspaceStore as any,
      isLoading: ref(false),
      loadError: ref(null),
      uiCurrentTimeUs: ref(1000000),
      workerTimelineClips: ref([]),
      rawWorkerTimelineClips: ref(undefined),
      workerTimelinePayload: ref([]),
    });

    mockProjectStore.getProjectFileHandleByRelativePath
      .mockResolvedValueOnce({}) // original exists
      .mockResolvedValueOnce(null) // _001 doesn't exist
      .mockResolvedValueOnce({}); // Actual save (just mock something)

    await createStopFrameSnapshot();

    expect(mockProjectStore.getProjectFileHandleByRelativePath).toHaveBeenCalledTimes(3);
    const call0 = mockProjectStore.getProjectFileHandleByRelativePath.mock.calls[0][0];
    const call1 = mockProjectStore.getProjectFileHandleByRelativePath.mock.calls[1][0];
    expect(call0.relativePath).not.toContain('_001');
    expect(call1.relativePath).toContain('_001');
  });
});
