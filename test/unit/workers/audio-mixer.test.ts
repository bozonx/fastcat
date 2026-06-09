// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  interleavedToPlanar,
  normalizeSampleChannels,
  getStereoPanMatrix,
  trimOrPadPlanes,
  slicePlanes,
  mixProcessedChunk,
  pullNextProcessedChunk,
  getProcessedChunkForFrame,
  buildGainEnvelope,
} from '~/workers/core/AudioMixer';

describe('interleavedToPlanar', () => {
  it('converts interleaved stereo to planar', () => {
    const interleaved = new Float32Array([0, 1, 2, 3]);
    const planar = interleavedToPlanar({ interleaved, frames: 2, numberOfChannels: 2 });
    expect(planar).toEqual(new Float32Array([0, 2, 1, 3]));
  });

  it('reuses planarOut when provided', () => {
    const interleaved = new Float32Array([0, 1, 2, 3]);
    const planarOut = new Float32Array(4);
    const result = interleavedToPlanar({ interleaved, frames: 2, numberOfChannels: 2, planarOut });
    expect(result).toBe(planarOut);
  });
});

describe('normalizeSampleChannels', () => {
  it('returns same channels when count matches', () => {
    const planes = [new Float32Array([1, 2]), new Float32Array([3, 4])];
    const result = normalizeSampleChannels({
      planes,
      sourceChannels: 2,
      targetChannels: 2,
      frames: 2,
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(planes[0]);
  });

  it('duplicates mono to stereo', () => {
    const planes = [new Float32Array([1, 2])];
    const result = normalizeSampleChannels({
      planes,
      sourceChannels: 1,
      targetChannels: 2,
      frames: 2,
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(new Float32Array([1, 2]));
    expect(result[1]).toEqual(new Float32Array([1, 2]));
  });

  it('mixes stereo to mono', () => {
    const planes = [new Float32Array([2, 4]), new Float32Array([4, 6])];
    const result = normalizeSampleChannels({
      planes,
      sourceChannels: 2,
      targetChannels: 1,
      frames: 2,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(new Float32Array([3, 5]));
  });
});

describe('getStereoPanMatrix', () => {
  it('returns identity at center balance', () => {
    const m = getStereoPanMatrix(0);
    expect(m.ll).toBeCloseTo(1);
    expect(m.rr).toBeCloseTo(1);
    expect(m.lr).toBeCloseTo(0);
    expect(m.rl).toBeCloseTo(0);
  });

  it('fades left channel when panned left', () => {
    const m = getStereoPanMatrix(-1);
    expect(m.ll).toBeCloseTo(1);
    expect(m.rr).toBeCloseTo(0);
  });

  it('fades right channel when panned right', () => {
    const m = getStereoPanMatrix(1);
    expect(m.ll).toBeCloseTo(0);
    expect(m.rr).toBeCloseTo(1);
  });
});

describe('trimOrPadPlanes', () => {
  it('trims planes to requested length', () => {
    const planes = [new Float32Array([1, 2, 3, 4])];
    const result = trimOrPadPlanes({ planes, channels: 1, frames: 2 });
    expect(result[0]).toEqual(new Float32Array([1, 2]));
  });

  it('pads planes with silence', () => {
    const planes = [new Float32Array([1, 2])];
    const result = trimOrPadPlanes({ planes, channels: 1, frames: 4 });
    expect(result[0]).toEqual(new Float32Array([1, 2, 0, 0]));
  });
});

describe('slicePlanes', () => {
  it('slices planes at offset', () => {
    const planes = [new Float32Array([1, 2, 3, 4])];
    const result = slicePlanes({ planes, startFrame: 1, frames: 2, channels: 1 });
    expect(result[0]).toEqual(new Float32Array([2, 3]));
  });
});

describe('mixProcessedChunk', () => {
  it('mixes mono chunk into interleaved buffer', () => {
    const mixed = new Float32Array(4);
    mixed.fill(0);
    const processed = {
      startFrame: 0,
      planes: [new Float32Array([1, 2])],
      frames: 2,
      gainEnvelope: new Float32Array([1, 1]),
      audioBalance: 0,
    };

    const end = mixProcessedChunk({
      processed,
      sourceStartFrame: 0,
      sourceEndFrame: 2,
      writeStartFrame: 0,
      mixedInterleaved: mixed,
      numberOfChannels: 1,
    });

    expect(end).toBe(2);
    expect(mixed[0]).toBe(1);
    expect(mixed[1]).toBe(2);
  });

  it('mixes stereo chunk with pan matrix', () => {
    const mixed = new Float32Array(8);
    mixed.fill(0);
    const processed = {
      startFrame: 0,
      planes: [new Float32Array([1, 2]), new Float32Array([3, 4])],
      frames: 2,
      gainEnvelope: new Float32Array([1, 1]),
      audioBalance: 0,
    };

    mixProcessedChunk({
      processed,
      sourceStartFrame: 0,
      sourceEndFrame: 2,
      writeStartFrame: 1,
      mixedInterleaved: mixed,
      numberOfChannels: 2,
    });

    // writeStartFrame=1 means first frame goes to mixed[2] and mixed[3]
    expect(mixed[2]).not.toBe(0);
    expect(mixed[3]).not.toBe(0);
  });

  it('skips writing when no overlap', () => {
    const mixed = new Float32Array(4);
    mixed.fill(0);
    const processed = {
      startFrame: 10,
      planes: [new Float32Array([1, 2])],
      frames: 2,
      gainEnvelope: new Float32Array([1, 1]),
      audioBalance: 0,
    };

    const end = mixProcessedChunk({
      processed,
      sourceStartFrame: 0,
      sourceEndFrame: 5,
      writeStartFrame: 0,
      mixedInterleaved: mixed,
      numberOfChannels: 1,
    });

    expect(end).toBe(5);
    expect(mixed[0]).toBe(0);
  });
});

describe('pullNextProcessedChunk', () => {
  it('updates active.current with next value', async () => {
    const active = {
      iterator: {
        next: vi.fn().mockResolvedValue({ value: { startFrame: 0, frames: 10 }, done: false }),
      },
      current: null,
      done: false,
    };

    const result = await pullNextProcessedChunk(
      active as unknown as Parameters<typeof pullNextProcessedChunk>[0],
    );
    expect(result).toEqual({ startFrame: 0, frames: 10 });
    expect(active.current).toEqual({ startFrame: 0, frames: 10 });
  });

  it('marks active as done when iterator exhausted', async () => {
    const active = {
      iterator: {
        next: vi.fn().mockResolvedValue({ done: true }),
      },
      current: null,
      done: false,
    };

    const result = await pullNextProcessedChunk(
      active as unknown as Parameters<typeof pullNextProcessedChunk>[0],
    );
    expect(result).toBeNull();
    expect(active.done).toBe(true);
  });
});

describe('getProcessedChunkForFrame', () => {
  it('returns current chunk if it covers frame', async () => {
    const chunk = { startFrame: 0, frames: 10 };
    const active = {
      iterator: { next: vi.fn() },
      current: chunk,
      done: false,
    };

    const result = await getProcessedChunkForFrame(
      active as unknown as Parameters<typeof getProcessedChunkForFrame>[0],
      5,
    );
    expect(result).toBe(chunk);
    expect(active.iterator.next).not.toHaveBeenCalled();
  });

  it('pulls next chunks until frame is covered', async () => {
    const chunk2 = { startFrame: 10, frames: 10 };
    const active = {
      iterator: {
        next: vi.fn().mockResolvedValue({ value: chunk2, done: false }),
      },
      current: { startFrame: 0, frames: 10 },
      done: false,
    };

    const result = await getProcessedChunkForFrame(
      active as unknown as Parameters<typeof getProcessedChunkForFrame>[0],
      15,
    );
    expect(result).toBe(chunk2);
  });
});

describe('buildGainEnvelope', () => {
  it('fills with baseGain when no fades are specified', () => {
    const clip = {
      playDurationS: 5,
      audioGain: 0.8,
      audioFadeInS: 0,
      audioFadeOutS: 0,
      audioFadeInCurve: 'linear',
      audioFadeOutCurve: 'linear',
    };

    const envelope = buildGainEnvelope({
      frames: 10,
      startFrame: 0,
      targetSampleRate: 10,
      clip: clip as any,
    });

    expect(envelope).toEqual(new Float32Array([0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]));
  });

  it('calculates linear fade-in and fade-out envelopes correctly', () => {
    const clip = {
      playDurationS: 5,
      audioGain: 1.0,
      audioFadeInS: 2.0, // 20 frames at 10Hz
      audioFadeOutS: 2.0, // 20 frames at the end
      audioFadeInCurve: 'linear',
      audioFadeOutCurve: 'linear',
    };

    // Total 50 frames in clip. We test the first 25 frames
    const envelope = buildGainEnvelope({
      frames: 25,
      startFrame: 0,
      targetSampleRate: 10,
      clip: clip as any,
    });

    expect(envelope[0]).toBeCloseTo(0.0);
    expect(envelope[10]).toBeCloseTo(0.5);
    expect(envelope[20]).toBeCloseTo(1.0);
    expect(envelope[24]).toBeCloseTo(1.0);
  });
});
