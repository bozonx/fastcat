import { describe, it, expect } from 'vitest';

import {
  buildTrackRuntimeList,
  buildPrevClipByIdIndex,
  buildNextClipByIdIndex,
  normalizeTrackOpacity,
} from '~/utils/video-editor/compositor/trackRuntime';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

const toVideoEffects = (v: unknown) => (Array.isArray(v) ? v : undefined);

describe('normalizeTrackOpacity', () => {
  it('returns undefined for non-numbers', () => {
    expect(normalizeTrackOpacity('abc')).toBeUndefined();
    expect(normalizeTrackOpacity(null)).toBeUndefined();
    expect(normalizeTrackOpacity(undefined)).toBeUndefined();
    expect(normalizeTrackOpacity(NaN)).toBeUndefined();
    expect(normalizeTrackOpacity(Infinity)).toBeUndefined();
  });

  it('clamps to [0, 1]', () => {
    expect(normalizeTrackOpacity(-0.5)).toBe(0);
    expect(normalizeTrackOpacity(1.5)).toBe(1);
    expect(normalizeTrackOpacity(0.5)).toBe(0.5);
  });
});

describe('buildTrackRuntimeList', () => {
  it('builds explicit tracks from track items', () => {
    const items = [
      { kind: 'track', id: 't1', layer: 0, opacity: 0.5, blendMode: 'normal' },
      { kind: 'track', id: 't2', layer: 1, opacity: 1, blendMode: 'add' },
    ];
    const result = buildTrackRuntimeList(items, toVideoEffects);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('t1');
    expect(result[0]!.layer).toBe(0);
    expect(result[0]!.opacity).toBe(0.5);
    expect(result[1]!.id).toBe('t2');
    expect(result[1]!.blendMode).toBe('add');
  });

  it('infers tracks from clip layers not covered by explicit tracks', () => {
    const items = [
      { kind: 'track', id: 't1', layer: 0 },
      { kind: 'clip', layer: 1 },
      { kind: 'clip', layer: 2 },
    ];
    const result = buildTrackRuntimeList(items, toVideoEffects);
    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe('t1');
    expect(result[0]!.layer).toBe(0);
    expect(result[1]!.id).toBe('track_1');
    expect(result[1]!.layer).toBe(1);
    expect(result[2]!.id).toBe('track_2');
    expect(result[2]!.layer).toBe(2);
  });

  it('does not infer tracks for layers already covered by explicit tracks', () => {
    const items = [
      { kind: 'track', id: 't1', layer: 0 },
      { kind: 'clip', layer: 0 },
    ];
    const result = buildTrackRuntimeList(items, toVideoEffects);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('t1');
  });

  it('generates fallback id when track has no id', () => {
    const items = [{ kind: 'track', layer: 3 }];
    const result = buildTrackRuntimeList(items, toVideoEffects);
    expect(result[0]!.id).toBe('track_3');
  });

  it('sorts by layer ascending', () => {
    const items = [
      { kind: 'track', id: 't2', layer: 5 },
      { kind: 'track', id: 't1', layer: 1 },
      { kind: 'track', id: 't3', layer: 3 },
    ];
    const result = buildTrackRuntimeList(items, toVideoEffects);
    expect(result.map((t: { layer: number }) => t.layer)).toEqual([1, 3, 5]);
  });

  it('handles empty input', () => {
    expect(buildTrackRuntimeList([], toVideoEffects)).toEqual([]);
  });
});

describe('buildPrevClipByIdIndex', () => {
  function makeClip(itemId: string, layer: number, startUs: number, endUs: number): CompositorClip {
    return { itemId, layer, startUs, endUs } as unknown as CompositorClip;
  }

  it('returns null for the first clip on each layer', () => {
    const clips = [makeClip('a', 0, 0, 100), makeClip('b', 0, 100, 200)];
    const result = buildPrevClipByIdIndex(clips);
    expect(result.get('a')).toBeNull();
  });

  it('returns the previous clip for subsequent clips', () => {
    const clips = [
      makeClip('a', 0, 0, 100),
      makeClip('b', 0, 100, 200),
      makeClip('c', 0, 200, 300),
    ];
    const result = buildPrevClipByIdIndex(clips);
    expect(result.get('b')).toBe(clips[0]);
    expect(result.get('c')).toBe(clips[1]);
  });

  it('handles multiple layers independently', () => {
    const clips = [
      makeClip('a1', 0, 0, 100),
      makeClip('b1', 1, 0, 100),
      makeClip('a2', 0, 100, 200),
      makeClip('b2', 1, 100, 200),
    ];
    const result = buildPrevClipByIdIndex(clips);
    expect(result.get('a1')).toBeNull();
    expect(result.get('b1')).toBeNull();
    expect(result.get('a2')).toBe(clips[0]);
    expect(result.get('b2')).toBe(clips[1]);
  });

  it('sorts by startUs then endUs then itemId', () => {
    const clips = [makeClip('z', 0, 0, 100), makeClip('a', 0, 0, 50), makeClip('m', 0, 0, 50)];
    const result = buildPrevClipByIdIndex(clips);
    // Sorted: a (0,50), m (0,50), z (0,100)
    expect(result.get('z')!.itemId).toBe('m');
    expect(result.get('m')!.itemId).toBe('a');
    expect(result.get('a')).toBeNull();
  });
});

describe('buildNextClipByIdIndex', () => {
  function makeClip(itemId: string, layer: number, startUs: number, endUs: number): CompositorClip {
    return { itemId, layer, startUs, endUs } as unknown as CompositorClip;
  }

  it('returns null for the last clip on each layer', () => {
    const clips = [makeClip('a', 0, 0, 100), makeClip('b', 0, 100, 200)];
    const result = buildNextClipByIdIndex(clips);
    expect(result.get('b')).toBeNull();
  });

  it('returns the next clip for preceding clips', () => {
    const clips = [
      makeClip('a', 0, 0, 100),
      makeClip('b', 0, 100, 200),
      makeClip('c', 0, 200, 300),
    ];
    const result = buildNextClipByIdIndex(clips);
    expect(result.get('a')).toBe(clips[1]);
    expect(result.get('b')).toBe(clips[2]);
  });

  it('handles empty clips array', () => {
    expect(buildNextClipByIdIndex([]).size).toBe(0);
  });
});
