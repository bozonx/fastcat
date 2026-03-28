import { describe, it, expect } from 'vitest';
import { usToS, sToUs } from '~/workers/core/time';

describe('time utils', () => {
  it('converts microseconds to seconds', () => {
    expect(usToS(1_000_000)).toBe(1);
    expect(usToS(500_000)).toBe(0.5);
    expect(usToS(0)).toBe(0);
  });

  it('converts seconds to microseconds', () => {
    expect(sToUs(1)).toBe(1_000_000);
    expect(sToUs(0.5)).toBe(500_000);
    expect(sToUs(0)).toBe(0);
  });

  it('rounds when converting seconds to microseconds', () => {
    expect(sToUs(0.1234567)).toBe(123457);
  });
});
