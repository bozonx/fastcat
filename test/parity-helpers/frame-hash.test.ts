/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  computeFrameHash,
  hammingDistance,
  DEFAULT_TOLERANCE,
  TEXT_SCENE_TOLERANCE,
} from '../../integration/engine-parity/helpers/frame-hash';

function makeRgba(
  width: number,
  height: number,
  fill: [number, number, number, number],
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = fill[0];
    rgba[i * 4 + 1] = fill[1];
    rgba[i * 4 + 2] = fill[2];
    rgba[i * 4 + 3] = fill[3];
  }
  return rgba;
}

function makeCheckerboard(
  width: number,
  height: number,
  a: [number, number, number, number],
  b: [number, number, number, number],
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fill = (x + y) % 2 === 0 ? a : b;
      const i = (y * width + x) * 4;
      rgba[i] = fill[0];
      rgba[i + 1] = fill[1];
      rgba[i + 2] = fill[2];
      rgba[i + 3] = fill[3];
    }
  }
  return rgba;
}

describe('frame-hash', () => {
  it('returns all-zeros hash for uniform frames', () => {
    // Uniform frames have every cell equal to the mean, so no bit is set.
    expect(computeFrameHash(makeRgba(8, 8, [255, 255, 255, 255]), 8, 8)).toBe('0000000000000000');
    expect(computeFrameHash(makeRgba(8, 8, [0, 0, 0, 255]), 8, 8)).toBe('0000000000000000');
    expect(computeFrameHash(makeRgba(8, 8, [128, 64, 32, 255]), 8, 8)).toBe('0000000000000000');
  });

  it('produces a stable 16-character hex hash for a non-uniform frame', () => {
    const rgba = makeCheckerboard(16, 16, [255, 255, 255, 255], [0, 0, 0, 255]);
    const hash = computeFrameHash(rgba, 16, 16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).toBe(computeFrameHash(rgba, 16, 16));
  });

  it('produces different hashes for visually different frames', () => {
    const a = makeCheckerboard(16, 16, [255, 255, 255, 255], [0, 0, 0, 255]);
    const b = makeCheckerboard(16, 16, [255, 0, 0, 255], [0, 0, 255, 255]);
    expect(computeFrameHash(a, 16, 16)).not.toBe(computeFrameHash(b, 16, 16));
  });

  describe('hammingDistance', () => {
    it('returns 0 for identical hashes', () => {
      expect(hammingDistance('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
    });

    it('returns 64 for bitwise-inverted hashes', () => {
      expect(hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
    });

    it('counts single-bit differences', () => {
      expect(hammingDistance('0000000000000001', '0000000000000000')).toBe(1);
      expect(hammingDistance('0000000000000001', '0000000000000002')).toBe(2);
    });
  });

  describe('tolerance constants', () => {
    it('exposes a default tolerance of 10', () => {
      expect(DEFAULT_TOLERANCE).toBe(10);
    });

    it('exposes a wider text-scene tolerance', () => {
      expect(TEXT_SCENE_TOLERANCE).toBe(18);
      expect(TEXT_SCENE_TOLERANCE).toBeGreaterThan(DEFAULT_TOLERANCE);
    });
  });
});
