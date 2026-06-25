/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  isSvgMimeType,
  isSvgFilename,
  isSvgFile,
  parseSvgDimensions,
  computeSvgRasterSize,
} from '~/utils/svg';

describe('svg utils', () => {
  describe('isSvgMimeType', () => {
    it('returns true for image/svg+xml', () => {
      expect(isSvgMimeType('image/svg+xml')).toBe(true);
      expect(isSvgMimeType('IMAGE/SVG+XML')).toBe(true);
      expect(isSvgMimeType('  image/svg+xml  ')).toBe(true);
    });

    it('returns false for non-svg mime types', () => {
      expect(isSvgMimeType('image/png')).toBe(false);
      expect(isSvgMimeType(null)).toBe(false);
      expect(isSvgMimeType(undefined)).toBe(false);
      expect(isSvgMimeType('')).toBe(false);
    });
  });

  describe('isSvgFilename', () => {
    it('returns true for .svg files', () => {
      expect(isSvgFilename('icon.svg')).toBe(true);
      expect(isSvgFilename('ICON.SVG')).toBe(true);
      expect(isSvgFilename('  icon.svg  ')).toBe(true);
    });

    it('returns false for non-svg files', () => {
      expect(isSvgFilename('icon.png')).toBe(false);
      expect(isSvgFilename(null)).toBe(false);
      expect(isSvgFilename(undefined)).toBe(false);
    });
  });

  describe('isSvgFile', () => {
    it('checks file name', () => {
      expect(isSvgFile({ file: { name: 'logo.svg' } })).toBe(true);
      expect(isSvgFile({ file: { name: 'logo.png' } })).toBe(false);
    });

    it('checks path', () => {
      expect(isSvgFile({ path: '/assets/logo.svg' })).toBe(true);
      expect(isSvgFile({ path: '/assets/logo.png' })).toBe(false);
    });

    it('returns true if either file name or path matches', () => {
      expect(isSvgFile({ file: { name: 'logo.svg' }, path: '/assets/logo.png' })).toBe(true);
      expect(isSvgFile({ file: { name: 'logo.png' }, path: '/assets/logo.svg' })).toBe(true);
    });

    it('returns false when neither matches', () => {
      expect(isSvgFile({ file: { name: 'logo.png' }, path: '/assets/logo.png' })).toBe(false);
      expect(isSvgFile({})).toBe(false);
    });
  });

  describe('parseSvgDimensions', () => {
    it('parses width and height attributes', () => {
      const svg = '<svg width="200" height="100"></svg>';
      expect(parseSvgDimensions(svg)).toEqual({ width: 200, height: 100 });
    });

    it('parses viewBox when width/height missing', () => {
      const svg = '<svg viewBox="0 0 400 300"></svg>';
      expect(parseSvgDimensions(svg)).toEqual({ width: 400, height: 300 });
    });

    it('returns fallback for empty input', () => {
      expect(parseSvgDimensions('')).toEqual({ width: 800, height: 600 });
    });

    it('returns fallback for non-svg string', () => {
      expect(parseSvgDimensions('not an svg')).toEqual({ width: 800, height: 600 });
    });

    it('parses units (px, in, cm, mm, pt, pc)', () => {
      expect(parseSvgDimensions('<svg width="1in" height="72pt"></svg>')).toEqual({
        width: 96,
        height: 96,
      });
    });

    it('uses regex fallback in non-DOM environment', () => {
      // In node environment, DOMParser is undefined, so regex path is used
      const svg = '<svg width="150" height="75"></svg>';
      expect(parseSvgDimensions(svg)).toEqual({ width: 150, height: 75 });
    });
  });

  describe('computeSvgRasterSize', () => {
    it('returns intrinsic size when no max constraints', () => {
      expect(computeSvgRasterSize({ intrinsic: { width: 400, height: 300 } })).toEqual({
        width: 400,
        height: 300,
      });
    });

    it('scales to maxWidth preserving aspect ratio', () => {
      const result = computeSvgRasterSize({
        intrinsic: { width: 800, height: 400 },
        maxWidth: 200,
      });
      expect(result.width).toBe(200);
      expect(result.height).toBe(100);
    });

    it('scales to maxHeight preserving aspect ratio', () => {
      const result = computeSvgRasterSize({
        intrinsic: { width: 800, height: 400 },
        maxHeight: 100,
      });
      expect(result.width).toBe(200);
      expect(result.height).toBe(100);
    });

    it('scales to the more restrictive constraint', () => {
      const result = computeSvgRasterSize({
        intrinsic: { width: 800, height: 400 },
        maxWidth: 400,
        maxHeight: 50,
      });
      expect(result.height).toBe(50);
      expect(result.width).toBe(100);
    });

    it('caps at MAX_DIMENSION (8192)', () => {
      const result = computeSvgRasterSize({
        intrinsic: { width: 10000, height: 10000 },
      });
      expect(result.width).toBe(8192);
      expect(result.height).toBe(8192);
    });

    it('handles invalid intrinsic dimensions', () => {
      const result = computeSvgRasterSize({
        intrinsic: { width: 0, height: 0 },
      });
      expect(result.width).toBeGreaterThanOrEqual(1);
      expect(result.height).toBeGreaterThanOrEqual(1);
    });
  });
});
