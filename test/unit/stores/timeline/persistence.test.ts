/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest';
import { ref } from 'vue';
import { createTimelinePersistenceModule } from '~/stores/timeline/persistence';

const fallbackDoc = {
  OTIO_SCHEMA: 'Timeline.1',
  id: 'doc-1',
  name: 'Default',
  timebase: { fps: 30 },
  tracks: [],
  metadata: {},
};

const parseTimelineFromOtio = vi.fn();
const serializeTimelineToOtio = vi.fn().mockReturnValue('{}');
const selectTimelineDurationUs = vi.fn().mockReturnValue(0);
const onSaveSuccess = vi.fn();
const onSaveError = vi.fn();

let originalWorker: any;
const workerMocks: Array<{
  postMessage: (data: unknown) => void;
  terminate: () => void;
}> = [];

beforeAll(() => {
  originalWorker = (globalThis as any).Worker;
  (globalThis as any).Worker = vi.fn().mockImplementation(function () {
    const worker = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onerror: null as ((e: ErrorEvent) => void) | null,
      postMessage: vi.fn().mockImplementation((data: unknown) => {
        queueMicrotask(() => {
          if (worker.onmessage) {
            worker.onmessage(
              new MessageEvent('message', {
                data: { success: true, serialized: JSON.stringify(data) },
              }),
            );
          }
        });
      }),
      terminate: vi.fn(),
    };
    workerMocks.push(worker);
    return worker;
  });
});

afterAll(() => {
  (globalThis as any).Worker = originalWorker;
});

type FileStore = Record<string, { text: string; lastModified: number }>;

function makeVfsMock(files: FileStore) {
  return {
    readTimelineText: vi.fn(async (p: string) => files[p]?.text ?? null),
    writeTimelineText: vi.fn(async (p: string, text: string) => {
      files[p] = { text, lastModified: Date.now() };
    }),
    deleteTimelinePath: vi.fn(async (p: string) => {
      delete files[p];
    }),
    getTimelineMetadata: vi.fn(async (p: string) => {
      const f = files[p];
      return f ? { lastModified: f.lastModified, size: f.text.length } : null;
    }),
  };
}

function createMockDeps(
  overrides?: Partial<Parameters<typeof createTimelinePersistenceModule>[0]>,
) {
  const deps = {
    timelineDoc: ref<any>(null),
    currentTime: ref(0),
    duration: ref(0),
    masterGain: ref(1),
    timelineZoom: ref(50),
    trackHeights: ref<Record<string, number>>({}),
    audioMuted: ref(false),
    selectionRange: ref<any>(null),
    isTimelineDirty: ref(false),
    isSavingTimeline: ref(false),
    isReadOnly: ref(false),
    timelineSaveError: ref<string | null>(null),
    currentProjectName: ref('test-project'),
    currentTimelinePath: ref('timeline.otio'),
    ...makeVfsMock({}),
    createFallbackTimelineDoc: () => ({ ...fallbackDoc }),
    getProjectSettings: () => ({}),
    parseTimelineFromOtio,
    serializeTimelineToOtio,
    selectTimelineDurationUs,
    onSaveSuccess,
    onSaveError,
    ...overrides,
  };
  return deps;
}

