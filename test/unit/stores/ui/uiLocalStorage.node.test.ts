/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  getPlatformSuffix,
  hasLocalStorageKey,
  readLocalStorageJson,
  readLocalStorageString,
  writeLocalStorageJson,
  writeLocalStorageString,
  clearUiCache,
} from '~/stores/ui/uiLocalStorage';

describe('uiLocalStorage (node environment)', () => {
  it('handles undefined window gracefully', () => {
    // 1. getPlatformSuffix / isMobilePlatform
    expect(getPlatformSuffix()).toBe('');

    // 2. hasLocalStorageKey
    expect(hasLocalStorageKey('key')).toBe(false);

    // 3. readLocalStorageJson
    expect(readLocalStorageJson('key', { fallback: true })).toEqual({ fallback: true });

    // 4. readLocalStorageString
    expect(readLocalStorageString('key', 'fallback')).toBe('fallback');

    // 5. writeLocalStorageJson
    expect(() => writeLocalStorageJson('key', { value: 1 })).not.toThrow();

    // 6. writeLocalStorageString
    expect(() => writeLocalStorageString('key', 'value')).not.toThrow();

    // 7. clearUiCache
    expect(() => clearUiCache()).not.toThrow();
  });
});
