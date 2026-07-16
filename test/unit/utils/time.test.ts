/** @vitest-environment node */
import { timelineTicks } from './timeline-time';
import { describe, it, expect } from 'vitest';
import {
  clampTicks,
  formatDurationSeconds,
  formatHms,
  formatMsOrHms,
  formatTime,
  formatTimecode,
  normalizeTicks,
  secondsToTicksSigned,
  sanitizeFps,
  secondsToTicksClamped,
  ticksToSecondsClamped,
  TICKS_PER_SECOND,
} from '~/utils/time';

describe('secondsToTicksClamped', () => {
  it('rounds by default', () => {
    expect(secondsToTicksClamped(1.000_000_4)).toBe(Math.round(1.000_000_4 * TICKS_PER_SECOND));
    expect(secondsToTicksClamped(1.000_000_5)).toBe(Math.round(1.000_000_5 * TICKS_PER_SECOND));
  });

  it('floors when requested', () => {
    expect(secondsToTicksClamped(1.000_000_9, 'floor')).toBe(
      Math.floor(1.000_000_9 * TICKS_PER_SECOND),
    );
    expect(secondsToTicksClamped(1.0, 'floor')).toBe(TICKS_PER_SECOND);
  });

  it('ceils when requested', () => {
    expect(secondsToTicksClamped(1.000_000_1, 'ceil')).toBe(
      Math.ceil(1.000_000_1 * TICKS_PER_SECOND),
    );
    expect(secondsToTicksClamped(1.0, 'ceil')).toBe(TICKS_PER_SECOND);
  });

  it('returns 0 for non-finite or non-positive values', () => {
    expect(secondsToTicksClamped(NaN)).toBe(0);
    expect(secondsToTicksClamped(Infinity)).toBe(0);
    expect(secondsToTicksClamped(-1)).toBe(0);
    expect(secondsToTicksClamped(0)).toBe(0);
  });
});

describe('ticksToSecondsClamped', () => {
  it('converts ticks to seconds', () => {
    expect(ticksToSecondsClamped(timelineTicks(1_000_000))).toBe(1);
    expect(ticksToSecondsClamped(timelineTicks(500_000))).toBe(0.5);
  });

  it('returns 0 for non-finite or non-positive values', () => {
    expect(ticksToSecondsClamped(NaN)).toBe(0);
    expect(ticksToSecondsClamped(-1)).toBe(0);
  });
});

describe('secondsToTicksSigned', () => {
  it('converts seconds to ticks', () => {
    expect(secondsToTicksSigned(1)).toBe(timelineTicks(1_000_000));
    expect(secondsToTicksSigned(0.5)).toBe(timelineTicks(500_000));
  });

  it('returns 0 for non-finite values', () => {
    expect(secondsToTicksSigned(NaN)).toBe(0);
    expect(secondsToTicksSigned(Infinity)).toBe(0);
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
    expect(sanitizeFps(29.97)).toBeCloseTo(30_000 / 1_001, 10);
    expect(sanitizeFps(23.976)).toBeCloseTo(24_000 / 1_001, 10);
    expect(sanitizeFps(59.94)).toBeCloseTo(60_000 / 1_001, 10);
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

describe('formatTimecode', () => {
  it('returns 00:00:00:00 for invalid fps', () => {
    expect(formatTimecode(timelineTicks(1_000_000), 0)).toBe('00:00:00:00');
    expect(formatTimecode(timelineTicks(1_000_000), -1)).toBe('00:00:00:00');
    expect(formatTimecode(timelineTicks(1_000_000), NaN)).toBe('00:00:00:00');
  });

  it('formats zero time', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00');
  });

  it('formats one second at 30fps', () => {
    expect(formatTimecode(timelineTicks(1_000_000), 30)).toBe('00:00:01:00');
  });

  it('formats one second at 25fps', () => {
    expect(formatTimecode(timelineTicks(1_000_000), 25)).toBe('00:00:01:00');
  });

  it('formats negative time', () => {
    expect(formatTimecode(-timelineTicks(1_000_000), 30)).toBe('-00:00:01:00');
  });

  it('calculates frames correctly', () => {
    expect(formatTimecode(timelineTicks(33_333), 30)).toBe('00:00:00:01');
    expect(formatTimecode(timelineTicks(1_000_000 + 33_333), 30)).toBe('00:00:01:01');
  });
});

describe('formatHms', () => {
  it('formats zero time', () => {
    expect(formatHms(0)).toBe('00:00:00');
  });

  it('formats positive time', () => {
    expect(formatHms(timelineTicks(1_000_000))).toBe('00:00:01');
    expect(formatHms(timelineTicks(65_000_000))).toBe('00:01:05');
    expect(formatHms(timelineTicks(3600_000_000))).toBe('01:00:00');
    expect(formatHms(timelineTicks(3661_000_000))).toBe('01:01:01');
  });

  it('formats negative time', () => {
    expect(formatHms(-timelineTicks(1_000_000))).toBe('-00:00:01');
    expect(formatHms(-timelineTicks(3661_000_000))).toBe('-01:01:01');
  });
});

describe('formatMsOrHms', () => {
  it('formats zero time', () => {
    expect(formatMsOrHms(0)).toBe('00:00');
  });

  it('formats positive time under 1 hour', () => {
    expect(formatMsOrHms(timelineTicks(1_000_000))).toBe('00:01');
    expect(formatMsOrHms(timelineTicks(65_000_000))).toBe('01:05');
    expect(formatMsOrHms(timelineTicks(3599_000_000))).toBe('59:59');
  });

  it('formats positive time over or equal to 1 hour', () => {
    expect(formatMsOrHms(timelineTicks(3600_000_000))).toBe('01:00:00');
    expect(formatMsOrHms(timelineTicks(3661_000_000))).toBe('01:01:01');
  });

  it('formats negative time', () => {
    expect(formatMsOrHms(-timelineTicks(1_000_000))).toBe('-00:01');
    expect(formatMsOrHms(-timelineTicks(3661_000_000))).toBe('-01:01:01');
  });
});

describe('formatDurationSeconds', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatDurationSeconds(undefined)).toBe('0:00');
    expect(formatDurationSeconds(1)).toBe('0:01');
    expect(formatDurationSeconds(61)).toBe('1:01');
    expect(formatDurationSeconds(3661)).toBe('1:01:01');
  });
});

describe('normalizeTicks', () => {
  it('returns rounded positive integer and guards invalid values', () => {
    expect(normalizeTicks(10.4)).toBe(10);
    expect(normalizeTicks(10.6)).toBe(11);
    expect(normalizeTicks(-1)).toBe(0);
    expect(normalizeTicks(Number.NaN)).toBe(0);
  });
});

describe('clampTicks', () => {
  it('clamps value to [0, duration] with normalization', () => {
    expect(clampTicks(1200.8, 1000.2)).toBe(1000);
    expect(clampTicks(-50, 1000)).toBe(0);
    expect(clampTicks(400.7, 1000)).toBe(401);
    expect(clampTicks(500, 0)).toBe(500);
  });
});
