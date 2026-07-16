/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  interleavedToPlanar,
  normalizeSampleChannels,
  AudioMixer,
  buildGainEnvelope,
  mixProcessedChunk,
  resampleChannelsOfflineAudioContext,
  resampleAndStretchOffline,
  getStereoPanMatrix,
  type PreparedClip,
} from '~/workers/core/AudioMixer';
import { applyAudioEffectsOffline } from '~/utils/audio/apply-audio-effects-offline';
import { timelineTicks } from '../../utils/timeline-time';

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
  it('duplicates mono channel into stereo with 1/sqrt(2) scaling', () => {
    const g = Math.SQRT1_2;
    const [left, right] = normalizeSampleChannels({
      planes: [new Float32Array([0.25, 0.5, 0.75])],
      sourceChannels: 1,
      targetChannels: 2,
      frames: 3,
    });
    const expected = [0.25 * g, 0.5 * g, 0.75 * g];
    for (let i = 0; i < 3; i += 1) {
      expect(left![i]).toBeCloseTo(expected[i], 6);
      expect(right![i]).toBeCloseTo(expected[i], 6);
    }
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

// ── Cross-engine parity: BS.775 downmix ──────────────────────────────
//
// These tests mirror the Rust `planar_to_interleaved` / `stereo_downmix_coeffs`
// tests in `src-tauri/src/audio/resample.rs`. The web `normalizeSampleChannels`
// and the native `planar_to_interleaved` must produce identical per-channel
// coefficients for multichannel sources so 5.1 exports sound the same on both
// engines.

describe('normalizeSampleChannels BS.775 parity with native', () => {
  const c = Math.SQRT1_2;

  it('downmixes 5.1 to stereo keeping centre and dropping LFE', () => {
    // 5.1 order: FL FR FC LFE BL BR. One frame.
    const planes = [
      new Float32Array([1.0]), // FL
      new Float32Array([2.0]), // FR
      new Float32Array([3.0]), // FC
      new Float32Array([9.0]), // LFE (dropped)
      new Float32Array([4.0]), // BL
      new Float32Array([5.0]), // BR
    ];
    const [left, right] = normalizeSampleChannels({
      planes,
      sourceChannels: 6,
      targetChannels: 2,
      frames: 1,
    });
    const expectL = 1.0 + c * 3.0 + c * 4.0;
    const expectR = 2.0 + c * 3.0 + c * 5.0;
    expect(left![0]).toBeCloseTo(expectL, 6);
    expect(right![0]).toBeCloseTo(expectR, 6);
    // Centre channel must reach BOTH outputs (dialogue not lost).
    expect(left![0]).toBeGreaterThan(1.0);
    expect(right![0]).toBeGreaterThan(2.0);
  });

  it('downmixes 5.1 to mono averaging ALL channels including LFE', () => {
    const planes = [
      new Float32Array([1.0]), // FL
      new Float32Array([2.0]), // FR
      new Float32Array([3.0]), // FC
      new Float32Array([9.0]), // LFE
      new Float32Array([4.0]), // BL
      new Float32Array([5.0]), // BR
    ];
    const [mono] = normalizeSampleChannels({
      planes,
      sourceChannels: 6,
      targetChannels: 1,
      frames: 1,
    });
    // Native averages ALL 6 channels: (1+2+3+9+4+5)/6 = 24/6 = 4.0
    expect(mono![0]).toBeCloseTo(4.0, 6);
  });

  it('downmixes 3.0 to stereo folding centre into both', () => {
    const planes = [
      new Float32Array([1.0]), // FL
      new Float32Array([2.0]), // FR
      new Float32Array([3.0]), // FC
    ];
    const [left, right] = normalizeSampleChannels({
      planes,
      sourceChannels: 3,
      targetChannels: 2,
      frames: 1,
    });
    expect(left![0]).toBeCloseTo(1.0 + c * 3.0, 6);
    expect(right![0]).toBeCloseTo(2.0 + c * 3.0, 6);
  });

  it('downmixes quad (4.0) to stereo folding surrounds into L/R', () => {
    const planes = [
      new Float32Array([1.0]), // FL
      new Float32Array([2.0]), // FR
      new Float32Array([4.0]), // BL
      new Float32Array([5.0]), // BR
    ];
    const [left, right] = normalizeSampleChannels({
      planes,
      sourceChannels: 4,
      targetChannels: 2,
      frames: 1,
    });
    expect(left![0]).toBeCloseTo(1.0 + c * 4.0, 6);
    expect(right![0]).toBeCloseTo(2.0 + c * 5.0, 6);
  });

  it('downmixes multichannel to mono averaging all channels (not just L+R)', () => {
    const planes = [
      new Float32Array([6.0]), // FL
      new Float32Array([0.0]), // FR
      new Float32Array([0.0]), // FC
      new Float32Array([0.0]), // LFE
      new Float32Array([0.0]), // BL
      new Float32Array([0.0]), // BR
    ];
    const [mono] = normalizeSampleChannels({
      planes,
      sourceChannels: 6,
      targetChannels: 1,
      frames: 1,
    });
    // (6+0+0+0+0+0)/6 = 1.0 — old web code would have returned (6+0)*0.5 = 3.0
    expect(mono![0]).toBeCloseTo(1.0, 6);
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

describe('AudioMixer clip mix parity primitives', () => {
  function preparedClip(overrides: Partial<PreparedClip> = {}): PreparedClip {
    return {
      clipStartS: 0,
      offsetS: 0,
      playDurationS: 1,
      input: new mockMediabunny.Input() as any,
      sink: new mockMediabunny.AudioSampleSink() as any,
      sourcePath: 'primitive.mp3',
      speed: 1,
      audioGain: 1,
      audioBalance: 0,
      audioFadeInS: 0,
      audioFadeOutS: 0,
      audioFadeInCurve: 'linear',
      audioFadeOutCurve: 'linear',
      audioEffects: [],
      ...overrides,
    };
  }

  it('builds a linear fade envelope matching the native gain shape', () => {
    const envelope = buildGainEnvelope({
      frames: 1000,
      startFrame: 0,
      targetSampleRate: 1000,
      clip: preparedClip({
        audioFadeInS: 0.25,
        audioFadeOutS: 0.25,
      }),
    });

    expect(envelope[0]).toBeCloseTo(0);
    expect(envelope[125]).toBeCloseTo(0.5);
    expect(envelope[500]).toBeCloseTo(1);
    expect(envelope[875]).toBeCloseTo(0.5);
    expect(envelope[999]).toBeLessThan(0.01);
  });

  it('scales the whole envelope by clip gain', () => {
    const envelope = buildGainEnvelope({
      frames: 1000,
      startFrame: 0,
      targetSampleRate: 1000,
      clip: preparedClip({
        audioGain: 0.5,
        audioFadeInS: 0.25,
      }),
    });

    expect(envelope[125]).toBeCloseTo(0.25);
    expect(envelope[500]).toBeCloseTo(0.5);
  });

  it('samples animated audio volume in the gain envelope', () => {
    const envelope = buildGainEnvelope({
      frames: 3,
      startFrame: 0,
      targetSampleRate: 2,
      clip: preparedClip({
        playDurationS: 1.5,
        animations: {
          'audio.volume': {
            keyframes: [
              { tTicks: 0, value: 0, easing: 'linear' },
              { tTicks: timelineTicks(1_000_000), value: 1, easing: 'linear' },
            ],
          },
        },
      }),
    });

    expect(Array.from(envelope)).toEqual([0, 0.5, 1]);
  });

  it('mixes hard-left stereo balance by folding right into left', () => {
    const mixed = new Float32Array(8);
    const next = mixProcessedChunk({
      processed: {
        startFrame: 0,
        frames: 4,
        planes: [new Float32Array([1, 1, 1, 1]), new Float32Array([0.5, 0.5, 0.5, 0.5])],
        gainEnvelope: new Float32Array([1, 1, 1, 1]),
        panEnvelope: new Float32Array([-1, -1, -1, -1]),
      },
      sourceStartFrame: 0,
      sourceEndFrame: 4,
      writeStartFrame: 0,
      mixedInterleaved: mixed,
      numberOfChannels: 2,
    });

    expect(next).toBe(4);
    expect(Array.from(mixed)).toEqual([1.5, 0, 1.5, 0, 1.5, 0, 1.5, 0]);
  });

  it('mixes only the requested processed segment at the requested output offset', () => {
    const mixed = new Float32Array(6);
    const next = mixProcessedChunk({
      processed: {
        startFrame: 10,
        frames: 4,
        planes: [new Float32Array([1, 2, 3, 4])],
        gainEnvelope: new Float32Array([1, 0.5, 0.25, 0]),
        panEnvelope: new Float32Array([0, 0, 0, 0]),
      },
      sourceStartFrame: 11,
      sourceEndFrame: 13,
      writeStartFrame: 1,
      mixedInterleaved: mixed,
      numberOfChannels: 1,
    });

    expect(next).toBe(13);
    expect(Array.from(mixed)).toEqual([0, 1, 0.75, 0, 0, 0]);
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
        disconnect: vi.fn(),
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
        startTicks: 0,
        durationTicks: timelineTicks(1_000_000),
        sourceStartTicks: 0,
        sourceDurationTicks: timelineTicks(1_000_000),
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
        startTicks: 0,
        durationTicks: timelineTicks(1_000_000),
        sourceDurationTicks: timelineTicks(1_000_000),
        trackId: 'track1',
      },
      {
        sourcePath: 'test2.mp3',
        startTicks: timelineTicks(1_000_000),
        durationTicks: timelineTicks(1_000_000),
        sourceDurationTicks: timelineTicks(1_000_000),
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

  it('extends adjacent transition handles exactly once', async () => {
    const prepared = await AudioMixer.prepareClips({
      audioClips: [
        {
          sourcePath: 'test.mp3',
          startTicks: timelineTicks(1_000_000),
          durationTicks: timelineTicks(1_000_000),
          sourceStartTicks: timelineTicks(500_000),
          sourceDurationTicks: timelineTicks(1_000_000),
          speed: 1,
          transitionIn: { durationTicks: timelineTicks(100_000), mode: 'adjacent' },
          transitionOut: { durationTicks: timelineTicks(150_000), mode: 'adjacent' },
        },
      ],
      hostClient: mockHostClient,
      reportExportWarning: vi.fn(),
      mediabunny: mockMediabunny as any,
    });

    expect(prepared[0]).toMatchObject({
      clipStartS: 0.9,
      offsetS: 0.4,
      playDurationS: 1.25,
    });
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

  it('reports progress after each emitted output chunk', async () => {
    const sampleRate = 100;
    const numberOfChannels = 1;
    const durationS = 2;
    const onProgress = vi.fn();
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: 2,
        input: new mockMediabunny.Input() as any,
        sink: new mockMediabunny.AudioSampleSink() as any,
        sourcePath: 'test1.mp3',
        speed: 1,
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
      onProgress,
    });

    expect(onProgress).toHaveBeenNthCalledWith(1, 0.5);
    expect(onProgress).toHaveBeenLastCalledWith(1);
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
    // Mono source promoted to stereo carries 0.5*1/√2 in each plane.
    // Full-left pan (W3C matrix): L_out = L + R = 0.5*√2, R_out = 0.
    expect(mixedData[0]).toBeCloseTo(0.5 * Math.SQRT2);
    expect(mixedData[48000]).toBeCloseTo(0);
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

  it('applies an audio fade-in across the mixed output', async () => {
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
        sourcePath: 'fade.mp3',
        speed: 1,
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
    expect(mixedData[0]).toBeCloseTo(0.0);
    expect(mixedData[250]).toBeCloseTo(0.5);
    expect(mixedData[500]).toBeCloseTo(1.0, 1);
    expect(mixedData[999]).toBeCloseTo(1.0);
  });

  it('applies master audio effects once on the mixed bus', async () => {
    vi.mocked(applyAudioEffectsOffline).mockClear();
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
        sourcePath: 'clip1.mp3',
        speed: 1,
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
        sourcePath: 'clip2.mp3',
        speed: 1,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 0,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
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

    const masterAudioEffects = [
      { id: 'm1', type: 'limiter', enabled: true, target: 'audio' },
    ] as any;

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS,
      audioSource,
      chunkDurationS: 1,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
      masterAudioEffects,
    });

    expect(applyAudioEffectsOffline).toHaveBeenCalledTimes(1);
    expect(applyAudioEffectsOffline).toHaveBeenCalledWith(
      expect.objectContaining({
        effects: masterAudioEffects,
      }),
    );

    const resultInstance = audioSource.add.mock.calls[0][0];
    const mixedData = resultInstance.data.data;
    expect(mixedData[0]).toBeCloseTo(1.0); // Hard clamped to 1.0 after master effect (sum is 0.5+0.5=1.0, x2 = 2.0, clamped to 1.0)
  });

  it('processes master effects continuously in overlapping blocks across the render', async () => {
    // Regression: master effects used to be re-rendered in a fresh
    // OfflineAudioContext per ~1s output chunk, which reset effect state (gating
    // reverb tails / pumping dynamics) on every boundary. They now run over large
    // overlapping blocks with an equal-power crossfade, like the per-clip path.
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

    // Master effect mock doubles the signal so we can see it was applied.
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
        sourcePath: 'long-clip.mp3',
        speed: 1,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 0,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
    ];

    // delayTime=0.5, feedback=0.5 → estimated tail 1s → overlap 1s, block 10s.
    const masterAudioEffects = [
      {
        id: 'm1',
        type: 'audio-echo',
        enabled: true,
        target: 'audio',
        delayTime: 0.5,
        feedback: 0.5,
      },
    ] as any;

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS,
      audioSource,
      chunkDurationS: 1,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
      masterAudioEffects,
    });

    // The clip has no per-clip effects, so every applyAudioEffectsOffline call is
    // a master block: blocks emit 10s with 1s overlap → blocks at [0,11), [10,21)
    // and a final flush of the remainder = 3 master renders (not 25 per-chunk).
    expect(applyAudioEffectsOffline).toHaveBeenCalledTimes(3);
    expect(applyAudioEffectsOffline).toHaveBeenCalledWith(
      expect.objectContaining({ effects: masterAudioEffects }),
    );

    // Concatenate every emitted sample back into one timeline buffer (mono).
    const totalFrames = durationS * sampleRate;
    const timeline = new Float32Array(totalFrames);
    for (const call of audioSource.add.mock.calls) {
      const params = call[0].data as { data: Float32Array; timestamp: number };
      const startFrame = Math.round(params.timestamp * sampleRate);
      timeline.set(
        params.data.subarray(0, Math.min(params.data.length, totalFrames - startFrame)),
        startFrame,
      );
    }

    // Dry 0.25 → master ×2 = 0.5 everywhere outside the crossfade seams (which
    // sit at the block emit boundaries 10s and 20s). The output is continuous.
    expect(timeline[0]).toBeCloseTo(0.5);
    expect(timeline[5_000]).toBeCloseTo(0.5);
    expect(timeline[15_000]).toBeCloseTo(0.5);
    expect(timeline[24_999]).toBeCloseTo(0.5);
  });

  it('applies adjacent audio crossfades to the exported mix samples', async () => {
    const sampleRate = 1000;
    const numberOfChannels = 1;
    const durationS = 2;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    function constantSink(value: number) {
      const sink = new mockMediabunny.AudioSampleSink();
      sink.samples = vi.fn((startS: number, endS: number) => ({
        [Symbol.asyncIterator]: async function* () {
          const frames = Math.round((endS - startS) * sampleRate);
          yield {
            numberOfFrames: frames,
            sampleRate,
            numberOfChannels,
            timestamp: startS,
            allocationSize: () => frames * 4,
            copyTo: (dst: Float32Array) => dst.fill(value),
          };
        },
      }));
      return sink;
    }

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: 1.5,
        input: new mockMediabunny.Input() as any,
        sink: constantSink(0.5) as any,
        sourcePath: 'outgoing.wav',
        speed: 1,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 0,
        audioFadeOutS: 0.5,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
      {
        clipStartS: 1,
        offsetS: 0,
        playDurationS: 1,
        input: new mockMediabunny.Input() as any,
        sink: constantSink(0.5) as any,
        sourcePath: 'incoming.wav',
        speed: 1,
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
      chunkDurationS: 0.25,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    const timeline = new Float32Array(durationS * sampleRate);
    for (const call of audioSource.add.mock.calls) {
      const params = call[0].data as { data: Float32Array; timestamp: number };
      const startFrame = Math.round(params.timestamp * sampleRate);
      timeline.set(
        params.data.subarray(0, Math.min(params.data.length, timeline.length - startFrame)),
        startFrame,
      );
    }

    expect(timeline[500]).toBeCloseTo(0.5, 4);
    expect(timeline[1000]).toBeCloseTo(0.5, 4);
    expect(timeline[1250]).toBeCloseTo(0.5, 4);
    expect(timeline[1499]).toBeCloseTo(0.5, 3);
    expect(timeline[1750]).toBeCloseTo(0.5, 4);
    expect(Math.max(...Array.from(timeline.subarray(1000, 1500)))).toBeLessThan(0.51);
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
        disconnect: vi.fn(),
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
      disconnect: vi.fn(),
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

describe('AudioMixer fade boundary precision', () => {
  it('drives the last frame to ~0 at the end of fade-out for fractional playDurationS', async () => {
    // playDurationS=1.4995 at sr=1000 gives expectedOutFrames=round(1499.5)=1500
    // while floor(playDurationS*sr)=1499. Without the ceil-bound fix the very
    // last frame (index 1499) would retain baseGain instead of the faded-out
    // tail value, producing a sub-millisecond click at the clip end.
    const sampleRate = 1000;
    const numberOfChannels = 1;
    const playDurationS = 1.4995;
    const fadeOutS = 0.5;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    const totalFrames = Math.round(playDurationS * sampleRate); // 1500
    const customSink = new mockMediabunny.AudioSampleSink();
    customSink.samples = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        const data = new Float32Array(totalFrames).fill(1.0);
        yield {
          numberOfFrames: totalFrames,
          sampleRate,
          numberOfChannels: 1,
          timestamp: 0,
          allocationSize: () => totalFrames * 4,
          copyTo: (dst: Float32Array) => dst.set(data),
        };
      },
    });

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS,
        input: new mockMediabunny.Input() as any,
        sink: customSink as any,
        sourcePath: 'fade-tail.mp3',
        speed: 1,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 0,
        audioFadeOutS: fadeOutS,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
    ];

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS: playDurationS,
      audioSource,
      chunkDurationS: 2,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    const mixedData = audioSource.add.mock.calls[0][0].data.data;
    // Last frame must reflect the trailing fade — gain at t=(N-1)/sr=1.499
    // with fade-out starting at playDurationS - fadeOutS = 0.9995 and curve
    // linear: gain ≈ (1.4995 - 1.499) / 0.5 = 0.001.
    expect(mixedData[totalFrames - 1]).toBeLessThan(0.1);
    // And it must not be left at baseGain (which is what the off-by-one bug
    // produced before the fix).
    expect(mixedData[totalFrames - 1]).not.toBeCloseTo(1.0, 1);
  });

  it('drives the first in-fade boundary frame down for fractional fadeInS', async () => {
    // fadeInS=0.1234 at sr=10000 → floor(fadeInS*sr)=1234. Without the ceil
    // upper bound, frame 1234 (which still satisfies t/sr < fadeInS) would
    // keep baseGain rather than the in-fade ramp value.
    const sampleRate = 10_000;
    const numberOfChannels = 1;
    const playDurationS = 0.5;
    const fadeInS = 0.1234;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    const totalFrames = Math.round(playDurationS * sampleRate); // 5000
    const customSink = new mockMediabunny.AudioSampleSink();
    customSink.samples = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        const data = new Float32Array(totalFrames).fill(1.0);
        yield {
          numberOfFrames: totalFrames,
          sampleRate,
          numberOfChannels: 1,
          timestamp: 0,
          allocationSize: () => totalFrames * 4,
          copyTo: (dst: Float32Array) => dst.set(data),
        };
      },
    });

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS,
        input: new mockMediabunny.Input() as any,
        sink: customSink as any,
        sourcePath: 'fade-head.mp3',
        speed: 1,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: fadeInS,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
    ];

    await AudioMixer.writeMixedToSource({
      prepared,
      durationS: playDurationS,
      audioSource,
      chunkDurationS: 1,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    const mixedData = audioSource.add.mock.calls[0][0].data.data;
    // The boundary frame: floor(fadeInS*sr) = 1234. Time at that frame is
    // 0.1234s == fadeInS, so getGainAtClipTime returns baseGain — that's the
    // intended cross-over point. The frame just before should still be inside
    // the fade ramp (~ 0.9991...).
    const boundaryFrame = Math.floor(fadeInS * sampleRate);
    expect(mixedData[boundaryFrame - 1]).toBeLessThan(1.0);
    expect(mixedData[boundaryFrame - 1]).toBeGreaterThan(0.99);
    // And the very first frame is at gain 0 (start of fade).
    expect(mixedData[0]).toBeCloseTo(0);
  });
});

describe('AudioMixer adjacent clips precision', () => {
  it('correctly aligns adjacent clips on fractional time boundaries without gap/overlap in sample index space', async () => {
    const sampleRate = 48000;
    const numberOfChannels = 1;
    const durationS = 1.0;
    const audioSource = { add: vi.fn().mockResolvedValue(undefined) };

    const customSink1 = new mockMediabunny.AudioSampleSink();
    customSink1.samples = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          numberOfFrames: 5926,
          sampleRate: 48000,
          numberOfChannels: 1,
          timestamp: 0,
          allocationSize: () => 5926 * 4,
          copyTo: (dst: Float32Array) => dst.fill(0.1),
        };
      },
    });

    const customSink2 = new mockMediabunny.AudioSampleSink();
    customSink2.samples = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          numberOfFrames: 42074,
          sampleRate: 48000,
          numberOfChannels: 1,
          timestamp: 0,
          allocationSize: () => 42074 * 4,
          copyTo: (dst: Float32Array) => dst.fill(0.2),
        };
      },
    });

    const prepared: PreparedClip[] = [
      {
        clipStartS: 0,
        offsetS: 0,
        playDurationS: 0.123456,
        input: new mockMediabunny.Input() as any,
        sink: customSink1 as any,
        sourcePath: 'adjacent1.mp3',
        speed: 1,
        audioGain: 1,
        audioBalance: 0,
        audioFadeInS: 0,
        audioFadeOutS: 0,
        audioFadeInCurve: 'linear',
        audioFadeOutCurve: 'linear',
        audioEffects: [],
      },
      {
        clipStartS: 0.123456,
        offsetS: 0,
        playDurationS: 1.0 - 0.123456,
        input: new mockMediabunny.Input() as any,
        sink: customSink2 as any,
        sourcePath: 'adjacent2.mp3',
        speed: 1,
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
      chunkDurationS: 1.0,
      sampleRate,
      numberOfChannels,
      reportExportWarning: vi.fn(),
      AudioSample: mockMediabunny.AudioSample as any,
    });

    expect(audioSource.add).toHaveBeenCalledTimes(1);
    const mixedSample = audioSource.add.mock.calls[0][0];
    const mixedData = mixedSample.data.data;

    for (let i = 0; i < 5926; i++) {
      expect(mixedData[i]).toBeCloseTo(0.1);
    }
    for (let i = 5926; i < 48000; i++) {
      expect(mixedData[i]).toBeCloseTo(0.2);
    }
  });
});
