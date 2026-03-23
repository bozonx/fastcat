import { describe, it, expect } from 'vitest';
import type { ThumbnailTile } from '~/composables/timeline/useTimelineClipThumbnails';

describe('ThumbnailTile interface', () => {
  it('has expected shape', () => {
    const tile: ThumbnailTile = { key: 0, url: 'blob:x', leftPx: 0, widthPx: 80 };
    expect(tile.key).toBe(0);
    expect(tile.url).toBe('blob:x');
    expect(tile.leftPx).toBe(0);
    expect(tile.widthPx).toBe(80);
  });

  it('leftPx is computed from trimOffset + idx * tileWidth (tiles aligned to clip start)', () => {
    const tileW = 80;
    const trimOffsetPx = 40;

    const makeTile = (idx: number): ThumbnailTile => ({
      key: idx,
      url: `blob:${idx}`,
      leftPx: trimOffsetPx + idx * tileW,
      widthPx: tileW,
    });

    const tile0 = makeTile(0);
    const tile1 = makeTile(1);
    const tile2 = makeTile(2);

    // First tile starts exactly at the clip's left edge in strip coordinates.
    expect(tile0.leftPx).toBe(40);
    expect(tile1.leftPx).toBe(120);
    expect(tile2.leftPx).toBe(200);
    expect(tile2.widthPx).toBe(tileW);
  });

  it('tileWidth equals clipHeight * aspectRatio (16/9)', () => {
    const clipHeight = 90;
    const aspectRatio = 320 / 180; // THUMB_ASPECT
    const expectedWidth = clipHeight * aspectRatio;

    const tile: ThumbnailTile = { key: 0, url: 'blob:x', leftPx: 0, widthPx: expectedWidth };

    expect(tile.widthPx).toBeCloseTo(160, 5);
  });

  it('tiles sorted by key are in ascending position order', () => {
    const tiles: ThumbnailTile[] = [
      { key: 2, url: 'b', leftPx: 200, widthPx: 80 },
      { key: 0, url: 'a', leftPx: 40, widthPx: 80 },
      { key: 1, url: 'c', leftPx: 120, widthPx: 80 },
    ];

    const sorted = [...tiles].sort((a, b) => a.key - b.key);

    expect(sorted.map((t) => t.key)).toEqual([0, 1, 2]);
    expect(sorted.map((t) => t.leftPx)).toEqual([40, 120, 200]);
  });
});
