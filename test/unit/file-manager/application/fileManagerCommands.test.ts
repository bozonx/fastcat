// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { FsEntry } from '../../../../src/types/fs';
import {
  handleFilesCommand,
  deleteEntryCommand,
  renameEntryCommand,
  moveEntryCommand,
  createTimelineCommand,
} from '../../../../src/file-manager/application/fileManagerCommands';

function createDirHandleMock() {
  return {
    getFileHandle: vi.fn(),
    getDirectoryHandle: vi.fn(),
  } as any as FileSystemDirectoryHandle;
}

function createFileEntry(params: {
  name: string;
  path: string;
  parent: FileSystemDirectoryHandle;
  withMove?: boolean;
}) {
  const handle = {
    getFile: vi.fn(async () => new File(['x'], params.name, { type: 'text/plain' })),
    move: params.withMove === false ? undefined : vi.fn(async () => undefined),
  } as any as FileSystemFileHandle;

  const entry: FsEntry = {
    name: params.name,
    kind: 'file',
    handle,
    parentHandle: params.parent,
    path: params.path,
  };

  return { entry, handle };
}

function createDirEntry(params: { name: string; path: string; parent: FileSystemDirectoryHandle }) {
  const handle = {
    move: undefined,
  } as any as FileSystemDirectoryHandle;

  const entry: FsEntry = {
    name: params.name,
    kind: 'directory',
    handle,
    parentHandle: params.parent,
    path: params.path,
    children: [],
  };

  return { entry, handle };
}

describe('fileManagerCommands', () => {
  it('handleFilesCommand keeps svg source file unchanged on import', async () => {
    const file = new File(['<svg></svg>'], 'logo.svg', { type: 'image/svg+xml' });
    const onMediaImported = vi.fn(async () => undefined);

    const vfs = {
      // In the new handleFilesCommand logic, if the file already exists, it throws an error immediately.
      // So to make it save, vfs.exists must return false.
      exists: vi.fn(async () => false),
      writeFile: vi.fn(async () => undefined),
    };

    await handleFilesCommand(
      [file],
      {},
      {
        vfs: vfs as any,
        getTargetDirPath: async () => 'images',
        onSkipProjectFile: vi.fn(),
        onMediaImported,
      },
    );

    expect(vfs.writeFile).toHaveBeenCalledWith('images/logo.svg', file);
    expect(onMediaImported).not.toHaveBeenCalled();
  });

  it('deleteEntryCommand calls removeEntry and onFileDeleted for files with path', async () => {
    const parent = createDirHandleMock();
    const { entry } = createFileEntry({ name: 'a.mp4', path: 'video/a.mp4', parent });

    const removeEntry = vi.fn(async () => undefined);
    const onFileDeleted = vi.fn(async () => undefined);
    const vfs = {
      deleteEntry: vi.fn(async () => undefined),
    };

    await deleteEntryCommand(entry, { removeEntry, onFileDeleted, vfs: vfs as any });

    expect(vfs.deleteEntry).toHaveBeenCalledWith('video/a.mp4', true);
    expect(onFileDeleted).toHaveBeenCalledWith({ path: 'video/a.mp4' });
  });

  it('deleteEntryCommand does not call onFileDeleted for directories', async () => {
    const parent = createDirHandleMock();
    const { entry } = createDirEntry({ name: 'images', path: 'images', parent });

    const removeEntry = vi.fn(async () => undefined);
    const onFileDeleted = vi.fn(async () => undefined);
    const vfs = {
      deleteEntry: vi.fn(async () => undefined),
    };

    await deleteEntryCommand(entry, { removeEntry, onFileDeleted, vfs: vfs as any });

    expect(vfs.deleteEntry).toHaveBeenCalledWith('images', true);
    expect(onFileDeleted).not.toHaveBeenCalled();
  });

  it('renameEntryCommand uses vfs.moveEntry', async () => {
    const parent = createDirHandleMock();
    const { entry, handle } = createFileEntry({ name: 'a.txt', path: 'files/a.txt', parent });
    const vfs = {
      exists: vi.fn(async () => false),
      moveEntry: vi.fn(async () => undefined),
    };

    await renameEntryCommand(
      { target: entry, newName: 'b.txt' },
      {
        ensureTargetNameDoesNotExist: vi.fn(async () => undefined),
        removeEntry: vi.fn(async () => undefined),
        vfs: vfs as any,
      },
    );

    expect(vfs.moveEntry).toHaveBeenCalledWith('files/a.txt', 'files/b.txt');
  });

  it('moveEntryCommand calls deps.onFileMoved for files', async () => {
    const parent = createDirHandleMock();
    const targetDir = createDirHandleMock();
    const { entry } = createFileEntry({
      name: 'a.txt',
      path: 'files/a.txt',
      parent,
      withMove: false,
    });

    const removeEntry = vi.fn(async () => undefined);
    const onFileMoved = vi.fn(async () => undefined);
    const vfs = {
      exists: vi.fn(async () => false),
      copyFile: vi.fn(async () => undefined),
      moveEntry: vi.fn(async () => undefined),
    };

    // Mock file copy
    (targetDir.getFileHandle as any).mockResolvedValueOnce({
      createWritable: vi.fn(async () => ({ write: vi.fn(), close: vi.fn() })),
    });

    await moveEntryCommand(
      {
        source: entry,
        targetDirHandle: targetDir,
        targetDirPath: 'files2',
      },
      { removeEntry, onFileMoved, vfs: vfs as any },
    );

    expect(vfs.moveEntry).toHaveBeenCalledWith('files/a.txt', 'files2/a.txt');
    expect(onFileMoved).toHaveBeenCalledWith({ oldPath: 'files/a.txt', newPath: 'files2/a.txt' });
  });

  it('createTimelineCommand picks first available index on NotFoundError', async () => {
    const projectDir = createDirHandleMock();
    const timelinesDir = createDirHandleMock();
    const vfs = {
      createDirectory: vi.fn(async () => undefined),
      exists: vi.fn(async (path: string) => {
        return path === '_timelines/timeline_001.otio';
      }),
      writeJson: vi.fn(async () => undefined),
    };
    (projectDir.getDirectoryHandle as any).mockResolvedValue(timelinesDir);

    const path = await createTimelineCommand({
      projectDir,
      timelinesDirName: '_timelines',
      vfs: vfs as any,
    });
    expect(path).toBe('_timelines/timeline_002.otio');
    expect(vfs.writeJson).toHaveBeenCalled();
  });

  it('moveEntryCommand calls deps.onDirectoryMoved for directories', async () => {
    const parent = createDirHandleMock();
    const targetDir = createDirHandleMock();
    const { entry } = createDirEntry({ name: 'dir1', path: '_files/dir1', parent });

    const removeEntry = vi.fn(async () => undefined);
    const onDirectoryMoved = vi.fn(async () => undefined);
    const vfs = {
      exists: vi.fn(async () => false),
      copyDirectory: vi.fn(async () => undefined),
      moveEntry: vi.fn(async () => undefined),
    };

    // target dir creation
    const createdDir = createDirHandleMock();
    (targetDir.getDirectoryHandle as any).mockResolvedValueOnce(createdDir);

    await moveEntryCommand(
      { source: entry, targetDirHandle: targetDir, targetDirPath: '_files' },
      { removeEntry, onDirectoryMoved, vfs: vfs as any },
    );

    expect(vfs.moveEntry).toHaveBeenCalledWith('_files/dir1', '_files/dir1');
    expect(onDirectoryMoved).toHaveBeenCalled();
  });
});
