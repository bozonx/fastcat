import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive, effectScope, type EffectScope } from 'vue';

import { useFileManagerPanelPendingActions } from '~/composables/file-manager/useFileManagerPanelPendingActions';

const uiStore = reactive({
  pendingFsEntryDelete: null as any,
  pendingFsEntryRename: null as any,
  pendingFsEntryCreateFolder: null as any,
  pendingFsEntryCreateTimeline: null as any,
  pendingFsEntryCreateMarkdown: null as any,
  pendingOtioCreateVersion: null as any,
});

vi.mock('~/stores/ui.store', () => ({ useUiStore: () => uiStore }));

describe('useFileManagerPanelPendingActions', () => {
  let scope: EffectScope;

  beforeEach(() => {
    uiStore.pendingFsEntryDelete = null;
    uiStore.pendingFsEntryRename = null;
    uiStore.pendingFsEntryCreateFolder = null;
    uiStore.pendingFsEntryCreateTimeline = null;
    uiStore.pendingFsEntryCreateMarkdown = null;
    uiStore.pendingOtioCreateVersion = null;
    vi.clearAllMocks();
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
  });

  it('triggers delete confirm modal and clears state', async () => {
    const openDeleteConfirmModal = vi.fn();
    scope.run(() => {
      useFileManagerPanelPendingActions({
        openDeleteConfirmModal,
        startRename: vi.fn(),
        onCreateFolder: vi.fn(),
        createTimelineInDirectory: vi.fn(),
        createMarkdownInDirectory: vi.fn(),
        createOtioVersion: vi.fn(),
      });
    });

    const entries = [{ kind: 'file', name: 'test.mp4', path: 'test.mp4' }];
    uiStore.pendingFsEntryDelete = entries;
    await nextTick();

    expect(openDeleteConfirmModal).toHaveBeenCalledWith(entries);
    expect(uiStore.pendingFsEntryDelete).toBeNull();
  });

  it('triggers create timeline, waits for promise, and clears state', async () => {
    const createTimelineInDirectory = vi.fn().mockResolvedValue(undefined);
    scope.run(() => {
      useFileManagerPanelPendingActions({
        openDeleteConfirmModal: vi.fn(),
        startRename: vi.fn(),
        onCreateFolder: vi.fn(),
        createTimelineInDirectory,
        createMarkdownInDirectory: vi.fn(),
        createOtioVersion: vi.fn(),
      });
    });

    const entry = { kind: 'directory', name: 'dir', path: 'dir' };
    uiStore.pendingFsEntryCreateTimeline = entry;
    await nextTick(); // trigger watch
    await Promise.resolve(); // wait for async handler

    expect(createTimelineInDirectory).toHaveBeenCalledWith(entry);
    expect(uiStore.pendingFsEntryCreateTimeline).toBeNull();
  });

  it('ignores create timeline if entry is not directory', async () => {
    const createTimelineInDirectory = vi.fn();
    scope.run(() => {
      useFileManagerPanelPendingActions({
        openDeleteConfirmModal: vi.fn(),
        startRename: vi.fn(),
        onCreateFolder: vi.fn(),
        createTimelineInDirectory,
        createMarkdownInDirectory: vi.fn(),
        createOtioVersion: vi.fn(),
      });
    });

    const entry = { kind: 'file', name: 'test.txt', path: 'test.txt' };
    uiStore.pendingFsEntryCreateTimeline = entry;
    await nextTick();

    expect(createTimelineInDirectory).not.toHaveBeenCalled();
    // It doesn't clear if ignored by the type guard, or we should see how the watch is implemented.
    // Actually the watch just does `if (!entry || entry.kind !== 'directory') return;`
    // So it won't clear the state here, which is the current logic.
  });
});
