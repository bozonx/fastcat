/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { reactive, toRaw } from 'vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

// We use the global mock from vitest.setup.ts for #app

// Now import the store under test
import { useTimelineStore } from '~/stores/timeline.store';

// Use reactive to ensure store properties remain reactive
// In-memory file store for the mock
const mockFiles: Record<string, { text: string; lastModified: number }> = {};

const mockProjectStore = reactive({
  currentProjectName: 'test-project',
  currentTimelinePath: 'timelines/main.otio',
  isReadOnly: false,
  // --- new VFS-based methods (used by persistence/backup) ---
  readTextByPath: vi.fn(async (p: string) => mockFiles[p]?.text ?? null),
  writeTextByPath: vi.fn(async (p: string, text: string) => {
    mockFiles[p] = { text, lastModified: Date.now() };
  }),
  deleteByPath: vi.fn(async (p: string) => {
    delete mockFiles[p];
  }),
  listEntryNames: vi.fn(async (_p: string) => [] as string[]),
  getFileMetadata: vi.fn(async (p: string) => {
    const f = mockFiles[p];
    return f ? { lastModified: f.lastModified, size: f.text.length } : null;
  }),
  // --- still used by some call sites not yet migrated ---
  getProjectFileHandleByRelativePath: vi.fn(
    async (input: { relativePath: string; create?: boolean }) => null as any,
  ),
  getDirectoryHandleByPath: vi.fn(async () => null as any),
  createFallbackTimelineDoc: vi.fn().mockReturnValue({
    OTIO_SCHEMA: 'Timeline.1',
    id: 'fallback',
    name: 'Fallback',
    tracks: [],
  }),
  openTimelineFile: vi.fn(async () => {}),
});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

const mockWorkspaceStore = reactive({
  userSettings: JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS)),
  workspaceState: {
    fileBrowser: {
      instances: {},
    },
    presets: {
      custom: [],
      defaultText: '',
    },
  },
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

// Mock Worker
class WorkerMock {
  static postedMessages: any[] = [];
  onmessage: any = null;
  onerror: any = null;
  constructor(public url: string) {}
  postMessage(data: any) {
    if (data?.type === 'io-init') return;
    WorkerMock.postedMessages.push(data);
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
    // Reset in-memory file store
    for (const k of Object.keys(mockFiles)) delete mockFiles[k];
    WorkerMock.postedMessages = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks timeline as dirty and writes auto-save to the hidden file after debounce', async () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;

    timelineStore.markTimelineAsDirty();
    await timelineStore.requestTimelineSave();
    expect(timelineStore.isTimelineDirty).toBe(true);

    // Should not save immediately
    expect(mockProjectStore.writeTextByPath).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);

    for (let i = 0; i < 10; i++) {
      await vi.runAllTimersAsync();
      await Promise.resolve();
    }

    expect(mockProjectStore.writeTextByPath).toHaveBeenCalledWith(
      '.fastcat/autosave/timelines/main.otio',
      expect.any(String),
    );
    expect(timelineStore.isTimelineDirty).toBe(true);
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

    await vi.runAllTimersAsync();
    await Promise.resolve();
    await savePromise;
    await Promise.resolve();

