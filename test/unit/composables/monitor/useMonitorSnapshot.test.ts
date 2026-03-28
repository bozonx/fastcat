import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useMonitorSnapshot } from '~/composables/monitor/useMonitorSnapshot';

// Mocking stores
const mockProjectStore = {
  currentProjectId: 'test-project',
  currentTimelinePath: 'timeline.otio',
  currentFileName: 'test-video',
  projectSettings: {
    project: { width: 1920, height: 1080, fps: 30 }
  },
  getFileHandleByPath: vi.fn(),
  getFileByPath: vi.fn(),
  getProjectFileHandleByRelativePath: vi.fn(),
};

const mockWorkspaceStore = {
  workspaceHandle: {},
  resolvedStorageTopology: {},
  userSettings: {
    stopFrames: { qualityPercent: 90 }
  }
};

const mockUiStore = {
  notifyFileManagerUpdate: vi.fn(),
};

const mockToast = {
  add: vi.fn(),
};

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

vi.mock('#imports', () => ({
  useToast: () => mockToast,
}));

// Mock worker client
vi.mock('~/utils/video-editor/worker-client', () => ({
  getThumbnailWorkerClient: () => ({
    client: {
      extractFrameToBlob: vi.fn().mockResolvedValue(new Blob(['test'], { type: 'image/webp' })),
    }
  }),
  setThumbnailHostApi: vi.fn(),
}));

describe('useMonitorSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a stop frame snapshot successfully', async () => {
    const isLoading = ref(false);
    const loadError = ref(null);
    const uiCurrentTimeUs = ref(1000000); // 1s
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

    // Mock file handle for writing
    const mockFileHandle = {
        createWritable: vi.fn().mockResolvedValue({
            write: vi.fn(),
            close: vi.fn(),
        }),
    };
    mockProjectStore.getProjectFileHandleByRelativePath.mockResolvedValueOnce(null); // original name not exists
    mockProjectStore.getProjectFileHandleByRelativePath.mockResolvedValueOnce(mockFileHandle); // creation

    await createStopFrameSnapshot();

    expect(mockProjectStore.getProjectFileHandleByRelativePath).toHaveBeenCalled();
    expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Snapshot created',
        color: 'primary'
    }));
    expect(mockUiStore.notifyFileManagerUpdate).toHaveBeenCalled();
  });

  it('handles name collisions by appending a suffix', async () => {
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
            write: vi.fn(),
            close: vi.fn(),
        }),
    };

    // First attempt exists, second attempt (with _001) is used
    mockProjectStore.getProjectFileHandleByRelativePath
        .mockResolvedValueOnce({}) // exists
        .mockResolvedValueOnce(null) // _001 doesn't exist
        .mockResolvedValueOnce(mockFileHandle); // creation of _001

    await createStopFrameSnapshot();

    expect(mockProjectStore.getProjectFileHandleByRelativePath).toHaveBeenCalledTimes(3);
    const creationCall = mockProjectStore.getProjectFileHandleByRelativePath.mock.calls[2][0];
    expect(creationCall.relativePath).toContain('_001.webp');
  });

  it('stops if loading or error is present', async () => {
    const isLoading = ref(true);
    const loadError = ref('test error');
    
    const { createStopFrameSnapshot } = useMonitorSnapshot({
      projectStore: mockProjectStore as any,
      timelineStore: {} as any,
      workspaceStore: { ...mockWorkspaceStore } as any,
      isLoading,
      loadError,
      uiCurrentTimeUs: ref(0),
      workerTimelineClips: ref([]),
      rawWorkerTimelineClips: ref([]),
      workerTimelinePayload: ref([]),
    });

    await createStopFrameSnapshot();
    expect(mockProjectStore.getProjectFileHandleByRelativePath).not.toHaveBeenCalled();
  });
});
