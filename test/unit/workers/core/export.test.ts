/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractMetadata, isPassthroughCompatibleClip } from '~/workers/core/export';

function createEmptyAsyncIterable<T>(): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { done: true, value: undefined as T | undefined };
        },
      };
    },
  };
}

function createThrowingAsyncIterable<T>(error: Error): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          throw error;
        },
      };
    },
  };
}

// Use variables that can be modified per test
const mockFunctions = {
  getPrimaryVideoTrack: vi.fn(),
  computeDuration: vi.fn(),
  videoGetSample: vi.fn(),
  videoGetFirstTimestamp: vi.fn(),
  audioSamples: vi.fn(),
  audioGetFirstTimestamp: vi.fn(),
};

vi.mock('mediabunny', () => ({
  Input: class {
    getMimeType = vi.fn().mockResolvedValue('video/mp4');
    getFormat = vi.fn().mockResolvedValue({ name: 'mp4' });
    computeDuration = (...args: any[]) => mockFunctions.computeDuration(...args);
    getPrimaryVideoTrack = (...args: any[]) => mockFunctions.getPrimaryVideoTrack(...args);
    getPrimaryAudioTrack = vi.fn().mockResolvedValue({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      computePacketStats: vi.fn().mockResolvedValue({ averageBitrate: 192000 }),
      getCodecParameterString: vi.fn().mockResolvedValue('mp4a.40.2'),
      canDecode: vi.fn().mockResolvedValue(true),
      getFirstTimestamp: (...args: any[]) => mockFunctions.audioGetFirstTimestamp(...args),
    });
  },
  BlobSource: class {
    constructor(public blob: Blob) {}
  },
  ALL_FORMATS: {},
  VideoSampleSink: class {
    constructor(public track: any) {}
    getSample = (...args: any[]) => mockFunctions.videoGetSample(...args);
    dispose = vi.fn();
    close = vi.fn();
  },
  AudioSampleSink: class {
    constructor(public track: any) {}
    samples = (...args: any[]) => mockFunctions.audioSamples(...args);
    dispose = vi.fn();
    close = vi.fn();
  },
}));

