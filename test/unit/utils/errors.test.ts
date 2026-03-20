import { describe, it, expect } from 'vitest';
import { getErrorMessage, isAbortError } from '~/utils/errors';

describe('errors', () => {
  describe('getErrorMessage', () => {
    it('returns error message if present', () => {
      expect(getErrorMessage(new Error('test error'), 'fallback')).toBe('test error');
      expect(getErrorMessage({ message: 'test error' }, 'fallback')).toBe('test error');
    });

    it('returns fallback if error is falsy or not an object', () => {
      expect(getErrorMessage(null, 'fallback')).toBe('fallback');
      expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
      expect(getErrorMessage('string error', 'fallback')).toBe('fallback');
      expect(getErrorMessage(123, 'fallback')).toBe('fallback');
    });

    it('returns fallback if error has no message or empty message', () => {
      expect(getErrorMessage({}, 'fallback')).toBe('fallback');
      expect(getErrorMessage({ name: 'Error' }, 'fallback')).toBe('fallback');
      expect(getErrorMessage({ message: '' }, 'fallback')).toBe('fallback');
      expect(getErrorMessage({ message: 123 }, 'fallback')).toBe('fallback');
    });
  });

  describe('isAbortError', () => {
    it('returns true for AbortError', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      expect(isAbortError(error)).toBe(true);
      expect(isAbortError({ name: 'AbortError' })).toBe(true);
    });

    it('returns false for other errors', () => {
      expect(isAbortError(new Error('test'))).toBe(false);
      expect(isAbortError({ name: 'OtherError' })).toBe(false);
      expect(isAbortError({})).toBe(false);
      expect(isAbortError(null)).toBe(false);
      expect(isAbortError(undefined)).toBe(false);
      expect(isAbortError('AbortError')).toBe(false);
    });
  });
});
