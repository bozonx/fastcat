/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { formatTimecode } from '~/utils/timecode';

describe('formatTimecode', () => {
  it('returns 00:00:00:00 for invalid fps', () => {
    expect(formatTimecode(1_000_000, 0)).toBe('00:00:00:00');
    expect(formatTimecode(1_000_000, -1)).toBe('00:00:00:00');
    expect(formatTimecode(1_000_000, NaN)).toBe('00:00:00:00');
  });

  it('formats zero time', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00');
  });

  it('formats one second at 30fps', () => {
    expect(formatTimecode(1_000_000, 30)).toBe('00:00:01:00');
  });

  it('formats one second at 25fps', () => {
    expect(formatTimecode(1_000_000, 25)).toBe('00:00:01:00');
  });

  it('formats negative time', () => {
    expect(formatTimecode(-1_000_000, 30)).toBe('-00:00:01:00');
  });

  it('calculates frames correctly', () => {
    expect(formatTimecode(33_333, 30)).toBe('00:00:00:01');
    expect(formatTimecode(1_000_000 + 33_333, 30)).toBe('00:00:01:01');
  });
});
