/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useFileManagerActions } from '~/composables/file-manager/useFileManagerActions';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

// ──────────────────────────────────────────────
// Store mocks
// ──────────────────────────────────────────────

const uiStore = { selectedFsEntry: null, triggerScrollToFileTreeEntry: vi.fn() };
const workspaceStore = { userSettings: { deleteWithoutConfirmation: false }, workspaceState: { fileBrowser: { instances: {} } } };
const selectionStore = {
  selectedEntity: null,
  clearSelection: vi.fn(),
  selectFsEntryWithUiUpdate: vi.fn(),
  selectFsEntriesWithUiUpdate: vi.fn(),
};
const timelineMediaUsageStore = { mediaPathToTimelines: {} as Record<string, unknown[]> };
const projectStore = {
  isReadOnly: false,
  currentTimelinePath: null as string | null,
  closeTimelineFile: vi.fn().mockResolvedValue(undefined),
  openTimelineFile: vi.fn().mockResolvedValue(undefined),
};
const timelineStore = { loadTimeline: vi.fn().mockResolvedValue(undefined), loadTimelineMetadata: vi.fn() };
const focusStore = { setActiveTimelinePath: vi.fn() };
const projectTabsStore = { removeFileTabByPath: vi.fn() };
const clipboardStore = {
  clipboardPayload: null as null | { source: string; operation: string; items: unknown[]; sourceInstanceId?: string },
  setClipboardPayload: vi.fn(),
  clearClipboardPayload: vi.fn(),
  getFileManagerVfs: vi.fn(),
};
const fileManagerStore = { selectedFolder: null as FsEntry | null, openFolder: vi.fn() };

const toastAddMock = vi.fn();

vi.mock('~/stores/ui.store', () => ({ useUiStore: () => uiStore }));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => workspaceStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => selectionStore }));
vi.mock('~/stores/timeline-media-usage.store', () => ({ useTimelineMediaUsageStore: () => timelineMediaUsageStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => projectStore }));
vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => timelineStore }));
vi.mock('~/stores/focus.store', () => ({ useFocusStore: () => focusStore }));
vi.mock('~/stores/file-manager.store', () => ({ useFileManagerStore: () => fileManagerStore }));
vi.mock('~/stores/project-tabs.store', () => ({ useProjectTabsStore: () => projectTabsStore }));
vi.mock('~/composables/useAppClipboard', () => ({ useAppClipboard: () => clipboardStore }));

vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }));
vi.stubGlobal('useToast', () => ({ add: toastAddMock }));

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

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
      readFile: vi.fn().mockResolvedValue(new Uint8Array()),
      writeFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as IFileSystemAdapter,
    findEntryByPath: vi.fn().mockReturnValue(null),
    readDirectory: vi.fn().mockResolvedValue([]),
    reloadDirectory: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