describe('extractMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFunctions.computeDuration.mockResolvedValue(10);
    mockFunctions.videoGetSample.mockResolvedValue({ close: vi.fn() });
    mockFunctions.audioSamples.mockImplementation(async function* () {
      yield { close: vi.fn() };
    });
    mockFunctions.audioGetFirstTimestamp.mockResolvedValue(0);
    mockFunctions.videoGetFirstTimestamp.mockResolvedValue(0);
    mockFunctions.getPrimaryVideoTrack.mockResolvedValue({
      codedWidth: 1920,
      codedHeight: 1080,
      displayWidth: 1920,
      displayHeight: 1080,
      rotation: 0,
      codec: 'avc1.640028',
      computePacketStats: vi
        .fn()
        .mockResolvedValue({ averagePacketRate: 30, averageBitrate: 5000000 }),
      getCodecParameterString: vi.fn().mockResolvedValue('avc1.640028'),
      getColorSpace: vi.fn().mockResolvedValue({}),
      canDecode: vi.fn().mockResolvedValue(true),
      getFirstTimestamp: (...args: any[]) => mockFunctions.videoGetFirstTimestamp(...args),
    });
  });

  it('extracts metadata for image file', async () => {
    const file = new File([], 'test.jpg');
    const meta = await extractMetadata(file);

    expect(meta.container).toBe('image');
    expect(meta.duration).toBe(0);
    expect(meta.mimeType).toBe('image/jpeg');
  });

  it('extracts metadata for video file using mediabunny', async () => {
    const file = new File([], 'test.mp4');
    const meta = await extractMetadata(file);

    expect(meta.duration).toBe(10);
    expect(meta.container).toBe('mp4');
    expect(meta.video).toMatchObject({
      width: 1920,
      fps: 30,
      codec: 'avc1.640028',
    });
    expect(meta.audio).toMatchObject({
      sampleRate: 48000,
      channels: 2,
    });
  });

  it('extracts metadata for audio-only file', async () => {
    const file = new File([], 'test.mp3');
    mockFunctions.getPrimaryVideoTrack.mockResolvedValue(null);

    const meta = await extractMetadata(file);
    expect(meta.video).toBeUndefined();
    expect(meta.audio).toBeDefined();
    expect(meta.duration).toBe(10);
  });

  it('handles mediabunny failure gracefully', async () => {
    const file = new File([], 'error.mp4');
    mockFunctions.computeDuration.mockRejectedValue(new Error('Decode error'));

    await expect(extractMetadata(file)).rejects.toThrow('Decode error');
  });

  it('sets video.canDecode to false if video sample decoding fails', async () => {
    const file = new File([], 'test.mp4');
    mockFunctions.videoGetSample.mockResolvedValue(null);

    const meta = await extractMetadata(file);
    expect(meta.video?.canDecode).toBe(false);
  });

  it('sets video.canDecode to false when decoding the first frame throws', async () => {
    const file = new File([], 'test.mp4');
    mockFunctions.videoGetSample.mockRejectedValue(new Error('decode blew up'));

    const meta = await extractMetadata(file);
    expect(meta.video?.canDecode).toBe(false);
  });

  it('anchors the video decode-validation to the track first timestamp', async () => {
    // Symmetry with the audio path: a healthy file whose first video frame is at
    // a non-zero PTS must be probed AT that timestamp, not hardcoded 0.
    const file = new File([], 'offset-video.mp4');
    const FIRST_TS = 0.75;
    mockFunctions.videoGetFirstTimestamp.mockResolvedValue(FIRST_TS);
    mockFunctions.videoGetSample.mockImplementation(async (t: number) =>
      t === FIRST_TS ? { close: vi.fn() } : null,
    );

    const meta = await extractMetadata(file);
    expect(meta.video?.canDecode).toBe(true);
    expect(mockFunctions.videoGetSample).toHaveBeenCalledWith(FIRST_TS);
  });

  it('keeps video.canDecode true for a healthy first frame', async () => {
    const file = new File([], 'good.mp4');
    const meta = await extractMetadata(file);
    expect(meta.video?.canDecode).toBe(true);
    expect(meta.audio?.canDecode).toBe(true);
  });

  it('sets audio.canDecode to false if audio sample decoding fails', async () => {
    const file = new File([], 'test.mp3');
    mockFunctions.getPrimaryVideoTrack.mockResolvedValue(null);
    mockFunctions.audioSamples.mockImplementation(() => createEmptyAsyncIterable());

    const meta = await extractMetadata(file);
    expect(meta.audio?.canDecode).toBe(false);
  });

  it('sets audio.canDecode to false when iterating samples throws', async () => {
    const file = new File([], 'test.mp3');
    mockFunctions.getPrimaryVideoTrack.mockResolvedValue(null);
    mockFunctions.audioSamples.mockImplementation(() =>
      createThrowingAsyncIterable(new Error('audio decode blew up')),
    );

    const meta = await extractMetadata(file);
    expect(meta.audio?.canDecode).toBe(false);
  });

  it('anchors the audio decode-validation window to the track first timestamp', async () => {
    // A perfectly good file whose first audio sample starts well after t=0 (e.g.
    // MPEG-TS PTS starting ~1.4s, or an edit-list/encoder-delay offset). A window
    // hardcoded to [0, 0.1] would find nothing here and wrongly flag it corrupt.
    const file = new File([], 'ts-audio.mp4');
    const FIRST_TS = 1.4;
    mockFunctions.getPrimaryVideoTrack.mockResolvedValue(null);
    mockFunctions.audioGetFirstTimestamp.mockResolvedValue(FIRST_TS);
    mockFunctions.audioSamples.mockImplementation(async function* (start: number, end: number) {
      // Only yield a sample when the query window actually covers the first
      // timestamp — i.e. the code anchored the window correctly.
      if (start <= FIRST_TS && end > FIRST_TS) {
        yield { close: vi.fn() };
      }
    });

    const meta = await extractMetadata(file);
    expect(meta.audio?.canDecode).toBe(true);
    expect(mockFunctions.audioSamples).toHaveBeenCalledWith(FIRST_TS, FIRST_TS + 1);
  });

  describe('image display validation', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('marks a decodable browser-native image displayable', async () => {
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn().mockResolvedValue({ width: 640, height: 480, close: vi.fn() }),
      );
      const meta = await extractMetadata(new File([], 'photo.png'));
      expect(meta.image).toEqual({ canDisplay: true, width: 640, height: 480 });
    });

    it('marks an undecodable browser-native image as not displayable (corrupt)', async () => {
      vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad image bytes')));
      const meta = await extractMetadata(new File([], 'broken.png'));
      expect(meta.image?.canDisplay).toBe(false);
    });

    it('marks a zero-sized decode as not displayable', async () => {
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn().mockResolvedValue({ width: 0, height: 0, close: vi.fn() }),
      );
      const meta = await extractMetadata(new File([], 'empty.png'));
      expect(meta.image?.canDisplay).toBe(false);
    });

    it('marks a non-native image format not displayable without attempting decode', async () => {
      const createImageBitmap = vi.fn();
      vi.stubGlobal('createImageBitmap', createImageBitmap);
      const meta = await extractMetadata(new File([], 'scan.tiff'));
      expect(meta.image?.canDisplay).toBe(false);
      expect(createImageBitmap).not.toHaveBeenCalled();
    });
  });
});

describe('isPassthroughCompatibleClip', () => {
  const options = { audioSampleRate: 48000, audioChannels: 'stereo' as const };

  it('accepts a clean clip', () => {
    expect(isPassthroughCompatibleClip({}, options)).toEqual({ ok: true });
  });

  it.each([
    ['audioGain', { audioGain: 0.5 }, 'gain'],
    ['audioBalance', { audioBalance: 0.5 }, 'balance'],
    ['fade in', { audioFadeInUs: 1000 }, 'fade'],
    ['fade out', { audioFadeOutUs: 1000 }, 'fade'],
    ['transition in', { transitionIn: { durationUs: 1000 } }, 'transition'],
    ['speed != 1', { speed: 2 }, 'speed'],
    ['reverse', { speed: -1 }, 'speed'],
    ['audio effect', { effects: [{ target: 'audio', enabled: true }] }, 'effects'],
  ])('rejects clip with %s', (_label, patch, reasonSubstring) => {
    const result = isPassthroughCompatibleClip(patch, options);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reasonSubstring);
  });

  it('reads envelope values from fastcat shim', () => {
    expect(isPassthroughCompatibleClip({ fastcat: { audioGain: 0.5 } }, options)).toEqual({
      ok: false,
      reason: 'clip gain is not unity',
    });
  });
});
