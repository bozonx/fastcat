/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addMediaTask: vi.fn((task: () => Promise<unknown>) => task()),
  restartExportWorker: vi.fn(),
  extractMetadata: vi.fn(),
  transcodeMedia: vi.fn(),
  setExportHostApi: vi.fn(),
  registerExportTaskHostApi: vi.fn(),
  unregisterExportTaskHostApi: vi.fn(),
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn(),
}));

vi.mock('~/utils/media-task-queue', () => ({
  MEDIA_TASK_PRIORITIES: {
    conversionBackground: 1,
  },
  addMediaTask: mocks.addMediaTask,
}));

vi.mock('~/utils/video-editor/worker-client', () => ({
  getExportWorkerClient: () => ({
    client: {
      extractMetadata: mocks.extractMetadata,
      transcodeMedia: mocks.transcodeMedia,
    },
  }),
  registerExportTaskHostApi: mocks.registerExportTaskHostApi,
  restartExportWorker: mocks.restartExportWorker,
  setExportHostApi: mocks.setExportHostApi,
  unregisterExportTaskHostApi: mocks.unregisterExportTaskHostApi,
}));

vi.mock('~/utils/video-editor/createVideoCoreHostApi', () => ({
  createVideoCoreHostApi: (params: unknown) => params,
  createProjectHostApi: vi.fn(() => ({})),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({
    currentProjectId: 'project',
    getFileByPath: vi.fn(async () => new File(['source'], 'clip.mp4', { type: 'video/mp4' })),
    getFileHandleByPath: vi.fn(),
  }),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    workspaceHandle: null,
    resolvedStorageTopology: null,
  }),
}));

vi.mock('~/stores/background-tasks.store', () => ({
  useBackgroundTasksStore: () => ({
    tasks: [],
    updateTaskStatus: mocks.updateTaskStatus,
    updateTaskProgress: mocks.updateTaskProgress,
  }),
}));

describe('executeMediaConversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.extractMetadata.mockResolvedValue({
      duration: 10,
      video: { width: 1920, height: 1080, fps: 30 },
      audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
    });
    mocks.transcodeMedia.mockResolvedValue(undefined);
  });

  it('clears metadata timeout after successful extraction', async () => {
    const { executeMediaConversion } = await import('~/utils/conversion/media-conversion');

    await executeMediaConversion({
      request: {
        entry: { name: 'clip.mp4', path: '/clip.mp4', kind: 'file' } as any,
        type: 'video',
        dirPath: '/',
        newFileName: 'clip_converted.mp4',
        sharedAudio: { channels: 2, sampleRate: null },
        video: {
          format: 'mp4',
          videoCodec: 'avc1.640032',
          bitrateMbps: 5,
          excludeAudio: false,
          audioCodec: 'aac',
          audioBitrateKbps: 128,
          bitrateMode: 'variable',
          keyframeIntervalSec: 2,
          width: 1920,
          height: 1080,
          fps: 30,
        },
      },
      targetHandle: {} as FileSystemFileHandle,
      taskId: 'conversion-1',
      backgroundTaskId: 'bg-1',
      isExternal: false,
      isCancelRequested: () => false,
    });

    vi.advanceTimersByTime(30000);

    expect(mocks.restartExportWorker).not.toHaveBeenCalled();
    expect(mocks.transcodeMedia).toHaveBeenCalledOnce();
  });

  it('passes abort signals to the media queue', async () => {
    const { executeMediaConversion } = await import('~/utils/conversion/media-conversion');
    const controller = new AbortController();

    await executeMediaConversion({
      request: {
        entry: { name: 'track.mp3', path: '/track.mp3', kind: 'file' } as any,
        type: 'audio',
        dirPath: '/',
        newFileName: 'track_converted.opus',
        sharedAudio: { channels: 2, sampleRate: null },
        audioOnly: {
          codec: 'opus',
          bitrateKbps: 128,
          reverse: false,
        },
      },
      targetHandle: {} as FileSystemFileHandle,
      taskId: 'conversion-2',
      backgroundTaskId: 'bg-2',
      isExternal: false,
      isCancelRequested: () => false,
      signal: controller.signal,
    });

    expect(mocks.addMediaTask).toHaveBeenCalledWith(expect.any(Function), {
      priority: 1,
      signal: controller.signal,
    });
  });
});
