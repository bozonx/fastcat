/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  interleavedToPlanar,
  normalizeSampleChannels,
  AudioMixer,
  resampleChannelsOfflineAudioContext,
  resampleAndStretchOffline,
  getStereoPanMatrix,
  type PreparedClip,
} from '~/workers/core/AudioMixer';
import { applyAudioEffectsOffline } from '~/utils/audio/apply-audio-effects-offline';

vi.mock('~/utils/audio/apply-audio-effects-offline', () => ({
  applyAudioEffectsOffline: vi
    .fn()
    .mockImplementation(({ planes, frames }) => Promise.resolve({ planes, frames })),
}));

const mockMediabunny = {
  AudioSampleSink: class {
    samples = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          numberOfFrames: 100,
          sampleRate: 48000,
          numberOfChannels: 1,
          timestamp: 0,
          allocationSize: () => 400,
          copyTo: (dst: Float32Array) => dst.fill(0.5),
        };
      },
    });
  },
  Input: class {
    getPrimaryAudioTrack = vi.fn().mockResolvedValue({
      canDecode: vi.fn().mockResolvedValue(true),
      duration: 10,
    });
  },
  BlobSource: class {
    constructor() {}
  },
  ALL_FORMATS: {},
  AudioSample: class {
    data: any;
    constructor(params: any) {
      this.data = params;
    }
  },
};

const mockHostClient = {
  getFileHandleByPath: vi.fn().mockResolvedValue({
    getFile: vi.fn().mockResolvedValue(new File([], 'test.mp3')),
  }),
  getFileByPath: vi.fn().mockResolvedValue(new File([], 'test.mp3')),
} as any;

describe('AudioMixer interleavedToPlanar', () => {
  it('converts stereo interleaved to planar', () => {
    const interleaved = new Float32Array([1, 10, 2, 20, 3, 30]);
    const planar = interleavedToPlanar({ interleaved, frames: 3, numberOfChannels: 2 });
    expect(Array.from(planar)).toEqual([1, 2, 3, 10, 20, 30]);
  });
});

describe('AudioMixer channel normalization', () => {
  it('duplicates mono channel into stereo', () => {
    const [left, right] = normalizeSampleChannels({
      planes: [new Float32Array([0.25, 0.5, 0.75])],
      sourceChannels: 1,
      targetChannels: 2,
      frames: 3,
    });
    expect(Array.from(left ?? [])).toEqual([0.25, 0.5, 0.75]);
    expect(Array.from(right ?? [])).toEqual([0.25, 0.5, 0.75]);
  });

  it('downmixes stereo channels into mono', () => {
    const [mono] = normalizeSampleChannels({
      planes: [new Float32Array([1, 0.5]), new Float32Array([0, -0.5])],
      sourceChannels: 2,
      targetChannels: 1,
      frames: 2,
    });
    expect(Array.from(mono ?? [])).toEqual([0.5, 0]);
  });

  it('handles source and target channel match (pass-through)', () => {
    const planes = [new Float32Array([1, 2]), new Float32Array([3, 4])];
    const result = normalizeSampleChannels({
      planes,
      sourceChannels: 2,
      targetChannels: 2,
      frames: 2,
    });
    expect(result).toEqual(planes);
  });
});

describe('AudioMixer pan matrix', () => {
  it('matches StereoPannerNode equal-power mixing at center', () => {
    expect(getStereoPanMatrix(0)).toEqual({ ll: 1, lr: 0, rl: 0, rr: 1 });
  });

  it('mixes the right channel into the left as pan moves left', () => {
    const fullLeft = getStereoPanMatrix(-1);
    expect(fullLeft.ll).toBe(1);
    expect(fullLeft.lr).toBeCloseTo(1);
    expect(fullLeft.rl).toBe(0);
    expect(fullLeft.rr).toBeCloseTo(0);

    const halfLeft = getStereoPanMatrix(-0.5);
    expect(halfLeft.ll).toBe(1);
    expect(halfLeft.lr).toBeCloseTo(Math.SQRT1_2);
    expect(halfLeft.rl).toBe(0);
    expect(halfLeft.rr).toBeCloseTo(Math.SQRT1_2);
  });

  it('mixes the left channel into the right as pan moves right', () => {
    const fullRight = getStereoPanMatrix(1);
    expect(fullRight.ll).toBeCloseTo(0);
    expect(fullRight.lr).toBe(0);
    expect(fullRight.rl).toBeCloseTo(1);
    expect(fullRight.rr).toBe(1);

    const halfRight = getStereoPanMatrix(0.5);
    expect(halfRight.ll).toBeCloseTo(Math.SQRT1_2);
    expect(halfRight.lr).toBe(0);
    expect(halfRight.rl).toBeCloseTo(Math.SQRT1_2);
    expect(halfRight.rr).toBe(1);
  });
});

