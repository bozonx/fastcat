// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { FsEntry } from '../../../../src/types/fs';
import {
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

function createFileEntry(params: { name: string; path: string; parent: FileSystemDirectoryHandle }) {
  const handle = {
    getFile: vi.fn(async () => new File(['x'], params.name, { type: 'text/plain' })),
    move: vi.fn(async () => undefined),
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
    move: vi.fn(async () => undefined),
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
  it('deleteEntryCommand calls removeEntry and onFileDeleted for files with path', async () => {
    const parent = createDirHandleMock();
    const { entry } = createFileEntry({ name: 'a.mp4', path: 'video/a.mp4', parent });

    const removeEntry = vi.fn(async () => undefined);
    const onFileDeleted = vi.fn(async () => undefined);

    await deleteEntryCommand(entry, { removeEntry, onFileDeleted });

    expect(removeEntry).toHaveBeenCalledWith({
      parentHandle: parent,
      name: 'a.mp4',
      recursive: true,
    });
    expect(onFileDeleted).toHaveBeenCalledWith({ path: 'video/a.mp4' });
  });

  it('renameEntryCommand uses handle.move when available', async () => {
    const parent = createDirHandleMock();
    const { entry, handle } = createFileEntry({ name: 'a.txt', path: 'files/a.txt', parent });

    await renameEntryCommand(
      { target: entry, newName: 'b.txt' },
      {
        ensureTargetNameDoesNotExist: vi.fn(async () => undefined),
        removeEntry: vi.fn(async () => undefined),
      },
    );

    expect((handle as any).move).toHaveBeenCalledWith('b.txt');
  });

  it('moveEntryCommand calls deps.onFileMoved for files', async () => {
    const parent = createDirHandleMock();
    const targetDir = createDirHandleMock();
    const { entry } = createFileEntry({ name: 'a.txt', path: 'files/a.txt', parent });

    const removeEntry = vi.fn(async () => undefined);
    const onFileMoved = vi.fn(async () => undefined);

    // Mock: assertEntryDoesNotExist -> internally calls targetDir.getFileHandle / getDirectoryHandle.
    // Here simulate file doesn't exist.
    (targetDir.getFileHandle as any).mockRejectedValueOnce(Object.assign(new Error('nf'), { name: 'NotFoundError' }));

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
      { removeEntry, onFileMoved },
    );

    expect(removeEntry).toHaveBeenCalled();
    expect(onFileMoved).toHaveBeenCalledWith({ oldPath: 'files/a.txt', newPath: 'files2/a.txt' });
  });

  it('createTimelineCommand picks first available index on NotFoundError', async () => {
    const projectDir = createDirHandleMock();
    const timelinesDir = createDirHandleMock();
    (projectDir.getDirectoryHandle as any).mockResolvedValue(timelinesDir);

    // timeline_001 exists, timeline_002 does not
    (timelinesDir.getFileHandle as any)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('nf'), { name: 'NotFoundError' }));

    const writable = { write: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
    (timelinesDir.getFileHandle as any).mockResolvedValueOnce({
      createWritable: vi.fn(async () => writable),
    });

    const path = await createTimelineCommand({ projectDir, timelinesDirName: 'timelines' });
    expect(path).toBe('timelines/timeline_002.otio');
    expect(writable.write).toHaveBeenCalled();
  });

  it('moveEntryCommand calls deps.onDirectoryMoved for directories', async () => {
    const parent = createDirHandleMock();
    const targetDir = createDirHandleMock();
    const { entry } = createDirEntry({ name: 'dir1', path: 'sources/dir1', parent });

    const removeEntry = vi.fn(async () => undefined);
    const onDirectoryMoved = vi.fn(async () => undefined);

    // assertEntryDoesNotExist: directory doesn't exist
    (targetDir.getDirectoryHandle as any).mockRejectedValueOnce(Object.assign(new Error('nf'), { name: 'NotFoundError' }));

    // target dir creation
    const createdDir = createDirHandleMock();
    (targetDir.getDirectoryHandle as any).mockResolvedValueOnce(createdDir);

    await moveEntryCommand(
      { source: entry, targetDirHandle: targetDir, targetDirPath: 'sources' },
      { removeEntry, onDirectoryMoved },
    );

    expect(removeEntry).toHaveBeenCalledWith({
      parentHandle: parent,
      name: 'dir1',
      recursive: true,
    });
    expect(onDirectoryMoved).toHaveBeenCalled();
  });
});
