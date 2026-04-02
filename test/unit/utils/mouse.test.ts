/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { getWheelDelta, isSecondaryWheel } from '~/utils/mouse';

describe('mouse utils', () => {
  describe('isSecondaryWheel', () => {
    it('returns true for horizontal delta > vertical delta', () => {
      const e = { deltaX: 10, deltaY: 2 } as WheelEvent;
      expect(isSecondaryWheel(e)).toBe(true);
    });

    it('returns false for vertical delta > horizontal delta', () => {
      const e = { deltaX: 2, deltaY: 10 } as WheelEvent;
      expect(isSecondaryWheel(e)).toBe(false);
    });

    it('returns true for horizontal only delta', () => {
      const e = { deltaX: 10, deltaY: 0 } as WheelEvent;
      expect(isSecondaryWheel(e)).toBe(true);
    });

    it('returns false for vertical only delta', () => {
      const e = { deltaX: 0, deltaY: 10 } as WheelEvent;
      expect(isSecondaryWheel(e)).toBe(false);
    });
  });

  describe('getWheelDelta', () => {
    it('returns deltaX if secondary wheel', () => {
      const e = { deltaX: 15, deltaY: 0 } as WheelEvent;
      expect(getWheelDelta(e)).toBe(15);
    });

    it('returns deltaY if NOT secondary wheel', () => {
      const e = { deltaX: 0, deltaY: 25 } as WheelEvent;
      expect(getWheelDelta(e)).toBe(25);
    });
  });
});
