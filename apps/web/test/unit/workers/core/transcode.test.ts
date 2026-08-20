/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runTranscode } from '~/workers/core/transcode';

// Mock mediabunny dynamic import
const mockMediabunny = {
  Output: vi.fn().mockImplementation(function () {
    return {
      addVideoTrack: vi.fn().mockReturnValue({}),
      addAudioTrack: vi.fn().mockReturnValue({}),
    };
  }),
  Mp4OutputFormat: vi.fn().mockImplementation(function () {
    return { supportsVideoRotationMetadata: true };
  }),
  WebMOutputFormat: vi.fn().mockImplementation(function () {
    return { supportsVideoRotationMetadata: true };
  }),
  MkvOutputFormat: vi.fn().mockImplementation(function () {
    return { supportsVideoRotationMetadata: false };
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

  it('strips rotation metadata for MKV format', async () => {
    const addVideoTrackSpy = vi.fn().mockReturnValue({});
    const originalOutput = mockMediabunny.Output;
    mockMediabunny.Output = vi.fn().mockImplementation(function () {
      return {
        addVideoTrack: addVideoTrackSpy,
        addAudioTrack: vi.fn().mockReturnValue({}),
      };
    });

    await runTranscode(
      mockFile,
      mockTargetHandle,
      { ...mockOptions, format: 'mkv' },
      mockHostClient,
      reportExportWarning,
      checkCancel,
    );

    const initArgs = mockMediabunny.Conversion.init.mock.calls[0][0];
    initArgs.output.addVideoTrack({}, { rotation: 90 });

    expect(addVideoTrackSpy).toHaveBeenCalled();
    const metadata = addVideoTrackSpy.mock.calls[0]![1];
    expect(metadata.rotation).toBe(0);

    mockMediabunny.Output = originalOutput;
  });

  it('passes audioReverse config when audioReverse is enabled', async () => {
    await runTranscode(
      mockFile,
      mockTargetHandle,
      { ...mockOptions, videoCodec: 'none', audioReverse: true, audioDurationSec: 5 },
      mockHostClient,
      reportExportWarning,
      checkCancel,
    );

    const initArgs = mockMediabunny.Conversion.init.mock.calls[0][0];
    expect(initArgs.audio.forceTranscode).toBe(true);
    expect(typeof initArgs.audio.process).toBe('function');
  });

  it('reverses audio samples correctly via process callback', async () => {
    const AudioSample = mockMediabunny.AudioSample;
    await runTranscode(
      mockFile,
      mockTargetHandle,
      { ...mockOptions, videoCodec: 'none', audioReverse: true, audioDurationSec: 1 },
      mockHostClient,
      reportExportWarning,
      checkCancel,
    );

    const initArgs = mockMediabunny.Conversion.init.mock.calls[0][0];
    const process = initArgs.audio.process as (sample: {
      timestamp: number;
      duration: number;
      numberOfFrames: number;
      numberOfChannels: number;
      sampleRate: number;
      allocationSize: (opts: { planeIndex: number; format: 'f32' }) => number;
      copyTo: (dest: Float32Array, opts: { planeIndex: number; format: 'f32' }) => void;
    }) => null | InstanceType<typeof AudioSample>[];

    const data1 = new Float32Array([1, 2, 3, 4]);
    const data2 = new Float32Array([5, 6, 7, 8]);

    const result1 = process({
      timestamp: 0,
      duration: 0.5,
      numberOfFrames: 2,
      numberOfChannels: 2,
      sampleRate: 4,
      allocationSize: () => 16,
      copyTo: (dest) => dest.set(data1),
    });
    expect(result1).toBeNull();

    const result2 = process({
      timestamp: 0.5,
      duration: 0.5,
      numberOfFrames: 2,
      numberOfChannels: 2,
      sampleRate: 4,
      allocationSize: () => 16,
      copyTo: (dest) => dest.set(data2),
    });

    expect(result2).not.toBeNull();
    expect(result2).toHaveLength(2);
    expect(AudioSample).toHaveBeenCalledTimes(2);
  });

  it('handles FileSystemFileHandle as source', async () => {
    const mockHandleFile = new File(['handle-test'], 'handle.mp4', { type: 'video/mp4' });
    const mockFsHandle = {
      getFile: vi.fn().mockResolvedValue(mockHandleFile),
    };

    await runTranscode(
      mockFsHandle as any,
      mockTargetHandle,
      mockOptions,
      mockHostClient,
      reportExportWarning,
      checkCancel,
    );

    expect(mockMediabunny.Conversion.init).toHaveBeenCalled();
  });

  it('discards video track when videoCodec is none', async () => {
    await runTranscode(
      mockFile,
      mockTargetHandle,
      { ...mockOptions, videoCodec: 'none' },
      mockHostClient,
      reportExportWarning,
      checkCancel,
    );

    const initArgs = mockMediabunny.Conversion.init.mock.calls[0][0];
    expect(initArgs.video.discard).toBe(true);
    expect(initArgs.audio.discard).toBeUndefined();
  });

  it('discards audio track when audio is disabled', async () => {
    await runTranscode(
      mockFile,
      mockTargetHandle,
      { ...mockOptions, audio: false },
      mockHostClient,
      reportExportWarning,
      checkCancel,
    );

    const initArgs = mockMediabunny.Conversion.init.mock.calls[0][0];
    expect(initArgs.audio.discard).toBe(true);
  });

  it('throws when no encodable codec is available', async () => {
    mockMediabunny.getFirstEncodableVideoCodec.mockResolvedValueOnce(null);
    mockMediabunny.getFirstEncodableAudioCodec.mockResolvedValueOnce(null);

    await expect(
      runTranscode(
        mockFile,
        mockTargetHandle,
        mockOptions,
        mockHostClient,
        reportExportWarning,
        checkCancel,
      ),
    ).rejects.toThrow(/No encodable target codec available/);
  });

  it('cancels output and aborts writable on execute error', async () => {
    const mockAbort = vi.fn().mockResolvedValue(undefined);
    const mockCancel = vi.fn().mockResolvedValue(undefined);
    const writableWithAbort = {
      write: vi.fn(),
      close: vi.fn(),
      abort: mockAbort,
    };
    mockTargetHandle.createWritable.mockResolvedValueOnce(writableWithAbort);

    mockMediabunny.Conversion.init.mockResolvedValueOnce({
      isValid: true,
      execute: vi.fn().mockRejectedValue(new Error('Encode failed')),
      onProgress: null,
      cancel: mockCancel,
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
    ).rejects.toThrow('Encode failed');

    expect(mockCancel).toHaveBeenCalled();
    expect(mockAbort).toHaveBeenCalled();
  });

  it('skips video track retrieval when videoCodec is none', async () => {
    const mockInput = {
      getPrimaryVideoTrack: vi.fn().mockResolvedValue({ frameRate: 30 }),
      getPrimaryAudioTrack: vi.fn().mockResolvedValue({}),
      dispose: vi.fn(),
    };
    mockMediabunny.Input = vi.fn().mockImplementation(function () {
      return mockInput;
    });

    await runTranscode(
      mockFile,
      mockTargetHandle,
      { ...mockOptions, videoCodec: 'none' },
      mockHostClient,
      reportExportWarning,
      checkCancel,
    );

    expect(mockInput.getPrimaryVideoTrack).not.toHaveBeenCalled();
    expect(mockInput.getPrimaryAudioTrack).toHaveBeenCalled();
  });

  it('skips audio track retrieval when audio is disabled', async () => {
    const mockInput = {
      getPrimaryVideoTrack: vi.fn().mockResolvedValue({ frameRate: 30 }),
      getPrimaryAudioTrack: vi.fn().mockResolvedValue({}),
      dispose: vi.fn(),
    };
    mockMediabunny.Input = vi.fn().mockImplementation(function () {
      return mockInput;
    });

    await runTranscode(
      mockFile,
      mockTargetHandle,
      { ...mockOptions, audio: false },
      mockHostClient,
      reportExportWarning,
      checkCancel,
    );

    expect(mockInput.getPrimaryAudioTrack).not.toHaveBeenCalled();
  });
});
