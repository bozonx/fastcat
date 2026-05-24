// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AudioDecodeEngine,
  copyPlanarSampleToChannelBuffers,
  resample,
} from '~/workers/audio-decode-engine';
import type { DecodeRequest } from '~/utils/audio/types';

function createMockInput(params: {
  duration?: number;
  canDecode?: boolean;
  samples?: AsyncIterable<{
    sampleRate: number;
    numberOfChannels: number;
    numberOfFrames: number;
    timestamp: number;
    allocationSize(opts: { format: string; planeIndex: number }): number;
    copyTo(dst: Float32Array, opts: { format: string; planeIndex: number }): void;
    close(): void;
  }>;
}) {
  const track = {
    canDecode: vi.fn().mockResolvedValue(params.canDecode ?? true),
    sampleRate: 48000,
  };

  const input = {
    getPrimaryAudioTrack: vi.fn().mockResolvedValue(track),
    computeDuration: vi.fn().mockResolvedValue(params.duration ?? 1),
    dispose: vi.fn(),
    close: vi.fn(),
  };

  return {
    input,
    track,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AudioSampleSink: vi.fn().mockImplementation(() => ({
      samples: vi.fn().mockReturnValue(params.samples ?? createEmptySamples()),
      close: vi.fn(),
      dispose: vi.fn(),
    })) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Input: vi.fn().mockImplementation(() => input) as any,
  };
}

async function* createEmptySamples(): AsyncGenerator<never> {
  // empty
}

async function* createSingleSample(frames: number, channels = 2): AsyncGenerator<{
  sampleRate: number;
  numberOfChannels: number;
  numberOfFrames: number;
  timestamp: number;
  allocationSize(opts: { format: string; planeIndex: number }): number;
  copyTo(dst: Float32Array, opts: { format: string; planeIndex: number }): void;
  close(): void;
}> {
  yield {
    sampleRate: 48000,
    numberOfChannels: channels,
    numberOfFrames: frames,
    timestamp: 0,
    allocationSize: () => (frames / channels) * 4,
    copyTo: (dst, opts) => {
      const planeIndex = opts.planeIndex ?? 0;
      const planeFrames = frames;
      for (let i = 0; i < planeFrames; i += 1) {
        dst[i] = (planeIndex + 1) * 0.5;
      }
    },
    close: vi.fn(),
  };
}

describe('AudioDecodeEngine', () => {
  it('handleRequest returns error for unsupported format', async () => {
    const deps = createMockInput({});
    deps.Input.mockImplementation(() => {
      throw Object.assign(new Error('Input has an unsupported or unrecognizable format.'), {
        name: 'UnsupportedFormatError',
      });
    });

    const engine = new AudioDecodeEngine({
      ...deps,
      BlobSource: vi.fn(),
      ALL_FORMATS: {},
    });

    const request: DecodeRequest = {
      type: 'decode',
      id: 1,
      sourceKey: 'test',
      arrayBuffer: new ArrayBuffer(0),
    };

    const response = await engine.handleRequest(request);
    expect(response.ok).toBe(false);
    expect(response.error?.name).toBe('UnsupportedFormatError');
  });

  it('decodeToFloat32Channels returns decoded data', async () => {
    const deps = createMockInput({
      duration: 1,
      samples: createSingleSample(48000, 2),
    });

    const engine = new AudioDecodeEngine({
      ...deps,
      BlobSource: vi.fn((blob: Blob) => blob),
      ALL_FORMATS: {},
      governedBlobWorker: (blob: Blob) => blob,
    });

    const result = await engine.decodeToFloat32Channels(new Blob([]), 'key');
    expect(result.sampleRate).toBe(48000);
    expect(result.numberOfChannels).toBe(2);
    expect(result.totalFrames).toBeGreaterThan(0);
    expect(result.channelBuffers.length).toBe(2);
  });

  it('reset clears cached sources', async () => {
    const deps = createMockInput({
      duration: 1,
      samples: createSingleSample(48000, 2),
    });

    const engine = new AudioDecodeEngine({
      ...deps,
      BlobSource: vi.fn((blob: Blob) => blob),
      ALL_FORMATS: {},
      governedBlobWorker: (blob: Blob) => blob,
    });

    await engine.decodeToFloat32Channels(new Blob([]), 'key1');
    engine.reset();
    // After reset the same key should trigger a new Input creation
    await engine.decodeToFloat32Channels(new Blob([]), 'key1');
    expect(deps.Input).toHaveBeenCalledTimes(2);
  });

  it('global decode slot limits concurrent decodes', async () => {
    let active = 0;
    let maxActive = 0;

    const slowInput = {
      getPrimaryAudioTrack: vi.fn().mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 50));
        active -= 1;
        return { canDecode: vi.fn().mockResolvedValue(true), sampleRate: 48000 };
      }),
      computeDuration: vi.fn().mockResolvedValue(1),
      dispose: vi.fn(),
      close: vi.fn(),
    };

    const engine = new AudioDecodeEngine(
      {
        Input: vi.fn().mockReturnValue(slowInput) as unknown as new (...args: unknown[]) => {
          getPrimaryAudioTrack(): Promise<unknown>;
          computeDuration(): Promise<number>;
        },
        AudioSampleSink: vi.fn().mockReturnValue({
          samples: vi.fn().mockReturnValue(createEmptySamples()),
          close: vi.fn(),
          dispose: vi.fn(),
        }) as unknown as new (...args: unknown[]) => {
          samples(...args: number[]): AsyncIterable<unknown>;
        },
        BlobSource: vi.fn((blob: Blob) => blob),
        ALL_FORMATS: {},
        governedBlobWorker: (blob: Blob) => blob,
      },
      16,
      1,
    );

    const promises = [
      engine.decodeToFloat32Channels(new Blob([]), 'a'),
      engine.decodeToFloat32Channels(new Blob([]), 'b'),
    ];
    await Promise.all(promises);
    expect(maxActive).toBe(1);
  });
});

describe('copyPlanarSampleToChannelBuffers', () => {
  it('copies frames into correct offsets', () => {
    const plane = new Float32Array(10);
    const sample = {
      numberOfFrames: 5,
      timestamp: 0,
      allocationSize: () => 20,
      copyTo: (dst: Float32Array) => {
        dst[0] = 1;
        dst[1] = 2;
        dst[2] = 3;
        dst[3] = 4;
        dst[4] = 5;
      },
    };

    const copied = copyPlanarSampleToChannelBuffers({
      sample,
      planes: [plane],
      decodeStartS: 0,
      sampleRate: 1,
      numberOfChannels: 1,
    });

    expect(copied).toBe(5);
    expect(plane[0]).toBe(1);
    expect(plane[4]).toBe(5);
  });

  it('returns 0 when sample is outside window', () => {
    const plane = new Float32Array(10);
    const sample = {
      numberOfFrames: 5,
      timestamp: 20,
      allocationSize: () => 20,
      copyTo: vi.fn(),
    };

    const copied = copyPlanarSampleToChannelBuffers({
      sample,
      planes: [plane],
      decodeStartS: 0,
      sampleRate: 1,
      numberOfChannels: 1,
    });

    expect(copied).toBe(0);
  });
});

describe('resample', () => {
  it('returns same array when rates match', () => {
    const audio = new Float32Array([1, 2, 3]);
    expect(resample(audio, 48000, 48000)).toBe(audio);
  });

  it('downsamples correctly', () => {
    const audio = new Float32Array([0, 1, 2, 3]);
    const result = resample(audio, 48000, 24000);
    expect(result.length).toBe(2);
  });
});
