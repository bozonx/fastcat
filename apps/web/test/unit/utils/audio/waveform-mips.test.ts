import { describe, expect, it, beforeEach } from 'vitest';

import { computeWaveformPeakBins } from '~/utils/audio/waveform';
import {
  getPeakMips,
  selectMipLevel,
  computeWaveformPeakBinsFromMips,
  __resetPeakMipsCacheForTests,
} from '~/utils/audio/waveform-mips';

function ramp(length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (i % 100) / 100;
  return out;
}

describe('waveform mip pyramid', () => {
  beforeEach(() => {
    __resetPeakMipsCacheForTests();
  });

  it('builds peak-preserving halving levels down to the floor', () => {
    const channels = [ramp(4096)];
    const mips = getPeakMips(channels);

    expect(mips.baseLength).toBe(4096);
    expect(mips.levels[0]![0]!.length).toBe(4096);
    // Each level halves the previous length.
    for (let k = 1; k < mips.levels.length; k++) {
      expect(mips.levels[k]![0]!.length).toBe(mips.levels[k - 1]![0]!.length >> 1);
    }
    // Smallest level should not go below the 256 floor.
    expect(mips.levels[mips.levels.length - 1]![0]!.length).toBeGreaterThanOrEqual(128);
  });

  it('downsample never loses a peak (max of pairs)', () => {
    // Short arrays (<= floor) keep only level 0, so use one long enough to halve.
    const channel = new Float32Array(512);
    channel[301] = 1.0; // isolated spike inside pair index 150
    const mips = getPeakMips([channel]);
    const level1 = mips.levels[1]![0]!;
    expect(level1.length).toBe(256);
    expect(level1[150]).toBeCloseTo(1.0);
    expect(level1[149]).toBeCloseTo(0);
  });

  it('keeps odd trailing samples and signed peaks while downsampling', () => {
    const channel = new Float32Array(513);
    channel[511] = -0.9;
    channel[512] = -1.0;

    const mips = getPeakMips([channel]);
    const level1 = mips.levels[1]![0]!;

    expect(level1.length).toBe(257);
    expect(level1[255]).toBeCloseTo(0.9);
    expect(level1[256]).toBeCloseTo(1.0);
  });

  it('memoizes by channels identity', () => {
    const channels = [ramp(1024)];
    expect(getPeakMips(channels)).toBe(getPeakMips(channels));
  });

  it('selectMipLevel picks floor(log2(samplesPerBin)) within range', () => {
    const mips = getPeakMips([ramp(4096)]);
    expect(selectMipLevel(mips, 1)).toBe(0);
    expect(selectMipLevel(mips, 1.5)).toBe(0);
    expect(selectMipLevel(mips, 2)).toBe(1);
    expect(selectMipLevel(mips, 7)).toBe(2);
    expect(selectMipLevel(mips, 8)).toBe(3);
    // Clamps to the deepest available level.
    expect(selectMipLevel(mips, 1e9)).toBe(mips.levels.length - 1);
  });

  it('matches the naive binner closely while touching far fewer samples', () => {
    const channels = [ramp(40_000)];
    const outputBins = 200;

    const naive = computeWaveformPeakBins({
      channels,
      startIndex: 0,
      endIndex: 40_000,
      outputBins,
      gain: 1,
    });
    const mipped = computeWaveformPeakBinsFromMips({
      channels,
      startIndex: 0,
      endIndex: 40_000,
      outputBins,
      gain: 1,
    });

    expect(mipped.length).toBe(naive.length);
    // The pyramid pre-maxes pairs over a region that always covers (and may
    // slightly over-cover) the naive bin's region, so values track the naive
    // binner closely — never wildly off.
    for (let i = 0; i < naive.length; i++) {
      expect(Math.abs(mipped[i]! - naive[i]!)).toBeLessThanOrEqual(0.2);
    }
  });

  it('applies gain unclamped at level 0 (samplesPerBin <= 1), matching the naive binner', () => {
    const channels = [new Float32Array([0.2, 0.4, 0.6, 0.8])];
    const args = { channels, startIndex: 0, endIndex: 4, outputBins: 4, gain: 2 } as const;
    const mipped = computeWaveformPeakBinsFromMips(args);
    const naive = computeWaveformPeakBins(args);
    // outputBins === sourceLength → level 0, one sample per bin; gain is not
    // clamped here (the canvas draw step clamps to 1).
    expect(Array.from(mipped)).toEqual(Array.from(naive));
    [0.4, 0.8, 1.2, 1.6].forEach((expected, i) => expect(mipped[i]!).toBeCloseTo(expected, 5));
  });

  it('returns empty for empty input or degenerate ranges', () => {
    expect(
      computeWaveformPeakBinsFromMips({ channels: [], startIndex: 0, endIndex: 0, outputBins: 10 })
        .length,
    ).toBe(0);
    expect(
      computeWaveformPeakBinsFromMips({
        channels: [ramp(100)],
        startIndex: 50,
        endIndex: 50,
        outputBins: 10,
      }).length,
    ).toBe(0);
  });
});
