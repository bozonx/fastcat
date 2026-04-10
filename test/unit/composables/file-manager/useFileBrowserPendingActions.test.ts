/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive, ref, type EffectScope } from 'vue';

import { useFileBrowserPendingActions } from '~/composables/file-manager/useFileBrowserPendingActions';

const uiStore = reactive({
  pendingFsEntryDelete: null as any,
  pendingFsEntryRename: null as any,
  pendingFsEntryCreateFolder: null as any,
  pendingFsEntryCreateTimeline: null as any,
  pendingFsEntryCreateMarkdown: null as any,
  pendingFsEntryPaste: null as any,
  pendingRemoteDownloadRequest: null as any,
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

describe('useFileBrowserPendingActions', () => {
  let scope: EffectScope;

  beforeEach(() => {
    uiStore.pendingFsEntryDelete = null;
    uiStore.pendingFsEntryRename = null;
    uiStore.pendingFsEntryCreateFolder = null;
    uiStore.pendingFsEntryCreateTimeline = null;
    uiStore.pendingFsEntryCreateMarkdown = null;
    uiStore.pendingFsEntryPaste = null;
    uiStore.pendingRemoteDownloadRequest = null;
    selectionStore.selectedEntity = null;
    focusStore.isPanelFocused.mockReturnValue(true);
    vi.clearAllMocks();
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
  });

  function mountComposable(
    overrides: Partial<Parameters<typeof useFileBrowserPendingActions>[0]> = {},
  ) {
    scope.run(() => {
      useFileBrowserPendingActions({
        folderEntries: ref([]),
        startRename: vi.fn(),
        createTimelineInDirectory: vi.fn(),
        createMarkdownInDirectory: vi.fn(),
        openDeleteConfirmModal: vi.fn(),
        handlePendingRemoteDownloadRequest: vi.fn(),
        handlePendingBloggerDogCreateSubgroup: vi.fn(),
        handlePendingBloggerDogCreateItem: vi.fn(),
        onCreateFolder: vi.fn(),
        onPasteTarget: vi.fn().mockResolvedValue(undefined),
        instanceId: 'main',
        ...overrides,
      });
    });
  }

  it('triggers rename if entry is in current folder and clears state', async () => {
    const startRename = vi.fn();
    const folderEntries = ref([{ path: 'test.mp4' }]);

    mountComposable({
      folderEntries: folderEntries as any,
      startRename,
    });

    uiStore.pendingFsEntryRename = { path: 'test.mp4' };
    await nextTick();

    expect(startRename).toHaveBeenCalledWith({ path: 'test.mp4' });
    expect(uiStore.pendingFsEntryRename).toBeNull();
  });

  it('ignores rename if entry is not in current folder', async () => {
    const startRename = vi.fn();
    const folderEntries = ref([{ path: 'other.mp4' }]);

    mountComposable({
      folderEntries: folderEntries as any,
      startRename,
    });

    uiStore.pendingFsEntryRename = { path: 'test.mp4' };
    await nextTick();

    expect(startRename).not.toHaveBeenCalled();
    expect(uiStore.pendingFsEntryRename).not.toBeNull();
  });

  it('routes pending paste through the shared paste callback and clears state', async () => {
    const onPasteTarget = vi.fn().mockResolvedValue(undefined);

    mountComposable({ onPasteTarget });

    uiStore.pendingFsEntryPaste = { kind: 'directory', name: 'assets', path: 'assets' };
    await nextTick();
    await Promise.resolve();

    expect(onPasteTarget).toHaveBeenCalledWith({
      kind: 'directory',
      name: 'assets',
      path: 'assets',
    });
    expect(uiStore.pendingFsEntryPaste).toBeNull();
  });

  it('handles remote download request and clears state', async () => {
    const handlePendingRemoteDownloadRequest = vi.fn().mockResolvedValue(undefined);

    mountComposable({ handlePendingRemoteDownloadRequest });

    uiStore.pendingRemoteDownloadRequest = { fileId: '123' };
    await nextTick();
    await Promise.resolve();

    expect(handlePendingRemoteDownloadRequest).toHaveBeenCalledTimes(1);
    expect(uiStore.pendingRemoteDownloadRequest).toBeNull();
  });
});
