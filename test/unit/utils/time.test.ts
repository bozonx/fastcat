/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { formatTime } from '~/utils/time';

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
