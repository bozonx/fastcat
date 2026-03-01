import { describe, it, expect } from 'vitest';
import {
  computeChunks,
  computeThumbsPerChunk,
} from '../../../../src/composables/timeline/useTimelineClipThumbnails';

describe('useTimelineClipThumbnails helpers', () => {
  it('computeThumbsPerChunk clamps to [8..120] and has fallback', () => {
    expect(computeThumbsPerChunk(NaN)).toBe(20);
    expect(computeThumbsPerChunk(0)).toBe(20);

    expect(computeThumbsPerChunk(10000)).toBe(8);
    expect(computeThumbsPerChunk(1)).toBe(120);
  });

  it('computeChunks returns empty for images and invalid params', () => {
    expect(
      computeChunks({
        isImage: true,
        totalThumbs: 10,
        thumbsPerChunk: 20,
        pxPerThumbnail: 10,
      }),
    ).toEqual([]);

    expect(
      computeChunks({
        isImage: false,
        totalThumbs: 0,
        thumbsPerChunk: 20,
        pxPerThumbnail: 10,
      }),
    ).toEqual([]);
  });

  it('computeChunks splits into chunks with correct widths', () => {
    const chunks = computeChunks({
      isImage: false,
      totalThumbs: 25,
      thumbsPerChunk: 10,
      pxPerThumbnail: 5,
    });

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({
      chunkIndex: 0,
      startThumbIndex: 0,
      endThumbIndex: 10,
      thumbsCount: 10,
      widthPx: 50,
    });
    expect(chunks[2]).toEqual({
      chunkIndex: 2,
      startThumbIndex: 20,
      endThumbIndex: 25,
      thumbsCount: 5,
      widthPx: 25,
    });
  });
});
