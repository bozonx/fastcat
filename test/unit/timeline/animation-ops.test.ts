/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  clearParamAnimation,
  collectKeyframeTimes,
  getStaticParamValue,
  moveKeyframe,
  moveKeyframeMoment,
  removeKeyframe,
  removeKeyframeMoment,
  upsertKeyframe,
} from '~/timeline/animation/ops';
import type { ClipAnimations } from '~/timeline/types';

describe('upsertKeyframe', () => {
  it('creates a new track for a path with none', () => {
    const next = upsertKeyframe(undefined, 'opacity', 100, 0.5);
    expect(next.opacity?.keyframes).toEqual([{ tUs: 100, value: 0.5, easing: 'linear' }]);
  });

  it('replaces an existing keyframe at the same rounded time', () => {
    const first = upsertKeyframe(undefined, 'opacity', 100, 0.5);
    const second = upsertKeyframe(first, 'opacity', 100.4, 0.9, 'hold');
    expect(second.opacity?.keyframes).toEqual([{ tUs: 100, value: 0.9, easing: 'hold' }]);
  });

  it('leaves other paths untouched', () => {
    const withRotation = upsertKeyframe(undefined, 'transform.rotationDeg', 0, 90);
    const next = upsertKeyframe(withRotation, 'opacity', 0, 1);
    expect(next['transform.rotationDeg']?.keyframes).toEqual([
      { tUs: 0, value: 90, easing: 'linear' },
    ]);
    expect(next.opacity?.keyframes).toEqual([{ tUs: 0, value: 1, easing: 'linear' }]);
  });
});

describe('removeKeyframe', () => {
  it('drops the path when its last keyframe is removed', () => {
    const withOne = upsertKeyframe(undefined, 'opacity', 100, 0.5);
    const next = removeKeyframe(withOne, 'opacity', 100);
    expect(next).toBeUndefined();
  });

  it('returns undefined only once every path is empty', () => {
    let anims: ClipAnimations | undefined = upsertKeyframe(undefined, 'opacity', 0, 1);
    anims = upsertKeyframe(anims, 'transform.rotationDeg', 0, 45);
    const afterOpacity = removeKeyframe(anims, 'opacity', 0);
    expect(afterOpacity).toBeDefined();
    expect(afterOpacity?.opacity).toBeUndefined();
    expect(afterOpacity?.['transform.rotationDeg']).toBeDefined();

    const afterBoth = removeKeyframe(afterOpacity, 'transform.rotationDeg', 0);
    expect(afterBoth).toBeUndefined();
  });

  it('is a no-op when no keyframe exists at that time', () => {
    const withOne = upsertKeyframe(undefined, 'opacity', 100, 0.5);
    const next = removeKeyframe(withOne, 'opacity', 999);
    expect(next).toBe(withOne);
  });
});

describe('moveKeyframe', () => {
  it('moves a keyframe, preserving its value and easing', () => {
    const withOne = upsertKeyframe(undefined, 'opacity', 100, 0.5, 'ease');
    const moved = moveKeyframe(withOne, 'opacity', 100, 500);
    expect(moved?.opacity?.keyframes).toEqual([{ tUs: 500, value: 0.5, easing: 'ease' }]);
  });

  it('is a no-op when there is no keyframe at fromTUs', () => {
    const withOne = upsertKeyframe(undefined, 'opacity', 100, 0.5);
    const moved = moveKeyframe(withOne, 'opacity', 999, 500);
    expect(moved).toBe(withOne);
  });

  it('is a no-op when moving to the same time', () => {
    const withOne = upsertKeyframe(undefined, 'opacity', 100, 0.5);
    const moved = moveKeyframe(withOne, 'opacity', 100, 100);
    expect(moved).toBe(withOne);
  });
});

describe('clearParamAnimation', () => {
  it('removes only the given path, dropping animations entirely if it was the only one', () => {
    const withOne = upsertKeyframe(undefined, 'opacity', 100, 0.5);
    expect(clearParamAnimation(withOne, 'opacity')).toBeUndefined();
  });

  it('keeps other animated paths', () => {
    let anims: ClipAnimations | undefined = upsertKeyframe(undefined, 'opacity', 0, 1);
    anims = upsertKeyframe(anims, 'transform.rotationDeg', 0, 45);
    const next = clearParamAnimation(anims, 'opacity');
    expect(next?.opacity).toBeUndefined();
    expect(next?.['transform.rotationDeg']).toBeDefined();
  });
});

describe('getStaticParamValue', () => {
  it('falls back to the documented defaults', () => {
    expect(getStaticParamValue({}, 'opacity')).toBe(1);
    expect(getStaticParamValue({}, 'transform.scale.x')).toBe(1);
    expect(getStaticParamValue({}, 'transform.position.x')).toBe(0);
    expect(getStaticParamValue({}, 'transform.rotationDeg')).toBe(0);
  });

  it('reads the clip current values when present', () => {
    const clip = {
      opacity: 0.4,
      transform: { position: { x: 10, y: 20 }, scale: { x: 2, y: 3 }, rotationDeg: 45 },
    };
    expect(getStaticParamValue(clip, 'opacity')).toBe(0.4);
    expect(getStaticParamValue(clip, 'transform.position.x')).toBe(10);
    expect(getStaticParamValue(clip, 'transform.position.y')).toBe(20);
    expect(getStaticParamValue(clip, 'transform.scale.x')).toBe(2);
    expect(getStaticParamValue(clip, 'transform.scale.y')).toBe(3);
    expect(getStaticParamValue(clip, 'transform.rotationDeg')).toBe(45);
  });
});

describe('keyframe "moment" ops (unified lane)', () => {
  function twoParamAnimations(): ClipAnimations {
    let anims: ClipAnimations | undefined = upsertKeyframe(undefined, 'opacity', 100, 0.5);
    anims = upsertKeyframe(anims, 'transform.rotationDeg', 100, 45);
    anims = upsertKeyframe(anims, 'opacity', 500, 1);
    return anims!;
  }

  it('collectKeyframeTimes returns every distinct time, ascending, deduped', () => {
    expect(collectKeyframeTimes(twoParamAnimations())).toEqual([100, 500]);
    expect(collectKeyframeTimes(undefined)).toEqual([]);
  });

  it('moveKeyframeMoment moves every param that has a keyframe at that time', () => {
    const moved = moveKeyframeMoment(twoParamAnimations(), 100, 300);
    expect(moved?.opacity?.keyframes.map((k) => k.tUs)).toEqual([300, 500]);
    expect(moved?.['transform.rotationDeg']?.keyframes.map((k) => k.tUs)).toEqual([300]);
  });

  it('removeKeyframeMoment removes every param keyframe at that time only', () => {
    const removed = removeKeyframeMoment(twoParamAnimations(), 100);
    expect(removed?.['transform.rotationDeg']).toBeUndefined();
    expect(removed?.opacity?.keyframes.map((k) => k.tUs)).toEqual([500]);
  });

  it('removeKeyframeMoment can clear all animations when it was the last moment', () => {
    let anims: ClipAnimations | undefined = upsertKeyframe(undefined, 'opacity', 100, 0.5);
    anims = upsertKeyframe(anims, 'transform.rotationDeg', 100, 45);
    expect(removeKeyframeMoment(anims, 100)).toBeUndefined();
  });
});
