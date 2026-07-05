/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  addKeyframeMoment,
  animatedParamPaths,
  applyKeyframeMoment,
  clearParamAnimation,
  collectKeyframeTimes,
  extractKeyframeMoment,
  getStaticParamValue,
  hasKeyframeMomentAt,
  moveKeyframe,
  moveKeyframeMoment,
  removeKeyframe,
  removeKeyframeMoment,
  setKeyframeMomentEasing,
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

  it('setKeyframeMomentEasing updates every param keyframe at that time only', () => {
    const changed = setKeyframeMomentEasing(twoParamAnimations(), 100, 'ease');
    expect(changed?.opacity?.keyframes).toEqual([
      { tUs: 100, value: 0.5, easing: 'ease' },
      { tUs: 500, value: 1, easing: 'linear' },
    ]);
    expect(changed?.['transform.rotationDeg']?.keyframes).toEqual([
      { tUs: 100, value: 45, easing: 'ease' },
    ]);
  });
});

describe('animatedParamPaths', () => {
  it('returns only paths that have keyframes, sorted', () => {
    let anims: ClipAnimations | undefined = upsertKeyframe(undefined, 'transform.scale.x', 0, 1);
    anims = upsertKeyframe(anims, 'opacity', 0, 1);
    expect(animatedParamPaths(anims)).toEqual(['opacity', 'transform.scale.x']);
  });

  it('includes dynamic effect-param paths (not just the fixed set)', () => {
    const anims = upsertKeyframe(undefined, 'effect.fx1.intensity' as never, 0, 0.5);
    expect(animatedParamPaths(anims)).toEqual(['effect.fx1.intensity']);
  });

  it('is empty for undefined', () => {
    expect(animatedParamPaths(undefined)).toEqual([]);
  });
});

describe('hasKeyframeMomentAt', () => {
  it('detects a keyframe at the rounded time on any animated param', () => {
    let anims: ClipAnimations | undefined = upsertKeyframe(undefined, 'opacity', 500, 1);
    anims = upsertKeyframe(anims, 'transform.rotationDeg', 1000, 90);
    expect(hasKeyframeMomentAt(anims, 500)).toBe(true);
    expect(hasKeyframeMomentAt(anims, 1000)).toBe(true);
    expect(hasKeyframeMomentAt(anims, 750)).toBe(false);
    expect(hasKeyframeMomentAt(undefined, 0)).toBe(false);
  });
});

describe('addKeyframeMoment', () => {
  it('adds an interpolated keyframe on every animated param without changing motion', () => {
    let anims: ClipAnimations | undefined = upsertKeyframe(undefined, 'opacity', 0, 0);
    anims = upsertKeyframe(anims, 'opacity', 1000, 1); // linear 0→1
    anims = upsertKeyframe(anims, 'transform.position.x', 0, 100);
    anims = upsertKeyframe(anims, 'transform.position.x', 1000, 300); // linear 100→300

    const next = addKeyframeMoment(anims, 500);
    // opacity midpoint = 0.5, position.x midpoint = 200
    const op = next?.opacity?.keyframes.find((k) => k.tUs === 500);
    const px = next?.['transform.position.x']?.keyframes.find((k) => k.tUs === 500);
    expect(op?.value).toBeCloseTo(0.5);
    expect(px?.value).toBeCloseTo(200);
  });

  it('is a no-op when nothing is animated', () => {
    expect(addKeyframeMoment(undefined, 500)).toBeUndefined();
  });
});

describe('extractKeyframeMoment / applyKeyframeMoment', () => {
  it('captures value+easing of every param at a time and pastes them elsewhere', () => {
    let anims: ClipAnimations | undefined = upsertKeyframe(undefined, 'opacity', 200, 0.3, 'ease');
    anims = upsertKeyframe(anims, 'transform.rotationDeg', 200, 45, 'hold');
    anims = upsertKeyframe(anims, 'opacity', 999, 1); // unrelated keyframe

    const moment = extractKeyframeMoment(anims, 200);
    expect(moment?.entries).toEqual([
      { path: 'opacity', value: 0.3, easing: 'ease' },
      { path: 'transform.rotationDeg', value: 45, easing: 'hold' },
    ]);

    const pasted = applyKeyframeMoment(anims, moment!, 700);
    expect(pasted?.opacity?.keyframes.find((k) => k.tUs === 700)).toEqual({
      tUs: 700,
      value: 0.3,
      easing: 'ease',
    });
    expect(pasted?.['transform.rotationDeg']?.keyframes.find((k) => k.tUs === 700)).toEqual({
      tUs: 700,
      value: 45,
      easing: 'hold',
    });
  });

  it('returns null when there is no keyframe at the time', () => {
    const anims = upsertKeyframe(undefined, 'opacity', 200, 0.3);
    expect(extractKeyframeMoment(anims, 500)).toBeNull();
    expect(extractKeyframeMoment(undefined, 0)).toBeNull();
  });

  it('paste creates a track for a param that was not previously animated', () => {
    const moment = {
      entries: [{ path: 'opacity' as const, value: 0.5, easing: 'linear' as const }],
    };
    const pasted = applyKeyframeMoment(undefined, moment, 100);
    expect(pasted?.opacity?.keyframes).toEqual([{ tUs: 100, value: 0.5, easing: 'linear' }]);
  });
});
