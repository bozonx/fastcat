// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

import { useFileConversionActions } from '~/composables/file-conversion/useFileConversionActions';
import { executeMediaConversion } from '~/utils/conversion/media-conversion';

const mockProjectStore = {
  projectSettings: {
    exportDefaults: { encoding: {} },
  },
  getFileByPath: vi.fn(),
  getDirectoryHandleByPath: vi.fn(),
};

const mockFileManager = {
  vfs: {
    getFile: vi.fn(),
    writeFile: vi.fn(),
    deleteEntry: vi.fn(),
  },
  reloadDirectory: vi.fn(),
};

const mockUiStore = {
  notifyFileManagerUpdate: vi.fn(),
};

const mockBackgroundTasksStore = {
  addTask: vi.fn(() => 'task-1'),
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn(),
  tasks: [],
};

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/background-tasks.store', () => ({
  useBackgroundTasksStore: () => mockBackgroundTasksStore,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));

vi.mock('~/utils/video-editor/worker-client', () => ({
  getExportWorkerClient: vi.fn(() => ({
    client: {
      extractMetadata: vi.fn().mockResolvedValue({
        video: { width: 1920, height: 1080, fps: 30 },
        audio: { channels: 2, sampleRate: 48000 },
      }),
      cancelExport: vi.fn(),
    },
  })),
}));

vi.mock('~/utils/conversion/media-conversion', () => ({
  executeMediaConversion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('~/utils/conversion/image-conversion', () => ({
  convertImageFile: vi.fn().mockResolvedValue(new Blob(['converted'], { type: 'image/webp' })),
}));

describe('useFileConversionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectStore.getFileByPath.mockReset();
    mockProjectStore.getDirectoryHandleByPath.mockReset();
    mockFileManager.vfs.getFile.mockReset();
    mockFileManager.vfs.writeFile.mockReset();
    mockFileManager.vfs.deleteEntry.mockReset();
  });

  const createProps = (mediaTypeVal: 'video' | 'audio' | 'image' | 'unknown') => {
    return {
      targetEntry: ref(null),
      mediaType: ref(mediaTypeVal) as any,
      videoSettings: {
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
        resolutionFormat: '1080p',
        orientation: 'landscape',
        aspectRatio: '16:9',
        isCustomResolution: false,
      } as any,
      audioSettings: {
        onlyFormat: 'opus',
        onlyCodec: 'opus',
        onlyBitrateKbps: 128,
        channels: 'stereo',
        sampleRate: 0,
        reverse: false,
        originalSampleRate: null,
      } as any,
      imageSettings: {
        quality: 80,
        width: 0,
        height: 0,
        isResolutionLinked: true,
        aspectRatio: 1,
      } as any,
      isCancelRequested: ref(false),
      isConverting: ref(false),
      conversionError: ref(''),
      isModalOpen: ref(false),
      conversionModalRequestId: ref(0),
      sourceHasAudio: ref(true),
      callbacks: {
        onSuccess: vi.fn(),
        onError: vi.fn(),
        onWarning: vi.fn(),
      },
    };
  };

  it('buildConversionRequest synchronizes audio codec with format for audio only', async () => {
    const props = createProps('audio');
    const { startConversion } = useFileConversionActions(props);

    props.targetEntry.value = { name: 'test.mp3', path: '/test.mp3', kind: 'file' } as any;
    props.audioSettings.onlyFormat = 'aac';
    props.audioSettings.onlyCodec = 'opus';

    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });

    await startConversion();

    expect(props.audioSettings.onlyCodec).toBe('aac');
  });

  it('passes audio reverse flag to media conversion for audio only', async () => {
    const props = createProps('audio');
    const { startConversion } = useFileConversionActions(props);

    props.targetEntry.value = { name: 'test.mp3', path: '/test.mp3', kind: 'file' } as any;
    props.audioSettings.reverse = true;

    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });

    await startConversion();

    expect(executeMediaConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          type: 'audio',
          audioOnly: expect.objectContaining({
            reverse: true,
          }),
        }),
      }),
    );
  });

  it('openConversionModal triggers onWarning when metadata extraction fails', async () => {
    const props = createProps('video');
    const { openConversionModal } = useFileConversionActions(props);

    mockProjectStore.getFileByPath.mockRejectedValue(new Error('VFS error'));

    await openConversionModal({ name: 'test.mp4', path: '/test.mp4', kind: 'file' } as any);

    expect(props.callbacks.onWarning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to extract video metadata'),
    );
  });

  it('forces excludeAudio for video without audio track', async () => {
    const props = createProps('video');
    const { openConversionModal, startConversion } = useFileConversionActions(props);

    const workerClientModule = await import('~/utils/video-editor/worker-client');
    vi.mocked(workerClientModule.getExportWorkerClient).mockReturnValue({
      client: {
        extractMetadata: vi.fn().mockResolvedValue({
          video: { width: 1920, height: 1080, fps: 30 },
          audio: null,
        }),
        cancelExport: vi.fn(),
      },
    } as any);

    mockProjectStore.getFileByPath.mockResolvedValue(
      new File(['x'], 'silent.mp4', { type: 'video/mp4' }),
    );

    await openConversionModal({ name: 'silent.mp4', path: '/silent.mp4', kind: 'file' } as any);

    expect(props.sourceHasAudio.value).toBe(false);
    expect(props.videoSettings.excludeAudio).toBe(true);

    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });

    await startConversion();

    expect(executeMediaConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          type: 'video',
          video: expect.objectContaining({
            excludeAudio: true,
          }),
        }),
      }),
    );
  });

  it('uses VFS for image conversion in external file managers', async () => {
    const props = createProps('image');
    const { startConversion } = useFileConversionActions(props);

    props.targetEntry.value = { name: 'test.png', path: '/test.png', kind: 'file' } as any;
    mockFileManager.vfs.getFile.mockResolvedValue(
      new File(['x'], 'test.png', { type: 'image/png' }),
    );

    await startConversion();

    expect(mockFileManager.vfs.getFile).toHaveBeenCalledWith('/test.png');
    expect(mockFileManager.vfs.writeFile).toHaveBeenCalledWith(
      'test_converted.webp',
      expect.any(Blob),
    );
    expect(mockProjectStore.getFileByPath).not.toHaveBeenCalled();
  });

  it('uses VFS to read image metadata when opening conversion modal', async () => {
    const props = createProps('image');
    const { openConversionModal } = useFileConversionActions(props);
    const mockBitmap = {
      width: 640,
      height: 480,
      close: vi.fn(),
    };
    const createImageBitmapMock = vi.fn().mockResolvedValue(mockBitmap);

    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    mockFileManager.vfs.getFile.mockResolvedValue(
      new File(['x'], 'test.png', { type: 'image/png' }),
    );

    await openConversionModal({ name: 'test.png', path: '/test.png', kind: 'file' } as any);

    expect(mockFileManager.vfs.getFile).toHaveBeenCalledWith('/test.png');
    expect(mockProjectStore.getFileByPath).not.toHaveBeenCalled();
    expect(props.imageSettings.width).toBe(640);
    expect(props.imageSettings.height).toBe(480);
    expect(props.imageSettings.aspectRatio).toBe(640 / 480);
    expect(mockBitmap.close).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
