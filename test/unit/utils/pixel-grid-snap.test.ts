import { describe, expect, it } from 'vitest';
import {
  isTransformSnapSafe,
  snapRectToPixelGrid,
  snapStrokeToPixelGrid,
  snapTextOriginToPixelGrid,
} from '~/utils/pixel-grid-snap';

describe('pixel-grid-snap', () => {
  describe('isTransformSnapSafe', () => {
    it('returns true when transform is undefined or default axis-aligned', () => {
      expect(isTransformSnapSafe(undefined)).toBe(true);
      expect(
        isTransformSnapSafe({
          rotationDeg: 0,
          scale: { x: 1, y: 1 },
        }),
      ).toBe(true);
      expect(
        isTransformSnapSafe({
          rotationDeg: 360,
          scale: { x: 1, y: 1 },
        }),
      ).toBe(true);
    });

    it('returns false when transform is rotated', () => {
      expect(
        isTransformSnapSafe({
          rotationDeg: 45,
          scale: { x: 1, y: 1 },
        }),
      ).toBe(false);
      expect(
        isTransformSnapSafe({
          rotationDeg: 0.5,
          scale: { x: 1, y: 1 },
        }),
      ).toBe(false);
    });

    it('returns false when transform scale is non-1', () => {
      expect(
        isTransformSnapSafe({
          rotationDeg: 0,
          scale: { x: 1.5, y: 1 },
        }),
      ).toBe(false);
      expect(
        isTransformSnapSafe({
          rotationDeg: 0,
          scale: { x: 1, y: 0.8 },
        }),
      ).toBe(false);
    });
  });

  describe('snapRectToPixelGrid', () => {
    it('snaps fractional coordinates and dimensions to integers', () => {
      const input = { x: 10.4, y: 20.6, width: 100.3, height: 200.7 };
      const snapped = snapRectToPixelGrid(input);

      expect(snapped).toEqual({
        x: 10,
        y: 21,
        width: 100,
        height: 201,
      });
    });

    it('does not mutate the original input object', () => {
      const input = Object.freeze({ x: 10.4, y: 20.6, width: 100.3, height: 200.7 });
      const snapped = snapRectToPixelGrid(input);

      expect(input.x).toBe(10.4);
      expect(snapped.x).toBe(10);
    });
  });

  describe('snapStrokeToPixelGrid', () => {
    it('calculates 0.5 offset for 1px odd border width', () => {
      const input = { x: 10.2, y: 20.7, width: 100.4, height: 50.1, borderWidth: 1.2 };
      const result = snapStrokeToPixelGrid(input);

      expect(result.borderWidth).toBe(1);
      expect(result.offset).toBe(0.5);
      expect(result.strokeX).toBe(10.5);
      expect(result.strokeY).toBe(21.5);
      expect(result.strokeWidth).toBe(100);
      expect(result.strokeHeight).toBe(50);
    });

    it('calculates 0 offset for 2px even border width', () => {
      const input = { x: 10.2, y: 20.7, width: 100.4, height: 50.1, borderWidth: 2.1 };
      const result = snapStrokeToPixelGrid(input);

      expect(result.borderWidth).toBe(2);
      expect(result.offset).toBe(0);
      expect(result.strokeX).toBe(10);
      expect(result.strokeY).toBe(21);
      expect(result.strokeWidth).toBe(100);
      expect(result.strokeHeight).toBe(50);
    });

    it('calculates 0.5 offset for 3px odd border width', () => {
      const input = { x: 15.3, y: 25.4, width: 80.2, height: 40.8, borderWidth: 3.0 };
      const result = snapStrokeToPixelGrid(input);

      expect(result.borderWidth).toBe(3);
      expect(result.offset).toBe(0.5);
      expect(result.strokeX).toBe(15.5);
      expect(result.strokeY).toBe(25.5);
    });

    it('does not mutate the original input object', () => {
      const input = Object.freeze({ x: 10.2, y: 20.7, width: 100.4, height: 50.1, borderWidth: 1 });
      const result = snapStrokeToPixelGrid(input);

      expect(input.x).toBe(10.2);
      expect(result.strokeX).toBe(10.5);
    });
  });

  describe('snapTextOriginToPixelGrid', () => {
    it('rounds text origin coordinates to integer pixels', () => {
      const origin = { x: 12.3, y: 45.8 };
      const snapped = snapTextOriginToPixelGrid(origin);

      expect(snapped).toEqual({ x: 12, y: 46 });
    });

    it('does not mutate original object', () => {
      const origin = Object.freeze({ x: 12.3, y: 45.8 });
      const snapped = snapTextOriginToPixelGrid(origin);

      expect(origin.x).toBe(12.3);
      expect(snapped.x).toBe(12);
    });
  });
});
