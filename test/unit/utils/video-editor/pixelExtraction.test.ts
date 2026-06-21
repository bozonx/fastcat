import { describe, expect, it } from 'vitest';

import { getExtractedPixelBytes } from '~/utils/video-editor/compositor/pixelExtraction';

describe('getExtractedPixelBytes', () => {
  it('reads the Pixi 8 extracted pixels result', () => {
    const source = new Uint8ClampedArray([10, 20, 30, 255]);

    expect(
      getExtractedPixelBytes({
        pixels: source,
        width: 1,
        height: 1,
      }),
    ).toEqual(new Uint8Array([10, 20, 30, 255]));
  });

  it('keeps compatibility with a direct typed array', () => {
    const source = new Uint8Array([1, 2, 3, 4]);

    expect(getExtractedPixelBytes(source)).toEqual(source);
  });

  it('returns an empty array for an invalid extraction result', () => {
    expect(getExtractedPixelBytes(null)).toHaveLength(0);
  });
});
