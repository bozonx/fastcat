/** @vitest-environment happy-dom */
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  backgroundTasksStore: {
    hasActiveTasks: false,
  },
  timelineStore: {
    dirtyPaths: {} as Record<string, boolean>,
    hasAnyDirtyTimeline: false,
    skipRecoveryDialog: false,
    currentTimelinePath: null as string | null,
    saveTimeline: vi.fn(),
    flushTimelineAutosave: vi.fn(),
    deleteAllOpenAutosaves: vi.fn(),
    scanOpenPathsForRecovery: vi.fn(),
    isTimelineDirty: false,
  },
  uiStore: {
    pendingCloseDialog: null as null | { dirtyCount: number; resolve: (v: string) => void },
  },
  loadTimeline: vi.fn(),
}));

vi.mock('~/stores/background-tasks.store', () => ({
  useBackgroundTasksStore: () => mocks.backgroundTasksStore,
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mocks.timelineStore,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mocks.uiStore,
}));

vi.mock('~/composables/editor/useProjectActions', () => ({
  useProjectActions: () => ({
    loadTimeline: mocks.loadTimeline,
  }),
}));

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: () => false,
}));

const { useConfirmClose } = await import('~/composables/useConfirmClose');

describe('useConfirmClose', () => {
  let originalAddEventListener: typeof window.addEventListener;
  let originalRemoveEventListener: typeof window.removeEventListener;
  let originalDocumentAddEventListener: typeof document.addEventListener;
  let originalDocumentRemoveEventListener: typeof document.removeEventListener;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backgroundTasksStore.hasActiveTasks = false;
    mocks.timelineStore.dirtyPaths = {};
    mocks.timelineStore.hasAnyDirtyTimeline = false;
    mocks.timelineStore.skipRecoveryDialog = false;
    mocks.timelineStore.currentTimelinePath = null;
    mocks.timelineStore.isTimelineDirty = false;
    mocks.uiStore.pendingCloseDialog = null;

    originalAddEventListener = window.addEventListener;
    originalRemoveEventListener = window.removeEventListener;
    originalDocumentAddEventListener = document.addEventListener;
    originalDocumentRemoveEventListener = document.removeEventListener;
    window.addEventListener = vi.fn();
    window.removeEventListener = vi.fn();
    document.addEventListener = vi.fn();
    document.removeEventListener = vi.fn();
  });

  afterEach(() => {
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
    document.addEventListener = originalDocumentAddEventListener;
    document.removeEventListener = originalDocumentRemoveEventListener;
  });

  it('returns without throwing', () => {
    expect(() => useConfirmClose()).not.toThrow();
  });

  it('registers close and lifecycle flush listeners on mount', () => {
    const TestComponent = defineComponent({
      setup() {
        useConfirmClose();
        return () => null;
      },
    });

    const wrapper = mount(TestComponent);

    expect(window.addEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    expect(window.addEventListener).toHaveBeenCalledWith('blur', expect.any(Function));
    expect(window.addEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(document.addEventListener).toHaveBeenCalledWith('freeze', expect.any(Function));
    expect(document.addEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );

    wrapper.unmount();
  });
});
