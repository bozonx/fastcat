/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { formatTime, secondsToUs, usToS, sToUs, sanitizeFps } from '~/utils/time';

describe('secondsToUs', () => {
  it('rounds by default', () => {
    expect(secondsToUs(1.000_000_4)).toBe(1_000_000);
    expect(secondsToUs(1.000_000_5)).toBe(1_000_001);
  });

  it('floors when requested', () => {
    expect(secondsToUs(1.000_000_9, 'floor')).toBe(1_000_000);
    expect(secondsToUs(1.0, 'floor')).toBe(1_000_000);
  });

  it('ceils when requested', () => {
    expect(secondsToUs(1.000_000_1, 'ceil')).toBe(1_000_001);
    expect(secondsToUs(1.0, 'ceil')).toBe(1_000_000);
  });

  it('returns 0 for non-finite or non-positive values', () => {
    expect(secondsToUs(NaN)).toBe(0);
    expect(secondsToUs(Infinity)).toBe(0);
    expect(secondsToUs(-1)).toBe(0);
    expect(secondsToUs(0)).toBe(0);
  });
});

describe('usToS', () => {
  it('converts microseconds to seconds', () => {
    expect(usToS(1_000_000)).toBe(1);
    expect(usToS(500_000)).toBe(0.5);
  });

  it('returns 0 for non-finite or non-positive values', () => {
    expect(usToS(NaN)).toBe(0);
    expect(usToS(-1)).toBe(0);
  });
});

describe('sToUs', () => {
  it('converts seconds to microseconds', () => {
    expect(sToUs(1)).toBe(1_000_000);
    expect(sToUs(0.5)).toBe(500_000);
  });

  it('returns 0 for non-finite values', () => {
    expect(sToUs(NaN)).toBe(0);
    expect(sToUs(Infinity)).toBe(0);
  });
});

describe('sanitizeFps', () => {
  it('returns fallback for invalid values', () => {
    expect(sanitizeFps(undefined)).toBe(30);
    expect(sanitizeFps(NaN)).toBe(30);
  });

  it('clamps to min and max', () => {
    expect(sanitizeFps(0)).toBe(1);
    expect(sanitizeFps(1000)).toBe(240);
  });

  it('preserves NTSC rates', () => {
    expect(sanitizeFps(29.97)).toBe(29.97);
    expect(sanitizeFps(23.976)).toBe(23.976);
    expect(sanitizeFps(59.94)).toBe(59.94);
  });
});

describe('formatTime', () => {
  it('formats 0 seconds correctly', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('formats values less than 60 seconds correctly', () => {
    expect(formatTime(5)).toBe('00:05');
    expect(formatTime(45)).toBe('00:45');
    expect(formatTime(59)).toBe('00:59');
  });

  it('formats exact minutes correctly', () => {
    expect(formatTime(60)).toBe('01:00');
    expect(formatTime(120)).toBe('02:00');
    expect(formatTime(600)).toBe('10:00');
  });

  it('formats minutes and seconds correctly', () => {
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(135)).toBe('02:15');
    expect(formatTime(3599)).toBe('59:59');
  });

  it('handles fractional seconds by flooring them', () => {
    expect(formatTime(5.9)).toBe('00:05');
    expect(formatTime(65.4)).toBe('01:05');
  });

  it('handles invalid or empty values by returning 00:00', () => {
    expect(formatTime(NaN)).toBe('00:00');
    // @ts-expect-error testing invalid input
    expect(formatTime(undefined)).toBe('00:00');
    // @ts-expect-error testing invalid input
    expect(formatTime(null)).toBe('00:00');
  });
});
