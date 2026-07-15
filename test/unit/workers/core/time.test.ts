/** @vitest-environment node */
import { timelineUs } from '../../utils/timeline-time';
import { describe, it, expect } from 'vitest';
import { ticksToSecondsClamped, secondsToTicksSigned } from '~/workers/core/time';

describe('time utils', () => {
  it('converts microseconds to seconds', () => {
    expect(ticksToSecondsClamped(timelineUs(1_000_000))).toBe(1);
    expect(ticksToSecondsClamped(timelineUs(500_000))).toBe(0.5);
    expect(ticksToSecondsClamped(0)).toBe(0);
  });

  it('converts seconds to microseconds', () => {
    expect(secondsToTicksSigned(1)).toBe(timelineUs(1_000_000));
    expect(secondsToTicksSigned(0.5)).toBe(timelineUs(500_000));
    expect(secondsToTicksSigned(0)).toBe(0);
  });

  it('rounds when converting seconds to microseconds', () => {
    expect(secondsToTicksSigned(0.1234567)).toBe(Math.round(0.1234567 * timelineUs(1_000_000)));
  });
});
