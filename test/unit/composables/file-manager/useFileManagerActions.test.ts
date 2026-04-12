/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileManagerActions } from '~/composables/file-manager/useFileManagerActions';
import type { FsEntry } from '~/types/fs';
import type { SelectedEntity } from '~/stores/selection.store';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

interface SelectedFsEntryInfo {
  kind: FsEntry['kind'];
  name: string;
  path?: string;
}

interface ClipboardPayloadMock {
  source: 'fileManager';
  operation: 'copy' | 'cut';
  items: Array<{
    path: string;
    kind: FsEntry['kind'];
    name: string;
    source?: FsEntry['source'];
  }>;
  sourceInstanceId?: string;
}

interface UiStoreMock {
  selectedFsEntry: SelectedFsEntryInfo | null;
  triggerScrollToFileTreeEntry: ReturnType<typeof vi.fn>;
}

interface SelectionStoreMock {
  selectedEntity: SelectedEntity | null;
  clearSelection: ReturnType<typeof vi.fn>;
  selectFsEntryWithUiUpdate: ReturnType<typeof vi.fn>;
  selectFsEntriesWithUiUpdate: ReturnType<typeof vi.fn>;
}

interface ClipboardStoreMock {
  clipboardPayload: ClipboardPayloadMock | null;
  setClipboardPayload: ReturnType<typeof vi.fn>;
  clearClipboardPayload: ReturnType<typeof vi.fn>;
  getFileManagerVfs: ReturnType<typeof vi.fn>;
}

const uiStore: UiStoreMock = {
  selectedFsEntry: null,
  triggerScrollToFileTreeEntry: vi.fn(),
};

const workspaceStore = {
  userSettings: {
    deleteWithoutConfirmation: false,
  },
  workspaceState: {
    fileBrowser: {
      instances: {},
    },
  },
};

const selectionStore: SelectionStoreMock = {
  selectedEntity: null,
  clearSelection: vi.fn(),
  selectFsEntryWithUiUpdate: vi.fn(),
  selectFsEntriesWithUiUpdate: vi.fn(),
};

const timelineMediaUsageStore = {
  mediaPathToTimelines: {} as Record<string, unknown[]>,
};

const projectStore = {
  currentTimelinePath: null as string | null,
  closeTimelineFile: vi.fn().mockResolvedValue(undefined),
  openTimelineFile: vi.fn().mockResolvedValue(undefined),
};

const timelineStore = {
  loadTimeline: vi.fn().mockResolvedValue(undefined),
  loadTimelineMetadata: vi.fn(),
};

const focusStore = {};

const projectTabsStore = {
  removeFileTabByPath: vi.fn(),
};

const clipboardStore: ClipboardStoreMock = {
  clipboardPayload: null,
  setClipboardPayload: vi.fn(),
  clearClipboardPayload: vi.fn(),
  getFileManagerVfs: vi.fn(),
};

const fileManagerStore = {
  selectedFolder: null as FsEntry | null,
  openFolder: vi.fn(),
};

vi.mock('~/stores/ui.store', () => ({ useUiStore: () => uiStore }));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => workspaceStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => selectionStore }));
vi.mock('~/stores/timeline-media-usage.store', () => ({
  useTimelineMediaUsageStore: () => timelineMediaUsageStore,
}));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => projectStore }));
vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => timelineStore }));
vi.mock('~/stores/focus.store', () => ({ useFocusStore: () => focusStore }));
vi.mock('~/stores/file-manager.store', () => ({ useFileManagerStore: () => fileManagerStore }));
vi.mock('~/stores/project-tabs.store', () => ({ useProjectTabsStore: () => projectTabsStore }));
vi.mock('~/composables/useAppClipboard', () => ({ useAppClipboard: () => clipboardStore }));

vi.stubGlobal('useI18n', () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }));
vi.stubGlobal('useToast', () => ({ add: vi.fn() }));

describe('useFileManagerActions', () => {
  beforeEach(() => {
    workspaceStore.userSettings.deleteWithoutConfirmation = false;
    uiStore.selectedFsEntry = null;
    selectionStore.selectedEntity = null;
    selectionStore.clearSelection.mockReset();
    selectionStore.selectFsEntryWithUiUpdate.mockReset();
    selectionStore.selectFsEntriesWithUiUpdate.mockReset();
    projectStore.currentTimelinePath = null;
    projectStore.closeTimelineFile.mockClear();
    projectStore.openTimelineFile.mockClear();
    projectTabsStore.removeFileTabByPath.mockClear();
    fileManagerStore.selectedFolder = null;
    fileManagerStore.openFolder.mockClear();
  });

  function createComposable(overrides: Partial<Parameters<typeof useFileManagerActions>[0]> = {}) {
    return useFileManagerActions({
      createFolder: vi.fn().mockResolvedValue(undefined),
      renameEntry: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined),
      loadProjectDirectory: vi.fn().mockResolvedValue(undefined),
      handleFiles: vi.fn().mockResolvedValue(undefined),
      mediaCache: {
        ensureProxy: vi.fn(),
        cancelProxy: vi.fn(),
        removeProxy: vi.fn(),
      },
      vfs: {
        listEntryNames: vi.fn().mockResolvedValue([]),
        copyFile: vi.fn().mockResolvedValue(undefined),
        createDirectory: vi.fn().mockResolvedValue(undefined),
      } as unknown as IFileSystemAdapter,
      findEntryByPath: vi.fn().mockReturnValue(null),
      readDirectory: vi.fn().mockResolvedValue([]),
      reloadDirectory: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    });
  }

  it('creates an isolated delete snapshot for the confirmation modal', async () => {
    const api = createComposable();
    const entries: FsEntry[] = [
      { kind: 'file', name: 'first.mp4', path: 'first.mp4' },
      { kind: 'file', name: 'second.mp4', path: 'second.mp4' },
    ];

    await api.openDeleteConfirmModal(entries);

    entries[0]!.name = 'mutated.mp4';
    entries.push({ kind: 'file', name: 'third.mp4', path: 'third.mp4' });

    expect(api.isDeleteConfirmModalOpen.value).toBe(true);
    expect(api.deleteTargets.value).toHaveLength(2);
    expect(api.deleteTargets.value[0]?.name).toBe('first.mp4');
  });

  it('closes the delete modal immediately before async deletion finishes', async () => {
    let resolveDelete: (() => void) | null = null;
    const deleteEntry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const api = createComposable({ deleteEntry });

    api.deleteTargets.value = [{ kind: 'file', name: 'clip.mp4', path: 'clip.mp4' }];
    api.isDeleteConfirmModalOpen.value = true;

    const pendingDelete = api.handleDeleteConfirm();

    expect(api.isDeleteConfirmModalOpen.value).toBe(false);
    expect(api.deleteTargets.value).toEqual([]);
    expect(deleteEntry).toHaveBeenCalledWith({
      kind: 'file',
      name: 'clip.mp4',
      path: 'clip.mp4',
    });

    resolveDelete?.();
    await pendingDelete;
  });
});