describe('resampleChannelsOfflineAudioContext', () => {
  it('resamples using OfflineAudioContext', async () => {
    const mockRenderedBuffer = {
      getChannelData: vi.fn().mockReturnValue(new Float32Array([0.1, 0.2])),
      length: 2,
    };
    const mockOfflineCtx = {
      createBuffer: vi.fn().mockReturnValue({
        copyToChannel: vi.fn(),
      }),
      createBufferSource: vi.fn().mockReturnValue({
        connect: vi.fn(),
        start: vi.fn(),
      }),
      destination: {},
      startRendering: vi.fn().mockResolvedValue(mockRenderedBuffer),
    };

    globalThis.OfflineAudioContext = vi.fn().mockImplementation(function () {
      return mockOfflineCtx;
    }) as any;

    const result = await resampleChannelsOfflineAudioContext({
      planes: [new Float32Array([0.5, 0.5])],
      sourceSampleRate: 44100,
      targetSampleRate: 48000,
      sourceFrames: 2,
      targetFrames: 2,
      channels: 1,
    });

    expect(globalThis.OfflineAudioContext).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(new Float32Array([0.1, 0.2]));
  });
});

describe('AudioMixer.prepareClips', () => {
  it('prepares audio clips correctly', async () => {
    const audioClips = [
      {
        sourcePath: 'test.mp3',
        startUs: 0,
        durationUs: 1_000_000,
        sourceStartUs: 0,
        sourceDurationUs: 1_000_000,
        audioGain: 0.5,
        audioBalance: 0,
        trackId: 'track1',
      },
    ];

    const reportExportWarning = vi.fn();
    const prepared = await AudioMixer.prepareClips({
      audioClips,
      hostClient: mockHostClient,
      reportExportWarning,
      mediabunny: mockMediabunny as any,
    });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      clipStartS: 0,
      playDurationS: 1,
      audioGain: 0.5,
      audioBalance: 0,
    });
  });

  it('handles adjacent clips on the same track for fade resolution', async () => {
    const audioClips = [
      {
        sourcePath: 'test1.mp3',
        startUs: 0,
        durationUs: 1_000_000,
        sourceDurationUs: 1_000_000,
        trackId: 'track1',
      },
      {
        sourcePath: 'test2.mp3',
        startUs: 1_000_000,
        durationUs: 1_000_000,
        sourceDurationUs: 1_000_000,
        trackId: 'track1',
      },
    ];

    const prepared = await AudioMixer.prepareClips({
      audioClips,
      hostClient: mockHostClient,
      reportExportWarning: vi.fn(),
      mediabunny: mockMediabunny as any,
    });

    expect(prepared).toHaveLength(2);
  });
});

