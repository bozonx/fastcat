// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  AudioDecodeEngine,
  copyPlanarSampleToChannelBuffers,
  resample,
} from '~/workers/audio-decode-engine';
import type { DecodeRequest } from '~/utils/audio/types';

async function* createEmptySamples(): AsyncGenerator<never> {
  // empty
}

function createMockTrack(overrides?: { sampleRate?: number }) {
  return {
    canDecode: vi.fn().mockResolvedValue(true),
    sampleRate: overrides?.sampleRate ?? 48000,
  };
}

function createMockInput(params: {
  duration?: number;
  track?: ReturnType<typeof createMockTrack>;
}) {
  const track = params.track ?? createMockTrack();
  return {
    getPrimaryAudioTrack: vi.fn().mockResolvedValue(track),
    computeDuration: vi.fn().mockResolvedValue(params.duration ?? 1),
    dispose: vi.fn(),
    close: vi.fn(),
  };
}

function createMockDeps(overrides?: {
  input?: ReturnType<typeof createMockInput>;
  samples?: AsyncIterable<unknown>;
  blobSourceClass?: new (...args: unknown[]) => unknown;
  inputClass?: new (...args: unknown[]) => unknown;
}) {
  const input = overrides?.input ?? createMockInput({});

  class MockInput {
    getPrimaryAudioTrack = input.getPrimaryAudioTrack;
    computeDuration = input.computeDuration;
    dispose = input.dispose;
    close = input.close;
  }

  class MockAudioSampleSink {
    samples = vi.fn().mockReturnValue(overrides?.samples ?? createEmptySamples());
    close = vi.fn();
    dispose = vi.fn();
  }

  class MockBlobSource {
    constructor(public blob: Blob) {}
  }

  return {
    Input: overrides?.inputClass ?? (MockInput as unknown as new (...args: unknown[]) => unknown),
    AudioSampleSink: MockAudioSampleSink as unknown as new (...args: unknown[]) => unknown,
    BlobSource:
      overrides?.blobSourceClass ??
      (MockBlobSource as unknown as new (...args: unknown[]) => unknown),
    ALL_FORMATS: {},
    governedBlobWorker: (blob: Blob) => blob,
  };
}

describe('AudioDecodeEngine', () => {
  it('handleRequest returns error for unsupported format', async () => {
    class FailingInput {
      constructor() {
        throw Object.assign(new Error('Input has an unsupported or unrecognizable format.'), {
          name: 'UnsupportedFormatError',
        });
      }
    }

    const engine = new AudioDecodeEngine({
      ...createMockDeps({
        inputClass: FailingInput as unknown as new (...args: unknown[]) => unknown,
      }),
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
    async function* singleSample() {
      yield {
        sampleRate: 48000,
        numberOfChannels: 2,
        numberOfFrames: 48000,
        timestamp: 0,
        allocationSize: () => 96000,
        copyTo: (dst: Float32Array) => {
          dst.fill(0.5);
        },
        close: vi.fn(),
      };
    }

    const engine = new AudioDecodeEngine(createMockDeps({ samples: singleSample() }));

    const result = await engine.decodeToFloat32Channels(new Blob([]), 'key');
    expect(result.sampleRate).toBe(48000);
    expect(result.numberOfChannels).toBe(2);
    expect(result.totalFrames).toBeGreaterThan(0);
    expect(result.channelBuffers.length).toBe(2);
  });

  it('reset clears cached sources', async () => {
    async function* singleSample() {
      yield {
        sampleRate: 48000,
        numberOfChannels: 2,
        numberOfFrames: 100,
        timestamp: 0,
        allocationSize: () => 400,
        copyTo: (dst: Float32Array) => {
          dst.fill(0.5);
        },
        close: vi.fn(),
      };
    }

    let callCount = 0;
    class CountingInput {
      getPrimaryAudioTrack = vi.fn().mockResolvedValue(createMockTrack());
      computeDuration = vi.fn().mockResolvedValue(1);
      dispose = vi.fn();
      close = vi.fn();
      constructor() {
        callCount += 1;
      }
    }

    class CountingAudioSampleSink {
      samples = vi.fn().mockReturnValue(singleSample());
      close = vi.fn();
      dispose = vi.fn();
    }

    const engine = new AudioDecodeEngine({
      ...createMockDeps({
        inputClass: CountingInput as unknown as new (...args: unknown[]) => unknown,
      }),
      AudioSampleSink: CountingAudioSampleSink as unknown as new (...args: unknown[]) => unknown,
    });

    await engine.decodeToFloat32Channels(new Blob([]), 'key1');
    engine.reset();
    await engine.decodeToFloat32Channels(new Blob([]), 'key1');
    expect(callCount).toBe(2);
  });

  it('global decode slot limits concurrent decodes', async () => {
    let active = 0;
    let maxActive = 0;

    async function* singleSample() {
      yield {
        sampleRate: 48000,
        numberOfChannels: 2,
        numberOfFrames: 100,
        timestamp: 0,
        allocationSize: () => 400,
        copyTo: (dst: Float32Array) => {
          dst.fill(0.5);
        },
        close: vi.fn(),
      };
    }

    class SlowInput {
      getPrimaryAudioTrack = vi.fn().mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 50));
        active -= 1;
        return { canDecode: vi.fn().mockResolvedValue(true), sampleRate: 48000 };
      });
      computeDuration = vi.fn().mockResolvedValue(1);
      dispose = vi.fn();
      close = vi.fn();
    }

    class SlowAudioSampleSink {
      samples = vi.fn().mockReturnValue(singleSample());
      close = vi.fn();
      dispose = vi.fn();
    }

    const engine = new AudioDecodeEngine(
      {
        Input: SlowInput as unknown as new (...args: unknown[]) => unknown,
        AudioSampleSink: SlowAudioSampleSink as unknown as new (...args: unknown[]) => unknown,
        BlobSource: class {
          constructor(public blob: Blob) {}
        } as unknown as new (...args: unknown[]) => unknown,
        ALL_FORMATS: {},
        governedBlobWorker: (blob: Blob) => blob,
      },
      16,
      1,
    );

    const reqA: DecodeRequest = {
      type: 'decode',
      id: 1,
      sourceKey: 'a',
      arrayBuffer: new ArrayBuffer(0),
    };
    const reqB: DecodeRequest = {
      type: 'decode',
      id: 2,
      sourceKey: 'b',
      arrayBuffer: new ArrayBuffer(0),
    };
    const promises = [engine.handleRequest(reqA), engine.handleRequest(reqB)];
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
