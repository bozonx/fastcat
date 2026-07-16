/** @vitest-environment node */
import { timelineTicks } from '../../utils/timeline-time';
import { describe, it, expect } from 'vitest';
import { ticksToSecondsClamped, secondsToTicksSigned } from '~/workers/core/time';

describe('time utils', () => {
  it('converts microseconds to seconds', () => {
    expect(ticksToSecondsClamped(timelineTicks(1_000_000))).toBe(1);
    expect(ticksToSecondsClamped(timelineTicks(500_000))).toBe(0.5);
    expect(ticksToSecondsClamped(0)).toBe(0);
  });

  it('converts seconds to microseconds', () => {
    expect(secondsToTicksSigned(1)).toBe(timelineTicks(1_000_000));
    expect(secondsToTicksSigned(0.5)).toBe(timelineTicks(500_000));
    expect(secondsToTicksSigned(0)).toBe(0);
  });

  it('rounds when converting seconds to microseconds', () => {
    expect(secondsToTicksSigned(0.1234567)).toBe(Math.round(0.1234567 * timelineTicks(1_000_000)));
  });
});