describe('AudioMixer.writeMixedToSource', () => {
  it('mixes multiple overlapping clips by summing their samples', async () => {
    const sampleRate = 48000;
    const numberOfChannels = 1;
    const durationS = 1;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: 1,
        input: new mockMediabunny.Input() as any,
        sink: new mockMediabunny.AudioSampleSink() as any,
        sourcePath: 'test1.mp3',
        speed: 1,
        reversed: false,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 0,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: 1,
        input: new mockMediabunny.Input() as any,
        sink: new mockMediabunny.AudioSampleSink() as any,
        sourcePath: 'test2.mp3',
        speed: 1,
        reversed: false,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 0,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
    ];

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS,
      audioSource,
      chunkDurationS: 1,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    const resultInstance = audioSource.add.mock.calls[0][0];
    const mixedData = resultInstance.data.data;
    expect(mixedData[0]).toBeCloseTo(1.0);
  });

  it('applies audioGain correctly', async () => {
    const sampleRate = 48000;
    const numberOfChannels = 1;
    const durationS = 1;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: 1,
        input: new mockMediabunny.Input() as any,
        sink: new mockMediabunny.AudioSampleSink() as any,
        sourcePath: 'test1.mp3',
        speed: 1,
        reversed: false,
        audioGain: 0.5,
        audioBalance: 0,
        audioFadeInS: 0,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
    ];

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS,
      audioSource,
      chunkDurationS: 1,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    const resultInstance = audioSource.add.mock.calls[0][0];
    const mixedData = resultInstance.data.data;
    expect(mixedData[0]).toBeCloseTo(0.25);
  });

  it('applies fade-in correctly', async () => {
    const sampleRate = 1000;
    const numberOfChannels = 1;
    const durationS = 1;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    const customSink = new mockMediabunny.AudioSampleSink();
    customSink.samples = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        const data = new Float32Array(1000).fill(1.0);
        yield {
          numberOfFrames: 1000,
          sampleRate: 1000,
          numberOfChannels: 1,
          timestamp: 0,
          allocationSize: () => 4000,
          copyTo: (dst: Float32Array) => dst.set(data),
        };
      },
    });

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: 1,
        input: new mockMediabunny.Input() as any,
        sink: customSink as any,
        sourcePath: 'test1.mp3',
        speed: 1,
        reversed: false,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 1.0,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
    ];

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS,
      audioSource,
      chunkDurationS: 1,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    const resultInstance = audioSource.add.mock.calls[0][0];
    const mixedData = resultInstance.data.data;
    expect(mixedData[0]).toBeCloseTo(0);
    expect(mixedData[500]).toBeCloseTo(0.5);
    expect(mixedData[999]).toBeCloseTo(1.0, 1);
  });

  it('applies panning (audioBalance) correctly in stereo', async () => {
    const sampleRate = 48000;
    const numberOfChannels = 2;
    const durationS = 1;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: 1,
        input: new mockMediabunny.Input() as any,
        sink: new mockMediabunny.AudioSampleSink() as any,
        sourcePath: 'panning.mp3',
        speed: 1,
        reversed: false,
        audioGain: 1,
        audioBalance: -1.0,
        audioFadeInS: 0,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
    ];

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS,
      audioSource,
      chunkDurationS: 1,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    const resultInstance = audioSource.add.mock.calls[0][0];
    const mixedData = resultInstance.data.data;
    // Mono source promoted to stereo carries the same 0.5 in both planes.
    // Full-left pan (W3C matrix): L_out = L + R = 1.0, R_out = 0.
    expect(mixedData[0]).toBeCloseTo(1.0);
    expect(mixedData[48000]).toBeCloseTo(0);
  });

  it('skips reversed clips entirely (no audio rendered)', async () => {
    const sampleRate = 1000;
    const numberOfChannels = 1;
    const durationS = 1;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    const customSink = new mockMediabunny.AudioSampleSink();
    customSink.samples = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        const data = new Float32Array(1000);
        for (let i = 0; i < 1000; i++) data[i] = i / 1000;
        yield {
          numberOfFrames: 1000,
          sampleRate: 1000,
          numberOfChannels: 1,
          timestamp: 0,
          allocationSize: () => 4000,
          copyTo: (dst: Float32Array) => dst.set(data),
        };
      },
    });

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: 1,
        input: new mockMediabunny.Input() as any,
        sink: customSink as any,
        sourcePath: 'reverse.mp3',
        speed: 1,
        reversed: true,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 0,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
    ];

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS,
      audioSource,
      chunkDurationS: 1,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    const resultInstance = audioSource.add.mock.calls[0][0];
    const mixedData = resultInstance.data.data;
    for (let i = 0; i < mixedData.length; i += 1) {
      expect(mixedData[i]).toBe(0);
    }
  });

  it('applies audio effects if present', async () => {
    const sampleRate = 48000;
    const numberOfChannels = 1;
    const durationS = 1;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: 1,
        input: new mockMediabunny.Input() as any,
        sink: new mockMediabunny.AudioSampleSink() as any,
        sourcePath: 'effects.mp3',
        speed: 1,
        reversed: false,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 0,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [{ id: 'fx1', type: 'reverb', enabled: true, target: 'audio' }] as any,
      },
    ];

    (applyAudioEffectsOffline as any).mockImplementation(({ planes, frames }: any) => {
      const newPlanes = planes.map((p: Float32Array) => {
        const out = new Float32Array(p.length);
        for (let i = 0; i < p.length; i++) out[i] = p[i]! * 2;
        return out;
      });
      return Promise.resolve({ planes: newPlanes, frames });
    });

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS,
      audioSource,
      chunkDurationS: 1,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    expect(applyAudioEffectsOffline).toHaveBeenCalled();
    const resultInstance = audioSource.add.mock.calls[0][0];
    const mixedData = resultInstance.data.data;
    expect(mixedData[0]).toBeCloseTo(1.0);
  });

  it('processes long effect clips in overlapped chunks', async () => {
    vi.mocked(applyAudioEffectsOffline).mockClear();
    const sampleRate = 1000;
    const numberOfChannels = 1;
    const durationS = 25;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    const customSink = new mockMediabunny.AudioSampleSink();
    customSink.samples = vi.fn((startS: number, endS: number) => ({
      [Symbol.asyncIterator]: async function* () {
        const frames = Math.round((endS - startS) * sampleRate);
        const data = new Float32Array(frames).fill(0.25);
        yield {
          numberOfFrames: frames,
          sampleRate,
          numberOfChannels: 1,
          timestamp: startS,
          allocationSize: () => frames * 4,
          copyTo: (dst: Float32Array) => dst.set(data),
        };
      },
    }));

    (applyAudioEffectsOffline as any).mockImplementation(({ planes, frames }: any) => {
      const newPlanes = planes.map((p: Float32Array) => {
        const out = new Float32Array(p.length);
        for (let i = 0; i < p.length; i += 1) out[i] = p[i]! * 2;
        return out;
      });
      return Promise.resolve({ planes: newPlanes, frames });
    });

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: durationS,
        input: new mockMediabunny.Input() as any,
        sink: customSink as any,
        sourcePath: 'long-effects.mp3',
        speed: 1,
        reversed: false,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 0,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [
          {
            id: 'fx1',
            type: 'audio-echo',
            enabled: true,
            target: 'audio',
            delayTime: 0.5,
            feedback: 0.5,
          },
        ] as any,
      },
    ];

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS,
      audioSource,
      chunkDurationS: 25,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    expect(customSink.samples).toHaveBeenCalledTimes(3);
    expect(customSink.samples).toHaveBeenNthCalledWith(1, 0, 11);
    expect(customSink.samples).toHaveBeenNthCalledWith(2, 10, 21);
    expect(customSink.samples).toHaveBeenNthCalledWith(3, 20, 25);
    expect(applyAudioEffectsOffline).toHaveBeenCalledTimes(3);

    const mixedData = audioSource.add.mock.calls[0][0].data.data;
    expect(mixedData[0]).toBeCloseTo(0.5);
    expect(mixedData[15_000]).toBeCloseTo(0.5);
    expect(mixedData[24_999]).toBeCloseTo(0.5);
  });

  it('drops audio on negative-speed clips even when fades are set', async () => {
    const sampleRate = 1000;
    const numberOfChannels = 1;
    const durationS = 1;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    const customSink = new mockMediabunny.AudioSampleSink();
    customSink.samples = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        const data = new Float32Array(1000).fill(1.0);
        yield {
          numberOfFrames: 1000,
          sampleRate: 1000,
          numberOfChannels: 1,
          timestamp: 0,
          allocationSize: () => 4000,
          copyTo: (dst: Float32Array) => dst.set(data),
        };
      },
    });

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: 1,
        input: new mockMediabunny.Input() as any,
        sink: customSink as any,
        sourcePath: 'reverse-fade.mp3',
        speed: 1,
        reversed: true,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 0.5,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
    ];

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS,
      audioSource,
      chunkDurationS: 1,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    const mixedData = audioSource.add.mock.calls[0][0].data.data;
    for (let i = 0; i < mixedData.length; i += 1) {
      expect(mixedData[i]).toBe(0);
    }
  });
});

