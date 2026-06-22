/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAudioExtraction } from '~/composables/file-manager/useAudioExtraction';
import type { FsEntry } from '~/types/fs';

const {
  extractMetadata,
  extractAudio,
  setExportHostApi,
  createVideoCoreHostApi,
  createProjectHostApi,
  isTauriRuntimeMock,
  nativeMediaMetadata,
  nativeExtractAudio,
} = vi.hoisted(() => ({
  extractMetadata: vi.fn(),
  extractAudio: vi.fn(),
  setExportHostApi: vi.fn(),
  createVideoCoreHostApi: vi.fn(() => ({})),
  createProjectHostApi: vi.fn(() => ({})),
  isTauriRuntimeMock: vi.fn(() => false),
  nativeMediaMetadata: vi.fn(),
  nativeExtractAudio: vi.fn(),
}));
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
  workspaceState: {
    fileBrowser: {
      instances: {},
    },
  },
};

const uiStore = {
  setFileTreePathExpanded: vi.fn(),
  notifyFileManagerUpdate: vi.fn(),
  triggerScrollToFileTreeEntry: vi.fn(),
  isExtractingAudio: false,
  extractingAudioError: null as string | null,
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
  selectItem: vi.fn(),
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
  createProjectHostApi,
}));

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: isTauriRuntimeMock,
}));

vi.mock('~/utils/tauri-media-processing', () => ({
  getNativeFileHandlePath: (handle: unknown) =>
    typeof handle === 'object' && handle && 'path' in handle
      ? ((handle as { path?: string }).path ?? null)
      : null,
  nativeExtractAudio,
  nativeMediaMetadata,
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
    isTauriRuntimeMock.mockReturnValue(false);
    nativeMediaMetadata.mockResolvedValue({ audio: { codec: 'aac' } });
    nativeExtractAudio.mockResolvedValue(undefined);
    workspaceStore.workspaceHandle = null;
    fileManagerStore.openFolder.mockReset();
    fileManagerStore.selectItem.mockReset();
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
    expect(fileManagerStore.selectItem).toHaveBeenCalledWith(newEntry, {
      instanceId: 'computer',
      isExternal: true,
    });
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
    expect(fileManagerStore.selectItem).toHaveBeenCalledWith(newEntry, {
      instanceId: 'computer',
      isExternal: true,
    });
    expect(selectionStore.selectFsEntryWithUiUpdate).toHaveBeenCalledWith(
      newEntry,
      'computer',
      true,
    );
  });

  it('falls back to selecting the created audio file when tree refresh has not resolved it yet', async () => {
    fileManager.findEntryByPath.mockReturnValueOnce(null);
    fileManager.resolveEntryByPath.mockResolvedValueOnce(null);

    const entry: FsEntry = {
      kind: 'file',
      name: 'clip.mp4',
      path: 'media/clip.mp4',
    };

    const composable = useAudioExtraction();
    await composable.extractAudio(entry, { isExternal: true, instanceId: 'computer' });

    expect(selectionStore.selectFsEntryWithUiUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'file',
        name: 'clip_extracted.m4a',
        path: 'media/clip_extracted.m4a',
        parentPath: 'media',
      }),
      'computer',
      true,
    );
  });

  it('uses native audio extraction in Tauri runtime', async () => {
    isTauriRuntimeMock.mockReturnValue(true);
    projectStore.getFileHandleByPath.mockResolvedValue({
      path: '/workspace/project/media/clip.mp4',
    });
    projectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({
        path: '/workspace/project/media/clip_extracted.m4a',
      }),
    });
    nativeMediaMetadata.mockResolvedValue({
      audio: { codec: 'aac' },
    });

    const entry: FsEntry = {
      kind: 'file',
      name: 'clip.mp4',
      path: 'media/clip.mp4',
    };

    const composable = useAudioExtraction();
    await composable.extractAudio(entry);

    expect(nativeMediaMetadata).toHaveBeenCalledWith('/workspace/project/media/clip.mp4');
    expect(nativeExtractAudio).toHaveBeenCalledWith({
      taskId: expect.stringMatching(/^audio-extract-/),
      sourcePath: '/workspace/project/media/clip.mp4',
      targetPath: '/workspace/project/media/clip_extracted.m4a',
    });
    expect(extractAudio).not.toHaveBeenCalled();
    expect(fileManager.reloadDirectory).toHaveBeenCalledWith('media');
  });

  it('sets isExtractingAudio to true during extraction and false on success', async () => {
    const entry: FsEntry = {
      kind: 'file',
      name: 'clip.mp4',
      path: 'media/clip.mp4',
    };

    const composable = useAudioExtraction();

    // Before extraction
    expect(uiStore.isExtractingAudio).toBe(false);
    expect(uiStore.extractingAudioError).toBeNull();

    const promise = composable.extractAudio(entry);

    // During extraction (before promise resolves)
    expect(uiStore.isExtractingAudio).toBe(true);
    expect(uiStore.extractingAudioError).toBeNull();

    await promise;

    // After successful extraction
    expect(uiStore.isExtractingAudio).toBe(false);
    expect(uiStore.extractingAudioError).toBeNull();
  });

  it('keeps isExtractingAudio as true and sets extractingAudioError on failure', async () => {
    const entry: FsEntry = {
      kind: 'file',
      name: 'clip.mp4',
      path: 'media/clip.mp4',
    };

    extractAudio.mockRejectedValueOnce(new Error('Test extraction error'));

    const composable = useAudioExtraction();

    // Before extraction
    expect(uiStore.isExtractingAudio).toBe(false);
    expect(uiStore.extractingAudioError).toBeNull();

    await composable.extractAudio(entry);

    // After failed extraction: modal stays open, error is set
    expect(uiStore.isExtractingAudio).toBe(true);
    expect(uiStore.extractingAudioError).toBe('Test extraction error');
  });
});
