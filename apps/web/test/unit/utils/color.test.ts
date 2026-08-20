/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { normalizeHexColor, hexToRgb01, hexToRgbUint } from '~/utils/color';

describe('color', () => {
  describe('normalizeHexColor', () => {
    it('normalizes 3-digit hex to 6-digit', () => {
      expect(normalizeHexColor('#abc')).toBe('#aabbcc');
      expect(normalizeHexColor('ABC')).toBe('#aabbcc');
    });

    it('normalizes 6-digit hex', () => {
      expect(normalizeHexColor('#aabbcc')).toBe('#aabbcc');
      expect(normalizeHexColor('aabbcc')).toBe('#aabbcc');
    });

    it('returns fallback for invalid values', () => {
      expect(normalizeHexColor('invalid', '#ffffff')).toBe('#ffffff');
      expect(normalizeHexColor(undefined, '#ffffff')).toBe('#ffffff');
    });
  });

  describe('hexToRgb01', () => {
    it('converts hex to linear rgb', () => {
      expect(hexToRgb01('#ffffff')).toEqual([1, 1, 1]);
      expect(hexToRgb01('#000000')).toEqual([0, 0, 0]);
      expect(hexToRgb01('#ff0000')).toEqual([1, 0, 0]);
      expect(hexToRgb01('#00ff00')).toEqual([0, 1, 0]);
      expect(hexToRgb01('#0000ff')).toEqual([0, 0, 1]);
    });

    it('returns fallback for invalid values', () => {
      expect(hexToRgb01('invalid', '#ffffff')).toEqual([1, 1, 1]);
    });
  });

  describe('hexToRgbUint', () => {
    it('converts hex to integer', () => {
      expect(hexToRgbUint('#ffffff')).toBe(0xffffff);
      expect(hexToRgbUint('#000000')).toBe(0);
      expect(hexToRgbUint('#ff0000')).toBe(0xff0000);
    });

    it('returns fallback for invalid values', () => {
      expect(hexToRgbUint('invalid', '#ffffff')).toBe(0xffffff);
    });
  });
});
