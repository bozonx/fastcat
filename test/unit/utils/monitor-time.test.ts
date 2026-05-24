// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { clampTimeUs, normalizeTimeUs, sanitizeFps } from '~/utils/monitor-time';

describe('monitor-time utils', () => {
  it('normalizeTimeUs returns rounded positive integer and guards invalid values', () => {
    expect(normalizeTimeUs(10.4)).toBe(10);
    expect(normalizeTimeUs(10.6)).toBe(11);
    expect(normalizeTimeUs(-1)).toBe(0);
    expect(normalizeTimeUs(Number.NaN)).toBe(0);
  });

  it('clampTimeUs clamps value to [0, duration] with normalization', () => {
    expect(clampTimeUs(1200.8, 1000.2)).toBe(1000);
    expect(clampTimeUs(-50, 1000)).toBe(0);
    expect(clampTimeUs(400.7, 1000)).toBe(401);
    expect(clampTimeUs(500, 0)).toBe(500);
  });

  it('sanitizeFps constrains values and provides fallback', () => {
    expect(sanitizeFps(undefined)).toBe(30);
    expect(sanitizeFps(Number.NaN)).toBe(30);
    expect(sanitizeFps(0)).toBe(1);
    expect(sanitizeFps(0.4)).toBe(1);
    expect(sanitizeFps(1000)).toBe(240);
  });

  it('sanitizeFps preserves NTSC non-integer rates (must match ruler/playhead fps)', () => {
    // Rounding these to integers would make the monitor timecode disagree with
    // the ruler, which formats with the real fps from the timeline format.
    expect(sanitizeFps(29.97)).toBe(29.97);
    expect(sanitizeFps(23.976)).toBe(23.976);
    expect(sanitizeFps(59.94)).toBe(59.94);
    // Quantized to 3 decimals to strip float noise without forcing integers.
    expect(sanitizeFps(23.9760004)).toBe(23.976);
  });
});
