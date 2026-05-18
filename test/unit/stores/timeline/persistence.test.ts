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
