import { afterEach, describe, expect, it, vi } from 'vitest';
import { genUuid, randomToken, genPrefixedId } from '~/utils/ids';

describe('ids', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('genUuid', () => {
    it('delegates to crypto.randomUUID when available', () => {
      const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('fixed-uuid-1234');
      expect(genUuid()).toBe('fixed-uuid-1234');
      expect(spy).toHaveBeenCalledOnce();
    });

    it('produces unique values across calls', () => {
      const a = genUuid();
      const b = genUuid();
      expect(a).not.toBe(b);
    });

    it('falls back to a timestamp + random id when crypto.randomUUID is missing', () => {
      vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue(undefined as unknown as Crypto);
      const id = genUuid();
      expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
      // The leading segment survives a split('-') for callers that rely on it.
      expect(id.split('-')[0]).toBeTruthy();
    });
  });

  describe('randomToken', () => {
    it('returns an 8-char base36 token by default', () => {
      const token = randomToken();
      expect(token).toHaveLength(8);
      expect(token).toMatch(/^[0-9a-z]+$/);
    });

    it('honours the requested length', () => {
      expect(randomToken(6)).toHaveLength(6);
      expect(randomToken(20)).toHaveLength(20);
    });

    it('produces different tokens across calls', () => {
      expect(randomToken()).not.toBe(randomToken());
    });
  });

  describe('genPrefixedId', () => {
    it('prepends the prefix to a uuid', () => {
      vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('abc');
      expect(genPrefixedId('file-')).toBe('file-abc');
    });
  });
});
