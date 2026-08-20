/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { copyPlanarSampleToChannelBuffers } from '~/workers/audio-decode.worker';

function createSample(values: number[], timestamp: number) {
  const source = new Float32Array(values);

  return {
    numberOfFrames: source.length,
    timestamp,
    allocationSize: () => source.byteLength,
    copyTo: (dst: Float32Array) => {
      dst.set(source.subarray(0, dst.length));
    },
  };
}

describe('audio-decode.worker', () => {
  it('skips decoded frames that start before the requested range', () => {
    const output = new Float32Array(4);
    const copied = copyPlanarSampleToChannelBuffers({
      sample: createSample([1, 2, 3, 4], 0.998),
      planes: [output],
      decodeStartS: 1,
      sampleRate: 1000,
      numberOfChannels: 1,
    });

    expect(copied).toBe(2);
    expect([...output]).toEqual([3, 4, 0, 0]);
  });

  it('writes in-range samples at their timestamp offset', () => {
    const output = new Float32Array(4);
    const copied = copyPlanarSampleToChannelBuffers({
      sample: createSample([1, 2], 1.002),
      planes: [output],
      decodeStartS: 1,
      sampleRate: 1000,
      numberOfChannels: 1,
    });

    expect(copied).toBe(2);
    expect([...output]).toEqual([0, 0, 1, 2]);
  });
});
