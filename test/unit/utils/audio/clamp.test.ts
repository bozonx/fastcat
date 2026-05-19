/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { clampAudioParam } from '~/utils/audio/clamp';

describe('clampAudioParam', () => {
  it('clamps valid numbers within range', () => {
    expect(clampAudioParam(5, 0, 10, 5)).toBe(5);
    expect(clampAudioParam(0, 0, 10, 5)).toBe(0);
    expect(clampAudioParam(10, 0, 10, 5)).toBe(10);
  });

  it('clamps out-of-range values', () => {
    expect(clampAudioParam(-5, 0, 10, 5)).toBe(0);
    expect(clampAudioParam(15, 0, 10, 5)).toBe(10);
  });

  it('returns default for non-number input', () => {
    expect(clampAudioParam(undefined, 0, 10, 5)).toBe(5);
    expect(clampAudioParam(null, 0, 10, 5)).toBe(5);
    expect(clampAudioParam('text', 0, 10, 5)).toBe(5);
    expect(clampAudioParam(NaN, 0, 10, 5)).toBe(5);
  });
});
