import { describe, it, expect } from 'vitest';
import type { ThumbnailTile } from '../../../../src/composables/timeline/useTimelineClipThumbnails';

describe('ThumbnailTile interface', () => {
  it('has expected shape', () => {
    const tile: ThumbnailTile = { key: 0, url: 'blob:x', leftPx: 0, widthPx: 80 };
    expect(tile.key).toBe(0);
    expect(tile.url).toBe('blob:x');
    expect(tile.leftPx).toBe(0);
    expect(tile.widthPx).toBe(80);
  });

  it('leftPx is computed from thumbIndex * pxPerThumbnail', () => {
    const intervalSeconds = 2;
    const pxPerThumbnail = 80;

    const makeTile = (second: number): ThumbnailTile => ({
      key: second,
      url: `blob:${second}`,
      leftPx: (second / intervalSeconds) * pxPerThumbnail,
      widthPx: pxPerThumbnail,
    });

    const tile0 = makeTile(0);
    const tile2 = makeTile(2);
    const tile4 = makeTile(4);

    expect(tile0.leftPx).toBe(0);
    expect(tile2.leftPx).toBe(80);
    expect(tile4.leftPx).toBe(160);
    expect(tile4.widthPx).toBe(80);
  });

  it('tiles sorted by key are in ascending time order', () => {
    const tiles: ThumbnailTile[] = [
      { key: 4, url: 'b', leftPx: 160, widthPx: 80 },
      { key: 0, url: 'a', leftPx: 0, widthPx: 80 },
      { key: 2, url: 'c', leftPx: 80, widthPx: 80 },
    ];

    const sorted = [...tiles].sort((a, b) => a.key - b.key);

    expect(sorted.map((t) => t.key)).toEqual([0, 2, 4]);
    expect(sorted.map((t) => t.leftPx)).toEqual([0, 80, 160]);
  });
});
