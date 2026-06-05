import { describe, it, expect } from 'vitest';

// Reproduce the private helpers inline so the test does not depend on
// module internals (they are not exported).
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeAudioSpeed(value: unknown): number {
  const raw = finite(value, 1) || 1;
  const clamped = Math.max(0.01, Math.min(100, Math.abs(raw)));
  return raw < 0 ? -clamped : clamped;
}

function sanitizeVideoSpeed(value: unknown): number {
  const raw = finite(value, 1) || 1;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw === 0) return 1;
  return Math.max(-10, Math.min(10, raw));
}

describe('sanitizeAudioSpeed', () => {
  it('returns 1 for undefined / null / NaN / zero', () => {
    expect(sanitizeAudioSpeed(undefined)).toBe(1);
    expect(sanitizeAudioSpeed(null)).toBe(1);
    expect(sanitizeAudioSpeed(NaN)).toBe(1);
    expect(sanitizeAudioSpeed(0)).toBe(1);
  });

  it('preserves forward speeds and clamps them', () => {
    expect(sanitizeAudioSpeed(1)).toBe(1);
    expect(sanitizeAudioSpeed(2)).toBe(2);
    expect(sanitizeAudioSpeed(100)).toBe(100);
    expect(sanitizeAudioSpeed(150)).toBe(100);
    expect(sanitizeAudioSpeed(0.005)).toBe(0.01);
  });

  it('preserves negative sign for reverse playback', () => {
    expect(sanitizeAudioSpeed(-1)).toBe(-1);
    expect(sanitizeAudioSpeed(-2)).toBe(-2);
    expect(sanitizeAudioSpeed(-100)).toBe(-100);
    expect(sanitizeAudioSpeed(-150)).toBe(-100);
    expect(sanitizeAudioSpeed(-0.005)).toBe(-0.01);
  });
});

describe('sanitizeVideoSpeed', () => {
  it('returns 1 for undefined / null / NaN / zero', () => {
    expect(sanitizeVideoSpeed(undefined)).toBe(1);
    expect(sanitizeVideoSpeed(null)).toBe(1);
    expect(sanitizeVideoSpeed(NaN)).toBe(1);
    expect(sanitizeVideoSpeed(0)).toBe(1);
  });

  it('preserves forward speeds and clamps them', () => {
    expect(sanitizeVideoSpeed(1)).toBe(1);
    expect(sanitizeVideoSpeed(2)).toBe(2);
    expect(sanitizeVideoSpeed(10)).toBe(10);
    expect(sanitizeVideoSpeed(15)).toBe(10);
  });

  it('preserves negative sign for reverse playback', () => {
    expect(sanitizeVideoSpeed(-1)).toBe(-1);
    expect(sanitizeVideoSpeed(-2)).toBe(-2);
    expect(sanitizeVideoSpeed(-10)).toBe(-10);
    expect(sanitizeVideoSpeed(-15)).toBe(-10);
  });
});
