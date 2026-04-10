/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive, type EffectScope } from 'vue';

import { useFileManagerPanelPendingActions } from '~/composables/file-manager/useFileManagerPanelPendingActions';

const uiStore = reactive({
  pendingFsEntryDelete: null as any,
  pendingFsEntryRename: null as any,
  pendingFsEntryCreateFolder: null as any,
  pendingFsEntryCreateTimeline: null as any,
  pendingFsEntryCreateMarkdown: null as any,
  pendingOtioCreateVersion: null as any,
  pendingFsEntryPaste: null as any,
});

const focusStore = reactive({
  isPanelFocused: vi.fn(() => true),
});

const selectionStore = reactive({
  selectedEntity: null as any,
});

vi.mock('~/stores/ui.store', () => ({ useUiStore: () => uiStore }));
vi.mock('~/stores/focus.store', () => ({ useFocusStore: () => focusStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => selectionStore }));

describe('useFileManagerPanelPendingActions', () => {
  let scope: EffectScope;

  beforeEach(() => {
    uiStore.pendingFsEntryDelete = null;
    uiStore.pendingFsEntryRename = null;
    uiStore.pendingFsEntryCreateFolder = null;
    uiStore.pendingFsEntryCreateTimeline = null;
    uiStore.pendingFsEntryCreateMarkdown = null;
    uiStore.pendingOtioCreateVersion = null;
    uiStore.pendingFsEntryPaste = null;
    selectionStore.selectedEntity = null;
    focusStore.isPanelFocused.mockReturnValue(true);
    vi.clearAllMocks();
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
  });

  function mountComposable(
    overrides: Partial<Parameters<typeof useFileManagerPanelPendingActions>[0]> = {},
  ) {
    scope.run(() => {
      useFileManagerPanelPendingActions({
        openDeleteConfirmModal: vi.fn(),
        startRename: vi.fn(),
        onCreateFolder: vi.fn(),
        createTimelineInDirectory: vi.fn(),
        createMarkdownInDirectory: vi.fn(),
        createOtioVersion: vi.fn(),
        onPasteTarget: vi.fn().mockResolvedValue(undefined),
        handlePendingBloggerDogCreateSubgroup: vi.fn(),
        handlePendingBloggerDogCreateItem: vi.fn(),
        instanceId: 'test',
        ...overrides,
      });
    });
  }

  it('triggers delete confirm modal and clears state', async () => {
    const openDeleteConfirmModal = vi.fn();
    mountComposable({ openDeleteConfirmModal });

    const entries = [{ kind: 'file', name: 'test.mp4', path: 'test.mp4' }];
    uiStore.pendingFsEntryDelete = entries;
    await nextTick();

    expect(openDeleteConfirmModal).toHaveBeenCalledWith(entries);
    expect(uiStore.pendingFsEntryDelete).toBeNull();
  });

  it('triggers create timeline, waits for promise, and clears state', async () => {
    const createTimelineInDirectory = vi.fn().mockResolvedValue(undefined);
    mountComposable({ createTimelineInDirectory });

    const entry = { kind: 'directory', name: 'dir', path: 'dir' };
    uiStore.pendingFsEntryCreateTimeline = entry;
    await nextTick();
    await Promise.resolve();

    expect(createTimelineInDirectory).toHaveBeenCalledWith(entry);
    expect(uiStore.pendingFsEntryCreateTimeline).toBeNull();
  });

  it('ignores create timeline if entry is not directory', async () => {
    const createTimelineInDirectory = vi.fn();
    mountComposable({ createTimelineInDirectory });

    uiStore.pendingFsEntryCreateTimeline = { kind: 'file', name: 'test.txt', path: 'test.txt' };
    await nextTick();

    expect(createTimelineInDirectory).not.toHaveBeenCalled();
  });

  it('routes pending paste through the shared handler and clears state', async () => {
    const onPasteTarget = vi.fn().mockResolvedValue(undefined);
    mountComposable({ onPasteTarget });

    const entry = { kind: 'directory', name: 'assets', path: 'assets' };
    uiStore.pendingFsEntryPaste = entry;
    await nextTick();
    await Promise.resolve();

    expect(onPasteTarget).toHaveBeenCalledWith(entry);
    expect(uiStore.pendingFsEntryPaste).toBeNull();
  });
});
