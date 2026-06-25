/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  applyForwardSeamGain,
  applyClipGainEnvelope,
  deepEqualEffects,
} from '~/utils/video-editor/WebAudioEngine';
import type { ClipPlaybackWindow } from '~/utils/video-editor/audio-engine.types';

function createMockGainNode() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const gain = {
    value: 1,
    setValueAtTime: vi.fn((v: number, t: number) => {
      calls.push({ method: 'setValueAtTime', args: [v, t] });
      return gain;
    }),
    linearRampToValueAtTime: vi.fn((v: number, t: number) => {
      calls.push({ method: 'linearRampToValueAtTime', args: [v, t] });
      return gain;
    }),
    setValueCurveAtTime: vi.fn((curve: Float32Array, t: number, dur: number) => {
      calls.push({ method: 'setValueCurveAtTime', args: [Array.from(curve), t, dur] });
      return gain;
    }),
    cancelScheduledValues: vi.fn((t: number) => {
      calls.push({ method: 'cancelScheduledValues', args: [t] });
      return gain;
    }),
    cancelAndHoldAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  const node = { gain, connect: vi.fn(), disconnect: vi.fn() };
  return { node: node as unknown as GainNode, gain, calls };
}

describe('applyForwardSeamGain', () => {
  it('fades in from 0 to 1 at kickoff boundary', () => {
    const { node, calls } = createMockGainNode();

    applyForwardSeamGain(node, {
      t0: 5.0,
      ctxTotalS: 1.0,
      ctxNominalS: 0.99,
      ctxTailS: 0,
      leadCtxS: 0,
      startsAtKickoff: true,
    });

    // Should set value to 0 at t0, then ramp to 1
    const setValueCall = calls.find((c) => c.method === 'setValueAtTime' && c.args[0] === 0);
    expect(setValueCall).toBeDefined();
    expect(setValueCall!.args[1]).toBe(5.0);

    const rampCall = calls.find((c) => c.method === 'linearRampToValueAtTime' && c.args[0] === 1);
    expect(rampCall).toBeDefined();
    // fadeIn = min(0.02, 1.0/2) = 0.02
    expect(rampCall!.args[1]).toBeCloseTo(5.02, 5);
  });

  it('uses setValueCurveAtTime for lead crossfade-in', () => {
    const { node, calls } = createMockGainNode();

    applyForwardSeamGain(node, {
      t0: 10.0,
      ctxTotalS: 2.0,
      ctxNominalS: 1.9,
      ctxTailS: 0.1,
      leadCtxS: 0.05,
      startsAtKickoff: false,
    });

    // Should use setValueCurveAtTime for the fade-in
    const curveCall = calls.find((c) => c.method === 'setValueCurveAtTime' && c.args[1] === 10.0);
    expect(curveCall).toBeDefined();
    // Duration = min(leadCtxS, ctxTotalS/2) = min(0.05, 1.0) = 0.05
    expect(curveCall!.args[2]).toBeCloseTo(0.05, 5);
  });

  it('fades in from silence when no seam partner (post-gap)', () => {
    const { node, calls } = createMockGainNode();

    applyForwardSeamGain(node, {
      t0: 3.0,
      ctxTotalS: 0.5,
      ctxNominalS: 0.49,
      ctxTailS: 0,
      leadCtxS: 0,
      startsAtKickoff: false,
    });

    // Should set value to 0, then ramp to 1 with CHUNK_EDGE_FADE_S
    const setValueCall = calls.find((c) => c.method === 'setValueAtTime' && c.args[0] === 0);
    expect(setValueCall).toBeDefined();
    expect(setValueCall!.args[1]).toBe(3.0);

    const rampCall = calls.find((c) => c.method === 'linearRampToValueAtTime' && c.args[0] === 1);
    expect(rampCall).toBeDefined();
    // fadeIn = min(0.005, 0.5/2) = 0.005
    expect(rampCall!.args[1]).toBeCloseTo(3.005, 5);
  });

  it('applies equal-power fade-out curve when ctxTailS > 0', () => {
    const { node, calls } = createMockGainNode();

    applyForwardSeamGain(node, {
      t0: 0,
      ctxTotalS: 2.0,
      ctxNominalS: 1.9,
      ctxTailS: 0.1,
      leadCtxS: 0,
      startsAtKickoff: false,
    });

    // Should have a setValueCurveAtTime for the fade-out at t0 + ctxNominalS
    const fadeOutCall = calls.find((c) => c.method === 'setValueCurveAtTime' && c.args[1] === 1.9);
    expect(fadeOutCall).toBeDefined();
    expect(fadeOutCall!.args[2]).toBeCloseTo(0.1, 5);
  });

  it('applies linear fade-out when ctxTailS is 0 (last chunk)', () => {
    const { node, calls } = createMockGainNode();

    applyForwardSeamGain(node, {
      t0: 0,
      ctxTotalS: 1.0,
      ctxNominalS: 1.0,
      ctxTailS: 0,
      leadCtxS: 0,
      startsAtKickoff: false,
    });

    // Should set value to 1 near the end, then ramp to 0
    const setOneCall = calls.find((c) => c.method === 'setValueAtTime' && c.args[0] === 1);
    expect(setOneCall).toBeDefined();
    // fadeOut = min(0.005, 1.0/2) = 0.005
    // setValueAtTime(1, t0 + ctxTotalS - fadeOut) = 0 + 1.0 - 0.005 = 0.995
    expect(setOneCall!.args[1]).toBeCloseTo(0.995, 5);

    const rampZeroCall = calls.find(
      (c) => c.method === 'linearRampToValueAtTime' && c.args[0] === 0,
    );
    expect(rampZeroCall).toBeDefined();
    expect(rampZeroCall!.args[1]).toBeCloseTo(1.0, 5);
  });

  it('falls back to unity gain when automation throws', () => {
    const { node, gain, calls } = createMockGainNode();

    // Make setValueAtTime throw
    gain.setValueAtTime = vi.fn(() => {
      throw new Error('Automation error');
    });
    gain.cancelScheduledValues = vi.fn((t: number) => {
      calls.push({ method: 'cancelScheduledValues', args: [t] });
      return gain;
    });

    applyForwardSeamGain(node, {
      t0: 0,
      ctxTotalS: 1.0,
      ctxNominalS: 1.0,
      ctxTailS: 0,
      leadCtxS: 0,
      startsAtKickoff: true,
    });

    // Should have called cancelScheduledValues and then setValueAtTime(1, t0)
    const cancelCall = calls.find((c) => c.method === 'cancelScheduledValues');
    expect(cancelCall).toBeDefined();
  });
});

