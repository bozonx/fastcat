import { describe, it, expect } from 'vitest';
import { clamp } from '~/utils/math';

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
});
