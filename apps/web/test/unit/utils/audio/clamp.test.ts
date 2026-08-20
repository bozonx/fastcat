/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { clampAudioParam, clampGain } from '~/utils/audio/clamp';

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

describe('clampGain', () => {
  it('passes through in-range gains', () => {
    expect(clampGain(0)).toBe(0);
    expect(clampGain(1)).toBe(1);
    expect(clampGain(2)).toBe(2);
  });

  it('clamps to the shared [0, 2] range', () => {
    expect(clampGain(-5)).toBe(0);
    expect(clampGain(15)).toBe(2);
  });

  it('falls back to unity gain for non-finite input', () => {
    expect(clampGain(NaN)).toBe(1);
    expect(clampGain(undefined)).toBe(1);
    expect(clampGain(null)).toBe(1);
    expect(clampGain('loud')).toBe(1);
  });
});
