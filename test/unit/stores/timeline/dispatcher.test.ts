/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { createTimelineDispatcherModule } from '~/stores/timeline/dispatcher';
import { applyTimelineCommand } from '~/timeline/commands';
import { selectTimelineDurationUs } from '~/timeline/selectors';

vi.mock('~/timeline/commands', () => ({
  applyTimelineCommand: vi.fn((doc, cmd) => ({
    next: { ...doc, tracks: doc.tracks.map((t: any) => ({ ...t, items: [...t.items] })) },
    createdItemIds: cmd.id ? [cmd.id] : [],
  })),
}));

vi.mock('~/timeline/selectors', () => ({
  selectTimelineDurationUs: vi.fn(() => 5_000_000),
}));

const fallbackDoc = { id: 'doc-1', tracks: [{ id: 't1', items: [] }] };

function createMockDeps() {
  return {
    timelineDoc: ref<any>(null),
    duration: ref(0),
    createFallbackTimelineDoc: () => ({ ...fallbackDoc }),
    hydration: {
      hydrateClipSourceDuration: vi.fn((doc: any) => doc),
      hydrateAllClips: vi.fn((doc: any) => doc),
    },
    historyDebounce: {
      pushHistory: vi.fn(),
      flushPendingDebouncedHistory: vi.fn(),
    },
    historyStore: {
      canUndo: vi.fn().mockReturnValue(false),
      canRedo: vi.fn().mockReturnValue(false),
      undo: vi.fn(),
      redo: vi.fn(),
    },
    requestTimelineSave: vi.fn().mockResolvedValue(undefined),
    markTimelineAsDirty: vi.fn(),
    selectTimelineItems: vi.fn(),
    selectGlobalTimelineItems: vi.fn(),
    isReadOnly: ref(false),
  };
}

describe('TimelineDispatcherModule', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applyTimeline creates fallback doc when null', () => {
    const deps = createMockDeps();
    const mod = createTimelineDispatcherModule(deps);
    mod.applyTimeline({ type: 'addClip' } as any);
    expect(deps.timelineDoc.value).toEqual(fallbackDoc);
  });

  it('applyTimeline returns empty when command produces no change', () => {
    const deps = createMockDeps();
    deps.timelineDoc.value = fallbackDoc;
    vi.mocked(deps.hydration.hydrateAllClips).mockImplementation((d) => d);
    const mod = createTimelineDispatcherModule(deps);
    const result = mod.applyTimeline({ type: 'noop' } as any);
    expect(result).toEqual([]);
  });

  it('applyTimeline requests immediate save when saveMode is immediate', () => {
    const deps = createMockDeps();
    deps.timelineDoc.value = fallbackDoc;
    const mod = createTimelineDispatcherModule(deps);
    mod.applyTimeline({ type: 'addClip', id: 'c1' } as any, { saveMode: 'immediate' });
    expect(deps.requestTimelineSave).toHaveBeenCalledWith({ immediate: true });
  });

  it('batchApplyTimeline returns empty on empty command list', () => {
    const deps = createMockDeps();
    const mod = createTimelineDispatcherModule(deps);
    expect(mod.batchApplyTimeline([])).toEqual([]);
  });

  it('batchApplyTimeline rolls back on failure', () => {
    const deps = createMockDeps();
    deps.timelineDoc.value = fallbackDoc;
    vi.mocked(applyTimelineCommand).mockImplementationOnce(() => {
      throw new Error('fail');
    });
    const mod = createTimelineDispatcherModule(deps);
    const result = mod.batchApplyTimeline([{ type: 'bad' } as any]);
    expect(result).toEqual([]);
    expect(deps.timelineDoc.value).toEqual(fallbackDoc);
  });

  it('undoTimeline does nothing when history is empty', () => {
    const deps = createMockDeps();
    deps.timelineDoc.value = fallbackDoc;
    const mod = createTimelineDispatcherModule(deps);
    mod.undoTimeline();
    expect(deps.historyStore.undo).not.toHaveBeenCalled();
  });

  it('applyRestoredSnapshot updates doc and duration', () => {
    const deps = createMockDeps();
    const mod = createTimelineDispatcherModule(deps);
    const snap = { id: 'snap', tracks: [] };
    mod.applyRestoredSnapshot(snap as any);
    expect(deps.timelineDoc.value).toEqual(snap);
    expect(deps.markTimelineAsDirty).toHaveBeenCalled();
  });

  it('applyTimeline is blocked when isReadOnly is true', () => {
    const deps = createMockDeps();
    deps.isReadOnly = ref(true);
    deps.timelineDoc.value = fallbackDoc;
    const mod = createTimelineDispatcherModule(deps);
    const result = mod.applyTimeline({ type: 'addClip' } as any);
    expect(result).toEqual([]);
    expect(deps.markTimelineAsDirty).not.toHaveBeenCalled();
  });

  it('batchApplyTimeline is blocked when isReadOnly is true', () => {
    const deps = createMockDeps();
    deps.isReadOnly = ref(true);
    deps.timelineDoc.value = fallbackDoc;
    const mod = createTimelineDispatcherModule(deps);
    const result = mod.batchApplyTimeline([{ type: 'addClip' } as any]);
    expect(result).toEqual([]);
    expect(deps.markTimelineAsDirty).not.toHaveBeenCalled();
  });

  it('undoTimeline is blocked when isReadOnly is true', () => {
    const deps = createMockDeps();
    deps.isReadOnly = ref(true);
    deps.timelineDoc.value = fallbackDoc;
    deps.historyStore.canUndo.mockReturnValue(true);
    deps.historyStore.undo.mockReturnValue(fallbackDoc);
    const mod = createTimelineDispatcherModule(deps);
    mod.undoTimeline();
    expect(deps.historyStore.undo).not.toHaveBeenCalled();
  });

  it('redoTimeline is blocked when isReadOnly is true', () => {
    const deps = createMockDeps();
    deps.isReadOnly = ref(true);
    deps.timelineDoc.value = fallbackDoc;
    deps.historyStore.canRedo.mockReturnValue(true);
    deps.historyStore.redo.mockReturnValue(fallbackDoc);
    const mod = createTimelineDispatcherModule(deps);
    mod.redoTimeline();
    expect(deps.historyStore.redo).not.toHaveBeenCalled();
  });

  it('applyRestoredSnapshot is blocked when isReadOnly is true', () => {
    const deps = createMockDeps();
    deps.isReadOnly = ref(true);
    const mod = createTimelineDispatcherModule(deps);
    const snap = { id: 'snap', tracks: [] };
    mod.applyRestoredSnapshot(snap as any);
    expect(deps.timelineDoc.value).toBeNull();
    expect(deps.markTimelineAsDirty).not.toHaveBeenCalled();
  });
});
