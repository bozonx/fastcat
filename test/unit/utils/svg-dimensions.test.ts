import { describe, expect, it } from 'vitest';

import { parseSvgDimensions } from '~/utils/svg';

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
