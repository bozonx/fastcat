/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import {
  computeSvgRasterSize,
  isSvgFile,
  isSvgFilename,
  isSvgMimeType,
  parseSvgDimensions,
} from '~/utils/svg';

describe('parseSvgDimensions', () => {
  it('uses width/height when present', () => {
    const svg = `<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg"></svg>`;
    expect(parseSvgDimensions(svg)).toEqual({ width: 320, height: 240 });
  });

  it('parses viewBox when width/height are missing', () => {
    const svg = `<svg viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg"></svg>`;
    expect(parseSvgDimensions(svg)).toEqual({ width: 1920, height: 1080 });
  });

  it('falls back when nothing is available', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
    expect(parseSvgDimensions(svg)).toEqual({ width: 800, height: 600 });
  });
});

describe('computeSvgRasterSize', () => {
  it('scales up to fit maxWidth/maxHeight while preserving aspect ratio', () => {
    expect(
      computeSvgRasterSize({
        intrinsic: { width: 100, height: 50 },
        maxWidth: 1920,
        maxHeight: 1080,
      }),
    ).toEqual({ width: 1920, height: 960 });
  });

  it('scales down to fit maxWidth/maxHeight while preserving aspect ratio', () => {
    expect(
      computeSvgRasterSize({
        intrinsic: { width: 4000, height: 2000 },
        maxWidth: 1920,
        maxHeight: 1080,
      }),
    ).toEqual({ width: 1920, height: 960 });
  });
});

describe('isSvgMimeType', () => {
  it('detects svg mime type', () => {
    expect(isSvgMimeType('image/svg+xml')).toBe(true);
    expect(isSvgMimeType('image/png')).toBe(false);
    expect(isSvgMimeType(null)).toBe(false);
  });
});

describe('isSvgFilename', () => {
  it('detects svg filename', () => {
    expect(isSvgFilename('icon.svg')).toBe(true);
    expect(isSvgFilename('icon.png')).toBe(false);
    expect(isSvgFilename(null)).toBe(false);
  });
});

describe('isSvgFile', () => {
  it('detects svg from file or path', () => {
    expect(isSvgFile({ file: { name: 'icon.svg' } })).toBe(true);
    expect(isSvgFile({ path: 'icon.svg' })).toBe(true);
    expect(isSvgFile({})).toBe(false);
  });
});
