import { describe, it, expect } from 'vitest';
import {
  clampNumber,
  normalizeGain,
  normalizeBalance,
  mergeGain,
  mergeBalance,
  computeFadeDurationsSeconds,
  getGainAtClipTime,
} from '~/utils/audio/envelope';

describe('audio/envelope', () => {
  describe('clampNumber', () => {
    it('clamps correctly', () => {
      expect(clampNumber(5, 0, 10)).toBe(5);
      expect(clampNumber(-5, 0, 10)).toBe(0);
      expect(clampNumber(15, 0, 10)).toBe(10);
    });

    it('returns undefined for invalid inputs', () => {
      expect(clampNumber(null, 0, 10)).toBeUndefined();
      expect(clampNumber('5', 0, 10)).toBeUndefined();
      expect(clampNumber(5, 10, 0)).toBeUndefined(); // min > max
      expect(clampNumber(NaN, 0, 10)).toBeUndefined();
    });
  });

  describe('normalizeGain', () => {
    it('normalizes to 0-10 range', () => {
      expect(normalizeGain(5)).toBe(5);
      expect(normalizeGain(15)).toBe(10);
      expect(normalizeGain(-5)).toBe(0);
    });

    it('uses fallback on invalid input', () => {
      expect(normalizeGain(null, 2)).toBe(2);
      expect(normalizeGain(undefined)).toBe(1); // default fallback
    });
  });

  describe('normalizeBalance', () => {
    it('normalizes to -1 to 1 range', () => {
      expect(normalizeBalance(0.5)).toBe(0.5);
      expect(normalizeBalance(1.5)).toBe(1);
      expect(normalizeBalance(-1.5)).toBe(-1);
    });

    it('uses fallback on invalid input', () => {
      expect(normalizeBalance(null, -0.5)).toBe(-0.5);
      expect(normalizeBalance(undefined)).toBe(0); // default fallback
    });
  });

  describe('mergeGain', () => {
    it('multiplies and clamps gains', () => {
      expect(mergeGain(2, 3)).toBe(6);
      expect(mergeGain(5, 5)).toBe(10); // clamped to 10
      expect(mergeGain(2, undefined)).toBe(2); // undefined acts as 1
    });

    it('returns undefined if both are invalid', () => {
      expect(mergeGain(null, undefined)).toBeUndefined();
    });
  });

  describe('mergeBalance', () => {
    it('adds and clamps balances', () => {
      expect(mergeBalance(0.5, 0.2)).toBe(0.7);
      expect(mergeBalance(0.8, 0.8)).toBe(1); // clamped to 1
      expect(mergeBalance(-0.8, -0.8)).toBe(-1); // clamped to -1
      expect(mergeBalance(0.5, undefined)).toBe(0.5); // undefined acts as 0
    });

    it('returns undefined if both are invalid', () => {
      expect(mergeBalance(null, undefined)).toBeUndefined();
    });
  });

  describe('computeFadeDurationsSeconds', () => {
    it('computes basic fades', () => {
      const res = computeFadeDurationsSeconds({
        clipDurationS: 10,
        fadeInUs: 2_000_000,
        fadeOutUs: 3_000_000,
      });
      expect(res).toEqual({ fadeInS: 2, fadeOutS: 3 });
    });

    it('clamps fades to clip duration', () => {
      const res = computeFadeDurationsSeconds({
        clipDurationS: 4,
        fadeInUs: 5_000_000,
        fadeOutUs: 5_000_000,
      });
      expect(res).toEqual({ fadeInS: 4, fadeOutS: 4 });
    });

    it('handles missing or invalid inputs gracefully', () => {
      const res = computeFadeDurationsSeconds({
        clipDurationS: -5,
        fadeInUs: null,
      });
      expect(res).toEqual({ fadeInS: 0, fadeOutS: 0 });
    });
  });

  describe('getGainAtClipTime', () => {
    it('returns base gain outside fade regions', () => {
      expect(
        getGainAtClipTime({
          clipDurationS: 10,
          fadeInS: 2,
          fadeOutS: 2,
          baseGain: 1,
          tClipS: 5,
        })
      ).toBe(1);
    });

    it('interpolates fade in', () => {
      expect(
        getGainAtClipTime({
          clipDurationS: 10,
          fadeInS: 2,
          fadeOutS: 2,
          baseGain: 1,
          tClipS: 1,
        })
      ).toBe(0.5);
    });

    it('interpolates fade out', () => {
      expect(
        getGainAtClipTime({
          clipDurationS: 10,
          fadeInS: 2,
          fadeOutS: 2,
          baseGain: 1,
          tClipS: 9,
        })
      ).toBe(0.5);
    });

    it('clamps time out of bounds', () => {
      expect(
        getGainAtClipTime({
          clipDurationS: 10,
          fadeInS: 2,
          fadeOutS: 2,
          baseGain: 1,
          tClipS: 15,
        })
      ).toBe(0);

      expect(
        getGainAtClipTime({
          clipDurationS: 10,
          fadeInS: 2,
          fadeOutS: 2,
          baseGain: 1,
          tClipS: -5,
        })
      ).toBe(0);
    });
  });
});