describe('AudioMixer time-stretch via speed', () => {
  it('invokes resampleAndStretchOffline when speed != 1', async () => {
    const sampleRate = 1000;
    const numberOfChannels = 1;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };
    const data = new Float32Array(2000).fill(0.5);
    const customSink = new mockMediabunny.AudioSampleSink();
    customSink.samples = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          numberOfFrames: 2000,
          sampleRate: 1000,
          numberOfChannels: 1,
          timestamp: 0,
          allocationSize: () => 8000,
          copyTo: (dst: Float32Array) => dst.set(data),
        };
      },
    });

    const offlineRendered = new Float32Array(1000).fill(0.5);
    const mockOfflineCtx = {
      createBuffer: vi.fn().mockReturnValue({ copyToChannel: vi.fn() }),
      createBufferSource: vi.fn().mockReturnValue({
        buffer: null,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        start: vi.fn(),
      }),
      destination: {},
      startRendering: vi.fn().mockResolvedValue({
        getChannelData: () => offlineRendered,
        length: offlineRendered.length,
      }),
    };
    const savedCtx = (globalThis as any).OfflineAudioContext;
    (globalThis as any).OfflineAudioContext = vi.fn().mockImplementation(function () {
      return mockOfflineCtx;
    });

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: 1, // 2 source seconds at speed=2 → 1 output second
        input: new mockMediabunny.Input() as any,
        sink: customSink as any,
        sourcePath: 'speed2.mp3',
        speed: 2,
        reversed: false,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 0,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
    ];

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS: 1,
      audioSource,
      chunkDurationS: 1,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    expect((globalThis as any).OfflineAudioContext).toHaveBeenCalledWith(1, 1000, 1000);
    expect(mockOfflineCtx.createBufferSource().playbackRate.value).toBe(2);
    const mixedData = audioSource.add.mock.calls[0][0].data.data;
    expect(mixedData[0]).toBeCloseTo(0.5);
    expect(mixedData[999]).toBeCloseTo(0.5);

    (globalThis as any).OfflineAudioContext = savedCtx;
  });
});

