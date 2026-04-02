/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runTranscode } from '~/workers/core/transcode';

// Mock mediabunny dynamic import
const mockMediabunny = {
  Output: vi.fn().mockImplementation(function () {
    return {};
  }),
  Mp4OutputFormat: vi.fn().mockImplementation(function () {
    return {};
  }),
  WebMOutputFormat: vi.fn().mockImplementation(function () {
    return {};
  }),
  MkvOutputFormat: vi.fn().mockImplementation(function () {
    return {};
  }),
  StreamTarget: vi.fn().mockImplementation(function () {
    return {};
  }),
  Input: vi.fn().mockImplementation(function () {
    return {
      getPrimaryVideoTrack: vi.fn().mockResolvedValue({
        getDecoderConfig: vi.fn().mockResolvedValue({ codedWidth: 1920, codedHeight: 1080 }),
      }),
      getPrimaryAudioTrack: vi.fn().mockResolvedValue({}),
    };
  }),
  BlobSource: vi.fn().mockImplementation(function () {
    return {};
  }),
  Conversion: {
    init: vi.fn().mockResolvedValue({
      isValid: true,
      execute: vi.fn().mockResolvedValue(undefined),
      onProgress: null,
    }),
  },
  ALL_FORMATS: [],
  getFirstEncodableVideoCodec: vi.fn().mockResolvedValue('h264'),
  getFirstEncodableAudioCodec: vi.fn().mockResolvedValue('aac'),
  AudioSample: vi.fn().mockImplementation(function () {
    return {};
  }),
};

vi.mock('mediabunny', () => mockMediabunny);

describe('runTranscode', () => {
  const mockFile = new File(['test'], 'test.mp4', { type: 'video/mp4' });
  const mockTargetHandle = {
    createWritable: vi.fn().mockResolvedValue({
      write: vi.fn(),
      close: vi.fn(),
    }),
  } as any;

  const mockOptions: any = {
    format: 'mp4',
    videoCodec: 'h264',
    audio: true,
    audioCodec: 'aac',
    width: 1280,
    height: 720,
    bitrate: 2000000,
    fps: 30,
    audioBitrate: 128000,
    audioSampleRate: 44100,
    audioChannels: 'stereo',
  };

  const mockHostClient: any = {
    onExportPhase: vi.fn(),
    onExportProgress: vi.fn(),
  };

  const reportExportWarning = vi.fn();
  const checkCancel = vi.fn().mockReturnValue(false);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes and executes conversion successfully', async () => {
    await runTranscode(
      mockFile,
      mockTargetHandle,
      mockOptions,
      mockHostClient,
      reportExportWarning,
      checkCancel,
      'task-1',
    );

    expect(mockMediabunny.Conversion.init).toHaveBeenCalled();
    const initArgs = mockMediabunny.Conversion.init.mock.calls[0][0];
    expect(initArgs.video.codec).toBe('h264');
    expect(initArgs.video.width).toBe(1280);
    expect(initArgs.video.height).toBe(720);

    expect(mockHostClient.onExportPhase).toHaveBeenCalledWith('encoding', 'task-1');
  });

  it('handles cancellation during progress', async () => {
    let progressCallback: any = null;
    mockMediabunny.Conversion.init.mockResolvedValueOnce({
      isValid: true,
      execute: vi.fn().mockImplementation(async () => {
        // simulate some progress calls
        if (progressCallback) progressCallback(0.5);
        return undefined;
      }),
      set onProgress(cb: any) {
        progressCallback = cb;
      },
    });

    // Make checkCancel return true
    checkCancel.mockReturnValue(true);

    await expect(
      runTranscode(
        mockFile,
        mockTargetHandle,
        mockOptions,
        mockHostClient,
        reportExportWarning,
        checkCancel,
        'task-1',
      ),
    ).rejects.toThrow('Export was cancelled');
  });

  it('throws error if conversion setup is invalid', async () => {
    mockMediabunny.Conversion.init.mockResolvedValueOnce({
      isValid: false,
      discardedTracks: [{ reason: 'Test Reason' }],
    });

    await expect(
      runTranscode(
        mockFile,
        mockTargetHandle,
        mockOptions,
        mockHostClient,
        reportExportWarning,
        checkCancel,
      ),
    ).rejects.toThrow(/Conversion setup is invalid/);
  });

  it('chooses correct output format class', async () => {
    // WebM
    await runTranscode(
      mockFile,
      mockTargetHandle,
      { ...mockOptions, format: 'webm' },
      mockHostClient,
      reportExportWarning,
      checkCancel,
    );
    expect(mockMediabunny.WebMOutputFormat).toHaveBeenCalled();

    // MKV
    await runTranscode(
      mockFile,
      mockTargetHandle,
      { ...mockOptions, format: 'mkv' },
      mockHostClient,
      reportExportWarning,
      checkCancel,
    );
    expect(mockMediabunny.MkvOutputFormat).toHaveBeenCalled();
  });
});
