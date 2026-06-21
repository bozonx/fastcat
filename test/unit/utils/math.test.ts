/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { clamp, clampInt, clampFinite, clampPositive, clampNumber } from '~/utils/math';

describe('math', () => {
  describe('clamp', () => {
    it('returns the value if within bounds', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });

    it('returns the min if value is below min', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('returns the max if value is above max', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });
  });

  describe('clampInt', () => {
    it('rounds and clamps to integers', () => {
      expect(clampInt(4.4, 0, 10)).toBe(4);
      expect(clampInt(4.6, 0, 10)).toBe(5);
      expect(clampInt(-1, 0, 10)).toBe(0);
      expect(clampInt(11, 0, 10)).toBe(10);
      expect(clampInt(Number.NaN, 0, 10)).toBe(0);
    });

    it('returns min when max < min', () => {
      expect(clampInt(5, 10, 0)).toBe(10);
    });
  });

  describe('clampFinite', () => {
    it('returns the value if finite number', () => {
      expect(clampFinite(5, 0)).toBe(5);
      expect(clampFinite(-5, 0)).toBe(-5);
    });

    it('returns fallback for non-numbers or non-finite', () => {
      expect(clampFinite(undefined, 0)).toBe(0);
      expect(clampFinite(Number.NaN, 0)).toBe(0);
      expect(clampFinite('5', 0)).toBe(0);
    });
  });

  describe('clampPositive', () => {
    it('returns positive finite values', () => {
      expect(clampPositive(5, 1)).toBe(5);
      expect(clampPositive(0.5, 1)).toBe(0.5);
    });

    it('returns fallback for non-positive or non-finite', () => {
      expect(clampPositive(0, 1)).toBe(1);
      expect(clampPositive(-5, 1)).toBe(1);
      expect(clampPositive(Number.NaN, 1)).toBe(1);
    });
  });

  describe('clampNumber', () => {
    it('returns clamped value for finite numbers', () => {
      expect(clampNumber(5, 0, 10)).toBe(5);
      expect(clampNumber(-1, 0, 10)).toBe(0);
      expect(clampNumber(11, 0, 10)).toBe(10);
    });

    it('returns undefined for invalid inputs', () => {
      expect(clampNumber(undefined, 0, 10)).toBeUndefined();
      expect(clampNumber(Number.NaN, 0, 10)).toBeUndefined();
      expect(clampNumber(5, Number.NaN, 10)).toBeUndefined();
      expect(clampNumber(5, 10, 0)).toBeUndefined();
    });
  });
});
