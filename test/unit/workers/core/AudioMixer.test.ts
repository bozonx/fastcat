/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  interleavedToPlanar,
  normalizeSampleChannels,
  AudioMixer,
  resampleChannelsOfflineAudioContext,
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
    expect(mixedData[0]).toBeCloseTo(0.5);
    expect(mixedData[48000]).toBeCloseTo(0);
  });

  it('handles reversed playback correctly', async () => {
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
    expect(mixedData[0]).toBeCloseTo(0.999);
    expect(mixedData[500]).toBeCloseTo(0.499);
    expect(mixedData[999]).toBeCloseTo(0);
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
});
