/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { isDomExceptionName, isNotFoundError } from '~/utils/error-helpers';

describe('error-helpers', () => {
  it('isDomExceptionName matches by name property', () => {
    expect(isDomExceptionName({ name: 'NotFoundError' }, 'NotFoundError')).toBe(true);
    expect(isDomExceptionName({ name: 'NotFoundError' }, 'AbortError')).toBe(false);
  });

  it('isDomExceptionName returns false for non-objects', () => {
    expect(isDomExceptionName(null, 'NotFoundError')).toBe(false);
    expect(isDomExceptionName('string', 'NotFoundError')).toBe(false);
    expect(isDomExceptionName(undefined, 'NotFoundError')).toBe(false);
  });

  it('isDomExceptionName returns false for objects without name', () => {
    expect(isDomExceptionName({ message: 'foo' }, 'NotFoundError')).toBe(false);
  });

  it('isNotFoundError matches NotFoundError', () => {
    expect(isNotFoundError({ name: 'NotFoundError' })).toBe(true);
  });

  it('isNotFoundError matches VfsNotFoundError', () => {
    expect(isNotFoundError({ name: 'VfsNotFoundError' })).toBe(true);
  });

  it('isNotFoundError returns false for other errors', () => {
    expect(isNotFoundError({ name: 'AbortError' })).toBe(false);
    expect(isNotFoundError(new Error('not found'))).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
  });
});