describe('AudioMixer clip warning', () => {
  it('reports a warning when the mix sum exceeds [-1, 1]', async () => {
    const sampleRate = 1000;
    const numberOfChannels = 1;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    function makeSink() {
      const sink = new mockMediabunny.AudioSampleSink();
      sink.samples = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          const data = new Float32Array(100).fill(0.8);
          yield {
            numberOfFrames: 100,
            sampleRate: 1000,
            numberOfChannels: 1,
            timestamp: 0,
            allocationSize: () => 400,
            copyTo: (dst: Float32Array) => dst.set(data),
          };
        },
      });
      return sink;
    }

    const prepared: PreparedClip[] = [0, 1].map(() => ({
      clipStartS: 0,
      offsetS: 0,
      playDurationS: 0.1,
      input: new mockMediabunny.Input() as any,
      sink: makeSink() as any,
      sourcePath: 'a.mp3',
      speed: 1,
      reversed: false,
      audioGain: 1,
      audioBalance: 0,
      audioFadeInS: 0,
      audioFadeOutS: 0,
      audioFadeInCurve: 'linear',
      audioFadeOutCurve: 'linear',
      audioEffects: [],
    }));

    const reportExportWarning = vi.fn().mockResolvedValue(undefined);
    await AudioMixer.writeMixedToSource({
      prepared,
      durationS: 0.1,
      audioSource,
      chunkDurationS: 1,
      sampleRate,
      numberOfChannels,
      reportExportWarning,
      AudioSample: mockMediabunny.AudioSample as any,
    });

    expect(reportExportWarning).toHaveBeenCalledWith(
      expect.stringContaining('Audio output clipped'),
    );
  });
});

describe('resampleAndStretchOffline', () => {
  it('passes playbackRate through to the buffer source', async () => {
    const buffer = { copyToChannel: vi.fn() };
    const bufferSource = {
      buffer: null,
      playbackRate: { value: 1 },
      connect: vi.fn(),
      start: vi.fn(),
    };
    const rendered = new Float32Array(500).fill(0.25);
    const offlineCtx = {
      createBuffer: vi.fn().mockReturnValue(buffer),
      createBufferSource: vi.fn().mockReturnValue(bufferSource),
      destination: {},
      startRendering: vi.fn().mockResolvedValue({
        getChannelData: () => rendered,
        length: rendered.length,
      }),
    };
    const saved = (globalThis as any).OfflineAudioContext;
    (globalThis as any).OfflineAudioContext = vi.fn().mockImplementation(function () {
      return offlineCtx;
    });

    const result = await resampleAndStretchOffline({
      planes: [new Float32Array(1000).fill(0.25)],
      sourceSampleRate: 1000,
      sourceFrames: 1000,
      targetSampleRate: 1000,
      targetFrames: 500,
      channels: 1,
      playbackRate: 2,
    });

    expect((globalThis as any).OfflineAudioContext).toHaveBeenCalledWith(1, 500, 1000);
    expect(bufferSource.playbackRate.value).toBe(2);
    expect(result).toHaveLength(1);
    expect(result[0]?.length).toBe(500);

    (globalThis as any).OfflineAudioContext = saved;
  });
});
