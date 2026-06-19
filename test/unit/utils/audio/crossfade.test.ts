/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { equalPowerGains, equalPowerCurve, SEAM_CROSSFADE_S } from '~/utils/audio/crossfade';

describe('equalPowerGains', () => {
  it('starts fully on the outgoing signal and ends fully on the incoming', () => {
    expect(equalPowerGains(0)).toEqual({ out: 1, in: 0 });
    const end = equalPowerGains(1);
    expect(end.out).toBeCloseTo(0, 12);
    expect(end.in).toBeCloseTo(1, 12);
  });

  it('preserves power across the whole crossfade (out² + in² === 1)', () => {
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const { out, in: inc } = equalPowerGains(p);
      expect(out * out + inc * inc).toBeCloseTo(1, 12);
    }
  });

  it('does not dip below unity power at the midpoint (the linear-crossfade bug)', () => {
    const mid = equalPowerGains(0.5);
    // A linear crossfade would give out=in=0.5 → power 0.5 (~-3 dB). Equal-power
    // keeps the sum of squares at 1.
    expect(mid.out * mid.out + mid.in * mid.in).toBeCloseTo(1, 12);
  });

  it('clamps progress outside [0, 1]', () => {
    expect(equalPowerGains(-1)).toEqual({ out: 1, in: 0 });
    const over = equalPowerGains(2);
    expect(over.out).toBeCloseTo(0, 12);
    expect(over.in).toBeCloseTo(1, 12);
  });
});

describe('equalPowerCurve', () => {
  it('builds a monotonic fade-in curve from 0 to 1', () => {
    const curve = equalPowerCurve('in', 16);
    expect(curve[0]).toBeCloseTo(0, 12);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 12);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!);
    }
  });

  it('builds a monotonic fade-out curve from 1 to 0', () => {
    const curve = equalPowerCurve('out', 16);
    expect(curve[0]).toBeCloseTo(1, 12);
    expect(curve[curve.length - 1]).toBeCloseTo(0, 12);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]!).toBeLessThanOrEqual(curve[i - 1]!);
    }
  });

  it('in/out curves are power-complementary at matching positions', () => {
    const fadeIn = equalPowerCurve('in', 32);
    const fadeOut = equalPowerCurve('out', 32);
    for (let i = 0; i < fadeIn.length; i += 1) {
      // Float32Array storage limits precision; 5 decimals is plenty here.
      expect(fadeIn[i]! * fadeIn[i]! + fadeOut[i]! * fadeOut[i]!).toBeCloseTo(1, 5);
    }
  });
});

describe('SEAM_CROSSFADE_S', () => {
  it('is a short, inaudible seam length', () => {
    expect(SEAM_CROSSFADE_S).toBeGreaterThan(0);
    expect(SEAM_CROSSFADE_S).toBeLessThanOrEqual(0.02);
  });
});
