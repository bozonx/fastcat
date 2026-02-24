import { describe, it, expect } from 'vitest';

import { interleavedToPlanar } from '../../../../src/workers/core/AudioMixer';

describe('AudioMixer interleavedToPlanar', () => {
  it('converts stereo interleaved to planar', () => {
    const interleaved = new Float32Array([
      1, 10, // frame 0: L, R
      2, 20, // frame 1
      3, 30, // frame 2
    ]);

    const planar = interleavedToPlanar({ interleaved, frames: 3, numberOfChannels: 2 });

    expect(Array.from(planar)).toEqual([
      1,
      2,
      3,
      10,
      20,
      30,
    ]);
  });

  it('converts mono interleaved to planar (no-op layout change)', () => {
    const interleaved = new Float32Array([5, 6, 7]);
    const planar = interleavedToPlanar({ interleaved, frames: 3, numberOfChannels: 1 });
    expect(Array.from(planar)).toEqual([5, 6, 7]);
  });
});
