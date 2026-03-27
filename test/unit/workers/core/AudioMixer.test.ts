import { describe, it, expect } from 'vitest';

import { interleavedToPlanar, normalizeSampleChannels } from '~/workers/core/AudioMixer';

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
