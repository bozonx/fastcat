/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref, reactive } from 'vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

// Use reactive to ensure store properties remain reactive
const mockProjectStore = reactive({
  currentProjectName: 'test-project',
  currentTimelinePath: 'timelines/main.otio',
  isReadOnly: false,
  getProjectFileHandleByRelativePath: vi.fn(),
  getDirectoryHandleByPath: vi.fn(),
  createFallbackTimelineDoc: vi.fn().mockReturnValue({
    OTIO_SCHEMA: 'Timeline.1',
    id: 'fallback',
    name: 'Fallback',
    tracks: [],
  }),
});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

const mockWorkspaceStore = reactive({
  userSettings: JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS)),
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

// We use the global mock from vitest.setup.ts for #app

// Now import the store under test
import { useTimelineStore } from '~/stores/timeline.store';

// Mock Worker
class WorkerMock {
  onmessage: any = null;
  onerror: any = null;
  constructor(public url: string) {}
  postMessage(data: any) {
    // Synchronous for testing to avoid microtask/timer issues
    if (this.onmessage) {
      this.onmessage({
        data: {
          success: true,
          serialized: JSON.stringify(data),
        },
      });
    }
  }
  terminate() {}
}
globalThis.Worker = WorkerMock as any;

// Mock FileSystem API
const mockWritable = {
  write: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockFileHandle = {
  kind: 'file',
  name: 'timeline.otio',
  createWritable: vi.fn().mockResolvedValue(mockWritable),
};

const mockDirHandle = {
  kind: 'directory',
  name: 'backups',
  getDirectoryHandle: vi.fn().mockImplementation(() => Promise.resolve(mockDirHandle)),
  getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
  entries: vi.fn().mockImplementation(async function* () {
    yield ['timeline__bak001.otio', mockFileHandle];
  }),
  removeEntry: vi.fn().mockResolvedValue(undefined),
};

describe('Timeline Persistence and AutoSave', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockProjectStore.isReadOnly = false;
    mockProjectStore.currentProjectName = 'test-project';
    mockProjectStore.currentTimelinePath = 'timelines/main.otio';
    mockProjectStore.getProjectFileHandleByRelativePath.mockResolvedValue(mockFileHandle);
    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue(mockDirHandle);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks timeline as dirty and triggers auto-save after debounce', async () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;

    timelineStore.markTimelineAsDirty();
    expect(timelineStore.isTimelineDirty).toBe(true);

    // Should not save immediately
    expect(mockFileHandle.createWritable).not.toHaveBeenCalled();

    // Fast-forward debounce time (2000ms) - let's use more to be safe
    vi.advanceTimersByTime(5000);

    // Now wait for all microtasks and async operations (multiple flushes to be sure)
    for (let i = 0; i < 10; i++) {
      await vi.runAllTimersAsync();
      await Promise.resolve();
    }

    expect(mockFileHandle.createWritable).toHaveBeenCalled();
    expect(mockWritable.write).toHaveBeenCalled();
    expect(mockWritable.close).toHaveBeenCalled();
    expect(timelineStore.isTimelineDirty).toBe(false);
  });

  it('performs immediate save when requested', async () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;

    timelineStore.markTimelineAsDirty();
    const savePromise = timelineStore.saveTimeline();

    // Allow the queue and worker to proceed
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await savePromise;
    await Promise.resolve();
    await Promise.resolve();

    expect(mockFileHandle.createWritable).toHaveBeenCalled();
    expect(timelineStore.isSavingTimeline).toBe(false);
    expect(timelineStore.isTimelineDirty).toBe(false);
  });

  it('triggers backup after a successful save', async () => {
    const timelineStore = useTimelineStore();

    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;

    // Simulate save
    timelineStore.markTimelineAsDirty();
    await timelineStore.saveTimeline();

    // Wait for handleBackup
    await vi.runAllTimersAsync();
    await Promise.resolve();

    // Check if backup directory was requested
    expect(mockProjectStore.getDirectoryHandleByPath).toHaveBeenCalledWith(
      expect.stringContaining('.fastcat/backups'),
      { create: true },
    );

    // Check if new backup file was created
    expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith(
      expect.stringMatching(/main__bak\d{3}\.otio/),
      { create: true },
    );
  });

  it('skips saving when in read-only mode', async () => {
    const timelineStore = useTimelineStore();
    mockProjectStore.isReadOnly = true;

    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;

    timelineStore.markTimelineAsDirty();
    await timelineStore.saveTimeline();

    expect(mockFileHandle.createWritable).not.toHaveBeenCalled();
    // It stays dirty because it couldn't save
    expect(timelineStore.isTimelineDirty).toBe(true);
  });
});
