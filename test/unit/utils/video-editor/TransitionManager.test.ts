/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

import { TransitionManager } from '~/utils/video-editor/compositor/TransitionManager';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeClip(overrides: Partial<CompositorClip> = {}): CompositorClip {
  return {
    itemId: 'clip-1',
    startUs: 0,
    endUs: 1_000_000,
    durationUs: 1_000_000,
    layer: 0,
    sprite: null,
    imageSource: {} as any,
    lastVideoFrame: null,
    canvas: null,
    ctx: null,
    bitmap: null,
    transitionIn: {
      type: 'fade',
      mode: 'adjacent',
      durationUs: 500_000,
      params: {},
    },
    ...overrides,
  } as unknown as CompositorClip;
}

describe('TransitionManager.getActiveTransitionState', () => {
  it('returns null when no transitions are set', () => {
    const tm = new TransitionManager();
    const clip = makeClip({ transitionIn: undefined, transitionOut: undefined });
    expect(tm.getActiveTransitionState(clip, 100_000, true)).toBeNull();
  });

  it('detects active transition-in', () => {
    const tm = new TransitionManager();
    const clip = makeClip({ transitionOut: undefined });
    const state = tm.getActiveTransitionState(clip, 100_000, true);
    expect(state).not.toBeNull();
    expect(state!.edge).toBe('in');
    expect(state!.progress).toBeCloseTo(0.2, 5);
  });

  it('detects active transition-out', () => {
    const tm = new TransitionManager();
    const clip = makeClip({
      transitionIn: undefined,
      transitionOut: {
        type: 'fade',
        mode: 'adjacent',
        durationUs: 500_000,
        params: {},
      },
    });
    // Clip starts at 0, duration 1s, out transition starts at 0.5s
    const state = tm.getActiveTransitionState(clip, 750_000, true);
    expect(state).not.toBeNull();
    expect(state!.edge).toBe('out');
    expect(state!.progress).toBeCloseTo(0.5, 5);
  });

  it('returns null when time is outside transition windows', () => {
    const tm = new TransitionManager();
    const clip = makeClip({
      transitionIn: { type: 'fade', mode: 'adjacent', durationUs: 200_000, params: {} },
      transitionOut: {
        type: 'fade',
        mode: 'adjacent',
        durationUs: 200_000,
        params: {},
      },
    });
    // Middle of clip, no transition active
    expect(tm.getActiveTransitionState(clip, 500_000, true)).toBeNull();
  });

  it('picks nearer edge when in and out overlap on short clips', () => {
    const tm = new TransitionManager();
    // Clip is 300ms, in transition 200ms, out transition 200ms → overlap
    const clip = makeClip({
      durationUs: 300_000,
      endUs: 300_000,
      transitionIn: { type: 'fade', mode: 'adjacent', durationUs: 200_000, params: {} },
      transitionOut: {
        type: 'fade',
        mode: 'adjacent',
        durationUs: 200_000,
        params: {},
      },
    });

    // At 100ms: in-end distance = 200-100 = 100, out-start distance = 100-100 = 0
    // out-start is nearer → should pick out
    const state = tm.getActiveTransitionState(clip, 100_000, true);
    expect(state).not.toBeNull();
    expect(state!.edge).toBe('out');

    // At 50ms: in-end distance = 200-50 = 150, out-start distance = 50-100 = -50
    // distToInEnd (150) <= distToOutStart (-50) → true → useIn
    const state2 = tm.getActiveTransitionState(clip, 50_000, true);
    expect(state2).not.toBeNull();
    expect(state2!.edge).toBe('in');
  });

  it('returns null manifest when previewEffectsEnabled is false', () => {
    const tm = new TransitionManager();
    const clip = makeClip({ transitionOut: undefined });
    const state = tm.getActiveTransitionState(clip, 100_000, false);
    expect(state).not.toBeNull();
    expect(state!.manifest).toBeNull();
  });
});