    expect(mockProjectStore.writeTextByPath).toHaveBeenCalledWith(
      'timelines/main.otio',
      expect.any(String),
    );
    expect(timelineStore.isSavingTimeline).toBe(false);
    expect(timelineStore.isTimelineDirty).toBe(false);
  });

  it('flushes autosave immediately when requested with immediate flag', async () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;

    timelineStore.markTimelineAsDirty();
    await timelineStore.requestTimelineSave({ immediate: true });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(mockProjectStore.writeTextByPath).toHaveBeenCalledWith(
      '.fastcat/autosave/timelines/main.otio',
      expect.any(String),
    );
    expect(mockProjectStore.writeTextByPath).not.toHaveBeenCalledWith(
      'timelines/main.otio',
      expect.any(String),
    );
    expect(timelineStore.isTimelineDirty).toBe(true);
  });

  it('posts a serializable timeline document to the serializer worker', async () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;
    const rawDoc = toRaw(timelineStore.timelineDoc);

    timelineStore.markTimelineAsDirty();
    await timelineStore.saveTimeline();

    expect(WorkerMock.postedMessages[0]).toEqual(rawDoc);
  });

  it('triggers backup after a successful save', async () => {
    // Enable backup in user settings
    (mockWorkspaceStore.userSettings as any).backup = { count: 5 };

    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;

    timelineStore.markTimelineAsDirty();
    await timelineStore.saveTimeline();

    await vi.runAllTimersAsync();
    await Promise.resolve();

    // Backup is written via writeTextByPath with a path inside .fastcat/backups
    expect(mockProjectStore.writeTextByPath).toHaveBeenCalledWith(
      expect.stringContaining('.fastcat/backups'),
      expect.any(String),
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

    expect(mockProjectStore.writeTextByPath).not.toHaveBeenCalled();
    expect(timelineStore.isTimelineDirty).toBe(true);
  });

  it('skips autosave when in read-only mode', async () => {
    const timelineStore = useTimelineStore();
    mockProjectStore.isReadOnly = true;

    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;

    timelineStore.markTimelineAsDirty();
    await timelineStore.requestTimelineSave();

    vi.advanceTimersByTime(10_000);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(mockProjectStore.writeTextByPath).not.toHaveBeenCalled();
  });

  it('blocks duplicateCurrentTimeline in read-only mode', async () => {
    const timelineStore = useTimelineStore();
    mockProjectStore.isReadOnly = true;

    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;

    await timelineStore.duplicateCurrentTimeline();

    expect(mockProjectStore.writeTextByPath).not.toHaveBeenCalled();
  });

  it('saves timeline as under a new name and opens it', async () => {
    const timelineStore = useTimelineStore();
    mockProjectStore.currentTimelinePath = 'timelines/main.otio';
    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;

    await timelineStore.saveTimelineAs('new_timeline');

    await vi.runAllTimersAsync();
    await Promise.resolve();

    // Should save the original first, then write the new file
    expect(mockProjectStore.writeTextByPath).toHaveBeenCalledWith(
      'timelines/main.otio',
      expect.any(String),
    );
    expect(mockProjectStore.writeTextByPath).toHaveBeenCalledWith(
      'timelines/new_timeline.otio',
      expect.any(String),
    );
    expect(mockProjectStore.openTimelineFile).toHaveBeenCalledWith('timelines/new_timeline.otio');
  });

  it('appends .otio extension when saving timeline as', async () => {
    const timelineStore = useTimelineStore();
    mockProjectStore.currentTimelinePath = 'timelines/main.otio';
    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;

    await timelineStore.saveTimelineAs('backup.otio');

    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(mockProjectStore.writeTextByPath).toHaveBeenCalledWith(
      'timelines/backup.otio',
      expect.any(String),
    );
  });

  it('blocks saveTimelineAs in read-only mode', async () => {
    const timelineStore = useTimelineStore();
    mockProjectStore.isReadOnly = true;

    timelineStore.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'test',
      name: 'test',
      tracks: [],
    } as any;

    await timelineStore.saveTimelineAs('new_name');

    expect(mockProjectStore.writeTextByPath).not.toHaveBeenCalled();
  });

  describe('mobile', () => {
    let originalPathname: string;
    beforeEach(() => {
      originalPathname = window.location.pathname;
      (window as any).location.pathname = '/m/project/123';
    });
    afterEach(() => {
      (window as any).location.pathname = originalPathname;
    });

    it('autosaves to the main file on mobile after debounce', async () => {
      const timelineStore = useTimelineStore();
      timelineStore.timelineDoc = {
        OTIO_SCHEMA: 'Timeline.1',
        id: 'test',
        name: 'test',
        tracks: [],
      } as any;

      timelineStore.markTimelineAsDirty();
      await timelineStore.requestTimelineSave();

      expect(mockProjectStore.writeTextByPath).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2_000);
      for (let i = 0; i < 10; i++) {
        await vi.runAllTimersAsync();
        await Promise.resolve();
      }

      expect(mockProjectStore.writeTextByPath).toHaveBeenCalledWith(
        'timelines/main.otio',
        expect.any(String),
      );
      expect(timelineStore.isTimelineDirty).toBe(false);
    });

    it('does not create backup on explicit save on mobile', async () => {
      (mockWorkspaceStore.userSettings as any).backup = { count: 5 };

      const timelineStore = useTimelineStore();
      timelineStore.timelineDoc = {
        OTIO_SCHEMA: 'Timeline.1',
        id: 'test',
        name: 'test',
        tracks: [],
      } as any;

      timelineStore.markTimelineAsDirty();
      await timelineStore.saveTimeline();
      await vi.runAllTimersAsync();
      await Promise.resolve();

      expect(mockProjectStore.writeTextByPath).toHaveBeenCalledWith(
        'timelines/main.otio',
        expect.any(String),
      );
      // Backup should NOT be created on mobile explicit save
      const backupCalls = (mockProjectStore.writeTextByPath as any).mock.calls.filter(
        ([path]: [string]) => path.includes('.fastcat/backups'),
      );
      expect(backupCalls).toHaveLength(0);
    });
  });
});