describe('TimelinePersistenceModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workerMocks.length = 0;
  });

  it('loadTimeline sets fallback doc when file is missing', async () => {
    const deps = createMockDeps();
    const mod = createTimelinePersistenceModule(deps);

    await mod.loadTimeline();

    expect(deps.timelineDoc.value).toEqual(fallbackDoc);
    expect(deps.duration.value).toBe(0);
  });

  it('loadTimeline falls back to default when parseTimelineFromOtio throws', async () => {
    const files: FileStore = { 'timeline.otio': { text: 'invalid otio', lastModified: 1 } };
    const deps = createMockDeps(makeVfsMock(files));
    parseTimelineFromOtio.mockImplementation(() => {
      throw new Error('corrupted');
    });

    const mod = createTimelinePersistenceModule(deps);
    await mod.loadTimeline();

    expect(parseTimelineFromOtio).toHaveBeenCalledWith('invalid otio', expect.any(Object));
    expect(deps.timelineDoc.value).toEqual(fallbackDoc);
    expect(deps.timelineSaveError.value).toBeNull();
  });

  it('preserves a tab unsaved edits in memory across a tab switch', async () => {
    const currentTimelinePath = ref('A.otio');
    const files: FileStore = {
      'A.otio': { text: JSON.stringify({ ...fallbackDoc, id: 'A' }), lastModified: 1 },
      'B.otio': { text: JSON.stringify({ ...fallbackDoc, id: 'B' }), lastModified: 1 },
    };
    parseTimelineFromOtio.mockImplementation((text: string) => JSON.parse(text));

    const deps = createMockDeps({
      currentTimelinePath,
      ...makeVfsMock(files),
      getOpenPaths: () => ['A.otio', 'B.otio'],
    });
    const mod = createTimelinePersistenceModule(deps);

    await mod.loadTimeline();
    expect(deps.timelineDoc.value.id).toBe('A');
    deps.timelineDoc.value = { ...deps.timelineDoc.value, edited: true };
    mod.markDirty();
    expect(deps.isTimelineDirty.value).toBe(true);

    const parseCallsAfterA = parseTimelineFromOtio.mock.calls.length;

    currentTimelinePath.value = 'B.otio';
    await mod.loadTimeline();
    expect(deps.timelineDoc.value.id).toBe('B');

    currentTimelinePath.value = 'A.otio';
    await mod.loadTimeline();
    expect(deps.timelineDoc.value.edited).toBe(true);
    expect(deps.isTimelineDirty.value).toBe(true);
    expect(parseTimelineFromOtio.mock.calls.length).toBe(parseCallsAfterA + 1);
  });

  it('parks and restores each tab undo stack across a switch', async () => {
    const currentTimelinePath = ref('A.otio');
    const files: FileStore = {
      'A.otio': { text: JSON.stringify({ ...fallbackDoc, id: 'A' }), lastModified: 1 },
      'B.otio': { text: JSON.stringify({ ...fallbackDoc, id: 'B' }), lastModified: 1 },
    };
    parseTimelineFromOtio.mockImplementation((text: string) => JSON.parse(text));

    let liveHistory: string[] = [];
    const captureHistoryState = vi.fn(() => {
      const p = liveHistory;
      liveHistory = [];
      return p;
    });
    const restoreHistoryState = vi.fn((s: unknown) => {
      liveHistory = (s as string[] | null) ?? [];
    });

    const deps = createMockDeps({
      currentTimelinePath,
      ...makeVfsMock(files),
      getOpenPaths: () => ['A.otio', 'B.otio'],
      captureHistoryState,
      restoreHistoryState,
    });
    const mod = createTimelinePersistenceModule(deps);

    await mod.loadTimeline();
    liveHistory.push('A-edit');
    mod.markDirty();

    currentTimelinePath.value = 'B.otio';
    await mod.loadTimeline();
    expect(liveHistory).toEqual([]);
    liveHistory.push('B-edit');

    currentTimelinePath.value = 'A.otio';
    await mod.loadTimeline();
    expect(liveHistory).toEqual(['A-edit']);
  });

  it('evicts cached tab state once the tab is no longer open', async () => {
    const currentTimelinePath = ref('A.otio');
    let openPaths = ['A.otio', 'B.otio'];
    const files: FileStore = {
      'A.otio': { text: JSON.stringify({ ...fallbackDoc, id: 'A' }), lastModified: 1 },
      'B.otio': { text: JSON.stringify({ ...fallbackDoc, id: 'B' }), lastModified: 1 },
    };
    parseTimelineFromOtio.mockImplementation((text: string) => JSON.parse(text));

    const deps = createMockDeps({
      currentTimelinePath,
      ...makeVfsMock(files),
      getOpenPaths: () => openPaths,
    });
    const mod = createTimelinePersistenceModule(deps);

    await mod.loadTimeline();
    deps.timelineDoc.value = { ...deps.timelineDoc.value, edited: true };
    mod.markDirty();
    currentTimelinePath.value = 'B.otio';
    await mod.loadTimeline();

    openPaths = ['B.otio'];
    await mod.loadTimeline();

    openPaths = ['B.otio', 'A.otio'];
    currentTimelinePath.value = 'A.otio';
    await mod.loadTimeline();
    expect(deps.timelineDoc.value.id).toBe('A');
    expect(deps.timelineDoc.value.edited).toBeUndefined();
    expect(deps.isTimelineDirty.value).toBe(false);
  });

  it('saveTimeline skips when doc is null', async () => {
    const deps = createMockDeps({ timelineDoc: ref<any>(null) });
    const mod = createTimelinePersistenceModule(deps);
    await mod.saveTimeline();
    expect(deps.writeTimelineText).not.toHaveBeenCalled();
  });

  it('saveTimeline skips when read-only', async () => {
    const onSaveBlockedReadOnly = vi.fn();
    const deps = createMockDeps({
      timelineDoc: ref({ ...fallbackDoc }),
      isReadOnly: ref(true),
      onSaveBlockedReadOnly,
    });
    const mod = createTimelinePersistenceModule(deps);
    await mod.saveTimeline();
    expect(deps.writeTimelineText).not.toHaveBeenCalled();
    expect(onSaveBlockedReadOnly).toHaveBeenCalled();
  });

  it('requestTimelineSave({ immediate: true }) flushes autosave immediately', async () => {
    const deps = createMockDeps({ timelineDoc: ref({ ...fallbackDoc }) });
    const mod = createTimelinePersistenceModule(deps);
    mod.markDirty();
    await mod.requestTimelineSave({ immediate: true });
    expect(deps.writeTimelineText).toHaveBeenCalledWith(
      '.fastcat/autosave/timeline.otio',
      expect.any(String),
    );
  });

  it('loadTimeline calls exitPreview at the beginning', async () => {
    const exitPreview = vi.fn();
    const deps = createMockDeps({ exitPreview });
    const mod = createTimelinePersistenceModule(deps);
    await mod.loadTimeline();
    expect(exitPreview).toHaveBeenCalled();
  });

  it('loadTimeline handles showRecoveryDialog for open-saved by discarding the autosave', async () => {
    const showRecoveryDialog = vi.fn().mockResolvedValue('open-saved');
    const onRecoveryChoice = vi.fn();
    const discardAutosave = vi.fn().mockResolvedValue(undefined);
    // autosave is newer → should trigger dialog
    const files: FileStore = {
      'timeline.otio': { text: '{"id":"main"}', lastModified: 100 },
      '.fastcat/autosave/timeline.otio': { text: '{"id":"autosave"}', lastModified: 200 },
    };
    const deps = createMockDeps({
      ...makeVfsMock(files),
      showRecoveryDialog,
      onRecoveryChoice,
      discardAutosave,
    });
    const mod = createTimelinePersistenceModule(deps);
    await mod.loadTimeline();

    expect(showRecoveryDialog).toHaveBeenCalled();
    expect(onRecoveryChoice).toHaveBeenCalledWith('open-saved');
    expect(discardAutosave).toHaveBeenCalledWith('timeline.otio');
    expect(parseTimelineFromOtio).toHaveBeenCalledWith('{"id":"main"}', expect.any(Object));
  });

  it('loadTimeline handles showRecoveryDialog for restore-autosave', async () => {
    const showRecoveryDialog = vi.fn().mockResolvedValue('restore-autosave');
    const onRecoveryChoice = vi.fn();
    const files: FileStore = {
      'timeline.otio': { text: '{"id":"main"}', lastModified: 100 },
      '.fastcat/autosave/timeline.otio': { text: '{"id":"autosave"}', lastModified: 200 },
    };
    const deps = createMockDeps({ ...makeVfsMock(files), showRecoveryDialog, onRecoveryChoice });
    const mod = createTimelinePersistenceModule(deps);
    await mod.loadTimeline();

    expect(showRecoveryDialog).toHaveBeenCalled();
    expect(onRecoveryChoice).not.toHaveBeenCalled();
    expect(parseTimelineFromOtio).toHaveBeenCalledWith('{"id":"autosave"}', expect.any(Object));
  });

  it('removes an in-flight autosave if an explicit save wins the race', async () => {
    const files: FileStore = {};
    let autosaveResolve: (() => void) | null = null;
    const vfsMock = makeVfsMock(files);
    // make autosave write hang until we resolve it
    const originalWrite = vfsMock.writeTimelineText;
    vfsMock.writeTimelineText = vi.fn(async (p: string, text: string) => {
      if (p.includes('autosave')) {
        await new Promise<void>((r) => {
          autosaveResolve = r;
        });
      }
      return originalWrite(p, text);
    });

    const deleteAutosaveFile = vi.fn().mockResolvedValue(undefined);
    const deps = createMockDeps({
      timelineDoc: ref({ ...fallbackDoc }),
      ...vfsMock,
      deleteAutosaveFile,
    });
    const mod = createTimelinePersistenceModule(deps);

    mod.markDirty();
    const autosavePromise = mod.flushTimelineAutosave();

    // wait for autosave to start writing
    for (
      let i = 0;
      i < 20 && !vfsMock.writeTimelineText.mock.calls.some((c) => c[0].includes('autosave'));
      i++
    ) {
      await Promise.resolve();
    }

    await mod.saveTimeline();
    expect(deps.isTimelineDirty.value).toBe(false);

    autosaveResolve?.();
    await autosavePromise;

    expect(deleteAutosaveFile).toHaveBeenCalledWith('timeline.otio');
  });
});
