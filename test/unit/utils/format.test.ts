// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatBitrate, formatBytes, formatDurationSeconds } from '../../../src/utils/format';

describe('utils/format', () => {
  it('formatBytes formats using base 1024 and fixed units', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
  });

  it('formatBitrate formats bps/kbps/mbps', () => {
    expect(formatBitrate(undefined)).toBe('-');
    expect(formatBitrate(500)).toBe('500 bps');
    expect(formatBitrate(1500)).toBe('2 kbps');
    expect(formatBitrate(1_500_000)).toBe('1.50 Mbps');
  });

  it('formatDurationSeconds formats mm:ss and h:mm:ss', () => {
    expect(formatDurationSeconds(undefined)).toBe('0:00');
    expect(formatDurationSeconds(1)).toBe('0:01');
    expect(formatDurationSeconds(61)).toBe('1:01');
    expect(formatDurationSeconds(3661)).toBe('1:01:01');
  });
});
