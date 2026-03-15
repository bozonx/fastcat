// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

import { useFileConversionActions } from '../../../../src/composables/fileConversion/useFileConversionActions';

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

vi.mock('~/composables/fileManager/useFileManager', () => ({
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
  executeImageConversion: vi.fn().mockResolvedValue(undefined),
}));

describe('useFileConversionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    props.audioSettings.onlyCodec = 'opus'; // Should be overwritten

    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });

    await startConversion();

    expect(props.audioSettings.onlyCodec).toBe('aac');
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
});