describe('TransitionManager.computeTransitionOpacity', () => {
  it('returns base opacity when no transitions are active', () => {
    const tm = new TransitionManager();
    const clip = makeClip({
      transitionIn: undefined,
      transitionOut: undefined,
      opacity: 0.8,
    });
    expect(tm.computeTransitionOpacity(clip, 500_000, true)).toBeCloseTo(0.8, 5);
  });

  it('ramps opacity from 0 to base during transition-in (non-shader)', () => {
    const tm = new TransitionManager();
    const clip = makeClip({
      transitionOut: undefined,
      opacity: 1,
      transitionIn: { type: 'fade', mode: 'adjacent', durationUs: 1_000_000, params: {} },
    });
    // At time 0, progress = 0 → opacity should be 0
    expect(tm.computeTransitionOpacity(clip, 0, false)).toBeCloseTo(0, 5);
    // At time 500ms, progress = 0.5 → opacity should be 0.5
    expect(tm.computeTransitionOpacity(clip, 500_000, false)).toBeCloseTo(0.5, 5);
    // At time 1s (end of transition), opacity should be 1
    expect(tm.computeTransitionOpacity(clip, 1_000_000, false)).toBeCloseTo(1, 5);
  });

  it('ramps opacity from base to 0 during transition-out (non-shader)', () => {
    const tm = new TransitionManager();
    const clip = makeClip({
      transitionIn: undefined,
      opacity: 1,
      transitionOut: {
        type: 'fade',
        mode: 'adjacent',
        durationUs: 500_000,
        params: {},
      },
    });
    // Clip duration 1s, out starts at 0.5s
    // At 0.5s (start of out), progress = 0 → opacity = 1
    expect(tm.computeTransitionOpacity(clip, 500_000, false)).toBeCloseTo(1, 5);
    // At 0.75s, progress = 0.5 → opacity = 0.5
    expect(tm.computeTransitionOpacity(clip, 750_000, false)).toBeCloseTo(0.5, 5);
  });

  it('clamps opacity to [0, 1]', () => {
    const tm = new TransitionManager();
    const clip = makeClip({
      transitionIn: undefined,
      transitionOut: undefined,
      opacity: 1.5,
    });
    expect(tm.computeTransitionOpacity(clip, 500_000, true)).toBeCloseTo(1, 5);
  });

  it('respects opacityActive=false by using opacity 1', () => {
    const tm = new TransitionManager();
    const clip = makeClip({
      transitionIn: undefined,
      transitionOut: undefined,
      opacity: 0.3,
      opacityActive: false,
    });
    expect(tm.computeTransitionOpacity(clip, 500_000, true)).toBeCloseTo(1, 5);
  });
});

describe('TransitionManager.clear', () => {
  it('destroys all transition filters', () => {
    const tm = new TransitionManager();
    const destroySpy = vi.fn();
    // Access private map to inject a mock filter
    (
      tm as unknown as { transitionFilters: Map<string, { destroy: () => void }> }
    ).transitionFilters.set('clip-1', {
      destroy: destroySpy,
    });
    tm.clear();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});

describe('TransitionManager.clearClipFilter', () => {
  it('destroys clip transition filter and disposes transition textures', () => {
    const tm = new TransitionManager();
    const filterDestroy = vi.fn();
    const fromClose = vi.fn();
    const toClose = vi.fn();
    const outputDestroy = vi.fn();
    const combinedDestroy = vi.fn();

    const clip = makeClip({
      transitionFilter: { destroy: filterDestroy } as any,
      transitionFromTexture: { close: fromClose } as any,
      transitionToTexture: { close: toClose } as any,
      transitionOutputTexture: { destroy: outputDestroy } as any,
      transitionCombinedTexture: { destroy: combinedDestroy } as any,
    });

    tm.clearClipFilter(clip);

    expect(filterDestroy).toHaveBeenCalledTimes(1);
    expect(clip.transitionFilter).toBeNull();
    expect(clip.transitionFilterType).toBeNull();
    expect(clip.transitionFromTexture).toBeNull();
    expect(clip.transitionToTexture).toBeNull();
    expect(clip.transitionOutputTexture).toBeNull();
    expect(clip.transitionCombinedTexture).toBeNull();
  });

  it('is safe to call on a clip with no transition resources', () => {
    const tm = new TransitionManager();
    const clip = makeClip({
      transitionFilter: null,
      transitionFromTexture: null,
      transitionToTexture: null,
      transitionOutputTexture: null,
      transitionCombinedTexture: null,
    });
    expect(() => tm.clearClipFilter(clip)).not.toThrow();
  });
});
