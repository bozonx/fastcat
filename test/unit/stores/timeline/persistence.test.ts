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

// Minimal mock for Worker used by serializeInWorker
let originalWorker: any;
const workerMocks: Array<{
  postMessage: (data: unknown) => void;
  terminate: () => void;
}> = [];

beforeAll(() => {
  originalWorker = (globalThis as any).Worker;
  (globalThis as any).Worker = vi.fn().mockImplementation(() => {
    const worker = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onerror: null as ((e: ErrorEvent) => void) | null,
      postMessage: vi.fn().mockImplementation((data: unknown) => {
        // Simulate async worker response
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
    ensureTimelineFileHandle: vi.fn().mockResolvedValue(null),
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

  it('loadTimeline sets fallback doc when file handle is missing', async () => {
    const deps = createMockDeps();
    const mod = createTimelinePersistenceModule(deps);

    await mod.loadTimeline();

    expect(deps.timelineDoc.value).toEqual(fallbackDoc);
    expect(deps.duration.value).toBe(0);
  });

  it('loadTimeline falls back to default when parseTimelineFromOtio throws', async () => {
    const deps = createMockDeps({
      ensureTimelineFileHandle: vi.fn().mockResolvedValue({
        getFile: vi.fn().mockResolvedValue({
          text: vi.fn().mockResolvedValue('invalid otio'),
        }),
      }),
    });
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
    const fileContents: Record<string, string> = {
      'A.otio': JSON.stringify({ ...fallbackDoc, id: 'A' }),
      'B.otio': JSON.stringify({ ...fallbackDoc, id: 'B' }),
    };
    const ensureTimelineFileHandle = vi.fn(
      async (options?: { create?: boolean; relativePath?: string }) => {
        const path = options?.relativePath ?? currentTimelinePath.value;
        if (!path || path.startsWith('.fastcat/autosave/')) return null;
        const text = fileContents[path];
        if (text === undefined) return null;
        return { getFile: async () => ({ text: async () => text, lastModified: 1 }) } as any;
      },
    );
    parseTimelineFromOtio.mockImplementation((text: string) => JSON.parse(text));

    const deps = createMockDeps({
      currentTimelinePath,
      ensureTimelineFileHandle,
      getOpenPaths: () => ['A.otio', 'B.otio'],
    });
    const mod = createTimelinePersistenceModule(deps);

    // Load A from disk, then make an unsaved in-memory edit.
    await mod.loadTimeline();
    expect(deps.timelineDoc.value.id).toBe('A');
    deps.timelineDoc.value = { ...deps.timelineDoc.value, edited: true };
    mod.markDirty();
    expect(deps.isTimelineDirty.value).toBe(true);

    const parseCallsAfterA = parseTimelineFromOtio.mock.calls.length;

    // Switch to B (A's edits are snapshotted in memory, not re-read on return).
    currentTimelinePath.value = 'B.otio';
    await mod.loadTimeline();
    expect(deps.timelineDoc.value.id).toBe('B');

    // Switch back to A: edits + dirty restored from memory, no disk re-read.
    currentTimelinePath.value = 'A.otio';
    await mod.loadTimeline();
    expect(deps.timelineDoc.value.edited).toBe(true);
    expect(deps.isTimelineDirty.value).toBe(true);
    // Only B was parsed across the two switches; A came from the cache.
    expect(parseTimelineFromOtio.mock.calls.length).toBe(parseCallsAfterA + 1);
  });

  it('evicts cached tab state once the tab is no longer open', async () => {
    const currentTimelinePath = ref('A.otio');
    let openPaths = ['A.otio', 'B.otio'];
    const fileContents: Record<string, string> = {
      'A.otio': JSON.stringify({ ...fallbackDoc, id: 'A' }),
      'B.otio': JSON.stringify({ ...fallbackDoc, id: 'B' }),
    };
    const ensureTimelineFileHandle = vi.fn(
      async (options?: { create?: boolean; relativePath?: string }) => {
        const path = options?.relativePath ?? currentTimelinePath.value;
        if (!path || path.startsWith('.fastcat/autosave/')) return null;
        const text = fileContents[path];
        if (text === undefined) return null;
        return { getFile: async () => ({ text: async () => text, lastModified: 1 }) } as any;
      },
    );
    parseTimelineFromOtio.mockImplementation((text: string) => JSON.parse(text));

    const deps = createMockDeps({
      currentTimelinePath,
      ensureTimelineFileHandle,
      getOpenPaths: () => openPaths,
    });
    const mod = createTimelinePersistenceModule(deps);

    // Load A, edit it, switch to B → A is cached in memory.
    await mod.loadTimeline();
    deps.timelineDoc.value = { ...deps.timelineDoc.value, edited: true };
    mod.markDirty();
    currentTimelinePath.value = 'B.otio';
    await mod.loadTimeline();

    // Close A and trigger a load while it's gone → its cache entry is pruned.
    openPaths = ['B.otio'];
    await mod.loadTimeline();

    // Reopen A: it's no longer cached, so it loads fresh from disk (no stale edit).
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
    expect(deps.ensureTimelineFileHandle).not.toHaveBeenCalled();
  });

  it('saveTimeline skips when read-only', async () => {
    const deps = createMockDeps({
      timelineDoc: ref({ ...fallbackDoc }),
      isTimelineDirty: ref(true),
      isReadOnly: ref(true),
    });
    const mod = createTimelinePersistenceModule(deps);

    await mod.saveTimeline();
    expect(deps.ensureTimelineFileHandle).not.toHaveBeenCalled();
  });
});
