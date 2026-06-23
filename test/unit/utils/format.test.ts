// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatBitrate, formatBytes, formatFps, formatRenderDuration } from '~/utils/format';

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

  it('formatFps rounds to 3 decimal places for display', () => {
    expect(formatFps(24)).toBe('24');
    expect(formatFps(23.976)).toBe('23.976');
    expect(formatFps(29.97)).toBe('29.97');
    expect(formatFps(59.94)).toBe('59.94');
    expect(formatFps(23.976023)).toBe('23.976');
    expect(formatFps(undefined)).toBe('0');
    expect(formatFps(null)).toBe('0');
  });

  it('formatRenderDuration shows seconds under a minute and MM:SS / H:MM:SS above', () => {
    expect(formatRenderDuration(0)).toBe('1s');
    expect(formatRenderDuration(500)).toBe('1s');
    expect(formatRenderDuration(59_000)).toBe('59s');
    expect(formatRenderDuration(60_000)).toBe('1:00');
    expect(formatRenderDuration(125_000)).toBe('2:05');
    expect(formatRenderDuration(3_661_000)).toBe('1:01:01');
  });
});