describe('applyClipGainEnvelope', () => {
  function makeWindow(overrides: Partial<ClipPlaybackWindow> = {}): ClipPlaybackWindow {
    return {
      currentTimeS: 0,
      startAtS: 0,
      currentClipLocalS: 0,
      remainingInClipS: 2,
      effectiveStartS: 0,
      effectiveSourceStartS: 0,
      effectiveSourceEndS: 2,
      clipDurationS: 2,
      clipSpeed: 1,
      reversed: false,
      fadeInS: 0.5,
      fadeOutS: 0.5,
      fadeInCurve: 'linear' as any,
      fadeOutCurve: 'linear' as any,
      audioGain: 1,
      audioBalance: 0,
      effectiveSpeed: 1,
      globalSpeed: 1,
      ...overrides,
    };
  }

  it('cancels existing scheduled values and sets initial gain', () => {
    const { node, calls } = createMockGainNode();

    applyClipGainEnvelope({
      window: makeWindow(),
      clipGain: node,
      startAtS: 10,
      ctxCurrentTime: 9,
    });

    const cancelCall = calls.find((c) => c.method === 'cancelScheduledValues');
    expect(cancelCall).toBeDefined();
    expect(cancelCall!.args[0]).toBe(9);

    // Initial setValueAtTime at startAtS
    const setCall = calls.find((c) => c.method === 'setValueAtTime' && c.args[1] === 10);
    expect(setCall).toBeDefined();
  });

  it('schedules fade-in curve when clip starts within fadeIn region', () => {
    const { node, calls } = createMockGainNode();

    applyClipGainEnvelope({
      window: makeWindow({ currentClipLocalS: 0, fadeInS: 0.5, remainingInClipS: 2 }),
      clipGain: node,
      startAtS: 10,
      ctxCurrentTime: 9,
    });

    // Should have a setValueCurveAtTime for the fade-in
    const curveCalls = calls.filter((c) => c.method === 'setValueCurveAtTime');
    expect(curveCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('does not schedule fade-in when already past fadeIn region', () => {
    const { node, calls } = createMockGainNode();

    applyClipGainEnvelope({
      window: makeWindow({ currentClipLocalS: 1.0, fadeInS: 0.5, remainingInClipS: 1.0 }),
      clipGain: node,
      startAtS: 10,
      ctxCurrentTime: 9,
    });

    // No fade-in curve — currentClipLocalS (1.0) >= fadeInS (0.5)
    // But there might be a fade-out curve since t1=2.0 > outStartClipS=1.5
    const curveCalls = calls.filter((c) => c.method === 'setValueCurveAtTime');
    // Only fade-out curve, no fade-in
    expect(curveCalls.length).toBe(1);
  });

  it('schedules fade-out curve when clip enters fadeOut region', () => {
    const { node, calls } = createMockGainNode();

    applyClipGainEnvelope({
      window: makeWindow({
        currentClipLocalS: 1.6,
        clipDurationS: 2,
        fadeOutS: 0.5,
        remainingInClipS: 0.4,
        fadeInS: 0,
      }),
      clipGain: node,
      startAtS: 10,
      ctxCurrentTime: 9,
    });

    // Should have a fade-out curve
    const curveCalls = calls.filter((c) => c.method === 'setValueCurveAtTime');
    expect(curveCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('does not schedule fade-out when clip has not reached fadeOut region', () => {
    const { node, calls } = createMockGainNode();

    applyClipGainEnvelope({
      window: makeWindow({
        currentClipLocalS: 0,
        clipDurationS: 2,
        fadeOutS: 0.5,
        remainingInClipS: 1.0,
        fadeInS: 0,
      }),
      clipGain: node,
      startAtS: 10,
      ctxCurrentTime: 9,
    });

    // t1 = 0 + 1.0 = 1.0, outStartClipS = 2 - 0.5 = 1.5
    // t1 (1.0) <= outStartClipS (1.5) → no fade-out
    const curveCalls = calls.filter((c) => c.method === 'setValueCurveAtTime');
    expect(curveCalls.length).toBe(0);
  });

  it('scales clip-local time to ctx time using globalSpeed', () => {
    const { node, calls } = createMockGainNode();

    applyClipGainEnvelope({
      window: makeWindow({
        currentClipLocalS: 0,
        fadeInS: 1.0,
        remainingInClipS: 2,
        globalSpeed: 2,
      }),
      clipGain: node,
      startAtS: 10,
      ctxCurrentTime: 9,
    });

    // With globalSpeed=2, the fade-in ramp end in ctx time should be
    // startAtS + (fadeInS - currentClipLocalS) / globalSpeed = 10 + 1/2 = 10.5
    const curveCalls = calls.filter((c) => c.method === 'setValueCurveAtTime');
    expect(curveCalls.length).toBeGreaterThanOrEqual(1);
    // The curve duration should be 0.5s (1.0 / 2)
    const fadeInCurve = curveCalls[0];
    expect(fadeInCurve!.args[2]).toBeCloseTo(0.5, 5);
  });
});

describe('deepEqualEffects', () => {
  it('returns true for identical primitives', () => {
    expect(deepEqualEffects(1, 1)).toBe(true);
    expect(deepEqualEffects('a', 'a')).toBe(true);
    expect(deepEqualEffects(true, true)).toBe(true);
  });

  it('returns false for different primitives', () => {
    expect(deepEqualEffects(1, 2)).toBe(false);
    expect(deepEqualEffects('a', 'b')).toBe(false);
  });

  it('returns true for same reference', () => {
    const obj = { a: 1 };
    expect(deepEqualEffects(obj, obj)).toBe(true);
  });

  it('returns false when one is null and other is not', () => {
    expect(deepEqualEffects(null, { a: 1 })).toBe(false);
    expect(deepEqualEffects({ a: 1 }, null)).toBe(false);
  });

  it('returns true for deeply equal objects with same key order', () => {
    expect(deepEqualEffects({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it('returns true for deeply equal objects with different key order', () => {
    expect(deepEqualEffects({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('returns false for objects with different keys', () => {
    expect(deepEqualEffects({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('returns false for objects with different values', () => {
    expect(deepEqualEffects({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('returns false for objects with different number of keys', () => {
    expect(deepEqualEffects({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('handles nested objects', () => {
    expect(deepEqualEffects({ params: { decay: 2 } }, { params: { decay: 2 } })).toBe(true);
    expect(deepEqualEffects({ params: { decay: 2 } }, { params: { decay: 3 } })).toBe(false);
  });

  it('handles arrays', () => {
    expect(deepEqualEffects([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqualEffects([1, 2, 3], [1, 2, 4])).toBe(false);
  });

  it('handles undefined values', () => {
    expect(deepEqualEffects({ a: undefined }, { a: undefined })).toBe(true);
    expect(deepEqualEffects({ a: undefined }, { b: undefined })).toBe(false);
  });
});
