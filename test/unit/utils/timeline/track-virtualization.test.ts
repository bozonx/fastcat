import { describe, expect, it } from 'vitest';
import {
  buildClipRenderMemo,
  lowerBound,
  upperBound,
  buildTrackVisibilityIndex,
  selectVisibleItems,
  type ItemGeometry,
} from '~/utils/timeline/track-virtualization';

function item(id: string, startUs: number, durationUs: number, kind = 'clip'): any {
  return { id, kind, timelineRange: { startUs, durationUs } };
}

function geo(startPx: number, widthPx: number): ItemGeometry {
  return { startPx, widthPx, endPx: startPx + widthPx };
}

describe('lowerBound / upperBound', () => {
  const values = [0, 10, 10, 20, 30];

  it('lowerBound returns the first index >= target', () => {
    expect(lowerBound(values, 10)).toBe(1);
    expect(lowerBound(values, 25)).toBe(4);
    expect(lowerBound(values, -5)).toBe(0);
    expect(lowerBound(values, 100)).toBe(5);
  });

  it('upperBound returns the first index > target', () => {
    expect(upperBound(values, 10)).toBe(3);
    expect(upperBound(values, 0)).toBe(1);
    expect(upperBound(values, 100)).toBe(5);
  });
});

describe('buildClipRenderMemo', () => {
  it('encodes only id + range for non-clip items', () => {
    expect(buildClipRenderMemo(item('g1', 5, 2, 'gap'))).toBe('g1:5:2');
  });

  it('changes when a rendered clip property changes', () => {
    const base = { ...item('c1', 0, 1000), name: 'A', locked: false };
    const memoA = buildClipRenderMemo(base as any);
    const memoLocked = buildClipRenderMemo({ ...base, locked: true } as any);
    const memoRenamed = buildClipRenderMemo({ ...base, name: 'B' } as any);
    expect(memoA).not.toBe(memoLocked);
    expect(memoA).not.toBe(memoRenamed);
  });

  it('is stable for identical clips', () => {
    const a = { ...item('c1', 0, 1000), name: 'A' };
    const b = { ...item('c1', 0, 1000), name: 'A' };
    expect(buildClipRenderMemo(a as any)).toBe(buildClipRenderMemo(b as any));
  });

  it('changes when audio presence flips (async metadata load)', () => {
    const base = { ...item('c1', 0, 1000), name: 'A' };
    const withoutAudio = buildClipRenderMemo(base as any, false);
    const withAudio = buildClipRenderMemo(base as any, true);
    expect(withoutAudio).not.toBe(withAudio);
    // Omitting the flag is treated as "no audio yet" (backwards compatible).
    expect(buildClipRenderMemo(base as any)).toBe(withoutAudio);
  });
});

describe('buildTrackVisibilityIndex', () => {
  it('marks sorted tracks and builds ascending prefix-max-end positions', () => {
    const items = [item('a', 0, 10), item('b', 20, 10), item('c', 40, 10)];
    const geos = new Map<string, ItemGeometry>([
      ['a', geo(0, 10)],
      ['b', geo(20, 10)],
      ['c', geo(40, 10)],
    ]);
    const index = buildTrackVisibilityIndex(items, geos);
    expect(index.isSortedByStart).toBe(true);
    expect(index.startPositions).toEqual([0, 20, 40]);
    expect(index.prefixMaxEndPositions).toEqual([10, 30, 50]);
  });

  it('flags unsorted tracks (start positions out of order)', () => {
    const items = [item('a', 40, 10), item('b', 0, 10)];
    const geos = new Map<string, ItemGeometry>([
      ['a', geo(40, 10)],
      ['b', geo(0, 10)],
    ]);
    expect(buildTrackVisibilityIndex(items, geos).isSortedByStart).toBe(false);
  });

  it('flags as unsorted when geometry is missing', () => {
    const items = [item('a', 0, 10)];
    expect(buildTrackVisibilityIndex(items, new Map()).isSortedByStart).toBe(false);
  });
});

describe('selectVisibleItems', () => {
  const items = [item('a', 0, 10), item('b', 20, 10), item('c', 40, 10)];
  const geos = new Map<string, ItemGeometry>([
    ['a', geo(0, 10)],
    ['b', geo(20, 10)],
    ['c', geo(40, 10)],
  ]);

  it('returns all items when the viewport end is Infinity', () => {
    expect(
      selectVisibleItems({
        items,
        geometries: geos,
        index: undefined,
        visibleStartPx: 0,
        visibleEndPx: Infinity,
      }),
    ).toBe(items);
  });

  it('binary-search windows a sorted track', () => {
    const index = buildTrackVisibilityIndex(items, geos);
    const visible = selectVisibleItems({
      items,
      geometries: geos,
      index,
      visibleStartPx: 25,
      visibleEndPx: 45,
    });
    expect(visible.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('keeps a long clip that overlaps the window even when it starts before it', () => {
    const overlapItems = [item('big', 0, 100), item('left', 5, 5), item('mid', 60, 10)];
    const overlapGeos = new Map<string, ItemGeometry>([
      ['big', geo(0, 100)],
      ['left', geo(5, 5)],
      ['mid', geo(60, 10)],
    ]);
    const index = buildTrackVisibilityIndex(overlapItems, overlapGeos);
    const visible = selectVisibleItems({
      items: overlapItems,
      geometries: overlapGeos,
      index,
      visibleStartPx: 55,
      visibleEndPx: 75,
    });
    expect(visible.map((i) => i.id)).toContain('big');
    expect(visible.map((i) => i.id)).toContain('mid');
  });

  it('falls back to a linear filter for unsorted tracks', () => {
    const unsorted = [item('c', 40, 10), item('a', 0, 10), item('b', 20, 10)];
    const unsortedGeos = new Map<string, ItemGeometry>([
      ['c', geo(40, 10)],
      ['a', geo(0, 10)],
      ['b', geo(20, 10)],
    ]);
    const index = buildTrackVisibilityIndex(unsorted, unsortedGeos);
    expect(index.isSortedByStart).toBe(false);
    const visible = selectVisibleItems({
      items: unsorted,
      geometries: unsortedGeos,
      index,
      visibleStartPx: 15,
      visibleEndPx: 35,
    });
    expect(visible.map((i) => i.id)).toEqual(['b']);
  });
});
