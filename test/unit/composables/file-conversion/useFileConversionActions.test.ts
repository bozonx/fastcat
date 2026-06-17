// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

import { useFileConversionActions } from '~/composables/file-conversion/useFileConversionActions';
import { useMobileLayout } from '~/composables/useMobileLayout';
import { executeMediaConversion } from '~/utils/conversion/media-conversion';
import { removeCreatedFile } from '~/utils/conversion/helpers';

const mockProjectStore = {
  projectSettings: {
    exportDefaults: { encoding: {} },
  },
  getFileByPath: vi.fn(),
  getDirectoryHandleByPath: vi.fn(),
};

const mockWorkspaceStore = {
  workspaceHandle: null,
};

const mockFileManager = {
  vfs: {
    getFile: vi.fn(),
    writeFile: vi.fn(),
    deleteEntry: vi.fn(),
    exists: vi.fn().mockResolvedValue(false),
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

const mockToast = {
  add: vi.fn(),
};

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
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

vi.mock('~/composables/useMobileLayout', () => ({
  useMobileLayout: vi.fn(() => ({ isMobileLayout: { value: false } })),
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

vi.mock('~/utils/conversion/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/utils/conversion/helpers')>();
  return {
    ...actual,
    removeCreatedFile: vi.fn(),
  };
});

describe('useFileConversionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(removeCreatedFile).mockReset();
    mockProjectStore.getFileByPath.mockReset();
    mockProjectStore.getDirectoryHandleByPath.mockReset();
    mockFileManager.vfs.getFile.mockReset();
    mockFileManager.vfs.writeFile.mockReset();
    mockFileManager.vfs.deleteEntry.mockReset();
    mockFileManager.vfs.exists.mockReset().mockResolvedValue(false);
  });

  const createProps = (mediaTypeVal: 'video' | 'audio' | 'image' | 'unknown') => {
    return {
      targetEntry: ref(null),
      targetIsExternal: ref(false),
      targetVfs: ref(null),
      targetReloadDirectory: ref<((path: string) => Promise<void>) | null>(null),
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
        onlyBitrateKbps: 128,
        channels: 'stereo',
        sampleRate: 'original',
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
      isExtractingMetadata: ref(false),
      conversionError: ref(''),
      conversionWarnings: ref([]),
      isModalOpen: ref(false),
      conversionModalRequestId: ref(0),
      sourceHasAudio: ref(true),
    };
  };

  it('buildConversionRequest uses onlyFormat for audio codec and extension', async () => {
    const props = createProps('audio');
    const { startConversion } = useFileConversionActions(props);

    props.targetEntry.value = { name: 'test.mp3', path: '/test.mp3', kind: 'file' } as any;
    props.audioSettings.onlyFormat = 'aac';

    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });

    await startConversion();

    expect(executeMediaConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          type: 'audio',
          audioOnly: expect.objectContaining({
            codec: 'aac',
          }),
        }),
      }),
    );
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

  it('removes created file when media conversion fails with a generic error', async () => {
    const props = createProps('audio');
    const { startConversion } = useFileConversionActions(props);

    props.targetEntry.value = { name: 'test.mp3', path: '/test.mp3', kind: 'file' } as any;

    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });

    const executeMediaConversionModule = await import('~/utils/conversion/media-conversion');
    vi.mocked(executeMediaConversionModule.executeMediaConversion).mockRejectedValue(
      new Error('FFmpeg crash'),
    );

    await startConversion();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(vi.mocked(removeCreatedFile)).toHaveBeenCalled();
  });

  it('openConversionModal resets video defaults when metadata extraction fails', async () => {
    const props = createProps('video');
    const { openConversionModal } = useFileConversionActions(props);

    mockProjectStore.getFileByPath.mockRejectedValue(new Error('VFS error'));

    await openConversionModal({ name: 'test.mp4', path: '/test.mp4', kind: 'file' } as any);

    expect(props.videoSettings.bitrateMbps).toBe(0);
    expect(props.videoSettings.audioBitrateKbps).toBe(0);
    expect(props.audioSettings.onlyBitrateKbps).toBe(0);
    expect(props.isExtractingMetadata.value).toBe(false);
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
    props.targetVfs.value = mockFileManager.vfs as any;
    mockFileManager.vfs.getFile.mockResolvedValue(
      new File(['x'], 'test.png', { type: 'image/png' }),
    );

    await startConversion();

    expect(mockFileManager.vfs.getFile).toHaveBeenCalledWith('/test.png');
    expect(mockFileManager.vfs.writeFile).toHaveBeenCalledWith(
      '/test_converted.webp',
      expect.any(Blob),
    );
    expect(mockProjectStore.getFileByPath).not.toHaveBeenCalled();
  });

  it('increments file name when target already exists', async () => {
    const props = createProps('image');
    const { startConversion } = useFileConversionActions(props);

    props.targetEntry.value = { name: 'test.png', path: '/test.png', kind: 'file' } as any;
    props.targetVfs.value = mockFileManager.vfs as any;
    mockFileManager.vfs.getFile.mockResolvedValue(
      new File(['x'], 'test.png', { type: 'image/png' }),
    );
    mockFileManager.vfs.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await startConversion();

    expect(mockFileManager.vfs.writeFile).toHaveBeenCalledWith(
      '/test_converted_1.webp',
      expect.any(Blob),
    );
  });

  it('defaults video conversion sample rate to original option', async () => {
    const props = createProps('video');
    const { openConversionModal } = useFileConversionActions(props);
    const workerClientModule = await import('~/utils/video-editor/worker-client');

    vi.mocked(workerClientModule.getExportWorkerClient).mockReturnValue({
      client: {
        extractMetadata: vi.fn().mockResolvedValue({
          video: { width: 1920, height: 1080, fps: 30 },
          audio: { channels: 2, sampleRate: 48000 },
        }),
        cancelExport: vi.fn(),
      },
    } as any);

    mockProjectStore.getFileByPath.mockResolvedValue(
      new File(['x'], 'clip.mp4', { type: 'video/mp4' }),
    );

    await openConversionModal({ name: 'clip.mp4', path: '/clip.mp4', kind: 'file' } as any);

    expect(props.audioSettings.originalSampleRate).toBe(48000);
    expect(props.audioSettings.sampleRate).toBe('original');
  });

  it('defaults audio conversion sample rate to original option', async () => {
    const props = createProps('audio');
    const { openConversionModal } = useFileConversionActions(props);
    const workerClientModule = await import('~/utils/video-editor/worker-client');

    vi.mocked(workerClientModule.getExportWorkerClient).mockReturnValue({
      client: {
        extractMetadata: vi.fn().mockResolvedValue({
          audio: { channels: 2, sampleRate: 48000 },
        }),
        cancelExport: vi.fn(),
      },
    } as any);

    mockProjectStore.getFileByPath.mockResolvedValue(
      new File(['x'], 'track.mp3', { type: 'audio/mpeg' }),
    );

    await openConversionModal({ name: 'track.mp3', path: '/track.mp3', kind: 'file' } as any);

    expect(props.audioSettings.originalSampleRate).toBe(48000);
    expect(props.audioSettings.sampleRate).toBe('original');
  });

  it('sets isExtractingMetadata during openConversionModal and clears it after', async () => {
    const props = createProps('video');
    const { openConversionModal } = useFileConversionActions(props);

    mockProjectStore.getFileByPath.mockResolvedValue(
      new File(['x'], 'clip.mp4', { type: 'video/mp4' }),
    );

    const promise = openConversionModal({
      name: 'clip.mp4',
      path: '/clip.mp4',
      kind: 'file',
    } as any);

    expect(props.isExtractingMetadata.value).toBe(true);

    await promise;

    expect(props.isExtractingMetadata.value).toBe(false);
  });

  it('rejects image files larger than 500MB during metadata extraction', async () => {
    const props = createProps('image');
    const { openConversionModal } = useFileConversionActions(props);

    const largeFile = new File([new ArrayBuffer(0)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(largeFile, 'size', { value: 501 * 1024 * 1024 });

    props.targetVfs.value = mockFileManager.vfs as any;
    mockFileManager.vfs.getFile.mockResolvedValue(largeFile);

    await openConversionModal({ name: 'huge.png', path: '/huge.png', kind: 'file' } as any);

    expect(props.imageSettings.width).toBe(0);
    expect(props.imageSettings.height).toBe(0);
    expect(props.isExtractingMetadata.value).toBe(false);
  });

  it('isConverting guard prevents duplicate conversion starts', async () => {
    const props = createProps('audio');
    const { startConversion } = useFileConversionActions(props);

    props.targetEntry.value = { name: 'test.mp3', path: '/test.mp3', kind: 'file' } as any;
    props.isConverting.value = true;

    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });

    await startConversion();

    expect(executeMediaConversion).not.toHaveBeenCalled();
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
    props.targetVfs.value = mockFileManager.vfs as any;
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

  it('does not show bgTaskAdded toast on mobile layout', async () => {
    vi.mocked(useMobileLayout).mockReturnValue({ isMobileLayout: { value: true } } as any);

    const props = createProps('audio');
    const { startConversion } = useFileConversionActions(props);

    props.targetEntry.value = { name: 'test.mp3', path: '/test.mp3', kind: 'file' } as any;

    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });

    await startConversion();

    const bgTaskToast = mockToast.add.mock.calls.find(
      (call) => (call[0] as any).title === 'videoEditor.fileManager.convert.bgTaskAdded',
    );
    expect(bgTaskToast).toBeUndefined();

    vi.mocked(useMobileLayout).mockRestore?.();
  });

  it('uses targetReloadDirectory for background conversion when provided', async () => {
    const props = createProps('audio');
    const customReload = vi.fn().mockResolvedValue(undefined);
    props.targetReloadDirectory.value = customReload as unknown as
      | ((path: string) => Promise<void>)
      | null;

    const { startConversion } = useFileConversionActions(props);

    props.targetEntry.value = { name: 'test.mp3', path: '/test.mp3', kind: 'file' } as any;

    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });

    await startConversion();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(customReload).toHaveBeenCalledWith('/');
    expect(mockFileManager.reloadDirectory).not.toHaveBeenCalled();
  });
});
