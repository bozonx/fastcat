/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useFileDrop } from '~/composables/file-manager/useFileDrop';
import type { FsEntry } from '~/types/fs';

const workspaceStoreMock = {
  userSettings: {
    hotkeys: {
      layer1: 'Shift',
      layer2: 'Control',
      bindings: {},
    },
  },
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}));

describe('useFileDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies to root on internal drop when layer1 modifier is active', async () => {
    const source: FsEntry = {
      name: 'clip.mp4',
      kind: 'file',
      path: '_video/clip.mp4',
    };
    const resolveEntryByPath = vi.fn(async () => source);
    const handleFiles = vi.fn();
    const moveEntry = vi.fn();
    const copyEntry = vi.fn();

    const { onRootDrop } = useFileDrop({
      resolveEntryByPath,
      handleFiles,
      moveEntry,
      copyEntry,
    });

    const event = {
      stopPropagation: vi.fn(),
      shiftKey: true,
      dataTransfer: {
        files: [],
        types: ['application/fastcat-file-manager-move'],
        getData: vi.fn((type: string) => {
          if (type === 'application/fastcat-file-manager-move') {
            return JSON.stringify([{ path: '_video/clip.mp4' }]);
          }
          return '';
        }),
      },
    } as unknown as DragEvent;

    await onRootDrop(event);

    expect(copyEntry).toHaveBeenCalledWith({
      source,
      targetDirPath: '',
    });
    expect(moveEntry).not.toHaveBeenCalled();
    expect(handleFiles).not.toHaveBeenCalled();
  });

  it('moves to root on internal drop when layer1 modifier is not active', async () => {
    const source: FsEntry = {
      name: 'clip.mp4',
      kind: 'file',
      path: '_video/clip.mp4',
    };
    const resolveEntryByPath = vi.fn(async () => source);
    const handleFiles = vi.fn();
    const moveEntry = vi.fn();
    const copyEntry = vi.fn();

    const { onRootDrop } = useFileDrop({
      resolveEntryByPath,
      handleFiles,
      moveEntry,
      copyEntry,
    });

    const event = {
      stopPropagation: vi.fn(),
      shiftKey: false,
      dataTransfer: {
        files: [],
        types: ['application/fastcat-file-manager-move'],
        getData: vi.fn((type: string) => {
          if (type === 'application/fastcat-file-manager-move') {
            return JSON.stringify([{ path: '_video/clip.mp4' }]);
          }
          return '';
        }),
      },
    } as unknown as DragEvent;

    await onRootDrop(event);

    expect(moveEntry).toHaveBeenCalledWith({
      source,
      targetDirPath: '',
    });
    expect(copyEntry).not.toHaveBeenCalled();
    expect(handleFiles).not.toHaveBeenCalled();
  });
});
