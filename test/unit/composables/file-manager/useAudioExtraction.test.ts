/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAudioExtraction } from '~/composables/file-manager/useAudioExtraction';
import type { FsEntry } from '~/types/fs';

const { extractMetadata, extractAudio, setExportHostApi, createVideoCoreHostApi } = vi.hoisted(
  () => ({
    extractMetadata: vi.fn(),
    extractAudio: vi.fn(),
    setExportHostApi: vi.fn(),
    createVideoCoreHostApi: vi.fn(() => ({})),
  }),
);
const useI18nMock = vi.fn(() => ({ t: (key: string) => key }));
const toastAdd = vi.fn();

const sourceFile = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

const projectStore = {
  currentProjectId: 'project-1',
  getFileByPath: vi.fn(),
  getFileHandleByPath: vi.fn(),
  getDirectoryHandleByPath: vi.fn(),
};

const workspaceStore = {
  workspaceHandle: null,
  resolvedStorageTopology: null,
};

const uiStore = {
  setFileTreePathExpanded: vi.fn(),
  notifyFileManagerUpdate: vi.fn(),
  triggerScrollToFileTreeEntry: vi.fn(),
};

const selectionStore = {
  selectedEntity: {
    source: 'fileManager' as const,
    kind: 'file' as const,
    entry: { kind: 'file', name: 'clip.mp4', path: 'media/clip.mp4' } as FsEntry,
    path: 'media/clip.mp4',
    name: 'clip.mp4',
    instanceId: 'computer',
    isExternal: true,
  },
  selectFsEntryWithUiUpdate: vi.fn(),
};

const newEntry: FsEntry = {
  kind: 'file',
  name: 'clip_extracted.m4a',
  path: 'media/clip_extracted.m4a',
};

const fileManager = {
  vfs: {
    exists: vi.fn(),
  },
  reloadDirectory: vi.fn(),
  findEntryByPath: vi.fn(),
  resolveEntryByPath: vi.fn(),
};

const fileManagerStore = {
  openFolder: vi.fn(),
};

vi.mock('~/utils/video-editor/worker-client', () => ({
  getExportWorkerClient: () => ({
    client: {
      extractMetadata,
      extractAudio,
    },
  }),
  setExportHostApi,
}));

vi.mock('~/utils/video-editor/createVideoCoreHostApi', () => ({
  createVideoCoreHostApi,
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => projectStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStore,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => uiStore,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => selectionStore,
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => fileManager,
}));

vi.mock('~/stores/file-manager.store', () => ({
  useFileManagerStore: () => fileManagerStore,
}));

vi.stubGlobal('useI18n', useI18nMock);
vi.stubGlobal('useToast', () => ({ add: toastAdd }));

describe('useAudioExtraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectStore.getFileByPath.mockResolvedValue(sourceFile);
    projectStore.getFileHandleByPath.mockResolvedValue(null);
    projectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });
    fileManager.vfs.exists.mockResolvedValue(false);
    fileManager.reloadDirectory.mockResolvedValue(undefined);
    fileManager.findEntryByPath.mockReturnValue(newEntry);
    fileManager.resolveEntryByPath.mockResolvedValue(newEntry);
    extractMetadata.mockResolvedValue({
      audio: { codec: 'aac' },
    });
    extractAudio.mockResolvedValue(undefined);
    workspaceStore.workspaceHandle = null;
    fileManagerStore.openFolder.mockReset();
    selectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'file',
      entry: { kind: 'file', name: 'clip.mp4', path: 'media/clip.mp4' },
      path: 'media/clip.mp4',
      name: 'clip.mp4',
      instanceId: 'computer',
      isExternal: true,
    };
  });

  it('selects extracted audio with current file manager context', async () => {
    const entry: FsEntry = {
      kind: 'file',
      name: 'clip.mp4',
      path: 'media/clip.mp4',
    };

    const composable = useAudioExtraction();
    await composable.extractAudio(entry);

    expect(extractAudio).toHaveBeenCalledWith('media/clip.mp4', 'media/clip_extracted.m4a');
    expect(fileManager.reloadDirectory).toHaveBeenCalledWith('media');
    expect(selectionStore.selectFsEntryWithUiUpdate).toHaveBeenCalledWith(
      newEntry,
      'computer',
      true,
    );
  });

  it('creates extracted audio next to the source file for external workspace entries', async () => {
    const sourceHandle = {
      getFile: vi.fn().mockResolvedValue(sourceFile),
    };
    const targetHandle = {};
    const mediaDirectoryHandle = {
      getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
        if (name === 'clip.mp4' && !options?.create) return sourceHandle;
        if (name === 'clip_extracted.m4a' && options?.create) return targetHandle;
        throw new Error(`Unexpected file request: ${name}`);
      }),
    };

    workspaceStore.workspaceHandle = {
      getDirectoryHandle: vi.fn(async (name: string) => {
        if (name === 'media') return mediaDirectoryHandle;
        throw new Error(`Unexpected directory request: ${name}`);
      }),
    } as unknown as FileSystemDirectoryHandle;

    const entry: FsEntry = {
      kind: 'file',
      name: 'clip.mp4',
      path: 'media/clip.mp4',
    };

    const composable = useAudioExtraction();
    await composable.extractAudio(entry, { isExternal: true, instanceId: 'computer' });

    expect(sourceHandle.getFile).toHaveBeenCalled();
    expect(mediaDirectoryHandle.getFileHandle).toHaveBeenCalledWith('clip_extracted.m4a', {
      create: true,
    });
    expect(projectStore.getDirectoryHandleByPath).not.toHaveBeenCalled();
    expect(extractAudio).toHaveBeenCalledWith('media/clip.mp4', 'media/clip_extracted.m4a');
    expect(selectionStore.selectFsEntryWithUiUpdate).toHaveBeenCalledWith(
      newEntry,
      'computer',
      true,
    );
  });
});
