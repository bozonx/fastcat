/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  safeDispose,
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
