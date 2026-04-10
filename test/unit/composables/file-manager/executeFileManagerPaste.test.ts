/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeFileManagerPaste } from '~/composables/file-manager/executeFileManagerPaste';

const { crossVfsCopy, crossVfsMove } = vi.hoisted(() => ({
  crossVfsCopy: vi.fn(),
  crossVfsMove: vi.fn(),
}));

vi.mock('~/file-manager/core/vfs/crossVfs', () => ({
  crossVfsCopy,
  crossVfsMove,
}));

describe('executeFileManagerPaste', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crossVfsCopy.mockResolvedValue('assets/copied.mp4');
    crossVfsMove.mockResolvedValue('assets/moved.mp4');
    vi.stubGlobal('setTimeout', (fn: (...args: any[]) => void) => {
      fn();
      return 0 as any;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses cross-vfs copy when clipboard source belongs to another registered manager', async () => {
    const onFileSelect = vi.fn();
    const findEntryByPath = vi.fn((path: string) =>
      path === 'assets/copied.mp4'
        ? {
            kind: 'file',
            name: 'copied.mp4',
            path,
          }
        : null,
    );

    await executeFileManagerPaste({
      payload: {
        source: 'fileManager',
        operation: 'copy',
        sourceInstanceId: 'computer',
        items: [
          {
            path: '/Users/demo/source.mp4',
            kind: 'file',
            name: 'source.mp4',
            source: 'local',
          },
        ],
      },
      targetEntry: { kind: 'directory', name: 'assets', path: 'assets' },
      targetVfs: { id: 'project-vfs' } as any,
      getSourceVfs: (instanceId) =>
        instanceId === 'computer' ? ({ id: 'computer-vfs' } as any) : null,
      findEntryByPath,
      copyEntry: vi.fn(),
      moveEntry: vi.fn(),
      reloadDirectory: vi.fn().mockResolvedValue(undefined),
      notifyFileManagerUpdate: vi.fn(),
      setFileTreePathExpanded: vi.fn(),
      onFileSelect,
      onFilesSelect: vi.fn(),
      clearClipboardPayload: vi.fn(),
    });

    expect(crossVfsCopy).toHaveBeenCalledWith({
      sourceVfs: { id: 'computer-vfs' },
      targetVfs: { id: 'project-vfs' },
      sourcePath: '/Users/demo/source.mp4',
      sourceKind: 'file',
      targetDirPath: 'assets',
    });
    expect(onFileSelect).toHaveBeenCalledWith({
      kind: 'file',
      name: 'copied.mp4',
      path: 'assets/copied.mp4',
    });
  });

  it('falls back to same-vfs move and clears clipboard on cut', async () => {
    const moveEntry = vi.fn().mockResolvedValue('assets/moved.mp4');
    const clearClipboardPayload = vi.fn();
    const sharedVfs = { id: 'project-vfs' } as any;

    await executeFileManagerPaste({
      payload: {
        source: 'fileManager',
        operation: 'cut',
        sourceInstanceId: 'main',
        items: [
          {
            path: 'clips/source.mp4',
            kind: 'file',
            name: 'source.mp4',
            source: 'local',
          },
        ],
      },
      targetEntry: { kind: 'directory', name: 'assets', path: 'assets' },
      targetVfs: sharedVfs,
      getSourceVfs: () => sharedVfs,
      findEntryByPath: vi.fn((path: string) =>
        path === 'assets/moved.mp4'
          ? {
              kind: 'file',
              name: 'moved.mp4',
              path,
            }
          : {
              kind: 'file',
              name: 'source.mp4',
              path,
            },
      ),
      copyEntry: vi.fn(),
      moveEntry,
      reloadDirectory: vi.fn().mockResolvedValue(undefined),
      notifyFileManagerUpdate: vi.fn(),
      setFileTreePathExpanded: vi.fn(),
      onFileSelect: vi.fn(),
      onFilesSelect: vi.fn(),
      clearClipboardPayload,
    });

    expect(moveEntry).toHaveBeenCalledWith({
      source: {
        kind: 'file',
        name: 'source.mp4',
        path: 'clips/source.mp4',
      },
      targetDirPath: 'assets',
    });
    expect(clearClipboardPayload).toHaveBeenCalledTimes(1);
    expect(crossVfsMove).not.toHaveBeenCalled();
  });
});
