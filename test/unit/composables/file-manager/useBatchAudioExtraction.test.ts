/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBatchAudioExtraction } from '~/composables/file-manager/useBatchAudioExtraction';
import type { FsEntry } from '~/types/fs';

const {
  extractMetadata,
  extractAudio,
  setExportHostApi,
  createVideoCoreHostApi,
  isTauriRuntimeMock,
  nativeMediaMetadata,
  nativeExtractAudio,
} = vi.hoisted(() => ({
  extractMetadata: vi.fn(),
  extractAudio: vi.fn(),
  setExportHostApi: vi.fn(),
  createVideoCoreHostApi: vi.fn(() => ({})),
  isTauriRuntimeMock: vi.fn(() => false),
  nativeMediaMetadata: vi.fn(),
  nativeExtractAudio: vi.fn(),
}));

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
  notifyFileManagerUpdate: vi.fn(),
};

const backgroundTasksStore = {
  addTask: vi.fn(() => 'task-batch-1'),
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn(),
  tasks: [],
};

const fileManager = {
  vfs: {
    exists: vi.fn(),
  },
  reloadDirectory: vi.fn(),
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

vi.mock('~/stores/background-tasks.store', () => ({
  useBackgroundTasksStore: () => backgroundTasksStore,
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => fileManager,
}));

vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }));
vi.stubGlobal('useToast', () => ({ add: vi.fn() }));

describe('useBatchAudioExtraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectStore.getFileByPath.mockReset();
    projectStore.getFileHandleByPath.mockReset();
    projectStore.getDirectoryHandleByPath.mockReset();
    fileManager.vfs.exists.mockResolvedValue(false);
    fileManager.reloadDirectory.mockResolvedValue(undefined);
    extractMetadata.mockResolvedValue({ audio: { codec: 'aac' } });
    extractAudio.mockResolvedValue(undefined);
    isTauriRuntimeMock.mockReturnValue(false);
    nativeMediaMetadata.mockResolvedValue({ audio: { codec: 'aac' } });
    nativeExtractAudio.mockResolvedValue(undefined);
    workspaceStore.workspaceHandle = null;
    backgroundTasksStore.addTask.mockReturnValue('task-batch-1');
    projectStore.getFileByPath.mockResolvedValue(new File(['video'], 'clip.mp4', { type: 'video/mp4' }));
    projectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });
  });

  it('creates a single background task for batch extraction', async () => {
    const entries: FsEntry[] = [
      { kind: 'file', name: 'clip1.mp4', path: 'media/clip1.mp4' },
      { kind: 'file', name: 'clip2.mp4', path: 'media/clip2.mp4' },
    ];

    const composable = useBatchAudioExtraction();
    await composable.batchExtractAudio(entries, false);

    expect(backgroundTasksStore.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'conversion',
        title: 'videoEditor.fileManager.batchExtractAudio.taskTitle',
      }),
    );
    expect(backgroundTasksStore.updateTaskStatus).toHaveBeenCalledWith('task-batch-1', 'completed');
    expect(backgroundTasksStore.updateTaskProgress).toHaveBeenCalledWith('task-batch-1', 1);
  });

  it('filters out non-video and non-audio entries', async () => {
    const entries: FsEntry[] = [
      { kind: 'file', name: 'clip.mp4', path: 'media/clip.mp4' },
      { kind: 'file', name: 'doc.txt', path: 'media/doc.txt' },
      { kind: 'directory', name: 'folder', path: 'media/folder' },
    ];

    const composable = useBatchAudioExtraction();
    await composable.batchExtractAudio(entries, false);

    expect(extractAudio).toHaveBeenCalledTimes(1);
    expect(extractAudio).toHaveBeenCalledWith('media/clip.mp4', 'media/clip_extracted.m4a');
  });

  it('processes audio files as well as video files', async () => {
    const entries: FsEntry[] = [
      { kind: 'file', name: 'track.mp3', path: 'media/track.mp3' },
    ];

    const composable = useBatchAudioExtraction();
    await composable.batchExtractAudio(entries, false);

    expect(extractAudio).toHaveBeenCalledTimes(1);
  });

  it('updates progress after each file', async () => {
    const entries: FsEntry[] = [
      { kind: 'file', name: 'a.mp4', path: 'media/a.mp4' },
      { kind: 'file', name: 'b.mp4', path: 'media/b.mp4' },
      { kind: 'file', name: 'c.mp4', path: 'media/c.mp4' },
    ];

    const composable = useBatchAudioExtraction();
    await composable.batchExtractAudio(entries, false);

    expect(backgroundTasksStore.updateTaskProgress).toHaveBeenCalledWith('task-batch-1', expect.closeTo(1 / 3));
    expect(backgroundTasksStore.updateTaskProgress).toHaveBeenCalledWith('task-batch-1', expect.closeTo(2 / 3));
    expect(backgroundTasksStore.updateTaskProgress).toHaveBeenCalledWith('task-batch-1', 1);
  });

  it('prevents concurrent batch runs', async () => {
    const entries: FsEntry[] = [
      { kind: 'file', name: 'a.mp4', path: 'media/a.mp4' },
    ];

    const composable = useBatchAudioExtraction();
    await composable.batchExtractAudio(entries, false);

    expect(composable.isExtracting.value).toBe(false);
    expect(backgroundTasksStore.addTask).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    composable.isExtracting.value = true;
    await composable.batchExtractAudio(entries, false);

    expect(backgroundTasksStore.addTask).not.toHaveBeenCalled();
  });

  it('marks task failed when a file has no audio track', async () => {
    extractMetadata.mockResolvedValueOnce({ audio: null });

    const entries: FsEntry[] = [
      { kind: 'file', name: 'silent.mp4', path: 'media/silent.mp4' },
    ];

    const composable = useBatchAudioExtraction();
    await composable.batchExtractAudio(entries, false);

    expect(backgroundTasksStore.updateTaskStatus).toHaveBeenCalledWith(
      'task-batch-1',
      'failed',
      expect.stringContaining('No audio track'),
    );
  });
});
