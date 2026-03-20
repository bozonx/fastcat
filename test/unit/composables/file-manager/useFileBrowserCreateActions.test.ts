import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileBrowserCreateActions } from '~/composables/fileManager/useFileBrowserCreateActions';
import type { FsEntry } from '~/types/fs';

const { createTimelineCommand, createMarkdownCommand } = vi.hoisted(() => ({
  createTimelineCommand: vi.fn(),
  createMarkdownCommand: vi.fn(),
}));

const selectionStore = {
  selectFsEntry: vi.fn(),
};

const uiStore = {
  setFileTreePathExpanded: vi.fn(),
  notifyFileManagerUpdate: vi.fn(),
};

vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => selectionStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => uiStore }));
vi.mock('~/file-manager/application/fileManagerCommands', () => ({
  createTimelineCommand,
  createMarkdownCommand,
}));

describe('useFileBrowserCreateActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates timeline in directory and selects new entry', async () => {
    createTimelineCommand.mockResolvedValue('dir/new.otio');
    const readDirectory = vi.fn().mockResolvedValue([{ name: 'existing.txt' }]);
    const reloadDirectory = vi.fn().mockResolvedValue(undefined);
    const loadFolderContent = vi.fn().mockResolvedValue(undefined);
    const findEntryByPath = vi
      .fn()
      .mockReturnValue({ kind: 'file', name: 'new.otio', path: 'dir/new.otio' });

    const { createTimelineInDirectory } = useFileBrowserCreateActions({
      vfs: {} as any,
      readDirectory,
      reloadDirectory,
      loadFolderContent,
      findEntryByPath,
    });

    await createTimelineInDirectory({ kind: 'directory', name: 'dir', path: 'dir' } as FsEntry);

    expect(readDirectory).toHaveBeenCalledWith('dir');
    expect(createTimelineCommand).toHaveBeenCalledWith({
      vfs: expect.anything(),
      timelinesDirName: 'dir',
      existingNames: ['existing.txt'],
    });
    expect(reloadDirectory).toHaveBeenCalledWith('dir');
    expect(uiStore.notifyFileManagerUpdate).toHaveBeenCalled();
    expect(loadFolderContent).toHaveBeenCalled();
    expect(selectionStore.selectFsEntry).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'new.otio' }),
    );
  });

  it('creates markdown in directory and expands tree', async () => {
    createMarkdownCommand.mockResolvedValue('doc.md');
    const readDirectory = vi.fn().mockResolvedValue([]);
    const reloadDirectory = vi.fn().mockResolvedValue(undefined);
    const loadFolderContent = vi.fn().mockResolvedValue(undefined);
    const findEntryByPath = vi
      .fn()
      .mockReturnValue({ kind: 'file', name: 'doc.md', path: 'folder/doc.md' });

    const { createMarkdownInDirectory } = useFileBrowserCreateActions({
      vfs: {} as any,
      readDirectory,
      reloadDirectory,
      loadFolderContent,
      findEntryByPath,
    });

    await createMarkdownInDirectory({
      kind: 'directory',
      name: 'folder',
      path: 'folder',
    } as FsEntry);

    expect(uiStore.setFileTreePathExpanded).toHaveBeenCalledWith('folder', true);
    expect(createMarkdownCommand).toHaveBeenCalledWith({
      vfs: expect.anything(),
      dirPath: 'folder',
      existingNames: [],
    });
    expect(reloadDirectory).toHaveBeenCalledWith('folder');
    expect(uiStore.notifyFileManagerUpdate).toHaveBeenCalled();
    expect(loadFolderContent).toHaveBeenCalled();
    expect(selectionStore.selectFsEntry).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'doc.md' }),
    );
  });
});
