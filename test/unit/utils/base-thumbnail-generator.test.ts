/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { hashString } from '~/utils/base-thumbnail-generator';

describe('hashString', () => {
  it('returns a hex string prefixed with h', () => {
    const result = hashString('test');
    expect(result).toMatch(/^h[0-9a-f]+$/);
  });

  it('returns consistent hash for same input', () => {
    expect(hashString('hello')).toBe(hashString('hello'));
  });

  it('returns different hashes for different inputs', () => {
    expect(hashString('hello')).not.toBe(hashString('world'));
  });

  it('handles empty string', () => {
    const result = hashString('');
    expect(result).toMatch(/^h[0-9a-f]+$/);
  });
});
