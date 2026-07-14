/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { TICKS_PER_MICROSECOND } from '~/utils/time';
import {
  safeDispose,
  parseUsToS,
  parseUs,
  sanitizeTimelineColor,
  parseHexColor,
  isInputDisposed,
} from '~/utils/video-editor/utils';

describe('safeDispose', () => {
  it('calls dispose if available', () => {
    const dispose = vi.fn();
    safeDispose({ dispose });
    expect(dispose).toHaveBeenCalled();
  });

  it('calls close if dispose is not available', () => {
    const close = vi.fn();
    safeDispose({ close });
    expect(close).toHaveBeenCalled();
  });

  it('does not throw for null', () => {
    expect(() => safeDispose(null)).not.toThrow();
  });
});

describe('parseUsToS', () => {
  it('converts microseconds to seconds', () => {
    expect(parseUsToS(1_000_000 * TICKS_PER_MICROSECOND)).toBe(1);
    expect(parseUsToS(String(500_000 * TICKS_PER_MICROSECOND))).toBe(0.5);
  });

  it('returns fallback for invalid input', () => {
    expect(parseUsToS(null, 5)).toBe(5);
    expect(parseUsToS('invalid', 5)).toBe(5);
  });
});

describe('parseUs', () => {
  it('returns positive integer', () => {
    expect(parseUs(1_500_000)).toBe(1_500_000);
    expect(parseUs('1000')).toBe(1000);
  });

  it('returns fallback for invalid input', () => {
    expect(parseUs(null, 10)).toBe(10);
  });
});

describe('sanitizeTimelineColor', () => {
  it('normalizes 3-char hex', () => {
    expect(sanitizeTimelineColor('#f00')).toBe('#ff0000');
  });

  it('normalizes 6-char hex', () => {
    expect(sanitizeTimelineColor('#FF0000')).toBe('#ff0000');
  });

  it('returns fallback for invalid input', () => {
    expect(sanitizeTimelineColor('invalid', '#000000')).toBe('#000000');
  });
});

describe('parseHexColor', () => {
  it('parses hex color to number', () => {
    expect(parseHexColor('#ff0000')).toBe(0xff0000);
    expect(parseHexColor('#00ff00')).toBe(0x00ff00);
  });
});

describe('isInputDisposed', () => {
  it('returns true for InputDisposedError', () => {
    expect(isInputDisposed({ name: 'InputDisposedError' })).toBe(true);
  });

  it('returns true for disposed message', () => {
    expect(isInputDisposed(new Error('Input has been disposed'))).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isInputDisposed(new Error('Other error'))).toBe(false);
  });
});