const dirEntry: FsEntry = { kind: 'directory', name: 'video', path: 'video' };
const fileEntry: FsEntry = { kind: 'file', name: 'clip.mp4', path: 'video/clip.mp4' };

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('useFileManagerActions — read-only guard', () => {
  beforeEach(() => {
    projectStore.isReadOnly = true;
    toastAddMock.mockClear();
    selectionStore.clearSelection.mockClear();
    projectStore.closeTimelineFile.mockClear();
  });

  it('createFolder action shows toast and does not create folder', async () => {
    const createFolder = vi.fn();
    const api = createComposable({ createFolder });

    await api.onFileAction('createFolder', dirEntry, () => []);

    expect(toastAddMock).toHaveBeenCalledOnce();
    expect(createFolder).not.toHaveBeenCalled();
  });

  it('upload action shows toast and does not trigger file input', async () => {
    const api = createComposable();
    const inputEl = { click: vi.fn() } as unknown as HTMLInputElement;
    api.directoryUploadInput.value = inputEl;

    await api.onFileAction('upload', dirEntry);

    expect(toastAddMock).toHaveBeenCalledOnce();
    expect(inputEl.click).not.toHaveBeenCalled();
  });

  it('rename (startRename) shows toast and does not set editingEntryPath', () => {
    const api = createComposable();

    api.onFileAction('rename', fileEntry);

    expect(toastAddMock).toHaveBeenCalledOnce();
    expect(api.editingEntryPath.value).toBeNull();
  });

  it('delete action shows toast and does not open confirmation modal', async () => {
    const api = createComposable();

    await api.onFileAction('delete', fileEntry);

    expect(toastAddMock).toHaveBeenCalledOnce();
    expect(api.isDeleteConfirmModalOpen.value).toBe(false);
  });

  it('createProxy shows toast and does not call ensureProxy', async () => {
    const ensureProxy = vi.fn();
    const api = createComposable({ mediaCache: { ensureProxy, cancelProxy: vi.fn(), removeProxy: vi.fn() } });

    await api.onFileAction('createProxy', fileEntry);

    expect(toastAddMock).toHaveBeenCalledOnce();
    expect(ensureProxy).not.toHaveBeenCalled();
  });

  it('deleteProxy shows toast and does not call removeProxy', async () => {
    const removeProxy = vi.fn();
    const api = createComposable({ mediaCache: { ensureProxy: vi.fn(), cancelProxy: vi.fn(), removeProxy } });

    await api.onFileAction('deleteProxy', fileEntry);

    expect(toastAddMock).toHaveBeenCalledOnce();
    expect(removeProxy).not.toHaveBeenCalled();
  });

  it('createOtioVersion shows toast and does not copy file', async () => {
    const copyFile = vi.fn();
    const api = createComposable({
      vfs: { listEntryNames: vi.fn().mockResolvedValue([]), copyFile } as unknown as IFileSystemAdapter,
    });

    await api.onFileAction('createOtioVersion', { kind: 'file', name: 'timeline_001.otio', path: 'timelines/timeline_001.otio' });

    expect(toastAddMock).toHaveBeenCalledOnce();
    expect(copyFile).not.toHaveBeenCalled();
  });

  it('createMarkdown shows toast and does not create directory', async () => {
    const createDirectory = vi.fn();
    const api = createComposable({
      vfs: { createDirectory, listEntryNames: vi.fn().mockResolvedValue([]) } as unknown as IFileSystemAdapter,
    });

    await api.onFileAction('createMarkdown', dirEntry);

    expect(toastAddMock).toHaveBeenCalledOnce();
    expect(createDirectory).not.toHaveBeenCalled();
  });

  it('paste with cut operation shows toast and does not move files', async () => {
    clipboardStore.clipboardPayload = {
      source: 'fileManager',
      operation: 'cut',
      items: [{ path: 'video/clip.mp4', kind: 'file', name: 'clip.mp4', source: 'local' }],
    };

    const moveEntry = vi.fn();
    const api = createComposable({ moveEntry });

    await api.onFileAction('paste', dirEntry);

    expect(toastAddMock).toHaveBeenCalledOnce();
    expect(moveEntry).not.toHaveBeenCalled();
  });

  it('paste with copy operation shows toast and does not copy files', async () => {
    clipboardStore.clipboardPayload = {
      source: 'fileManager',
      operation: 'copy',
      items: [{ path: 'video/clip.mp4', kind: 'file', name: 'clip.mp4', source: 'local' }],
    };

    const copyEntry = vi.fn();
    const api = createComposable({ copyEntry });

    await api.onFileAction('paste', dirEntry);

    expect(toastAddMock).toHaveBeenCalledOnce();
    expect(copyEntry).not.toHaveBeenCalled();
  });

  it('copy action does NOT show toast — it is a clipboard-only operation', async () => {
    const api = createComposable();

    await api.onFileAction('copy', fileEntry);

    expect(toastAddMock).not.toHaveBeenCalled();
  });

  it('cut action does NOT show toast — it is a clipboard-only operation', async () => {
    const api = createComposable();

    await api.onFileAction('cut', fileEntry);

    expect(toastAddMock).not.toHaveBeenCalled();
  });
});

describe('useFileManagerActions — read-only guard disabled (isReadOnly = false)', () => {
  beforeEach(() => {
    projectStore.isReadOnly = false;
    toastAddMock.mockClear();
    workspaceStore.userSettings.deleteWithoutConfirmation = false;
  });

  it('delete action opens confirmation modal when not read-only', async () => {
    const api = createComposable();

    await api.onFileAction('delete', fileEntry);

    expect(toastAddMock).not.toHaveBeenCalled();
    expect(api.isDeleteConfirmModalOpen.value).toBe(true);
  });

  it('rename opens edit mode when not read-only', () => {
    const api = createComposable();

    api.onFileAction('rename', fileEntry);

    expect(toastAddMock).not.toHaveBeenCalled();
    expect(api.editingEntryPath.value).toBe(fileEntry.path);
  });
});
