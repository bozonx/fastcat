import { describe, it, expect, vi } from 'vitest';
import {
  interleavedToPlanar,
  normalizeSampleChannels,
  AudioMixer,
  type PreparedClip,
} from '~/workers/core/AudioMixer';

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
  BlobSource: class {},
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
    const interleaved = new Float32Array([
      1,
      10, // frame 0: L, R
      2,
      20, // frame 1
      3,
      30, // frame 2
    ]);

    const planar = interleavedToPlanar({ interleaved, frames: 3, numberOfChannels: 2 });

    expect(Array.from(planar)).toEqual([1, 2, 3, 10, 20, 30]);
  });

  it('converts mono interleaved to planar (no-op layout change)', () => {
    const interleaved = new Float32Array([5, 6, 7]);
    const planar = interleavedToPlanar({ interleaved, frames: 3, numberOfChannels: 1 });
    expect(Array.from(planar)).toEqual([5, 6, 7]);
  });

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
    expect(prepared[0]?.input).toBeInstanceOf(mockMediabunny.Input);
    expect(prepared[0]?.sink).toBeInstanceOf(mockMediabunny.AudioSampleSink);
  });

  it('filters out clips with missing sourcePath', async () => {
    const audioClips = [{ startUs: 0, durationUs: 1_000_000 }];
    const prepared = await AudioMixer.prepareClips({
      audioClips: audioClips as any,
      hostClient: mockHostClient,
      reportExportWarning: vi.fn(),
      mediabunny: mockMediabunny as any,
    });
    expect(prepared).toHaveLength(0);
  });

  it('handles cancellation during prepareClips', async () => {
    const audioClips = [{ sourcePath: 'test.mp3', startUs: 0 }];
    const checkCancel = vi.fn().mockReturnValue(true);
    await expect(
      AudioMixer.prepareClips({
        audioClips: audioClips as any,
        hostClient: mockHostClient,
        reportExportWarning: vi.fn(),
        mediabunny: mockMediabunny as any,
        checkCancel,
      }),
    ).rejects.toThrow('Export was cancelled');
  });
});

describe('AudioMixer.writeMixedToSource', () => {
  it('mixes multiple overlapping clips by summing their samples', async () => {
    const sampleRate = 48000;
    const numberOfChannels = 1;
    const durationS = 1;
    const audioSource = {
      add: vi.fn().mockResolvedValue(undefined),
    };

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

    expect(audioSource.add).toHaveBeenCalledTimes(1);
    const resultInstance = audioSource.add.mock.calls[0][0];
    const mixedData = resultInstance.data.data;
    // Each clip contributed 0.5, so sum should be 1.0
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
        audioGain: 0.5, // 50% volume
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
    // Source was 0.5, gain was 0.5, result should be 0.25
    expect(mixedData[0]).toBeCloseTo(0.25);
  });

  it('applies fade-in correctly', async () => {
    const sampleRate = 1000; // Small sample rate for easier testing
    const numberOfChannels = 1;
    const durationS = 1;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    // Update mock for this specific test to return one sample covering the whole duration
    const customSink = new mockMediabunny.AudioSampleSink();
    customSink.samples = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        const data = new Float32Array(1000).fill(1.0); // Source is all 1.0
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
        audioFadeInS: 1.0, // Fade in over 1 second
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

    // At t=0s, gain should be 0
    expect(mixedData[0]).toBeCloseTo(0);
    // At t=0.5s (frame 500), gain should be 0.5
    expect(mixedData[500]).toBeCloseTo(0.5);
    // At t=1.0s (frame 999), gain should be ~1.0
    expect(mixedData[999]).toBeCloseTo(1.0, 1);
  });
});
