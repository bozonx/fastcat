/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import {
  createFileManager,
  useFileManager,
  isMoveAllowed,
  isCopyAllowed,
} from '~/composables/file-manager/useFileManager';
import type { FsEntry } from '~/types/fs';
import { LARGE_UPLOAD_BACKGROUND_THRESHOLD_BYTES } from '~/file-manager/application/fileManagerCommands';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useSelectionStore } from '~/stores/selection.store';

const backgroundTasksStore = {
  addTask: vi.fn(() => 'task-1'),
  updateTaskProgress: vi.fn(),
  updateTaskStatus: vi.fn(),
};

vi.mock('~/stores/background-tasks.store', () => ({
  useBackgroundTasksStore: () => backgroundTasksStore,
}));

vi.mock('~/stores/timeline-media-usage.store', () => ({
  useTimelineMediaUsageStore: () => ({
    refreshUsage: vi.fn(),
    setLiveUsage: vi.fn(),
  }),
}));

describe('useFileManager', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    backgroundTasksStore.addTask.mockClear();
    backgroundTasksStore.updateTaskProgress.mockClear();
    backgroundTasksStore.updateTaskStatus.mockClear();
  });

  it('should initialize with default state', () => {
    const { rootEntries, isLoading, error } = useFileManager();

    expect(rootEntries.value).toEqual([]);
    expect(isLoading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it('getFileIcon should return correct icon for different extensions', () => {
    const { getFileIcon } = useFileManager();

    expect(
      getFileIcon({
        name: 'folder',
        kind: 'directory',
        handle: {} as unknown as FileSystemDirectoryHandle,
      }),
    ).toBe('i-heroicons-folder');
    expect(
      getFileIcon({
        name: 'video.mp4',
        kind: 'file',
        handle: {} as unknown as FileSystemFileHandle,
      }),
    ).toBe('i-heroicons-film');
    expect(
      getFileIcon({
        name: 'audio.mp3',
        kind: 'file',
        handle: {} as unknown as FileSystemFileHandle,
      }),
    ).toBe('i-heroicons-musical-note');
    expect(
      getFileIcon({
        name: 'image.png',
        kind: 'file',
        handle: {} as unknown as FileSystemFileHandle,
      }),
    ).toBe('i-heroicons-photo');
    expect(
      getFileIcon({
        name: 'project.otio',
        kind: 'file',
        handle: {} as unknown as FileSystemFileHandle,
      }),
    ).toBe('i-heroicons-queue-list');
    expect(
      getFileIcon({
        name: 'unknown.txt',
        kind: 'file',
        handle: {} as unknown as FileSystemFileHandle,
      }),
    ).toBe('i-heroicons-document-text');
  });

  it('isMoveAllowed should prevent moving directory into itself or descendant', () => {
    expect(isMoveAllowed({ sourcePath: '_video', targetDirPath: '_video' })).toBe(false);
    expect(isMoveAllowed({ sourcePath: '_video', targetDirPath: '_video/sub' })).toBe(false);
    expect(isMoveAllowed({ sourcePath: '_video/sub', targetDirPath: '_video' })).toBe(true);
  });

  it('isMoveAllowed should allow moving into root', () => {
    expect(isMoveAllowed({ sourcePath: 'a/b', targetDirPath: '' })).toBe(true);
  });

  it('isMoveAllowed should handle edge cases', () => {
    expect(isMoveAllowed({ sourcePath: '', targetDirPath: 'a' })).toBe(true);
    expect(isMoveAllowed({ sourcePath: 'a', targetDirPath: '' })).toBe(true);
    expect(isMoveAllowed({ sourcePath: 'a/b/c', targetDirPath: 'a' })).toBe(true);
    expect(isMoveAllowed({ sourcePath: 'a', targetDirPath: 'a/b' })).toBe(false);
  });

  it('isCopyAllowed should prevent copying directory into itself or descendant', () => {
    expect(isCopyAllowed({ sourcePath: '_video', targetDirPath: '_video' })).toBe(false);
    expect(isCopyAllowed({ sourcePath: '_video', targetDirPath: '_video/sub' })).toBe(false);
    expect(isCopyAllowed({ sourcePath: '_video/sub', targetDirPath: '_video' })).toBe(true);
  });

  it('isCopyAllowed should allow copying into root', () => {
    expect(isCopyAllowed({ sourcePath: 'a/b', targetDirPath: '' })).toBe(true);
  });

  it('isCopyAllowed should handle edge cases', () => {
    expect(isCopyAllowed({ sourcePath: '', targetDirPath: 'a' })).toBe(true);
    expect(isCopyAllowed({ sourcePath: 'a', targetDirPath: '' })).toBe(true);
    expect(isCopyAllowed({ sourcePath: 'a/b/c', targetDirPath: 'a' })).toBe(true);
    expect(isCopyAllowed({ sourcePath: 'a', targetDirPath: 'a/b' })).toBe(false);
  });

  it('should have sortMode with default value', () => {
    const { sortMode } = useFileManager();
    expect(sortMode.value).toBe('name');
  });

  function createUploadFile(params: { name: string; size: number }): File {
    return {
      name: params.name,
      size: params.size,
      stream: () => new Blob(['x']).stream(),
    } as File;
  }

  function createUploadManager() {
    const writeStream = vi.fn(async () => new WritableStream<Uint8Array>());
    const loadProjectDirectory = vi.fn();

    const vfs = {
      init: vi.fn(),
      readDirectory: vi.fn(async () => []),
      createDirectory: vi.fn(),
      listEntryNames: vi.fn(async () => []),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      writeStream,
      readStream: vi.fn(),
      deleteEntry: vi.fn(),
      moveEntry: vi.fn(),
      copyFile: vi.fn(),
      copyDirectory: vi.fn(),
      exists: vi.fn(async () => false),
      getMetadata: vi.fn(async () => null),
      getObjectUrl: vi.fn(),
      getFile: vi.fn(),
      writeJson: vi.fn(),
    };

    const manager = createFileManager({
      t: (key: string, params?: Record<string, unknown>) =>
        params && typeof params === 'object' && 'fileName' in params
          ? `${key}:${String(params.fileName)}`
          : key,
      toast: { add: vi.fn() },
      vfs,
      isApiSupported: ref(true),
      rootEntries: ref([]),
      sortMode: ref('name'),
      showHiddenFiles: ref(false),
      isFileTreePathExpanded: vi.fn(() => false),
      setFileTreePathExpanded: vi.fn(),
      getExpandedPaths: vi.fn(() => []),
      getWorkspaceHandle: vi.fn(() => null),
      getProjectName: vi.fn(() => 'Project'),
      getProjectId: vi.fn(() => 'project-id'),
      getProjectSize: vi.fn(() => ({ width: 1920, height: 1080 })),
      onMediaImported: vi.fn(),
      mediaCache: {
        checkExistingProxies: vi.fn(),
        removeProxy: vi.fn(),
        clearVideoThumbnails: vi.fn(),
      } as any,
      mediaStore: {} as any,
      historyStore: { push: vi.fn() } as any,
      shouldRecordFileManagerHistory: vi.fn(() => false),
      hideCommonRoot: true,
      onDirectoryLoaded: loadProjectDirectory,
    });

    return { manager, writeStream, vfs };
  }

  it('handleFiles creates a background task for large uploads', async () => {
    const { manager } = createUploadManager();
    const file = createUploadFile({
      name: 'large.mp4',
      size: LARGE_UPLOAD_BACKGROUND_THRESHOLD_BYTES,
    });

    const results = await manager.handleFiles([file]);

    expect(backgroundTasksStore.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'file-operation',
        status: 'running',
        progress: 0,
      }),
    );
    expect(backgroundTasksStore.updateTaskProgress).toHaveBeenCalledWith('task-1', 1);
    expect(backgroundTasksStore.updateTaskStatus).toHaveBeenCalledWith('task-1', 'completed');
    expect(results?.[0]).toMatchObject({
      fileName: 'large.mp4',
      targetPath: '_video/large.mp4',
    });
  });

  it('handleFiles keeps small uploads out of background tasks', async () => {
    const { manager } = createUploadManager();
    const file = createUploadFile({ name: 'small.mp4', size: 1024 });

    await manager.handleFiles([file]);

    expect(backgroundTasksStore.addTask).not.toHaveBeenCalled();
  });

  it('handleFiles should automatically open target directory and select file if selectInFileManager is true', async () => {
    const { manager, vfs } = createUploadManager();
    const file = createUploadFile({ name: 'test.mp4', size: 1024 });

    vi.mocked(vfs.getMetadata).mockResolvedValue({
      kind: 'file',
      lastModified: Date.now(),
      size: 1024,
    });

    const fileManagerStore = useFileManagerStore();
    const selectionStore = useSelectionStore();

    const openFolderSpy = vi.spyOn(fileManagerStore, 'openFolderByPath');
    const selectFsEntrySpy = vi.spyOn(selectionStore, 'selectFsEntryWithUiUpdate');

    await manager.handleFiles([file], { selectInFileManager: true });

    expect(openFolderSpy).toHaveBeenCalledWith('_video');
    expect(selectFsEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'test.mp4',
        path: '_video/test.mp4',
      }),
    );
  });

  it('handleFiles should not select file in file manager if selectInFileManager is false', async () => {
    const { manager } = createUploadManager();
    const file = createUploadFile({ name: 'test.mp4', size: 1024 });

    const fileManagerStore = useFileManagerStore();
    const selectionStore = useSelectionStore();

    const openFolderSpy = vi.spyOn(fileManagerStore, 'openFolderByPath');
    const selectFsEntrySpy = vi.spyOn(selectionStore, 'selectFsEntryWithUiUpdate');

    await manager.handleFiles([file], { selectInFileManager: false });

    expect(openFolderSpy).not.toHaveBeenCalled();
    expect(selectFsEntrySpy).not.toHaveBeenCalled();
  });

  it('FsEntry type should match expected structure', () => {
    const entry: FsEntry = {
      name: 'test',
      kind: 'file',
      handle: {} as unknown as FileSystemFileHandle,
      path: 'test/path',
      lastModified: Date.now(),
    };

    expect(entry.name).toBe('test');
    expect(entry.kind).toBe('file');
    expect(entry.path).toBe('test/path');
  });
});
