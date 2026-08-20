import { describe, expect, it } from 'vitest';

import { fitDimensions } from '~/media-processor/media-processor.utils';

describe('fitDimensions', () => {
  it('downscales a landscape scene to fit the max box while preserving aspect', () => {
    // 1920x1080 into 320x320 → limited by width (320/1920).
    expect(fitDimensions(1920, 1080, 320, 320)).toEqual({ width: 320, height: 180 });
  });

  it('downscales a portrait scene limited by height', () => {
    // 1080x1920 into 320x320 → limited by height (320/1920).
    expect(fitDimensions(1080, 1920, 320, 320)).toEqual({ width: 180, height: 320 });
  });

  it('never upscales a scene smaller than the max box', () => {
    expect(fitDimensions(160, 90, 320, 320)).toEqual({ width: 160, height: 90 });
  });

  it('falls back to a 16:9 ratio for degenerate dimensions', () => {
    expect(fitDimensions(0, 0, 320, 320)).toEqual({ width: 16, height: 9 });
  });
});
